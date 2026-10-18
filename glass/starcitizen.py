"""Star Citizen files: install detection, your keybinds (actionmaps.xml) and the live Game.log.

Game.log patterns adapted from SC Bridge Companion (MIT License, (c) 2026 SC Bridge),
https://github.com/SC-Bridge/sc-companion
"""
from __future__ import annotations

import os
import re
import string
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

from .keys import parse_keys

CHANNELS = ["LIVE", "PTU", "EPTU", "TECH-PREVIEW", "HOTFIX"]
INSTALL_PATTERNS = [
    r"Program Files\Roberts Space Industries\StarCitizen", r"Roberts Space Industries\StarCitizen",
    r"Games\Roberts Space Industries\StarCitizen", r"Games\StarCitizen", r"Star Citizen", r"StarCitizen",
    r"SC\StarCitizen", r"RSI\StarCitizen",
]


# ------------------------------------------------------------------------------------------
# Install detection
# ------------------------------------------------------------------------------------------
def _launcher_log_dirs() -> list[Path]:
    """The RSI Launcher logs every launch: '[Launcher::launch] Launching Star Citizen LIVE from (C:\\...\\LIVE)'."""
    appdata = os.environ.get("APPDATA")
    if not appdata:
        return []
    rx = re.compile(r"\[Launcher::launch\] Launching Star Citizen \S+ from \(([^)]+)\)")
    found: list[Path] = []
    for name in ("log.log", "log.old.log"):
        p = Path(appdata) / "rsilauncher" / "logs" / name
        try:
            for m in rx.finditer(p.read_text("utf-8", "ignore")):
                found.append(Path(m.group(1)))
        except OSError:
            continue
    found.reverse()   # most recent first
    return found


def channel_dirs(channel: str = "LIVE") -> list[Path]:
    """Candidate <install>/<CHANNEL> folders, best first."""
    out: list[Path] = []
    for d in _launcher_log_dirs():
        if d.name.upper() == channel.upper():
            out.append(d)
    if sys.platform == "win32":
        drives = [f"{c}:\\" for c in string.ascii_uppercase[2:] if os.path.exists(f"{c}:\\")]
        for drv in drives:
            for pat in INSTALL_PATTERNS:
                out.append(Path(drv) / pat / channel)
    seen, uniq = set(), []
    for p in out:
        k = str(p).lower()
        if k not in seen:
            seen.add(k)
            uniq.append(p)
    return uniq


def find_file(channel: str, rel: str) -> Path | None:
    for d in channel_dirs(channel):
        p = d / rel
        try:
            if p.is_file():
                return p
        except OSError:
            pass
    return None


def find_actionmaps(channel: str = "LIVE") -> Path | None:
    return find_file(channel, str(Path("USER", "Client", "0", "Profiles", "default", "actionmaps.xml")))


def find_gamelog(channel: str = "LIVE") -> Path | None:
    return find_file(channel, "Game.log")


# ------------------------------------------------------------------------------------------
# actionmaps.xml
# ------------------------------------------------------------------------------------------
def parse_actionmaps(path: Path) -> dict:
    """{action: {"keys": "lalt+n" | "", "mode": activationMode | None}}; "" = you unbound it."""
    root = ET.parse(path).getroot()
    profiles = root.findall("ActionProfiles")
    prof = next((p for p in profiles if p.get("profileName") == "default"), profiles[0] if profiles else root)
    out: dict = {}
    for am in prof.iter("actionmap"):
        prefer = am.get("name", "").startswith(("spaceship", "seat", "lights", "default"))
        for act in am.findall("action"):
            name = act.get("name")
            if not name:
                continue
            kb = mo = mode = None
            for rb in act.findall("rebind"):
                inp = rb.get("input", "")
                if inp.startswith("kb"):
                    kb = inp.split("_", 1)[1] if "_" in inp else ""
                    mode = rb.get("activationMode") or mode
                elif inp.startswith("mo"):
                    mo = inp.split("_", 1)[1] if "_" in inp else ""
                    mode = mode or rb.get("activationMode")
            if kb is not None and kb.strip():
                keys = kb.strip()
            elif mo is not None and mo.strip() and not mo.strip().startswith("maxis"):
                keys = mo.strip()
            elif kb is not None:
                keys = ""
            else:
                continue
            if keys:
                try:
                    keys = "+".join(parse_keys(keys))
                except ValueError:
                    continue
            if name in out and not prefer:
                continue
            out[name] = {"keys": keys, "mode": mode}
    return out


