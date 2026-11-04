"""Build the Sparely SQLite database (CALIBER 2026 Final Case).

Reads the six organizer Excel files, cleans them, computes per-material demand,
lead-time and price features, runs a forecast backtest, and writes everything
to data/caliber.db for the web app. The inventory policy itself (safety stock,
reorder point, min-max, cost-risk optimization) is computed live in the web
app so scenario parameters can change it.

Usage:  python pipeline/build_db.py
"""
import math
import re
import sqlite3
from datetime import datetime

import numpy as np
import pandas as pd

import config as C

AS_OF = pd.Timestamp(C.AS_OF)
H_START = pd.Timestamp(C.HISTORY_START)
H_END = pd.Timestamp(C.HISTORY_END)
quality = []   # data-quality log shown in the app


def log(dataset, check, result, action):
    quality.append({"dataset": dataset, "check_name": check, "result": str(result), "action": action})
    print(f"  [{dataset}] {check}: {result} -> {action}")


def read(name):
    return pd.read_excel(C.RAW_DIR / f"{name}.xlsx", sheet_name="Data")


# --------------------------------------------------------------------------- load + clean

def load_funcloc():
    df = read("FuncLoc list").rename(columns={
        "Functional Location": "funcloc", "FunctLocDescrip.": "description",
        "FuncLoc Criticallity": "criticality"})
    log("FuncLoc list", "Missing criticality", int(df.criticality.isna().sum()), f"Set to {C.LOWEST_CRIT} (lowest)")
    df["criticality"] = df.criticality.fillna(C.LOWEST_CRIT)
    df["plant"] = df.funcloc.str.split("_").str[0]
    rest = df.funcloc.str.replace(r"^(PX|PY|UT)_", "", regex=True)
    cls = rest.str.extract(r"^([A-Z]+)")[0]
    cls = cls.where(~rest.str.match(r"^\d"), "PIPING")
    cls = cls.where(~df.funcloc.str.startswith("SITE_"), "SYSTEM")
    df["equipment_class"] = cls.fillna("OTHER")
    return df


def load_bom():
    df = read("BoM").rename(columns={
        "Functional Loc.": "funcloc", "Material No": "material_no", "Material Desc.": "description",
        "Installed Qty": "installed_qty", "Unit": "unit", "Min.Qty": "min_qty", "Max.Qty": "max_qty",
        "Stock": "stock", "MRP Type": "mrp_type"})
    dups = int(df.duplicated(["funcloc", "material_no"]).sum())
    log("BoM", "Duplicate FuncLoc x Material rows", dups, "Removed (identical values)")
    per_mat = df.groupby("material_no")[["stock", "min_qty", "max_qty", "mrp_type"]].nunique()
    same = bool((per_mat == 1).all().all())
    log("BoM", "Stock/Min/Max identical on every FuncLoc row of a material", same,
        "Treated as warehouse-level values; counted once per material")
    links = df.drop_duplicates(["funcloc", "material_no"])[["material_no", "funcloc", "installed_qty"]]
    mats = df.drop_duplicates("material_no")[
        ["material_no", "description", "unit", "min_qty", "max_qty", "stock", "mrp_type"]].copy()
    mats["category"] = mats.description.str.split(",").str[0].str.strip()
    ns_stock = int(((mats.mrp_type == "Non Stock") & (mats.stock > 0)).sum())
    log("BoM", "Non Stock materials (min=max=0) still holding stock", ns_stock,
        "Flagged as uncontrolled stock in Inventory Health")
    return mats, links


def load_movement():
    df = read("Movement Material").rename(columns={
        "Posting Date": "posting_date", "Movement Type": "movement_type", "Material Number": "material_no",
        "Material Descriptions": "description", "Quantity": "qty", "Base Unit": "unit", "Order": "order_no"})
    dups = int(df.duplicated().sum())
    log("Movement Material", "Exact duplicate rows (same date, part, qty, order)", dups,
        f"Removed ({df[df.duplicated()].qty.sum() / df.qty.sum():.1%} of issued units)")
    df = df.drop_duplicates().copy()
    df["order_prefix"] = df.order_no.astype(str).str[:3]
    df["order_type"] = df.order_prefix.map(C.ORDER_TYPES).fillna("Other maintenance")
    log("Movement Material", "Movement types present", ", ".join(sorted(df.movement_type.unique())),
        "All rows treated as consumption (goods issue)")
    return df


def load_notif():
    df = read("Notif History").rename(columns={
        "Notification Date": "notification_date", "Notification": "notification",
        "Notification Type": "notif_type", "Order": "order_no", "Priority": "priority",
        "Functional Location": "funcloc", "Description": "description", "Created On": "created_on",
        "Required Start": "required_start", "Required End": "required_end",
        "Completion by Date": "completed_on", "Status": "status"})
    df["order_no"] = df.order_no.astype("Int64")
    log("Notif History", "Notifications without an order", int(df.order_no.isna().sum()), "Kept; no part link")
    df["is_support_work"] = df.description.str.contains("scaffold|paint", case=False, regex=True)
    may = int((df.notification_date < C.FAILURE_RATE_START).sum())
    log("Notif History", "Notifications in May 2025 (backlog spike, ~4x normal)", may,
        f"Failure rates measured from {C.FAILURE_RATE_START}")
    return df


def cycle_days(text):
    t = str(text).upper().strip()
    m = re.match(r"(\d+)", t)
    n = int(m.group(1)) if m else 1
    if "YEAR" in t:
        return n * 365.25
    if "MONTH" in t:
        return n * 30.4375
    if "WEEK" in t:
        return n * 7.0
    return np.nan


def task_rule(text):
    """Index of the first TASK_PART_RULES entry matching the task text, or -1."""
    t = str(text).lower()
    for i, (_, pattern, _) in enumerate(C.TASK_PART_RULES):
        if re.search(pattern, t):
            return i
    return -1


def task_category(text):
    i = task_rule(text)
    if i >= 0:
        return C.TASK_PART_RULES[i][0]
    t = str(text).lower()
    if any(k in t for k in ["calibration", "test", "verification", "measurement", "analysis"]):
        return "Calibration & Test"
    if "clean" in t or "decoking" in t:
        return "Cleaning"
    if "inspect" in t or "check" in t or "recert" in t:
        return "Inspection"
    return "Other"


