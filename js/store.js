// Ayarların kalıcı saklanması (localStorage). Erişilemezse varsayılanlarla çalışır.
var Store = (function () {
  var KEY = "beeos.settings.v1";
  var DEFAULTS = {
    userName: "",
    clock24: true,
    ambient: true,       // arka plan ışığı
    animations: true,    // kapalıysa tüm geçişler kapanır (zayıf TV'ler için)
    heroDesc: true,      // üst alandaki açıklama metni
    sort: "manual",      // "manual" | "usage" (sadece ilk raf)
    saverMin: 10,        // ekran koruyucu dakikası, 0 = kapalı
    saverStyle: "clock", // "clock" | "hive" | "flow" | "photos" (sadece PC)
    allApps: true,       // "Tüm Uygulamalar" rafı
    sounds: true,        // arayüz ses efektleri
    volume: 0.5,         // efekt ses düzeyi (0.25 - 1)
    boot: true,          // açılış animasyonu
    textSize: "normal",  // "normal" | "large"
    contrast: false,     // yüksek kontrast
    hints: "auto",       // tuş ipuçları: "auto" (ilk açılışlarda) | "on" | "off"
    hintRuns: 0,         // kaç kez açıldı ("auto" ipuçları için)
    order: {},           // { rafBaşlığı: [id, id, ...] }
    hidden: [],          // gizlenen kart kimlikleri
    usage: {},           // { id: açılma sayısı }
    lastOpen: {},        // { id: son açılış zamanı (ms) }
    tvBuiltin: true,     // TV: yerleşik kanallar (js/channels.js)
    tvLists: [],         // TV: eklenen M3U listeleri [{ name, url }]
    tvFav: [],           // TV: favori kanalların yayın adresleri
    tvLast: "",          // TV: son izlenen kanalın yayın adresi
    favorites: [],       // Favori kartların kimlikleri (yeni) — en üstteki "Favoriler" rafı
    favShelf: true,      // "Favoriler" rafını göster
    recentShelf: true,   // "Son açılanlar" rafını göster
    recentMax: 7,        // "Son açılanlar"da gösterilecek en fazla kart
    epg: true,           // Yayın akışı (EPG): kanal listesinde ve OSD'de "şimdi / sırada"
    epgUrl: "",          // XMLTV adresi. Boşsa kapalı; dolu adres kanal listesinde "şimdi/sırada" bilgisini açar.
    subSize: "medium",   // Alt yazı boyu: "small" | "medium" | "large" | "xlarge"
    subBg: "shadow",     // Alt yazı arkaplanı: "none" | "shadow" | "box"
    telemetry: false,    // Opt-in: UI log hatalarını arka uca /api/log olarak yazsın mı
    onboarded: false,    // İlk açılış sihirbazı tamamlandı mı (Onboarding.start göster/atla)
    parentalPin: "",     // 4 haneli PIN (hash değil, basit düz metin — localStorage zaten korumalı)
    locked: []           // PIN ister olan kart kimlikleri
  };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function load() {
    var s = clone(DEFAULTS);
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var d = JSON.parse(raw);
        for (var k in DEFAULTS) {
          if (DEFAULTS.hasOwnProperty(k) && d.hasOwnProperty(k)) { s[k] = d[k]; }
        }
      }
    } catch (e) {}
    return s;
  }

  function save(s) {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
  }

  function reset() {
    try { localStorage.removeItem(KEY); } catch (e) {}
    return clone(DEFAULTS);
  }

  return { load: load, save: save, reset: reset };
})();
