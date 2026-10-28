#!/usr/bin/env python3
"""beeOS PC arka ucu (flash disk sürümü).

- beeOS arayüzünü http://127.0.0.1:8080/ adresinden sunar.
- Uygulamaları (Netflix, YouTube TV...) Chrome'da ayrı sekmede açar, Home tuşunda beeOS'a döner.
  Chrome ile DevTools protokolü (127.0.0.1:9222) üzerinden konuşur.
- Wi-Fi (nmcli) ve güç (systemctl) işlemleri, bağlantı durumu, ekran koruyucu fotoğrafları.
- Telefon kumandası: yerel ağda ayrı bir portta (8081) küçük bir sayfa; PIN ile korunur.
- Canlı TV: CORS izni vermeyen yayınları arayüze aktarır (/api/tv/proxy).

Arayüz sunucusu sadece 127.0.0.1'i dinler. Açılan web sitelerinin bu adrese istek atmasını (CSRF)
engellemek için /api/ istekleri "X-BeeOS" başlığı ister; tarayıcı bu başlığı başka sitelerden ön
kontrolsüz göndermez. Kumanda sunucusu her işlemde "X-BeeOS-PIN" başlığı ister.
"""
import glob
import hashlib
import hmac
import html
import http.server
import ipaddress
import json
import mimetypes
import os
import re
import secrets
import shutil
import socket
import subprocess
import sys
import tarfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

PORT = 8080
WEB_ROOT = os.environ.get("BEEOS_WEB", "/opt/beeos/web")
HOME_URL = "http://127.0.0.1:%d/" % PORT
CDP = "http://127.0.0.1:9222"
LOAD_WAIT = 10       # uygulama sayfasının yüklenmesi için en fazla beklenen süre (sn)
REMOTE_PORT = 8081
STATE_DIR = "/var/lib/beeos"
REMOTE_FILE = os.path.join(STATE_DIR, "remote.json")
BEE = "bee"
BEE_RUN = "/run/user/1000"
# Ekran koruyucu fotoğrafları: BEEOS-LOG bölümü Windows'ta da açılır, fotoğraflar oraya kopyalanabilir
PHOTO_DIRS = ["/mnt/beeos-log/Fotograflar", "/home/bee/Resimler"]
PHOTO_EXT = (".jpg", ".jpeg", ".png", ".webp")
# Güncellemeler: GitHub'daki son sürüm (Releases). /etc/beeos/update.json ile kaynak değiştirilebilir
# (deneme sunucusu: {"api": "http://10.0.2.2:8000/latest.json"}; hız sınırı için isteğe bağlı "token")
UPDATE_API = "https://api.github.com/repos/batiozdmr/beeos/releases/latest"
UPDATE_CONF = "/etc/beeos/update.json"
UPDATE_DIR = os.path.join(STATE_DIR, "update")
BEEOS_DIR = "/opt/beeos"
# YouTube'un TV arayüzü (youtube.com/tv) sadece TV tarayıcılarına açılır
TV_UA = ("Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.0) AppleWebKit/537.36 (KHTML, like Gecko) "
         "76.0.3809.146/6.0 TV Safari/537.36")

apps = {}            # beeOS kart kimliği -> Chrome sekme kimliği
sessions = {}        # sekme kimliği -> açık websocket (UA değişikliği bağlantı açıkken geçerli)
cancelled = set()    # açılırken Geri ile vazgeçilen uygulamalar: yüklenince öne getirilmez
front = {"id": None}  # öndeki sekme: ses göstergesi buna çizilir
lock = threading.Lock()


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def read_version():
    """Sürüm numarasının tek kaynağı appinfo.json (webOS paketi de onu kullanır); derleme web klasörüne kopyalar."""
    try:
        with open(os.path.join(WEB_ROOT, "appinfo.json"), encoding="utf-8") as f:
            return str(json.load(f)["version"])
    except (OSError, ValueError, KeyError):
        return "0.0.0"


VERSION = read_version()


# ---------- Chrome (DevTools HTTP uç noktaları) ----------
def cdp(path, method="GET"):
    req = urllib.request.Request(CDP + path, method=method)
    with urllib.request.urlopen(req, timeout=5) as r:
        body = r.read().decode("utf-8", "replace")
    try:
        return json.loads(body)
    except ValueError:
        return body


def tabs():
    return [t for t in cdp("/json/list") if t.get("type") == "page"]


def is_home(t):
    return t.get("url", "").startswith(HOME_URL)


def new_tab(url):
    return cdp("/json/new?" + urllib.parse.quote(url, safe=":/?&=%#+@,;~"), method="PUT")


def activate(tab_id):
    cdp("/json/activate/" + tab_id)
    front["id"] = tab_id


def close_tab(tab_id):
    cdp("/json/close/" + tab_id)
    ws = sessions.pop(tab_id, None)
    if ws:
        try:
            ws.close()
        except Exception:
            pass


# ---------- Chrome (DevTools websocket) ----------
def ws_connect(url):
    import websocket  # python3-websocket
    return websocket.create_connection(url, timeout=10, suppress_origin=True)


def ws_send(ws, mid, method, params=None):
    ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))


def ws_wait(ws, match, timeout):
    """Mesajları okur; match(mesaj) doğru olunca onu döndürür. Süre dolarsa None."""
    end = time.time() + timeout
    while True:
        left = end - time.time()
        if left <= 0:
            return None
        ws.settimeout(left)
        try:
            msg = json.loads(ws.recv())
        except Exception:
            return None
        if match(msg):
            return msg


def keep_session(tab_id, ws):
    """Bağlantıyı açık tutar (UA değişikliği ancak böyle geçerli kalır); olayları okuyup atar."""
    ws.settimeout(None)
    sessions[tab_id] = ws

    def drain():
        # Sekme kapanınca bağlantı biter
        try:
            while ws.recv():
                pass
        except Exception:
            pass
        sessions.pop(tab_id, None)

    threading.Thread(target=drain, daemon=True).start()


def open_app(url, ua):
    """Sekmeyi arkada açar ve sayfa hazır olana kadar bekler. Bu sürede beeOS'un yükleme ekranı
    görünür kalır; uygulamanın boş siyah açılış ekranı görünmez.
    (Target.createTarget background kioskta ayrı pencere açıyor, sway onu boş tam ekran yapıyor:
    bu yüzden sekme normal açılıp beeOS sekmesi hemen yeniden öne alınır.)"""
    home = [t["id"] for t in tabs() if is_home(t)]
    t = new_tab("data:text/html,<body style='background:%2307090f'>")
    if home:
        activate(home[0])
    tab_id = t["id"]
    ws = ws_connect(t["webSocketDebuggerUrl"])
    if ua:
        ws_send(ws, 1, "Network.enable")
        ws_send(ws, 2, "Network.setUserAgentOverride", {"userAgent": ua})
    ws_send(ws, 3, "Page.enable")
    ws_send(ws, 4, "Page.setLifecycleEventsEnabled", {"enabled": True})
    ws_send(ws, 5, "Page.navigate", {"url": url})
    # "load" tek sayfa uygulamalarında (YouTube TV) erken gelir; uygulama ilk verisini çekip
    # ağ trafiği durulana kadar bekle. Toplam süre LOAD_WAIT'i geçmez.
    end = time.time() + LOAD_WAIT
    if ws_wait(ws, lambda m: m.get("method") == "Page.loadEventFired", LOAD_WAIT):
        ws_wait(ws, lambda m: m.get("method") == "Page.lifecycleEvent" and
                m.get("params", {}).get("name") == "networkAlmostIdle", max(0, end - time.time()))
    keep_session(tab_id, ws)
    return tab_id


