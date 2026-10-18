"""Key tokens (Star Citizen actionmaps.xml names) -> PC/AT set-1 scancodes."""
from __future__ import annotations

SC: dict[str, tuple[int, bool]] = {}   # token -> (scancode, extended)


def _k(names: str, code: int, ext: bool = False):
    for n in names.split():
        SC[n] = (code, ext)


_k("escape esc", 0x01)
for _i, _ch in enumerate("1234567890"):
    _k(_ch, 0x02 + _i)
_k("minus", 0x0C); _k("equals", 0x0D); _k("backspace", 0x0E); _k("tab", 0x0F)
for _ch, _code in zip("qwertyuiop", range(0x10, 0x1A)):
    _k(_ch, _code)
_k("lbracket", 0x1A); _k("rbracket", 0x1B); _k("enter return", 0x1C); _k("lctrl", 0x1D)
for _ch, _code in zip("asdfghjkl", range(0x1E, 0x27)):
    _k(_ch, _code)
_k("semicolon", 0x27); _k("apostrophe", 0x28); _k("grave tilde", 0x29); _k("lshift", 0x2A)
_k("backslash", 0x2B)
for _ch, _code in zip("zxcvbnm", range(0x2C, 0x33)):
    _k(_ch, _code)
_k("comma", 0x33); _k("period", 0x34); _k("slash", 0x35); _k("rshift", 0x36)
_k("np_multiply", 0x37); _k("lalt", 0x38); _k("space", 0x39); _k("capslock", 0x3A)
for _i in range(10):
    _k(f"f{_i + 1}", 0x3B + _i)
_k("numlock", 0x45, True); _k("scrolllock", 0x46)
_k("np_7", 0x47); _k("np_8", 0x48); _k("np_9", 0x49); _k("np_subtract", 0x4A)
_k("np_4", 0x4B); _k("np_5", 0x4C); _k("np_6", 0x4D); _k("np_add", 0x4E)
_k("np_1", 0x4F); _k("np_2", 0x50); _k("np_3", 0x51); _k("np_0", 0x52); _k("np_period", 0x53)
_k("oem_102", 0x56); _k("f11", 0x57); _k("f12", 0x58)
for _i, _code in enumerate([0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6A, 0x6B, 0x6C, 0x6D, 0x6E, 0x76]):
    _k(f"f{13 + _i}", _code)
_k("np_enter", 0x1C, True); _k("rctrl", 0x1D, True); _k("np_divide", 0x35, True)
_k("print", 0x37, True); _k("ralt", 0x38, True); _k("home", 0x47, True); _k("up", 0x48, True)
_k("pgup pageup", 0x49, True); _k("left", 0x4B, True); _k("right", 0x4D, True)
_k("end", 0x4F, True); _k("down", 0x50, True); _k("pgdn pagedown", 0x51, True)
_k("insert ins", 0x52, True); _k("delete del", 0x53, True)
_k("lwin", 0x5B, True); _k("rwin", 0x5C, True); _k("apps", 0x5D, True)

MOUSE = {"mouse1", "mouse2", "mouse3", "mouse4", "mouse5", "mwheel_up", "mwheel_down"}
MODIFIERS = ["lctrl", "rctrl", "lshift", "rshift", "lalt", "ralt"]
VJOY_MAX_BUTTONS = 128


def is_vjoy(tok: str) -> bool:
    if not tok.startswith("vjoy_b"):
        return False
    n = tok[6:]
    return n.isdigit() and 1 <= int(n) <= VJOY_MAX_BUTTONS


def valid(tok: str) -> bool:
    return tok in SC or tok in MOUSE or is_vjoy(tok)


def parse_keys(spec: str) -> list[str]:
    """'f6+lalt' -> ['lalt', 'f6']. Raises ValueError on unknown tokens."""
    if not isinstance(spec, str):
        raise ValueError("keys must be a string")
    toks = [t.strip().lower() for t in spec.split("+") if t.strip()]
    if not toks:
        raise ValueError("no keys")
    for t in toks:
        if not valid(t):
            raise ValueError(f"unknown key '{t}'")
    mods = [m for m in MODIFIERS if m in toks]
    rest = [t for t in toks if t not in MODIFIERS]
    return mods + rest
