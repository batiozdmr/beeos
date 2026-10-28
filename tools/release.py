#!/usr/bin/env python3
"""beeOS sürümleri ve güncelleme paketi.

Sürüm numarasının tek kaynağı appinfo.json'daki "version" (webOS paketi, PC arka ucu ve arayüz onu okur).

  python tools/release.py version          şu anki sürüm
  python tools/release.py bump 0.5.0       sürümü değiştirir (appinfo.json)
  python tools/release.py pack             güncelleme paketi -> build/release/beeos-update-<sürüm>.tar.gz (+ .sha256)
  python tools/release.py tag              v<sürüm> etiketini oluşturur (push edilince GitHub Actions release çıkarır)
  python tools/release.py serve [port]     paketi ve sahte GitHub cevabını (latest.json) yerelde sunar: VM'de deneme için.
                                           İmaj: .\\os\\vbox.ps1 build -UpdateApi http://10.0.2.2:8000/latest.json

Paket içeriği (cihazda beeos_server.py kurar):
  web/      arayüz (/opt/beeos/web)          bin/   /opt/beeos/bin (kabuk betikleri + arka uç)
  overlay/  diğer sistem dosyaları (systemd birimleri, sway ayarı, açılış teması), köke kopyalanır
"""
import functools
import gzip
import hashlib
import http.server
import io
import json
import os
import re
import subprocess
import sys
import tarfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APPINFO = os.path.join(ROOT, "appinfo.json")
OUT = os.path.join(ROOT, "build", "release")
REPO = "batiozdmr/beeos"
# os/build.sh de aynı dosyaları kopyalar
WEB = ["index.html", "appinfo.json", "css", "js", "logos", "icon.png", "largeIcon.png"]
BACKEND = ["beeos_server.py", "remote.html", "osd.js"]
NOT_EXEC = {"remote.html", "osd.js"}
# overlay'den pakete girmeyenler: bin ayrı gelir, ev klasörü kullanıcınındır
OVERLAY_SKIP = ("opt/beeos/bin", "home")


def version():
    with open(APPINFO, encoding="utf-8") as f:
        return json.load(f)["version"]