def navigate(tab_id, url):
    ws = sessions.get(tab_id)
    if ws:
        ws_send(ws, 10, "Page.navigate", {"url": url})
        return
    ws = ws_connect("ws://127.0.0.1:9222/devtools/page/" + tab_id)
    try:
        ws_send(ws, 1, "Page.navigate", {"url": url})
        ws_wait(ws, lambda m: m.get("id") == 1, 5)
    finally:
        ws.close()


def launch(app_id, url, ua, nav):
    """nav: uygulama açık olsa bile verilen adrese git (arama sonucu)."""
    if not url.startswith("https://"):
        return {"ok": False, "error": "Geçersiz adres"}
    with lock:
        cancelled.discard(app_id)
        tid = apps.get(app_id)
        if tid not in {t["id"] for t in tabs()}:
            tid = None
    if tid:
        if nav:
            navigate(tid, url)
        activate(tid)
        return {"ok": True, "resumed": True}
    tid = open_app(url, TV_UA if ua == "tv" else None)
    with lock:
        apps[app_id] = tid
        if app_id in cancelled:
            # Vazgeçildi: sekme arka planda kalır, bir sonraki açılış anında olur
            cancelled.discard(app_id)
            return {"ok": True, "cancelled": True}
    activate(tid)
    return {"ok": True}


def cancel_launch(app_id):
    with lock:
        cancelled.add(app_id)
    return {"ok": True}


def open_apps():
    """Sekmesi açık uygulamalar ve sekme başlıkları (beeOS'ta "Devam et" bilgisi)."""
    with lock:
        # DevTools başlıkları HTML kaçışlı verir ("TV&#39;de YouTube")
        live = {t["id"]: html.unescape(t.get("title", "")) for t in tabs()}
        return {"ok": True, "apps": {a: live[t] for a, t in apps.items() if t in live}}


def go_home():
    with lock:
        home = [t for t in tabs() if is_home(t)]
        if home:
            activate(home[0]["id"])
        else:
            activate(new_tab(HOME_URL)["id"])
    return {"ok": True}


def close_apps():
    with lock:
        n = 0
        for t in tabs():
            if not is_home(t):
                close_tab(t["id"])
                n += 1
        apps.clear()
    go_home()
    return {"ok": True, "closed": n}


# ---------- Wi-Fi (NetworkManager) ----------
def nmcli(*args, timeout=30):
    p = subprocess.run(["nmcli"] + list(args), capture_output=True, text=True, timeout=timeout)
    return p.returncode, p.stdout, p.stderr.strip()


def split_terse(line):
    """nmcli -t çıktısı: alanlar ':' ile ayrılır, değerdeki ':' ve '\\' kaçışlıdır."""
    out, cur, esc = [], "", False
    for ch in line:
        if esc:
            cur += ch
            esc = False
        elif ch == "\\":
            esc = True
        elif ch == ":":
            out.append(cur)
            cur = ""
        else:
            cur += ch
    out.append(cur)
    return out


def known_wifi():
    _, out, _ = nmcli("-t", "-f", "NAME,TYPE", "connection", "show")
    names = set()
    for line in out.splitlines():
        f = split_terse(line)
        if len(f) >= 2 and f[1] == "802-11-wireless":
            names.add(f[0])
    return names


def wifi_list():
    code, out, err = nmcli("-t", "-f", "IN-USE,SSID,SIGNAL,SECURITY", "device", "wifi", "list", "--rescan", "yes")
    if code != 0:
        return {"ok": False, "error": err or "Wi-Fi kartı bulunamadı", "networks": []}
    known = known_wifi()
    best, current = {}, None
    for line in out.splitlines():
        f = split_terse(line)
        if len(f) < 4 or not f[1]:
            continue
        ssid, signal = f[1], int(f[2] or 0)
        if f[0] == "*":
            current = ssid
        if ssid not in best or signal > best[ssid]["signal"]:
            best[ssid] = {"ssid": ssid, "signal": signal, "secure": f[3] not in ("", "--"),
                          "known": ssid in known}
    nets = sorted(best.values(), key=lambda n: (n["ssid"] != current, -n["signal"]))
    return {"ok": True, "enabled": True, "current": current, "networks": nets[:20]}


def wifi_connect(ssid, password):
    if not ssid:
        return {"ok": False, "error": "Ağ adı boş"}
    was_known = ssid in known_wifi()
    if password:
        code, _, err = nmcli("device", "wifi", "connect", ssid, "password", password, timeout=60)
    elif was_known:
        code, _, err = nmcli("connection", "up", "id", ssid, timeout=60)
    else:
        code, _, err = nmcli("device", "wifi", "connect", ssid, timeout=60)
    if code == 0:
        return {"ok": True}
    if not was_known:
        # Başarısız denemenin bıraktığı kaydı sil, sonraki denemede yeniden şifre sorulsun
        nmcli("connection", "delete", "id", ssid)
    log("wifi connect failed:", err)
    low = err.lower()
    if "secrets" in low or "password" in low or "802-1x" in low:
        return {"ok": False, "error": "Şifre yanlış"}
    if "no network" in low or "not found" in low:
        return {"ok": False, "error": "Ağ bulunamadı"}
    return {"ok": False, "error": "Bağlantı kurulamadı"}


def status():
    """Bağlantı durumu: beeOS üst şeridindeki gösterge ve bağlantı bildirimleri için."""
    _, state, _ = nmcli("-t", "-f", "STATE", "general", timeout=5)
    _, active, _ = nmcli("-t", "-f", "NAME,TYPE", "connection", "show", "--active", timeout=5)
    name = ""
    for line in active.splitlines():
        f = split_terse(line)
        if len(f) >= 2 and f[1] == "802-11-wireless":
            name = f[0]
            break
        if len(f) >= 2 and f[1] == "802-3-ethernet":
            name = "Kablolu ağ"
    return {"ok": True, "online": state.strip() == "connected", "name": name, "remoteSeq": remote["seq"]}


# ---------- Bluetooth (BlueZ) ----------
MAC_RE = re.compile(r"[0-9A-F]{2}(:[0-9A-F]{2}){5}")


def btctl(*args, timeout=10):
    p = subprocess.run(["bluetoothctl"] + list(args), capture_output=True, text=True, timeout=timeout + 5)
    return p.returncode, p.stdout + p.stderr


