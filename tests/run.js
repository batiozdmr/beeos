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

// ---------- summary ----------
console.log("\n" + passed + " ok, " + failed + " failed");
if (failed > 0) { process.exit(1); }
