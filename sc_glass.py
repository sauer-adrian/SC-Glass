#!/usr/bin/env python3
"""
SC Glass companion: turns taps on your phone, tablet or PC touchscreen into Star Citizen input.

    python sc_glass.py            (or double-click start.bat / SCGlass.exe)

Standard library only. On Windows it sends real input with SendInput and hardware scancodes,
and drives an optional vJoy virtual joystick for analog sliders. Elsewhere it runs as a dry run.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import secrets
import sys

from glass.hub import Hub, make_backend
from glass.inputs import VJoy
from glass.util import app_dir, log

CONFIG_PATH = app_dir() / "sc_glass_config.json"


def load_config() -> dict:
    cfg = {}
    if CONFIG_PATH.exists():
        try:
            cfg = json.loads(CONFIG_PATH.read_text("utf-8"))
        except ValueError as e:
            log(f"! config unreadable ({e}); starting fresh")
    defaults = {"port": 8710, "pin": f"{secrets.randbelow(1000000):06d}", "require_focus": True,
                "focus_match": "Star Citizen", "channel": "LIVE", "actionmaps_path": "", "gamelog_path": "",
                "vjoy_device": 1, "custom": {}}
    for k, v in defaults.items():
        cfg.setdefault(k, v)
    return cfg


def save_config(cfg: dict):
    tmp = CONFIG_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(cfg, indent=2), "utf-8")
    os.replace(tmp, CONFIG_PATH)


def main():
    ap = argparse.ArgumentParser(description="SC Glass companion for Star Citizen")
    ap.add_argument("--port", type=int, help="port to listen on (default 8710)")
    ap.add_argument("--host", default="0.0.0.0", help="network interface to listen on")
    ap.add_argument("--dry-run", action="store_true", help="log keys instead of pressing them")
    ap.add_argument("--no-browser", action="store_true", help="don't open the pairing page")
    ap.add_argument("--new-pin", action="store_true", help="make a new pairing PIN")
    ap.add_argument("--actionmaps", help="path to your Star Citizen actionmaps.xml")
    ap.add_argument("--gamelog", help="path to Star Citizen's Game.log")
    a = ap.parse_args()

    cfg = load_config()
    if a.port:
        cfg["port"] = a.port
    if a.new_pin:
        cfg["pin"] = f"{secrets.randbelow(1000000):06d}"
    if a.actionmaps:
        cfg["actionmaps_path"] = a.actionmaps
    if a.gamelog:
        cfg["gamelog_path"] = a.gamelog
    save_config(cfg)

    if sys.platform == "win32":
        try:   # let the console show the pairing QR code
            import ctypes
            ctypes.windll.kernel32.SetConsoleOutputCP(65001)
        except (OSError, AttributeError):
            pass
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass
    backend = make_backend(a.dry_run)
    vjoy = VJoy(int(cfg.get("vjoy_device", 1)))
    hub = Hub(cfg, save_config, backend, vjoy, open_browser=not a.no_browser)
    try:
        asyncio.run(hub.run(a.host))
    except KeyboardInterrupt:
        print("\nBye.")
    except OSError as e:
        print(f"\nCould not start on port {cfg['port']}: {e}\nTry: start.bat --port 8711")
    finally:
        hub.shutdown()


if __name__ == "__main__":
    main()