def bt_macs(*filt):
    _, out = btctl("devices", *filt)
    found = {}
    for line in out.splitlines():
        parts = line.strip().split(" ", 2)
        if len(parts) >= 2 and parts[0] == "Device" and MAC_RE.fullmatch(parts[1]):
            found[parts[1]] = parts[2] if len(parts) > 2 else parts[1]
    return found


def bt_state():
    # Denetleyici yoksa bluetoothctl onu beklerken takılır: önce donanıma bak
    if not glob.glob("/sys/class/bluetooth/hci*"):
        return {"ok": False, "error": "Bluetooth bulunamadı", "powered": False, "devices": []}
    code, out = btctl("show", timeout=5)
    if code != 0 or "Controller" not in out:
        return {"ok": False, "error": "Bluetooth bulunamadı", "powered": False, "devices": []}
    powered = "Powered: yes" in out
    devices = []
    if powered:
        paired, connected = bt_macs("Paired"), bt_macs("Connected")
        for mac, name in bt_macs().items():
            # adı olmayan (sadece adresiyle görünen) yakındaki cihazlar listeyi kalabalıklaştırmasın
            if mac not in paired and re.fullmatch(r"[0-9A-F]{2}(-[0-9A-F]{2}){5}", name):
                continue
            devices.append({"mac": mac, "name": name, "paired": mac in paired, "connected": mac in connected})
    devices.sort(key=lambda d: (not d["connected"], not d["paired"], d["name"].lower()))
    return {"ok": True, "powered": powered, "devices": devices[:30]}


def bt_power(on):
    if on:
        subprocess.run(["rfkill", "unblock", "bluetooth"], capture_output=True, timeout=5)
    btctl("power", "on" if on else "off")
    return bt_state()


def bt_scan():
    btctl("--timeout", "10", "scan", "on", timeout=10)
    return bt_state()


def bt_action(action, mac):
    """connect: gerekirse eşleştirir (şifresiz), güvenilir yapar ve bağlanır. disconnect / remove."""
    if not MAC_RE.fullmatch(mac):
        return {"ok": False, "error": "Geçersiz cihaz"}
    if action == "connect":
        if mac not in bt_macs("Paired"):
            code, out = btctl("--agent", "NoInputNoOutput", "--timeout", "20", "pair", mac, timeout=20)
            if "successful" not in out.lower():
                log("bt pair failed:", out.strip()[-200:])
                return {"ok": False, "error": "Eşleştirilemedi. Cihaz eşleşme modunda mı?"}
            btctl("trust", mac)
        code, out = btctl("--timeout", "15", "connect", mac, timeout=15)
        if "successful" not in out.lower():
            log("bt connect failed:", out.strip()[-200:])
            return {"ok": False, "error": "Bağlanılamadı"}
    elif action == "disconnect":
        btctl("disconnect", mac)
    elif action == "remove":
        btctl("remove", mac)
    else:
        return {"ok": False, "error": "Geçersiz işlem"}
    return bt_state()


# ---------- güç ----------
def power(action):
    cmd = {"off": "poweroff", "reboot": "reboot"}.get(action)
    if not cmd:
        return {"ok": False, "error": "Geçersiz işlem"}
    # Cevap gönderildikten sonra kapat
    threading.Timer(1.0, lambda: subprocess.run(["systemctl", cmd])).start()
    return {"ok": True}


# ---------- güncelleme (GitHub Releases) ----------
# Release'te iki dosya olur: beeos-update-<sürüm>.tar.gz (web/, bin/, overlay/) ve onun .sha256 dosyası.
# Paket indirilir, sağlama toplamıyla doğrulanır, /opt/beeos/web ve /opt/beeos/bin klasörleri yenisiyle
# yer değiştirir (rename: yarım kurulum olmaz; eskisi .prev olarak kalır), sonra arka uç ve Chrome yeniden açılır.
upd = {"state": "idle", "progress": 0, "error": "", "release": None}
upd_lock = threading.Lock()
UPD_BUSY = ("download", "install", "restart")


class UpdateError(Exception):
    pass


def update_conf():
    try:
        with open(UPDATE_CONF, encoding="utf-8") as f:
            c = json.load(f)
        return c if isinstance(c, dict) else {}
    except (OSError, ValueError):
        return {}


def ver_tuple(v):
    try:
        return tuple(int(x) for x in str(v).lstrip("v").split("."))
    except ValueError:
        return ()