def load_mplan():
    df = read("Mitem & Mplan").rename(columns={
        "Functional Location": "funcloc", "FunctLocDescrip.": "fl_description", "ABC Indicator": "abc_indicator",
        "Maintenance Plan": "plan_no", "Maintenance Item": "item_no", "Maint. item text": "task",
        "Priority": "priority", "Cycle Descriptions": "cycle_text", "Start of cycle": "cycle_start"})
    log("Mitem & Mplan", "Distinct cycle text formats", df.cycle_text.nunique(), "Normalized to days")
    df["cycle_days"] = df.cycle_text.map(cycle_days)
    log("Mitem & Mplan", "Unparseable cycles", int(df.cycle_days.isna().sum()), "Excluded from schedule")
    df["task_category"] = df.task.map(task_category)
    df["task_rule"] = df.task.map(task_rule)
    df["consumes_parts"] = (df.task_rule >= 0).astype(int)
    df["part_categories"] = df.task_rule.map(
        lambda i: ", ".join(sorted(C.TASK_PART_RULES[i][2])) if i >= 0 else "")
    return df


def load_prpo():
    raw = read("PR PO")
    df = raw.drop_duplicates()
    log("PR PO", "Exact duplicate rows", len(raw) - len(df), f"Removed; {len(df):,} unique lines kept")
    df = df.rename(columns={
        "PR-Type": "pr_type", "Purchase Requisition": "pr_no", "PR-Item": "pr_item", "PR-Date": "pr_date",
        "PR-Material": "material_no", "PR-Material Desc": "description", "PR-Quantity": "qty", "PR-UoM": "uom",
        "PR-Delivery Date": "pr_delivery_date", "PR-Plant": "plant", "PR-Purchasing Group": "purchasing_group",
        "Purchase Order": "po_no", "PO-Item": "po_item", "PO-Supplier Code": "supplier_code",
        "PO-Supplier Name": "supplier_name", "PO-Item Amount": "unit_price", "PO-Currency": "currency",
        "PO-Delivery Date": "po_delivery_date"}).copy()
    nonidr = int((df.currency != "IDR").sum())
    log("PR PO", "Non-IDR lines", nonidr, "Converted to IDR with fixed assumed rates")
    df["unit_price_idr"] = df.unit_price * df.currency.map(C.FX_TO_IDR)
    raw_lt = (df.po_delivery_date - df.pr_date).dt.days
    # a PO due before its PR, or more than a year after it, is treated as a data error for lead-time statistics
    df["lt_valid"] = ((raw_lt >= 1) & (raw_lt <= 365)).astype(int)
    log("PR PO", "PO delivery before PR date / lead time over 365 days",
        f"{int((raw_lt < 1).sum())} / {int((raw_lt > 365).sum())}", "Kept as records, excluded from lead-time statistics")
    df["lead_time_days"] = raw_lt.clip(lower=1)
    df["slip_days"] = (df.po_delivery_date - df.pr_delivery_date).dt.days
    neg = int((df.pr_delivery_date < df.pr_date).sum())
    log("PR PO", "Requested delivery date before PR date", neg, "Kept; lead time uses PO delivery date")
    df["is_open"] = (df.po_delivery_date >= AS_OF).astype(int)
    df["pr_type_label"] = df.pr_type.map(C.PR_TYPE_LABELS).fillna("Other")
    log("PR PO", "Open POs (delivery on/after as-of date)", int(df.is_open.sum()),
        "Counted as on-order quantity in the inventory position")
    log("PR PO", "Suppliers per material (max)", int(df.groupby("material_no").supplier_code.nunique().max()),
        "Single-source risk flagged")
    return df


# --------------------------------------------------------------------------- features

def occurrences(start, step, lo, hi):
    """Due dates of a cyclic task inside [lo, hi)."""
    if pd.isna(step) or step <= 0:
        return []
    if start >= lo:
        first = start
    else:
        n = math.ceil((lo - start).days / step)
        first = start + pd.Timedelta(days=round(n * step))
    out, k = [], 0
    while True:
        d = first + pd.Timedelta(days=round(k * step))
        if d >= hi:
            return out
        out.append(d)
        k += 1


def planned_events(mplan, links, mats, lo, hi, factor):
    """Spare-part demand implied by consuming maintenance tasks due in [lo, hi).

    A task consumes the parts installed on its FuncLoc (BoM) whose category is
    replaced by that kind of task, at Installed Qty x calibrated usage factor.
    """
    rows = []
    for r in mplan[mplan.consumes_parts == 1].itertuples():
        for d in occurrences(r.cycle_start, r.cycle_days, lo, hi):
            rows.append((r.funcloc, r.item_no, r.task, r.task_category, r.task_rule, d))
    ev = pd.DataFrame(rows, columns=["funcloc", "item_no", "task", "task_category", "task_rule", "due_date"])
    ev = ev.merge(links, on="funcloc", how="inner").merge(mats[["material_no", "category"]], on="material_no")
    keep = [cat in C.TASK_PART_RULES[rule][2] for cat, rule in zip(ev.category, ev.task_rule)]
    ev = ev[keep].copy()
    ev["qty"] = ev.installed_qty * factor
    return ev


def funcloc_failure_rates(fl, notif, lo, hi):
    """Failure notifications per day for every FuncLoc, smoothed toward its equipment class."""
    days = (hi - lo).days + 1
    n = notif[(notif.notification_date >= lo) & (notif.notification_date <= hi) & (~notif.is_support_work)]
    cnt = n.groupby("funcloc").size()
    f = fl[["funcloc", "equipment_class"]].copy()
    f["n_notif"] = f.funcloc.map(cnt).fillna(0)
    cls_rate = f.groupby("equipment_class").n_notif.mean() / days
    m0 = 365.0
    f["rate_day"] = (f.n_notif + m0 * f.equipment_class.map(cls_rate)) / (days + m0)
    return f.set_index("funcloc").rate_day


def baseline_events(mv, lo, hi, planned_mats):
    """Issue lines that feed the statistical baseline (no turnaround, no plan-covered preventive)."""
    h = mv[(mv.posting_date >= lo) & (mv.posting_date <= hi) & (~mv.order_type.isin(C.TURNAROUND_TYPES))]
    return h[~(h.order_type.isin(C.PLANNED_TYPES) & h.material_no.isin(planned_mats))]


def installed_exposure(links, fl_rate):
    """Sum of failure rates (per day) of every FuncLoc a part is installed on."""
    lk = links.assign(rate=links.funcloc.map(fl_rate).fillna(fl_rate.mean()))
    return lk.groupby("material_no").rate.sum()


