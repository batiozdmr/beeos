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
import base64
import fcntl
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
import struct
import subprocess
import sys
import tarfile
import threading
import time
import unicodedata
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
    mp = mirror_pending()
    return {"ok": True, "online": state.strip() == "connected", "name": name,
            "remoteSeq": remote["seq"], "mirror": mp.get("pending"), "mirrorState": mp.get("state")}


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
    """connect: gerekirse eşleştirir (DisplayYesNo ajanıyla: sayısal karşılaştırmayı destekleyen
    cihazlar MITM'e karşı güvenli; desteklemeyen cihazlar just-works'a düşer, o da kullanıcıya
    "eşleşme modunda mı?" diye sorduğu sürece dikkate alınabilir), güvenilir yapar ve bağlanır."""
    if not MAC_RE.fullmatch(mac):
        return {"ok": False, "error": "Geçersiz cihaz"}
    if action == "connect":
        if mac not in bt_macs("Paired"):
            code, out = btctl("--agent", "DisplayYesNo", "--timeout", "30", "pair", mac, timeout=30)
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
# Uyku zamanlayıcı: belirli dakika sonra `power("off")`
sleep_timer = {"t": None, "until": 0.0, "action": ""}
sleep_lock = threading.Lock()


def power(action):
    cmd = {"off": "poweroff", "reboot": "reboot"}.get(action)
    if not cmd:
        return {"ok": False, "error": "Geçersiz işlem"}
    # Cevap gönderildikten sonra kapat
    threading.Timer(1.0, lambda: subprocess.run(["systemctl", cmd])).start()
    return {"ok": True}


def sleep_set(minutes, action="off"):
    """Dakika >0: zamanlayıcı kur. 0: iptal."""
    try: m = max(0, min(600, int(minutes)))
    except (TypeError, ValueError): m = 0
    if action not in ("off", "closeapps"):
        action = "off"
    with sleep_lock:
        if sleep_timer["t"]:
            sleep_timer["t"].cancel()
            sleep_timer["t"] = None
        if m > 0:
            sleep_timer["until"] = time.time() + m * 60
            sleep_timer["action"] = action
            t = threading.Timer(m * 60, lambda: _sleep_fire(action))
            t.daemon = True
            t.start()
            sleep_timer["t"] = t
        else:
            sleep_timer["until"] = 0
            sleep_timer["action"] = ""
    return sleep_get()


def _sleep_fire(action):
    with sleep_lock:
        sleep_timer["t"] = None
        sleep_timer["until"] = 0
    if action == "closeapps":
        close_apps()
    else:
        power("off")


def sleep_get():
    with sleep_lock:
        left = max(0, int(sleep_timer["until"] - time.time())) if sleep_timer["until"] else 0
    return {"ok": True, "left": left, "action": sleep_timer["action"] if left else ""}


# ---------- yedekleme / geri yükleme ----------
BACKUP_FILES = {
    "settings": "/var/lib/beeos/settings.json",   # arayüzün kendi settings'i (UI /api/backup ile yollar)
    "remote": REMOTE_FILE,                        # kumanda eşleşmeleri + PIN
    "lists": "/var/lib/beeos/tv-lists.json",      # (opsiyonel) M3U listeleri — UI tutuyorsa
}


def backup_export():
    """Tüm kullanıcı ayarlarını tek JSON olarak döndür. UI dosyaya kaydedip başka kuruluma taşıyabilir."""
    out = {"version": VERSION, "ts": int(time.time()), "data": {}}
    for key, path in BACKUP_FILES.items():
        try:
            with open(path, encoding="utf-8") as f:
                out["data"][key] = json.load(f)
        except (OSError, ValueError):
            pass
    return {"ok": True, "backup": out}


def backup_import(data):
    """UI'den gelen JSON ile ayarları geri yükle. PIN/oturum dahil değil (güvenlik)."""
    if not isinstance(data, dict) or not isinstance(data.get("data"), dict):
        return {"ok": False, "error": "Geçersiz yedek dosyası"}
    restored = []
    for key, path in BACKUP_FILES.items():
        if key == "remote":
            continue  # eşleşmeler yeniden yapılsın (güvenlik)
        content = data["data"].get(key)
        if content is None:
            continue
        try:
            os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
            tmp = path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(content, f)
            os.replace(tmp, path)
            restored.append(key)
        except OSError as e:
            log("backup restore başarısız:", key, repr(e))
    return {"ok": True, "restored": restored}


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
    res = {"ok": True, "current": VERSION, "state": upd["state"], "progress": upd["progress"], "error": upd["error"],
           "rollback": {"available": rollback_available(), "version": rollback_version()}}
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
        prev = upd.get("release") or {}
        upd["release"] = {"version": version, "available": bool(newer and pkg and sha),
                          "notes": str(rel.get("body") or "")[:1500], "size": (pkg or {}).get("size", 0),
                          "pkg": pkg, "sha": sha, "assets": assets}
        if upd["state"] == "error":
            upd.update(state="idle", error="")
    # Yeni sürüm: bildirim merkezinde kalıcı not
    if newer and pkg and sha and prev.get("version") != version:
        notify("Yeni sürüm: beeOS %s" % version,
               "Ayarlar > Güncelleme menüsünden kurabilirsin.", "info")
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
    verify_signature(r, path)


UPDATE_PUB = "/etc/beeos/update.pub"


def verify_signature(r, path):
    """minisign imzasını doğrula. Anahtar varsa imzasız paket REDDEDİLİR (0.8+ zorunlu).
    Release'te `beeos-update-<sürüm>.tar.gz.minisig` indirilir, minisign ile doğrulanır."""
    if not os.path.isfile(UPDATE_PUB):
        # Anahtar henüz dağıtılmadıysa uyar ama engelleme (eski cihazlar için geçiş)
        log("imza anahtarı yok, imza doğrulama atlandı:", UPDATE_PUB)
        return
    if shutil.which("minisign") is None:
        raise UpdateError("İmza doğrulayıcı (minisign) bulunamadı")
    sig_asset = (r.get("assets") or {}).get("beeos-update-%s.tar.gz.minisig" % r["version"])
    if not sig_asset:
        raise UpdateError("Paket imzalı değil — reddedildi")
    sig_path = path + ".minisig"
    try:
        url, accept = asset_url(sig_asset)
        with gh_open(url, accept) as f, open(sig_path, "wb") as out:
            out.write(f.read(4096))
    except OSError as e:
        raise UpdateError("İmza dosyası indirilemedi") from e
    try:
        subprocess.run(["minisign", "-V", "-p", UPDATE_PUB, "-m", path, "-x", sig_path],
                       check=True, capture_output=True, timeout=30)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
        raise UpdateError("İmza doğrulanamadı") from e


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


# ---------- bildirim merkezi ----------
# Önemli olaylar (güncelleme çıktı, kumanda eşleşti, yansıtma isteği, kanal kırıldı, hata)
# son 50 tanesi burada tutulur; UI /api/notifications ile okur/siler.
notifications = []          # [{id, ts, title, body, kind, seen}]
_notif_lock = threading.Lock()
NOTIF_MAX = 50