def gh_open(url, accept="application/vnd.github+json", timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": "beeOS/" + VERSION, "Accept": accept})
    token = update_conf().get("token")
    if token:
        # yönlendirilen indirme sunucusuna (S3) gitmesin: orada ikinci kimlik bilgisi isteği bozar
        req.add_unredirected_header("Authorization", "Bearer " + token)
    return urllib.request.urlopen(req, timeout=timeout)


def asset_url(a):
    # Token varken API adresi (gizli depoda da çalışır), yoksa herkese açık indirme adresi
    if update_conf().get("token") and a.get("url"):
        return a["url"], "application/octet-stream"
    return a["browser_download_url"], "*/*"


def update_state():
    r = upd["release"]
    res = {"ok": True, "current": VERSION, "state": upd["state"], "progress": upd["progress"], "error": upd["error"]}
    if r:
        res.update({"latest": r["version"], "available": r["available"], "notes": r["notes"], "size": r["size"]})
    return res


def update_check():
    if upd["state"] in UPD_BUSY:
        return update_state()
    try:
        with gh_open(update_conf().get("api") or UPDATE_API) as f:
            rel = json.loads(f.read(1024 * 1024).decode("utf-8"))
    except urllib.error.HTTPError as e:
        log("güncelleme kontrolü:", e.code)
        return {"ok": False, "error": "Henüz yayınlanmış sürüm yok" if e.code == 404 else "GitHub cevap vermedi (%d)" % e.code}
    except (OSError, ValueError) as e:
        log("güncelleme kontrolü:", repr(e))
        return {"ok": False, "error": "GitHub'a ulaşılamadı. İnternet bağlantısını kontrol et."}
    version = str(rel.get("tag_name", "")).lstrip("v")
    name = "beeos-update-%s.tar.gz" % version
    assets = {a.get("name"): a for a in rel.get("assets") or [] if isinstance(a, dict)}
    pkg, sha = assets.get(name), assets.get(name + ".sha256")
    newer = ver_tuple(version) > ver_tuple(VERSION)
    if newer and not (pkg and sha):
        log("güncelleme: %s sürümünde paket yok" % version)
    with upd_lock:
        upd["release"] = {"version": version, "available": bool(newer and pkg and sha),
                          "notes": str(rel.get("body") or "")[:1500], "size": (pkg or {}).get("size", 0),
                          "pkg": pkg, "sha": sha}
        if upd["state"] == "error":
            upd.update(state="idle", error="")
    return update_state()


def update_install():
    with upd_lock:
        r = upd["release"]
        if upd["state"] in UPD_BUSY:
            return update_state()
        if not r or not r["available"]:
            return {"ok": False, "error": "Kurulacak yeni sürüm yok"}
        upd.update(state="download", progress=0, error="")
    threading.Thread(target=update_run, args=(r,), daemon=True).start()
    return update_state()


def update_run(r):
    try:
        update_apply(r)
    except UpdateError as e:
        log("güncelleme hatası:", e)
        upd.update(state="error", error=str(e))
    except Exception as e:
        log("güncelleme hatası:", repr(e))
        upd.update(state="error", error="Güncelleme kurulamadı. Eski sürüm çalışmaya devam ediyor.")


def update_download(r, path):
    """Paketi indirir; SHA-256'sını release'teki .sha256 dosyasıyla (ve GitHub'ın verdiği özetle) karşılaştırır."""
    try:
        url, accept = asset_url(r["sha"])
        with gh_open(url, accept) as f:
            want = f.read(4096).decode("utf-8", "replace").split()[0].lower()
    except (OSError, IndexError) as e:
        raise UpdateError("Doğrulama dosyası indirilemedi") from e
    digest = str(r["pkg"].get("digest") or "")
    if not re.fullmatch(r"[0-9a-f]{64}", want) or (digest.startswith("sha256:") and digest[7:] != want):
        raise UpdateError("Doğrulama dosyası geçersiz")
    h, done, total = hashlib.sha256(), 0, r["size"] or 1
    try:
        url, accept = asset_url(r["pkg"])
        with gh_open(url, accept, timeout=60) as f, open(path, "wb") as out:
            while True:
                chunk = f.read(256 * 1024)
                if not chunk:
                    break
                h.update(chunk)
                out.write(chunk)
                done += len(chunk)
                upd["progress"] = min(99, done * 100 // total)
    except OSError as e:
        raise UpdateError("Paket indirilemedi. İnternet bağlantısını kontrol et.") from e
    if h.hexdigest() != want:
        raise UpdateError("Paket doğrulanamadı (sağlama toplamı tutmuyor)")


def swap_dir(new, dest):
    """dest klasörünü new ile değiştirir; eskisi dest.prev olur (elle geri dönüş için)."""
    prev = dest + ".prev"
    shutil.rmtree(prev, ignore_errors=True)
    if os.path.exists(dest):
        os.rename(dest, prev)
    try:
        os.rename(new, dest)
    except OSError:
        if os.path.exists(prev):
            os.rename(prev, dest)
        raise


def update_apply(r):
    shutil.rmtree(UPDATE_DIR, ignore_errors=True)
    os.makedirs(UPDATE_DIR, mode=0o700)
    pkg = os.path.join(UPDATE_DIR, "pkg.tar.gz")
    update_download(r, pkg)
    upd.update(state="install", progress=100)
    stage = os.path.join(UPDATE_DIR, "stage")
    try:
        with tarfile.open(pkg, "r:gz") as t:
            t.extractall(stage, filter="data")   # mutlak yol, "..", aygıt dosyası reddedilir
    except (OSError, tarfile.TarError) as e:
        raise UpdateError("Paket açılamadı") from e
    try:
        with open(os.path.join(stage, "web", "appinfo.json"), encoding="utf-8") as f:
            ok = str(json.load(f)["version"]) == r["version"]
    except (OSError, ValueError, KeyError):
        ok = False
    if not ok or not os.path.isfile(os.path.join(stage, "bin", "beeos_server.py")):
        raise UpdateError("Paket bu sürüme ait değil")
    # Sistem dosyaları (systemd birimleri, sway ayarı, açılış teması): her dosya ayrı ayrı yer değiştirir
    overlay = os.path.join(stage, "overlay")
    for d, _, files in os.walk(overlay):
        dest_dir = os.path.normpath(os.path.join("/", os.path.relpath(d, overlay)))
        if dest_dir.startswith((BEEOS_DIR + "/bin", BEEOS_DIR + "/web")):
            continue
        os.makedirs(dest_dir, exist_ok=True)
        for n in files:
            tmp = os.path.join(dest_dir, ".%s.beeos-new" % n)
            shutil.copy2(os.path.join(d, n), tmp)
            os.replace(tmp, os.path.join(dest_dir, n))
    for part in ("web", "bin"):
        new = os.path.join(BEEOS_DIR, "." + part + ".new")
        shutil.rmtree(new, ignore_errors=True)
        shutil.copytree(os.path.join(stage, part), new)
        swap_dir(new, os.path.join(BEEOS_DIR, part))
    shutil.rmtree(UPDATE_DIR, ignore_errors=True)
    log("güncelleme kuruldu: %s -> %s" % (VERSION, r["version"]))
    upd.update(state="restart")
    subprocess.run(["systemctl", "daemon-reload"], timeout=60)
    swaymsg("reload")
    # Ayrı bir systemd biriminde: arka uç yeniden başlarken bu iş ölmesin. Yeni arka uç hazır olunca
    # Chrome kapatılır; beeos-browser onu yeniden açar ve yeni arayüz yüklenir.
    restart = ("systemctl restart beeos-backend; i=0; while [ $i -lt 40 ] && ! curl -fs -o /dev/null "
               "-H 'X-BeeOS: 1' http://127.0.0.1:%d/api/info; do sleep 0.5; i=$((i+1)); done; "
               "pkill -u %s -x chrome" % (PORT, BEE))
    threading.Timer(2.0, lambda: subprocess.run(["systemd-run", "--no-block", "--collect",
                                                 "--unit=beeos-update-restart", "/bin/sh", "-c", restart])).start()


# ---------- ekran koruyucu fotoğrafları ----------
photos = []          # /photos/<sıra> adreslerinin gösterdiği dosyalar (son listeleme)


def photo_list():
    files = []
    for d in PHOTO_DIRS:
        try:
            names = sorted(os.listdir(d))
        except OSError:
            continue
        files += [os.path.join(d, n) for n in names
                  if n.lower().endswith(PHOTO_EXT) and not n.startswith(".")]
    photos[:] = files[:500]
    return {"ok": True, "photos": ["/photos/%d" % i for i in range(len(photos))]}


# ---------- canlı TV: yayın aktarıcı ----------
# hls.js yayını tarayıcıdan okur; CORS izni vermeyen yayınlar bu adres üzerinden açılır:
#   /api/tv/proxy?u=<adres>        yayın listesiyse (m3u8) içindeki adresler de buraya çevrilir
#   /api/tv/proxy?raw=1&u=<adres>  dosya olduğu gibi (kanal listesi M3U)
# Sadece http(s). Bilgisayarın kendisine (DevTools portu dahil) ve bağlantı-yerel adreslere gidilmez;
# yerel ağdaki IPTV sunucularına (Tvheadend vb.) izin var. İstek /api/ kuralıyla X-BeeOS başlığı ister.
STREAM_UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
             "Chrome/130.0.0.0 Safari/537.36")
TV_PROXY = "/api/tv/proxy?u="
TV_MAX = 64 * 1024 * 1024        # tek parça (segment) için üst sınır
TV_LIST_MAX = 8 * 1024 * 1024    # yayın / kanal listesi için üst sınır


def tv_url_ok(url):
    u = urllib.parse.urlsplit(url)
    if u.scheme not in ("http", "https") or not u.hostname:
        return False
    try:
        infos = socket.getaddrinfo(u.hostname, u.port or None)
    except (OSError, ValueError):
        return False
    for info in infos:
        ip = ipaddress.ip_address(info[4][0].split("%")[0])
        if ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_unspecified or ip.is_reserved:
            return False
    return True


class TvRedirect(urllib.request.HTTPRedirectHandler):
    """Yönlendirme de aynı denetimden geçer (dış adres bilgisayarın kendisine yönlendiremez)."""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not tv_url_ok(newurl):
            raise urllib.error.URLError("izin verilmeyen adres")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


tv_opener = urllib.request.build_opener(TvRedirect)


def tv_rewrite(text, base):
    """m3u8 içindeki alt liste / parça / anahtar adreslerini aktarıcıya çevirir."""
    def prox(ref):
        return TV_PROXY + urllib.parse.quote(urllib.parse.urljoin(base, ref), safe="")
    out = []
    for line in text.splitlines():
        s = line.strip()
        if s and not s.startswith("#"):
            line = prox(s)
        elif 'URI="' in s:
            line = re.sub(r'URI="([^"]+)"', lambda m: 'URI="%s"' % prox(m.group(1)), line)
        out.append(line)
    return "\n".join(out) + "\n"


def tv_proxy(h, query):
    q = urllib.parse.parse_qs(query)
    url = (q.get("u") or [""])[0]
    raw = q.get("raw") == ["1"]
    if not tv_url_ok(url):
        h.send_error(400)
        return
    req = urllib.request.Request(url, headers={"User-Agent": STREAM_UA, "Accept": "*/*"})
    try:
        r = tv_opener.open(req, timeout=15)
    except urllib.error.HTTPError as e:
        h.send_error(e.code if 400 <= e.code < 600 else 502)
        return
    except (urllib.error.URLError, OSError, ValueError):
        h.send_error(502)
        return
    try:
        with r:
            ctype = r.headers.get("Content-Type") or "application/octet-stream"
            first = r.read(65536)
            if not raw and first.lstrip().startswith(b"#EXTM3U"):
                body = first + r.read(TV_LIST_MAX)
                body = tv_rewrite(body.decode("utf-8", "replace"), r.geturl()).encode("utf-8")
                h.send_response(200)
                h.send_header("Content-Type", "application/vnd.apple.mpegurl")
                h.send_header("Content-Length", str(len(body)))
                h.end_headers()
                h.wfile.write(body)
                return
            h.send_response(200)
            h.send_header("Content-Type", ctype)
            if r.headers.get("Content-Length"):
                h.send_header("Content-Length", r.headers["Content-Length"])
            h.end_headers()
            sent, chunk = 0, first
            while chunk and sent < (TV_LIST_MAX if raw else TV_MAX):
                h.wfile.write(chunk)
                sent += len(chunk)
                chunk = r.read(65536)
    except (BrokenPipeError, ConnectionResetError):
        pass       # kanal değişince oynatıcı isteği yarıda bırakır
    except OSError as e:
        log("tv proxy", repr(e))


# ---------- telefon kumandası ----------
remote = {"enabled": True, "pin": "", "seq": 0}   # seq: başarılı eşleşme sayısı (beeOS'ta bildirim)
fails = {"n": 0, "until": 0.0}
WTYPE_KEYS = {"up": "Up", "down": "Down", "left": "Left", "right": "Right", "ok": "Return",
              "back": "Escape", "playpause": "XF86AudioPlay", "next": "XF86AudioNext",
              "prev": "XF86AudioPrev", "backspace": "BackSpace", "settings": "F1", "menu": "F2"}
SINK = "@DEFAULT_AUDIO_SINK@"
VOLUME = {"volup": ["set-volume", "-l", "1.0", SINK, "5%+"],
          "voldown": ["set-volume", SINK, "5%-"],
          "mute": ["set-mute", SINK, "toggle"]}


def new_pin():
    return "%06d" % secrets.randbelow(1000000)


def remote_load():
    try:
        with open(REMOTE_FILE) as f:
            d = json.load(f)
        remote["enabled"] = bool(d.get("enabled", True))
        if re.fullmatch(r"\d{6}", str(d.get("pin", ""))):
            remote["pin"] = d["pin"]
    except (OSError, ValueError):
        pass
    if not remote["pin"]:
        remote["pin"] = new_pin()
        remote_save()


def remote_save():
    os.makedirs(STATE_DIR, exist_ok=True)
    tmp = REMOTE_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump({"enabled": remote["enabled"], "pin": remote["pin"]}, f)
    os.chmod(tmp, 0o600)
    os.replace(tmp, REMOTE_FILE)


def lan_urls():
    p = subprocess.run(["ip", "-4", "-o", "addr", "show", "scope", "global"],
                       capture_output=True, text=True, timeout=5)
    ips = re.findall(r"inet (\d+\.\d+\.\d+\.\d+)/", p.stdout)
    return ["http://%s:%d" % (ip, REMOTE_PORT) for ip in ips]


def remote_info():
    return {"ok": True, "enabled": remote["enabled"], "pin": remote["pin"], "urls": lan_urls()}


def remote_set(b):
    if isinstance(b.get("enabled"), bool):
        remote["enabled"] = b["enabled"]
    if b.get("newPin") is True:
        remote["pin"] = new_pin()
    remote_save()
    return remote_info()


def run_bee(cmd):
    """Komutu bee kullanıcısının ekran oturumunda çalıştırır (wtype: sanal klavye, wpctl: ses)."""
    socks = sorted(glob.glob(BEE_RUN + "/wayland-[0-9]"))
    env = ["env", "XDG_RUNTIME_DIR=" + BEE_RUN]
    if socks:
        env.append("WAYLAND_DISPLAY=" + os.path.basename(socks[0]))
    return subprocess.run(["runuser", "-u", BEE, "--"] + env + cmd, capture_output=True, text=True, timeout=5)


def as_bee(cmd):
    return {"ok": run_bee(cmd).returncode == 0}


def volume_get():
    """Ses düzeyi (0-100) ve sessiz mi. wpctl çıktısı: "Volume: 0.45 [MUTED]"."""
    try:
        out = run_bee(["wpctl", "get-volume", "@DEFAULT_AUDIO_SINK@"]).stdout
    except Exception:
        return None
    m = re.search(r"Volume:\s*([\d.]+)", out)
    if not m:
        return None
    return {"level": min(100, int(round(float(m.group(1)) * 100))), "muted": "MUTED" in out}


def remote_volume(level):
    if not isinstance(level, (int, float)) or isinstance(level, bool):
        return {"ok": False, "error": "Geçersiz ses düzeyi"}
    level = max(0, min(100, int(level)))
    as_bee(["wpctl", "set-volume", "@DEFAULT_AUDIO_SINK@", "%.2f" % (level / 100.0)])
    as_bee(["wpctl", "set-mute", "@DEFAULT_AUDIO_SINK@", "0"])
    vol = volume_get()
    show_osd(vol)
    return {"ok": True, "volume": vol}


def remote_key(key, n=1):
    """n: tuşa art arda kaç kez basılsın (yazı silme). Ses tuşları yeni ses düzeyini döndürür."""
    if key == "home":
        return go_home()
    if key in VOLUME:
        return volume(key)
    if key not in WTYPE_KEYS:
        return {"ok": False, "error": "Geçersiz tuş"}
    n = max(1, min(50, n if isinstance(n, int) and not isinstance(n, bool) else 1))
    cmd = ["wtype"]
    for _ in range(n):
        cmd += ["-k", WTYPE_KEYS[key]]
    return as_bee(cmd)


# Kumandadan uygulama açma ve arama beeOS arayüzü üzerinden yapılır (yükleme ekranı, kullanım
# sırası, arama adresleri orada). Arayüz /api/remote/wait ile bekler; kart listesini de bununla gönderir.
ui = {"catalog": [], "cmds": [], "seen": 0.0}
ui_cv = threading.Condition()


def ui_wait(catalog):
    with ui_cv:
        if isinstance(catalog, list):
            ui["catalog"] = [a for a in catalog if isinstance(a, dict)][:80]
        ui["seen"] = time.time()
        if not ui["cmds"]:
            ui_cv.wait(25)
        cmds, ui["cmds"] = ui["cmds"], []
        ui["seen"] = time.time()
    return {"ok": True, "cmds": cmds}


def remote_launch(b):
    app_id, q = str(b.get("id", "")), str(b.get("q", "")).strip()[:80]
    with ui_cv:
        item = next((a for a in ui["catalog"] if a.get("id") == app_id), None)
        alive = time.time() - ui["seen"] < 40
    if not item or not alive:
        return {"ok": False, "error": "beeOS hazır değil" if not alive else "Uygulama bulunamadı"}
    if q and not item.get("search"):
        return {"ok": False, "error": "Bu uygulamada arama yapılamıyor"}
    go_home()   # yükleme ekranı görünsün
    with ui_cv:
        ui["cmds"].append({"type": "search" if q else "launch", "id": app_id, "q": q})
        ui_cv.notify_all()
    return {"ok": True}


def remote_state():
    with ui_cv:
        catalog = list(ui["catalog"])
    try:
        running = open_apps()["apps"]
    except Exception:
        running = {}
    st = status()
    return {"ok": True, "version": VERSION, "apps": catalog, "open": running, "volume": volume_get(),
            "online": st["online"], "network": st["name"]}


def remote_power(action):
    if action == "closeapps":
        return close_apps()
    return power(action)


def remote_text(text):
    text = "".join(ch for ch in text if ch.isprintable())[:200]
    if not text:
        return {"ok": False, "error": "Boş yazı"}
    return as_bee(["wtype", "--", text])


# ---------- ses göstergesi ----------
# Ses tuşları (sway, telefon kumandası) sesi buradan değiştirir; yeni düzey öndeki sekmeye
# (beeOS ya da açık uygulama) osd.js ile çizilir.
OSD_JS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "osd.js")
osd_lock = threading.Lock()


