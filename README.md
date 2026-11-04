# Sparely — CALIBER 2026 Final Case

**Sparely** is spare part intelligence and inventory optimization.

Equipment criticality runs **A > B > C > S** (A is the most critical). "Critical" in the app means A or B, plus every safety-critical element (see below).

AI-powered spare part demand forecasting and dynamic inventory optimization.
The MVP turns six SAP-style baseline files into one decision per spare part (reorder, transfer, reduce, monitor or maintain), with dynamic Safety Stock, Reorder Point (Min) and Max, stockout and overstock risk, and cost–risk scenarios.

## User flow

The app opens on **Home**, which shows the end-to-end flow and a role picker. There is no login: the prototype demonstrates the flow, not access control. Each role has a workspace with a worklist:

| Workspace | Who | Does | Hands off to |
|---|---|---|---|
| Maintenance & Reliability | Maintenance planner, reliability engineer | Checks part readiness of jobs due in the next 90 days, requests short parts, checks next-turnaround readiness, acts on ML early warnings, decides insurance spares | Procurement |
| Inventory Planner | Inventory / MRP controller | Uses identical stock held under another material number first, then approves or adjusts reorders, dynamic Min–Max updates and excess reductions | Procurement, Management |
| Procurement | Buyer | Gets a PR draft (PR type, purchasing group and supplier taken from each part's PR PO history), expedites open POs | ERP |
| Management | Plant / supply-chain manager | Signs off large buys and safety-critical reductions, reads the decision log, tracks spend committed and capital released, sees the replay proof, sets the cost–risk policy | All workspaces |

Decisions are stored in the browser (localStorage), so the hosted SQLite database stays read-only. In production they would be written back to the ERP.

## What it does

| Brief requirement | Where in the app |
|---|---|
| Demand forecasting (history, failures, maintenance plan, installed base, shutdowns, abnormal use) | **Demand Forecast** page, per-part chart on each material page |
| Dynamic Min–Max, safety stock, reorder point, replenishment quantity | **Material List** and material page; Planner workspace |
| Inventory health: excess, slow-moving, non-moving, potentially obsolete | **Inventory Health** page |
| Reorder / maintain / reduce / monitor, balancing inventory cost vs stockout, downtime and production-loss risk | **Material List**, role workspaces |
| Equipment and part criticality, including process safety | Safety-critical and long-lead badges, Material List filter |
| Evidence that the policy works | **Management** workspace (replay) |
| Scenario simulation of raising or lowering inventory levels | **Cost–Risk Scenarios** page (live re-optimization of all 7,481 parts) |

## Architecture

```
Supporting Data (6 xlsx)
        │  pipeline/build_db.py + ml_model.py  (Python: pandas, numpy, scikit-learn)
        ▼   clean → link → demand features → forecast → backtest → ML early warning
data/caliber.db  (SQLite, 26 tables)
        │  better-sqlite3 (read-only)
        ▼
src/lib/engine.ts  — inventory optimization engine (runs on every request; all parts re-optimize in well under a second)
src/lib/rules.ts   — safety and governance rules (SCE tags, minimum spare, long-lead, sign-off limit)
        │
        ▼
Next.js 15 App Router (server-rendered pages + JSON API) → Vercel
```

### Data cleaning (pipeline/build_db.py)
- **PR PO:** 5,420 exact duplicate rows removed (47% of 11,609); 6,189 unique lines kept. `PO-Item Amount` is the unit price. 51 non-IDR lines are converted at fixed rates.
- **Movement Material:** 863 exact duplicate issue rows removed (2.3% of issued units).
- **BoM:** stock, Min and Max repeat on every FuncLoc row of a material, so they are counted once per material.
- **Lead time:** POs due before their PR, or more than 365 days after it, are kept as records but excluded from lead-time statistics.
- Every check and fix is in the `data_quality` table and on the **Data & Method** page.

### Demand model (pipeline/build_db.py)
1. **Demand split by cause.** Order-number prefix → order type. Turnaround issues are event demand and stay out of the baseline. Preventive demand is replaced by the maintenance-plan forecast where one exists.
2. **Failure-driven demand.** Each part's own issue history is recency-weighted (half-life 180 days) as a compound Poisson process. It is blended by credibility with an **installed-base prior**: the failure rate (Notif History) of every FuncLoc the part is installed on (BoM). Parts that were never used get a first-demand rate estimated from data, measured as how often previously unused parts got demanded.
3. **Abnormal consumption.** A robust z-score flags abnormal issue sizes, which are then capped.
4. **Known future demand.** Part-consuming maintenance jobs (overhaul, filter replacement, lubrication) from Mitem & Mplan are mapped to the BoM parts they replace. The usage factor is calibrated on preventive-order history.
5. **Backtest.** Train on May 2025 – Apr 2026, test on May – Sep 2026, against a static average and Croston-SBA.
6. **ML early warning** (pipeline/ml_model.py). A gradient-boosting classifier predicts the probability that a part is demanded in the next 90 days.
   - Training data: 12 monthly snapshots. Features use only data before each snapshot date.
   - Validation: out-of-time, compared against a recency rule and the statistical model. Calibration and permutation importance are stored in the database.
   - Warning threshold: 30%. On the hold-out, parts scored at or above it were needed **74%** of the time (753 parts), against a 7.1% base rate. AUC 0.895.

### Optimization engine (src/lib/engine.ts)
- Lead-time demand distribution: Poisson for slow movers, normal otherwise. Lead time mean and variability come from PR → PO delivery.
- Safety stock, reorder point (= Min), EOQ order quantity, Max = Min + Q.
- For each part, the service level is chosen to minimize **holding + ordering + downtime-risk cost**. The engine also checks whether not stocking the part at all is cheaper.
- The probability that a stockout stops production is **calibrated from the data**: today's static Min–Max must reproduce the Emergency notifications observed per year.
- Downtime per stockout is the expedited delivery time: the 10th-percentile lead time of the part's category in PR PO.
- The emergency price premium defaults to 0%, because short-notice PRs in the data were paid the median price (ratio 1.000).
- **Identical stock first.** 133 groups of material numbers share an identical description and unit (597 numbers). In 66 of these groups, one number is at zero stock while another holds stock. Before buying, a need is covered by a twin's stock held above that twin's own reorder point. These transfers show up as the **Transfer** action.
- **Turnaround reserve and readiness.**
  - Detecting the last turnaround: turnaround-type orders appear in every month. The turnaround itself is the run of months where their issue lines exceed 3× the monthly median (Nov 2025 – Jan 2026: 360 parts). That window is the last turnaround.
  - Reserve: parts in that scope keep the quantity they used, so they are never reduced as "slow-moving" before the next turnaround.
  - Readiness check: the Maintenance workspace checks readiness for a planner-chosen date. Order-by = start date minus the P80 lead time.
- "Convert to Stock Item" is only proposed when the part was used in 2+ months or has a planned job.

### Safety and governance rules (src/lib/rules.ts)
- **Safety-critical element (SCE).** A part installed on a FuncLoc tagged `PRV-` (safety / pressure-relief valve) or `SDV-` (shutdown valve): 860 parts on 1,040 locations. 578 of those locations are rated S in the FuncLoc list, so criticality alone would under-protect them. An SCE part:
  - is costed with class-A downtime risk,
  - always keeps at least one spare,
  - is never marked "potentially obsolete",
  - can be reduced only above that floor, with Management sign-off.
  - In a live plant the SCE register replaces the tag rule.
- **Long-lead.** A critical part (A/B or SCE) whose 80th-percentile lead time on its own POs exceeds 90 days. Category estimates do not count. The reason text gives the fastest delivery seen in its category: emergency buying cannot prevent downtime, so plan ahead or hold a capital spare.
- **Management sign-off.** Buys above Rp 1 B, and reductions above Rp 1 B or of any SCE part, wait in the Management **Pending approval** list. They reach the PR draft or count as released capital only after sign-off. The limit is a delegation-of-authority rule, so it is fixed in `rules.ts` rather than offered as a scenario slider.
- **Decision log.** Every approve, reject, undo and sign-off is appended with role, time, quantity, value and the system's reason. It is shown in the Management workspace and exportable to CSV.
- **Master-data work list** (Data & Method page, `GET /api/master-data?format=csv`). One list for the SAP master-data team:
  - duplicate-number candidates,
  - Non Stock parts with repeated demand,
  - Stock Items the policy would buy on demand,
  - Non Stock parts that hold stock.
  - These are candidates to check, not automatic changes.

### Proof by replay (src/lib/replay.ts)
The Sparely policy is rebuilt from data before 1 May 2026 only. The actual May–Sep 2026 issues are then replayed day by day through two warehouses: one runs today's static Min–Max, the other the Sparely policy. Both use the same lead times and safety rules, and each starts at its own policy's Max. The replay re-runs under the active scenario. Results are on the Management workspace and the Scenario page, and through `GET /api/replay`.
- Inventory position = on hand + open POs (PO delivery date after the planning date).

## Run locally

```bash
# 1) (optional) rebuild the database from the raw Excel files
pip install -r pipeline/requirements.txt
npm run build:data           # writes data/caliber.db

# 2) web app
npm install
npm run dev                  # http://localhost:3000
```

Node 22 is required (`engines` in package.json). The SQLite database is committed in `data/caliber.db`, so step 1 is only needed after changing the data or assumptions in `pipeline/config.py`.

## Deploy to Vercel

Live MVP: **https://sparely-omega.vercel.app** (production deployment of 4 Nov 2026).

```bash
npx vercel login
npx vercel --prod
```

`next.config.ts` ships `data/caliber.db` with every serverless function, and keeps `better-sqlite3` as an external native module.

## JSON API

| Endpoint | Description |
|---|---|
| `GET /api/summary` | Portfolio KPIs, health and action counts, safety and governance counts |
| `GET /api/recommendations?action=&health=&crit=A,B&tag=sce\|longlead\|signoff&q=&sort=&limit=` | Per-part recommendations (`&format=csv` to export) |
| `GET /api/materials/{materialNo}` | Full detail, forecast, cost curve |
| `GET /api/forecast` | Aggregate forecast, demand classes, backtest |
| `POST /api/scenario` `{ "params": {...} }` | Re-optimize every part for a cost–risk scenario |
| `POST /api/pr-draft` `{ "items": [{ "material_no", "qty", "need_by"? }] }` | Purchase-requisition lines from approved buys |
| `POST /api/impact` `{ "decisions": [...] }` | Spend committed, purchases avoided by transfers, capital released, downtime risk removed, decisions awaiting sign-off |
| `GET /api/replay` | May–Sep 2026 replay: today's Min–Max vs the Sparely policy |
| `GET /api/data-quality` | Data-quality checks, assumptions, calibration |
| `GET /api/master-data` | Master-data work list summary (`?format=csv` for every row) |

## Assumptions

All assumptions are listed in three places, and all are shown on the **Data & Method** page:
- `pipeline/config.py` (pipeline),
- `src/lib/params.ts` (scenario defaults),
- `src/lib/rules.ts` (safety and governance rules).

The ones not confirmed by the organizers are:

- the order-type meaning of the order-number prefixes
- the PR-type labels
- FX rates
- the SCE tag rule (PRV-/SDV-) standing in for an SCE register
- production loss per downtime day by criticality
- the holding-cost rate
- the cost per purchase order

The last three cannot come from the baseline data. The Data & Method page shows a live sensitivity table for halving or doubling them.

## Project layout

```
pipeline/       Python data pipeline (config.py = every assumption)
data/           caliber.db (SQLite)
src/lib/        db access, engine, rules, stats, params, data queries
src/app/        pages and API routes
src/components/ UI and charts
scripts/        engine sanity check, submission zip
raw-data/       organizer Excel files (in the submission zip only)
```