def estimate_emergence(links, mv, fl_rate, lo, mid, hi, planned_mats):
    """How often does a part with no demand so far get demanded, per unit of installed exposure?

    Parts with no issue in [lo, mid) are followed over [mid, hi]; the number of
    issue-days they then record, divided by their exposure x days, is the
    first-demand rate used as the prior for never-used parts.
    """
    h = baseline_events(mv, lo, hi, planned_mats)
    before = set(h[h.posting_date < mid].material_no)
    after = h[h.posting_date >= mid].groupby("material_no").posting_date.nunique()
    exp = installed_exposure(links, fl_rate)
    zero = exp[~exp.index.isin(before)]
    days = (hi - mid).days + 1
    events = after.reindex(zero.index).fillna(0).sum()
    return float(events / (zero.sum() * days)), int((after.reindex(zero.index).fillna(0) > 0).sum()), len(zero)


def demand_model(mats, links, mv, fl_rate, lo, hi, as_of, planned_mats, kappa_new):
    """Recency-weighted compound-Poisson demand with an installed-base prior.

    Parts with history: occurrence rate is a credibility blend of their own
    recency-weighted issue frequency and an installed-base prior (failure rate
    of every FuncLoc the part sits on). Parts with no history: the empirically
    estimated first-demand rate (kappa_new) x installed-base exposure.
    Turnaround issues are excluded (event demand), and preventive issues are
    excluded for parts whose planned demand comes from the maintenance plan,
    to avoid double counting.
    """
    days = pd.date_range(lo, hi, freq="D")
    T = len(days)
    w_day = 0.5 ** ((as_of - days).days.to_numpy() / C.RECENCY_HALF_LIFE_DAYS)
    w_by_date = pd.Series(w_day, index=days)
    w_total = w_day.sum()

    h = baseline_events(mv, lo, hi, planned_mats)
    ev = h.groupby(["material_no", "posting_date"], as_index=False).qty.sum()

    # abnormal issue detection (robust z-score on daily issue size)
    def flag(g):
        q = g.qty.values.astype(float)
        if len(q) < C.ANOMALY_MIN_EVENTS:
            g["threshold"] = np.inf
        else:
            med = np.median(q)
            mad = np.median(np.abs(q - med))
            thr = med + C.ANOMALY_ROBUST_Z * mad / 0.6745 if mad > 0 else 3 * med
            g["threshold"] = max(thr, 2 * med)
        return g
    ev = ev.groupby("material_no", group_keys=False).apply(flag)
    ev["abnormal"] = (ev.qty > ev.threshold).astype(int)
    ev["qty_capped"] = np.where(ev.abnormal == 1, ev.threshold, ev.qty)
    ev["w"] = ev.posting_date.map(w_by_date)

    g = ev.groupby("material_no")
    feat = pd.DataFrame({
        "n_events": g.size(),
        "w_events": g.w.sum(),
        "size_mean": g.qty_capped.mean(),
        "size_var": g.qty_capped.var(ddof=0),
        "abnormal_events": g.abnormal.sum(),
    })
    out = mats[["material_no"]].set_index("material_no").join(feat)
    out["n_events"] = out.n_events.fillna(0)
    out["w_events"] = out.w_events.fillna(0)
    out["abnormal_events"] = out.abnormal_events.fillna(0)

    # installed-base exposure and prior
    out["exposure"] = installed_exposure(links, fl_rate).reindex(out.index).fillna(0)
    has = out.n_events > 0
    kappa = (out.n_events[has].sum() / T) / out.exposure[has].sum()
    out["prior_rate"] = np.where(has, kappa * out.exposure, kappa_new * out.exposure)
    out["obs_rate"] = out.w_events / w_total
    cred = out.n_events / (out.n_events + C.CREDIBILITY_K)
    out["credibility"] = cred
    out["occ_rate"] = cred * out.obs_rate + (1 - cred) * out.prior_rate

    # size of a first demand: typical issue size of parts in the same category and unit
    cu = mats.set_index("material_no")[["category", "unit"]]
    sized = out[has].join(cu)
    cat_size = sized.groupby(["category", "unit"]).size_mean.median()
    guess = [cat_size.get((c, u), 1.0) for c, u in zip(cu.reindex(out.index).category, cu.reindex(out.index).unit)]
    out["size_mean"] = out.size_mean.fillna(pd.Series(guess, index=out.index)).clip(lower=1)
    # one observation (or none) says little about variability: assume CV = 1
    out["size_var"] = np.where(out.n_events >= 2, out.size_var.fillna(0), out.size_mean ** 2)
    out["mu_day"] = out.occ_rate * out.size_mean
    out["var_day"] = out.occ_rate * (out.size_mean ** 2 + out.size_var)
    return out, ev, kappa


def demand_class(mats, mv, lo, hi):
    months = pd.period_range(lo, hi, freq="M")
    h = mv[(mv.posting_date >= lo) & (mv.posting_date <= hi) & (~mv.order_type.isin(C.TURNAROUND_TYPES))]
    tab = (h.assign(ym=h.posting_date.dt.to_period("M"))
           .groupby(["material_no", "ym"]).qty.sum().unstack(fill_value=0)
           .reindex(columns=months, fill_value=0))
    nz = (tab > 0).sum(axis=1)
    adi = len(months) / nz.replace(0, np.nan)
    cv2 = tab.apply(lambda r: (r[r > 0].std(ddof=0) / r[r > 0].mean()) ** 2 if (r > 0).sum() > 1 else np.nan, axis=1)
    cls = pd.Series(np.select(
        [nz <= 1, (adi < 1.32) & (cv2 < 0.49), adi < 1.32, cv2 < 0.49],
        ["Single issue", "Smooth", "Erratic", "Intermittent"], "Lumpy"), index=tab.index)
    out = pd.DataFrame({"demand_class": cls, "adi": adi, "cv2": cv2, "active_months": nz})
    out = mats[["material_no"]].set_index("material_no").join(out)
    out["demand_class"] = out.demand_class.fillna("No demand")
    out["active_months"] = out.active_months.fillna(0)
    return out