def show_osd(vol):
    state = vol or {"error": "Ses çıkışı bulunamadı"}
    try:
        with open(OSD_JS, encoding="utf-8") as f:
            js = f.read()
        pages = tabs()
        ids = [t["id"] for t in pages]
        home = [t["id"] for t in pages if is_home(t)]
        tid = front["id"] if front["id"] in ids else (home[0] if home else None)
        if not tid:
            return
        ws = sessions.get(tid)
        if not ws:
            ws = ws_connect("ws://127.0.0.1:9222/devtools/page/" + tid)
            keep_session(tid, ws)
        ws_send(ws, 20, "Runtime.evaluate",
                {"expression": js + "\nwindow.__beeosOSD.show(" + json.dumps(state) + ");"})
    except Exception as e:
        log("ses göstergesi çizilemedi", repr(e))


def volume(action):
    if action not in VOLUME:
        return {"ok": False, "error": "Geçersiz işlem"}
    # Basılı tutulan tuşta istekler sırayla işlensin: gösterge doğru düzeyi göstersin
    with osd_lock:
        if action == "volup":
            as_bee(["wpctl", "set-mute", SINK, "0"])   # sesi açmak sessizi de kaldırır
        as_bee(["wpctl"] + VOLUME[action])
        vol = volume_get()
        show_osd(vol)
    return {"ok": True, "volume": vol}


