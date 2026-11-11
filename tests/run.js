#!/usr/bin/env node
// Minimal test runner (tek dosya, bağımlılıksız). CI'de "node tests/run.js" ile çağrılır.
// Kapsadıkları: Store varsayılanları + kalıcılık; TV.parseM3U / hostOf; EPG.parseTime + getNowNext.
// Tarayıcıya özgü (DOM) kod bu dosyada denetlenmez — onlar için VM/browser testi gerekir.

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var vm = require("vm");

var passed = 0, failed = 0, currentSection = "";

function section(t) { currentSection = t; console.log("\n" + t); }

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("  ok    " + name);
  } catch (e) {
    failed++;
    console.log("  FAIL  " + name);
    var msg = (e && e.message) ? e.message : String(e);
    console.log("        " + msg.split("\n").join("\n        "));
  }
}

// Store'u sanal bir localStorage ile çalıştır. load()'un döndürdüğü nesne başka bir realm'den
// geldiği için yerel tiplere (Array vb.) JSON-roundtrip ile çeviririz, böylece deepStrictEqual çalışır.
function loadStore() {
  var src = fs.readFileSync(path.join(__dirname, "..", "js", "store.js"), "utf8");
  var storage = {};
  var sandbox = {
    localStorage: {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null; },
      setItem: function (k, v) { storage[k] = String(v); },
      removeItem: function (k) { delete storage[k]; }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  function wrap(o) { return JSON.parse(JSON.stringify(o)); }
  return {
    load: function () { return wrap(sandbox.Store.load()); },
    save: function (s) { sandbox.Store.save(s); },
    reset: function () { return wrap(sandbox.Store.reset()); },
    storage: storage
  };
}

// TV.js'i sanal bir bağlamda değerlendirip saf yardımcılarını al
function loadTv() {
  var src = fs.readFileSync(path.join(__dirname, "..", "js", "tv.js"), "utf8");
  var sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox.TV;
}

// ---------- store.js ----------
section("store.js");

test("defaults include favorites, favShelf, recentShelf, epg", function () {
  var e = loadStore();
  var s = e.load();
  assert.deepStrictEqual(s.favorites, []);
  assert.strictEqual(s.favShelf, true);
  assert.strictEqual(s.recentShelf, true);
  assert.strictEqual(s.recentMax, 7);
  assert.strictEqual(s.epg, true);
  assert.strictEqual(s.epgUrl, "");
});

test("save + load round-trips modified settings", function () {
  var e = loadStore();
  var s = e.load();
  s.favorites = ["youtube.leanback.v4", "netflix"];
  s.volume = 0.75;
  s.epgUrl = "https://example.org/epg.xml";
  e.save(s);
  var s2 = e.load();
  assert.deepStrictEqual(s2.favorites, ["youtube.leanback.v4", "netflix"]);
  assert.strictEqual(s2.volume, 0.75);
  assert.strictEqual(s2.epgUrl, "https://example.org/epg.xml");
});

test("unknown keys in stored json are ignored", function () {
  var e = loadStore();
  e.storage["beeos.settings.v1"] = JSON.stringify({ favorites: ["a"], __evil: true, totallyMade: 42 });
  var s = e.load();
  assert.deepStrictEqual(s.favorites, ["a"]);
  assert.strictEqual(s.__evil, undefined);
  assert.strictEqual(s.totallyMade, undefined);
});

test("corrupt json falls back to defaults", function () {
  var e = loadStore();
  e.storage["beeos.settings.v1"] = "{not json";
  var s = e.load();
  assert.deepStrictEqual(s.favorites, []);
  assert.strictEqual(s.volume, 0.5);
});

test("reset clears storage and returns defaults", function () {
  var e = loadStore();
  var s = e.load();
  s.favorites = ["foo"];
  e.save(s);
  var fresh = e.reset();
  assert.deepStrictEqual(fresh.favorites, []);
  assert.strictEqual(e.storage["beeos.settings.v1"], undefined);
});

// ---------- tv.js (saf yardımcılar) ----------
section("tv.js");
var TV = loadTv();

test("hostOf strips scheme and www", function () {
  assert.strictEqual(TV.hostOf("https://www.example.com/path"), "example.com");
  assert.strictEqual(TV.hostOf("http://sub.example.co:8080/x"), "sub.example.co");
  assert.strictEqual(TV.hostOf("https://cdn.test.org/"), "cdn.test.org");
});

test("parseM3U: single bare .m3u8 (no #EXTINF)", function () {
  var text = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2000000\nhttps://cdn.example/live.m3u8";
  var out = TV.parse(text, "https://cdn.example/live.m3u8");
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].url, "https://cdn.example/live.m3u8");
  assert.strictEqual(out[0].group, "Listem");
});

