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

  // Profil: bazı alanlar profil başına değişir (favoriler, gizli kartlar, sıra, kullanım geçmişi).
  // "default" + opsiyonel "cocuk" vs. localStorage içinde ayrı yapıda tutulur.
  var PROF_KEYS = ["favorites", "hidden", "order", "usage", "lastOpen"];
  var PROFILES = "beeos.profiles.v1", ACTIVE = "beeos.activeProfile.v1";

  function loadProfiles() {
    try { return JSON.parse(localStorage.getItem(PROFILES) || "{}") || {}; }
    catch (e) { return {}; }
  }
  function saveProfiles(p) { try { localStorage.setItem(PROFILES, JSON.stringify(p)); } catch (e) {} }
  function activeName() {
    try { return localStorage.getItem(ACTIVE) || "default"; } catch (e) { return "default"; }
  }
  function setActive(n) { try { localStorage.setItem(ACTIVE, n); } catch (e) {} }

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
    // Profil slice'ını aktive edilmiş profilden oku (varsa) — favoriler vs. profil başına
    var name = activeName();
    var profs = loadProfiles();
    var p = profs[name];
    if (p) {
      for (var i = 0; i < PROF_KEYS.length; i++) {
        var pk = PROF_KEYS[i];
        if (p.hasOwnProperty(pk)) { s[pk] = p[pk]; }
      }
    }
    s.profile = name;
    s.profileList = Object.keys(profs).length ? Object.keys(profs) : ["default"];
    return s;
  }

  function save(s) {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
    // Profil slice'ını da güncelle
    var name = s.profile || activeName();
    var profs = loadProfiles();
    var slice = profs[name] || {};
    for (var i = 0; i < PROF_KEYS.length; i++) {
      var pk = PROF_KEYS[i];
      if (s[pk] != null) { slice[pk] = s[pk]; }
    }
    profs[name] = slice;
    saveProfiles(profs);
  }

  function reset() {
    try { localStorage.removeItem(KEY); } catch (e) {}
    return clone(DEFAULTS);
  }

  function listProfiles() { return Object.keys(loadProfiles()); }

  // Profil adı ekranda görünen ad: Türkçe harfler serbest; kontrol karakterleri ve baş/son boşluk atılır.
  function cleanName(n) {
    return String(n || "").replace(/[\u0000-\u001f\u007f]/g, "").replace(/^\s+|\s+$/g, "").slice(0, 20);
  }

  function switchProfile(name) {
    name = cleanName(name) || "default";
    setActive(name);
    return load();
  }

  function createProfile(name) {
    name = cleanName(name);
    if (!name || name === "default" || name.toLowerCase() === "varsayılan") { return null; }
    var profs = loadProfiles();
    if (!profs[name]) { profs[name] = { favorites: [], hidden: [], order: {}, usage: {}, lastOpen: {} }; saveProfiles(profs); }
    return name;
  }

  // Yedekleme: tüm arayüz durumu (ayarlar + profiller + aktif profil) tek nesne
  function exportAll() {
    var o = { v: 1 };
    try {
      o.settings = JSON.parse(localStorage.getItem(KEY) || "{}");
      o.profiles = loadProfiles();
      o.active = activeName();
    } catch (e) {}
    return o;
  }

  function importAll(o) {
    if (!o || typeof o !== "object" || typeof o.settings !== "object") { return false; }
    try {
      localStorage.setItem(KEY, JSON.stringify(o.settings));
      if (o.profiles && typeof o.profiles === "object") { saveProfiles(o.profiles); }
      if (o.active) { setActive(cleanName(o.active) || "default"); }
      return true;
    } catch (e) { return false; }
  }

  function deleteProfile(name) {
    if (!name || name === "default") { return false; }
    var profs = loadProfiles();
    delete profs[name];
    saveProfiles(profs);
    if (activeName() === name) { setActive("default"); }
    return true;
  }

  return { load: load, save: save, reset: reset,
           list: listProfiles, use: switchProfile, create: createProfile, remove: deleteProfile,
           exportAll: exportAll, importAll: importAll };
})();
