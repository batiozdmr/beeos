"""beeOS uygulama ikonlari: icon.png (80x80) ve largeIcon.png (130x130). Bagimlilik yok.
Koyu zemin uzerinde bal rengi altigen (petek hucresi)."""
import math
import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BG = (11, 13, 20)
HONEY = (255, 200, 61)
HONEY_DARK = (214, 150, 0)


def in_hexagon(x, y, cx, cy, r):
    """Sivri tepeli altigen icinde mi? (r: merkezden koseye)"""
    dx, dy = abs(x - cx), abs(y - cy)
    w = r * math.sqrt(3) / 2
    if dx > w or dy > r:
        return False
    return dy <= r - dx / math.sqrt(3)


def png(path, size):
    c = (size - 1) / 2
    r = size * 0.40
    rows = []
    for y in range(size):
        row = bytearray([0])  # filtre: yok
        for x in range(size):
            # 3x3 ornekleme ile yumusak kenar
            hits = 0
            for sy in (-0.33, 0, 0.33):
                for sx in (-0.33, 0, 0.33):
                    hits += in_hexagon(x + sx, y + sy, c, c, r)
            a = hits / 9
            t = y / size  # yukaridan asagi bal tonu koyulasir
            col = [HONEY[i] + (HONEY_DARK[i] - HONEY[i]) * t for i in range(3)]
            px = [int(BG[i] + (col[i] - BG[i]) * a) for i in range(3)]
            row += bytes(px)
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    data = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as f:
        f.write(data)


if __name__ == "__main__":
    png(os.path.join(ROOT, "icon.png"), 80)
    png(os.path.join(ROOT, "largeIcon.png"), 130)
    print("beeOS ikonlari olusturuldu.")
