"""The hub: serves the deck, pairs devices, runs actions in order, watches Star Citizen's files."""
from __future__ import annotations

import asyncio
import json
import mimetypes
import re
import socket
import sys
import time
import webbrowser
from pathlib import Path
from urllib.parse import urlsplit

from . import overlay as ov
from .inputs import DryRunBackend, Keyboard, VJoy
from .keys import MODIFIERS, parse_keys
from .starcitizen import CHANNELS, GameLog, Session, find_actionmaps, find_gamelog, parse_actionmaps
from .uex import UEX
from .util import app_dir, log, res_dir
from .ws import WS, accept_key

VERSION = "2.0.0"
MAX_HOLD_S = 30.0
MAX_PULSE_MS = 5000
DECK_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,47}$")


def lan_addresses() -> list[str]:
    ips = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ips.append(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if ip not in ips and not ip.startswith("127."):
                ips.append(ip)
    except OSError:
        pass
    return ips or ["127.0.0.1"]


class Hub:
    def __init__(self, cfg: dict, save_cfg, backend, vjoy: VJoy, open_browser: bool):
        self.cfg, self.save_cfg = cfg, save_cfg
        self.backend, self.vjoy = backend, vjoy
        self.kb = Keyboard(backend, vjoy)
        self.web = res_dir() / "web"
        self.deck_dir = app_dir() / "decks"
        self.deck_dir.mkdir(exist_ok=True)
        self.uex = UEX(app_dir() / "cache")
        self.overlay = ov.Overlay(app_dir() / "cache" / "overlay-profile")
        self.authed: set[WS] = set()
        self.states: dict = {}
        self.fails: dict[str, list[float]] = {}
        self.focus_ok = None
        self.open_browser = open_browser
        self.queue: asyncio.Queue | None = None
        self.am_path, self.am_mtime, self.am_binds, self.am_error = None, 0.0, {}, ""
        self.session = Session()
        self.gamelog = GameLog(None)
        self.shipinfo: dict | None = None
        self.load_actionmaps()

    # ------------------------------------------------------------------ Star Citizen files
    def load_actionmaps(self):
        p = Path(self.cfg["actionmaps_path"]) if self.cfg.get("actionmaps_path") else find_actionmaps(self.cfg["channel"])
        self.am_path, self.am_error = p, ""
        if not p or not p.is_file():
            self.am_binds = {}
            self.am_error = "Star Citizen keybinds not found" if not p else f"Not found: {p}"
            return
        try:
            self.am_mtime = p.stat().st_mtime
            self.am_binds = parse_actionmaps(p)
            log(f"* Loaded {len(self.am_binds)} rebinds from {p}")
        except Exception as e:  # noqa: BLE001
            self.am_binds, self.am_error = {}, f"Couldn't read {p.name}: {e}"
            log("! " + self.am_error)

    def am_info(self):
        return {"path": str(self.am_path or ""), "count": len(self.am_binds), "error": self.am_error,
                "channel": self.cfg["channel"]}

    def open_gamelog(self, quiet: bool = False):
        p = Path(self.cfg["gamelog_path"]) if self.cfg.get("gamelog_path") else find_gamelog(self.cfg["channel"])
        self.gamelog = GameLog(p if p and p.is_file() else None)
        self.session.reset()
        for ev in self.gamelog.prime():
            self.session.apply(ev, live=False)
        if self.gamelog.path:
            s = self.session
            log(f"* Game.log: {self.gamelog.path}" + (f"  (in {s.ship})" if s.ship else ""))
        elif not quiet:
            log("! Game.log not found; ship detection is off until Star Citizen has run once")

    def game_info(self):
        return {**self.session.snapshot(), "log": str(self.gamelog.path or ""), "log_error": self.gamelog.error,
                "shipinfo": self.shipinfo}

    async def lookup_ship(self):
        name = self.session.ship
        self.shipinfo = await asyncio.to_thread(self.uex.ship, name) if name else None

    async def watch_files(self):
        while True:
            await asyncio.sleep(0.5)
            try:
                if self.am_path and self.am_path.is_file() and self.am_path.stat().st_mtime != self.am_mtime:
                    await asyncio.sleep(0.5)
                    self.load_actionmaps()
                    await self.broadcast(self.bindings_msg())
                if not self.gamelog.path:
                    if int(time.time() * 2) % 20 == 0:
                        self.open_gamelog(quiet=True)
                    continue
                events, restarted = self.gamelog.poll()
                if restarted:
                    self.session.reset()
                    self.shipinfo = None
                    await self.broadcast({"t": "game", "ev": {"type": "game_restarted", "data": {}}, "game": self.game_info()})
                for ev in events:
                    before = self.session.ship
                    self.session.apply(ev)
                    if self.session.ship != before:
                        await self.lookup_ship()
                    await self.broadcast({"t": "game", "ev": ev, "game": self.game_info()})
            except Exception as e:  # noqa: BLE001 - never let a weird log line stop the watcher
                log(f"! watcher: {e}")

    # ------------------------------------------------------------------ focus
    def focused(self):
        title = self.backend.foreground_title()
        if title is None:
            return None
        if ov.TITLE.lower() in title.lower():
            return True     # our own overlay; refocus happens just before sending
        return self.cfg["focus_match"].lower() in title.lower()

    async def watch_focus(self):
        while True:
            await asyncio.sleep(1)
            f = self.focused()
            if f != self.focus_ok:
                self.focus_ok = f
                await self.broadcast({"t": "focus", "ok": f})

    def gate(self) -> str | None:
        title = self.backend.foreground_title()
        if title is not None and ov.TITLE.lower() in title.lower():
            self.backend.refocus_game(self.cfg["focus_match"])
            return None
        if self.cfg["require_focus"] and self.focused() is False:
            return "focus"
        return None

    # ------------------------------------------------------------------ decks
    def load_decks(self) -> list[dict]:
        out = []
        for f in sorted(self.deck_dir.glob("*.json")):
            try:
                d = json.loads(f.read_text("utf-8"))
                if isinstance(d, dict) and DECK_ID.match(str(d.get("id", ""))):
                    out.append(d)
            except (OSError, ValueError):
                log(f"! skipped unreadable deck {f.name}")
        return out

    def save_deck(self, deck: dict):
        if not isinstance(deck, dict) or not DECK_ID.match(str(deck.get("id", ""))):
            raise ValueError("deck needs an id of lowercase letters, digits and dashes")
        if not isinstance(deck.get("pages"), list):
            raise ValueError("deck has no pages")
        body = json.dumps(deck, indent=1)
        if len(body) > 600_000:
            raise ValueError("deck is too large")
        tmp = self.deck_dir / f"{deck['id']}.tmp"
        tmp.write_text(body, "utf-8")
        tmp.replace(self.deck_dir / f"{deck['id']}.json")

    def delete_deck(self, deck_id: str):
        if not DECK_ID.match(deck_id):
            raise ValueError("bad deck id")
        p = self.deck_dir / f"{deck_id}.json"
        if p.exists():
            p.unlink()

    # ------------------------------------------------------------------ messages
    def bindings_msg(self):
        return {"t": "bindings", "sc": self.am_binds, "custom": self.cfg["custom"], "actionmaps": self.am_info()}

    def welcome(self):
        return {"t": "welcome", "version": VERSION, "backend": self.backend.name, "platform": sys.platform,
                "sc": self.am_binds, "custom": self.cfg["custom"], "actionmaps": self.am_info(),
                "states": self.states, "focus": self.focused(), "decks": self.load_decks(),
                "game": self.game_info(), "vjoy": self.vjoy.info(),
                "overlay": {"available": ov.available(), "running": self.overlay.running(), "monitors": ov.monitors()},
                "settings": {"require_focus": self.cfg["require_focus"], "channel": self.cfg["channel"]}}

    async def broadcast(self, obj, skip=None):
        for c in list(self.authed):
            if c is not skip:
                await c.send(obj)

    # ------------------------------------------------------------------ action engine
    async def worker(self):
        """Runs taps, macros and sequences strictly one after another, like a real keyboard would."""
        while True:
            job = await self.queue.get()
            try:
                await job
            except OSError as e:
                log(f"! input error: {e}")
                await self.broadcast({"t": "error", "msg": str(e)})
            except Exception as e:  # noqa: BLE001
                log(f"! action failed: {e}")

    async def pulse(self, keys: list[str], ms: int, repeat: int = 1, gap: int = 60):
        for i in range(max(1, min(repeat, 5))):
            if i:
                await asyncio.sleep(gap / 1000)
            mods = [k for k in keys if k in MODIFIERS]
            rest = [k for k in keys if k not in MODIFIERS]
            log(f"> {'+'.join(keys)}  {ms}ms")
            try:
                for k in mods:
                    self.kb.press(k)
                if mods:
                    await asyncio.sleep(0.02)
                for k in rest:
                    self.kb.press(k)
                await asyncio.sleep(ms / 1000)
            finally:
                for k in reversed(rest):
                    self.kb.release(k)
                if mods:
                    await asyncio.sleep(0.01)
                for k in reversed(mods):
                    self.kb.release(k)

    async def sequence(self, steps: list):
        for st in steps[:64]:
            if "wait" in st:
                await asyncio.sleep(max(0, min(int(st["wait"]), 10000)) / 1000)
            elif "keys" in st:
                ms = max(20, min(int(st.get("ms", 70)), MAX_PULSE_MS))
                await self.pulse(parse_keys(st["keys"]), ms, int(st.get("repeat", 1)), int(st.get("gap", 60)))
                await asyncio.sleep(0.04)
            elif "axis" in st:
                self.vjoy.axis(str(st["axis"]), float(st["value"]))

    # ------------------------------------------------------------------ sessions
    async def session_loop(self, ws: WS):
        holds: dict[str, tuple[list[str], float]] = {}
        log(f"+ {ws.peer} connected")

        async def release(hid):
            item = holds.pop(hid, None)
            if item:
                for t in reversed(item[0]):
                    self.kb.release(t)

        async def watchdog():
            while True:
                await asyncio.sleep(1)
                now = time.monotonic()
                for hid, (_, t0) in list(holds.items()):
                    if now - t0 > MAX_HOLD_S:
                        await release(hid)

        wd = asyncio.create_task(watchdog())
        try:
            while True:
                raw = await ws.recv()
                if raw is None:
                    break
                try:
                    m = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                t = m.get("t")
                if t == "hello":
                    await self.hello(ws, m)
                    continue
                if ws not in self.authed:
                    await ws.send({"t": "denied", "reason": "pin"})
                    continue
                mid = m.get("id")
                try:
                    await self.handle_msg(ws, m, t, mid, holds, release)
                except (KeyError, ValueError, TypeError) as e:
                    await ws.send({"t": "ack", "id": mid, "ok": False, "err": str(e)})
                except OSError as e:
                    log(f"! input error: {e}")
                    await ws.send({"t": "ack", "id": mid, "ok": False, "err": str(e)})
        except (asyncio.IncompleteReadError, ConnectionError):
            pass
        finally:
            wd.cancel()
            for hid in list(holds):
                await release(hid)
            self.authed.discard(ws)
            ws.closed = True
            log(f"- {ws.peer} disconnected")

    async def hello(self, ws: WS, m: dict):
        ip = ws.peer.rsplit(":", 1)[0]
        recent = [x for x in self.fails.get(ip, []) if time.time() - x < 60]
        if len(recent) >= 5:
            return await ws.send({"t": "denied", "reason": "locked"})
        if str(m.get("pin", "")) == self.cfg["pin"]:
            self.authed.add(ws)
            ws.meta["client"] = str(m.get("client", "deck"))[:40]
            await ws.send(self.welcome())
            log(f"  {ws.peer} paired ({ws.meta['client']})")
        else:
            self.fails[ip] = recent + [time.time()]
            await ws.send({"t": "denied", "reason": "pin"})

    async def handle_msg(self, ws, m, t, mid, holds, release):
        ack = lambda ok=True, **kw: ws.send({"t": "ack", "id": mid, "ok": ok, **kw})
        if t == "ping":
            return await ws.send({"t": "pong", "ts": m.get("ts")})
        if t in ("pulse", "seq"):
            err = self.gate()
            if err:
                return await ack(False, err=err)
            if t == "pulse":
                keys = parse_keys(m["keys"])
                ms = max(20, min(int(m.get("ms", 70)), MAX_PULSE_MS))
                job = self.pulse(keys, ms, int(m.get("repeat", 1)), int(m.get("gap", 60)))
            else:
                steps = m["steps"]
                for st in steps:
                    if "keys" in st:
                        parse_keys(st["keys"])     # validate before queueing anything
                job = self.sequence(steps)
            await ack()
            return self.queue.put_nowait(job)
        if t == "down":
            err = self.gate()
            if err:
                return await ack(False, err=err)
            keys = parse_keys(m["keys"])
            hid = str(m.get("hid"))
            await release(hid)
            for k in keys:
                self.kb.press(k)
                if k in MODIFIERS:
                    await asyncio.sleep(0.015)
            holds[hid] = (keys, time.monotonic())
            return await ack()
        if t == "up":
            return await release(str(m.get("hid")))
        if t == "release_all":
            for hid in list(holds):
                await release(hid)
            return
        if t == "move":
            if self.gate():
                return
            dx = max(-800, min(800, int(m.get("dx", 0))))
            dy = max(-800, min(800, int(m.get("dy", 0))))
            return self.backend.move(dx, dy)
        if t == "axis":
            if self.vjoy.ok:
                self.vjoy.axis(str(m["axis"]), float(m["value"]))
            return
        if t == "bind":
            action, keys = str(m["action"]), m.get("keys")
            if keys is None:
                self.cfg["custom"].pop(action, None)
            else:
                keys = "+".join(parse_keys(keys)) if keys else ""
                self.cfg["custom"][action] = {"keys": keys, "mode": m.get("mode")}
            self.save_cfg(self.cfg)
            await self.broadcast(self.bindings_msg())
            return await ack()
        if t == "state":
            self.states[str(m["key"])] = m.get("value")
            return await self.broadcast({"t": "states", "states": self.states}, skip=ws)
        if t == "states":
            self.states.update({str(k): v for k, v in dict(m["states"]).items()})
            return await self.broadcast({"t": "states", "states": self.states}, skip=ws)
        if t == "reset_states":
            self.states = dict(m.get("states") or {})
            return await self.broadcast({"t": "states", "states": self.states})
        if t == "reload":
            self.load_actionmaps()
            self.open_gamelog()
            await self.lookup_ship()
            await self.broadcast(self.bindings_msg())
            await self.broadcast({"t": "game", "ev": {"type": "reloaded", "data": {}}, "game": self.game_info()})
            return await ack()
        if t == "settings":
            if "require_focus" in m:
                self.cfg["require_focus"] = bool(m["require_focus"])
            if m.get("channel") in CHANNELS:
                self.cfg["channel"] = m["channel"]
                self.cfg["actionmaps_path"] = self.cfg["gamelog_path"] = ""
                self.load_actionmaps()
                self.open_gamelog()
                await self.lookup_ship()
            self.save_cfg(self.cfg)
            return await self.broadcast(self.welcome())
        if t == "deck_save":
            self.save_deck(m["deck"])
            await ack()
            return await self.broadcast({"t": "decks", "decks": self.load_decks(), "changed": m["deck"]["id"],
                                         "by": ws.meta.get("client", "")}, skip=ws)
        if t == "deck_delete":
            self.delete_deck(str(m["deck_id"]))
            await ack()
            return await self.broadcast({"t": "decks", "decks": self.load_decks()})
        if t == "market":
            data = await asyncio.to_thread(self.uex.market, str(m["commodity"]))
            return await ws.send({"t": "market", "id": mid, **data})
        if t == "commodities":
            names = await asyncio.to_thread(self.uex.commodities)
            return await ws.send({"t": "commodities", "id": mid, "names": names, "error": self.uex.error if not names else ""})
        if t == "overlay_open":
            mons = ov.monitors()
            mon = next((x for x in mons if x["id"] == m.get("monitor")), None) or ov.default_monitor(mons)
            if not mon:
                return await ack(False, err="No monitor found")
            url = f"http://localhost:{self.cfg['port']}/?overlay=1#pin={self.cfg['pin']}"
            err = self.overlay.open(url, mon)
            if err:
                return await ack(False, err=err)
            asyncio.get_running_loop().run_in_executor(None, self.overlay.harden, mon)
            return await ack()
        if t == "overlay_close":
            self.overlay.close()
            return await ack()

    # ------------------------------------------------------------------ HTTP
    async def handle(self, reader, writer):
        peer = "%s:%s" % writer.get_extra_info("peername")[:2]
        try:
            head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 10)
        except (asyncio.IncompleteReadError, asyncio.LimitOverrunError, asyncio.TimeoutError, ConnectionError):
            writer.close()
            return
        lines = head.decode("latin-1").split("\r\n")
        try:
            method, target, _ = lines[0].split(" ", 2)
        except ValueError:
            writer.close()
            return
        hdrs = {}
        for ln in lines[1:]:
            if ":" in ln:
                k, v = ln.split(":", 1)
                hdrs[k.strip().lower()] = v.strip()
        path = urlsplit(target).path
        local = peer.startswith("127.") or peer.startswith("::1")

        if path == "/ws" and hdrs.get("upgrade", "").lower() == "websocket":
            writer.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                          f"Sec-WebSocket-Accept: {accept_key(hdrs.get('sec-websocket-key', ''))}\r\n\r\n").encode())
            await writer.drain()
            sock = writer.get_extra_info("socket")
            if sock is not None:
                sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            await self.session_loop(WS(reader, writer, peer))
            writer.close()
            return
        if method != "GET":
            return await self.respond(writer, 405, b"Method not allowed", "text/plain")
        if path == "/api/info":
            return await self.respond(writer, 200, json.dumps({"app": "sc-glass", "version": VERSION}).encode(), "application/json")
        if path == "/api/pair":
            if not local:
                return await self.respond(writer, 403, b"Pairing info is only shown on this PC.", "text/plain")
            body = json.dumps({"pin": self.cfg["pin"], "port": self.cfg["port"], "ips": lan_addresses(),
                               "backend": self.backend.name, "actionmaps": self.am_info(),
                               "gamelog": str(self.gamelog.path or ""), "vjoy": self.vjoy.info()}).encode()
            return await self.respond(writer, 200, body, "application/json")
        if path in ("/", ""):
            path = "/index.html"
        if path == "/pair":
            path = "/pair.html"
        f = (self.web / path.lstrip("/")).resolve()
        if self.web.resolve() not in f.parents or not f.is_file():
            return await self.respond(writer, 404, b"Not found", "text/plain")
        ctype = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
        if f.suffix == ".webmanifest":
            ctype = "application/manifest+json"
        elif f.suffix == ".js":
            ctype = "text/javascript"
        await self.respond(writer, 200, f.read_bytes(), ctype)

    async def respond(self, writer, code, body: bytes, ctype):
        reason = {200: "OK", 403: "Forbidden", 404: "Not Found", 405: "Method Not Allowed"}.get(code, "OK")
        if ctype.startswith("text/") or ctype.endswith(("json", "javascript")):
            ctype += "; charset=utf-8"
        writer.write((f"HTTP/1.1 {code} {reason}\r\nContent-Type: {ctype}\r\nContent-Length: {len(body)}\r\n"
                      "Cache-Control: no-store\r\nConnection: close\r\n\r\n").encode() + body)
        try:
            await writer.drain()
        finally:
            writer.close()

    # ------------------------------------------------------------------ run
    async def run(self, host: str):
        self.queue = asyncio.Queue()
        port = self.cfg["port"]
        server = await asyncio.start_server(self.handle, host, port)
        self.open_gamelog()
        ips = lan_addresses()
        bar = "=" * 64
        print(f"\n{bar}\n  SC GLASS {VERSION}   input: {self.backend.name}\n{bar}")
        print("  On your tablet or phone (same Wi-Fi), open:")
        for ip in ips:
            print(f"      http://{ip}:{port}")
        print(f"\n  Pairing PIN:  {self.cfg['pin']}")
        print(f"  QR code:      http://localhost:{port}/pair" + ("   (opening now)" if self.open_browser else ""))
        am = self.am_info()
        print("\n  Keybinds:     " + (f"{am['count']} rebinds from your Star Citizen profile" if not am["error"]
                                     else f"{am['error']}, using game defaults"))
        print("  Game.log:     " + (str(self.gamelog.path) if self.gamelog.path else "not found yet"))
        print("  vJoy:         " + ("device %d ready" % self.vjoy.device if self.vjoy.ok else self.vjoy.error))
        print(f"  Keys only go to Star Citizen when it's in front: {'yes' if self.cfg['require_focus'] else 'no'}")
        print(f"{bar}\n  Ctrl+C to quit.\n")
        if self.open_browser:
            try:
                webbrowser.open(f"http://localhost:{port}/pair")
            except Exception:  # noqa: BLE001
                pass
        async def warm():
            await asyncio.to_thread(self.uex.warm)
            await self.lookup_ship()
            if self.shipinfo:
                await self.broadcast({"t": "game", "ev": {"type": "ship_info", "data": {}}, "game": self.game_info()})
        bg = [asyncio.create_task(c) for c in (self.worker(), self.watch_files(), self.watch_focus(), warm())]
        try:
            async with server:
                await server.serve_forever()
        finally:
            for b in bg:
                b.cancel()

    def shutdown(self):
        self.kb.release_all()
        self.overlay.close()
        self.vjoy.close()


def make_backend(dry_run: bool):
    if sys.platform == "win32" and not dry_run:
        from .inputs import WinBackend
        return WinBackend()
    if sys.platform != "win32":
        print("(Not on Windows: dry-run mode, keys are logged instead of pressed.)")
    return DryRunBackend()
