"""Run with:  python -m unittest discover tests"""
import asyncio
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from glass.keys import parse_keys  # noqa: E402
from glass.starcitizen import GameLog, Session, parse_actionmaps  # noqa: E402
from glass.uex import UEX  # noqa: E402

N = 'Added notification "'


class Keys(unittest.TestCase):
    def test_order_and_validation(self):
        self.assertEqual(parse_keys("f6+lalt"), ["lalt", "f6"])
        self.assertEqual(parse_keys("u+lshift"), ["lshift", "u"])
        self.assertEqual(parse_keys("vjoy_b12"), ["vjoy_b12"])
        for bad in ("lalt+foo", "", "vjoy_b0"):
            with self.assertRaises(ValueError):
                parse_keys(bad)


class ActionMaps(unittest.TestCase):
    def test_rebinds(self):
        xml = """<ActionMaps><ActionProfiles profileName="default">
          <actionmap name="spaceship_movement">
            <action name="v_toggle_landing_system"><rebind input="kb1_f13"/></action>
            <action name="v_vtol_toggle"><rebind input="kb1_ "/></action>
            <action name="v_master_mode_cycle_long"><rebind input="kb1_b+lalt" activationMode="delayed_press_medium"/></action>
          </actionmap>
          <actionmap name="spaceship_quantum">
            <action name="v_toggle_qdrive_engagement"><rebind input="mo1_mouse1"/><rebind input="js1_button3"/></action>
          </actionmap></ActionProfiles></ActionMaps>"""
        with tempfile.TemporaryDirectory() as d:
            p = Path(d, "actionmaps.xml"); p.write_text(xml)
            m = parse_actionmaps(p)
        self.assertEqual(m["v_toggle_landing_system"]["keys"], "f13")
        self.assertEqual(m["v_vtol_toggle"]["keys"], "")
        self.assertEqual(m["v_master_mode_cycle_long"], {"keys": "lalt+b", "mode": "delayed_press_medium"})
        self.assertEqual(m["v_toggle_qdrive_engagement"]["keys"], "mouse1")


class GameLogTail(unittest.TestCase):
    def test_session(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d, "Game.log")
            p.write_text('<2026-10-18T10:00:01.000Z> nickname="Pilot" playerGEID=1\n'
                         f"<2026-10-18T10:03:00.000Z> {N}You have joined channel 'Drake Cutlass Black : Pilot': \" [1]\n")
            g, s = GameLog(p), Session()
            for e in g.prime():
                s.apply(e)
            self.assertEqual((s.ship, s.snapshot()["own_ship"]), ("Drake Cutlass Black", True))
            with open(p, "a") as f:
                f.write(f"<2026-10-18T10:04:00.000Z> {N}Contract Accepted:  Haul it: \"\nhalf a li")
            ev, restarted = g.poll()
            self.assertEqual([e["type"] for e in ev], ["contract_accepted"])
            self.assertEqual(g.buf, "half a li")
            p.write_text("x\n")
            self.assertTrue(g.poll()[1])


class ShipRoles(unittest.TestCase):
    def test_match(self):
        with tempfile.TemporaryDirectory() as d:
            Path(d, "vehicles.json").write_text(json.dumps([
                {"name": "Prospector", "name_full": "MISC Prospector", "is_mining": 1},
                {"name": "Cutlass Black", "name_full": "Drake Cutlass Black", "is_cargo": 1, "is_military": 1}]))
            u = UEX(Path(d))
            self.assertEqual(u.ship("MISC Prospector")["roles"], ["mining"])
            self.assertEqual(u.ship("Drake Cutlass Black")["roles"], ["cargo", "military"])


class Engine(unittest.TestCase):
    def test_sequence_order(self):
        from glass.hub import Hub
        from glass.inputs import DryRunBackend, VJoy
        pressed = []

        class Rec(DryRunBackend):
            def key(self, t, down):
                pressed.append(("v" if down else "^") + t)
        cfg = {"port": 0, "pin": "000000", "require_focus": True, "focus_match": "Star Citizen", "channel": "LIVE",
               "actionmaps_path": "/nonexistent", "gamelog_path": "", "custom": {}}
        hub = Hub(cfg, lambda c: None, Rec(), VJoy(), False)
        asyncio.run(hub.sequence([{"keys": "lalt+n", "ms": 20}, {"wait": 10}, {"keys": "o", "ms": 20}]))
        self.assertEqual(pressed, ["vlalt", "vn", "^n", "^lalt", "vo", "^o"])


if __name__ == "__main__":
    unittest.main()