# ---------- ekran / TV (sway çıkışları) ----------
# HDMI takılınca sway TV'yi ikinci ekran olarak açar ama beeOS laptop ekranında kalır. Arayüz TV'yi
# seçince beeOS'un çalışma alanı TV'ye taşınır, diğer ekranlar kapatılır. Görüntü TV'de görünmezse
# (yanlış giriş, desteklenmeyen çözünürlük) CONFIRM_SEC içinde onaylanmazsa eski ekrana dönülür.
INTERNAL = ("eDP", "LVDS", "DSI")
CONFIRM_SEC = 15
disp = {"prev": None, "target": "", "timer": None, "until": 0.0, "pending": None, "failed": ""}
disp_lock = threading.RLock()


def sway_sock():
    socks = glob.glob(BEE_RUN + "/sway-ipc.*.sock")
    return max(socks, key=os.path.getmtime) if socks else None


def swaymsg(*args):
    sock = sway_sock()
    if not sock:
        return None
    p = run_bee(["swaymsg", "-s", sock, "-r"] + list(args))
    try:
        return json.loads(p.stdout)
    except ValueError:
        return None


def drm_connected():
    """Kablosu takılı harici çıkışlar. sway'in kullanmadığı ekran kartındakiler de görünür."""
    names = set()
    for st in glob.glob("/sys/class/drm/card[0-9]-*/status"):
        name = os.path.basename(os.path.dirname(st)).split("-", 1)[1]
        if name.startswith(INTERNAL + ("Writeback", "Virtual")):
            continue
        try:
            with open(st) as f:
                if f.read().strip() == "connected":
                    names.add(name)
        except OSError:
            pass
    return names


def port_name(name):
    m = re.match(r"(HDMI|DP|DVI|VGA)\D*(\d+)$", name)
    if not m:
        return name
    return {"DP": "DisplayPort"}.get(m.group(1), m.group(1)) + " " + m.group(2)


