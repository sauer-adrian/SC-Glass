"""Input backends: Windows SendInput (scancodes, mouse), vJoy virtual joystick, and a dry-run logger."""
from __future__ import annotations

import os
import sys
from pathlib import Path

from .keys import SC, MOUSE, is_vjoy
from .util import log


class DryRunBackend:
    name = "dry-run"

    def key(self, token: str, down: bool):
        log(f"   {'v' if down else '^'} {token}")

    def move(self, dx: int, dy: int):
        log(f"   mouse move {dx:+d},{dy:+d}")

    def foreground_title(self):
        return None

    def refocus_game(self, match: str) -> bool:
        return False


class WinBackend:
    name = "windows"

    def __init__(self):
        import ctypes
        from ctypes import wintypes
        self.ctypes, self.wintypes = ctypes, wintypes
        ULONG_PTR = ctypes.c_size_t
        WORD, DWORD, LONG = ctypes.c_uint16, ctypes.c_uint32, ctypes.c_int32   # fixed widths, as on Windows

        class KEYBDINPUT(ctypes.Structure):
            _fields_ = [("wVk", WORD), ("wScan", WORD), ("dwFlags", DWORD), ("time", DWORD), ("dwExtraInfo", ULONG_PTR)]

        class MOUSEINPUT(ctypes.Structure):
            _fields_ = [("dx", LONG), ("dy", LONG), ("mouseData", DWORD), ("dwFlags", DWORD), ("time", DWORD),
                        ("dwExtraInfo", ULONG_PTR)]

        class HARDWAREINPUT(ctypes.Structure):
            _fields_ = [("uMsg", DWORD), ("wParamL", WORD), ("wParamH", WORD)]

        class _U(ctypes.Union):
            _fields_ = [("ki", KEYBDINPUT), ("mi", MOUSEINPUT), ("hi", HARDWAREINPUT)]

        class INPUT(ctypes.Structure):
            _anonymous_ = ("u",)
            _fields_ = [("type", DWORD), ("u", _U)]

        self.INPUT, self.KEYBDINPUT, self.MOUSEINPUT = INPUT, KEYBDINPUT, MOUSEINPUT
        u = self.user32 = ctypes.WinDLL("user32", use_last_error=True)
        u.SendInput.argtypes = (wintypes.UINT, ctypes.POINTER(INPUT), ctypes.c_int)
        u.SendInput.restype = wintypes.UINT
        u.GetForegroundWindow.restype = wintypes.HWND
        u.GetWindowTextW.argtypes = (wintypes.HWND, wintypes.LPWSTR, ctypes.c_int)
        u.SetForegroundWindow.argtypes = (wintypes.HWND,)
        u.IsWindowVisible.argtypes = (wintypes.HWND,)
        self.WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
        u.EnumWindows.argtypes = (self.WNDENUMPROC, wintypes.LPARAM)

    def _send(self, inp):
        n = self.user32.SendInput(1, self.ctypes.byref(inp), self.ctypes.sizeof(inp))
        if n != 1:
            err = self.ctypes.get_last_error()
            raise OSError(f"Windows blocked the input (error {err}). If Star Citizen runs as administrator, "
                          f"run SC Glass as administrator too.")

    def key(self, token: str, down: bool):
        if token in MOUSE:
            return self._mouse(token, down)
        code, ext = SC[token]
        flags = 0x0008 | (0x0001 if ext else 0) | (0 if down else 0x0002)   # SCANCODE | EXTENDED | KEYUP
        inp = self.INPUT(type=1)
        inp.ki = self.KEYBDINPUT(0, code, flags, 0, 0)
        self._send(inp)

    def _mouse(self, token: str, down: bool):
        if token in ("mwheel_up", "mwheel_down"):
            if not down:
                return
            flags, data = 0x0800, (120 if token == "mwheel_up" else (-120 & 0xFFFFFFFF))
        else:
            d, u, x = {"mouse1": (0x2, 0x4, 0), "mouse2": (0x8, 0x10, 0), "mouse3": (0x20, 0x40, 0),
                       "mouse4": (0x80, 0x100, 1), "mouse5": (0x80, 0x100, 2)}[token]
            flags, data = (d if down else u), x
        inp = self.INPUT(type=0)
        inp.mi = self.MOUSEINPUT(0, 0, data, flags, 0, 0)
        self._send(inp)

    def move(self, dx: int, dy: int):
        inp = self.INPUT(type=0)
        inp.mi = self.MOUSEINPUT(int(dx), int(dy), 0, 0x0001, 0, 0)   # MOUSEEVENTF_MOVE (relative)
        self._send(inp)

    def _title(self, hwnd) -> str:
        buf = self.ctypes.create_unicode_buffer(256)
        self.user32.GetWindowTextW(hwnd, buf, 256)
        return buf.value

    def foreground_title(self):
        hwnd = self.user32.GetForegroundWindow()
        return self._title(hwnd) if hwnd else ""

    def find_window(self, match: str):
        found = []

        def cb(hwnd, _):
            if self.user32.IsWindowVisible(hwnd) and match.lower() in self._title(hwnd).lower():
                found.append(hwnd)
                return False
            return True
        self.user32.EnumWindows(self.WNDENUMPROC(cb), 0)
        return found[0] if found else None

    def refocus_game(self, match: str) -> bool:
        """Bring Star Citizen back to the front (used when a PC-side overlay took focus).
        A synthetic Alt tap gives this process the right to change the foreground window."""
        hwnd = self.find_window(match)
        if not hwnd:
            return False
        self.user32.keybd_event(0x12, 0, 0, 0)
        self.user32.keybd_event(0x12, 0, 0x0002, 0)
        return bool(self.user32.SetForegroundWindow(hwnd))


