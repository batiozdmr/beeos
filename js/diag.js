// Tanı ekranı: ağ, disk, proxy, son log satırlarını özetler.
// Ayarlar > Sistem > Tanı altında açılır. Çıktı metin ve QR olarak gösterilir, telefonla okunur.
var Diag = (function () {
  function pct(n) { return Math.round(n * 100) + "%"; }

  // Arka uçtan /api/diag ister (sunucuda yoksa fallback: /api/info).
  function collect(cb) {
    var out = {
      t: new Date().toISOString(),
      version: (typeof window !== "undefined" && window.BEEOS_VERSION) ||
               (typeof Platform !== "undefined" && Platform.info && Platform.info().version) || "?",
      platform: (typeof Platform !== "undefined" && Platform.name && Platform.name()) || "?",
      lang: navigator.language || "",
      ua: navigator.userAgent || "",
      viewport: window.innerWidth + "x" + window.innerHeight,
      storage: (typeof QuotaGuard !== "undefined") ? QuotaGuard.report() : null,
      recent_log: (typeof Log !== "undefined") ? Log.tail(30) : []
    };
    if (typeof Platform === "undefined" || !Platform.api) { cb(out); return; }
    Platform.api("GET", "/api/diag", null, function (res) {
      if (res) { out.backend = res; }
      cb(out);
    });
  }

  // İnsan okur metin (Ayarlar panelinde)
  function format(info) {
    var lines = [
      "beeOS tanı   " + info.t,
      "sürüm: " + info.version + "   platform: " + info.platform,
      "ekran: " + info.viewport + "   dil: " + info.lang
    ];
    if (info.storage) { lines.push("yerel depo: " + info.storage.approxMB + " MB"); }
    if (info.backend) {
      var b = info.backend;
      if (b.net) { lines.push("ağ: " + (b.net.ssid || "kablolu") + " · " + (b.net.ip || "?")); }
      if (b.disk) {
        lines.push("disk /opt/beeos: " + pct(b.disk.beeos || 0) + " dolu");
        if (b.disk.log != null) { lines.push("disk BEEOS-LOG: " + pct(b.disk.log) + " dolu"); }
      }
      if (b.proxy) { lines.push("son proxy: " + b.proxy.count + " istek, " + b.proxy.err + " hata"); }
      if (b.update) { lines.push("güncelleme: " + b.update.state + "   kurulu: " + b.update.current); }
    }
    lines.push("--- son " + info.recent_log.length + " satır ---");
    for (var i = 0; i < info.recent_log.length; i++) { lines.push(info.recent_log[i]); }
    return lines.join("\n");
  }

  // QR için tüm metin fazla; sadece özet kısa URL / veri paketi
  function shortSummary(info) {
    var parts = [
      "v=" + info.version,
      "p=" + info.platform,
      "t=" + (info.t || "").slice(11, 19)
    ];
    if (info.backend && info.backend.net) {
      parts.push("ip=" + (info.backend.net.ip || "?"));
    }
    if (info.backend && info.backend.update) {
      parts.push("st=" + info.backend.update.state);
    }
    return "beeos-diag " + parts.join(" ");
  }

  return { collect: collect, format: format, shortSummary: shortSummary };
})();