# ------------------------------------------------------------------------------------------
# Game.log
# ------------------------------------------------------------------------------------------
def _ship_channel(ch: str) -> tuple[str, str]:
    ch = ch.removeprefix("@vehicle_Name")
    parts = ch.split(" : ", 1)
    return (parts[0].strip(), parts[1].strip()) if len(parts) == 2 else (ch.strip(), "")


N = r'Added notification "'
PATTERNS: list[tuple[str, re.Pattern, callable]] = [
    ("player_login", re.compile(r'nickname="([^"]+)"\s+playerGEID=(\d+)'), lambda m: {"handle": m[1]}),
    ("ship_boarded", re.compile(N + r"You have joined channel '(.+?)'"),
     lambda m: dict(zip(("ship", "owner"), _ship_channel(m[1])))),
    ("ship_exited", re.compile(N + r"You have left the channel '(.+?)'"),
     lambda m: dict(zip(("ship", "owner"), _ship_channel(m[1])))),
    ("contract_accepted", re.compile(N + r"Contract Accepted:\s*(.+?):\s*\""), lambda m: {"name": m[1].strip()}),
    ("contract_completed", re.compile(N + r"Contract Complete:\s*(.+?):\s*\""), lambda m: {"name": m[1].strip()}),
    ("contract_failed", re.compile(N + r"Contract Failed:\s*(.+?):\s*\""), lambda m: {"name": m[1].strip()}),
    ("objective", re.compile(N + r"New Objective:\s*(.+?):\s*\""), lambda m: {"name": m[1].strip()}),
    ("objective_complete", re.compile(N + r"Objective Complete:\s*(.+?)(?::\s*\"|$)"), lambda m: {"name": m[1].strip()}),
    ("qt_target", re.compile(r"Player has selected point (\S+) as their destination"), lambda m: {"destination": m[1]}),
    ("qt_arrived", re.compile(r"Quantum Drive has arrived at final destination"), lambda m: {}),
    ("location", re.compile(r"<RequestLocationInventory> Player\[([^\]]+)\] requested inventory for Location\[([^\]]+)\]"),
     lambda m: {"location": m[2]}),
    ("jurisdiction", re.compile(N + r"Entered ([^\"]+) Jurisdiction"), lambda m: {"name": m[1]}),
    ("armistice_entered", re.compile(N + r"Entering Armistice Zone"), lambda m: {}),
    ("armistice_exited", re.compile(N + r"Leaving Armistice Zone"), lambda m: {}),
    ("monitored_entered", re.compile(N + r"Entered Monitored Space"), lambda m: {}),
    ("monitored_exited", re.compile(N + r"Exited Monitored Space"), lambda m: {}),
    ("crimestat", re.compile(N + r"CrimeStat Rating Increased"), lambda m: {}),
    ("fined", re.compile(N + r"Fined (\d+) UEC"), lambda m: {"amount": m[1]}),
    ("injury", re.compile(N + r"(Minor|Moderate|Major|Severe) Injury Detected - ([^-]+) - Tier (\d+)"),
     lambda m: {"severity": m[1], "part": m[2].strip(), "tier": m[3]}),
    ("incapacitated", re.compile(N + r"Incapacitated:"), lambda m: {}),
    ("fatal_collision", re.compile(r"<FatalCollision> Fatal Collision occured for vehicle (\S+)"), lambda m: {"vehicle": m[1]}),
    ("refinery_complete", re.compile(N + r"A Refinery Work Order has been Completed at (.+?):"), lambda m: {"location": m[1].strip()}),
    ("impounded", re.compile(N + r"Vehicle Impounded:\s*(.+?):"), lambda m: {"reason": m[1].strip()}),
    ("hangar_ready", re.compile(N + r"Hangar Request Completed"), lambda m: {}),
    ("server_joined", re.compile(r"Join PU.*shard\[([^\]]+)\]"), lambda m: {"shard": m[1]}),
    ("emergency_services", re.compile(N + r"Standby, Local Emergency Services"), lambda m: {}),
]


def parse_line(line: str) -> dict | None:
    if not any(k in line for k in ("notification", "Player", "Quantum", "nickname", "FatalCollision", "Join PU")):
        return None
    for kind, rx, fn in PATTERNS:
        m = rx.search(line)
        if m:
            ev = {"type": kind, "data": fn(m)}
            ts = line[1:line.find(">")] if line.startswith("<") else ""
            ev["ts"] = ts if "T" in ts else ""
            return ev
    return None