def calibrate_planned_factor(mplan, links, mats, mv, lo, hi):
    """Data-driven answer to 'how much of the installed parts does a planned task consume'."""
    derived = planned_events(mplan, links, mats, lo, hi + pd.Timedelta(days=1), 1.0).groupby("material_no").qty.sum()
    actual = mv[(mv.order_type.isin(C.PLANNED_TYPES)) & (mv.posting_date >= lo) & (mv.posting_date <= hi)] \
        .groupby("material_no").qty.sum()
    both = derived.index.intersection(actual.index)
    raw = actual.reindex(derived.index).fillna(0).sum() / derived.sum() if derived.sum() > 0 else 0.0
    factor = float(np.clip(raw, 0.05, 1.0))
    return factor, raw, len(derived), len(both)


def lead_time_features(mats, po):
    po = po[po.lt_valid == 1].merge(mats[["material_no", "category"]], on="material_no", how="left")
    g = po.groupby("material_no").lead_time_days
    m = pd.DataFrame({"lt_n": g.size(), "lt_mat_mean": g.mean(), "lt_mat_std": g.std(ddof=1)})
    # category level uses robust statistics: a few 400-day POs should not set a whole category
    def robust(x):
        med = x.median()
        return pd.Series({"mean": med, "cv": 1.4826 * (x - med).abs().median() / med if med else 0.5})
    cat = po.groupby("category").lead_time_days.apply(robust).unstack()
    glob = robust(po.lead_time_days)
    glob_mean, glob_cv = glob["mean"], glob["cv"]
    out = mats[["material_no", "category"]].set_index("material_no").join(m)
    out["lt_n"] = out.lt_n.fillna(0)
    cmean = out.category.map(cat["mean"]).fillna(glob_mean)
    ccv = out.category.map(cat["cv"]).fillna(glob_cv)
    w = out.lt_n / (out.lt_n + 3)
    out["lt_mean"] = (w * out.lt_mat_mean.fillna(0) + (1 - w) * cmean).round(1)
    mat_std = out.lt_mat_std.where(out.lt_n >= 3)
    out["lt_std"] = (w * mat_std.fillna(ccv * cmean) + (1 - w) * ccv * cmean).round(1)
    out["lt_source"] = np.select([out.lt_n >= 3, out.lt_n > 0], ["PO history", "PO history + category"],
                                 "Category estimate")
    # fastest realistic replenishment = 10th percentile of observed lead times in the part's category
    p10 = po.groupby("category").lead_time_days.quantile(0.1)
    out["lt_fast"] = out.category.map(p10).fillna(po.lead_time_days.quantile(0.1)).round(1)
    # "safe" lead time for order-by dates: 80% of deliveries arrive within it (own POs if >= 3, else category)
    own80 = po.groupby("material_no").lead_time_days.quantile(0.8)
    cat80 = po.groupby("category").lead_time_days.quantile(0.8)
    out["lt_p80"] = np.where(out.lt_n >= 3, out.index.map(own80),
                             out.category.map(cat80).fillna(po.lead_time_days.quantile(0.8)))
    out["lt_p80"] = out.lt_p80.round(0)
    return out[["lt_n", "lt_mean", "lt_std", "lt_source", "lt_fast", "lt_p80"]]


def price_features(mats, po):
    p = po.groupby("material_no").unit_price_idr.median()
    out = mats.set_index("material_no")[["category", "unit"]].copy()
    out["price_idr"] = p
    out["price_source"] = np.where(out.price_idr.notna(), "PO history", None)
    priced = out[out.price_idr.notna()]
    for keys, label in [(["category", "unit"], "Category + unit estimate"), (["category"], "Category estimate"),
                        (["unit"], "Unit estimate")]:
        med = priced.groupby(keys).price_idr.median()
        idx = out.price_idr.isna()
        fill = out.loc[idx, keys].apply(lambda r: med.get(tuple(r) if len(keys) > 1 else r.iloc[0]), axis=1)
        out.loc[idx, "price_idr"] = fill
        out.loc[idx & out.price_idr.notna(), "price_source"] = label
    idx = out.price_idr.isna()
    out.loc[idx, "price_idr"] = priced.price_idr.median()
    out.loc[idx, "price_source"] = "Global estimate"
    return out[["price_idr", "price_source"]]


def supplier_features(mats, po):
    s = po.groupby(["supplier_code", "supplier_name"]).agg(
        po_lines=("po_no", "size"), materials=("material_no", "nunique"),
        lt_median=("lead_time_days", "median"), on_time_rate=("slip_days", lambda x: float((x <= 0).mean())),
        avg_slip_days=("slip_days", "mean")).reset_index()
    main = po.groupby(["material_no", "supplier_code", "supplier_name"]).size().reset_index(name="n") \
        .sort_values("n", ascending=False).drop_duplicates("material_no")
    m = main.merge(s[["supplier_code", "on_time_rate"]], on="supplier_code")[
        ["material_no", "supplier_code", "supplier_name", "on_time_rate"]]
    n_sup = po.groupby("material_no").supplier_code.nunique().rename("n_suppliers")
    m = m.set_index("material_no").join(n_sup)
    return s, mats[["material_no"]].set_index("material_no").join(m)


# --------------------------------------------------------------------------- backtest

def croston_sba(series, alpha=0.1):
    z = p = None
    q = 1
    for x in series:
        if x > 0:
            if z is None:
                z, p = x, q
            else:
                z = z + alpha * (x - z)
                p = p + alpha * (q - p)
            q = 1
        else:
            q += 1
    return 0.0 if z is None else (1 - alpha / 2) * z / p


