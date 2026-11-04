# Sparely — Spare Part Intelligence & Inventory Optimization

<div align="center">

*Just enough, just in time.*

<br>

<img src="public/sparely-logo.png" alt="Sparely" width="60%" />

<br><br>

**[Live Demo](https://sparely-caliber2026.vercel.app)** · **[AI Research Repository](https://github.com/narazla/sparepart-optimizer)** · **[Documentation](docs/)**

</div>

<br>

Sparely is a web platform for maintenance, inventory, procurement and management teams at a petrochemical plant. It reads six SAP-style extracts, forecasts every spare part's demand by its cause (planned maintenance, equipment failure, turnaround), warns early which parts will be needed with a machine-learning model, and recalculates each part's Min, Max and safety stock by weighing holding cost against downtime risk. The result is not a dashboard but a worklist: one decision per part (reorder, transfer, reduce, monitor or maintain) that flows from the planner to procurement to management.

> *"Most tools forecast what you used. Sparely prepares you for what's coming — and proves it."*

### Design principles

- **Measure first, assume last.** Every number that can be measured from the data is measured from the data. Assumptions are only used for what the data cannot tell, are listed openly, can be changed in the app, and are stress-tested.
- **Safety is a rule, not a cost.** Parts that protect safety and shutdown valves are never left without a spare, whatever the cost model says.
- **Every decision is accountable.** Recommendations come with numbered reasons, large decisions need management sign-off, and every approval is written to a decision log.
- **Proven, not promised.** The policy is rebuilt from past data only and replayed against demand it never saw.

---

## Background

> **36%** of all spare parts issued in 17 months were consumed in a single 3-month turnaround window.
> **578 of 1,040** safety and shutdown valve locations are ranked at the *lowest* criticality.
> **60%** of purchase orders arrive after the requested date, and every part has only one supplier.

This project answers **CALIBER 2026 Final Case 3 — Spare Part Intelligence & Inventory Optimization**. When a shutdown happens, the critical part is out of stock, while slow-moving parts sit on the shelf. Stock is planned reactively with static Min–Max levels that ignore what really drives demand. The result is emergency buying, tied-up working capital and longer downtime.

The baseline data (dummy SAP extracts from an ethylene cracker) shows four gaps:

1. **Demand is unpredictable with averages.** Only 44 parts follow a regular pattern; 1,170 were issued in a single month and 5,625 never moved. Static Min–Max overestimates demand by 115%.
2. **Turnaround demand is mixed with routine demand.** One turnaround spike inflates every forecast that follows it.
3. **Criticality alone misses safety.** Most safety valve locations are ranked S, so a cost-only model would let their spares run out.
4. **Master data hides stock.** 597 material numbers describe only 133 parts; in 66 groups one number shows zero stock while a twin holds stock.

Equipment criticality runs **A > B > C > S** (A is the most critical, confirmed by the organisers). "Critical" in the app means A or B, plus every safety-critical element.

---

## Key Features

### 1. Demand Forecast by Cause
Demand is split into **planned maintenance** (from the maintenance plan, mapped to the parts each job replaces), **failure-driven demand** (recency-weighted compound Poisson, blended with an installed-base prior from equipment failure rates) and **turnaround demand** (detected from the data and kept out of the baseline). Parts that were never used still get a forecast from the equipment they are installed on.

### 2. ML Early Warning
A gradient-boosting classifier predicts which parts will be needed in the next 90 days. It is trained on monthly snapshots with features built only from data before each snapshot, and tested out-of-time.

### 3. Cost–Risk Optimization per Part
For every part, Sparely tries nine service levels, computes **holding + ordering + downtime-risk cost**, and picks the cheapest, including the option of not stocking at all. The probability that a stockout stops production is **calibrated to the Emergency notifications observed in the data**.

### 4. Identical Stock First
Before buying, Sparely checks whether a twin material number with the same description and unit holds stock above its own reorder point, and recommends a **Transfer** instead.

### 5. Turnaround Readiness
The last turnaround scope (360 parts) is detected from the data. The planner picks the next turnaround date; Sparely shows which parts will be short on day one and the latest order date for each.

### 6. Safety & Governance Guardrails
**Safety-Critical Elements** (parts on safety and shutdown valves) are always risk-rated as class A with at least one spare. **Long-lead** parts get a warning. Buys and reductions above Rp 1 billion, and any reduction of a safety-critical part, need **management sign-off**, and every decision is recorded in an **audit trail**.

### 7. Role-Based Workflow
Four workspaces hand work to each other, from recommendation to a purchase-requisition draft. There is no login: the prototype demonstrates the flow, not access control.

| Workspace | Who | Does | Hands off to |
| --- | --- | --- | --- |
| Maintenance & Reliability | Maintenance planner, reliability engineer | Checks part readiness for jobs due in 90 days, requests short parts, checks turnaround readiness, acts on ML warnings, decides insurance spares | Procurement |
| Inventory Planner | Inventory / MRP controller | Uses identical stock first, approves reorders, new Min–Max and excess reductions | Procurement, Management |
| Procurement | Buyer | Gets a PR draft (PR type, purchasing group, supplier from history), expedites open POs | ERP (CSV) |
| Management | Plant / supply-chain manager | Signs off large buys and safety-critical reductions, reviews the decision log, decision impact and replay proof, sets the cost–risk scenario | All workspaces |

```text
Maintenance  →  Inventory Planner  →  Procurement  →  Management
 readiness      approve / transfer      PR draft       sign-off, impact, policy
```

---

## Results

All results come from the organisers' dummy baseline data (snapshot 1 Oct 2026).

**Warehouse replay.** The Sparely policy is rebuilt from data before **1 May 2026** only. Actual demand from May to September 2026 is then replayed day by day through two virtual warehouses with the same lead times and safety rules: one runs today's static Min–Max, the other the Sparely policy.

| Metric | Current Min–Max | Sparely | Change |
| --- | --- | --- | --- |
| Demand days fully served | 68.6% | 93.1% | +24.5 pts |
| Stockout events | 952 | 209 | **−78%** |
| Stockouts on critical parts (A/B) | 878 | 127 | **−86%** |
| Average stock value held | Rp 986.4 bn | Rp 455.9 bn | **−54%** |

**Forecast backtest** (train May 2025 – Apr 2026, test May – Sep 2026):

| Method | WAPE | Bias | AUC |
| --- | --- | --- | --- |
| Static average (current practice) | 1.336 | +115.0% | 0.769 |
| Croston SBA (classical intermittent) | 0.963 | +57.7% | 0.763 |
| **Sparely hybrid model** | 0.998 | **+9.5%** | **0.778** |

**ML early warning** (out-of-time test): AUC **0.895**; parts scored at or above the 30% warning threshold were actually needed **74%** of the time, against a 7.1% base rate.

**Other impact:** Rp 573.3 bn of excess stock can be released (PO prices only); 77 needs covered by identical stock (Rp 2.2 bn not bought); 860 safety-critical parts protected; 265 Non Stock parts recommended to become Stock Items.

> Replay results compare two policies from their own starting points, because historical stock levels are not in the data. Stockouts are simulated, not observed. Full details: [docs/03-optimization-engine.md](docs/03-optimization-engine.md).

---

## How the Numbers Are Calculated

The machine-learning model ranks which parts to watch. **Every number behind a stocking decision comes from a formula that can be checked** in `src/lib/engine.ts`.

| Calculation | Formula |
| --- | --- |
| Failure-driven demand rate | `λ = c × λ_observed + (1 − c) × κ × E`, with credibility `c = n / (n + 2)` and installed-base exposure `E` |
| Daily demand | `μ = λ × z` (z = mean quantity per issue) |
| Lead-time demand | `μ_L = μ × L + planned demand within L` |
| Reorder point (Min) | `ROP = μ_L + Φ⁻¹(SL) × σ_L` (Poisson quantile for slow movers) |
| Safety stock | `SS = ROP − μ_L` |
| Order quantity | `Q = √(2 × D × K / (h × P))`, bounded between one month and one year of demand |
| Max | `Max = ROP + Q` |
| Total cost per service level | `h × P × (SS + Q/2) + K × D / Q + stockouts/year × p_downtime × C_day × T_emergency` |
| Downtime probability calibration | Today's Min–Max must reproduce the 98.9 Emergency notifications per year in the data → A 1.07%, B 0.53%, C 0.16%, S 0.05% |

---

## AI Models

| Model | Purpose | Method | Validation |
| --- | --- | --- | --- |
| Demand forecast | How much each part will need | Cause-based hybrid: planned maintenance + recency-weighted compound Poisson + installed-base prior + turnaround separation | Backtest on May–Sep 2026 vs static average and Croston SBA |
| ML early warning | Which parts will be needed in 90 days | `HistGradientBoostingClassifier` (scikit-learn), 20 features on part history, equipment, maintenance schedule, purchasing and category | Out-of-time test on 14,962 part-months; AUC 0.895, calibrated |
| Abnormal-use detection | Remove spikes before forecasting | Robust z-score (MAD) | Logged in data quality |

Training runs offline in `pipeline/` and writes results to `data/caliber.db`. The app reads the database and runs the optimization engine on every request. Full details: [docs/02-forecast-and-ml.md](docs/02-forecast-and-ml.md).

**AI research repository:** early data and model experiments by our AI engineer (data cleaning, duplicate-material detection, lead-time quantile models, demand classification) are kept in **[sparepart-optimizer](https://github.com/narazla/sparepart-optimizer)**. The final numbers shown in the app and the deck come from **this** repository (Sparely), not from the research repository.

> **Note:** the baseline data is dummy SAP data from the organisers. Models are not yet validated on real plant data; validation is part of the pilot.

---

## Safety & Governance

| Principle | What is implemented |
| --- | --- |
| Process safety | Parts on `PRV-` (safety valve) and `SDV-` (shutdown valve) locations are Safety-Critical Elements: class-A risk, at least one spare, never marked potentially obsolete |
| Delegation of authority | Buys or reductions above Rp 1 billion, and any reduction of a safety-critical part, go to *Pending approval* and need management sign-off |
| Audit trail | Every approve, reject, undo and sign-off is logged with role, time, quantity, value and reason; exportable as CSV |
| Human in the loop | Sparely recommends; people approve. Nothing is written to the ERP automatically |
| Explainability | Every recommendation carries numbered reasons (forecast, lead time, service level, risk, twins, ML warning) |
| Transparent assumptions | All assumptions are listed on the Data & Method page with a live sensitivity table (halving or doubling them changes at most ~5% of actions) |
| Master-data governance | A worklist for the SAP team: duplicate numbers, Non Stock parts that should be stocked, Stock Items that should not, Non Stock parts holding stock |

Full details: [docs/04-safety-and-governance.md](docs/04-safety-and-governance.md).

---

## Documentation

| Document | Content |
| --- | --- |
| [01 · Data and Cleaning](docs/01-data-and-cleaning.md) | The six files, how they connect, data facts, every data-quality check |
| [02 · Forecast and ML](docs/02-forecast-and-ml.md) | Demand by cause, installed-base prior, backtest, ML early warning |
| [03 · Optimization Engine](docs/03-optimization-engine.md) | Cost–risk optimization, downtime calibration, actions, health status, turnaround readiness, replay |
| [04 · Safety and Governance](docs/04-safety-and-governance.md) | SCE, long-lead, sign-off, decision log, master-data worklist, sensitivity |
| [05 · Demo Script](docs/05-demo-script.md) | Four-minute demo flow, firebrick walk-through, likely jury questions |

---

## Tech Stack

| Layer | Technology |
| --- | --- |
| Data pipeline & ML | Python, pandas, NumPy, openpyxl, scikit-learn |
| Database | SQLite (`data/caliber.db`, 26 tables) |
| Web app | Next.js 15 (App Router), React 19, TypeScript |
| Database access | better-sqlite3 (read-only) |
| UI | Tailwind CSS 4, Recharts, lucide-react |
| Hosting | Vercel (Node 22) |

```text
6 SAP extracts (xlsx)
      │  pipeline/build_db.py · pipeline/ml_model.py
      ▼   clean → link → demand features → forecast → backtest → ML early warning
data/caliber.db (SQLite, 26 tables)
      │  better-sqlite3 (read-only)
      ▼
src/lib/engine.ts · rules.ts · replay.ts · workflow.ts   (all parts re-optimize in well under a second)
      │
      ▼
Next.js workspaces + JSON API  →  Vercel
```

---

## Project Structure

```text
sparely/
├── pipeline/
│   ├── config.py          # every pipeline assumption
│   ├── build_db.py        # cleaning, linking, forecast, backtest, turnaround, identical parts
│   └── ml_model.py        # ML early warning
├── data/
│   └── caliber.db         # SQLite database
├── docs/                  # detailed documentation
├── src/
│   ├── lib/
│   │   ├── engine.ts      # stock optimization and action rules
│   │   ├── rules.ts       # safety & governance rules (SCE, long-lead, sign-off)
│   │   ├── replay.ts      # warehouse replay
│   │   ├── workflow.ts    # readiness, PR draft, impact, master-data list
│   │   └── params.ts      # default business assumptions
│   ├── app/               # pages and API routes
│   └── components/        # UI, charts, decision storage
├── scripts/               # engine sanity check, submission zip
└── raw-data/              # organiser Excel files (submission zip only)
```

---

## Run Locally

### Prerequisites

1. **Node.js 22+**
2. **Python 3.11+** (only to rebuild the database)

### Install and run

```bash
git clone https://github.com/narazla/Sparely
cd Sparely

# (optional) rebuild the database from the raw Excel files
pip install -r pipeline/requirements.txt
npm run build:data          # writes data/caliber.db

# web app
npm install
npm run dev                 # http://localhost:3000
```

The SQLite database is committed in `data/caliber.db`, so the rebuild step is only needed after changing the data or `pipeline/config.py`.

### Deploy to Vercel

**Live MVP:** https://sparely-caliber2026.vercel.app (production deployment of 4 Nov 2026)

```bash
npx vercel login
npx vercel --prod
```

`next.config.ts` ships `data/caliber.db` with every serverless function and keeps `better-sqlite3` as an external native module.

---

## JSON API

| Endpoint | Description |
| --- | --- |
| `GET /api/summary` | Portfolio KPIs, health and action counts, safety and governance counts |
| `GET /api/recommendations?action=&health=&crit=A,B&tag=sce\|longlead\|signoff&q=&sort=&limit=` | Per-part recommendations (`&format=csv` to export) |
| `GET /api/materials/{materialNo}` | Full detail, forecast, cost curve |
| `GET /api/forecast` | Aggregate forecast, demand classes, backtest |
| `POST /api/scenario` | Re-optimize every part for a cost–risk scenario |
| `POST /api/pr-draft` | Purchase-requisition lines from approved buys |
| `POST /api/impact` | Spend committed, transfers, capital released, downtime risk removed, decisions awaiting sign-off |
| `GET /api/replay` | May–Sep 2026 warehouse replay |
| `GET /api/data-quality` | Data-quality checks, assumptions, calibration |
| `GET /api/master-data` | Master-data worklist (`?format=csv` for every row) |

---

## Roadmap

| Phase | Focus |
| --- | --- |
| 1. Pilot | One unit (e.g. the cracker): prove fewer critical stockouts and capital released |
| 2. Plant-wide | All units, integrated with turnaround planning |
| 3. ERP integration | Write PR drafts and Min–Max changes back to SAP; role-based login |
| 4. Multi-site & cold start | Share critical spares across sites; initial stock for new plants from the installed-base prior |

**Proposed additional data:** maintenance task lists (SAP PM), standard material prices (SAP MM), production value per hour, stock and reservation history, approved vendor lists, functional-location hierarchy, and the official SCE register.

---

## Known Limitations

- The baseline data is **dummy**; some values are unrealistic (e.g. hundreds of governor valves in stock).
- Historical stock levels and unmet demand are not recorded, so replay stockouts are **simulated**.
- The maintenance plan does not list parts; planned demand is derived from the BoM with a calibrated usage factor (0.716).
- 6,231 parts have no PO price; their prices are category estimates and labelled as such. Use PO-price figures (Rp 627.0 bn stock, Rp 573.3 bn excess) for rupiah claims.
- Every part has a single supplier, so supply risk can be flagged but not re-routed.
- The SCE list is derived from functional-location tags, not an official SCE register; the one-spare minimum is a starting rule.
- Order-type prefixes, PR-type labels, FX rates, production loss per downtime day, holding-cost rate and cost per PO are assumptions not confirmed by the organisers; the effect of the last three is shown in the sensitivity table.
- No login in the prototype; decisions and the decision log are stored in the browser (a shared database in the pilot).

---

## Team

<table>
<tr>
<td align="center" width="33%">
<img src="https://drive.google.com/uc?export=view&id=1rPzNkUuXtFebZFcrLa7c-ZtZlSnxa0jX" width="144" height="180"/><br/>
<a href="https://github.com/narazla"><b>Nazla Azzahra Hermana</b></a><br/>
<i>Universitas Diponegoro</i>
</td>
<td align="center" width="33%">
<img src="https://drive.google.com/uc?export=view&id=17tsQGhSL0nE_PWdDJ9LUZegHQzS7W9eL" width="144" height="180"/><br/>
<b>Syahla Sandiani</b><br/>
<i>Universitas Diponegoro</i>
</td>
<td align="center" width="33%">
<img src="https://drive.google.com/uc?export=view&id=16NG99UA9v0ajBxlowiNahmoyUJe4Zr2S" width="144" height="180"/><br/>
<b>Helmi Abdulbaqi</b><br/>
<i>Universitas Diponegoro</i>
</td>
</tr>
</table>

---

Built for **CALIBER 2026 — Final Case 3: Spare Part Intelligence & Inventory Optimization**