test("parseM3U: extracts name, group, tvg-id, tvg-logo", function () {
  var m3u = [
    "#EXTM3U",
    '#EXTINF:-1 tvg-id="K1.tr" tvg-logo="https://logo/a.png" group-title="Ulusal",Kanal 1',
    "https://cdn/k1.m3u8",
    '#EXTINF:-1 group-title="Haber",Kanal 2',
    "/live/k2.m3u8",
    '#EXTINF:-1,Kanal 3',
    "k3.m3u8"
  ].join("\n");
  var out = TV.parse(m3u, "https://host/path/playlist.m3u");
  assert.strictEqual(out.length, 3);
  assert.strictEqual(out[0].name, "Kanal 1");
  assert.strictEqual(out[0].group, "Ulusal");
  assert.strictEqual(out[0].tvgId, "K1.tr");
  assert.strictEqual(out[0].logo, "https://logo/a.png");
  assert.strictEqual(out[1].url, "https://host/live/k2.m3u8", "mutlak-yol çözüldü");
  assert.strictEqual(out[1].tvgId, "");
  assert.strictEqual(out[2].url, "https://host/path/k3.m3u8", "göreli yol çözüldü");
  assert.strictEqual(out[2].group, "Diğer", "grup yoksa varsayılan 'Diğer'");
});

test("parseM3U: EXTGRP overrides empty group-title", function () {
  var m3u = [
    "#EXTM3U",
    "#EXTINF:-1,Yalnız",
    "#EXTGRP:Spor",
    "https://cdn/x.m3u8"
  ].join("\n");
  var out = TV.parse(m3u, "https://cdn/x.m3u8");
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].group, "Spor");
});

// ---------- epg.js ----------
section("epg.js");
var EPG = require(path.join(__dirname, "..", "js", "epg.js"));

test("parseTime: XMLTV with +0300 timezone", function () {
  var t = EPG.parseTime("20261109150000 +0300");
  assert.strictEqual(t, Date.UTC(2026, 10, 9, 12, 0, 0));
});

test("parseTime: without timezone falls back to UTC", function () {
  var t = EPG.parseTime("20261109150000");
  assert.strictEqual(t, Date.UTC(2026, 10, 9, 15, 0, 0));
});

test("parseTime: handles negative offset", function () {
  var t = EPG.parseTime("20261109120000 -0500");
  assert.strictEqual(t, Date.UTC(2026, 10, 9, 17, 0, 0));
});

test("parseTime: bad input returns 0", function () {
  assert.strictEqual(EPG.parseTime(""), 0);
  assert.strictEqual(EPG.parseTime("not a date"), 0);
  assert.strictEqual(EPG.parseTime(null), 0);
});

test("getNowNext: finds current and next programme", function () {
  EPG.reset();
  var day = Date.UTC(2026, 10, 9, 10, 0, 0);
  EPG._loadForTest({
    "A.tr": [
      { start: day,               stop: day + 3600000, title: "Prog A", desc: "" },
      { start: day + 3600000,     stop: day + 7200000, title: "Prog B", desc: "" },
      { start: day + 7200000,     stop: day + 10800000, title: "Prog C", desc: "" }
    ]
  });
  var nn = EPG.getNowNext("A.tr", day + 1800000);
  assert.ok(nn);
  assert.strictEqual(nn.now.title, "Prog A");
  assert.strictEqual(nn.next.title, "Prog B");
});

