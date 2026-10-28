"""beeOS uygulama ikonlari: icon.png (80x80), largeIcon.png (130x130) ve acilis ekrani logosu
(os/overlay/usr/share/plymouth/themes/beeos/logo.png). Bagimlilik yok.
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
    write_png(path, size, size, 2, b"".join(rows))


def in_ellipse(x, y, cx, cy, rx, ry, deg=0):
    a = math.radians(-deg)
    dx, dy = x - cx, y - cy
    u = dx * math.cos(a) - dy * math.sin(a)
    v = dx * math.sin(a) + dy * math.cos(a)
    return (u / rx) ** 2 + (v / ry) ** 2 <= 1


# Acilis animasyonundaki petek (index.html #bootMark): 300x270 kutuda 80x92'lik hucreler
HIVE = [(65, 12), (155, 12), (199, 89), (155, 166), (65, 166), (21, 89)]
CENTER = (110, 89)


def splash_sample(x, y):
    """Bir noktanin rengi (r, g, b, a). x, y: 300x270 kutu birimi."""
    col = None
    for left, top in HIVE:
        cx, cy = left + 40, top + 46
        if abs(x - cx) < 41 and abs(y - cy) < 47 and in_hexagon(x, y, cx, cy, 43):
            # cerceve tam bal rengi, ici %10
            col = HONEY + (1.0,) if not in_hexagon(x, y, cx, cy, 39) else HONEY + (0.1,)
    left, top = CENTER
    cx, cy = left + 40, top + 46
    if in_hexagon(x, y, cx, cy, 43):
        col = HONEY + (1.0,)
        lx, ly = x - left, y - top  # hucre ici koordinat (80x92)
        for wx, deg in ((31, -28), (49, 28)):
            if in_ellipse(lx, ly, wx, 38, 10, 6.5, deg):
                col = tuple(int(255 * 0.9 + c * 0.1) for c in HONEY) + (1.0,)
        if in_ellipse(lx, ly, 40, 55, 11, 15):
            col = (26, 18, 0, 1.0)
        if (29.5 <= lx <= 50.5 and 50 <= ly <= 53.6) or (30.5 <= lx <= 49.5 and 58 <= ly <= 61.6):
            col = HONEY + (1.0,)
    return col


def splash(path, scale=1.2):
    """Plymouth acilis ekrani logosu: saydam zeminde petek ve ari (RGBA)."""
    w, h = int(300 * scale), int(270 * scale)
    rows = []
    for py in range(h):
        row = bytearray([0])
        for px in range(w):
            acc = [0.0, 0.0, 0.0, 0.0]
            for sy in (-0.33, 0, 0.33):
                for sx in (-0.33, 0, 0.33):
                    c = splash_sample((px + sx) / scale, (py + sy) / scale)
                    if c:
                        for i in range(3):
                            acc[i] += c[i] * c[3]
                        acc[3] += c[3]
            a = acc[3] / 9
            rgb = [int(acc[i] / acc[3]) if acc[3] else 0 for i in range(3)]
            row += bytes(rgb + [int(a * 255)])
        rows.append(bytes(row))
    write_png(path, w, h, 6, b"".join(rows))


def write_png(path, w, h, color_type, raw):
    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n"
                + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, color_type, 0, 0, 0))
                + chunk(b"IDAT", zlib.compress(raw, 9))
                + chunk(b"IEND", b""))


if __name__ == "__main__":
    png(os.path.join(ROOT, "icon.png"), 80)
    png(os.path.join(ROOT, "largeIcon.png"), 130)
    splash(os.path.join(ROOT, "os", "overlay", "usr", "share", "plymouth", "themes", "beeos", "logo.png"))
    print("beeOS ikonlari ve acilis ekrani logosu olusturuldu.")
