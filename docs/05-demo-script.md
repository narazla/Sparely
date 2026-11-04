# 05 · Demo Script (~4 minutes)

Live app: https://sparely-caliber2026.vercel.app

| # | Page | What to show | What to say |
| --- | --- | --- | --- |
| 1 | **Home** | KPIs and the five-step flow; role picker | "One decision per spare part, handed from maintenance to the planner to procurement to management." |
| 2 | **Maintenance** | Readiness of jobs due in 90 days, request a short part, next-turnaround readiness | "36% of all parts were consumed in the last turnaround. For 1 April 2027 we are 58% ready — 152 parts short, 15 already too late to order normally." |
| 3 | **Inventory Planner** | Transfer firebrick `4100071636` from its twin numbers; approve a critical reorder; raise one quantity above Rp 1 B | "The part already exists under another number — 4,069 units, no purchase needed. Above Rp 1 B, the decision automatically needs management sign-off." |
| 4 | **Material List** | Filter *Safety-critical*; open safety valve spring `4300047163` | "Rated S, Non Stock, zero stock, 150-day lead time, single supplier. Sparely treats it as class A and reorders 5 units." |
| 5 | **Procurement** | Auto-filled PR draft; large buys waiting for sign-off; export CSV | "PR type, purchasing group and supplier come from each part's purchase history." |
| 6 | **Management** | Sign off in *Pending approval*, decision log, decision impact, replay proof; finish on **Scenario** with the *Supply disruption* preset | "Rebuilt only from data before May and replayed on May–September: stockouts −78%, critical stockouts −86%, stock held −54%." |

## Firebrick walk-through (`4100071636`)

| Item | Value |
| --- | --- |
| Criticality | A (5 furnaces, 4 rated A/B) |
| MRP type / old Min / Max | Non Stock / 0 / 0 |
| Stock / on order | 67 / 3,852 |
| Forecast per year | 8,229 |
| ML: probability needed in 90 days | 98% |
| Lead time / lead-time demand | 74 days / 1,664 |
| Chosen service level | 99.9% |
| New safety stock / Min / Max | 5,100 / 6,763 / 7,988 |
| Action | Transfer 4,069 units from `4100072068`, `4100072203` |

Reasons shown in the app:

1. Forecast 8,229 EA/year (recency-weighted compound Poisson, own history).
2. Lead time ~74 days; expected demand during lead time 1,664.
3. A 99.9% service level gives the lowest holding + downtime-risk cost: reorder at 6,763, order up to 7,988.
4. On hand 67 + on order 3,852 is at or below the reorder point: 4,069 needed.
5. Long lead time: 80% of deliveries took up to 125 days; the fastest in its category 37 days, single supplier — plan ahead or hold a capital spare.
6. Installed on 5 FuncLocs, 4 of them criticality A/B.
7. ML early warning: 98% probability of demand in the next 90 days.
8. Identical parts `4100072068`, `4100072203` hold spare stock: transfer 4,069 EA instead of buying.

## Likely jury questions

| Question | Short answer |
| --- | --- |
| Why not deep learning / LSTM? | 17 months of history and most parts are rarely used. A statistical model that borrows from the installed base plus a global gradient-boosting model fits better, and the tests prove it. |
| Is anything leaking? | No. Backtest, ML and replay use only data before each test period. |
| Where does the downtime cost come from? | It is a business assumption you can change; the downtime *probability* is calibrated from real Emergency notifications, and sensitivity changes at most ~5% of actions. |
| Why different service levels per part? | Holding cost and risk differ per part; the lowest total cost is chosen. |
| Is every critical part stocked? | Safety-critical parts always keep at least one spare. Other never-used critical parts go to engineer review (insurance gap); ML warnings are prioritised. |
| Why treat safety valves specially? | Running out of a safety valve part is a process-safety risk. 578 of 1,040 such locations are rated S, so criticality alone would under-protect them. |
| Who controls large decisions? | Buys above Rp 1 B and every safety-critical reduction need management sign-off; every decision is logged with its reason. |
| How do you treat Non Stock items? | 265 Non Stock parts with repeated or planned demand → Stock Item; 1,030 Stock Items → Non Stock; 1,582 Non Stock parts holding stock go to the master-data worklist. |
| Can the trillion-rupiah figures be trusted? | Use PO-price figures (Rp 627.0 bn stock, Rp 573.3 bn excess); trillion figures include category price estimates. |
| Purchases went up 127% in the replay? | Sparely buys more, but only for parts that are actually used, while average stock held falls 54%. |
