# 01 · Data and Cleaning

Sparely is built on the six baseline files provided by the CALIBER 2026 organisers: dummy SAP extracts from an ethylene-cracker plant. The data covers **1 May 2025 – 30 Sep 2026** (17 months); the planning date ("today") is **1 Oct 2026**.

## The six files

| File | One row is | Size | Used for |
| --- | --- | --- | --- |
| FuncLoc list | One location / piece of equipment + criticality (A/B/C/S) | 14,484 locations | Criticality weights, equipment class for failure rates |
| BoM | One part installed on one piece of equipment + stock, Min, Max, MRP type | 20,653 rows, 7,481 materials | Stock position, current Min–Max, installed base |
| Movement Material | One goods issue per maintenance order | 17,518 → 16,655 rows after de-duplication | Demand history |
| Notif History | One maintenance / failure notification | 5,795 notifications | Failure rates, downtime calibration (Emergency) |
| Mitem & Mplan | One planned maintenance item + cycle | 10,153 items, 28 cycle formats | Known future (planned) demand |
| PR PO | One purchase-requisition line linked to a PO | 11,609 → 6,189 unique lines | Unit price, lead time, supplier, open POs |

## How the tables connect

```text
FuncLoc ──┬── BoM (stock, Min/Max, installed qty) ──┬── Movement (issues)
          ├── Notif (failures) ── Order ──(~16%)──────┘
          └── Mplan (schedule) ──via FuncLoc → BoM──► planned demand
BoM ── Material No ── PR PO (price, lead time, supplier)
```

Only about 16% of goods issues link to a notification through the order number; the rest come from other order types. The equipment link for those issues comes from the BoM.

## What the data shows

| Fact | Number | Why it matters |
| --- | --- | --- |
| Very sporadic demand | 44 parts regular; 1,170 issued in a single month; 5,625 never issued | Averages and static Min–Max will miss |
| Last turnaround | 1 Nov 2025 – 31 Jan 2026: 360 parts, 145,095 units, 36% of all units in 17 months | A one-off spike must not become "normal" demand |
| Stock Items above Max | 1,380 of 3,656 (38%) | Overstock |
| Stock Items at zero / below Min | 472 / 504 | Stockout risk |
| Non Stock parts holding stock | 1,683 | Stock outside Min–Max control |
| POs late versus requested date | 60% | Lead time is uncertain |
| Suppliers per part | Always 1 (124 suppliers in total) | Single-source risk |
| Safety (PRV-) and shutdown (SDV-) valve locations | 1,040 (578 rated S); 860 parts installed on them | Criticality alone under-protects safety |
| Critical parts with long lead time | 544 parts (A/B or safety-critical) with P80 lead time > 90 days | Emergency buying cannot prevent downtime |
| Parts with a PO price | 1,250 of 7,481 | The rest are priced by category estimate |
| Emergency notifications | 132 in 487 days = 98.9 per year | Basis for downtime calibration |
| Duplicate material numbers | 597 numbers with identical description + unit (133 groups; in 66 groups one is empty while another holds stock) | The part exists, under another number |

## Data-quality checks

Every check is stored in the `data_quality` table and shown on the **Data & Method** page.

| File | Check | Result | Action |
| --- | --- | --- | --- |
| FuncLoc list | Missing criticality | 33 | Set to S (lowest) |
| BoM | Duplicate FuncLoc × material rows | 230 | Removed |
| BoM | Stock / Min / Max repeated on every FuncLoc row | Yes | Counted once per material |
| BoM | Non Stock materials (Min = Max = 0) holding stock | 1,683 | Flagged as uncontrolled stock |
| Movement Material | Exact duplicate rows | 863 | Removed (2.3% of issued units) |
| Notif History | Notifications without an order | 553 | Kept; no part link |
| Notif History | May 2025 backlog spike (~4× normal) | 1,463 | Failure rates measured from 1 Jun 2025 |
| Mitem & Mplan | Distinct cycle formats | 28 | Normalised to days |
| PR PO | Exact duplicate rows | 5,420 | Removed; 6,189 unique lines kept |
| PR PO | Non-IDR lines | 51 | Converted at fixed rates |
| PR PO | PO delivery before PR / lead time > 365 days | 2 / 106 | Kept as records, excluded from lead-time statistics |
| PR PO | Requested date before PR date | 324 | Kept; lead time uses PO delivery date |
| PR PO | Open POs (delivery on or after the planning date) | 766 | Counted as on-order quantity |
| PR PO | Suppliers per material (max) | 1 | Single-source risk flagged |
| Mitem & Mplan | ABC indicator equals FuncLoc criticality | Yes | FuncLoc criticality used as the single source |
| PR PO | Unit price of short-notice PRs vs median | Ratio 1.000 over 1,021 lines | No rush premium: default emergency premium 0% |

## Linking rules

- **Part criticality** = the most critical FuncLoc the part is installed on, ranked A > B > C > S (confirmed by the organisers). Result: A 3,686 · B 1,094 · C 1,119 · S 1,582 parts.
- **Order type** from the order-number prefix: 201 Corrective, 202 Emergency, 203 Turnaround, 204 Preventive, others "Other maintenance" (assumption, not confirmed).
- **Lead time** = PO delivery date − PR date; lead times below 1 or above 365 days are excluded from statistics.
- **Price** = median PO unit price (fixed FX for USD / JPY / EUR / SGD); parts without a PO use the median of their category and unit and are labelled *estimated*.
- **Open POs** (delivery on or after 1 Oct 2026) count as stock in transit.
