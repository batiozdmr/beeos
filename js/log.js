// Yapılandırılmış log: her satır JSON, son 500 satır bellekte halka tamponda tutulur.
// "Tanı" ekranı Log.tail() ile son satırları QR kod / metin olarak dışa aktarır.
// Arka uca da gönderilebilir: POST /api/log (opt-in, Ayarlar > Gelişmiş > "Tanıyı gönder").
var Log = (function () {
  var RING_MAX = 500;
  var ring = [];
  var sendBatch = [];
  var sendTimer = null;

  function nowISO() {
    try { return new Date().toISOString(); } catch (e) { return ""; }
  }

  function push(level, area, msg, extra) {
    var rec = { t: nowISO(), lvl: level, area: area || "app", msg: String(msg || "") };
    if (extra && typeof extra === "object") {
      for (var k in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, k)) { rec[k] = extra[k]; }
      }
    }
    ring.push(rec);
    if (ring.length > RING_MAX) { ring.shift(); }
    // Konsola ayna (DevTools için). webOS TV'de console.log yine çalışır.
    if (typeof console !== "undefined" && console[level === "error" ? "error" : level === "warn" ? "warn" : "log"]) {
      console[level === "error" ? "error" : level === "warn" ? "warn" : "log"]("[" + area + "] " + msg);
    }
    if (level === "error" || level === "warn") { queueSend(rec); }
  }

  // Opt-in gönderim: settings.telemetry açıksa arka uca /api/log'a 5 sn'de bir topla gönder.
  function telemetryOn() {
    try {
      var raw = localStorage.getItem("beeos.settings.v1");
      var s = raw ? JSON.parse(raw) : {};
      return !!(s && s.telemetry);
    } catch (e) { return false; }
  }

  function queueSend(rec) {
    if (!telemetryOn()) { return; }
    sendBatch.push(rec);
    if (sendTimer) { return; }
    sendTimer = setTimeout(flush, 5000);
  }

  function flush() {
    sendTimer = null;
    if (!sendBatch.length) { return; }
    var payload = sendBatch.splice(0);
    try {
      if (typeof Platform !== "undefined" && Platform.api) {
        Platform.api("POST", "/api/log", { events: payload }, function () {});
      }
    } catch (e) {}
  }

  return {
    debug: function (area, msg, extra) { push("debug", area, msg, extra); },
    info:  function (area, msg, extra) { push("info",  area, msg, extra); },
    warn:  function (area, msg, extra) { push("warn",  area, msg, extra); },
    error: function (area, msg, extra) { push("error", area, msg, extra); },
    tail: function (n) {
      n = n || 50;
      return ring.slice(-n).map(function (r) { return JSON.stringify(r); });
    },
    tailText: function (n) { return this.tail(n).join("\n"); }
  };
})();

// Yakalanmamış hatalar da log'a düşer.
window.addEventListener("error", function (e) {
  Log.error("window", e.message || "error", { src: e.filename, line: e.lineno, col: e.colno });
});
window.addEventListener("unhandledrejection", function (e) {
  Log.error("promise", (e.reason && e.reason.message) || String(e.reason || "rejected"));
});