def notify(title, body="", kind="info"):
    """kind: info | warn | success | error. UI banner olarak gösterilebilir, panelde kalır."""
    with _notif_lock:
        n = {"id": secrets.token_hex(4), "ts": int(time.time()),
             "title": str(title)[:120], "body": str(body or "")[:400],
             "kind": kind if kind in ("info", "warn", "success", "error") else "info",
             "seen": False}
        notifications.insert(0, n)
        del notifications[NOTIF_MAX:]
    return n


def notification_list(mark_seen=False):
    with _notif_lock:
        out = list(notifications)
        if mark_seen:
            for n in notifications:
                n["seen"] = True
    return {"ok": True, "unread": sum(1 for n in out if not n["seen"]), "items": out}


def notification_clear(item_id=None):
    with _notif_lock:
        if item_id:
            for i, n in enumerate(notifications):
                if n["id"] == item_id:
                    del notifications[i]
                    break
        else:
            notifications[:] = []
    return {"ok": True}


# ---------- tanı + UI log ----------
UI_LOG = os.path.join(STATE_DIR, "ui.log")
UI_LOG_MAX = 2 * 1024 * 1024    # 2 MB, logrotate devralır


def ui_log_write(events):
    if not isinstance(events, list):
        return
    try:
        os.makedirs(STATE_DIR, exist_ok=True)
        if os.path.exists(UI_LOG) and os.path.getsize(UI_LOG) > UI_LOG_MAX:
            os.rename(UI_LOG, UI_LOG + ".1")
        with open(UI_LOG, "a", encoding="utf-8") as f:
            for e in events[:100]:
                if isinstance(e, dict):
                    f.write(json.dumps(e, ensure_ascii=False) + "\n")
    except OSError:
        pass


def _df_ratio(path):
    try:
        st = shutil.disk_usage(path)
        return round((st.total - st.free) / st.total, 2) if st.total else 0.0
    except OSError:
        return 0.0


def diag_info():
    net = {}
    try:
        ip = subprocess.run(["hostname", "-I"], capture_output=True, text=True, timeout=3).stdout.split()
        net["ip"] = ip[0] if ip else ""
    except (OSError, subprocess.TimeoutExpired):
        pass
    try:
        out = subprocess.run(["nmcli", "-t", "-f", "ACTIVE,SSID", "device", "wifi"],
                             capture_output=True, text=True, timeout=3).stdout
        for line in out.splitlines():
            if line.startswith("yes:"):
                net["ssid"] = line.split(":", 1)[1]
                break
    except (OSError, subprocess.TimeoutExpired):
        pass
    return {"ok": True,
            "net": net,
            "disk": {"beeos": _df_ratio(BEEOS_DIR), "log": _df_ratio(STATE_DIR)},
            "update": {"state": upd["state"], "current": VERSION},
            "proxy": {"count": proxy_stats["count"], "err": proxy_stats["err"]}}


proxy_stats = {"count": 0, "err": 0}


def rollback_available():
    """Önceki sürüme dönüş mümkün mü? Hem web hem bin'in .prev klasörü dolu olmalı.
    overlay.prev varsa onu da geri yükler (systemd unit'leri + sway ayarı)."""
    for part in ("web", "bin"):
        prev = os.path.join(BEEOS_DIR, part + ".prev")
        if not os.path.isdir(prev):
            return False
    return True


def _restore_overlay_prev():
    """overlay.prev içindeki dosyaları orijinal yollarına geri yaz (varsa).
    Yeni sürümde eklenen dosyaları (manifest.added) sil."""
    overlay_prev = os.path.join(BEEOS_DIR, "overlay.prev")
    if not os.path.isdir(overlay_prev):
        return
    # 1) Önceki içerikleri geri yaz
    for d, _, files in os.walk(overlay_prev):
        for n in files:
            if n == "manifest.json":
                continue
            src = os.path.join(d, n)
            rel = os.path.relpath(src, overlay_prev)
            dest = os.path.join("/", rel)
            try:
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                tmp = dest + ".beeos-rollback"
                shutil.copy2(src, tmp)
                os.replace(tmp, dest)
            except OSError as e:
                log("overlay rollback bir dosyada başarısız:", rel, repr(e))
    # 2) Yeni sürümde eklenen dosyaları sil (yetim systemd unit vb. kalmasın)
    try:
        with open(os.path.join(overlay_prev, "manifest.json"), encoding="utf-8") as f:
            added = json.load(f).get("added", [])
        for p in added:
            if isinstance(p, str) and p.startswith("/"):
                try: os.remove(p)
                except OSError: pass
    except (OSError, ValueError, KeyError):
        pass


def rollback_version():
    """Dönülecek sürüm numarası (web.prev/appinfo.json'dan okunur)."""
    try:
        with open(os.path.join(BEEOS_DIR, "web.prev", "appinfo.json"), encoding="utf-8") as f:
            return str(json.load(f).get("version") or "")
    except (OSError, ValueError, KeyError):
        return ""