test("getNowNext: between programmes returns next only", function () {
  EPG.reset();
  var day = Date.UTC(2026, 10, 9, 10, 0, 0);
  EPG._loadForTest({
    "A.tr": [
      { start: day, stop: day + 1000, title: "Past", desc: "" },
      { start: day + 5000, stop: day + 6000, title: "Future", desc: "" }
    ]
  });
  var nn = EPG.getNowNext("A.tr", day + 2000);
  assert.ok(nn);
  assert.strictEqual(nn.now, null);
  assert.strictEqual(nn.next.title, "Future");
});

test("getNowNext: unknown channel id returns null", function () {
  EPG.reset();
  EPG._loadForTest({ "A.tr": [{ start: 1, stop: 2, title: "X", desc: "" }] });
  assert.strictEqual(EPG.getNowNext("Unknown.tr", 1), null);
});

test("getNowNext: when nothing is loaded returns null", function () {
  EPG.reset();
  assert.strictEqual(EPG.getNowNext("A.tr", Date.now()), null);
});

// ---------- quota.js ----------
section("quota.js");

function loadModule(file, extraSandbox) {
  var src = fs.readFileSync(path.join(__dirname, "..", "js", file), "utf8");
  var storage = (extraSandbox && extraSandbox.storage) || {};
  var sandbox = Object.assign({
    localStorage: {
      length: 0,
      key: function (i) { return Object.keys(storage)[i] || null; },
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null; },
      setItem: function (k, v) { storage[k] = String(v); this.length = Object.keys(storage).length; },
      removeItem: function (k) { delete storage[k]; this.length = Object.keys(storage).length; }
    },
    window: { addEventListener: function () {} },
    document: { createElement: function () { return { setAttribute: function () {}, style: {}, textContent: "" }; },
                body: { appendChild: function () {} }, addEventListener: function () {} },
    console: console,
    setTimeout: setTimeout
  }, extraSandbox || {});
  sandbox.localStorage.length = Object.keys(storage).length;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  sandbox.storage = storage;
  return sandbox;
}

test("makeRoom trims oldest recent when quota is tight", function () {
  var storage = {};
  var long = [];
  for (var i = 0; i < 50; i++) { long.push({ id: "app" + i, t: i }); }
  storage["beeos:recent"] = JSON.stringify(long);
  var m = loadModule("quota.js", { storage: storage });
  var ok = m.QuotaGuard.makeRoom("recent");
  assert.strictEqual(ok, true);
  var left = JSON.parse(storage["beeos:recent"]);
  assert.ok(left.length < 50, "recent trimmed");
});

test("makeRoom returns false when nothing to trim", function () {
  var m = loadModule("quota.js", { storage: {} });
  assert.strictEqual(m.QuotaGuard.makeRoom("recent"), false);
});

test("report sums key+value bytes", function () {
  var storage = { "beeos:foo": "bar" };
  var m = loadModule("quota.js", { storage: storage });
  var r = m.QuotaGuard.report();
  assert.strictEqual(r.bytes, "beeos:foo".length + "bar".length);
});

// ---------- search_suggest.js ----------
section("search_suggest.js");

test("record + suggest returns prefix matches, freq-weighted", function () {
  var m = loadModule("search_suggest.js", { storage: {} });
  m.SearchSuggest.record("netflix");
  m.SearchSuggest.record("netflix");
  m.SearchSuggest.record("youtube");
  m.SearchSuggest.record("netflix diaries");
  var hits = m.SearchSuggest.suggest("net", 5);
  assert.ok(hits.indexOf("netflix") === 0, "netflix first (freq=2)");
  assert.ok(hits.indexOf("netflix diaries") >= 0);
  assert.strictEqual(hits.indexOf("youtube"), -1);
});

test("suggest with empty prefix returns recent history", function () {
  var m = loadModule("search_suggest.js", { storage: {} });
  m.SearchSuggest.record("a");
  m.SearchSuggest.record("b");
  var hits = m.SearchSuggest.suggest("", 5);
  assert.ok(hits.length === 2);
});

