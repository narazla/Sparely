"""Package the submission: full source + SQLite database + the organizer's raw files.

Usage: python scripts/make_zip.py   ->  ../submission/sparely-source.zip
"""
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT.parent / "Supporting Data"
OUT = ROOT.parent / "submission" / "sparely-source.zip"
SKIP_DIRS = {"node_modules", ".next", ".git", ".vercel", "__pycache__", "raw-data"}
SKIP_FILES = {"caliber juara.txt"}  # internal team notes, not part of the submission

OUT.parent.mkdir(exist_ok=True)
n = 0
with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
    for p in sorted(ROOT.rglob("*")):
        rel = p.relative_to(ROOT)
        if p.is_dir() or any(part in SKIP_DIRS for part in rel.parts) or p.name.endswith(".tsbuildinfo") or p.name in SKIP_FILES:
            continue
        z.write(p, Path("sparely") / rel)
        n += 1
    if RAW.exists():
        for p in sorted(RAW.glob("*")):
            z.write(p, Path("sparely") / "raw-data" / p.name)
            n += 1
print(f"{n} files -> {OUT} ({OUT.stat().st_size / 1e6:.1f} MB)")