def update_rollback():
    """Bir önceki sürüme döner: web <-> web.prev, bin <-> bin.prev takas. İmza doğrulamasına gerek yok,
    çünkü dönülen sürüm bu cihazda daha önce kurulup çalışmış sürüm. Takas sonrası servisler yeniden başlar."""
    with upd_lock:
        if upd["state"] not in ("idle", "error"):
            return update_state()
        if not rollback_available():
            upd.update(state="error", error="Dönülecek önceki sürüm bulunamadı.")
            return update_state()
        upd.update(state="install", progress=0, error="")
    try:
        for part in ("web", "bin"):
            dest = os.path.join(BEEOS_DIR, part)
            prev = dest + ".prev"
            tmp = dest + ".rollback-tmp"
            # dest -> tmp, prev -> dest, tmp -> prev  (yarım kalırsa ilk iki rename atomik, son adım cosmetic)
            os.rename(dest, tmp)
            try:
                os.rename(prev, dest)
            except OSError:
                os.rename(tmp, dest)
                raise
            try:
                os.rename(tmp, prev)
            except OSError:
                shutil.rmtree(tmp, ignore_errors=True)
        _restore_overlay_prev()
        log("sürüm geri alındı: %s -> %s" % (VERSION, rollback_version() or "?"))
        upd.update(state="restart")
        subprocess.run(["systemctl", "daemon-reload"], timeout=60)
        swaymsg("reload")
        restart = ("systemctl restart beeos-backend; i=0; while [ $i -lt 40 ] && ! curl -fs -o /dev/null "
                   "-H 'X-BeeOS: 1' http://127.0.0.1:%d/api/info; do sleep 0.5; i=$((i+1)); done; "
                   "pkill -u %s -x chrome" % (PORT, BEE))
        threading.Timer(2.0, lambda: subprocess.run(["systemd-run", "--no-block", "--collect",
                                                     "--unit=beeos-update-restart", "/bin/sh", "-c", restart])).start()
    except OSError as e:
        with upd_lock:
            upd.update(state="error", error="Geri alma başarısız: " + str(e))
    return update_state()


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
    # Sistem dosyaları (systemd birimleri, sway ayarı, açılış teması):
    # iki aşama — önce hepsi tmp olarak hedefe kopyalanır, hiçbir hata olmazsa toplu rename.
    # Yarım kalırsa (güç kesilmesi) temizlenecek .beeos-new dosyaları kalır, eski kurulum çalışmaya devam eder.
    overlay = os.path.join(stage, "overlay")
    staged = []    # (tmp, dest, backup)
    try:
        for d, _, files in os.walk(overlay):
            dest_dir = os.path.normpath(os.path.join("/", os.path.relpath(d, overlay)))
            if dest_dir.startswith((BEEOS_DIR + "/bin", BEEOS_DIR + "/web")):
                continue
            os.makedirs(dest_dir, exist_ok=True)
            for n in files:
                tmp = os.path.join(dest_dir, ".%s.beeos-new" % n)
                dest = os.path.join(dest_dir, n)
                shutil.copy2(os.path.join(d, n), tmp)
                staged.append((tmp, dest))
        # Overlay snapshot: rollback için önceki hâllerini sakla.
        # Ayrıca "manifest.json" — yeni sürümde eklenen dosyaların listesi (rollback'te silinecek).
        overlay_prev = os.path.join(BEEOS_DIR, "overlay.prev")
        shutil.rmtree(overlay_prev, ignore_errors=True)
        os.makedirs(overlay_prev, mode=0o700, exist_ok=True)
        new_files = []
        for tmp, dest in staged:
            if os.path.exists(dest):
                rel = dest.lstrip("/")
                bak = os.path.join(overlay_prev, rel)
                os.makedirs(os.path.dirname(bak), exist_ok=True)
                try:
                    shutil.copy2(dest, bak)
                except OSError:
                    pass
            else:
                # Yeni sürümle eklendi; rollback'te silinmeli
                new_files.append(dest)
        try:
            with open(os.path.join(overlay_prev, "manifest.json"), "w", encoding="utf-8") as f:
                json.dump({"added": new_files}, f)
        except OSError:
            pass
        # Toplu rename
        for tmp, dest in staged:
            os.replace(tmp, dest)
    except OSError as e:
        # Yarım tmp'leri temizle
        for tmp, _ in staged:
            try: os.remove(tmp)
            except OSError: pass
        raise UpdateError("Sistem dosyaları yazılamadı: " + str(e)) from e
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
_photo_cache = {"ts": 0.0, "res": None}
_PHOTO_TTL = 60.0


def photo_list():
    now = time.time()
    if _photo_cache["res"] is not None and now - _photo_cache["ts"] < _PHOTO_TTL:
        return _photo_cache["res"]
    files = []
    for d in PHOTO_DIRS:
        try:
            names = sorted(os.listdir(d))
        except OSError:
            continue
        files += [os.path.join(d, n) for n in names
                  if n.lower().endswith(PHOTO_EXT) and not n.startswith(".")]
    photos[:] = files[:500]
    _photo_cache["res"] = {"ok": True, "photos": ["/photos/%d" % i for i in range(len(photos))]}
    _photo_cache["ts"] = now
    return _photo_cache["res"]


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


def _allow_lan():
    """Yerel ağdaki Tvheadend / router yayın hizmetlerine izin ver (opt-in).
    Tek kaynak: /etc/beeos/remote.json → {"allowLan": true}. Eskiden update.json'da da bakılıyordu;
    0.9'da sadece remote.json. Uyum için eskisi varsa uyarı logla."""
    try:
        with open("/etc/beeos/remote.json", encoding="utf-8") as f:
            v = bool(json.load(f).get("allowLan"))
        if v:
            return True
    except (OSError, ValueError, KeyError):
        pass
    # Uyumluluk: yanlış yerde ayarlanmış → uyar
    try:
        with open(UPDATE_CONF, encoding="utf-8") as f:
            if json.load(f).get("allowLan"):
                log("UYARI: allowLan /etc/beeos/update.json'da; /etc/beeos/remote.json'a taşı.")
                return True
    except (OSError, ValueError, KeyError):
        pass
    return False


def tv_url_ok(url):
    u = urllib.parse.urlsplit(url)
    if u.scheme not in ("http", "https") or not u.hostname:
        return False
    try:
        infos = socket.getaddrinfo(u.hostname, u.port or None)
    except (OSError, ValueError):
        return False
    allow_lan = _allow_lan()
    for info in infos:
        ip = ipaddress.ip_address(info[4][0].split("%")[0])
        if ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_unspecified or ip.is_reserved:
            return False
        # SSRF koruması: LAN kaynakları (router admin, NAS, IPTV panel) proxy'den geçmesin
        if ip.is_private and not allow_lan:
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


TV_CACHE_DIR = os.path.join(STATE_DIR, "tv-cache")
TV_CACHE_TTL = 6 * 3600          # 6 saat
TV_CACHE_STALE = 72 * 3600       # 3 gün — ağ yoksa bu kadar süre eski veri sun


def _tv_cache_path(url):
    return os.path.join(TV_CACHE_DIR, hashlib.sha256(url.encode("utf-8")).hexdigest() + ".bin")


def tv_proxy_cache_lookup(url, raw, stale_ok=False):
    try:
        p = _tv_cache_path(url)
        age = time.time() - os.path.getmtime(p)
        if age > (TV_CACHE_STALE if stale_ok else TV_CACHE_TTL):
            return None
        with open(p, "rb") as f:
            header = f.readline().rstrip(b"\n").decode("utf-8", "replace")
            body = f.read()
        return {"ctype": header or "application/octet-stream", "body": body}
    except (OSError, ValueError):
        return None


def tv_proxy_cache_store(url, ctype, body):
    try:
        os.makedirs(TV_CACHE_DIR, exist_ok=True)
        p = _tv_cache_path(url)
        tmp = p + ".tmp"
        with open(tmp, "wb") as f:
            f.write((ctype or "application/octet-stream").encode("utf-8") + b"\n")
            f.write(body)
        os.replace(tmp, p)
    except OSError as e:
        log("tv cache yazılamadı:", repr(e))