test("prefix match is case + locale insensitive (Turkish İ)", function () {
  var m = loadModule("search_suggest.js", { storage: {} });
  m.SearchSuggest.record("İstanbul");
  var hits = m.SearchSuggest.suggest("ist", 5);
  // hits sandbox'tan geldiği için JSON-roundtrip ile yerel diziye çevir (loadStore'daki wrap mantığı).
  assert.deepStrictEqual(JSON.parse(JSON.stringify(hits)), ["İstanbul"]);
});

// ---------- wifi_errors.js ----------
section("wifi_errors.js");

test("recognizes wrong-password stderr", function () {
  var m = loadModule("wifi_errors.js", {});
  var e = m.WifiErrors.explain("secrets were required, but none provided", 4);
  assert.strictEqual(e.baslik, "Şifre yanlış");
});

test("recognizes dhcp failure", function () {
  var m = loadModule("wifi_errors.js", {});
  var e = m.WifiErrors.explain("connection activation failed: dhcp failed", 10);
  assert.strictEqual(e.baslik, "IP adresi alınamadı");
});

test("unknown stderr with non-zero code gives generic Wi-Fi error", function () {
  var m = loadModule("wifi_errors.js", {});
  var e = m.WifiErrors.explain("something weird", 7);
  assert.strictEqual(e.baslik, "Wi-Fi bağlanamadı");
});

test("empty stderr with code 0 gives soft message", function () {
  var m = loadModule("wifi_errors.js", {});
  var e = m.WifiErrors.explain("", 0);
  assert.strictEqual(e.baslik, "Bağlantı tamamlanamadı");
});

// ---------- log.js ----------
section("log.js");

test("ring buffer keeps last entries, tail returns them as JSON lines", function () {
  var m = loadModule("log.js", { storage: {} });
  m.Log.info("ui", "one");
  m.Log.warn("ui", "two");
  m.Log.error("ui", "three");
  var tail = m.Log.tail(5);
  assert.strictEqual(tail.length, 3);
  var last = JSON.parse(tail[2]);
  assert.strictEqual(last.lvl, "error");
  assert.strictEqual(last.msg, "three");
  assert.strictEqual(last.area, "ui");
});

test("extra fields are merged into log record", function () {
  var m = loadModule("log.js", { storage: {} });
  m.Log.info("tv", "channel change", { chan: "TRT 1" });
  var rec = JSON.parse(m.Log.tail(1)[0]);
  assert.strictEqual(rec.chan, "TRT 1");
});

// ---------- app.js saf yardımcılar (re-implement: DOM bağımlılığı atlatmak için) ----------
// Kaynak: js/app.js — availableHere, toggleFavorite, moveItem mantığının saf hâli. app.js'teki
// imza değişirse bu testler yakalamaz; ama regression kontrolü için temel senaryoları korur.
section("app.js (saf yardımcılar)");

function makeAvailableHere(platform) {
  return function (it) {
    var pc = platform === "pc";
    if (it.only && it.only !== (pc ? "pc" : "tv")) { return false; }
    return !pc || !!it.web || it.id.charAt(0) === "@";
  };
}

test("availableHere: PC'de web adresi olmayan TV uygulaması gizlenir", function () {
  var a = makeAvailableHere("pc");
  assert.strictEqual(a({ id: "com.webos.app.hdmi1", only: "tv" }), false);
  assert.strictEqual(a({ id: "netflix", web: "https://netflix.com" }), true);
  assert.strictEqual(a({ id: "@settings" }), true, "@-kartlar her ortamda");
});

test("availableHere: TV'de only:pc gizlenir", function () {
  var a = makeAvailableHere("tv");
  assert.strictEqual(a({ id: "beeos.geforcenow", only: "pc", web: "https://x" }), false);
  assert.strictEqual(a({ id: "netflix", web: "https://netflix.com" }), true);
  assert.strictEqual(a({ id: "com.webos.app.hdmi1", only: "tv" }), true);
});

