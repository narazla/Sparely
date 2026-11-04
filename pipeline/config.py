"""Central place for every assumption the pipeline makes.

Anything the organizers have not confirmed lives here, so a confirmed answer
changes one line instead of the logic.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT.parent / "Supporting Data"          # organizer files, untouched
DB_PATH = ROOT / "data" / "caliber.db"

# Data covers 2025-05-01 .. 2026-09-30, so the planning "today" is the day after.
AS_OF = "2026-10-01"
HISTORY_START = "2025-05-01"
HISTORY_END = "2026-09-30"
FORECAST_HORIZON_DAYS = 365

# Notifications in May 2025 are ~4x a normal month (backlog / migration load),
# so failure rates are measured from June 2025 onwards.
FAILURE_RATE_START = "2025-06-01"

# Order number prefix -> order type (assumption, not confirmed by organizers).
ORDER_TYPES = {
    "201": "Corrective",
    "202": "Emergency",
    "203": "Turnaround",
    "204": "Preventive",
    "205": "Other maintenance",
    "206": "Other maintenance",
    "209": "Other maintenance",
}
TURNAROUND_TYPES = {"Turnaround"}   # one-off event demand, kept out of the baseline
PLANNED_TYPES = {"Preventive"}      # replaced by the maintenance-plan forecast when available

# PR types assumed to be regular replenishment vs urgent buys (assumption).
PR_TYPE_LABELS = {
    "PR01": "Import / long-lead",
    "PR03": "Regular replenishment",
    "PR04": "Regular (other)",
    "PR05": "Project / turnaround",
    "PR06": "Regular replenishment",
    "PR09": "Urgent",
    "PR10": "Other",
}

# Non-IDR prices converted with fixed rates (assumption).
FX_TO_IDR = {"IDR": 1.0, "USD": 16300.0, "EUR": 17700.0, "SGD": 12600.0, "JPY": 108.0}

# Criticality ranking (S = safety-critical, highest). Missing criticality -> C.
CRIT_RANK = {"S": 4, "A": 3, "B": 2, "C": 1}

# Maintenance-plan tasks that consume spare parts (keyword match on task text).
# Inspection, calibration, measurement and testing tasks are assumed to consume none.
CONSUMING_TASK_KEYWORDS = {
    "Overhaul": ["overhaul"],
    "Replacement": ["replacement", "change"],
    "Lubrication": ["re-greasing"],
}

# Demand model settings
RECENCY_HALF_LIFE_DAYS = 180     # recent demand weighs more (dynamic forecast)
CREDIBILITY_K = 2.0              # events needed before history outweighs the installed-base prior
ANOMALY_ROBUST_Z = 3.5           # robust z-score threshold for abnormal issues
ANOMALY_MIN_EVENTS = 4

# Backtest split
BACKTEST_CUTOFF = "2026-05-01"   # train May-25..Apr-26, test May-26..Sep-26