def tv_proxy(h, query):
    q = urllib.parse.parse_qs(query)
    url = (q.get("u") or [""])[0]
    raw = q.get("raw") == ["1"]
    if not tv_url_ok(url):
        h.send_error(400)
        return
    # XMLTV / M3U listesi gibi yavaş ve statik kaynaklar için disk önbellek: 6 saat taze kalır.
    # Yayın segmentleri (TS/MP4) asla cache'lenmez — her çağrıda canlı akar.
    cache = tv_proxy_cache_lookup(url, raw) if raw else None
    if cache:
        h.send_response(200)
        h.send_header("Content-Type", cache["ctype"])
        h.send_header("Content-Length", str(len(cache["body"])))
        h.send_header("X-BeeOS-Cache", "hit")
        h.end_headers()
        h.wfile.write(cache["body"])
        return
    req = urllib.request.Request(url, headers={"User-Agent": STREAM_UA, "Accept": "*/*"})
    try:
        r = tv_opener.open(req, timeout=15)
    except urllib.error.HTTPError as e:
        # Hata durumunda eski önbellek varsa onu dön — kullanıcı EPG'siz kalmasın.
        stale = tv_proxy_cache_lookup(url, raw, stale_ok=True) if raw else None
        if stale:
            h.send_response(200)
            h.send_header("Content-Type", stale["ctype"])
            h.send_header("Content-Length", str(len(stale["body"])))
            h.send_header("X-BeeOS-Cache", "stale")
            h.end_headers()
            h.wfile.write(stale["body"])
            return
        h.send_error(e.code if 400 <= e.code < 600 else 502)
        return
    except (urllib.error.URLError, OSError, ValueError):
        stale = tv_proxy_cache_lookup(url, raw, stale_ok=True) if raw else None
        if stale:
            h.send_response(200)
            h.send_header("Content-Type", stale["ctype"])
            h.send_header("Content-Length", str(len(stale["body"])))
            h.send_header("X-BeeOS-Cache", "stale")
            h.end_headers()
            h.wfile.write(stale["body"])
            return
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
            buf = bytearray() if raw else None
            while chunk and sent < (TV_LIST_MAX if raw else TV_MAX):
                h.wfile.write(chunk)
                sent += len(chunk)
                if buf is not None and len(buf) <= TV_LIST_MAX:
                    buf += chunk
                chunk = r.read(65536)
            if buf is not None and 128 <= len(buf) <= TV_LIST_MAX:
                tv_proxy_cache_store(url, ctype, bytes(buf))
    except (BrokenPipeError, ConnectionResetError):
        pass       # kanal değişince oynatıcı isteği yarıda bırakır
    except OSError as e:
        log("tv proxy", repr(e))


# ---------- telefon kumandası ----------
remote = {"enabled": True, "pin": "", "seq": 0}   # seq: başarılı eşleşme sayısı (beeOS'ta bildirim)
fails = {"n": 0, "until": 0.0, "rounds": 0}
# IP başına başarısızlık sayacı: brute-force dağıtılmış denemeyi engelle
ip_fails = {}       # ip -> {"n": int, "until": float, "rounds": int}
_ip_lock = threading.Lock()


def _ip_check(ip):
    """Bu IP kilitli mi? Kilitli ise kalan saniye döndür, değilse 0."""
    with _ip_lock:
        d = ip_fails.get(ip)
        if not d:
            return 0
        now = time.time()
        if d["until"] > now:
            return int(d["until"] - now)
        # Süresi dolmuş: sayacı sıfırla
        if d["until"] and d["until"] < now - 3600:
            del ip_fails[ip]
        return 0


def _ip_record_fail(ip):
    """IP başına 5 hata → 2dk, 10 → 15dk, 20 → 2sa kilitli."""
    with _ip_lock:
        d = ip_fails.setdefault(ip, {"n": 0, "until": 0.0, "rounds": 0})
        d["n"] += 1
        if d["n"] >= 5:
            d["rounds"] += 1
            lock_sec = 120 if d["rounds"] == 1 else 900 if d["rounds"] == 2 else 7200
            d["n"] = 0
            d["until"] = time.time() + lock_sec


def _ip_record_ok(ip):
    with _ip_lock:
        ip_fails.pop(ip, None)
# Oturum anahtarları: her PIN başarılı doğrulamada id+secret üretilir. Sonraki istekler
# X-BeeOS-Session + X-BeeOS-Sig ile imzalanır; PIN'i ağa gönderme sayısı 1'e düşer.
sessions = {}       # id -> {"secret":bytes,"created":ts,"last":ts,"name":str}
SESSION_TTL = 30 * 24 * 3600        # 30 gün hareketsiz → silinir
SESSION_MAX = 4                     # aynı anda en fazla 4 oturum
NONCES = {}         # nonce -> ts (son 5 dk, replay engeli)
NONCE_TTL = 300
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
        for sid, s in (d.get("sessions") or {}).items():
            if re.fullmatch(r"[0-9a-f]{32}", str(sid)) and re.fullmatch(r"[0-9a-f]{64}", str(s.get("secret", ""))):
                sessions[sid] = {"secret": bytes.fromhex(s["secret"]),
                                 "created": float(s.get("created", time.time())),
                                 "last": float(s.get("last", time.time())),
                                 "name": str(s.get("name", ""))[:48]}
    except (OSError, ValueError):
        pass
    if not remote["pin"]:
        remote["pin"] = new_pin()
        remote_save()


_save_throttle = {"pending": False, "t": None}
_save_lock = threading.Lock()


def _remote_save_now():
    os.makedirs(STATE_DIR, mode=0o700, exist_ok=True)
    try:
        os.chmod(STATE_DIR, 0o700)
    except OSError:
        pass
    tmp = REMOTE_FILE + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        data = json.dumps({
            "enabled": remote["enabled"], "pin": remote["pin"],
            "sessions": {sid: {"secret": s["secret"].hex(), "created": s["created"],
                               "last": s["last"], "name": s["name"]}
                         for sid, s in sessions.items()}
        }).encode("utf-8")
        os.write(fd, data)
        os.fsync(fd)
    finally:
        os.close(fd)
    os.replace(tmp, REMOTE_FILE)


def remote_save():
    """Senkron yazım: PIN/oturum değişimi vb. kritik değişiklikler için."""
    with _save_lock:
        if _save_throttle["t"]:
            _save_throttle["t"].cancel()
            _save_throttle["t"] = None
            _save_throttle["pending"] = False
        _remote_save_now()


def remote_save_throttled():
    """Sık güncellemeler (oturum last timestamp): 30 sn'de bir diske yaz."""
    with _save_lock:
        if _save_throttle["pending"]:
            return
        _save_throttle["pending"] = True

        def _flush():
            with _save_lock:
                _save_throttle["pending"] = False
                _save_throttle["t"] = None
            try:
                _remote_save_now()
            except OSError as e:
                log("remote throttled save:", repr(e))

        _save_throttle["t"] = threading.Timer(30.0, _flush)
        _save_throttle["t"].daemon = True
        _save_throttle["t"].start()


def session_create(name=""):
    """Yeni oturum: 16 byte id + 32 byte secret. Fazla oturum varsa en eskiyi at."""
    if len(sessions) >= SESSION_MAX:
        oldest = min(sessions.items(), key=lambda kv: kv[1]["last"])[0]
        del sessions[oldest]
    sid = secrets.token_hex(16)
    sessions[sid] = {"secret": secrets.token_bytes(32),
                     "created": time.time(), "last": time.time(),
                     "name": str(name or "")[:48]}
    remote_save()
    return sid, sessions[sid]["secret"]