def bump(v):
    if not re.fullmatch(r"\d+\.\d+\.\d+", v):
        sys.exit("sürüm X.Y.Z biçiminde olmalı")
    # satır sonları olduğu gibi kalır
    with open(APPINFO, encoding="utf-8", newline="") as f:
        text = f.read()
    text = re.sub(r'("version"\s*:\s*")[^"]*(")', r"\g<1>%s\g<2>" % v, text, count=1)
    with open(APPINFO, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    print("sürüm:", v)


def walk(src):
    """src altındaki dosyalar (sıralı, önbellek hariç): (tam yol, src'ye göre yol)"""
    if os.path.isfile(src):
        yield src, os.path.basename(src)
        return
    for d, dirs, files in os.walk(src):
        dirs[:] = sorted(x for x in dirs if x != "__pycache__")
        for n in sorted(files):
            if not n.endswith(".pyc"):
                p = os.path.join(d, n)
                yield p, os.path.relpath(p, os.path.dirname(src)).replace(os.sep, "/")


def pack():
    """Aynı kaynaktan her seferinde aynı paket çıkar (sahip root, sabit tarih, sabit izinler)."""
    v = version()
    files = []   # (pakette yol, kaynak, çalıştırılabilir mi)
    for item in WEB:
        for p, rel in walk(os.path.join(ROOT, item)):
            files.append(("web/" + rel, p, False))
    bindir = os.path.join(ROOT, "os", "overlay", "opt", "beeos", "bin")
    for n in sorted(os.listdir(bindir)):
        files.append(("bin/" + n, os.path.join(bindir, n), True))
    for n in BACKEND:
        files.append(("bin/" + n, os.path.join(ROOT, "os", "backend", n), n not in NOT_EXEC))
    overlay = os.path.join(ROOT, "os", "overlay")
    for p, rel in walk(overlay):
        rel = rel.split("/", 1)[1]
        if not rel.startswith(OVERLAY_SKIP):
            files.append(("overlay/" + rel, p, False))
    files.sort()

    os.makedirs(OUT, exist_ok=True)
    name = "beeos-update-%s.tar.gz" % v
    buf = io.BytesIO()
    dirs = set()
    with tarfile.open(fileobj=buf, mode="w", format=tarfile.PAX_FORMAT) as t:
        def add(path, data=None, mode=0o755):
            ti = tarfile.TarInfo(path)
            ti.uid = ti.gid = 0
            ti.uname = ti.gname = "root"
            ti.mtime = 0
            ti.mode = mode
            if data is None:
                ti.type = tarfile.DIRTYPE
                t.addfile(ti)
            else:
                ti.size = len(data)
                t.addfile(ti, io.BytesIO(data))
        for path, src, exe in files:
            parts = path.split("/")
            for i in range(1, len(parts)):
                d = "/".join(parts[:i])
                if d not in dirs:
                    dirs.add(d)
                    add(d)
            with open(src, "rb") as f:
                data = f.read()
            if exe:
                # Windows'ta düzenlenen betiklerde CRLF olursa Linux'ta çalışmaz
                data = data.replace(b"\r\n", b"\n")
            add(path, data, 0o755 if exe else 0o644)
    gz = io.BytesIO()
    with gzip.GzipFile(filename="", mode="wb", fileobj=gz, mtime=0) as g:
        g.write(buf.getvalue())
    data = gz.getvalue()
    with open(os.path.join(OUT, name), "wb") as f:
        f.write(data)
    digest = hashlib.sha256(data).hexdigest()
    with open(os.path.join(OUT, name + ".sha256"), "w", encoding="ascii", newline="\n") as f:
        f.write("%s  %s\n" % (digest, name))
    print("%s  %d dosya  %.1f MB  sha256 %s" % (name, len(files), len(data) / 1048576, digest[:16]))
    return name, len(data)


def git(*args):
    return subprocess.run(["git", "-C", ROOT] + list(args), capture_output=True, text=True)


def tag():
    v = version()
    if git("status", "--porcelain").stdout.strip():
        sys.exit("Commit edilmemiş değişiklikler var: önce commit et")
    if git("rev-parse", "-q", "--verify", "refs/tags/v" + v).returncode == 0:
        sys.exit("v%s etiketi zaten var: önce sürümü yükselt (bump)" % v)
    r = git("tag", "-a", "v" + v, "-m", "beeOS " + v)
    if r.returncode:
        sys.exit(r.stderr)
    print("v%s etiketi oluşturuldu. Yayınlamak için:\n  git push origin HEAD v%s" % (v, v))


def serve(port):
    """GitHub'ın releases/latest cevabının sahtesi. VM (VirtualBox NAT) bilgisayarın 127.0.0.1 adresine 10.0.2.2 olarak ulaşır."""
    name, size = pack()
    v = version()
    base = "http://10.0.2.2:%d/" % port
    with open(os.path.join(OUT, name + ".sha256"), encoding="ascii") as f:
        digest = f.read().split()[0]
    rel = {"tag_name": "v" + v, "name": "beeOS " + v, "body": "Yerel deneme sürümü (tools/release.py serve).",
           "assets": [{"name": name, "size": size, "digest": "sha256:" + digest,
                       "browser_download_url": base + name},
                      {"name": name + ".sha256", "size": 0, "browser_download_url": base + name + ".sha256"}]}
    with open(os.path.join(OUT, "latest.json"), "w", encoding="utf-8") as f:
        json.dump(rel, f, indent=2)
    print("Deneme sunucusu: %slatest.json  (Ctrl+C ile durur)" % base)
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=OUT)
    http.server.ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()


def main():
    a = sys.argv[1:]
    cmd = a[0] if a else ""
    if cmd == "version":
        print(version())
    elif cmd == "bump" and len(a) == 2:
        bump(a[1])
    elif cmd == "pack":
        pack()
    elif cmd == "tag":
        tag()
    elif cmd == "serve":
        serve(int(a[1]) if len(a) > 1 else 8000)
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
