"""Small QR code encoder (byte mode, error correction level M, versions 1-10).

Written for SC Glass so pairing works without internet. Follows the structure of
Project Nayuki's reference QR encoder (MIT). Output as SVG or as console text.
"""
from __future__ import annotations

# error-correction level M tables, index = version
ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26]
NUM_BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5]
FORMAT_ECL_BITS = 0  # M


def _gf_mul(x: int, y: int) -> int:
    z = 0
    for i in reversed(range(8)):
        z = (z << 1) ^ ((z >> 7) * 0x11D)
        z ^= ((y >> i) & 1) * x
    return z


def _rs_divisor(degree: int) -> list[int]:
    result = [0] * (degree - 1) + [1]
    root = 1
    for _ in range(degree):
        for j in range(degree):
            result[j] = _gf_mul(result[j], root)
            if j + 1 < degree:
                result[j] ^= result[j + 1]
        root = _gf_mul(root, 0x02)
    return result


def _rs_remainder(data: list[int], divisor: list[int]) -> list[int]:
    result = [0] * len(divisor)
    for b in data:
        factor = b ^ result.pop(0)
        result.append(0)
        for i, coef in enumerate(divisor):
            result[i] ^= _gf_mul(coef, factor)
    return result


def _raw_modules(ver: int) -> int:
    result = (16 * ver + 128) * ver + 64
    if ver >= 2:
        n = ver // 7 + 2
        result -= (25 * n - 10) * n - 55
        if ver >= 7:
            result -= 36
    return result


def _data_codewords(ver: int) -> int:
    return _raw_modules(ver) // 8 - ECC_PER_BLOCK[ver] * NUM_BLOCKS[ver]


def _align_positions(ver: int, size: int) -> list[int]:
    if ver == 1:
        return []
    n = ver // 7 + 2
    step = (ver * 8 + n * 3 + 5) // (n * 4 - 4) * 2
    result = [size - 7 - i * step for i in range(n - 1)] + [6]
    return list(reversed(result))


