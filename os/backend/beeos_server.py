#!/usr/bin/env python3
"""beeOS PC arka ucu (flash disk sürümü).

- beeOS arayüzünü http://127.0.0.1:8080/ adresinden sunar.
- Uygulamaları (Netflix, YouTube TV...) Chrome'da ayrı sekmede açar, Home tuşunda beeOS'a döner.
  Chrome ile DevTools protokolü (127.0.0.1:9222) üzerinden konuşur.
- Wi-Fi (nmcli) ve güç (systemctl) işlemleri.

Sadece 127.0.0.1'i dinler. Açılan web sitelerinin bu adrese istek atmasını (CSRF) engellemek için
/api/ istekleri "X-BeeOS" başlığı ister; tarayıcı bu başlığı başka sitelerden ön kontrolsüz göndermez.
"""
import http.server
import json
import os
import subprocess
import sys
import threading
import urllib.parse
import urllib.request

PORT = 8080
WEB_ROOT = os.environ.get("BEEOS_WEB", "/opt/beeos/web")
HOME_URL = "http://127.0.0.1:%d/" % PORT
CDP = "http://127.0.0.1:9222"
VERSION = "0.4.0"
# YouTube'un TV arayüzü (youtube.com/tv) sadece TV tarayıcılarına açılır
TV_UA = ("Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.0) AppleWebKit/537.36 (KHTML, like Gecko) "
         "76.0.3809.146/6.0 TV Safari/537.36")

apps = {}            # beeOS kart kimliği -> Chrome sekme kimliği
ua_sessions = {}     # sekme kimliği -> açık websocket (UA değişikliği bağlantı açıkken geçerli)
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
    ws = ua_sessions.pop(tab_id, None)
    if ws:
        try:
            ws.close()
        except Exception:
            pass


def open_with_ua(url, ua):
    """Boş sekme açar, kimliğini (User-Agent) değiştirip adrese gider. Bağlantı açık kalmalı."""
    import websocket  # python3-websocket
    t = new_tab("about:blank")
    ws = websocket.create_connection(t["webSocketDebuggerUrl"], timeout=10, suppress_origin=True)
    ws.send(json.dumps({"id": 1, "method": "Network.enable"}))
    ws.send(json.dumps({"id": 2, "method": "Network.setUserAgentOverride", "params": {"userAgent": ua}}))
    ws.send(json.dumps({"id": 3, "method": "Page.navigate", "params": {"url": url}}))
    ws.settimeout(None)
    ua_sessions[t["id"]] = ws

    def drain():
        # Olayları okuyup at; sekme kapanınca bağlantı biter
        try:
            while ws.recv():
                pass
        except Exception:
            pass
        ua_sessions.pop(t["id"], None)

    threading.Thread(target=drain, daemon=True).start()
    return t


def launch(app_id, url, ua):
    if not url.startswith("https://"):
        return {"ok": False, "error": "Geçersiz adres"}
    with lock:
        live = {t["id"] for t in tabs()}
        tid = apps.get(app_id)
        if tid in live:
            activate(tid)
            return {"ok": True, "resumed": True}
        t = open_with_ua(url, TV_UA) if ua == "tv" else new_tab(url)
        apps[app_id] = t["id"]
        activate(t["id"])
        return {"ok": True}


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


# ---------- güç ----------
def power(action):
    cmd = {"off": "poweroff", "reboot": "reboot"}.get(action)
    if not cmd:
        return {"ok": False, "error": "Geçersiz işlem"}
    # Cevap gönderildikten sonra kapat
    threading.Timer(1.0, lambda: subprocess.run(["systemctl", cmd])).start()
    return {"ok": True}


# ---------- HTTP ----------
class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=WEB_ROOT, **kw)

    def log_message(self, fmt, *args):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def send_json(self, obj, code=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def api_allowed(self):
        host_ok = self.headers.get("Host") in ("127.0.0.1:%d" % PORT, "localhost:%d" % PORT)
        origin = self.headers.get("Origin")
        origin_ok = origin is None or origin in ("http://127.0.0.1:%d" % PORT, "http://localhost:%d" % PORT)
        return host_ok and origin_ok and self.headers.get("X-BeeOS") == "1"

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if not n:
            return {}
        try:
            return json.loads(self.rfile.read(min(n, 65536)).decode("utf-8"))
        except ValueError:
            return {}

    def route(self, method):
        path = urllib.parse.urlparse(self.path).path
        if not path.startswith("/api/"):
            return False
        if not self.api_allowed():
            self.send_json({"ok": False, "error": "forbidden"}, 403)
            return True
        b = self.body() if method == "POST" else {}
        try:
            if method == "GET" and path == "/api/info":
                res = {"platform": "pc", "version": VERSION}
            elif method == "GET" and path == "/api/wifi":
                res = wifi_list()
            elif method == "POST" and path == "/api/wifi/connect":
                res = wifi_connect(str(b.get("ssid", "")), str(b.get("password", "")))
            elif method == "POST" and path == "/api/launch":
                res = launch(str(b.get("id", "")), str(b.get("url", "")), str(b.get("ua", "")))
            elif method == "POST" and path == "/api/home":
                res = go_home()
            elif method == "POST" and path == "/api/apps/close":
                res = close_apps()
            elif method == "POST" and path == "/api/power":
                res = power(str(b.get("action", "")))
            else:
                self.send_json({"ok": False, "error": "not found"}, 404)
                return True
        except Exception as e:  # Chrome henüz açılmamış olabilir vb.
            log("api error", path, repr(e))
            res = {"ok": False, "error": "İşlem yapılamadı"}
        self.send_json(res)
        return True

    def do_GET(self):
        if not self.route("GET"):
            super().do_GET()

    def do_POST(self):
        if not self.route("POST"):
            self.send_error(405)


def main():
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    log("beeOS arka ucu", HOME_URL, "web:", WEB_ROOT)
    srv.serve_forever()


if __name__ == "__main__":
    main()
