#!/usr/bin/env python3
"""beeOS PC arka ucu (flash disk sürümü).

- beeOS arayüzünü http://127.0.0.1:8080/ adresinden sunar.
- Uygulamaları (Netflix, YouTube TV...) Chrome'da ayrı sekmede açar, Home tuşunda beeOS'a döner.
  Chrome ile DevTools protokolü (127.0.0.1:9222) üzerinden konuşur.
- Wi-Fi (nmcli) ve güç (systemctl) işlemleri, bağlantı durumu, ekran koruyucu fotoğrafları.
- Telefon kumandası: yerel ağda ayrı bir portta (8081) küçük bir sayfa; PIN ile korunur.

Arayüz sunucusu sadece 127.0.0.1'i dinler. Açılan web sitelerinin bu adrese istek atmasını (CSRF)
engellemek için /api/ istekleri "X-BeeOS" başlığı ister; tarayıcı bu başlığı başka sitelerden ön
kontrolsüz göndermez. Kumanda sunucusu her işlemde "X-BeeOS-PIN" başlığı ister.
"""
import glob
import hmac
import html
import http.server
import json
import mimetypes
import os
import re
import secrets
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request

PORT = 8080
WEB_ROOT = os.environ.get("BEEOS_WEB", "/opt/beeos/web")
HOME_URL = "http://127.0.0.1:%d/" % PORT
CDP = "http://127.0.0.1:9222"
VERSION = "0.4.0"
LOAD_WAIT = 10       # uygulama sayfasının yüklenmesi için en fazla beklenen süre (sn)
REMOTE_PORT = 8081
STATE_DIR = "/var/lib/beeos"
REMOTE_FILE = os.path.join(STATE_DIR, "remote.json")
BEE = "bee"
BEE_RUN = "/run/user/1000"
# Ekran koruyucu fotoğrafları: BEEOS-LOG bölümü Windows'ta da açılır, fotoğraflar oraya kopyalanabilir
PHOTO_DIRS = ["/mnt/beeos-log/Fotograflar", "/home/bee/Resimler"]
PHOTO_EXT = (".jpg", ".jpeg", ".png", ".webp")
# YouTube'un TV arayüzü (youtube.com/tv) sadece TV tarayıcılarına açılır
TV_UA = ("Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.0) AppleWebKit/537.36 (KHTML, like Gecko) "
         "76.0.3809.146/6.0 TV Safari/537.36")

apps = {}            # beeOS kart kimliği -> Chrome sekme kimliği
sessions = {}        # sekme kimliği -> açık websocket (UA değişikliği bağlantı açıkken geçerli)
cancelled = set()    # açılırken Geri ile vazgeçilen uygulamalar: yüklenince öne getirilmez
lock = threading.Lock()


def log(*a):
    print(*a, file=sys.stderr, flush=True)


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


# ---------- telefon kumandası ----------
remote = {"enabled": True, "pin": "", "seq": 0}   # seq: başarılı eşleşme sayısı (beeOS'ta bildirim)
fails = {"n": 0, "until": 0.0}
WTYPE_KEYS = {"up": "Up", "down": "Down", "left": "Left", "right": "Right", "ok": "Return",
              "back": "Escape", "playpause": "XF86AudioPlay"}
VOLUME = {"volup": ["set-volume", "-l", "1.0", "@DEFAULT_AUDIO_SINK@", "5%+"],
          "voldown": ["set-volume", "@DEFAULT_AUDIO_SINK@", "5%-"],
          "mute": ["set-mute", "@DEFAULT_AUDIO_SINK@", "toggle"]}


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


def as_bee(cmd):
    """Komutu bee kullanıcısının ekran oturumunda çalıştırır (wtype: sanal klavye, wpctl: ses)."""
    socks = sorted(glob.glob(BEE_RUN + "/wayland-[0-9]"))
    env = ["env", "XDG_RUNTIME_DIR=" + BEE_RUN]
    if socks:
        env.append("WAYLAND_DISPLAY=" + os.path.basename(socks[0]))
    p = subprocess.run(["runuser", "-u", BEE, "--"] + env + cmd, capture_output=True, timeout=5)
    return {"ok": p.returncode == 0}


def remote_key(key):
    if key == "home":
        return go_home()
    if key in VOLUME:
        return as_bee(["wpctl"] + VOLUME[key])
    if key not in WTYPE_KEYS:
        return {"ok": False, "error": "Geçersiz tuş"}
    return as_bee(["wtype", "-k", WTYPE_KEYS[key]])


def remote_text(text):
    text = "".join(ch for ch in text if ch.isprintable())[:200]
    if not text:
        return {"ok": False, "error": "Boş yazı"}
    return as_bee(["wtype", "--", text])


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
        path = urllib.parse.urlparse(self.path).path
        if not path.startswith("/api/"):
            return False
        if not self.api_allowed():
            send_json(self, {"ok": False, "error": "forbidden"}, 403)
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
                res = remote_key(str(b.get("key", "")))
            elif path == "/api/text":
                res = remote_text(str(b.get("text", "")))
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
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    log("beeOS arka ucu", HOME_URL, "web:", WEB_ROOT, "kumanda portu:", REMOTE_PORT)
    srv.serve_forever()


if __name__ == "__main__":
    main()
