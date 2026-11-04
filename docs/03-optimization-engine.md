# 03 · Optimization Engine and Proof

Code: `src/lib/engine.ts` (optimization and actions), `src/lib/workflow.ts` (readiness, PR draft, impact), `src/lib/replay.ts` (replay). The engine runs on every request and re-optimizes all 7,481 parts in well under a second.

## Idea

For every part, try several service levels, compute the total cost of each — **holding + ordering + downtime risk** — and pick the cheapest. "Don't stock, buy when needed" is also compared.

## Lead-time demand

```text
L = mean lead time (days), σ_L = lead-time standard deviation
μ_L  = μ × L + planned demand falling within L
σ²_L = L × σ²_day + μ² × σ_L²
```

Per-part lead time blends the part's own POs with its category median, weight `n / (n + 3)` (n = number of POs). The P80 lead time (met by 80% of deliveries) sets turnaround order-by dates.

## Stock parameters

```text
Slow movers (λ × L < 3): ROP = Poisson quantile(SL, λ × L) × z + planned demand within L
Others:                  ROP = μ_L + Φ⁻¹(SL) × σ_L
Safety stock SS = ROP − μ_L
EOQ Q = √(2 × D × K / (h × P)), bounded between D/12 and max(D, z)
Max = ROP + Q
```

## Cost and risk

```text
Holding cost      = h × P × (SS + Q/2)
Ordering cost     = K × D / Q
Stockouts / year  = (D / Q) × (1 − achieved SL)
Cost per stockout = p_downtime × C_day × T_emergency + premium × P × z
Total             = holding + ordering + stockouts/year × cost per stockout
Not stocking      : stockouts/year = λ × 365 (every need is an emergency buy)
```

Service levels tried: 50%, 75%, 85%, 90%, 95%, 97.5%, 99%, 99.5%, 99.9%. The cheapest wins; if not stocking is cheaper, the part is recommended as Non Stock.

## Calibrating downtime risk from the data

The probability that a stockout actually stops production is not in the data, but it can be calibrated: today's Min–Max, run through the model, must reproduce the observed Emergency notifications (98.9 per year).

```text
p_downtime(class) = weight(class) × scale; weights A 1 · B 0.5 · C 0.15 · S 0.05
scale chosen so that Σ stockouts_current_policy × weight = Emergency notifications per year
T_emergency = fastest delivery seen in the part's category (P10), at least 3 days
Safety-critical parts use class-A weight and downtime cost whatever their criticality
```

| Criticality | Stockout → downtime |
| --- | --- |
| A | 1.07% |
| B | 0.53% |
| C | 0.16% |
| S | 0.05% |

## Actions

| Action | When |
| --- | --- |
| Reorder | Stock + open POs ≤ ROP. Quantity = Max − position. Urgency *Critical* if the part is A/B or safety-critical and stock is below lead-time demand. Buys above Rp 1 B need management sign-off. |
| Transfer | A reorder need can be covered by a twin number with identical description and unit (only its stock above its own ROP; safety-critical parts never give up their minimum spare). |
| Reduce | Stock above the keep level = max(new Max, last turnaround need; safety-critical parts keep at least 1), or the part should not be stocked. Reductions above Rp 1 B or of safety-critical parts need sign-off. |
| Monitor | Near ROP, slow-moving, abnormal use, insurance candidate, or ML warning with no stock. |
| Maintain | Within the recommended Min–Max. |

## Inventory health

| Status | Meaning | Parts |
| --- | --- | --- |
| Stockout | Zero stock but should be stocked | 583 |
| Below reorder point | Position ≤ ROP | 214 |
| Healthy | Within range | 181 |
| Excess | Above keep level | 197 |
| Slow-moving | Last issued > 180 days ago | 730 |
| Non-moving | Not issued in 17 months | 1,848 |
| Potentially obsolete | Non-moving, C/S, not safety-critical, no planned job | 1,161 |
| Critical insurance spare | Non-moving but protects A/B equipment or a safety valve — keep | 518 |
| TAM reserve | Used only during turnaround — keep for the next one | 18 |
| Insurance gap | Never used, no stock, model suggests stocking — engineer review (safety-critical parts go straight to reorder) | 1,064 |
| No stock needed | Should not be stocked | 967 |

## Next-turnaround readiness

```text
Assumption: next turnaround scope = last turnaround scope (parts and quantities)
available_on_day_H = stock + POs arriving before H + identical stock − routine & planned use until H
short = turnaround need − available_on_day_H;  order-by = H − P80 lead time
```

Example for **1 Apr 2027**: readiness **58%**, 152 parts short (139 critical), 15 already too late to order normally, Rp 7.0 bn to buy. Shortages can be requested straight into the procurement PR draft.

## Proof: warehouse replay

The Sparely policy is rebuilt from data **before 1 May 2026** only. Actual May – Sep 2026 demand (3,035 part-days, 293,035 units) is then replayed day by day through two virtual warehouses with the same lead times and safety rules. Each starts at its own policy's Max; every day goods arrive → demand is served (shortfall = stockout) → if stock + POs ≤ Min, order up to Max.

| Measure | Current Min–Max | Sparely | Change |
| --- | --- | --- | --- |
| Demand days fully served | 68.6% | 93.1% | +24.5 pts |
| Units served from stock | 35.3% | 83.7% | +48.4 pts |
| Stockout events | 952 | 209 | −78% |
| …on critical parts (A/B) | 878 | 127 | −86% |
| Parts that ran out | 341 | 146 | −57% |
| Average stock value | Rp 986.4 bn | Rp 455.9 bn | −54% |
| Purchases during the period | Rp 14.7 bn | Rp 33.4 bn | +127% |

Sparely is better on 256 parts and worse on 53, mostly C/S, where the model deliberately accepts risk instead of holding stock. It buys more, but only for parts that are actually used. By criticality: A 837 → 104, B 41 → 23, C 47 → 52, S 27 → 30 stockouts.

## Trade-off frontier

| Uniform service level | Average stock | Risk cost / year |
| --- | --- | --- |
| 90% | Rp 206.5 bn | Rp 97.9 bn |
| 95% | Rp 262.2 bn | Rp 48.3 bn |
| 99% | Rp 421.6 bn | Rp 12.0 bn |
| 99.9% | Rp 570.6 bn | Rp 4.4 bn |
| **Sparely (per part)** | **Rp 260.0 bn** | **Rp 13.0 bn** |

Choosing per part reaches near-99% risk at the capital of a 95% policy.

## Reporting numbers safely

- Use PO-price figures for rupiah claims (Rp 627.0 bn stock, Rp 573.3 bn excess); trillion-scale figures include category estimates.
- Replay compares two policies from their own starting points, because historical stock is not in the data.
- Risk cost is a model estimate, not a promise.