def session_check(headers, method, path, body_bytes):
    """Başarılıysa (sid, secret) döndür, yoksa None. İmza: hex(hmac_sha256(secret, m+'\\n'+p+'\\n'+nonce+'\\n'+body))."""
    sid = headers.get("X-BeeOS-Session", "")
    sig = headers.get("X-BeeOS-Sig", "")
    nonce = headers.get("X-BeeOS-Nonce", "")
    if not (re.fullmatch(r"[0-9a-f]{32}", sid) and re.fullmatch(r"[0-9a-f]{64}", sig)
            and re.fullmatch(r"[0-9a-zA-Z_-]{8,64}", nonce)):
        return None
    s = sessions.get(sid)
    if not s:
        return None
    if time.time() - s["last"] > SESSION_TTL:
        del sessions[sid]
        remote_save()
        return None
    now = time.time()
    for n, t in list(NONCES.items()):
        if now - t > NONCE_TTL:
            del NONCES[n]
    if nonce in NONCES:
        return None
    msg = (method + "\n" + path + "\n" + nonce + "\n").encode("utf-8") + (body_bytes or b"")
    want = hmac.new(s["secret"], msg, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(want, sig):
        return None
    NONCES[nonce] = now
    s["last"] = now
    remote_save_throttled()
    return sid


def lan_urls():
    p = subprocess.run(["ip", "-4", "-o", "addr", "show", "scope", "global"],
                       capture_output=True, text=True, timeout=5)
    ips = re.findall(r"inet (\d+\.\d+\.\d+\.\d+)/", p.stdout)
    # HTTPS: WebRTC/getDisplayMedia yalnız secure context'te çalışır. Sertifika kendinden imzalı,
    # tarayıcı ilk açılışta "güvenli değil" uyarısı verir; bir kez kabul etmek yeter.
    return ["https://%s:%d" % (ip, REMOTE_PORT) for ip in ips]


REMOTE_CERT = os.path.join(STATE_DIR, "remote-cert.pem")
REMOTE_KEY = os.path.join(STATE_DIR, "remote-key.pem")


def _current_ips():
    try:
        p = subprocess.run(["ip", "-4", "-o", "addr", "show", "scope", "global"],
                           capture_output=True, text=True, timeout=5)
        return re.findall(r"inet (\d+\.\d+\.\d+\.\d+)/", p.stdout)
    except (OSError, subprocess.TimeoutExpired):
        return []


def remote_cert():
    """Telefon kumandası için kendinden imzalı sertifika üretir (ilk açılışta). CN=beeos-remote.
    IP değişirse yeniden üretir; SAN'a tüm aktif IP'ler eklenir."""
    ips = _current_ips()
    san = "DNS:beeos,DNS:localhost"
    for ip in ips:
        san += ",IP:" + ip
    need = True
    if os.path.exists(REMOTE_CERT) and os.path.exists(REMOTE_KEY):
        try:
            out = subprocess.run(["openssl", "x509", "-in", REMOTE_CERT, "-noout", "-text"],
                                 capture_output=True, text=True, timeout=5).stdout
            need = not all(("IP Address:" + ip) in out for ip in ips)
        except (OSError, subprocess.TimeoutExpired):
            need = False
    if not need:
        return True
    os.makedirs(STATE_DIR, mode=0o700, exist_ok=True)
    try:
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
                        "-keyout", REMOTE_KEY, "-out", REMOTE_CERT,
                        "-days", "3650", "-subj", "/CN=beeos-remote",
                        "-addext", "subjectAltName=" + san],
                       check=True, capture_output=True, timeout=20)
        os.chmod(REMOTE_KEY, 0o600)
        os.chmod(REMOTE_CERT, 0o644)
        return True
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
        log("sertifika üretilemedi:", repr(e))
        return False


def remote_cert_fingerprint():
    """SHA-256 fingerprint of DER cert, base64url (pinning için QR'a yazılır)."""
    try:
        p = subprocess.run(["openssl", "x509", "-in", REMOTE_CERT, "-outform", "DER"],
                           capture_output=True, timeout=5)
        if p.returncode != 0:
            return ""
        return base64.urlsafe_b64encode(hashlib.sha256(p.stdout).digest()).decode("ascii").rstrip("=")
    except (OSError, subprocess.TimeoutExpired):
        return ""


def remote_info():
    return {"ok": True, "enabled": remote["enabled"], "pin": remote["pin"], "urls": lan_urls(),
            "fingerprint": remote_cert_fingerprint(),
            "sessions": [{"id": sid, "name": s["name"], "last": int(s["last"])}
                         for sid, s in sorted(sessions.items(), key=lambda kv: -kv[1]["last"])]}


def remote_set(b):
    if isinstance(b.get("enabled"), bool):
        remote["enabled"] = b["enabled"]
    if b.get("newPin") is True:
        remote["pin"] = new_pin()
    if b.get("forgetAll") is True:
        sessions.clear()
    elif b.get("forget"):
        sessions.pop(str(b["forget"]), None)
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
            "online": st["online"], "network": st["name"],
            "fingerprint": remote_cert_fingerprint()}


# ---------- fare (touchpad): /dev/uinput ile sanal fare ----------
# Phone remote'tan gelen delta/tıklama olayları kernel'e yazılır; libinput onu normal bir fare gibi sway'e verir.
# Bee kullanıcısı "input" grubunda (bkz. os/build.sh). Backend root çalışır, /dev/uinput'a yazabilir.
class UInputMouse:
    EV_SYN, EV_KEY, EV_REL = 0, 1, 2
    SYN_REPORT = 0
    REL_X, REL_Y, REL_WHEEL = 0, 1, 8
    BTN_LEFT, BTN_RIGHT, BTN_MIDDLE = 0x110, 0x111, 0x112
    UI_SET_EVBIT = 0x40045564
    UI_SET_KEYBIT = 0x40045565
    UI_SET_RELBIT = 0x40045566
    UI_DEV_SETUP = 0x405C5503   # _IOW('U', 3, struct uinput_setup) ; sizeof=92
    UI_DEV_CREATE = 0x5501
    UI_DEV_DESTROY = 0x5502
    BTN = {"left": BTN_LEFT, "right": BTN_RIGHT, "middle": BTN_MIDDLE}

    def __init__(self):
        self.fd = None
        self.lock = threading.Lock()

    last_error = ""

    def _open(self):
        try:
            fd = os.open("/dev/uinput", os.O_WRONLY | os.O_NONBLOCK)
        except OSError as e:
            # İlk hatada modül eksik olabilir; modprobe dene
            if e.errno == 2:  # ENOENT
                try:
                    subprocess.run(["modprobe", "uinput"], capture_output=True, timeout=3)
                    fd = os.open("/dev/uinput", os.O_WRONLY | os.O_NONBLOCK)
                except (OSError, subprocess.TimeoutExpired):
                    UInputMouse.last_error = "uinput modülü yüklenemedi (sudo modprobe uinput)"
                    log("uinput açılamadı:", repr(e))
                    return None
            else:
                UInputMouse.last_error = ("Yetki yok (/dev/uinput erişilemez)"
                                          if e.errno == 13 else "uinput: " + e.strerror)
                log("uinput açılamadı:", repr(e))
                return None
        try:
            for t in (self.EV_KEY, self.EV_REL, self.EV_SYN):
                fcntl.ioctl(fd, self.UI_SET_EVBIT, t)
            for b in (self.BTN_LEFT, self.BTN_RIGHT, self.BTN_MIDDLE):
                fcntl.ioctl(fd, self.UI_SET_KEYBIT, b)
            for r in (self.REL_X, self.REL_Y, self.REL_WHEEL):
                fcntl.ioctl(fd, self.UI_SET_RELBIT, r)
            setup = struct.pack("HHHH80sI", 6, 0x1234, 0x5678, 1, b"beeOS telefon touchpad", 0)
            fcntl.ioctl(fd, self.UI_DEV_SETUP, setup)
            fcntl.ioctl(fd, self.UI_DEV_CREATE)
        except OSError as e:
            log("uinput kurulamadı:", repr(e))
            os.close(fd)
            return None
        time.sleep(0.15)   # sway'in cihazı görmesi için kısa bekleme
        return fd

    def _ensure(self):
        if self.fd is None:
            self.fd = self._open()
        return self.fd is not None

    def _emit(self, type_, code, value):
        # input_event: struct timeval (ll=16) + __u16 type + __u16 code + __s32 value = 24 bayt
        os.write(self.fd, struct.pack("llHHi", 0, 0, type_, code, value))

    def _sync(self):
        self._emit(self.EV_SYN, self.SYN_REPORT, 0)

    def do(self, dx=0, dy=0, click=None, down=None, up=None, wheel=0):
        with self.lock:
            if not self._ensure():
                return False
            try:
                if dx:
                    self._emit(self.EV_REL, self.REL_X, int(dx))
                if dy:
                    self._emit(self.EV_REL, self.REL_Y, int(dy))
                if wheel:
                    self._emit(self.EV_REL, self.REL_WHEEL, int(wheel))
                if click:
                    code = self.BTN.get(str(click).lower(), self.BTN_LEFT)
                    self._emit(self.EV_KEY, code, 1); self._sync()
                    self._emit(self.EV_KEY, code, 0)
                if down:
                    self._emit(self.EV_KEY, self.BTN.get(str(down).lower(), self.BTN_LEFT), 1)
                if up:
                    self._emit(self.EV_KEY, self.BTN.get(str(up).lower(), self.BTN_LEFT), 0)
                self._sync()
                return True
            except OSError as e:
                log("uinput yazım başarısız:", repr(e))
                try: os.close(self.fd)
                except Exception: pass
                self.fd = None
                return False


