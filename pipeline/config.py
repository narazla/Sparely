"""Central place for every assumption the pipeline makes.

Anything the organizers have not confirmed lives here, so a confirmed answer
changes one line instead of the logic.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# Organizer files, untouched: raw-data/ inside the submission zip, or the sibling folder during development.
RAW_DIR = ROOT / "raw-data" if (ROOT / "raw-data").exists() else ROOT.parent / "Supporting Data"
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

# Criticality ranking, most critical first: A > B > C > S. Missing criticality -> S (lowest).
CRIT_RANK = {"A": 4, "B": 3, "C": 2, "S": 1}
LOWEST_CRIT = "S"

# Maintenance-plan tasks that consume spare parts, and which part categories
# (first word of the material description) each task replaces. First match wins.
# Inspection, calibration, measurement and testing tasks are assumed to consume none.
TASK_PART_RULES = [
    ("Lubrication", r"lube oil change", {"OIL"}),
    ("Lubrication", r"re-greasing", {"GREASE"}),
    ("Replacement", r"filter element replacement", {"FILTER ELEMENT", "SCREEN"}),
    ("Overhaul", r"final element overhaul",
     {"TRIM SET", "SEAT RING", "PACKING SET", "GASKET", "DIAPHRAGM", "O-RING", "SPRING", "STUDBOLT"}),
    ("Overhaul", r"pump overhaul",
     {"BEARING", "SEAL", "GASKET", "O-RING", "SLEEVE", "RING", "IMPELLER", "COUPLING", "STUDBOLT"}),
    ("Overhaul", r"(compressor|turbine) major overhaul",
     {"BEARING", "SEAL", "GASKET", "O-RING", "RING", "SLEEVE", "BLADE", "NOZZLE", "PACKING SET",
      "DIAPHRAGM", "FILTER ELEMENT", "STUDBOLT"}),
]

# Demand model settings
RECENCY_HALF_LIFE_DAYS = 180     # recent demand weighs more (dynamic forecast)
CREDIBILITY_K = 2.0              # events needed before history outweighs the installed-base prior
EMERGENCE_SPLIT = "2026-05-01"   # parts unused before this date: how often do they get a first demand after it?
EMERGENCE_SPLIT_BACKTEST = "2026-01-01"
ANOMALY_ROBUST_Z = 3.5           # robust z-score threshold for abnormal issues
ANOMALY_MIN_EVENTS = 4

# Backtest split
BACKTEST_CUTOFF = "2026-05-01"   # train May-25..Apr-26, test May-26..Sep-26
