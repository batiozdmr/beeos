// EPG (Elektronik Program Rehberi): XMLTV indir, ayrıştır, kanalın "şimdi / sırada" programını ver.
// Kanal eşleşmesi tvg-id üstünden yapılır (bkz. channels.js). Kaynak: iptv-org/epg veya kullanıcı
// tarafından girilen başka bir XMLTV adresi. PC'de CORS engeli olursa /api/tv/proxy?raw=1 üzerinden alınır.
// XMLTV biçimi: <programme start="YYYYMMDDHHMMSS +TZTZ" stop="..." channel="ID"><title>...</title></programme>
var EPG = (function () {
  var programs = {};           // tvgId -> [{ start:ms, stop:ms, title, desc }] (başlama zamanına göre sıralı)
  var loaded = false, loading = false, lastUrl = "", err = "";
  var waiters = [];

  function trim(s) { return (s || "").replace(/^\s+|\s+$/g, ""); }

  // XMLTV zaman alanı: "20261109153000 +0300". ISO'ya çevirip Date.parse ile ms döndürür.
  function parseTime(s) {
    var m = /^\s*(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-]\d{4}))?/.exec(s || "");
    if (!m) { return 0; }
    var iso = m[1] + "-" + m[2] + "-" + m[3] + "T" + m[4] + ":" + m[5] + ":" + m[6];
    if (m[7]) { iso += m[7].slice(0, 3) + ":" + m[7].slice(3); } else { iso += "Z"; }
    var t = Date.parse(iso);
    return isNaN(t) ? 0 : t;
  }

  // Düz metin XMLTV'yi programs sözlüğüne çevirir. DOMParser Chromium 38'de var.
  function parseXml(text) {
    var out = {};
    if (!text) { return out; }
    var doc;
    try { doc = new DOMParser().parseFromString(text, "text/xml"); } catch (e) { return out; }
    if (!doc) { return out; }
    var ps = doc.getElementsByTagName("programme");
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i];
      var ch = p.getAttribute("channel");
      if (!ch) { continue; }
      var start = parseTime(p.getAttribute("start") || "");
      var stop = parseTime(p.getAttribute("stop") || "");
      if (!start || !stop || stop <= start) { continue; }
      var titleEl = p.getElementsByTagName("title")[0];
      var descEl = p.getElementsByTagName("desc")[0];
      var title = titleEl ? trim(titleEl.textContent) : "";
      if (!title) { continue; }
      if (!out[ch]) { out[ch] = []; }
      out[ch].push({ start: start, stop: stop, title: title, desc: descEl ? trim(descEl.textContent) : "" });
    }
    for (var k in out) {
      if (out.hasOwnProperty(k)) { out[k].sort(function (a, b) { return a.start - b.start; }); }
    }
    return out;
  }

  // Doğrudan dener; PC'de CORS engellenirse arka uçtaki ham-geçiş noktasını kullanır. cb(metin | null)
  function fetchUrl(url, cb) {
    var pc = (typeof Platform !== "undefined") && Platform.name() === "pc" && !Platform.mock();
    var x = new XMLHttpRequest(), done = false;
    function end(t) { if (!done) { done = true; cb(t); } }
    try { x.open("GET", url, true); } catch (e) { end(null); return; }
    x.timeout = 30000;
    x.onreadystatechange = function () {
      if (x.readyState !== 4) { return; }
      if (x.status === 200 && x.responseText) { end(x.responseText); return; }
      if (!pc) { end(null); return; }
      var y = new XMLHttpRequest(), done2 = false;
      function end2(t) { if (!done2) { done2 = true; end(t); } }
      try { y.open("GET", "/api/tv/proxy?raw=1&u=" + encodeURIComponent(url), true); } catch (e2) { end2(null); return; }
      y.setRequestHeader("X-BeeOS", "1");
      y.timeout = 30000;
      y.onreadystatechange = function () {
        if (y.readyState === 4) { end2(y.status === 200 && y.responseText ? y.responseText : null); }
      };
      y.ontimeout = y.onerror = function () { end2(null); };
      y.send();
    };
    x.ontimeout = x.onerror = function () { end(null); };
    x.send();
  }

  // Aynı adres için tek kere indirir. İkinci çağrı bellekteki veriyle anında cevap verir. cb(true|false)
  function load(url, cb) {
    cb = cb || function () {};
    if (!url) { err = "no-url"; cb(false); return; }
    if (loaded && url === lastUrl) { cb(true); return; }
    if (loading && url === lastUrl) { waiters.push(cb); return; }
    waiters = [cb]; loading = true; lastUrl = url; err = "";
    fetchUrl(url, function (text) {
      loading = false;
      if (!text) { err = "fetch"; programs = {}; loaded = false; flush(false); return; }
      programs = parseXml(text);
      loaded = false;
      for (var k in programs) { if (programs.hasOwnProperty(k)) { loaded = true; break; } }
      if (!loaded) { err = "parse"; }
      flush(loaded);
    });
    function flush(ok) { var w = waiters; waiters = []; for (var i = 0; i < w.length; i++) { w[i](ok); } }
  }

  // { now, next } — biri veya ikisi null olabilir. Kanalın tvg-id'si yoksa ya da veri yoksa null döner.
  function getNowNext(tvgId, nowMs) {
    if (!tvgId || !loaded) { return null; }
    var list = programs[tvgId];
    if (!list || !list.length) { return null; }
    var t = nowMs || new Date().getTime();
    var now = null, next = null;
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (p.start <= t && t < p.stop) { now = p; next = list[i + 1] || null; return { now: now, next: next }; }
      if (p.start > t) { return { now: null, next: p }; }
    }
    return { now: null, next: null };
  }

  function status() {
    if (!lastUrl) { return ""; }
    if (loading) { return "load"; }
    if (loaded) { return "ok"; }
    return "err:" + err;
  }

  // Bellekte tutulan ayrıştırılmış veriyi dışa aktar (testler için faydalı).
  function reset() { programs = {}; loaded = false; loading = false; lastUrl = ""; err = ""; waiters = []; }

  // Sadece testlerde çağrılır: ağ olmadan ayrıştırılmış veri enjekte eder.
  function _loadForTest(data) { programs = data || {}; loaded = true; loading = false; lastUrl = "test"; err = ""; }

  return { load: load, getNowNext: getNowNext, status: status,
           parseXml: parseXml, parseTime: parseTime, reset: reset, _loadForTest: _loadForTest };
})();

if (typeof module !== "undefined" && module.exports) { module.exports = EPG; }
