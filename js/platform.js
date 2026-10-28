// Çalışılan ortam: "tv" (LG webOS), "pc" (beeOS flash disk, os/ klasöründeki arka uç) veya
// "web" (tarayıcıda test). Tarayıcıda ?pc ile PC modu sahte cevaplarla denenebilir.
var Platform = (function () {
  var name = typeof PalmServiceBridge !== "undefined" ? "tv" : "web";
  var mock = name === "web" && /[?&]pc\b/.test(location.search);
  var info = {};

  // Arka uç çağrısı. cb(cevap) ya da hata olursa cb(null).
  function api(method, path, body, cb) {
    cb = cb || function () {};
    if (mock) { setTimeout(function () { cb(Mock.answer(method, path, body)); }, 350); return; }
    var x = new XMLHttpRequest();
    var done = false;
    function end(res) { if (!done) { done = true; cb(res); } }
    x.open(method, path, true);
    // Wi-Fi taraması, Bluetooth eşleştirme ve uygulama açılışı (sayfa yüklenene kadar bekler) uzun sürebilir
    x.timeout = path.indexOf("/api/wifi") === 0 ? 30000 : path.indexOf("/api/bt/") === 0 ? 45000 :
                path === "/api/launch" || path === "/api/remote/wait" || path === "/api/update/check" ? 30000 : 8000;
    x.onreadystatechange = function () {
      if (x.readyState !== 4) { return; }
      var res = null;
      try { res = JSON.parse(x.responseText); } catch (e) {}
      end(x.status === 200 ? res : (res && res.error ? res : null));
    };
    x.ontimeout = function () { end(null); };
    x.onerror = function () { end(null); };
    x.setRequestHeader("X-BeeOS", "1");   // arka uç bu başlık olmadan /api isteklerini reddeder
    if (body) { x.setRequestHeader("Content-Type", "application/json"); }
    x.send(body ? JSON.stringify(body) : null);
  }

  // Ortamı belirler, sonra cb() çağırır. TV'de hemen döner.
  function detect(cb) {
    if (name === "tv") { cb(); return; }
    if (mock) { name = "pc"; info = { platform: "pc", mock: true, version: Mock.upd.current }; cb(); return; }
    api("GET", "/api/info", null, function (res) {
      if (res && res.platform === "pc") { name = "pc"; info = res; }
      cb();
    });
  }

  // Tarayıcı testi için sahte PC arka ucu
  var Mock = {
    current: "Ev-WiFi",
    remote: { ok: true, enabled: true, pin: "482913", urls: ["http://192.168.1.42:8081"] },
    bt: { ok: true, powered: true, devices: [
      { mac: "AA:BB:CC:00:00:01", name: "Kulaklık", paired: true, connected: true },
      { mac: "AA:BB:CC:00:00:02", name: "Oyun kolu", paired: true, connected: false }] },
    bluetooth: function (path, body) {
      var bt = this.bt, d = null;
      for (var i = 0; i < bt.devices.length; i++) { if (body && bt.devices[i].mac === body.mac) { d = bt.devices[i]; } }
      if (path === "/api/bt/power") { bt.powered = body.on; }
      if (path === "/api/bt/scan" && bt.devices.length < 3) {
        bt.devices.push({ mac: "AA:BB:CC:00:00:03", name: "Salon hoparlörü", paired: false, connected: false });
      }
      if (path === "/api/bt/connect" && d) { d.paired = true; d.connected = true; }
      if (path === "/api/bt/disconnect" && d) { d.connected = false; }
      if (path === "/api/bt/remove" && d) { bt.devices.splice(bt.devices.indexOf(d), 1); }
      return bt;
    },
    // TV / ekran: ?pc&tv ile HDMI takılı bir TV gibi davranır
    disp: { current: "eDP-1", prev: "", until: 0 },
    display: function (path, body) {
      var d = this.disp;
      if (path === "/api/display/use") { d.prev = d.current; d.current = body.name; d.until = Date.now() + 15000; }
      if (path === "/api/display/keep") { d.until = 0; }
      if (path === "/api/display/revert" && d.until) { d.current = d.prev; d.until = 0; }
      if (d.until && Date.now() > d.until + 3000) { d.current = d.prev; d.until = 0; }
      var outs = [{ name: "eDP-1", label: "Laptop ekranı", port: "Dahili", internal: true, active: true }];
      if (/[?&]tv\b/.test(location.search)) {
        outs.unshift({ name: "HDMI-A-1", label: "LG TV SSCR2", port: "HDMI 1", internal: false, active: true });
      }
      outs.forEach(function (o) { o.current = o.name === d.current; });
      var res = { ok: true, outputs: outs };
      if (d.until) { res.confirm = { name: d.current, left: Math.max(0, Math.round((d.until - Date.now()) / 1000)) }; }
      return res;
    },
    // Güncelleme: ?pc ile 0.5.0 bulunur ve kurulur; ?pc&updfail ile indirme doğrulamada hata verir
    upd: { ok: true, current: "0.4.0", state: "idle", progress: 0, error: "" },
    update: function (path) {
      var u = this.upd;
      if (path === "/api/update/check") {
        u.latest = "0.5.0"; u.available = u.current !== u.latest; u.size = 3355443;
        u.notes = "Arayüzden güncelleme, VirtualBox test ortamı ve hata düzeltmeleri.";
      }
      if (path === "/api/update/install" && u.available) { u.state = "download"; u.progress = 0; u.error = ""; }
      if (path === "/api/update" && u.state === "download") {
        u.progress = Math.min(100, u.progress + 20);
        if (u.progress >= 60 && /[?&]updfail\b/.test(location.search)) {
          u.state = "error"; u.error = "Paket doğrulanamadı (sağlama toplamı tutmuyor)";
        } else if (u.progress >= 100) { u.state = "install"; }
      } else if (path === "/api/update" && u.state === "install") { u.state = "restart"; }
      else if (path === "/api/update" && u.state === "restart") {
        u.current = u.latest; u.available = false; u.state = "idle";
      }
      return JSON.parse(JSON.stringify(u));
    },
    answer: function (method, path, body) {
      if (path.indexOf("/api/update") === 0) { return this.update(path); }
      if (path === "/api/apps/open") {
        return { ok: true, apps: { "youtube.leanback.v4": "Lofi hip hop radio - beats to relax/study to - YouTube" } };
      }
      if (path === "/api/status") { return { ok: true, online: true, name: this.current, remoteSeq: 0 }; }
      if (path === "/api/remote") {
        if (body && body.newPin) { this.remote.pin = String(100000 + Math.floor(Math.random() * 900000)); }
        if (body && typeof body.enabled === "boolean") { this.remote.enabled = body.enabled; }
        return this.remote;
      }
      if (path === "/api/photos") { return { ok: true, photos: [] }; }
      if (path.indexOf("/api/display") === 0) { return this.display(path, body); }
      if (path.indexOf("/api/bt") === 0) { return this.bluetooth(path, body); }
      if (path === "/api/wifi") {
        return { enabled: true, current: this.current, networks: [
          { ssid: "Ev-WiFi", signal: 82, secure: true, known: true },
          { ssid: "Komsu_5G", signal: 54, secure: true, known: false },
          { ssid: "Kafe Misafir", signal: 31, secure: false, known: false }] };
      }
      if (path === "/api/wifi/connect") {
        if (body.password === "yanlis") { return { ok: false, error: "Şifre yanlış" }; }
        this.current = body.ssid;
        return { ok: true };
      }
      return { ok: true };
    }
  };

  return {
    name: function () { return name; },
    info: function () { return info; },
    mock: function () { return mock; },
    detect: detect,
    api: api
  };
})();
