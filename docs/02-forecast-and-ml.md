# 02 · Demand Forecast and ML Early Warning

Code: `pipeline/build_db.py` (forecast, backtest) and `pipeline/ml_model.py` (ML early warning).

## Idea: forecast demand by its cause

Spare-part demand is not one thing. Sparely splits it into:

1. **Planned maintenance** — certain, taken from the maintenance schedule.
2. **Failures** — probabilistic, estimated from the part's own history and the equipment it is installed on.
3. **Turnaround** — a one-off spike, kept out of the baseline so it does not inflate normal forecasts.

## 1. Turnaround separation

Turnaround-type orders appear in every month, so the turnaround window is detected from the data: consecutive months where turnaround issue lines exceed 3× their monthly median. Result: **1 Nov 2025 – 31 Jan 2026** (92 days, 360 parts). Turnaround issues are removed from the baseline and used for the *TAM reserve* status and next-turnaround readiness.

## 2. Demand classification (Syntetos–Boylan)

```text
ADI = months / months with demand        (average gap between demands)
CV² = (std / mean)² of non-zero demand    (size variability)
Smooth: ADI < 1.32, CV² < 0.49 · Erratic: ADI < 1.32, CV² ≥ 0.49
Intermittent: ADI ≥ 1.32, CV² < 0.49 · Lumpy: ADI ≥ 1.32, CV² ≥ 0.49
```

| Pattern | Parts |
| --- | --- |
| No demand | 5,625 |
| Single issue | 1,170 |
| Intermittent | 433 |
| Lumpy | 121 |
| Erratic | 88 |
| Smooth | 44 |

## 3. Abnormal consumption

```text
z = 0.6745 × (x − median) / MAD
abnormal if z > 3.5 and x > 2 × median (at least 4 events; if MAD = 0, threshold 3 × median)
abnormal values are capped before forecasting
```

## 4. Failure-driven demand: compound Poisson + installed base

1. **Recency weighting** — newer data counts more: `w(t) = 0.5 ^ ((today − t) / 180)`; `λ_obs` = weighted share of days with demand.
2. **Equipment failure rate** — per FuncLoc from notifications, smoothed towards its equipment-class mean so a FuncLoc without notifications is not zero: `f_FL = (n_notif + m₀ × r_class) / (T + m₀)`, `m₀ = 365 days`. Exposure `E` = sum of `f_FL` over every FuncLoc the part is installed on.
3. **Installed-base prior** — `λ_prior = κ × E` with `κ = 0.4294` (calibrated so total prior events equal observed events). Never-used parts: `κ_new = 0.04092` per exposure-day, measured from 267 parts unused before May 2026 that were demanded afterwards.
4. **Credibility blend** — `c = n / (n + 2)`, `λ = c × λ_obs + (1 − c) × λ_prior`. More own history → more trust in it.
5. **Units** — `μ = λ × z` (mean units per day), `σ²_day = λ × (z² + s²)`.

## 5. Planned demand from the maintenance plan

The maintenance plan does not list parts, so jobs are mapped: job → FuncLoc → BoM parts replaced by that job type (e.g. pump overhaul → bearing, seal, gasket, O-ring, sleeve, ring, impeller, coupling, studbolt; lube oil change → oil; re-greasing → grease). Inspection, calibration and tests consume no parts.

```text
qty = installed_qty × usage_factor
usage_factor = actual preventive issues / derived requirements = 0.716 (calibrated, clipped 0.05–1)
```

In the next 12 months there are 826 planned requirements for 506 parts.

## 6. Monthly forecast

```text
forecast_month = μ × days_in_month + planned_demand_month
80% range = forecast ± 1.2816 × √(σ²_day × days)
```

## 7. Backtest

Trained on May 2025 – Apr 2026, tested on May – Sep 2026 (never seen in training).

| Method | WAPE | Bias | AUC |
| --- | --- | --- | --- |
| Static average (current practice) | 1.336 | +115.0% | 0.769 |
| Croston SBA (classical intermittent) | 0.963 | +57.7% | 0.763 |
| **Sparely hybrid model** | 0.998 | **+9.5%** | **0.778** |

The static method over-forecasts by 115%, which is what fills the warehouse. Sparely's bias is 10% and it ranks parts best. Its WAPE matches Croston; for data this intermittent, total demand over the lead time (bias) matters more for stock than month-by-month error.

---

## ML early warning

**Question:** *will this part be needed in the next 90 days?* The forecast says how much; the early warning says which parts to watch now.

### Training

- Part × monthly snapshot (12 snapshots, Aug 2025 – Jul 2026). Features use only data before each snapshot; label = issued (excluding turnaround) in the next 90 days.
- Train: 59,848 rows (snapshots Aug 2025 – Mar 2026). Out-of-time test: 14,962 rows (Jun – Jul 2026). Training labels end before the test period begins — no leakage.
- Model: `HistGradientBoostingClassifier` (scikit-learn), 300 iterations, learning rate 0.05, 31 leaves, L2 1.0. After testing, retrained on all snapshots and scored for every part as of 1 Oct 2026.

### Features (20)

| Group | Features |
| --- | --- |
| Part history | Issue days in 90 / 180 days and all history, units in 365 days, days since last issue, history length |
| Equipment | FuncLocs installed on, A/B FuncLocs, installed quantity, criticality, failure notifications 90 days and all history |
| Schedule | Planned jobs and units in the next 90 days |
| Purchasing | PRs in 180 days, open PO quantity, mean lead time, log price, Stock Item flag |
| Category | Share of same-category parts issued in the last 180 days |

### Results (out-of-time)

| Model | AUC | Avg precision | Brier | Precision top 10% |
| --- | --- | --- | --- | --- |
| Rule: issued in last 180 days | 0.789 | 0.551 | – | 41.9% |
| Statistical demand model | 0.826 | 0.588 | 0.056 | 45.7% |
| **ML early warning** | **0.895** | **0.672** | **0.036** | **47.6%** |

Only 7.1% of parts are needed in 90 days on average; of the top 10% scores, 48% are needed (6.7× better than random). The model is calibrated (scores of 70–100% → 94% actually needed). The **30% warning threshold** was chosen from the data: parts at or above it were needed **74%** of the time.

**Top drivers (permutation importance):** number of FuncLocs installed on, log unit price, PRs in the last 180 days, mean lead time, share of the category issued recently.

**Used for:** the *ML early warnings* list in the Maintenance workspace (parts likely needed but with no stock and no PO); parts with a warning are not treated as mere insurance candidates.