uinput_mouse = UInputMouse()


def remote_cursor(b):
    def num(k, lo, hi):
        v = b.get(k, 0)
        try: v = int(v)
        except (TypeError, ValueError): v = 0
        return max(lo, min(hi, v))
    ok = uinput_mouse.do(num("dx", -300, 300), num("dy", -300, 300),
                         b.get("click"), b.get("down"), b.get("up"),
                         num("wheel", -15, 15))
    if ok:
        return {"ok": True}
    return {"ok": False, "error": UInputMouse.last_error or "Fare açılamadı (uinput)"}


# ---------- ekran yansıtma: WebRTC sinyal rolesi (video verisi doğrudan P2P akar) ----------
# Telefon offerer, TV (mirror.html) answerer. Sinyal takası küçük bir in-memory kutuda.
# Güvenlik:
#  - mirror_start kullanıcı onayı bekler (pending durumu). beeOS arayüzü /api/mirror/pending ile
#    sorar; kullanıcı "İzin ver" deyince /api/mirror/approve çağrılır, alıcı sayfa ancak o zaman açılır.
#  - Mirror oturumu tek seferlik rastgele token ile korunur: mirror.html ve telefon
#    her sinyal çağrısında X-BeeOS-Mirror başlığıyla token verir.
MIRROR_TIMEOUT = 60.0      # answerer bu süre içinde bağlanmazsa oturum silinir
MIRROR_IDLE = 30.0         # canlı iken ICE kesildikten sonra bu süre sessizlikte oturum düşer
mirror = {
    "offer": None, "answer": None, "offer_ice": [], "answer_ice": [],
    "ts": 0.0, "last": 0.0,
    "token": "",             # offerer (telefon) token'ı
    "answerer_token": "",    # answerer (mirror.html) token'ı — URL ile iletilir
    "pending": None,
    "device": "", "state": "idle",     # idle | pending | waiting | live
    "error": "",             # son hata (offerer polling ile görür)
}
mirror_lock = threading.Lock()
_mirror_reaper_started = False


def _mirror_state():
    return mirror.get("state") or "idle"


def mirror_reset(error=""):
    with mirror_lock:
        mirror.update(offer=None, answer=None, offer_ice=[], answer_ice=[],
                      ts=0.0, last=0.0, token="", answerer_token="",
                      pending=None, device="", state="idle", error=error)


def _mirror_reaper():
    while True:
        time.sleep(5)
        try:
            with mirror_lock:
                st = mirror["state"]
                now = time.time()
                if st == "pending" and mirror["pending"] and now - mirror["pending"]["ts"] > MIRROR_TIMEOUT:
                    mirror["pending"] = None
                    mirror["state"] = "idle"
                elif st == "waiting" and now - mirror["ts"] > MIRROR_TIMEOUT:
                    mirror.update(offer=None, answer=None, offer_ice=[], answer_ice=[],
                                  ts=0.0, last=0.0, token="", state="idle", device="")
                elif st == "live" and mirror["last"] and now - mirror["last"] > MIRROR_IDLE:
                    mirror.update(offer=None, answer=None, offer_ice=[], answer_ice=[],
                                  ts=0.0, last=0.0, token="", state="idle", device="")
        except Exception as e:
            log("mirror reaper", repr(e))


def _ensure_mirror_reaper():
    global _mirror_reaper_started
    if _mirror_reaper_started:
        return
    _mirror_reaper_started = True
    threading.Thread(target=_mirror_reaper, daemon=True).start()


def mirror_start(b, device=""):
    """Telefon offer gönderir; kullanıcıdan onay bekleyen pending durumuna geçer.
    İki token üretilir: offerer (telefon header'da yollar), answerer (mirror.html URL'de alır)."""
    _ensure_mirror_reaper()
    sdp = b.get("sdp")
    if not sdp or not isinstance(sdp, str):
        return {"ok": False, "error": "offer eksik"}
    token = secrets.token_urlsafe(24)
    ans_token = secrets.token_urlsafe(24)
    with mirror_lock:
        if mirror["state"] in ("pending", "waiting", "live"):
            # İkinci cihaz araya giremez (O5): "önce durdur veya onay ekranından reddet".
            err = ("Başka bir cihaz onay bekliyor" if mirror["state"] == "pending"
                   else "Zaten bir yansıtma var. Önce durdur.")
            return {"ok": False, "error": err}
        mirror.update(offer=sdp, answer=None, offer_ice=[], answer_ice=[],
                      ts=time.time(), last=time.time(), token=token, answerer_token=ans_token,
                      pending={"ts": time.time(), "device": device or "Bilinmeyen cihaz"},
                      device=device or "Bilinmeyen cihaz", state="pending", error="")
    notify("Ekran yansıtma isteği", (device or "Bilinmeyen cihaz") + " paylaşmak istiyor.", "info")
    return {"ok": True, "token": token, "pending": True}


