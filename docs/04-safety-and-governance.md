# 04 · Safety and Governance

The cost–risk model answers *"what is the cheapest amount of stock?"*. In a petrochemical plant some things must not be left to a cost calculation alone: parts that protect process safety, and decisions that commit large amounts of money. Sparely therefore adds fixed rules — not scenario sliders — in one file, `src/lib/rules.ts`.

## Rules

| Rule | Definition | Today | Treatment |
| --- | --- | --- | --- |
| Safety-Critical Element (SCE) | Part installed on a FuncLoc tagged `PRV-` (safety / pressure-relief valve) or `SDV-` (shutdown valve) | 860 parts on 1,040 locations; 578 locations (56%) rated S | Class-A downtime risk; always at least 1 spare; never marked *potentially obsolete*; reductions need sign-off. 399 SCE parts go to reorder (Rp 8.9 bn) |
| Long-lead | Critical part (A/B or SCE) whose P80 lead time on its own POs exceeds 90 days (category estimates do not count) | 544 parts | Badge and reason: the fastest delivery in its category is too slow for emergency buying — plan ahead or hold a capital spare |
| Management sign-off | Buys above Rp 1 B; reductions above Rp 1 B or of any SCE part | 22 buys, 985 reductions | Wait in *Pending approval* in the Management workspace; reach the PR draft or count as released capital only after sign-off |
| Decision log | Every approve, reject, undo and sign-off | Stored in the browser (MVP) | Audit-trail table and CSV export: role, time, action, quantity, value, reason |

## Why not criticality alone?

578 of the 1,040 safety and shutdown valve locations are rated **S**, the lowest criticality. A model driven by criticality alone would let these parts go unstocked — yet without them the valve cannot be reinstalled and the unit it protects must not run. That is a process-safety risk, not just a cost.

## Why SCE parts can still be reduced

The first idea was "SCE parts always at the highest service level, never reduced". The data showed this is expensive: even with class-A risk, 337 SCE parts hold stock above the safe level (Rp 106.7 bn, partly estimated prices), and 541 SCE parts were never used in 17 months. Sparely uses a balanced rule instead:

- class-A risk,
- at least one spare,
- reductions only above that floor, and only with sign-off.

Likewise, a "reductions above Rp 100 M or class A" approval rule would send 2,488 of 3,505 reductions (71%) to management. The threshold was raised to **Rp 1 B plus every SCE part**, following delegation-of-authority (DoA) practice.

**Example.** Safety valve spring `4300047163` — equipment criticality S, Non Stock, old Min/Max 0/0, zero stock, lead time 150 days (P80 196 days), single supplier. Sparely flags it *Safety-critical* and *Long-lead*, costs it as class A (1.07% downtime probability), and recommends **Reorder 5 units (Rp 19.7 M), urgency Critical, Min 3 / Max 5**.

## Human in the loop

- Sparely recommends; people decide. Nothing is written to the ERP automatically.
- Every recommendation carries numbered reasons (forecast, lead time, service level, risk, twins, ML warning).
- Every decision is logged with who, when, what, how much and why.

## Master-data worklist (for the SAP team)

One list on the **Data & Method** page with CSV export (`GET /api/master-data?format=csv`). These are candidates to check, not automatic changes, because the same description does not always mean the same specification.

| Issue | Materials | Stock value | Suggested SAP action |
| --- | --- | --- | --- |
| Same description and unit under several numbers | 597 | Rp 38.9 bn | Check interchangeability; keep one active number and link or block the others |
| Non Stock part with repeated or planned demand | 265 | Rp 69.1 bn | Change MRP type to Stock Item and load the recommended Min / Max |
| Stock Item the policy would buy on demand | 1,030 | Rp 1.54 tn | Change MRP type to Non Stock; run the stock down |
| Non Stock part holding stock | 1,582 | Rp 2.12 tn | Stock outside Min–Max control: return, transfer or reclassify |

## Transparent assumptions

All assumptions are listed in `pipeline/config.py`, `src/lib/params.ts` and `src/lib/rules.ts`, and shown on the Data & Method page. Assumptions not confirmed by the organisers: order-type prefixes, PR-type labels, FX rates, the SCE tag rule, production loss per downtime day, holding-cost rate, and cost per PO. The last three are stress-tested live:

| Case | Reorder | Reduce | Parts changing action | Average stock |
| --- | --- | --- | --- | --- |
| Downtime cost × 0.5 | 1,099 | 3,614 | 335 (4.5%) | Rp 210.6 bn |
| Base case | 1,160 | 3,505 | – | Rp 260.0 bn |
| Downtime cost × 2 | 1,218 | 3,432 | 284 (3.8%) | Rp 303.4 bn |
| Holding cost 15% / year | 1,172 | 3,471 | 123 (1.6%) | Rp 277.0 bn |
| Holding cost 30% / year | 1,126 | 3,573 | 194 (2.6%) | Rp 231.3 bn |
| Ordering cost × 2 | 1,155 | 3,499 | 23 (0.3%) | Rp 261.6 bn |

Halving or doubling an assumption changes the action for at most ~5% of parts. The direction of the recommendations is set by the data.

## Data protection in the prototype

- The hosted SQLite database is **read-only**; the app cannot change source data.
- Decisions and the decision log live in the user's browser (`localStorage`) and are not sent to a server.
- No personal data is processed; the dataset is the organisers' dummy SAP extract.
- In production: company SSO with role-based access, decisions written to a shared database and the ERP, and the official SCE register replacing the tag rule.