test("toggleFavorite: id ekler/çıkarır", function () {
  var e = loadStore();
  var S = e.load();
  function toggle(id) {
    var at = S.favorites.indexOf(id);
    if (at >= 0) { S.favorites.splice(at, 1); }
    else { S.favorites.push(id); }
    e.save(S);
    S = e.load();
  }
  assert.deepStrictEqual(S.favorites, []);
  toggle("netflix");
  assert.deepStrictEqual(S.favorites, ["netflix"]);
  toggle("youtube");
  assert.deepStrictEqual(S.favorites, ["netflix", "youtube"]);
  toggle("netflix");
  assert.deepStrictEqual(S.favorites, ["youtube"]);
});

test("Favoriler rafı order: eklenme sırasını korur", function () {
  var e = loadStore();
  var S = e.load();
  S.favorites = ["a", "b", "c"];
  e.save(S);
  var s2 = e.load();
  assert.deepStrictEqual(s2.favorites, ["a", "b", "c"]);
});

function makeMoveItem(order) {
  // Verilen order dizisinde idx konumundaki öğeyi dir yönünde kaydırır; S.order'a yazılır.
  return function (idx, dir) {
    var to = idx + dir;
    if (to < 0 || to >= order.length) { return order.slice(); }
    var out = order.slice();
    var tmp = out[idx]; out[idx] = out[to]; out[to] = tmp;
    return out;
  };
}

test("moveItem: sağa kaydırma yer değiştirir", function () {
  var m = makeMoveItem(["a", "b", "c", "d"]);
  assert.deepStrictEqual(m(1, 1), ["a", "c", "b", "d"]);
});

test("moveItem: sola kaydırma yer değiştirir", function () {
  var m = makeMoveItem(["a", "b", "c", "d"]);
  assert.deepStrictEqual(m(2, -1), ["a", "c", "b", "d"]);
});

test("moveItem: sınır dışında kalan hareket değişiklik yapmaz", function () {
  var m = makeMoveItem(["a", "b"]);
  assert.deepStrictEqual(m(0, -1), ["a", "b"]);
  var n = makeMoveItem(["a", "b"]);
  assert.deepStrictEqual(n(1, 1), ["a", "b"]);
});

// ---------- computeModel / availableHere ek senaryolar (0.12) ----------

test("availableHere: only:tv + PC platformu → gizli", function () {
  var a = makeAvailableHere("pc");
  assert.strictEqual(a({ id: "com.webos.app.livetv", only: "tv" }), false);
});

test("availableHere: PC'de web yok + @-kart değil → gizli", function () {
  var a = makeAvailableHere("pc");
  assert.strictEqual(a({ id: "netflix" }), false, "web adresi olmayan normal kart PC'de gizli");
  assert.strictEqual(a({ id: "netflix", web: "" }), false, "boş web string de gizli");
});

test("availableHere: only yok + web var → her ortamda görünür", function () {
  var pc = makeAvailableHere("pc");
  var tv = makeAvailableHere("tv");
  var it = { id: "spotify", web: "https://open.spotify.com" };
  assert.strictEqual(pc(it), true);
  assert.strictEqual(tv(it), true);
});

test("availableHere: @-kartlar hem PC hem TV'de görünür (web olmasa da)", function () {
  var pc = makeAvailableHere("pc"), tv = makeAvailableHere("tv");
  assert.strictEqual(pc({ id: "@settings" }), true);
  assert.strictEqual(tv({ id: "@tv" }), true);
});

test("moveItem: aynı konuma hareket (dir=0) değişiklik yapmaz", function () {
  // dir=0 verildiğinde to=idx olur, swap aynı elemanı değiştirir (sonuç değişmez)
  var m = makeMoveItem(["a", "b", "c"]);
  assert.deepStrictEqual(m(1, 0), ["a", "b", "c"]);
});

test("moveItem: negatif başlangıç index güvenli", function () {
  // idx+dir = -1 + 1 = 0, geçerli ama swap garip davranış: slice ile orijinali korumalı
  var m = makeMoveItem(["a", "b"]);
  // idx=-1 pratik olarak kullanılmaz; sınır kontrolü sadece to < 0 veya to >= length
  var out = m(-1, -1);          // to = -2, dönüş orijinal kopyası
  assert.deepStrictEqual(out, ["a", "b"]);
});

// ---------- summary ----------
console.log("\n" + passed + " ok, " + failed + " failed");
if (failed > 0) { process.exit(1); }
