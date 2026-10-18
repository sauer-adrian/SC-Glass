"""Show the deck on a touchscreen attached to the PC (a Xeneon Edge, a portable monitor) in a
borderless always-on-top window that does not take focus away from Star Citizen when touched."""
from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

from .util import log

TITLE = "SC Glass Overlay"


def available() -> bool:
    return sys.platform == "win32" and find_browser() is not None


def find_browser() -> str | None:
    if sys.platform != "win32":
        return None
    roots = [os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"),
             os.environ.get("ProgramFiles", r"C:\Program Files"), os.environ.get("LOCALAPPDATA", "")]
    rels = [r"Microsoft\Edge\Application\msedge.exe", r"Google\Chrome\Application\chrome.exe",
            r"BraveSoftware\Brave-Browser\Application\brave.exe"]
    for rel in rels:
        for root in roots:
            if root and Path(root, rel).is_file():
                return str(Path(root, rel))
    return None


def monitors() -> list[dict]:
    if sys.platform != "win32":
        return []
    import ctypes
    from ctypes import wintypes
    user32 = ctypes.WinDLL("user32")
    try:
        ctypes.WinDLL("shcore").SetProcessDpiAwareness(2)
    except (OSError, AttributeError):
        pass

    class MONITORINFO(ctypes.Structure):
        _fields_ = [("cbSize", ctypes.c_uint32), ("rcMonitor", wintypes.RECT), ("rcWork", wintypes.RECT),
                    ("dwFlags", ctypes.c_uint32)]

    out = []
    proc = ctypes.WINFUNCTYPE(ctypes.c_int, ctypes.c_void_p, ctypes.c_void_p, ctypes.POINTER(wintypes.RECT), ctypes.c_double)

    def cb(hmon, hdc, rect, data):
        mi = MONITORINFO()
        mi.cbSize = ctypes.sizeof(MONITORINFO)
        user32.GetMonitorInfoW(ctypes.c_void_p(hmon), ctypes.byref(mi))
        r = mi.rcMonitor
        out.append({"id": len(out) + 1, "x": r.left, "y": r.top, "w": r.right - r.left, "h": r.bottom - r.top,
                    "primary": bool(mi.dwFlags & 1)})
        return 1
    user32.EnumDisplayMonitors(None, None, proc(cb), 0)
    return out


def default_monitor(mons: list[dict]) -> dict | None:
    """Prefer the smallest non-primary screen: that's usually the touch strip or portable monitor."""
    side = [m for m in mons if not m["primary"]]
    if side:
        return min(side, key=lambda m: m["w"] * m["h"])
    return mons[0] if mons else None


class Overlay:
    def __init__(self, profile_dir: Path):
        self.proc: subprocess.Popen | None = None
        self.profile = profile_dir
        self.hwnd = None

    def open(self, url: str, mon: dict) -> str:
        b = find_browser()
        if not b:
            return "No Edge or Chrome found on this PC"
        self.close()
        self.profile.mkdir(parents=True, exist_ok=True)
        args = [b, f"--app={url}", f"--window-position={mon['x']},{mon['y']}", f"--window-size={mon['w']},{mon['h']}",
                f"--user-data-dir={self.profile}", "--no-first-run", "--no-default-browser-check",
                "--disable-features=Translate,TouchpadOverscrollHistoryNavigation", "--overscroll-history-navigation=0"]
        self.proc = subprocess.Popen(args)
        log(f"* Overlay opening on monitor {mon['id']} ({mon['w']}x{mon['h']})")
        return ""

    def harden(self, mon: dict, tries: int = 40) -> bool:
        """Make the overlay window borderless, topmost and non-activating. Call from a thread."""
        if sys.platform != "win32":
            return False
        import ctypes
        from ctypes import wintypes
        u = ctypes.WinDLL("user32")
        u.GetWindowLongPtrW.restype = ctypes.c_ssize_t
        u.GetWindowLongPtrW.argtypes = (wintypes.HWND, ctypes.c_int)
        u.SetWindowLongPtrW.restype = ctypes.c_ssize_t
        u.SetWindowLongPtrW.argtypes = (wintypes.HWND, ctypes.c_int, ctypes.c_ssize_t)
        u.FindWindowW.restype = wintypes.HWND
        u.FindWindowW.argtypes = (wintypes.LPCWSTR, wintypes.LPCWSTR)
        u.SetWindowPos.argtypes = (wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_uint)
        for _ in range(tries):
            hwnd = u.FindWindowW(None, TITLE)
            if hwnd:
                style = u.GetWindowLongPtrW(hwnd, -16)
                u.SetWindowLongPtrW(hwnd, -16, style & ~0x00C00000 & ~0x00040000)          # no caption / sizing frame
                ex = u.GetWindowLongPtrW(hwnd, -20)
                u.SetWindowLongPtrW(hwnd, -20, ex | 0x08000000 | 0x00000008 | 0x00000080)  # NOACTIVATE | TOPMOST | TOOLWINDOW
                u.SetWindowPos(hwnd, wintypes.HWND(-1), mon["x"], mon["y"], mon["w"], mon["h"], 0x0010 | 0x0020 | 0x0040)
                self.hwnd = hwnd
                log("* Overlay ready: touches won't take focus from the game")
                return True
            time.sleep(0.25)
        log("! Overlay window not found; it may take focus when touched")
        return False

    def close(self):
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
        self.proc, self.hwnd = None, None

    def running(self) -> bool:
        return bool(self.proc and self.proc.poll() is None)
