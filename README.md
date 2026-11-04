# Sparely — CALIBER 2026 Final Case

**Sparely** is spare part intelligence and inventory optimization.

Equipment criticality runs **A > B > C > S** (A is the most critical). "Critical" in the app means A or B.

AI-powered spare part demand forecasting and dynamic inventory optimization.
The MVP turns six SAP-style baseline files into one decision per spare part (reorder, reduce, monitor or maintain), with dynamic Safety Stock, Reorder Point (Min) and Max, stockout and overstock risk, and cost–risk scenarios.

## User flow

The app opens on **Start**, which shows the end-to-end flow and a role picker. There is no login: the prototype demonstrates the flow, not access control. Each role has a workspace with a worklist:

| Workspace | Who | Does | Hands off to |
|---|---|---|---|
| Maintenance & Reliability | Maintenance planner, reliability engineer | Checks part readiness of jobs due in the next 90 days, requests short parts, acts on ML early warnings, decides insurance spares | Procurement |
| Inventory Planner | Inventory / MRP controller | Uses identical stock held under another material number first, then approves or adjusts reorders, dynamic Min–Max updates and excess reductions | Procurement, Management |
| Procurement | Buyer | Gets a PR draft (PR type, purchasing group and supplier taken from each part's PR PO history), expedites open POs | ERP |
| Management | Plant / supply-chain manager | Tracks spend committed, capital released and downtime risk removed; sees the replay proof; sets the cost–risk policy | All workspaces |

Decisions are stored in the browser (localStorage), so the hosted SQLite database stays read-only. In production they would be written back to the ERP.

## What it does

| Brief requirement | Where in the app |
|---|---|
| Demand forecasting (history, failures, maintenance plan, installed base, abnormal use) | **Demand Forecast** page, per-part chart on each material page |
| Dynamic Min–Max, safety stock, reorder point, replenishment quantity | **Recommendations** table and material page |
| Inventory health: excess, slow-moving, non-moving, potentially obsolete | **Inventory Health** page |
| Reorder / maintain / reduce / monitor, balancing inventory cost vs stockout, downtime and production-loss risk | **All parts**, role workspaces |
| Evidence that the policy works | **Management** workspace (replay) |
| Scenario simulation of raising or lowering inventory levels | **Cost–Risk Scenarios** page (live re-optimization of all 7,481 parts) |

## Architecture

```
Supporting Data (6 xlsx)
        │  pipeline/build_db.py  (Python: pandas, numpy, scikit-learn)
        ▼   clean → link → demand features → forecast → backtest
data/caliber.db  (SQLite, 17 tables)
        │  better-sqlite3 (read-only)
        ▼
src/lib/engine.ts  — inventory optimization engine (runs on every request, ~80 ms for all parts)
        │
        ▼
Next.js 15 App Router (server-rendered pages + JSON API) → Vercel
```

### Demand model (pipeline/build_db.py)
1. **Demand split by cause.** Order-number prefix → order type. Turnaround issues are event demand and stay out of the baseline. Preventive demand is replaced by the maintenance-plan forecast where one exists.
2. **Failure-driven demand.** Each part's own issue history is recency-weighted (half-life 180 days) as a compound Poisson process. It is blended by credibility with an **installed-base prior**: the failure rate (Notif History) of every FuncLoc the part is installed on (BoM). Parts that were never used get a first-demand rate estimated from data, measured as how often previously unused parts got demanded.
3. **Abnormal consumption.** A robust z-score flags abnormal issue sizes, which are then capped.
4. **Known future demand.** Part-consuming maintenance jobs (overhaul, filter replacement, lubrication) from Mitem & Mplan are mapped to the BoM parts they replace. The usage factor is calibrated on preventive-order history.
5. **Backtest.** Train on May 2025 – Apr 2026, test on May – Sep 2026, against a static average and Croston-SBA.
6. **ML early warning** (pipeline/ml_model.py). A gradient-boosting classifier predicts the probability that a part is demanded in the next 90 days.
   - Training data: 12 monthly snapshots. Features use only data before each snapshot date.
   - Validation: out-of-time, compared against a recency rule and the statistical model. Calibration and permutation importance are stored in the database.
   - Warning threshold: 30%. On the hold-out, parts at or above it were needed at least 43% of the time, against a 7% base rate.

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
- **Data cleaning added after review:**
  - 863 exact duplicate Movement rows removed.
  - POs due before their PR, or more than 365 days after it, are excluded from lead-time statistics.
  - "Convert to Stock Item" is only proposed when the part was used in 2+ months or has a planned job.

### Proof by replay (src/lib/replay.ts)
The AI policy is rebuilt from data before 1 May 2026 only. The actual May–Sep 2026 issues are then replayed day by day through two warehouses: one runs today's static Min–Max, the other the AI policy. Both use the same lead times, and each starts at its own policy's Max. The replay re-runs under the active scenario. Results are on the Management workspace and the Scenario page, and through `GET /api/replay`.
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

```bash
npx vercel login
npx vercel --prod
```

`next.config.ts` ships `data/caliber.db` with every serverless function, and keeps `better-sqlite3` as an external native module.

## JSON API

| Endpoint | Description |
|---|---|
| `GET /api/summary` | Portfolio KPIs, health and action counts |
| `GET /api/recommendations?action=&health=&crit=A,B&q=&sort=&limit=` | Per-part recommendations (`&format=csv` to export) |
| `GET /api/materials/{materialNo}` | Full detail, forecast, cost curve |
| `GET /api/forecast` | Aggregate forecast, demand classes, backtest |
| `POST /api/scenario` `{ "params": {...} }` | Re-optimize every part for a cost–risk scenario |
| `POST /api/pr-draft` `{ "items": [{ "material_no", "qty", "need_by"? }] }` | Purchase-requisition lines from approved buys |
| `POST /api/impact` `{ "decisions": [...] }` | Spend committed, purchases avoided by transfers, capital released, downtime risk removed |
| `GET /api/replay` | May–Sep 2026 replay: today's Min–Max vs the AI policy |
| `GET /api/data-quality` | Data-quality checks, assumptions, calibration |

## Assumptions

All assumptions are listed in `pipeline/config.py` (pipeline) and `src/lib/params.ts` (scenario defaults), and are shown on the **Data & Method** page. The ones not confirmed by the organizers are:

- the order-type meaning of the order-number prefixes
- the PR-type labels
- FX rates
- production loss per downtime day by criticality
- the holding-cost rate
- the cost per purchase order

The last three cannot come from the baseline data. The Data & Method page shows a live sensitivity table for halving or doubling them.

## Project layout

```
pipeline/       Python data pipeline (config.py = every assumption)
data/           caliber.db (SQLite)
src/lib/        db access, engine, stats, params, data queries
src/app/        pages and API routes
src/components/ UI and charts
scripts/        engine sanity check, submission zip
raw-data/       organizer Excel files (in the submission zip only)
```