def beeos_workspace():
    """beeOS penceresinin bulunduğu çalışma alanı ve ekranı (boş olmayan çalışma alanı)."""
    wss = swaymsg("-t", "get_workspaces") or []
    w = next((w for w in wss if w.get("focus")), None) or next((w for w in wss if w.get("focused")), None)
    return (w["name"], w["output"]) if w else (None, None)


def display_list():
    outs = swaymsg("-t", "get_outputs")
    if outs is None:
        return {"ok": False, "error": "Ekran bilgisi alınamadı"}
    _, cur = beeos_workspace()
    res, names = [], set()
    for o in outs:
        n = o.get("name", "")
        if n.startswith("HEADLESS"):
            continue
        names.add(n)
        internal = n.startswith(INTERNAL)
        model = (o.get("model") or "").strip()
        label = "Laptop ekranı" if internal else model if model and model != "Unknown" else "TV / Monitör"
        res.append({"name": n, "label": label, "port": "Dahili" if internal else port_name(n),
                    "internal": internal, "active": bool(o.get("active")), "current": n == cur})
    # TV laptopun diğer ekran kartına (Nvidia) bağlıysa sway onu görmez: seçilince oturum yeniden başlar
    for n in sorted(drm_connected() - names):
        res.append({"name": n, "label": "TV / Monitör", "port": port_name(n), "internal": False,
                    "active": False, "current": False, "restart": True})
    with disp_lock:
        p = disp["pending"]
        if p and p[1] != sway_sock():
            # Oturum yeniden başladı: TV artık görünüyorsa ona geç
            disp["pending"] = None
            if p[0] in names:
                display_use(p[0])
                return display_list()
            disp["failed"] = port_name(p[0])
        out = {"ok": True, "outputs": res}
        if disp["failed"]:
            out["failed"], disp["failed"] = disp["failed"], ""
        if disp["timer"]:
            out["confirm"] = {"name": disp["target"], "left": max(0, int(round(disp["until"] - time.time())))}
    return out


def show_on(name, others_off):
    """beeOS'u verilen ekrana taşır; others_off: diğer ekranları kapat."""
    swaymsg("output", name, "enable")
    o = next((o for o in swaymsg("-t", "get_outputs") or [] if o.get("name") == name), {})
    width = (o.get("current_mode") or {}).get("width", 0)
    if not name.startswith(INTERNAL) and width > 2200:
        # 4K TV: arayüz 1920 genişlikte tasarlandı, küçük görünmesin
        swaymsg("output", name, "scale", "%.2f" % (width / 1920.0))
    ws, _ = beeos_workspace()
    cmds = []
    if ws:
        cmds += ['workspace "%s"' % ws.replace('"', ''), "move workspace to output " + name]
    cmds.append("focus output " + name)
    if others_off:
        cmds += ["output %s disable" % x.get("name") for x in swaymsg("-t", "get_outputs") or []
                 if x.get("active") and x.get("name") != name]
    swaymsg("; ".join(cmds))


def display_use(name):
    with disp_lock:
        d = display_list()
        if not d.get("ok"):
            return d
        o = next((o for o in d["outputs"] if o["name"] == name), None)
        if not o:
            return {"ok": False, "error": "Ekran bulunamadı. Kablo takılı mı?"}
        if o.get("restart"):
            disp["pending"] = (name, sway_sock())
            # Cevap arayüze ulaşsın diye biraz sonra: sway kapanınca oturum tüm kartlarla yeniden açılır
            threading.Timer(1.5, lambda: swaymsg("exit")).start()
            return {"ok": True, "restarting": True}
        if o["current"] and not d.get("confirm"):
            show_on(name, True)
            return {"ok": True}
        if not disp["timer"]:
            disp["prev"] = {"active": [x["name"] for x in d["outputs"] if x["active"]],
                            "current": next((x["name"] for x in d["outputs"] if x["current"]), None)}
        else:
            disp["timer"].cancel()
        show_on(name, True)
        disp["target"] = name
        disp["until"] = time.time() + CONFIRM_SEC
        disp["timer"] = threading.Timer(CONFIRM_SEC + 3, display_revert)
        disp["timer"].daemon = True
        disp["timer"].start()
        return {"ok": True, "confirm": {"name": name, "left": CONFIRM_SEC}}


def display_keep():
    with disp_lock:
        if disp["timer"]:
            disp["timer"].cancel()
        disp["timer"], disp["prev"] = None, None
    return {"ok": True}


def display_revert():
    with disp_lock:
        if disp["timer"]:
            disp["timer"].cancel()
        prev, target = disp["prev"], disp["target"]
        disp["timer"], disp["prev"] = None, None
        if not prev or not prev["current"]:
            return {"ok": True}
        for n in prev["active"]:
            swaymsg("output", n, "enable")
        show_on(prev["current"], False)
        if target not in prev["active"]:
            swaymsg("output", target, "disable")
    return {"ok": True}


def display_watch():
    """TV takılınca beeOS öne gelir (arayüz bağlantı ekranını açar). TV çıkarılınca laptop ekranı
    geri açılır: görüntü TV'deyken laptop ekranı kapalıdır, kablo çıkınca her yer karanlık kalmasın."""
    seen = drm_connected()
    while True:
        time.sleep(2)
        now = drm_connected()
        try:
            if now - seen:
                go_home()
            if seen - now:
                for o in swaymsg("-t", "get_outputs") or []:
                    if o.get("name", "").startswith(INTERNAL) and not o.get("active"):
                        swaymsg("output", o["name"], "enable")
        except Exception as e:
            log("ekran izleme", repr(e))
        seen = now


# ---------- HTTP ----------
def send_json(h, obj, code=200):
    body = json.dumps(obj).encode("utf-8")
    h.send_response(code)
    h.send_header("Content-Type", "application/json; charset=utf-8")
    h.send_header("Content-Length", str(len(body)))
    h.end_headers()
    h.wfile.write(body)


def read_body(h):
    n = int(h.headers.get("Content-Length") or 0)
    if not n:
        return {}
    try:
        d = json.loads(h.rfile.read(min(n, 65536)).decode("utf-8"))
    except ValueError:
        return {}
    return d if isinstance(d, dict) else {}