def backtest(mats, links, mv, notif, fl, mplan):
    cut = pd.Timestamp(C.BACKTEST_CUTOFF)
    tr_end = cut - pd.Timedelta(days=1)
    test_days = (H_END - cut).days + 1
    train_days = (tr_end - H_START).days + 1
    rate = funcloc_failure_rates(fl, notif, pd.Timestamp(C.FAILURE_RATE_START), tr_end)
    factor, *_ = calibrate_planned_factor(mplan, links, mats, mv, H_START, tr_end)
    plan_test = planned_events(mplan, links, mats, cut, H_END + pd.Timedelta(days=1), factor)
    pmats = set(plan_test.material_no)
    # first-demand rate estimated inside the training window only (no look-ahead)
    k_new, *_ = estimate_emergence(links, mv, rate, H_START, pd.Timestamp(C.EMERGENCE_SPLIT_BACKTEST), tr_end, pmats)
    feat, _, _ = demand_model(mats, links, mv, rate, H_START, tr_end, cut, pmats, k_new)
    plan_q = plan_test.groupby("material_no").qty.sum()

    test = mv[(mv.posting_date >= cut) & (~mv.order_type.isin(C.TURNAROUND_TYPES))]
    actual = test.groupby("material_no").qty.sum()
    train_all = mv[mv.posting_date <= tr_end]
    static = train_all.groupby("material_no").qty.sum() / train_days * test_days

    months = pd.period_range(H_START, tr_end, freq="M")
    tr = train_all[~train_all.order_type.isin(C.TURNAROUND_TYPES)]
    tab = (tr.assign(ym=tr.posting_date.dt.to_period("M")).groupby(["material_no", "ym"]).qty.sum()
           .unstack(fill_value=0).reindex(columns=months, fill_value=0))
    sba = tab.apply(lambda r: croston_sba(r.values), axis=1) * (test_days / 30.4375)

    ours = feat.mu_day * test_days + plan_q.reindex(feat.index).fillna(0)
    idx = feat.index
    A = actual.reindex(idx).fillna(0)
    forecasts = {
        "Static average (current practice)": static.reindex(idx).fillna(0),
        "Croston SBA (classical intermittent)": sba.reindex(idx).fillna(0),
        "CALIBER hybrid model": ours,
    }
    occurred = (A > 0).astype(int)
    p_ours = 1 - np.exp(-feat.occ_rate * test_days)
    try:
        from sklearn.metrics import roc_auc_score
        auc = {
            "Static average (current practice)": roc_auc_score(occurred, forecasts["Static average (current practice)"]),
            "Croston SBA (classical intermittent)": roc_auc_score(occurred, forecasts["Croston SBA (classical intermittent)"]),
            "CALIBER hybrid model": roc_auc_score(occurred, p_ours),
        }
    except Exception:
        auc = {k: float("nan") for k in forecasts}
    rows = []
    active = (A > 0) | (static.reindex(idx).fillna(0) > 0)
    for name, F in forecasts.items():
        Fa, Aa = F[active], A[active]
        rows.append({"method": name,
                     "wape": float((Fa - Aa).abs().sum() / Aa.sum()),
                     "bias": float((Fa - Aa).sum() / Aa.sum()),
                     "auc_occurrence": float(auc[name]),
                     "materials_evaluated": int(active.sum()),
                     "train_window": f"{C.HISTORY_START} to {tr_end.date()}",
                     "test_window": f"{C.BACKTEST_CUTOFF} to {C.HISTORY_END}"})
    new_in_test = int(((A > 0) & (tab.reindex(idx).fillna(0).sum(axis=1) == 0)).sum())
    print(f"  backtest: {new_in_test} materials had demand in test but none in train")
    return pd.DataFrame(rows), new_in_test


# --------------------------------------------------------------------------- warehouse replay inputs

def replay_inputs(mats, crit, links, mv, notif, fl, mplan, po):
    """Everything the web app needs to replay May-Sep 2026 with a policy built from training data only.

    The policy side (demand model, lead times, prices, planned jobs) uses data before
    the cutoff; the replay side is the actual daily issues after it.
    """
    cut = pd.Timestamp(C.BACKTEST_CUTOFF)
    tr_end = cut - pd.Timedelta(days=1)
    rate = funcloc_failure_rates(fl, notif, pd.Timestamp(C.FAILURE_RATE_START), tr_end)
    factor, *_ = calibrate_planned_factor(mplan, links, mats, mv, H_START, tr_end)
    plan = planned_events(mplan, links, mats, cut, cut + pd.Timedelta(days=C.FORECAST_HORIZON_DAYS), factor)
    plan = plan[plan.qty > 0]
    pmats = set(plan.material_no)
    k_new, *_ = estimate_emergence(links, mv, rate, H_START, pd.Timestamp(C.EMERGENCE_SPLIT_BACKTEST), tr_end, pmats)
    feat, _, _ = demand_model(mats, links, mv, rate, H_START, tr_end, cut, pmats, k_new)
    po_tr = po[po.pr_date < cut]
    ltf = lead_time_features(mats, po_tr)
    prf = price_features(mats, po_tr)
    rows = (mats.set_index("material_no")[["description", "unit", "mrp_type", "min_qty", "max_qty"]]
            .join(crit[["criticality"]]).join(ltf[["lt_mean", "lt_std", "lt_fast"]]).join(prf[["price_idr"]])
            .join(feat[["occ_rate", "size_mean", "size_var", "mu_day", "var_day"]])
            .join(plan.groupby("material_no").qty.sum().rename("planned_qty_12m")))
    rows["criticality"] = rows.criticality.fillna(C.LOWEST_CRIT)
    rows["planned_qty_12m"] = rows.planned_qty_12m.fillna(0)
    rows = rows.reset_index()

    pl = plan.assign(offset=(plan.due_date - cut).dt.days)[["material_no", "offset", "qty"]]
    test = mv[(mv.posting_date >= cut) & (mv.posting_date <= H_END)]
    dem = (test.assign(day=(test.posting_date - cut).dt.days)
           .groupby(["material_no", "day"]).qty.sum().reset_index())
    em = notif[(notif.priority == "Emergency") & (notif.notification_date >= C.FAILURE_RATE_START)
               & (notif.notification_date <= tr_end)]
    em_days = (tr_end - pd.Timestamp(C.FAILURE_RATE_START)).days + 1
    info = {"replay_start": str(cut.date()), "replay_end": C.HISTORY_END,
            "replay_days": (H_END - cut).days + 1, "replay_emergencies_per_year": len(em) * 365 / em_days,
            "replay_demand_days": len(dem), "replay_demand_units": int(dem.qty.sum())}
    log("Replay", "Policy inputs built from data before the replay window",
        f"{C.BACKTEST_CUTOFF}; {len(dem):,} part-days of actual demand to replay",
        "Both policies replayed day by day on the same demand and lead times")
    return rows, pl, dem, info