class VJoy:
    """Optional virtual joystick through vJoy (github.com/BrunnerInnovation/vJoy, v2.2.x).
    Gives sliders and levers real analog axes, and adds up to 128 joystick buttons."""
    AXES = {"x": 0x30, "y": 0x31, "z": 0x32, "rx": 0x33, "ry": 0x34, "rz": 0x35, "sl0": 0x36, "sl1": 0x37}
    MAX = 0x8000

    def __init__(self, device: int = 1):
        self.ok = False
        self.error = ""
        self.device = device
        self.axes: list[str] = []
        self.buttons = 0
        self.dll = None
        if sys.platform != "win32":
            self.error = "Virtual joystick needs Windows"
            return
        import ctypes
        paths = [os.environ.get("VJOY_DLL", ""),
                 r"C:\Program Files\vJoy\x64\vJoyInterface.dll",
                 r"C:\Program Files\vJoy\vJoyInterface.dll",
                 str(Path(sys.executable).parent / "vJoyInterface.dll")]
        for p in paths:
            if p and Path(p).is_file():
                try:
                    self.dll = ctypes.WinDLL(p)
                    break
                except OSError as e:
                    self.error = f"Couldn't load vJoy: {e}"
        if not self.dll:
            self.error = self.error or "vJoy isn't installed"
            return
        d = self.dll
        try:
            if not d.vJoyEnabled():
                self.error = "vJoy is installed but disabled. Enable it in 'Configure vJoy'."
                return
            status = d.GetVJDStatus(device)        # 0 own, 1 free, 2 busy, 3 missing
            if status == 3:
                self.error = f"vJoy device {device} doesn't exist. Add it in 'Configure vJoy'."
                return
            if status == 2:
                self.error = f"vJoy device {device} is in use by another program"
                return
            if status == 1 and not d.AcquireVJD(device):
                self.error = f"Couldn't take control of vJoy device {device}"
                return
            for name, usage in self.AXES.items():
                if d.GetVJDAxisExist(device, usage):
                    self.axes.append(name)
                    d.SetAxis(self.MAX // 2, device, usage)
            self.buttons = int(d.GetVJDButtonNumber(device))
            self.ok = True
            log(f"* vJoy device {device}: axes {', '.join(self.axes) or 'none'}, {self.buttons} buttons")
        except Exception as e:     # noqa: BLE001 - a broken driver must not take the companion down
            self.error = f"vJoy error: {e}"

    def info(self):
        return {"ok": self.ok, "error": self.error, "device": self.device, "axes": self.axes, "buttons": self.buttons}

    def axis(self, name: str, value: float):
        if not self.ok or name not in self.axes:
            raise OSError(f"vJoy axis '{name}' isn't available")
        v = max(0.0, min(1.0, float(value)))
        self.dll.SetAxis(int(1 + v * (self.MAX - 1)), self.device, self.AXES[name])

    def button(self, n: int, down: bool):
        if not self.ok or not (1 <= n <= self.buttons):
            raise OSError(f"vJoy button {n} isn't available")
        self.dll.SetBtn(1 if down else 0, self.device, n)

    def close(self):
        if self.ok:
            try:
                self.dll.ResetVJD(self.device)
                self.dll.RelinquishVJD(self.device)
            except Exception:  # noqa: BLE001
                pass


class Keyboard:
    """Reference-counted key state so overlapping combos that share a modifier never
    release each other's keys early. Routes vjoy_bN tokens to the virtual joystick."""

    def __init__(self, backend, vjoy: VJoy | None):
        self.b, self.vjoy = backend, vjoy
        self.count: dict[str, int] = {}

    def _raw(self, tok: str, down: bool):
        if is_vjoy(tok):
            if not self.vjoy or not self.vjoy.ok:
                if isinstance(self.b, DryRunBackend):
                    return log(f"   {'v' if down else '^'} {tok} (no vJoy)")
                raise OSError("That switch is bound to a vJoy button, but vJoy isn't available")
            return self.vjoy.button(int(tok[6:]), down)
        self.b.key(tok, down)

    def press(self, tok):
        c = self.count.get(tok, 0)
        if c == 0:
            self._raw(tok, True)
        self.count[tok] = c + 1

    def release(self, tok):
        c = self.count.get(tok, 0)
        if c <= 1:
            self.count.pop(tok, None)
            if c == 1:
                self._raw(tok, False)
        else:
            self.count[tok] = c - 1

    def release_all(self):
        for tok in list(self.count):
            try:
                self._raw(tok, False)
            except OSError:
                pass
        self.count.clear()
