#!/usr/bin/env python3
# Yerleşik kanal URL'lerinin sağlık kontrolü. channels.js'yi parse eder, her URL'ye HEAD + ilk 8 KB çeker,
# HTTP kodu ve HLS başlığını raporlar. CI'da haftalık çalıştırılır, kırık olanlar için issue açılabilir.
#
# Kullanım:
#   python tools/channels_health.py                        # metin raporu
#   python tools/channels_health.py --json out.json        # makine okunur rapor
#   python tools/channels_health.py --timeout 10           # istek başına saniye
import argparse, json, re, socket, ssl, sys, time, urllib.request, urllib.error
from pathlib import Path

CHANNELS_JS = Path(__file__).resolve().parent.parent / "js" / "channels.js"
UA = "Mozilla/5.0 beeOS-health/1.0"

def parse_channels(text):
    # Çok naif ama channels.js sabit şemayı takip ediyor: { ... url: "..." }
    pattern = re.compile(r"\{\s*group:\s*\"([^\"]+)\"[^}]*?name:\s*\"([^\"]+)\"[^}]*?tvgId:\s*\"([^\"]*)\"[^}]*?url:\s*\"([^\"]+)\"")
    out = []
    for m in pattern.finditer(text):
        out.append({"group": m.group(1), "name": m.group(2), "tvgId": m.group(3), "url": m.group(4)})
    return out

def probe(url, timeout):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Referer": url.split("/")[2]})
    t0 = time.time()
    try:
        ctx = ssl.create_default_context()
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
            head = r.read(8192).decode("utf-8", "replace")
            return {"ok": True, "status": r.status, "ms": int((time.time()-t0)*1000),
                    "hls": "#EXTM3U" in head, "variants": head.count("#EXT-X-STREAM-INF")}
    except urllib.error.HTTPError as e:
        return {"ok": False, "status": e.code, "ms": int((time.time()-t0)*1000), "error": str(e)}
    except (urllib.error.URLError, socket.timeout, TimeoutError) as e:
        return {"ok": False, "status": 0, "ms": int((time.time()-t0)*1000), "error": str(e)}

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--json", type=Path)
    p.add_argument("--timeout", type=float, default=8.0)
    args = p.parse_args()

    chans = parse_channels(CHANNELS_JS.read_text(encoding="utf-8"))
    if not chans:
        print("channels.js'den kanal okunamadı", file=sys.stderr); sys.exit(2)

    results = []
    broken = 0
    for c in chans:
        r = probe(c["url"], args.timeout)
        results.append({**c, **r})
        tag = "OK " if r["ok"] else "FAIL"
        print(f"{tag} {c['name']:30s} {r.get('status',0):3d} {r.get('ms',0):5d}ms  {c['url']}")
        if not r["ok"]:
            broken += 1

    print(f"\nToplam: {len(chans)}  Kırık: {broken}")
    if args.json:
        args.json.write_text(json.dumps({"ts": int(time.time()), "channels": results}, indent=2, ensure_ascii=False))
    sys.exit(1 if broken else 0)

if __name__ == "__main__":
    main()