def pretty_location(raw: str) -> str:
    s = raw.replace("_", " ").strip()
    s = re.sub(r"\b(Stanton|Pyro|Nyx)(\d)([a-z]?)\b", r"\1 \2\3", s)
    return s


class GameLog:
    """Tails Game.log. Star Citizen recreates the file on each launch, so shrinking means a new session."""

    def __init__(self, path: Path | None):
        self.path = path
        self.pos = 0
        self.size = 0
        self.buf = ""
        self.error = "" if path else "Game.log not found"

    def prime(self, max_bytes: int = 6_000_000) -> list[dict]:
        """Read the tail of the current log to rebuild state at startup."""
        if not self.path or not self.path.is_file():
            return []
        size = self.path.stat().st_size
        start = max(0, size - max_bytes)
        with open(self.path, "rb") as f:
            f.seek(start)
            data = f.read().decode("utf-8", "ignore")
        self.pos = self.size = size
        lines = data.splitlines()
        if start:
            lines = lines[1:]
        return [e for e in (parse_line(l) for l in lines) if e]

    def poll(self) -> tuple[list[dict], bool]:
        """Returns (new events, restarted)."""
        if not self.path:
            return [], False
        try:
            size = self.path.stat().st_size
        except OSError:
            return [], False
        restarted = size < self.size
        if restarted:
            self.pos, self.buf = 0, ""
        self.size = size
        if size <= self.pos:
            return [], restarted
        with open(self.path, "rb") as f:
            f.seek(self.pos)
            chunk = f.read(min(size - self.pos, 4_000_000))
        self.pos += len(chunk)
        text = self.buf + chunk.decode("utf-8", "ignore")
        lines = text.split("\n")
        self.buf = lines.pop()          # keep a partial last line for next time
        return [e for e in (parse_line(l.rstrip("\r")) for l in lines) if e], restarted


class Session:
    """What the deck knows about the current play session, built from Game.log events."""

    def __init__(self):
        self.reset()

    def reset(self):
        self.handle = ""
        self.ship = ""
        self.ship_owner = ""
        self.location = ""
        self.jurisdiction = ""
        self.armistice = False
        self.qt_target = ""
        self.started = time.time()
        self.contracts: dict[str, str] = {}     # name -> accepted | completed | failed
        self.counts = {"injuries": 0, "incapacitated": 0, "fines": 0, "qt_jumps": 0, "crimes": 0}
        self.feed: list[dict] = []

    def apply(self, ev: dict, live: bool = True):
        t, d = ev["type"], ev["data"]
        if t == "player_login":
            self.handle = d["handle"]
        elif t == "ship_boarded":
            self.ship, self.ship_owner = d["ship"], d.get("owner", "")
        elif t == "ship_exited":
            if d["ship"] == self.ship:
                self.ship, self.ship_owner = "", ""
        elif t == "location":
            self.location = pretty_location(d["location"])
        elif t == "jurisdiction":
            self.jurisdiction = d["name"]
        elif t == "armistice_entered":
            self.armistice = True
        elif t == "armistice_exited":
            self.armistice = False
        elif t == "qt_target":
            self.qt_target = pretty_location(d["destination"])
        elif t == "qt_arrived":
            self.counts["qt_jumps"] += 1
            self.qt_target = ""
        elif t.startswith("contract_"):
            self.contracts[d["name"]] = t.split("_", 1)[1]
        elif t == "injury":
            self.counts["injuries"] += 1
        elif t == "incapacitated":
            self.counts["incapacitated"] += 1
        elif t == "fined":
            self.counts["fines"] += int(d.get("amount", 0) or 0)
        elif t == "crimestat":
            self.counts["crimes"] += 1
        elif t == "server_joined":
            pass
        self.feed.append(ev)
        del self.feed[:-60]

    def snapshot(self) -> dict:
        return {"handle": self.handle, "ship": self.ship, "owner": self.ship_owner,
                "own_ship": bool(self.ship) and (not self.ship_owner or self.ship_owner == self.handle),
                "location": self.location, "jurisdiction": self.jurisdiction, "armistice": self.armistice,
                "qt_target": self.qt_target, "started": self.started, "contracts": self.contracts,
                "counts": self.counts, "feed": self.feed[-30:]}
