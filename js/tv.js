// Canlı TV (internet yayını): kanal listesi, kanal değiştirme, numarayla kanala gitme, bilgi şeridi,
// favoriler, önceki kanal. Kanallar: js/channels.js (yerleşik) + kullanıcının eklediği M3U listeleri.
// Oynatma: webOS'ta <video> HLS'yi kendisi oynatır. PC'de ve tarayıcıda hls.js (js/vendor, ilk açılışta
// yüklenir). CORS izni vermeyen yayınlar PC'de arka uç üzerinden (/api/tv/proxy) açılır.
var TV = (function () {
  var LIST_ROWS = 9;          // kanal listesinde aynı anda görünen satır
  var OSD_MS = 4500, NUM_MS = 1600, STALL_MS = 20000, RETRY_MAX = 3;
  var env = null;             // app.js'ten: { settings, save, toast, sound, clock, close }
  var el = {}, video = null, hls = null;
  var channels = [], groups = [], cur = -1, prev = -1;
  var listOpen = false, listGroup = 0, listIdx = 0, listItems = [];
  var lists = {};             // M3U adresi -> { state: "load" | "ok" | "err", channels: [] }
  var osdTimer = null, numTimer = null, numBuf = "", stallTimer = null, retryTimer = null;
  var attempt = null;         // { ch, steps, step, played, retries }
  var active = false;

  function $(id) { return document.getElementById(id); }
  function S() { return env.settings(); }
  function pc() { return Platform.name() === "pc" && !Platform.mock(); }

  function init(e) {
    env = e;
    ["tvp", "tvStatus", "tvMsg", "tvMsgSub", "tvNum", "tvOsd", "tvOsdNum", "tvOsdName", "tvOsdMeta",
     "tvOsdTime", "tvList", "tvListHead", "tvListRows", "tvListFoot"].forEach(function (id) { el[id] = $(id); });
    video = $("tvVideo");
    video.addEventListener("playing", function () {
      clearTimeout(stallTimer);
      if (attempt) { attempt.played = true; attempt.retries = 0; }
      setState("");
    });
    video.addEventListener("error", function () {
      if (attempt && attempt.steps[attempt.step] === "native") { failover(); }
    });
  }

  // ---------- kanal listeleri ----------
  // M3U: "#EXTINF:-1 tvg-logo="..." group-title="...",Kanal adı" satırından sonra yayın adresi gelir.
  // Tek bir yayın adresi (.m3u8, içinde #EXTINF yok) verilirse tek kanallık liste sayılır.
  function parseM3U(text, base) {
    var out = [], lines = text.split(/\r?\n/), info = null;
    if (!/#EXTINF/i.test(text) && /#EXT-X-/.test(text)) {
      return [{ name: hostOf(base), url: base, group: "Listem" }];
    }
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/^\s+|\s+$/g, "");
      if (!line) { continue; }
      if (/^#EXTINF/i.test(line)) {
        info = { name: line.substring(line.lastIndexOf(",") + 1).replace(/^\s+|\s+$/g, ""), group: "", logo: "" };
        var m, re = /([\w-]+)="([^"]*)"/g;
        while ((m = re.exec(line))) {
          if (m[1] === "group-title") { info.group = m[2]; }
          if (m[1] === "tvg-logo") { info.logo = m[2]; }
          if (m[1] === "tvg-name" && !info.name) { info.name = m[2]; }
        }
      } else if (/^#EXTGRP:/i.test(line)) {
        if (info) { info.group = line.substring(8); }
      } else if (line.charAt(0) !== "#" && info) {
        info.url = resolve(base, line);
        info.group = (info.group.split(";")[0] || "Diğer");
        info.name = info.name || "Kanal";
        if (info.logo) { info.logo = resolve(base, info.logo); }
        out.push(info);
        info = null;
      }
    }
    return out;
  }

  function resolve(base, rel) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(rel)) { return rel; }
    var m = /^([a-z]+:)\/\/([^\/?#]*)([^?#]*)/i.exec(base);
    if (!m) { return rel; }
    if (rel.indexOf("//") === 0) { return m[1] + rel; }
    if (rel.charAt(0) === "/") { return m[1] + "//" + m[2] + rel; }
    return m[1] + "//" + m[2] + m[3].replace(/[^\/]*$/, "") + rel;
  }

  function hostOf(url) {
    var m = /^[a-z]+:\/\/([^\/?#:]+)/i.exec(url);
    return m ? m[1].replace(/^www\./, "") : url;
  }

  // Liste dosyasını indirir. CORS izni yoksa PC'de arka uç üzerinden dener. cb(metin | null)
  function fetchText(url, cb) {
    get(url, false, function (text) {
      if (text !== null || !pc()) { cb(text); return; }
      get("/api/tv/proxy?raw=1&u=" + encodeURIComponent(url), true, cb);
    });
  }

  function get(url, own, cb) {
    var x = new XMLHttpRequest(), done = false;
    function end(t) { if (!done) { done = true; cb(t); } }
    try { x.open("GET", url, true); } catch (e) { end(null); return; }
    x.timeout = 25000;
    x.onreadystatechange = function () {
      if (x.readyState === 4) { end(x.status === 200 && x.responseText ? x.responseText : null); }
    };
    x.ontimeout = x.onerror = function () { end(null); };
    if (own) { x.setRequestHeader("X-BeeOS", "1"); }
    x.send();
  }

  // Listeyi indirip denetler (Ayarlar > TV > Liste ekle). cb(kanal sayısı; 0 = geçersiz liste, -1 = indirilemedi)
  function check(url, cb) {
    lists[url] = { state: "load", channels: [] };
    fetchText(url, function (text) {
      var chs = text ? parseM3U(text, url) : [];
      lists[url] = { state: chs.length ? "ok" : "err", channels: chs };
      if (active) { rebuild(); }
      cb(text === null ? -1 : chs.length);
    });
  }

  function listInfo(url) {
    var l = lists[url];
    return !l ? "" : l.state === "load" ? "Yükleniyor…" : l.state === "err" ? "Açılamadı" : l.channels.length + " kanal";
  }

  function forget(url) { delete lists[url]; }

  function loadLists() {
    S().tvLists.forEach(function (l) {
      if (!lists[l.url] || lists[l.url].state === "err") { check(l.url, function () {}); }
    });
  }

  function rebuild() {
    var keep = cur >= 0 ? channels[cur].url : S().tvLast;
    var keepPrev = prev >= 0 ? channels[prev].url : "";
    var all = [];
    if (S().tvBuiltin) {
      TV_CHANNELS.forEach(function (c) { all.push({ name: c.name, url: c.url, group: c.group, logo: "" }); });
    }
    S().tvLists.forEach(function (l) {
      var d = lists[l.url];
      if (d && d.state === "ok") {
        d.channels.forEach(function (c) { all.push({ name: c.name, url: c.url, group: c.group, logo: c.logo, list: l.name }); });
      }
    });
    var seen = {};
    groups = ["Tümü", "Favoriler"];
    all.forEach(function (c, i) {
      c.num = i + 1;
      if (!seen[c.group]) { seen[c.group] = true; groups.push(c.group); }
    });
    channels = all;
    cur = indexOf(keep);
    prev = indexOf(keepPrev);
    listGroup = Math.min(listGroup, groups.length - 1);
    if (listOpen) { renderList(); }
  }

  function indexOf(url) {
    for (var i = 0; i < channels.length; i++) { if (channels[i].url === url) { return i; } }
    return -1;
  }

  function isFav(ch) { return S().tvFav.indexOf(ch.url) >= 0; }

  // ---------- aç / kapat ----------
  function open() {
    active = true;
    document.getElementById("stage").classList.add("tv-on");
    rebuild();
    loadLists();
    if (!channels.length) {
      setState("err", "Kanal yok", "Ayarlar > TV bölümünden yerleşik kanalları aç veya M3U listesi ekle");
      return;
    }
    play(cur >= 0 ? cur : 0);
  }

  function close() {
    active = false;
    stop();
    closeList();
    clearTimeout(osdTimer);
    clearTimeout(numTimer);
    numBuf = "";
    el.tvNum.className = "";
    el.tvOsd.className = "";
    document.getElementById("stage").classList.remove("tv-on");
  }

  // Uygulama arka plana geçince yayın durur, dönünce yeniden bağlanır (canlı yayın: kaldığı yer yok)
  function suspend(hidden) {
    if (!active) { return; }
    if (hidden) { stop(); } else if (cur >= 0) { start(channels[cur]); }
  }

  // ---------- oynatma ----------
  function play(i) {
    if (!channels.length) { return; }
    i = (i + channels.length) % channels.length;
    if (cur >= 0 && cur !== i) { prev = cur; }
    cur = i;
    S().tvLast = channels[i].url;
    env.save();
    showOsd();
    start(channels[i]);
  }

  function stop() {
    clearTimeout(stallTimer);
    clearTimeout(retryTimer);
    attempt = null;
    if (hls) { hls.destroy(); hls = null; }
    video.pause();
    video.removeAttribute("src");
    try { video.load(); } catch (e) {}
  }

  // Denenecek yollar: TV'de doğrudan <video>; PC'de hls.js, olmazsa arka uç üzerinden, sonra doğrudan
  function start(ch) {
    stop();
    var steps = Platform.name() === "tv" ? ["native"] : pc() ? ["hls", "proxy", "native"] : ["hls", "native"];
    attempt = { ch: ch, steps: steps, step: 0, played: false, retries: 0 };
    run();
  }

  function run() {
    var a = attempt, how = a.steps[a.step];
    if (hls) { hls.destroy(); hls = null; }
    setState("load", a.ch.name);
    clearTimeout(stallTimer);
    stallTimer = setTimeout(function () { if (attempt === a && !a.played) { failover(); } }, STALL_MS);
    if (how === "native") {
      video.src = a.ch.url;
      playVideo();
      return;
    }
    loadHls(function (ok) {
      if (attempt !== a) { return; }
      if (!ok || !window.Hls || !Hls.isSupported()) { failover(); return; }
      hls = new Hls({ xhrSetup: xhrSetup, manifestLoadingMaxRetry: 1, levelLoadingMaxRetry: 2,
                      fragLoadingMaxRetry: 3, maxBufferLength: 20, backBufferLength: 10 });
      hls.on(Hls.Events.ERROR, function (ev, data) { if (data.fatal && attempt === a) { failover(); } });
      hls.on(Hls.Events.MANIFEST_PARSED, playVideo);
      hls.loadSource(how === "proxy" ? "/api/tv/proxy?u=" + encodeURIComponent(a.ch.url) : a.ch.url);
      hls.attachMedia(video);
    });
  }

  function playVideo() {
    var p = video.play();
    if (p && p.catch) { p.catch(function () {}); }
  }

  // Arka uç istekleri (aynı adres) "X-BeeOS" başlığı ister; başka adreslere başlık eklenmez (ön kontrol olmasın)
  function xhrSetup(xhr, url) {
    var own = location.protocol + "//" + location.host;
    if (url.indexOf("/api/tv/") !== 0 && url.indexOf(own + "/api/tv/") !== 0) { return; }
    if (!xhr.readyState) { xhr.open("GET", url, true); }
    xhr.setRequestHeader("X-BeeOS", "1");
  }

  // Oynarken kopan yayın aynı yolla yeniden bağlanır; hiç açılmadıysa sıradaki yol denenir
  function failover() {
    var a = attempt;
    if (!a) { return; }
    if (a.played && a.retries < RETRY_MAX) {
      a.retries++;
      a.played = false;
      setState("load", a.ch.name);
      clearTimeout(retryTimer);
      retryTimer = setTimeout(function () { if (attempt === a) { run(); } }, 2000);
      return;
    }
    if (a.step + 1 < a.steps.length) { a.step++; run(); return; }
    clearTimeout(stallTimer);
    if (hls) { hls.destroy(); hls = null; }
    setState("err", a.ch.name + " şu an açılamıyor",
             "Yayın kapalı olabilir ya da adresi değişmiş olabilir. Yukarı/aşağı ile başka kanala geç.");
    env.sound("error");
  }

  var hlsState = "";   // "" | "load" | "ok" | "err"
  var hlsWait = [];
  function loadHls(cb) {
    if (window.Hls || hlsState === "ok") { cb(true); return; }
    if (hlsState === "err") { cb(false); return; }
    hlsWait.push(cb);
    if (hlsState === "load") { return; }
    hlsState = "load";
    var s = document.createElement("script");
    s.src = "js/vendor/hls.min.js";
    s.onload = function () { hlsState = "ok"; flush(true); };
    s.onerror = function () { hlsState = "err"; flush(false); };
    document.body.appendChild(s);
    function flush(ok) { var w = hlsWait; hlsWait = []; w.forEach(function (f) { f(ok); }); }
  }

  // ---------- ekrandaki bilgiler ----------
  function setState(s, msg, sub) {
    el.tvStatus.className = s;
    el.tvMsg.textContent = msg || "";
    el.tvMsgSub.textContent = s === "load" ? "Yükleniyor…" : sub || "";
  }

  function showOsd() {
    if (cur < 0) { return; }
    var ch = channels[cur];
    el.tvOsdNum.textContent = ch.num;
    el.tvOsdName.textContent = ch.name + (isFav(ch) ? "  ★" : "");
    el.tvOsdMeta.textContent = ch.group + (ch.list ? "  ·  " + ch.list : "");
    el.tvOsdTime.textContent = env.clock();
    el.tvOsd.className = "on";
    clearTimeout(osdTimer);
    osdTimer = setTimeout(function () { el.tvOsd.className = ""; }, OSD_MS);
  }

  // ---------- numarayla kanal ----------
  function digit(d) {
    numBuf = (numBuf + d).slice(-4);
    el.tvNum.textContent = numBuf;
    el.tvNum.className = "on";
    clearTimeout(numTimer);
    if (numBuf.length >= String(channels.length).length && numBuf !== "0") { numTimer = setTimeout(commitNum, 300); }
    else { numTimer = setTimeout(commitNum, NUM_MS); }
  }

  function commitNum() {
    var n = parseInt(numBuf, 10);
    numBuf = "";
    el.tvNum.className = "";
    if (n === 0) { recall(); return; }
    if (n >= 1 && n <= channels.length) {
      if (listOpen) { closeList(); }
      env.sound("select");
      play(n - 1);
    } else {
      env.sound("edge");
      env.toast(n + " numaralı kanal yok");
    }
  }

  // Önceki kanala dön (0 veya Mavi tuş)
  function recall() {
    if (prev < 0 || prev >= channels.length) { env.sound("edge"); return; }
    env.sound("select");
    play(prev);
  }

  function toggleFav(ch) {
    var f = S().tvFav, at = f.indexOf(ch.url);
    if (at >= 0) { f.splice(at, 1); } else { f.push(ch.url); }
    env.save();
    env.sound("select");
    env.toast(at >= 0 ? ch.name + " favorilerden çıkarıldı" : ch.name + " favorilere eklendi");
    if (listOpen) { renderList(); }
    if (cur >= 0 && channels[cur] === ch && el.tvOsd.className) { showOsd(); }
  }

  // ---------- kanal listesi ----------
  function filtered() {
    var g = groups[listGroup];
    return channels.filter(function (c) {
      return g === "Tümü" || (g === "Favoriler" ? isFav(c) : c.group === g);
    });
  }

  function openList() {
    if (!channels.length) { return; }
    listOpen = true;
    listItems = filtered();
    var at = cur >= 0 ? listItems.indexOf(channels[cur]) : -1;
    if (at < 0 && cur >= 0) { listGroup = 0; listItems = filtered(); at = cur; }
    listIdx = Math.max(0, at);
    el.tvList.className = "on";
    el.tvOsd.className = "";
    env.sound("open");
    renderList();
  }

  function closeList() {
    listOpen = false;
    el.tvList.className = "";
  }

  function setGroup(dir) {
    listGroup = (listGroup + dir + groups.length) % groups.length;
    listItems = filtered();
    listIdx = 0;
    env.sound("move");
    renderList();
  }

  function renderList() {
    listItems = filtered();
    var n = listItems.length;
    listIdx = Math.max(0, Math.min(listIdx, n - 1));
    el.tvListHead.innerHTML = "";
    var head = document.createElement("div");
    head.className = "tvl-group";
    head.textContent = "‹  " + groups[listGroup] + "  ›";
    var count = document.createElement("div");
    count.className = "tvl-count";
    count.textContent = n + " kanal";
    el.tvListHead.appendChild(head);
    el.tvListHead.appendChild(count);
    var box = el.tvListRows;
    box.innerHTML = "";
    if (!n) {
      var empty = document.createElement("div");
      empty.className = "tvl-empty";
      empty.textContent = groups[listGroup] === "Favoriler" ? "Favori kanal yok. Sarı tuş (F3) ile ekleyebilirsin." : "Bu grupta kanal yok.";
      box.appendChild(empty);
    }
    var start = Math.max(0, Math.min(listIdx - Math.floor(LIST_ROWS / 2), n - LIST_ROWS));
    for (var i = start; i < Math.min(n, start + LIST_ROWS); i++) { box.appendChild(listRow(listItems[i], i)); }
    var loading = S().tvLists.filter(function (l) { return lists[l.url] && lists[l.url].state === "load"; }).length;
    el.tvListFoot.textContent = (loading ? "Listeler yükleniyor…  ·  " : "") +
      "OK: izle  ·  Sağ/sol: grup  ·  Sarı (F3): favori  ·  Geri: kapat";
  }

  function listRow(ch, i) {
    var row = document.createElement("div");
    row.className = "tvl-row" + (i === listIdx ? " sel" : "") + (cur >= 0 && channels[cur] === ch ? " cur" : "");
    var num = document.createElement("div");
    num.className = "tvl-num";
    num.textContent = ch.num;
    var logo = document.createElement("div");
    logo.className = "tvl-logo";
    if (ch.logo) {
      var img = document.createElement("img");
      img.onerror = function () { logo.removeChild(img); logo.textContent = initials(ch.name); };
      img.src = ch.logo;
      logo.appendChild(img);
    } else {
      logo.textContent = initials(ch.name);
    }
    var name = document.createElement("div");
    name.className = "tvl-name";
    name.textContent = ch.name;
    row.appendChild(num);
    row.appendChild(logo);
    row.appendChild(name);
    if (isFav(ch)) {
      var star = document.createElement("div");
      star.className = "tvl-fav";
      star.textContent = "★";
      row.appendChild(star);
    }
    row.addEventListener("click", function () { listIdx = i; pick(); });
    return row;
  }

  function initials(name) {
    var w = name.split(/\s+/);
    return (w.length > 1 && w[1] ? w[0].charAt(0) + w[1].charAt(0) : name.slice(0, 2)).toUpperCase();
  }

  function pick() {
    var ch = listItems[listIdx];
    if (!ch) { return; }
    closeList();
    env.sound("select");
    play(channels.indexOf(ch));
  }

  function listMove(d) {
    var n = listItems.length;
    if (!n) { return; }
    var to = Math.max(0, Math.min(n - 1, listIdx + d));
    if (to === listIdx) {
      // Uçlarda tek adım basış başa/sona sarar
      if (Math.abs(d) === 1) { to = d > 0 ? 0 : n - 1; } else { env.sound("edge"); return; }
    }
    listIdx = to;
    env.sound("move");
    renderList();
  }

  // ---------- tuşlar ----------
  // webOS: CH+ 33, CH- 34, Kırmızı 403, Yeşil 404, Sarı 405, Mavi 406, Geri 461. PC: PageUp/PageDown, F1-F4, Esc.
  function key(k) {
    if (k >= 48 && k <= 57) { digit(String(k - 48)); return true; }
    if (k >= 96 && k <= 105) { digit(String(k - 96)); return true; }
    if (numBuf && k === 13) { clearTimeout(numTimer); commitNum(); return true; }
    var back = k === 461 || k === 27 || k === 8;
    if (listOpen) {
      if (k === 38) { listMove(-1); }
      else if (k === 40) { listMove(1); }
      else if (k === 33) { listMove(-LIST_ROWS); }
      else if (k === 34) { listMove(LIST_ROWS); }
      else if (k === 37 || k === 39) { setGroup(k === 39 ? 1 : -1); }
      else if (k === 13) { pick(); }
      else if (k === 405 || k === 114) { if (listItems[listIdx]) { toggleFav(listItems[listIdx]); } }
      else if (back) { closeList(); env.sound("back"); }
      return true;
    }
    if (k === 38 || k === 33) { env.sound("move"); play(cur + 1); }
    else if (k === 40 || k === 34) { env.sound("move"); play(cur - 1); }
    else if (k === 13 || k === 37) { openList(); }
    else if (k === 39 || k === 404 || k === 113) { showOsd(); }
    else if (k === 405 || k === 114) { if (cur >= 0) { toggleFav(channels[cur]); } }
    else if (k === 406 || k === 115) { recall(); }
    else if (back) { env.sound("back"); env.close(); }
    return true;
  }

  return { init: init, open: open, close: close, key: key, suspend: suspend,
           check: check, listInfo: listInfo, forget: forget, parse: parseM3U, hostOf: hostOf };
})();