class QR:
    def __init__(self, text: str):
        data = text.encode("utf-8")
        for ver in range(1, 11):
            cc_bits = 8 if ver < 10 else 16
            if 4 + cc_bits + len(data) * 8 <= _data_codewords(ver) * 8:
                break
        else:
            raise ValueError("text too long for a version 1-10 QR code")
        self.ver, self.size = ver, ver * 4 + 17
        bits: list[int] = []
        put = lambda val, n: bits.extend((val >> i) & 1 for i in reversed(range(n)))
        put(0b0100, 4)
        put(len(data), cc_bits)
        for b in data:
            put(b, 8)
        cap = _data_codewords(ver) * 8
        put(0, min(4, cap - len(bits)))
        put(0, (8 - len(bits) % 8) % 8)
        pad = 0xEC
        while len(bits) < cap:
            put(pad, 8)
            pad ^= 0xEC ^ 0x11
        codewords = [int("".join(map(str, bits[i:i + 8])), 2) for i in range(0, len(bits), 8)]
        self.modules = [[False] * self.size for _ in range(self.size)]
        self.isfunc = [[False] * self.size for _ in range(self.size)]
        self._draw_function_patterns()
        self._draw_codewords(self._add_ecc(codewords))
        best, best_pen = 0, None
        for mask in range(8):
            self._apply_mask(mask)
            self._draw_format(mask)
            pen = self._penalty()
            if best_pen is None or pen < best_pen:
                best, best_pen = mask, pen
            self._apply_mask(mask)
        self._apply_mask(best)
        self._draw_format(best)

    # ---- construction ----
    def _set(self, x, y, dark):
        self.modules[y][x] = dark
        self.isfunc[y][x] = True

    def _draw_function_patterns(self):
        s = self.size
        for i in range(s):
            self._set(6, i, i % 2 == 0)
            self._set(i, 6, i % 2 == 0)
        for cx, cy in ((3, 3), (s - 4, 3), (3, s - 4)):
            for dy in range(-4, 5):
                for dx in range(-4, 5):
                    x, y = cx + dx, cy + dy
                    if 0 <= x < s and 0 <= y < s:
                        self._set(x, y, max(abs(dx), abs(dy)) not in (2, 4))
        pos = _align_positions(self.ver, s)
        n = len(pos)
        for i in range(n):
            for j in range(n):
                if (i == 0 and j == 0) or (i == 0 and j == n - 1) or (i == n - 1 and j == 0):
                    continue
                for dy in range(-2, 3):
                    for dx in range(-2, 3):
                        self._set(pos[i] + dx, pos[j] + dy, max(abs(dx), abs(dy)) != 1)
        self._draw_format(0)
        if self.ver >= 7:
            rem = self.ver
            for _ in range(12):
                rem = (rem << 1) ^ ((rem >> 11) * 0x1F25)
            bits = self.ver << 12 | rem
            for i in range(18):
                bit = (bits >> i) & 1 != 0
                a, b = s - 11 + i % 3, i // 3
                self._set(a, b, bit)
                self._set(b, a, bit)

    def _draw_format(self, mask):
        data = FORMAT_ECL_BITS << 3 | mask
        rem = data
        for _ in range(10):
            rem = (rem << 1) ^ ((rem >> 9) * 0x537)
        bits = (data << 10 | rem) ^ 0x5412
        bit = lambda i: (bits >> i) & 1 != 0
        s = self.size
        for i in range(6):
            self._set(8, i, bit(i))
        self._set(8, 7, bit(6))
        self._set(8, 8, bit(7))
        self._set(7, 8, bit(8))
        for i in range(9, 15):
            self._set(14 - i, 8, bit(i))
        for i in range(8):
            self._set(s - 1 - i, 8, bit(i))
        for i in range(8, 15):
            self._set(8, s - 15 + i, bit(i))
        self._set(8, s - 8, True)

    def _add_ecc(self, data: list[int]) -> list[int]:
        nblocks, ecclen = NUM_BLOCKS[self.ver], ECC_PER_BLOCK[self.ver]
        raw = _raw_modules(self.ver) // 8
        nshort = nblocks - raw % nblocks
        shortlen = raw // nblocks
        div = _rs_divisor(ecclen)
        blocks, k = [], 0
        for i in range(nblocks):
            dat = data[k:k + shortlen - ecclen + (0 if i < nshort else 1)]
            k += len(dat)
            ecc = _rs_remainder(dat, div)
            if i < nshort:
                dat = dat + [0]
            blocks.append(dat + ecc)
        out = []
        for i in range(len(blocks[0])):
            for j, blk in enumerate(blocks):
                if i != shortlen - ecclen or j >= nshort:
                    out.append(blk[i])
        return out

    def _draw_codewords(self, data: list[int]):
        s, i = self.size, 0
        right = s - 1
        while right >= 1:
            if right == 6:
                right = 5
            for vert in range(s):
                for j in range(2):
                    x = right - j
                    upward = ((right + 1) & 2) == 0
                    y = s - 1 - vert if upward else vert
                    if not self.isfunc[y][x] and i < len(data) * 8:
                        self.modules[y][x] = (data[i >> 3] >> (7 - (i & 7))) & 1 != 0
                        i += 1
            right -= 2

    def _apply_mask(self, mask):
        f = [lambda x, y: (x + y) % 2 == 0, lambda x, y: y % 2 == 0, lambda x, y: x % 3 == 0,
             lambda x, y: (x + y) % 3 == 0, lambda x, y: (x // 3 + y // 2) % 2 == 0,
             lambda x, y: x * y % 2 + x * y % 3 == 0, lambda x, y: (x * y % 2 + x * y % 3) % 2 == 0,
             lambda x, y: ((x + y) % 2 + x * y % 3) % 2 == 0][mask]
        for y in range(self.size):
            for x in range(self.size):
                if not self.isfunc[y][x] and f(x, y):
                    self.modules[y][x] = not self.modules[y][x]

    def _penalty(self) -> int:
        s, m, pen = self.size, self.modules, 0
        for line in [m[y] for y in range(s)] + [[m[y][x] for y in range(s)] for x in range(s)]:
            run, prev = 0, None
            for c in line:
                if c == prev:
                    run += 1
                else:
                    if run >= 5:
                        pen += run - 2
                    run, prev = 1, c
            if run >= 5:
                pen += run - 2
        for y in range(s - 1):
            for x in range(s - 1):
                if m[y][x] == m[y][x + 1] == m[y + 1][x] == m[y + 1][x + 1]:
                    pen += 3
        dark = sum(sum(r) for r in m)
        pen += abs(dark * 20 - s * s * 10) // (s * s) * 10
        return pen

    # ---- output ----
    def svg(self, border: int = 4, dark: str = "#000", light: str = "#fff") -> str:
        n = self.size + border * 2
        path = "".join(f"M{x + border},{y + border}h1v1h-1z" for y in range(self.size) for x in range(self.size) if self.modules[y][x])
        return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {n} {n}" shape-rendering="crispEdges">'
                f'<rect width="100%" height="100%" fill="{light}"/><path d="{path}" fill="{dark}"/></svg>')

    def text(self, border: int = 2) -> str:
        """Two rows per line with half-block characters; dark modules print as spaces on a light row."""
        s = self.size
        get = lambda x, y: 0 <= x < s and 0 <= y < s and self.modules[y][x]
        lines = []
        for y in range(-border, s + border, 2):
            row = ""
            for x in range(-border, s + border):
                top, bot = not get(x, y), not get(x, y + 1)   # light = drawn
                row += "█" if top and bot else "▀" if top else "▄" if bot else " "
            lines.append(row)
        return "\n".join(lines)