class Handler(http.server.SimpleHTTPRequestHandler):
    ui_seen = False

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=WEB_ROOT, **kw)

    def log_message(self, fmt, *args):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def send_head(self):
        # Güncelleme paketindeki dosyaların tarihi hep 1970 (tools/release.py pack): tarihle "değişmedi" (304)
        # denirse Chrome yeni sürümden sonra da eski arayüzü kullanır. Dosyalar yerelde, her seferinde gönderilir.
        del self.headers["If-Modified-Since"]
        return super().send_head()

    def host_ok(self):
        return self.headers.get("Host") in ("127.0.0.1:%d" % PORT, "localhost:%d" % PORT)

    def api_allowed(self):
        origin = self.headers.get("Origin")
        origin_ok = origin is None or origin in ("http://127.0.0.1:%d" % PORT, "http://localhost:%d" % PORT)
        return self.host_ok() and origin_ok and self.headers.get("X-BeeOS") == "1"

    def send_photo(self, path):
        """Ekran koruyucu fotoğrafı. <img> başlık gönderemez; sadece Host denetlenir."""
        m = re.fullmatch(r"/photos/(\d+)", path)
        if not self.host_ok() or not m or int(m.group(1)) >= len(photos):
            self.send_error(404)
            return
        f = photos[int(m.group(1))]
        try:
            with open(f, "rb") as fh:
                data = fh.read(40 * 1024 * 1024)
        except OSError:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(f)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def route(self, method):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if not path.startswith("/api/"):
            return False
        if not self.api_allowed():
            send_json(self, {"ok": False, "error": "forbidden"}, 403)
            return True
        if method == "GET" and path == "/api/tv/proxy":
            tv_proxy(self, parsed.query)
            return True
        b = read_body(self) if method == "POST" else {}
        try:
            if method == "GET" and path == "/api/info":
                # Teşhis: beeOS arayüzü (Chrome'dan gelen ilk istek) açılıştan kaç saniye sonra yüklendi
                if not Handler.ui_seen and "Chrome" in (self.headers.get("User-Agent") or ""):
                    Handler.ui_seen = True
                    log("arayüz yüklendi, açılıştan %.0f sn sonra" % float(open("/proc/uptime").read().split()[0]))
                res = {"platform": "pc", "version": VERSION}
            elif method == "GET" and path == "/api/status":
                res = status()
            elif method == "GET" and path == "/api/wifi":
                res = wifi_list()
            elif method == "POST" and path == "/api/wifi/connect":
                res = wifi_connect(str(b.get("ssid", "")), str(b.get("password", "")))
            elif method == "POST" and path == "/api/launch":
                res = launch(str(b.get("id", "")), str(b.get("url", "")), str(b.get("ua", "")), b.get("nav") is True)
            elif method == "POST" and path == "/api/launch/cancel":
                res = cancel_launch(str(b.get("id", "")))
            elif method == "GET" and path == "/api/apps/open":
                res = open_apps()
            elif method == "POST" and path == "/api/home":
                res = go_home()
            elif method == "POST" and path == "/api/apps/close":
                res = close_apps()
            elif method == "POST" and path == "/api/power":
                res = power(str(b.get("action", "")))
            elif method == "GET" and path == "/api/bt":
                res = bt_state()
            elif method == "POST" and path == "/api/bt/power":
                res = bt_power(b.get("on") is True)
            elif method == "POST" and path == "/api/bt/scan":
                res = bt_scan()
            elif method == "POST" and path in ("/api/bt/connect", "/api/bt/disconnect", "/api/bt/remove"):
                res = bt_action(path.rsplit("/", 1)[1], str(b.get("mac", "")))
            elif method == "GET" and path == "/api/photos":
                res = photo_list()
            elif method == "GET" and path == "/api/remote":
                res = remote_info()
            elif method == "POST" and path == "/api/remote":
                res = remote_set(b)
            elif method == "POST" and path == "/api/volume":
                res = volume(str(b.get("action", "")))
            elif method == "GET" and path == "/api/display":
                res = display_list()
            elif method == "POST" and path == "/api/display/use":
                res = display_use(str(b.get("name", "")))
            elif method == "POST" and path == "/api/display/keep":
                res = display_keep()
            elif method == "POST" and path == "/api/display/revert":
                res = display_revert()
            elif method == "GET" and path == "/api/update":
                res = update_state()
            elif method == "POST" and path == "/api/update/check":
                res = update_check()
            elif method == "POST" and path == "/api/update/install":
                res = update_install()
            elif method == "POST" and path == "/api/remote/wait":
                res = ui_wait(b.get("apps"))
            else:
                send_json(self, {"ok": False, "error": "not found"}, 404)
                return True
        except Exception as e:  # Chrome henüz açılmamış olabilir vb.
            log("api error", path, repr(e))
            res = {"ok": False, "error": "İşlem yapılamadı"}
        send_json(self, res)
        return True

    def do_GET(self):
        if self.path.startswith("/photos/"):
            self.send_photo(urllib.parse.urlparse(self.path).path)
        elif not self.route("GET"):
            super().do_GET()

    def do_POST(self):
        if not self.route("POST"):
            self.send_error(405)


class RemoteHandler(http.server.BaseHTTPRequestHandler):
    """Telefon kumandası: yerel ağdan erişilir. Sayfa serbest, her işlem PIN ister."""
    PAGE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "remote.html")

    def log_message(self, fmt, *args):
        pass

    def do_GET(self):
        if urllib.parse.urlparse(self.path).path not in ("/", "/remote"):
            self.send_error(404)
            return
        try:
            with open(self.PAGE, "rb") as f:
                data = f.read()
        except OSError:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        b = read_body(self)
        if not remote["enabled"]:
            send_json(self, {"ok": False, "error": "Telefon kumandası beeOS'ta kapalı"}, 403)
            return
        now = time.time()
        with lock:
            if fails["until"] > now:
                send_json(self, {"ok": False, "error": "Çok fazla hatalı PIN. Birkaç dakika bekle."}, 429)
                return
            if not hmac.compare_digest(self.headers.get("X-BeeOS-PIN", ""), remote["pin"]):
                # 10 hatalı denemede 5 dk kilit: 6 haneli PIN'i deneyerek bulmak pratik olmaz
                fails["n"] += 1
                if fails["n"] >= 10:
                    fails["n"], fails["until"] = 0, now + 300
                send_json(self, {"ok": False, "error": "PIN yanlış"}, 401)
                return
            fails["n"] = 0
        try:
            if path == "/api/pair":
                remote["seq"] += 1
                res = {"ok": True}
            elif path == "/api/key":
                res = remote_key(str(b.get("key", "")), b.get("n", 1))
            elif path == "/api/text":
                res = remote_text(str(b.get("text", "")))
            elif path == "/api/state":
                res = remote_state()
            elif path == "/api/launch":
                res = remote_launch(b)
            elif path == "/api/volume":
                res = remote_volume(b.get("level"))
            elif path == "/api/power":
                res = remote_power(str(b.get("action", "")))
            else:
                send_json(self, {"ok": False, "error": "not found"}, 404)
                return
        except Exception as e:
            log("remote error", path, repr(e))
            res = {"ok": False, "error": "İşlem yapılamadı"}
        send_json(self, res)


def main():
    remote_load()
    try:
        rsrv = http.server.ThreadingHTTPServer(("0.0.0.0", REMOTE_PORT), RemoteHandler)
        threading.Thread(target=rsrv.serve_forever, daemon=True).start()
    except OSError as e:
        log("kumanda sunucusu açılamadı:", repr(e))
    threading.Thread(target=display_watch, daemon=True).start()
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    log("beeOS arka ucu", HOME_URL, "web:", WEB_ROOT, "kumanda portu:", REMOTE_PORT)
    srv.serve_forever()


if __name__ == "__main__":
    main()
