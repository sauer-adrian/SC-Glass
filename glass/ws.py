"""Minimal RFC 6455 WebSocket server-side connection."""
from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import struct

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


def accept_key(key: str) -> str:
    return base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode()


class WS:
    def __init__(self, reader, writer, peer):
        self.r, self.w, self.peer = reader, writer, peer
        self.closed = False
        self.lock = asyncio.Lock()
        self.meta: dict = {}

    async def recv(self) -> str | None:
        buf = b""
        while True:
            hdr = await self.r.readexactly(2)
            fin, op = hdr[0] & 0x80, hdr[0] & 0x0F
            masked, ln = hdr[1] & 0x80, hdr[1] & 0x7F
            if ln == 126:
                ln = struct.unpack(">H", await self.r.readexactly(2))[0]
            elif ln == 127:
                ln = struct.unpack(">Q", await self.r.readexactly(8))[0]
            if ln > 4 << 20:
                raise ConnectionError("frame too large")
            mask = await self.r.readexactly(4) if masked else b"\0\0\0\0"
            data = await self.r.readexactly(ln)
            if masked:
                data = bytes(b ^ mask[i & 3] for i, b in enumerate(data))
            if op == 0x8:
                await self._frame(0x8, b"")
                return None
            if op == 0x9:
                await self._frame(0xA, bytes(data))
                continue
            if op == 0xA:
                continue
            buf += data
            if fin:
                return buf.decode("utf-8", "replace")

    async def _frame(self, op: int, payload: bytes):
        if self.closed:
            return
        n = len(payload)
        if n < 126:
            hdr = struct.pack(">BB", 0x80 | op, n)
        elif n < 65536:
            hdr = struct.pack(">BBH", 0x80 | op, 126, n)
        else:
            hdr = struct.pack(">BBQ", 0x80 | op, 127, n)
        async with self.lock:
            try:
                self.w.write(hdr + payload)
                await self.w.drain()
            except (ConnectionError, RuntimeError):
                self.closed = True

    async def send(self, obj: dict):
        await self._frame(0x1, json.dumps(obj, separators=(",", ":")).encode())
