"""Simple Icons SVG'lerinden js/logos.js uretir.

Kullanim:  python -I tools/build_logos.py <svg_klasoru>
SVG'ler: https://cdn.jsdelivr.net/npm/simple-icons@11.0.0/icons/<slug>.svg  (CC0)
Sadece path verisi alinir ve dogrulanir; logolar beyaz cizilir.
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Simple Icons slug -> webOS uygulama kimligi (js/config.js ile ayni)
SLUGS = {
    "netflix": "netflix",
    "youtube": "youtube.leanback.v4",
    "primevideo": "amazon",
    "spotify": "spotify-beehive",
}

# Simple Icons'ta olmayan markalar: elle cizilmis sade isaretler (beyaz, 24x24)
EXTRA = {
    # Disney+: kemer + arti isareti
    "com.disney.disneyplus-prod": (
        '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="#fff" '
        'stroke-linecap="round"><path d="M2.5 16.5C4.5 8 14.5 4.5 21.5 9.5" stroke-width="1.6"/>'
        '<path d="M16.5 11.5v8M12.5 15.5h8" stroke-width="2.2"/></svg>'),
}

PATH_RE = re.compile(r'<path[^>]*\sd="([^"]+)"')
SAFE_D = re.compile(r"^[MmZzLlHhVvCcSsQqTtAa0-9.,\-\s]+$")


def main(src_dir):
    logos = {}
    for slug, app_id in SLUGS.items():
        path = os.path.join(src_dir, slug + ".svg")
        if not os.path.exists(path):
            print("atlandi (yok):", slug)
            continue
        with open(path, encoding="utf-8") as f:
            svg = f.read()
        if 'viewBox="0 0 24 24"' not in svg:
            print("atlandi (beklenmeyen viewBox):", slug)
            continue
        ds = PATH_RE.findall(svg)
        if not ds or not all(SAFE_D.match(d) for d in ds):
            print("atlandi (gecersiz path):", slug)
            continue
        inner = "".join('<path d="%s"/>' % d for d in ds)
        logos[app_id] = ('<svg viewBox="0 0 24 24" width="100%" height="100%" fill="#fff">'
                         + inner + "</svg>")
        print("eklendi:", slug, "->", app_id)
    for app_id, svg in EXTRA.items():
        logos.setdefault(app_id, svg)
        print("eklendi (elle):", app_id)

    out = os.path.join(ROOT, "js", "logos.js")
    with open(out, "w", encoding="utf-8") as f:
        f.write("// Bu dosya tools/build_logos.py ile uretildi. Elle duzenleme.\n")
        f.write("// Logolar: Simple Icons (simpleicons.org, CC0). Markalar sahiplerinin tescilli markasidir.\n")
        f.write("var LOGOS = " + json.dumps(logos, indent=2, ensure_ascii=False) + ";\n\n")
        f.write("// logos/ klasorune koydugun PNG'lerin uygulama kimlikleri (orn. \"netflix\" -> logos/netflix.png).\n")
        f.write("// Listedeki dosyalar her seyden once kullanilir.\n")
        f.write("var LOGO_FILES = [];\n")
    print("yazildi:", out)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("kullanim: python -I tools/build_logos.py <svg_klasoru>")
    main(sys.argv[1])