def last_turnaround(mv):
    """Scope of the last turnaround, found in the data rather than assumed.

    Turnaround-type orders appear in every month; the turnaround itself is the run of
    consecutive months where their issue lines exceed 3x the monthly median. The scope
    is every part issued on turnaround-type orders inside that window.
    """
    ta = mv[mv.order_type.isin(C.TURNAROUND_TYPES)]
    lines = ta.groupby(ta.posting_date.dt.to_period("M")).size()
    peak = lines[lines > 3 * lines.median()].index.sort_values()
    # keep the contiguous block around the busiest month
    top = lines.idxmax()
    block = [top]
    for step in (-1, 1):
        m = top + step
        while m in peak:
            block.append(m)
            m += step
    start, end = min(block).start_time, max(block).end_time.normalize()
    w = ta[(ta.posting_date >= start) & (ta.posting_date <= end)]
    scope = w.groupby("material_no").agg(tam_qty=("qty", "sum"), tam_lines=("qty", "size")).reset_index()
    total_window = mv[(mv.posting_date >= start) & (mv.posting_date <= end)].qty.sum()
    info = {"tam_start": str(start.date()), "tam_end": str(end.date()), "tam_parts": len(scope),
            "tam_units": int(scope.tam_qty.sum()), "tam_window_share": float(total_window / mv.qty.sum()),
            "tam_days": int((end - start).days) + 1}
    log("Movement Material", "Last turnaround window (turnaround-type issue lines > 3x monthly median)",
        f"{info['tam_start']} to {info['tam_end']}: {len(scope)} parts, {info['tam_units']:,} units; "
        f"{info['tam_window_share']:.0%} of all units issued in 17 months fell in this window",
        "Used as the scope for the next-turnaround readiness check")
    return scope, info


def identical_parts(mats):
    """Different material numbers that carry exactly the same description and unit."""
    key = mats.description.str.strip().str.upper() + "|" + mats.unit
    grp = mats.assign(key=key).groupby("key").material_no.apply(list)
    grp = grp[grp.map(len) > 1]
    pairs = [(a, b) for members in grp for a in members for b in members if a != b]
    twins = pd.DataFrame(pairs, columns=["material_no", "twin_material_no"])
    stock = mats.set_index("material_no").stock
    paradox = sum(1 for members in grp if (stock[members] == 0).any() and (stock[members] > 0).any())
    log("BoM", "Material numbers sharing an identical description and unit",
        f"{len(grp)} groups, {sum(map(len, grp))} materials; {paradox} groups have one number at zero stock while another holds stock",
        "Identical stock is used before buying; groups flagged for master-data review")
    return twins


# --------------------------------------------------------------------------- main

