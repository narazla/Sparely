"""Machine-learning early warning: probability that a spare part is demanded in the next 90 days.

Every training row is (part, origin date). Features use only data before the
origin; the label is whether the part had any non-turnaround issue in the 90
days after it. Origins are monthly, so the model learns from 12 snapshots of
history. Validation is out-of-time: the model is trained on origins whose label
window closes before the test origins start.
"""
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.inspection import permutation_importance
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score

import config as C

HORIZON = 90
FEATURES = {
    "issue_days_90": "Issue days in the last 90 days",
    "issue_days_180": "Issue days in the last 180 days",
    "issue_days_all": "Issue days since history start",
    "qty_365": "Units issued in the last 365 days",
    "days_since_last": "Days since last issue",
    "history_days": "Days of history available",
    "notif_fl_90": "Failure notifications on its equipment, last 90 days",
    "notif_fl_all": "Failure notifications on its equipment, all history",
    "planned_jobs": "Part-consuming maintenance jobs due in the next 90 days",
    "planned_qty": "Planned units from those jobs",
    "pr_lines_180": "Purchase requisitions in the last 180 days",
    "open_po": "Open PO quantity at the origin",
    "category_active": "Share of parts in its category issued in the last 180 days",
    "n_funcloc": "Number of FuncLocs it is installed on",
    "installed_qty": "Installed quantity",
    "n_funcloc_critical": "FuncLocs with criticality A/B",
    "crit_rank": "Criticality (A=4 ... S=1)",
    "stock_item": "MRP type is Stock Item",
    "log_price": "log10 unit price",
    "lt_mean": "Mean lead time (days)",
}


def snapshot(t, mats, static, links, mv, notif, po, planned_fn):
    """Feature rows for every part at origin t, plus the 90-day label."""
    t = pd.Timestamp(t)
    end = t + pd.Timedelta(days=HORIZON)
    base = mv[~mv.order_type.isin(C.TURNAROUND_TYPES)]
    past = base[base.posting_date < t]
    idx = mats.material_no

    def issue_days(lo):
        s = past[past.posting_date >= lo] if lo is not None else past
        return s.groupby("material_no").posting_date.nunique().reindex(idx).fillna(0).values

    f = pd.DataFrame({"material_no": idx.values})
    f["issue_days_90"] = issue_days(t - pd.Timedelta(days=90))
    f["issue_days_180"] = issue_days(t - pd.Timedelta(days=180))
    f["issue_days_all"] = issue_days(None)
    f["qty_365"] = past[past.posting_date >= t - pd.Timedelta(days=365)].groupby("material_no").qty.sum().reindex(idx).fillna(0).values
    hist_days = (t - pd.Timestamp(C.HISTORY_START)).days
    last = past.groupby("material_no").posting_date.max().reindex(idx)
    f["days_since_last"] = ((t - last).dt.days.fillna(hist_days + 30)).values
    f["history_days"] = hist_days

    n = notif[(notif.notification_date < t) & (~notif.is_support_work)]
    def fl_notifs(lo):
        s = n[n.notification_date >= lo] if lo is not None else n
        cnt = s.groupby("funcloc").size()
        return links.assign(c=links.funcloc.map(cnt).fillna(0)).groupby("material_no").c.sum().reindex(idx).fillna(0).values
    f["notif_fl_90"] = fl_notifs(t - pd.Timedelta(days=90))
    f["notif_fl_all"] = fl_notifs(None)

    pl = planned_fn(t, end)
    f["planned_jobs"] = pl.groupby("material_no").size().reindex(idx).fillna(0).values
    f["planned_qty"] = pl.groupby("material_no").qty.sum().reindex(idx).fillna(0).values

    f["pr_lines_180"] = po[(po.pr_date < t) & (po.pr_date >= t - pd.Timedelta(days=180))].groupby("material_no").size().reindex(idx).fillna(0).values
    f["open_po"] = po[(po.pr_date < t) & (po.po_delivery_date >= t)].groupby("material_no").qty.sum().reindex(idx).fillna(0).values

    recent = set(past[past.posting_date >= t - pd.Timedelta(days=180)].material_no)
    cat_share = mats.assign(a=mats.material_no.isin(recent)).groupby("category").a.mean()
    f["category_active"] = mats.category.map(cat_share).values

    f = f.merge(static, on="material_no", how="left")
    fut = base[(base.posting_date >= t) & (base.posting_date < end)]
    f["label"] = f.material_no.isin(set(fut.material_no)).astype(int)
    f["origin"] = t
    return f