def mirror_pending():
    """beeOS arayüzü bunu bekler (uzun poll kısa için 2 sn). Döndüğü anda banner gösterir."""
    with mirror_lock:
        p = mirror["pending"]
        if not p:
            return {"ok": True, "pending": None, "state": mirror["state"]}
        return {"ok": True, "pending": {"device": p["device"], "ts": int(p["ts"])}, "state": mirror["state"]}


def mirror_approve(accept):
    with mirror_lock:
        p = mirror["pending"]
        if not p:
            return {"ok": False, "error": "Bekleyen istek yok"}
        if not accept:
            mirror_reset("Kullanıcı reddetti")
            return {"ok": True, "rejected": True}
        ans_token = mirror["answerer_token"]
        mirror.update(pending=None, state="waiting", ts=time.time(), last=time.time())
    # TV sekmesi oluştur — mirror_lock dışında (DevTools 5 sn bekleyebilir).
    # Answerer token URL ile iletilir; mirror.html her imza isteğine header'a koyar.
    try:
        tid = open_app("http://127.0.0.1:%d/mirror.html?tok=%s" % (PORT, ans_token), None)
        activate(tid)
    except Exception as e:
        log("mirror alıcı açılamadı:", repr(e))
        mirror_reset("Alıcı sayfası açılamadı")
        return {"ok": False, "error": "Alıcı sayfası açılamadı"}
    return {"ok": True}


def mirror_status():
    """Offerer polling ile görür: state (idle/pending/waiting/live) + son hata."""
    with mirror_lock:
        return {"ok": True, "state": mirror["state"], "error": mirror["error"] or ""}


def _check_mirror_token(headers, kind="offerer"):
    t = headers.get("X-BeeOS-Mirror", "") if headers is not None else ""
    with mirror_lock:
        want = mirror.get("token") if kind == "offerer" else mirror.get("answerer_token")
        want = want or ""
    return bool(want) and hmac.compare_digest(t, want)


def mirror_signal(b, headers=None, from_local=False):
    role = str(b.get("role", ""))   # "answerer" (TV) | "offerer" (telefon)
    # Her iki rol de kendi token'ını sağlamak zorunda: same-origin lokal sayfa yabancı answer enjekte edemez.
    kind = "answerer" if role == "answerer" else "offerer"
    if not _check_mirror_token(headers, kind):
        return {"ok": False, "error": "forbidden"}
    with mirror_lock:
        if mirror["state"] not in ("waiting", "live"):
            return {"ok": False, "error": "Aktif yansıtma yok"}
        now = time.time()
        if b.get("sdp") and role == "answerer":
            mirror["answer"] = str(b["sdp"])
            mirror["state"] = "live"
        if isinstance(b.get("ice"), list):
            key = "answer_ice" if role == "answerer" else "offer_ice"
            mirror[key].extend([c for c in b["ice"] if isinstance(c, dict)][:50])
        mirror["last"] = now
        if role == "answerer":
            return {"ok": True, "sdp": mirror.get("offer"), "ice": list(mirror["offer_ice"])}
        if role == "offerer":
            return {"ok": True, "sdp": mirror.get("answer"), "ice": list(mirror["answer_ice"])}
    return {"ok": False, "error": "role?"}


def remote_power(action):
    if action == "closeapps":
        return close_apps()
    return power(action)


_FORBID_CAT = ("Cc", "Cf", "Co", "Cs")


def _clean_text(s):
    # Yazdırılabilir + görünmez kontrol / bidi override karakterlerini at
    out = []
    for ch in s:
        if ch == " " or (ch.isprintable() and unicodedata.category(ch) not in _FORBID_CAT):
            out.append(ch)
    return "".join(out)[:200]