def main():
    print("Loading raw files from", C.RAW_DIR)
    fl = load_funcloc()
    mats, links = load_bom()
    mv = load_movement()
    notif = load_notif()
    mplan = load_mplan()
    po = load_prpo()

    linked = mv.order_no.isin(notif.order_no.dropna().astype("int64"))
    log("Movement Material", "Issue lines linked to a notification via Order", f"{linked.mean():.1%}",
        "Equipment link for the rest comes from BoM FuncLoc")
    log("Mitem & Mplan", "ABC Indicator equals FuncLoc criticality",
        bool((mplan.merge(fl, on="funcloc").pipe(lambda d: (d.abc_indicator == d.criticality).all()))),
        "FuncLoc criticality used as the single criticality source")

    # material criticality = most critical FuncLoc the part is installed on
    lk = links.merge(fl[["funcloc", "criticality"]], on="funcloc", how="left")
    lk["rank"] = lk.criticality.map(C.CRIT_RANK).fillna(1)
    inv = {v: k for k, v in C.CRIT_RANK.items()}
    crit = lk.groupby("material_no").agg(
        crit_rank=("rank", "max"), n_funcloc=("funcloc", "nunique"), installed_qty_total=("installed_qty", "sum"),
        n_funcloc_critical=("rank", lambda r: int((r >= 3).sum())))
    crit["criticality"] = crit.crit_rank.map(inv)

    # schedule + calibrated planned demand
    factor, raw_factor, n_der, n_both = calibrate_planned_factor(mplan, links, mats, mv, H_START, H_END)
    log("Mitem & Mplan", "Planned-task part usage factor (actual preventive issues / installed qty of due tasks)",
        f"raw {raw_factor:.3f}, {n_both}/{n_der} materials overlap", f"Factor {factor:.3f} applied (clipped 0.05-1.0)")
    horizon_end = AS_OF + pd.Timedelta(days=C.FORECAST_HORIZON_DAYS)
    plan = planned_events(mplan, links, mats, AS_OF, horizon_end, factor)
    plan = plan[plan.qty > 0]
    pmats = set(plan.material_no)

    # next due date for every plan item (for the maintenance view)
    mplan["next_due"] = [(occ[0] if (occ := occurrences(r.cycle_start, r.cycle_days, AS_OF, horizon_end)) else pd.NaT)
                         for r in mplan.itertuples()]
    mplan["due_12m"] = [len(occurrences(r.cycle_start, r.cycle_days, AS_OF, horizon_end)) for r in mplan.itertuples()]

    rate = funcloc_failure_rates(fl, notif, pd.Timestamp(C.FAILURE_RATE_START), H_END)
    fl["failure_rate_yr"] = fl.funcloc.map(rate) * 365
    fl["notif_count"] = fl.funcloc.map(notif.groupby("funcloc").size()).fillna(0).astype(int)
    fl["mplan_items"] = fl.funcloc.map(mplan.groupby("funcloc").size()).fillna(0).astype(int)
    fl["bom_materials"] = fl.funcloc.map(links.groupby("funcloc").size()).fillna(0).astype(int)

    print("Demand model ...")
    kappa_new, n_emerged, n_zero = estimate_emergence(links, mv, rate, H_START, pd.Timestamp(C.EMERGENCE_SPLIT),
                                                      H_END, pmats)
    log("Movement Material", "Parts unused before the split that got a first demand after it",
        f"{n_emerged} of {n_zero} (split {C.EMERGENCE_SPLIT})", "Sets the demand prior for never-used parts")
    feat, events, kappa = demand_model(mats, links, mv, rate, H_START, H_END, AS_OF, pmats, kappa_new)
    dcls = demand_class(mats, mv, H_START, H_END)
    ltf = lead_time_features(mats, po)
    prf = price_features(mats, po)
    sup, supm = supplier_features(mats, po)

    hist = mv.groupby("material_no").agg(
        hist_qty_total=("qty", "sum"), hist_lines=("qty", "size"),
        first_issue=("posting_date", "min"), last_issue=("posting_date", "max"))
    by_type = mv.pivot_table(index="material_no", columns="order_type", values="qty", aggfunc="sum", fill_value=0)
    hist["hist_qty_turnaround"] = by_type.get("Turnaround", 0)
    hist["hist_qty_preventive"] = by_type.get("Preventive", 0)
    open_po = po[po.is_open == 1].groupby("material_no").agg(on_order_qty=("qty", "sum"),
                                                           next_delivery=("po_delivery_date", "min"))
    p12 = plan.groupby("material_no").qty.sum().rename("planned_qty_12m")
    pnext = plan.groupby("material_no").due_date.min().rename("next_planned_date")

    m = (mats.set_index("material_no")
         .join(crit[["criticality", "crit_rank", "n_funcloc", "n_funcloc_critical", "installed_qty_total"]])
         .join(prf).join(ltf).join(supm).join(open_po).join(hist).join(dcls)
         .join(feat[["n_events", "abnormal_events", "exposure", "prior_rate", "obs_rate", "credibility",
                     "occ_rate", "size_mean", "size_var", "mu_day", "var_day"]])
         .join(p12).join(pnext))
    m["criticality"] = m.criticality.fillna(C.LOWEST_CRIT)
    m["on_order_qty"] = m.on_order_qty.fillna(0)
    m["planned_qty_12m"] = m.planned_qty_12m.fillna(0)
    m["hist_qty_total"] = m.hist_qty_total.fillna(0)
    m["hist_lines"] = m.hist_lines.fillna(0)
    m["days_since_last_issue"] = (AS_OF - m.last_issue).dt.days
    m["forecast_12m"] = m.mu_day * 365 + m.planned_qty_12m
    m["stock_value_idr"] = m.stock * m.price_idr
    m["forecast_method"] = np.select(
        [m.n_events >= 6, m.n_events >= 1],
        ["Recency-weighted compound Poisson (own history)", "Credibility blend: own history + installed-base prior"],
        "Installed-base failure prior (no history)")
    m = m.reset_index()

    print("ML early warning ...")
    import ml_model
    static = pd.DataFrame({
        "material_no": m.material_no, "n_funcloc": m.n_funcloc, "installed_qty": m.installed_qty_total,
        "n_funcloc_critical": m.n_funcloc_critical, "crit_rank": m.crit_rank,
        "stock_item": (m.mrp_type == "Stock Item").astype(int), "log_price": np.log10(m.price_idr.clip(lower=1)),
        "lt_mean": m.lt_mean})
    mats_cat = mats[["material_no", "category"]]

    def planned_fn(lo, hi):
        return planned_events(mplan, links, mats, lo, hi, factor)

    def stat_prob_fn(t, ids):
        t = pd.Timestamp(t)
        prev = t - pd.Timedelta(days=1)
        r = funcloc_failure_rates(fl, notif, pd.Timestamp(C.FAILURE_RATE_START), prev)
        pm = set(planned_fn(t, t + pd.Timedelta(days=365)).material_no)
        kn, *_ = estimate_emergence(links, mv, r, H_START, t - pd.Timedelta(days=120), prev, pm)
        f, _, _ = demand_model(mats, links, mv, r, H_START, prev, t, pm, kn)
        jobs = planned_fn(t, t + pd.Timedelta(days=ml_model.HORIZON)).groupby("material_no").size()
        lam = f.occ_rate.reindex(ids).fillna(0).values * ml_model.HORIZON + jobs.reindex(ids).fillna(0).values
        return 1 - np.exp(-lam)

    ml_now, ml_metrics, ml_calib, ml_imp, ml_info = ml_model.run(mats_cat, static, links, mv, notif, po, planned_fn, stat_prob_fn)
    m = m.merge(ml_now[["material_no", "p_demand_90d"]], on="material_no", how="left")
    ml_row = ml_metrics[ml_metrics.model.str.startswith("ML")].iloc[0]
    log("ML early warning", "Out-of-time AUC / top-decile precision",
        f"{ml_row.auc:.3f} / {ml_row.top_decile_precision:.1%} (base rate {ml_row.base_rate:.1%})",
        f"Trained on {ml_info['train_rows']:,} part-months, tested on {ml_info['test_rows']:,}")

    # monthly forecast table
    months = pd.period_range(AS_OF, horizon_end - pd.Timedelta(days=1), freq="M")
    pm = plan.assign(ym=plan.due_date.dt.to_period("M")).groupby(["material_no", "ym"]).qty.sum()
    fc = []
    for r in m[["material_no", "mu_day", "var_day"]].itertuples(index=False):
        for ym in months:
            d = ym.days_in_month
            un = r.mu_day * d
            pl = float(pm.get((r.material_no, ym), 0.0))
            sd = math.sqrt(max(r.var_day, 0) * d)
            fc.append((r.material_no, str(ym), un, pl, un + pl, max(0.0, un + pl - 1.2816 * sd), un + pl + 1.2816 * sd))
    fc = pd.DataFrame(fc, columns=["material_no", "month", "unplanned", "planned", "total", "p10", "p90"])

    # monthly history per material, split by demand source
    mv["month"] = mv.posting_date.dt.strftime("%Y-%m")
    src = np.select([mv.order_type.isin(C.TURNAROUND_TYPES), mv.order_type.isin(C.PLANNED_TYPES)],
                    ["turnaround", "preventive"], "unplanned")
    cm = mv.assign(src=src).pivot_table(index=["material_no", "month"], columns="src", values="qty",
                                        aggfunc="sum", fill_value=0).reset_index()
    for c in ["turnaround", "preventive", "unplanned"]:
        if c not in cm:
            cm[c] = 0
    cmt = mv.groupby(["month", "order_type"]).agg(lines=("qty", "size"), qty=("qty", "sum")).reset_index()

    print("Backtest ...")
    bt, new_in_test = backtest(mats, links, mv, notif, fl, mplan)
    print(bt.to_string())

    tam_scope, tam_info = last_turnaround(mv)

    print("Replay inputs ...")
    rp_rows, rp_plan, rp_dem, rp_info = replay_inputs(mats, crit, links, mv, notif, fl, mplan, po)
    twins = identical_parts(mats)

    # Is there a price premium when buying at short notice? Compare each PO line to its part's median price.
    req_days = (po.pr_delivery_date - po.pr_date).dt.days
    rel = po.unit_price_idr / po.groupby("material_no").unit_price_idr.transform("median")
    enough = po.groupby("material_no").unit_price_idr.transform("size") >= 3
    rush = rel[(req_days <= 14) & enough]
    rush_ratio, rush_n = float(rush.median()), int(len(rush))
    log("PR PO", "Unit price of short-notice PRs (requested <= 14 days) vs the part's median price",
        f"ratio {rush_ratio:.3f} over {rush_n:,} lines", "No rush premium in the data: default emergency premium 0%")

    assumptions = [
        ("Planning", "As-of date", C.AS_OF, "Data ends 30 Sep 2026"),
        ("Planning", "Forecast horizon", f"{C.FORECAST_HORIZON_DAYS} days", ""),
        ("Demand", "Order type by order-number prefix", "; ".join(f"{k}={v}" for k, v in C.ORDER_TYPES.items()),
         "Not confirmed by organizers"),
        ("Demand", "Turnaround issues", "Excluded from baseline, shown as event demand", ""),
        ("Demand", "Recency half-life", f"{C.RECENCY_HALF_LIFE_DAYS} days", "Recent demand weighs more"),
        ("Demand", "Installed-base prior calibration (kappa)", f"{kappa:.4f}",
         "Scales FuncLoc failure rates so total prior events match observed events"),
        ("Demand", "Credibility constant", f"{C.CREDIBILITY_K}", "Events needed before history outweighs prior"),
        ("Demand", "First-demand rate for never-used parts", f"{kappa_new:.5f} per exposure-day",
         f"{n_emerged} of {n_zero} parts unused before {C.EMERGENCE_SPLIT} were demanded after it"),
        ("Demand", "Failure-rate window", f"{C.FAILURE_RATE_START} to {C.HISTORY_END}", "May 2025 backlog spike excluded"),
        ("Maintenance plan", "Part-consuming tasks",
         "; ".join(f"{p} -> {', '.join(sorted(c))}" for _, p, c in C.TASK_PART_RULES),
         "Inspection/calibration/test consume none"),
        ("Maintenance plan", "Planned-task usage factor", f"{factor:.3f}", "Calibrated from preventive-order history"),
        ("Procurement", "PO-Item Amount", "Unit price", "Confirmed by organizers"),
        ("Procurement", "Lead time", "PO delivery date - PR date", "Blended with category when < 3 POs"),
        ("Procurement", "Expedited (emergency) delivery time", "10th percentile lead time of the part's category",
         "Fastest deliveries actually observed; = downtime days when a stockout stops production"),
        ("Procurement", "Emergency price premium", f"0% (short-notice price ratio {rush_ratio:.3f})",
         f"Measured on {rush_n:,} PO lines requested within 14 days"),
        ("Procurement", "FX rates to IDR", "; ".join(f"{k}={v:g}" for k, v in C.FX_TO_IDR.items() if k != "IDR"), ""),
        ("Procurement", "PR type meaning", "; ".join(f"{k}={v}" for k, v in C.PR_TYPE_LABELS.items()), "Not confirmed"),
        ("Criticality", "Ranking", "A > B > C > S", "Confirmed by the team; critical = A/B; a material takes the most critical FuncLoc it is installed on"),
    ]
    meta = {
        "as_of": C.AS_OF, "history_start": C.HISTORY_START, "history_end": C.HISTORY_END,
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "materials": len(m), "funclocs": len(fl), "movements": len(mv), "notifications": len(notif),
        "mplan_items": len(mplan), "po_lines": len(po), "planned_events_12m": len(plan),
        "planned_factor": factor, "kappa": kappa, "kappa_new": kappa_new, "backtest_new_materials": new_in_test,
        "ml_train_rows": ml_info["train_rows"], "ml_test_rows": ml_info["test_rows"], "ml_origins": ml_info["origins"],
        "ml_train_window": ml_info["train_window"], "ml_test_window": ml_info["test_window"],
        "rush_price_ratio": rush_ratio, "rush_price_lines": rush_n, **rp_info,
        **tam_info,
    }

    print("Writing", C.DB_PATH)
    C.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    if C.DB_PATH.exists():
        C.DB_PATH.unlink()
    con = sqlite3.connect(C.DB_PATH)
    con.execute("PRAGMA temp_store = MEMORY")  # keep SQLite temp files off the (small) system drive

    def put(df, name, dates=()):
        df = df.copy()
        for c in df.columns:
            if pd.api.types.is_datetime64_any_dtype(df[c]):
                df[c] = df[c].dt.strftime("%Y-%m-%d")
        df.to_sql(name, con, index=False)

    put(m, "material")
    put(links, "material_funcloc")
    put(fl, "funcloc")
    put(mv.drop(columns=["month"]), "movement")
    put(events[["material_no", "posting_date", "qty", "threshold", "abnormal"]].replace([np.inf], None),
        "demand_event")
    put(notif, "notification")
    put(mplan, "mplan_item")
    put(plan[["material_no", "funcloc", "item_no", "task", "task_category", "due_date", "installed_qty", "qty"]],
        "planned_demand")
    put(po, "po_line")
    put(sup, "supplier")
    put(fc, "forecast_monthly")
    put(cm, "consumption_monthly")
    put(cmt, "consumption_by_type")
    put(bt, "backtest")
    put(ml_metrics, "ml_metrics")
    put(ml_calib, "ml_calibration")
    put(ml_imp, "ml_importance")
    put(ml_now, "ml_features")
    put(rp_rows, "replay_material")
    put(rp_plan, "replay_planned")
    put(rp_dem, "replay_demand")
    put(twins, "material_twin")
    put(tam_scope, "tam_scope")
    put(pd.DataFrame(quality), "data_quality")
    put(pd.DataFrame(assumptions, columns=["area", "name", "value", "note"]), "assumption")
    put(pd.DataFrame([(k, str(v)) for k, v in meta.items()], columns=["key", "value"]), "meta")
    for t, c in [("material_funcloc", "material_no"), ("material_funcloc", "funcloc"), ("movement", "material_no"),
                 ("movement", "order_no"), ("demand_event", "material_no"), ("notification", "funcloc"),
                 ("mplan_item", "funcloc"), ("planned_demand", "material_no"), ("po_line", "material_no"),
                 ("forecast_monthly", "material_no"), ("consumption_monthly", "material_no"),
                 ("replay_planned", "material_no"), ("replay_demand", "material_no"), ("material_twin", "material_no")]:
        con.execute(f"CREATE INDEX idx_{t}_{c} ON {t}({c})")
    con.execute("CREATE UNIQUE INDEX idx_material_pk ON material(material_no)")
    con.execute("CREATE UNIQUE INDEX idx_funcloc_pk ON funcloc(funcloc)")
    con.commit()
    con.execute("VACUUM")
    con.close()
    print(f"Done. {C.DB_PATH.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
