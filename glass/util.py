from __future__ import annotations

import sys
import time
from pathlib import Path


def log(msg: str):
    print(time.strftime("%H:%M:%S"), msg, flush=True)


def app_dir() -> Path:
    """Where config and user decks live: next to the .exe when frozen, else the project folder."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent.parent


def res_dir() -> Path:
    """Bundled read-only resources (web/)."""
    base = getattr(sys, "_MEIPASS", None)
    return Path(base) if base else Path(__file__).resolve().parent.parent
