"""Give Star Citizen actions that have no default key a spare key, so deck controls work
without anyone opening the game's keybinding menu.

Rules:
- Only touches actions that have no default key in Star Citizen and that you haven't bound yourself.
- Only writes actionmaps.xml while the game is closed (the game rewrites it while running).
- Keeps a backup first; Undo restores it.
- Spare keys are RCtrl + F1-F12 and RCtrl + numpad 0-9, none of which Star Citizen 4.x uses by default.
"""
from __future__ import annotations

import shutil
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

from .util import log

# Actions without a default key, and the action maps they live in (from Star Citizen 4.x defaultProfile.xml)
WIRABLE: dict[str, list[str]] = {
    "v_set_guns_mode": ["seat_general"], "v_set_missile_mode": ["seat_general"], "v_set_scan_mode": ["seat_general"],
    "v_set_quantum_mode": ["seat_general"], "v_set_mining_mode": ["seat_general"], "v_set_salvage_mode": ["seat_general"],
    "v_operator_mode_cycle_back": ["seat_general"],
    "v_master_mode_set_nav": ["spaceship_movement"], "v_master_mode_set_scm": ["spaceship_movement"],
    "v_ifcs_toggle_esp": ["spaceship_movement"], "v_auto_precision_mode_toggle": ["spaceship_movement"],
    "v_toggle_all_doors": ["spaceship_general", "vehicle_general"], "v_open_all_doors": ["spaceship_general", "vehicle_general"],
    "v_close_all_doors": ["spaceship_general", "vehicle_general"], "v_toggle_all_doorlocks": ["spaceship_general", "vehicle_general"],
    "v_lock_all_doors": ["spaceship_general", "vehicle_general"], "v_unlock_all_doors": ["spaceship_general", "vehicle_general"],
    "v_weapon_launch_missile": ["spaceship_missiles"],
    "v_shield_raise_level_forward": ["spaceship_defensive"], "v_shield_raise_level_back": ["spaceship_defensive"],
    "v_shield_raise_level_left": ["spaceship_defensive"], "v_shield_raise_level_right": ["spaceship_defensive"],
    "v_shield_reset_level": ["spaceship_defensive"],
    "v_salvage_increase_beam_spacing": ["spaceship_salvage"], "v_salvage_decrease_beam_spacing": ["spaceship_salvage"],
    "v_salvage_cycle_modifiers_focused": ["spaceship_salvage"],
    "turret_esp_toggle": ["turret_advanced"], "turret_limiter_toggle": ["turret_advanced"],
}
# Never Alt+F-keys: Alt+F4 closes the game window and Alt+F1/F9/F10 trigger GPU overlays.
SPARE_KEYS = [f"rctrl+f{i}" for i in range(1, 13)] + [f"rctrl+np_{i}" for i in range(10)]


def game_running() -> bool:
    if sys.platform != "win32":
        return False
    try:
        out = subprocess.run(["tasklist", "/FI", "IMAGENAME eq StarCitizen.exe", "/NH"], capture_output=True,
                             text=True, timeout=5, creationflags=0x08000000).stdout
        return "starcitizen.exe" in out.lower()
    except (OSError, subprocess.SubprocessError):
        return False


def plan(actions: list[str], current: dict, applied: dict) -> dict[str, str]:
    """Pick a spare key for each action that needs one. current = parsed actionmaps."""
    taken = {v.get("keys") for v in current.values() if v.get("keys")} | set(applied.values())
    free = [k for k in SPARE_KEYS if k not in taken]
    out = {}
    for act in actions:
        if act not in WIRABLE or act in out:
            continue
        cur = current.get(act)
        if cur and cur.get("keys"):
            continue                       # already has a key (yours or ours)
        if act in applied and applied[act] not in {v.get("keys") for k, v in current.items() if k != act}:
            out[act] = applied[act]        # reuse the key we gave it before (after a patch reset)
            continue
        if not free:
            break
        out[act] = free.pop(0)
    return out


def write(path: Path, assignments: dict[str, str], backup_dir: Path) -> Path:
    """Add the rebinds to actionmaps.xml. Returns the backup path."""
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup = backup_dir / f"actionmaps-{time.strftime('%Y%m%d-%H%M%S')}.xml"
    shutil.copy2(path, backup)
    tree = ET.parse(path)
    root = tree.getroot()
    profiles = root.findall("ActionProfiles")
    prof = next((p for p in profiles if p.get("profileName") == "default"), profiles[0] if profiles else None)
    if prof is None:
        raise ValueError("actionmaps.xml has no control profile yet; start Star Citizen once first")
    for act, keys in assignments.items():
        for map_name in WIRABLE[act]:
            am = next((m for m in prof.findall("actionmap") if m.get("name") == map_name), None)
            if am is None:
                am = ET.SubElement(prof, "actionmap", {"name": map_name})
            a = next((x for x in am.findall("action") if x.get("name") == act), None)
            if a is None:
                a = ET.SubElement(am, "action", {"name": act})
            for rb in list(a.findall("rebind")):
                if rb.get("input", "").startswith("kb"):
                    a.remove(rb)
            ET.SubElement(a, "rebind", {"input": f"kb1_{keys}"})
    ET.indent(tree, space=" ")
    tmp = path.with_suffix(".scglass.tmp")
    tree.write(tmp, encoding="utf-8", xml_declaration=False)
    tmp.replace(path)
    log(f"* Wired {len(assignments)} controls in {path.name} (backup: {backup.name})")
    return backup


def unwire(path: Path, applied: dict[str, str], backup_dir: Path) -> int:
    """Remove only the spare keys SC Glass added, leaving every other change (yours, the game's) alone.
    Keeps a backup first. Returns how many keys were removed."""
    backup_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, backup_dir / f"actionmaps-{time.strftime('%Y%m%d-%H%M%S')}-before-undo.xml")
    tree = ET.parse(path)
    removed = 0
    for prof in tree.getroot().findall("ActionProfiles"):
        for am in prof.findall("actionmap"):
            for a in list(am.findall("action")):
                keys = applied.get(a.get("name", ""))
                if not keys:
                    continue
                for rb in list(a.findall("rebind")):
                    if rb.get("input") == f"kb1_{keys}":
                        a.remove(rb)
                        removed += 1
                if len(a) == 0:
                    am.remove(a)
    ET.indent(tree, space=" ")
    tmp = path.with_suffix(".scglass.tmp")
    tree.write(tmp, encoding="utf-8", xml_declaration=False)
    tmp.replace(path)
    log(f"* Removed {removed} spare keys from {path.name}")
    return removed


def restore(path: Path, backup: Path):
    shutil.copy2(backup, path)
    log(f"* Restored {path.name} from {backup.name}")
