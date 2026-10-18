"""Live data from the UEX community API (https://uexcorp.space). Read endpoints need no key.
Cached on disk so the deck works offline with the last good data."""
from __future__ import annotations

import json
import re
import time
import urllib.request
from pathlib import Path

from .util import log

BASE = "https://api.uexcorp.uk/2.0/"
TTL = {"vehicles": 86400, "commodities": 86400, "commodities_prices_all": 900}
ROLE_FLAGS = ["mining", "salvage", "cargo", "military", "bomber", "exploration", "medical", "refuel",
              "repair", "racing", "passenger", "scanning", "interdiction", "industrial", "ground_vehicle", "stealth"]


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


class UEX:
    def __init__(self, cache_dir: Path):
        self.dir = cache_dir
        self.dir.mkdir(parents=True, exist_ok=True)
        self.mem: dict[str, tuple[float, list]] = {}
        self.error = ""

    def _get(self, ep: str) -> list:
        now = time.time()
        if ep in self.mem and now - self.mem[ep][0] < TTL[ep]:
            return self.mem[ep][1]
        f = self.dir / f"{ep}.json"
        if f.is_file() and now - f.stat().st_mtime < TTL[ep]:
            try:
                data = json.loads(f.read_text("utf-8"))
                self.mem[ep] = (f.stat().st_mtime, data)
                return data
            except ValueError:
                pass
        try:
            req = urllib.request.Request(BASE + ep + "/", headers={"User-Agent": "SC-Glass/2"})
            with urllib.request.urlopen(req, timeout=20) as r:
                body = json.loads(r.read().decode("utf-8"))
            data = body.get("data") or []
            if body.get("status") != "ok":
                raise ValueError(body.get("message", "bad response"))
            f.write_text(json.dumps(data), "utf-8")
            self.mem[ep] = (now, data)
            self.error = ""
            return data
        except Exception as e:  # noqa: BLE001 - offline is normal; fall back to stale cache
            self.error = f"UEX unavailable ({e.__class__.__name__})"
            if f.is_file():
                try:
                    data = json.loads(f.read_text("utf-8"))
                    self.mem[ep] = (now - TTL[ep] + 300, data)   # retry in 5 minutes
                    return data
                except ValueError:
                    pass
            self.mem[ep] = (now - TTL[ep] + 120, [])   # offline: don't retry for 2 minutes
            return []

    # ---- ships ----
    def ship(self, name: str) -> dict | None:
        """Match a Game.log ship name ('Drake Cutlass Black') to a UEX vehicle."""
        if not name:
            return None
        n = _norm(name)
        best, score = None, 0
        for v in self._get("vehicles"):
            full, short = _norm(v.get("name_full", "")), _norm(v.get("name", ""))
            s = 0
            if n == full:
                s = 100
            elif n == short:
                s = 90
            elif full and (full in n or n in full):
                s = 50 + len(full)
            elif short and len(short) > 3 and short in n:
                s = 30 + len(short)
            if s > score:
                best, score = v, s
        if not best:
            return None
        roles = [r for r in ROLE_FLAGS if str(best.get(f"is_{r}", 0)) == "1"]
        return {"name": best.get("name_full") or best.get("name"), "maker": best.get("company_name", ""),
                "scu": best.get("scu"), "crew": best.get("crew"), "pad": best.get("pad_type", ""),
                "fuel_quantum": best.get("fuel_quantum"), "fuel_hydrogen": best.get("fuel_hydrogen"),
                "length": best.get("length"), "mass": best.get("mass"), "roles": roles}

    # ---- market ----
    def commodities(self) -> list[str]:
        names = sorted({c.get("name", "") for c in self._get("commodities") if c.get("name")})
        return names

    def market(self, commodity: str, limit: int = 8) -> dict:
        rows = [r for r in self._get("commodities_prices_all")
                if _norm(r.get("commodity_name", "")) == _norm(commodity)]
        sell = sorted((r for r in rows if (r.get("price_sell") or 0) > 0), key=lambda r: -r["price_sell"])[:limit]
        buy = sorted((r for r in rows if (r.get("price_buy") or 0) > 0), key=lambda r: r["price_buy"])[:limit]
        pick = lambda r, k: {"terminal": r.get("terminal_name", "?"), "price": r.get(k), "updated": r.get("date_modified")}
        return {"commodity": commodity, "sell": [pick(r, "price_sell") for r in sell],
                "buy": [pick(r, "price_buy") for r in buy], "error": self.error if not rows else ""}

    def warm(self):
        for ep in ("vehicles", "commodities"):
            n = len(self._get(ep))
            log(f"* UEX {ep}: {n} entries" if n else f"! UEX {ep}: {self.error or 'empty'}")