def remote_text(text):
    text = _clean_text(text)
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
# others_off: ekrana geçerken diğerlerini kapat (default). false → geliştirici modu: tüm ekranlar açık kalır.
display_mode = {"othersOff": True}


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
            show_on(name, display_mode["othersOff"])
            return {"ok": True}
        if not disp["timer"]:
            disp["prev"] = {"active": [x["name"] for x in d["outputs"] if x["active"]],
                            "current": next((x["name"] for x in d["outputs"] if x["current"]), None)}
        else:
            disp["timer"].cancel()
        show_on(name, display_mode["othersOff"])
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
    geri açılır: görüntü TV'deyken laptop ekranı kapalıdır, kablo çıkınca her yer karanlık kalmasın.
    sway soketi kaybolursa yeniden bağlanır (oturum restart'ına karşı dayanıklı)."""
    seen = drm_connected()
    fails = 0
    while True:
        time.sleep(2)
        now = drm_connected()
        try:
            if now - seen:
                go_home()
            if seen - now:
                outs = swaymsg("-t", "get_outputs")
                if outs is None:
                    fails += 1
                else:
                    fails = 0
                    for o in outs:
                        if o.get("name", "").startswith(INTERNAL) and not o.get("active"):
                            swaymsg("output", o["name"], "enable")
            if fails >= 3:
                # sway kaybolmuş olabilir; yeni soket gelene kadar kısa döngüyle bekle
                time.sleep(3)
                fails = 0
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
        # denirse Chrome yeni sürümden sonra da eski arayüzü kullanır. Bunun yerine içerik-tabanlı ETag.
        del self.headers["If-Modified-Since"]
        # ETag: VERSION + size + içerik crc32. mtime pakette 0 sabit olduğu için anahtara koyulmaz;
        # VERSION yeni sürümde değişince eski ETag'lar tümden geçersiz olur (sürüm çakışması önlenir).
        path = self.translate_path(self.path)
        if os.path.isfile(path):
            try:
                st = os.stat(path)
                h = 0
                try:
                    with open(path, "rb") as fh:
                        head = fh.read(16384)   # ilk 16KB içerik parmak izi
                    import zlib
                    h = zlib.crc32(head)
                except OSError:
                    pass
                etag = '"%s-%x-%x"' % (VERSION, st.st_size, h)
                if self.headers.get("If-None-Match") == etag:
                    self.send_response(304)
                    self.send_header("ETag", etag)
                    self.end_headers()
                    return None
                self.send_header("ETag", etag)
            except OSError:
                pass
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
            proxy_stats["count"] += 1
            try:
                tv_proxy(self, parsed.query)
            except Exception:
                proxy_stats["err"] += 1
                raise
            return True
        b = read_body(self) if method == "POST" else {}
        try:
            if method == "GET" and path == "/api/diag":
                res = diag_info()
            elif method == "POST" and path == "/api/log":
                # UI'den yerel log akışı: diske yazılır, dışarı gitmez. Opt-in Ayarlar > Gelişmiş'ten açılır.
                ui_log_write(b.get("events") or [])
                res = {"ok": True}
            elif method == "GET" and path == "/api/info":
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
            elif method == "POST" and path == "/api/update/rollback":
                res = update_rollback()
            elif method == "POST" and path == "/api/remote/wait":
                res = ui_wait(b.get("apps"))
            elif method == "POST" and path == "/api/mirror/signal":
                # Yerel /api/ sadece answerer (mirror.html) tarafı için
                res = mirror_signal(b, self.headers, from_local=True)
            elif method == "POST" and path == "/api/mirror/stop":
                mirror_reset()
                res = {"ok": True}
            elif method == "GET" and path == "/api/mirror/pending":
                res = mirror_pending()
            elif method == "POST" and path == "/api/mirror/approve":
                res = mirror_approve(b.get("accept") is True)
            elif method == "GET" and path == "/api/mirror/status":
                res = mirror_status()
            elif method == "GET" and path == "/api/sleep":
                res = sleep_get()
            elif method == "POST" and path == "/api/sleep":
                res = sleep_set(b.get("minutes", 0), str(b.get("action", "off")))
            elif method == "GET" and path == "/api/backup":
                res = backup_export()
            elif method == "POST" and path == "/api/backup":
                res = backup_import(b.get("data"))
            elif method == "GET" and path == "/api/notifications":
                res = notification_list(mark_seen=False)
            elif method == "POST" and path == "/api/notifications/seen":
                res = notification_list(mark_seen=True)
            elif method == "POST" and path == "/api/notifications/clear":
                res = notification_clear(b.get("id"))
            elif method == "POST" and path == "/api/display/mode":
                # others_off ayarı: beeOS'u taşırken diğer ekranları kapat ya da bırak
                v = b.get("othersOff")
                if isinstance(v, bool):
                    display_mode["othersOff"] = v
                res = {"ok": True, "othersOff": display_mode["othersOff"]}
            elif method == "POST" and path == "/api/time":
                s = str(b.get("time", "")).strip()
                if not re.fullmatch(r"\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?", s):
                    res = {"ok": False, "error": "Biçim: YYYY-MM-DD HH:MM"}
                else:
                    p = subprocess.run(["timedatectl", "set-time", s.replace("T", " ")],
                                       capture_output=True, text=True, timeout=5)
                    res = {"ok": p.returncode == 0, "error": p.stderr.strip() if p.returncode else ""}
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
        # Gövdeyi bir kez oku, hem JSON hem HMAC için kullan. İmzalanan: ham bytes.
        clen = 0
        try:
            clen = int(self.headers.get("Content-Length") or "0")
        except ValueError:
            pass
        raw = self.rfile.read(clen) if clen > 0 else b""
        try:
            b = json.loads(raw.decode("utf-8")) if raw else {}
        except (ValueError, UnicodeDecodeError):
            b = {}
        if not remote["enabled"]:
            send_json(self, {"ok": False, "error": "Telefon kumandası beeOS'ta kapalı"}, 403)
            return
        now = time.time()
        client_ip = self.client_address[0] if self.client_address else ""
        # Kimlik doğrulama: önce oturum imzası, başarısızsa PIN (yalnız /api/pair ve eski istemciler için).
        sid = None
        with lock:
            if fails["until"] > now:
                send_json(self, {"ok": False, "error": "Çok fazla hatalı PIN. Birkaç dakika bekle."}, 429)
                return
            # IP başına ayrı kilit: dağıtılmış brute-force'u da engeller
            ip_left = _ip_check(client_ip)
            if ip_left > 0:
                send_json(self, {"ok": False, "error": "Bu cihazdan çok hatalı deneme. %d sn sonra tekrar dene." % ip_left}, 429)
                return
            sid = session_check(self.headers, "POST", path, raw)
            if sid is None:
                # Session yok ya da geçersiz → PIN kabul et. Yanlışsa kademeli backoff.
                if not hmac.compare_digest(self.headers.get("X-BeeOS-PIN", ""), remote["pin"]):
                    fails["n"] += 1
                    _ip_record_fail(client_ip)
                    if fails["n"] >= 10:
                        fails["rounds"] = fails.get("rounds", 0) + 1
                        lock_sec = 300 if fails["rounds"] == 1 else 900 if fails["rounds"] == 2 else 3600
                        fails["n"], fails["until"] = 0, now + lock_sec
                    send_json(self, {"ok": False, "error": "PIN yanlış"}, 401)
                    return
            fails["n"] = 0
            fails["rounds"] = 0
            _ip_record_ok(client_ip)
        try:
            if path == "/api/pair":
                # PIN ile geldiyse yeni oturum döndür; session ile geldiyse sadece seq artır (yoklama).
                if sid is None:
                    new_sid, secret = session_create(str(b.get("name", "")))
                    remote["seq"] += 1
                    notify("Kumanda eşleşti", str(b.get("name", ""))[:48] or "Telefon", "success")
                    res = {"ok": True, "session": new_sid, "secret": secret.hex()}
                else:
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
            elif path == "/api/cursor":
                # Hassas: /dev/uinput erişimi; mutlaka oturum gerekir, sadece PIN yetmez
                if sid is None:
                    send_json(self, {"ok": False, "error": "Önce kumandayı eşle (PIN)."}, 401)
                    return
                res = remote_cursor(b)
            elif path == "/api/mirror/start":
                if sid is None:
                    send_json(self, {"ok": False, "error": "Önce kumandayı eşle (PIN)."}, 401)
                    return
                dev = sessions.get(sid, {}).get("name") or "Telefon"
                res = mirror_start(b, device=dev)
            elif path == "/api/mirror/signal":
                res = mirror_signal(b, self.headers, from_local=False)
            elif path == "/api/mirror/stop":
                mirror_reset()
                res = {"ok": True}
            else:
                send_json(self, {"ok": False, "error": "not found"}, 404)
                return
        except Exception as e:
            log("remote error", path, repr(e))
            res = {"ok": False, "error": "İşlem yapılamadı"}
        send_json(self, res)


def _cleanup_half_updates():
    """Güç kesilmesi yarım .beeos-new dosyaları bırakabilir (overlay staging). Açılışta temizle."""
    roots = ["/etc/systemd", "/etc/opt", "/etc/beeos", "/etc/opt/chrome", "/usr/share/plymouth", BEEOS_DIR]
    n = 0
    for root in roots:
        if not os.path.isdir(root):
            continue
        for d, _, files in os.walk(root):
            for f in files:
                if f.endswith(".beeos-new") or f.endswith(".beeos-rollback"):
                    try:
                        os.remove(os.path.join(d, f))
                        n += 1
                    except OSError:
                        pass
    if n:
        log("açılış temizliği: %d yarım dosya silindi" % n)


def main():
    _cleanup_half_updates()
    remote_load()
    try:
        rsrv = http.server.ThreadingHTTPServer(("0.0.0.0", REMOTE_PORT), RemoteHandler)
        if remote_cert():
            import ssl
            ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            ctx.load_cert_chain(REMOTE_CERT, REMOTE_KEY)
            rsrv.socket = ctx.wrap_socket(rsrv.socket, server_side=True)
            log("kumanda HTTPS açık (self-signed)")
        else:
            log("UYARI: kumanda HTTP (sertifika üretilemedi); getDisplayMedia çalışmaz")
        threading.Thread(target=rsrv.serve_forever, daemon=True).start()
    except OSError as e:
        log("kumanda sunucusu açılamadı:", repr(e))
    threading.Thread(target=display_watch, daemon=True).start()
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    log("beeOS arka ucu", HOME_URL, "web:", WEB_ROOT, "kumanda portu:", REMOTE_PORT)
    srv.serve_forever()


if __name__ == "__main__":
    main()