def run(mats, static, links, mv, notif, po, planned_fn, stat_prob_fn):
    """Train, validate out-of-time, refit on all origins, score as of the planning date."""
    origins = pd.date_range("2025-08-01", "2026-07-01", freq="MS")
    data = pd.concat([snapshot(t, mats, static, links, mv, notif, po, planned_fn) for t in origins], ignore_index=True)
    train_origins = origins[origins <= "2026-03-01"]       # label windows close by 30 May 2026
    test_origins = origins[origins >= "2026-06-01"]        # 1 Jun and 1 Jul 2026
    X = list(FEATURES)
    tr, te = data[data.origin.isin(train_origins)], data[data.origin.isin(test_origins)]

    model = HistGradientBoostingClassifier(max_iter=300, learning_rate=0.05, max_leaf_nodes=31,
                                           l2_regularization=1.0, random_state=42)
    model.fit(tr[X], tr.label)
    p = model.predict_proba(te[X])[:, 1]
    y = te.label.values

    stat = np.concatenate([stat_prob_fn(t, te[te.origin == t].material_no.values) for t in test_origins])
    rule = te.issue_days_180.values
    base_rate = y.mean()

    def metrics(name, score, is_prob):
        top = np.argsort(-score)[: max(1, len(score) // 10)]
        return {"model": name, "auc": roc_auc_score(y, score), "avg_precision": average_precision_score(y, score),
                "brier": brier_score_loss(y, score) if is_prob else None,
                "top_decile_precision": y[top].mean(), "base_rate": base_rate, "rows": len(y)}

    mt = pd.DataFrame([
        metrics("Rule: issued in last 180 days", rule, False),
        metrics("Statistical demand model (compound Poisson)", stat, True),
        metrics("ML early warning (gradient boosting)", p, True),
    ])

    calib = pd.DataFrame({"p": p, "y": y})
    calib["bin"] = pd.cut(calib.p, [0, 0.05, 0.1, 0.2, 0.3, 0.5, 0.7, 1.0], include_lowest=True)
    calib = calib.groupby("bin", observed=True).agg(parts=("y", "size"), predicted=("p", "mean"), observed=("y", "mean")).reset_index()
    calib["bin"] = calib.bin.astype(str)

    imp = permutation_importance(model, te[X], y, scoring="roc_auc", n_repeats=3, random_state=0)
    imp = pd.DataFrame({"feature": X, "description": [FEATURES[k] for k in X],
                        "importance": imp.importances_mean}).sort_values("importance", ascending=False)

    final = HistGradientBoostingClassifier(max_iter=300, learning_rate=0.05, max_leaf_nodes=31,
                                           l2_regularization=1.0, random_state=42)
    final.fit(data[X], data.label)
    now = snapshot(C.AS_OF, mats, static, links, mv, notif, po, planned_fn)
    now["p_demand_90d"] = final.predict_proba(now[X])[:, 1]
    print(mt.round(3).to_string())
    print(imp.head(8).round(4).to_string())
    info = {"train_rows": len(tr), "test_rows": len(te), "origins": len(origins),
            "train_window": f"{train_origins[0].date()} to {train_origins[-1].date()} (+90d labels)",
            "test_window": f"{test_origins[0].date()} to {test_origins[-1].date()} (+90d labels)"}
    return now[["material_no", "p_demand_90d"] + X], mt, calib, imp, info
