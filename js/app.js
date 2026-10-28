// ES5 yazıldı: eski webOS (Chromium 38) uyumlu.
(function () {
  var APP_ID = "com.beeuptech.beeos";
  var VERSION = "0.4.0";
  var STAGE_W = 1920, STAGE_H = 1080;
  var CARD_GAP = 28;
  var VISIBLE_RIGHT = 1920 - 160;
  var LONG_PRESS = 600;
  var ROW_H = { large: 288, small: 210 };
  var CARD_W = { large: 330, small: 240 };
  var PALETTE = [["#0ea5e9", "#073a54"], ["#22c55e", "#0a4a22"], ["#f97316", "#6b2a05"],
                 ["#a855f7", "#3b1068"], ["#ef4444", "#5c0b0b"], ["#14b8a6", "#06463f"]];
  var DAYS = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
  var MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz",
                "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

  function $(id) { return document.getElementById(id); }
  var stage = $("stage"), rowsEl = $("rows"), heroEl = $("hero"), toastEl = $("toast");
  var layers = [$("ambA"), $("ambB")];

  var S = Store.load();
  var model = [];          // ayarlara göre sıralanmış/filtrelenmiş raflar
  var rows = [];           // { el, track, cards[], index, cardW }
  var focusRow = 0;
  var focusId = null;      // yeniden çizimden sonra odaklanacak kart
  var mode = "home";       // home | panel | menu | osk | saver | loading | boot
  var installed = null;    // TV'den gelen yüklü uygulamalar (rafa eklenenler)
  var tvIcons = {};        // { uygulamaId: TV'deki gerçek ikon yolu }
  var missingImg = {};     // yüklenemeyen görseller: tekrar denenmez
  var openTabs = {};       // PC: sekmesi açık uygulamalar { id: sekme başlığı }
  var launching = null;    // açılmakta olan kart (Geri ile iptal edilir)

  var toastTimer = null, ambientTimer = null, ambientOn = 0, lastAmbient = "";
  var heroTimer = null, heroItem = null;
  var lastMX = -1, lastMY = -1;
  var pressTimer = null, pressing = false, pressFired = false;
  var idleTimer = null, saverMove = null;
  var loadTimer = null, bootTimer = null;

  // ---------- yardımcılar ----------
  function div(cls, text) {
    var d = document.createElement("div");
    d.className = cls;
    if (text) { d.textContent = text; }
    return d;
  }

  function span(cls, text) {
    var s = document.createElement("span");
    s.className = cls;
    s.textContent = text;
    return s;
  }

  function trim(s) { return (s || "").replace(/^\s+|\s+$/g, ""); }

  function setCls(el, name, on) {
    if (on) { el.classList.add(name); } else { el.classList.remove(name); }
  }

  function setTransform(el, t) {
    el.style.webkitTransform = t;
    el.style.transform = t;
  }

  // Eski Chromium'da sort kararlı değil: indeksle kararlı hale getir
  function sortBy(arr, keyFn) {
    var dec = arr.map(function (x, i) { return { x: x, i: i, k: keyFn(x) }; });
    dec.sort(function (a, b) { return (a.k - b.k) || (a.i - b.i); });
    return dec.map(function (d) { return d.x; });
  }

  function save() { Store.save(S); }

  function pad(n) { return n < 10 ? "0" + n : "" + n; }

  function fmtTime(d) {
    var h = d.getHours();
    return S.clock24
      ? pad(h) + ":" + pad(d.getMinutes())
      : (h % 12 || 12) + ":" + pad(d.getMinutes()) + (h < 12 ? " ÖÖ" : " ÖS");
  }

  // "az önce", "12 dk önce", "bugün 20:12", "dün 21:40", "3 gün önce", "14 Ekim"
  function relTime(ts) {
    var now = new Date(), d = new Date(ts);
    var min = Math.round((now.getTime() - ts) / 60000);
    if (min < 1) { return "az önce"; }
    if (min < 60) { return min + " dk önce"; }
    var day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (ts >= day0) { return "bugün " + fmtTime(d); }
    if (ts >= day0 - 86400000) { return "dün " + fmtTime(d); }
    var days = Math.floor((day0 - ts) / 86400000) + 1;
    if (days < 7) { return days + " gün önce"; }
    return d.getDate() + " " + MONTHS[d.getMonth()];
  }

  function fitStage() {
    var s = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
    setTransform(stage, "scale(" + s + ")");
    stage.style.left = Math.round((window.innerWidth - STAGE_W * s) / 2) + "px";
    stage.style.top = Math.round((window.innerHeight - STAGE_H * s) / 2) + "px";
  }

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.className = "show";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.className = ""; }, 2600);
  }

  // ---------- webOS servis çağrısı ----------
  var pendingCalls = [];   // köprü nesneleri cevap gelene kadar canlı tutulmalı

  function luna(uri, params, cb) {
    if (typeof PalmServiceBridge === "undefined") { cb(null); return false; }
    try {
      var b = new PalmServiceBridge();
      pendingCalls.push(b);
      b.onservicecallback = function (resp) {
        var i = pendingCalls.indexOf(b);
        if (i >= 0) { pendingCalls.splice(i, 1); }
        var res = null;
        try { res = JSON.parse(resp); } catch (e) {}
        cb(res);
      };
      b.call(uri, JSON.stringify(params));
      return true;
    } catch (e) {
      cb(null);
      return false;
    }
  }

  // ---------- logolar ----------
  // Sıra: logos/<id>.png (LOGO_FILES'ta listelenen) > marka logosu (LOGOS, beyaz SVG)
  //       > TV'deki gerçek uygulama ikonu > çizgi ikon
  function logoSources(item) {
    var list = [];
    if (LOGO_FILES.indexOf(item.id) >= 0) { list.push("logos/" + item.id + ".png"); }
    if (tvIcons[item.id] && !LOGOS[item.id]) { list.push(tvIcons[item.id]); }
    return list.filter(function (src) { return !missingImg[src]; });
  }

  // Görselleri sırayla dener. onState: "img" (görsel), "brand" (marka SVG) veya false (çizgi ikon).
  function putLogo(box, item, onState) {
    var srcs = logoSources(item);
    function fallback() {
      if (LOGOS[item.id]) { box.innerHTML = LOGOS[item.id]; onState("brand"); }
      else { box.innerHTML = ICONS[item.icon] || ICONS.play; onState(false); }
    }
    if (!srcs.length) { fallback(); return; }
    var k = 0;
    var img = document.createElement("img");
    img.className = "logo-img";
    img.onerror = function () {
      missingImg[srcs[k]] = true;
      k++;
      if (k < srcs.length) { img.src = srcs[k]; return; }
      fallback();
    };
    img.onload = function () { onState("img"); };
    box.innerHTML = "";
    box.appendChild(img);
    img.src = srcs[0];
  }

  // ---------- veri modeli ----------
  // Kart bu ortamda gösterilir mi? PC'de sadece web adresi olanlar ve özel kartlar.
  function availableHere(it) {
    var pc = Platform.name() === "pc";
    if (it.only && it.only !== (pc ? "pc" : "tv")) { return false; }
    return !pc || !!it.web || it.id.charAt(0) === "@";
  }

  function computeModel() {
    var pc = Platform.name() === "pc";
    var defs = CONFIG.rows.map(function (def) {
      return { title: pc && def.pcTitle ? def.pcTitle : def.title, size: def.size,
               items: def.items.filter(availableHere) };
    });
    if (S.allApps && installed === "loading") {
      defs.push({ title: "Tüm Uygulamalar", size: "small", items: skeletonItems() });
    } else if (S.allApps && installed && installed.length) {
      defs.push({ title: "Tüm Uygulamalar", size: "small", items: installed });
    }
    var out = [];
    for (var r = 0; r < defs.length; r++) {
      var def = defs[r];
      var ord = S.order[def.title] || [];
      var items = sortBy(def.items, function (it) {
        var p = ord.indexOf(it.id);
        return p >= 0 ? p : 1000 + def.items.indexOf(it);
      });
      items = items.filter(function (it) { return S.hidden.indexOf(it.id) < 0; });
      if (r === 0 && S.sort === "usage") {
        items = sortBy(items, function (it) { return -(S.usage[it.id] || 0); });
      }
      if (items.length) { out.push({ title: def.title, size: def.size, items: items }); }
    }
    return out;
  }

  // Uygulama listesi gelene kadar gösterilen yer tutucu kartlar
  var SKELETON = null;
  function skeletonItems() {
    if (!SKELETON) {
      SKELETON = [];
      for (var i = 0; i < 5; i++) {
        SKELETON.push({ id: "@skeleton" + i, skeleton: true, name: "Yükleniyor…", cat: "",
                        icon: "play", colors: ["#2a3142", "#161b26"],
                        desc: "Yüklü uygulamalar TV'den alınıyor." });
      }
    }
    return SKELETON;
  }

  function curItem() { return model[focusRow].items[rows[focusRow].index]; }
  function curCard() { return rows[focusRow].cards[rows[focusRow].index]; }

  function findItem(id) {
    for (var r = 0; r < model.length; r++) {
      for (var i = 0; i < model[r].items.length; i++) {
        if (model[r].items[i].id === id) { return model[r].items[i]; }
      }
    }
    return null;
  }

  // En son açılan uygulama (özel kartlar hariç): açılışta odak orada başlar
  function lastOpenedId() {
    var best = null, bt = 0;
    for (var id in S.lastOpen) {
      if (S.lastOpen.hasOwnProperty(id) && id.charAt(0) !== "@" && S.lastOpen[id] > bt) {
        best = id;
        bt = S.lastOpen[id];
      }
    }
    return best;
  }

  // ---------- raflar ----------
  function renderRows() {
    var keepId = focusId || (rows.length ? curItem().id : null);
    focusId = null;
    model = computeModel();
    rowsEl.innerHTML = "";
    rows = [];
    for (var r = 0; r < model.length; r++) {
      var def = model[r];
      var rowEl = div("row " + def.size);
      var track = div("track");
      var cards = [];
      for (var i = 0; i < def.items.length; i++) {
        cards.push(makeCard(def.items[i], r, i, def.size === "large"));
        track.appendChild(cards[i]);
      }
      rowEl.appendChild(div("row-title", def.title));
      rowEl.appendChild(track);
      // kenarlarda devamı olduğunu gösteren oklar
      rowEl.appendChild(div("chev l", "‹"));
      rowEl.appendChild(div("chev r", "›"));
      rowsEl.appendChild(rowEl);
      rows.push({ el: rowEl, track: track, cards: cards, index: 0, cardW: CARD_W[def.size] });
      scrollTrack(rows[r]);
    }
    // önceki odağı geri bul (önce aynı raf)
    var fr = Math.min(focusRow, rows.length - 1), fi = 0;
    var order = [fr];
    for (var x = 0; x < model.length; x++) { if (x !== fr) { order.push(x); } }
    for (var o = 0; o < order.length && keepId; o++) {
      var ids = model[order[o]].items.map(function (it) { return it.id; });
      var at = ids.indexOf(keepId);
      if (at >= 0) { fr = order[o]; fi = at; break; }
    }
    focusRow = fr;
    setFocus(fr, Math.min(fi, rows[fr].cards.length - 1));
  }

  function makeCard(item, r, i, large) {
    var c = div(item.skeleton ? "card skeleton" : "card");
    var face = div("face");
    if (item.skeleton) {
      c.appendChild(div("shadow"));
      c.appendChild(face);
      c.appendChild(div("ring"));
      return c;
    }
    face.style.background = "linear-gradient(145deg, " + item.colors[0] + ", " + item.colors[1] + ")";
    var icon = div("icon");
    putLogo(icon, item, function (s) {
      setCls(c, "has-logo", s === "img");
      setCls(c, "has-brand", s === "brand");
    });
    var hasSub = large && item.sub;
    face.appendChild(icon);
    face.appendChild(div("name" + (hasSub ? " has-sub" : ""), item.name));
    if (hasSub) { face.appendChild(div("sub", item.sub)); }
    c.appendChild(div("shadow"));
    c.appendChild(face);
    c.appendChild(div("ring"));
    // mouseenter yerine mousemove: kaydırma sırasında sabit imleç odağı çalmasın
    c.addEventListener("mousemove", function (e) {
      if (mode !== "home") { return; }
      if (e.clientX === lastMX && e.clientY === lastMY) { return; }
      lastMX = e.clientX;
      lastMY = e.clientY;
      if (focusRow !== r || rows[r].index !== i) { setFocus(r, i); }
    });
    c.addEventListener("mousedown", function (e) {
      if (mode !== "home") { return; }
      if (focusRow !== r || rows[r].index !== i) { setFocus(r, i); }
      pressStart();
      e.preventDefault();
    });
    return c;
  }

  function setFocus(r, i) {
    var old = rows[focusRow];
    if (old && old.cards[old.index]) {
      old.cards[old.index].classList.remove("focused");
      old.el.classList.remove("active");
    }
    focusRow = r;
    rows[r].index = i;
    rows[r].cards[i].classList.add("focused");
    rows[r].el.classList.add("active");
    scrollTrack(rows[r]);
    // 3. raf ve sonrasında raflar yukarı kayar, hero gizlenir
    var off = 0;
    for (var k = 1; k < r; k++) { off += ROW_H[model[k].size]; }
    setTransform(rowsEl, "translate3d(0," + (-off) + "px,0)");
    setCls(stage, "scrolled", off > 0);
    var item = model[r].items[i];
    setAmbient(item.colors[0]);
    setHero(item);
  }

  function scrollTrack(row) {
    var right = row.index * (row.cardW + CARD_GAP) + row.cardW + 120;
    var shift = right > VISIBLE_RIGHT ? right - VISIBLE_RIGHT : 0;
    setTransform(row.track, "translate3d(" + (-shift) + "px,0,0)");
    var end = 120 + row.cards.length * (row.cardW + CARD_GAP) - CARD_GAP - shift;
    setCls(row.el, "more-l", shift > 0);
    setCls(row.el, "more-r", end > STAGE_W - 150);
  }

  function move(dx, dy) {
    var row = rows[focusRow];
    if (dy) {
      var nr = focusRow + dy;
      if (nr < 0 || nr >= rows.length) { Sound.play("edge"); return; }
      setFocus(nr, Math.min(rows[nr].index, rows[nr].cards.length - 1));
    } else if (dx) {
      var n = row.index + dx;
      if (n < 0 || n >= row.cards.length) { Sound.play("edge"); return; }
      setFocus(focusRow, n);
    }
    Sound.play("move");
  }

  // ---------- arka plan ışığı ve hero ----------
  function hexToRgba(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return "rgba(" + (n >> 16) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
  }

  // Renk değişince iki katman çapraz geçiş yapar. Tuş basılı tutulurken boşuna çizim yapılmaz.
  function setAmbient(color) {
    if (!S.ambient || color === lastAmbient) { return; }
    lastAmbient = color;
    clearTimeout(ambientTimer);
    ambientTimer = setTimeout(function () {
      var next = layers[1 - ambientOn];
      next.style.background =
        "radial-gradient(ellipse 1300px 800px at 26% 22%, " + hexToRgba(color, 0.38) + ", rgba(0,0,0,0) 70%)";
      next.className = "ambient on";
      layers[ambientOn].className = "ambient";
      ambientOn = 1 - ambientOn;
    }, 140);
  }

  function setHero(item) {
    if (item === heroItem) { return; }
    heroItem = item;
    heroEl.classList.add("out");
    clearTimeout(heroTimer);
    heroTimer = setTimeout(function () {
      $("heroLabel").textContent = item.cat || "";
      $("heroTitle").textContent = item.name;
      $("heroDesc").textContent = item.desc || "";
      $("heroBar").style.background = item.colors[0];
      var hi = $("heroIcon");
      hi.style.background = "linear-gradient(145deg, " + item.colors[0] + ", " + item.colors[1] + ")";
      putLogo($("heroIconIn"), item, function (s) {
        setCls(hi, "logo", s === "img");
        setCls(hi, "brand", s === "brand");
      });
      heroMeta(item);
      heroEl.classList.remove("out");
    }, 140);
  }

  // Hero'nun alt satırı: açık sekmedeki içerik ("Devam et") ya da son açılış bilgisi
  function heroMeta(item) {
    var el = $("heroMeta");
    el.innerHTML = "";
    if (item.id.charAt(0) !== "@" && openTabs.hasOwnProperty(item.id)) {
      el.appendChild(span("mk", "▶  Devam et"));
      el.appendChild(span("", openTabs[item.id] || "Açık, kaldığın yerden sürüyor"));
    } else if (item.id.charAt(0) !== "@" && S.lastOpen[item.id]) {
      el.appendChild(span("", "Son açılış: " + relTime(S.lastOpen[item.id]) +
                              "  ·  " + (S.usage[item.id] || 1) + " kez açıldı"));
    }
  }

  // Sekme başlığından marka adını ayıklar: "Lofi beats - YouTube" -> "Lofi beats", "Netflix" -> ""
  function cleanTitle(item, t) {
    t = trim((t || "").replace(/^\(\d+\)\s*/, ""));
    var brand = item.name.split(" ")[0].toLowerCase();
    var m = t.match(/^(.*\S)\s+[-|–—•:]\s+([^-|–—•:]+)$/);
    if (m && m[2].toLowerCase().indexOf(brand) >= 0) { t = m[1]; }
    if (/^https?:/.test(t) || (t.toLowerCase().indexOf(brand) === 0 && t.length <= item.name.length + 2)) { t = ""; }
    return t.length > 70 ? t.slice(0, 68) + "…" : t;
  }

  // PC: hangi uygulamaların sekmesi açık? beeOS'a her dönüşte yenilenir.
  function refreshOpen() {
    if (Platform.name() !== "pc") { return; }
    Platform.api("GET", "/api/apps/open", null, function (res) {
      var t = (res && res.apps) || {};
      openTabs = {};
      for (var id in t) {
        if (t.hasOwnProperty(id)) {
          var it = findItem(id);
          if (it) { openTabs[id] = cleanTitle(it, t[id]); }
        }
      }
      if (heroItem) { heroMeta(heroItem); }
    });
  }

  // ---------- OK: kısa basış açar, uzun basış kart menüsü ----------
  function pressStart() {
    if (pressing) { return; }
    pressing = true;
    pressFired = false;
    curCard().classList.add("pressed");
    pressTimer = setTimeout(function () {
      pressFired = true;
      curCard().classList.remove("pressed");
      openMenu();
    }, LONG_PRESS);
  }

  function pressEnd() {
    if (!pressing) { return; }
    pressing = false;
    clearTimeout(pressTimer);
    curCard().classList.remove("pressed");
    if (!pressFired) { launch(curItem()); }
  }

  function pressCancel() {
    pressing = false;
    clearTimeout(pressTimer);
  }

  // opt: { url: açılacak adres (arama), params: webOS açılış parametreleri }
  function launch(item, opt) {
    opt = opt || {};
    if (item.skeleton) { Sound.play("edge"); return; }
    S.usage[item.id] = (S.usage[item.id] || 0) + 1;
    S.lastOpen[item.id] = new Date().getTime();
    save();
    if (item.id === "@settings") { openPanel(); return; }
    if (item.id === "@wifi") { openWifi(); return; }
    if (item.id === "@power") { openPower(); return; }
    if (item.id === "@search") { openSearch(""); return; }
    if (item.id === "@remote") { openRemote(); return; }
    Sound.play("select");
    showLoader(item);
    launching = item;
    if (Platform.name() === "pc") {
      // Arka uç sekmeyi arka planda açar ve sayfa yüklenince öne getirir; bu sürede yükleme ekranı görünür
      Platform.api("POST", "/api/launch", { id: item.id, url: opt.url || item.web, ua: item.ua || "", nav: !!opt.url },
        function (res) {
          if (launching !== item) { return; }   // Geri ile vazgeçildi
          launching = null;
          if (!res || !res.ok) { launchFailed(item, res && res.error); return; }
          if (Platform.mock()) { hideLoader(); toast("Test: " + item.name + " → " + (opt.url || item.web)); }
        });
      return;
    }
    if (Platform.name() !== "tv") {
      // Tarayıcı testi: yükleme ekranını kısa süre göster
      loadTimer = setTimeout(function () {
        hideLoader();
        toast("Test: " + item.name + " (" + item.id + ")" + (opt.url ? " → " + opt.url : ""));
      }, 1400);
      return;
    }
    var p = { id: item.id };
    if (opt.params) { p.params = opt.params; }
    luna("luna://com.webos.service.applicationmanager/launch", p, function (res) {
      if (!res || res.returnValue === false) { launchFailed(item, res && res.errorText); }
    });
  }

  function launchFailed(item, why) {
    hideLoader();
    Sound.play("error");
    toast(item.name + " açılamadı" + (why ? ": " + why : ""));
  }

  function cancelLaunch() {
    if (launching && Platform.name() === "pc") {
      Platform.api("POST", "/api/launch/cancel", { id: launching.id });
    }
    launching = null;
    hideLoader();
    Sound.play("back");
  }

  // ---------- uygulama açılış ekranı ----------
  function showLoader(item) {
    mode = "loading";
    $("loaderName").textContent = item.name + " açılıyor";
    var box = $("loaderLogo");
    box.style.background = "linear-gradient(145deg, " + item.colors[0] + ", " + item.colors[1] + ")";
    var inner = $("loaderIcon");
    putLogo(inner, item, function (s) {
      setCls(box, "logo", s === "img");
      setCls(box, "brand", s === "brand");
    });
    $("loader").style.webkitTransition = $("loader").style.transition = "";
    stage.classList.add("loading-on");
    clearTimeout(loadTimer);
    // Uygulama öne gelince sayfa gizlenir (visibilitychange). Gelmezse süre dolunca kapat.
    loadTimer = setTimeout(hideLoader, Platform.name() === "pc" ? 20000 : 8000);
  }

  function hideLoader() {
    clearTimeout(loadTimer);
    if (mode === "loading") { mode = "home"; }
    stage.classList.remove("loading-on");
  }

  // ---------- kart menüsü (taşı / gizle) ----------
  var menuOpts = [], menuIdx = 0;

  function openMenu() {
    var item = curItem(), i = rows[focusRow].index, n = model[focusRow].items.length;
    if (item.skeleton) { return; }
    var opts = [];
    if (i > 0) { opts.push({ label: "Sola taşı", run: function () { moveItem(-1); } }); }
    if (i < n - 1) { opts.push({ label: "Sağa taşı", run: function () { moveItem(1); } }); }
    if (i > 0) { opts.push({ label: "Başa taşı", run: function () { moveItem("first"); } }); }
    if (item.id !== "@settings") { opts.push({ label: "Gizle", run: hideItem }); }
    opts.push({ label: "Kapat", run: function () {} });
    showMenu(item.name, opts);
  }

  // Ortada açılan seçim listesi. opts: [{ label, run }]
  function showMenu(title, opts) {
    pressCancel();
    Sound.play("open");
    menuOpts = opts;
    menuIdx = 0;
    $("menuTitle").textContent = title;
    renderMenu();
    mode = "menu";
    stage.classList.add("menu-open");
  }

  // ---------- PC: güç menüsü ----------
  function openPower() {
    function power(action, msg) {
      return function () {
        toast(msg);
        Platform.api("POST", "/api/power", { action: action }, function (res) {
          if (!res || !res.ok) { Sound.play("error"); toast("İşlem yapılamadı"); }
        });
      };
    }
    showMenu("Güç", [
      { label: "Kapat", run: power("off", "Kapatılıyor…") },
      { label: "Yeniden başlat", run: power("reboot", "Yeniden başlatılıyor…") },
      { label: "Açık uygulamaları kapat", run: function () {
        Platform.api("POST", "/api/apps/close", null, function (res) {
          toast(res && res.ok ? (res.closed ? res.closed + " uygulama kapatıldı" : "Açık uygulama yok") : "İşlem yapılamadı");
          refreshOpen();
        });
      } },
      { label: "Vazgeç", run: function () {} }
    ]);
  }

  function renderMenu() {
    var list = $("menuList");
    list.innerHTML = "";
    for (var i = 0; i < menuOpts.length; i++) {
      var el = div("mopt" + (i === menuIdx ? " sel" : ""), menuOpts[i].label);
      el.addEventListener("click", menuClick(i));
      list.appendChild(el);
    }
  }

  function menuClick(i) {
    return function () { menuIdx = i; runMenu(); };
  }

  function runMenu() {
    var opt = menuOpts[menuIdx];
    closeMenu();
    opt.run();
  }

  function closeMenu() {
    mode = "home";
    stage.classList.remove("menu-open");
  }

  function moveItem(dir) {
    var row = model[focusRow];
    if (focusRow === 0 && S.sort === "usage" && row.title === CONFIG.rows[0].title) {
      toast("Sıralama 'En çok kullanılan' modunda. Ayarlardan Manuel'e geç.");
      return;
    }
    var ids = row.items.map(function (it) { return it.id; });
    var i = rows[focusRow].index;
    var j = dir === "first" ? 0 : i + dir;
    var id = ids.splice(i, 1)[0];
    ids.splice(j, 0, id);
    S.order[row.title] = ids;
    save();
    focusId = id;
    renderRows();
  }

  function hideItem() {
    var item = curItem();
    S.hidden.push(item.id);
    save();
    renderRows();
    toast(item.name + " gizlendi. beeOS ayarlarından geri getirebilirsin.");
  }

  function menuKey(k) {
    if (k === 38) { menuIdx = Math.max(0, menuIdx - 1); renderMenu(); Sound.play("move"); }
    else if (k === 40) { menuIdx = Math.min(menuOpts.length - 1, menuIdx + 1); renderMenu(); Sound.play("move"); }
    else if (k === 13) { Sound.play("select"); runMenu(); }
    else if (k === 461 || k === 27 || k === 8 || k === 404 || k === 113) { Sound.play("close"); closeMenu(); }
    else { return false; }
    return true;
  }

  // ---------- ekran klavyesi ----------
  // Kumandayla yazı: oklar tuş seçer, OK yazar. Fiziksel klavye ve telefon kumandası doğrudan yazar
  // (yazarak gelen Enter metni onaylar, kumandanın OK'u seçili tuşa basar).
  var OSK_ROWS = {
    abc: ["1234567890", "qwertyuıopğü", "asdfghjklşi", "zxcvbnmöç.@"],
    sym: ["1234567890", "!#$%&*()?+", "-_=/\\:;'\",", "<>[]{}|~^`"]
  };
  var osk = null, oskEls = [];

  function trUpper(ch) { return ch === "i" ? "İ" : ch === "ı" ? "I" : ch.toUpperCase(); }

  // o: { title, text, secret, max, placeholder, onDone(text), onCancel() }
  function showOsk(o) {
    pressCancel();
    osk = { text: o.text || "", secret: !!o.secret, show: false, placeholder: o.placeholder || "",
            max: o.max || 64, layer: "abc", caps: false, r: 1, c: 0, typed: false,
            onDone: o.onDone, onCancel: o.onCancel, back: mode };
    mode = "osk";
    Sound.play("open");
    $("oskTitle").textContent = o.title;
    renderOskKeys();
    renderOskText();
    stage.classList.add("osk-open");
  }

  function oskLayout() {
    var lines = OSK_ROWS[osk.layer].map(function (line) {
      return line.split("").map(function (ch) {
        var c = osk.layer === "abc" && osk.caps ? trUpper(ch) : ch;
        return { label: c, ch: c };
      });
    });
    var last = [
      { label: "⇧", act: "caps", w: 1, on: osk.caps },
      { label: osk.layer === "abc" ? "?123" : "abc", act: "layer", w: 1.5 },
      { label: "Boşluk", act: "space", w: 4 },
      { label: "⌫", act: "bs", w: 1.5 }
    ];
    if (osk.secret) { last.push({ label: osk.show ? "Gizle" : "Göster", act: "show", w: 1.5 }); }
    last.push({ label: "Tamam", act: "done", w: 2, primary: true });
    lines.push(last);
    return lines;
  }

  function renderOskKeys() {
    var box = $("oskKeys");
    box.innerHTML = "";
    osk.keys = oskLayout();
    oskEls = [];
    for (var r = 0; r < osk.keys.length; r++) {
      var line = div("oline"), els = [];
      for (var c = 0; c < osk.keys[r].length; c++) {
        var k = osk.keys[r][c], w = k.w || 1;
        var el = div("okey" + (k.act ? " act" : "") + (k.primary ? " primary" : "") + (k.on ? " on" : ""), k.label);
        el.style.width = (w * 84 + (w - 1) * 8) + "px";
        el.addEventListener("click", oskClick(r, c));
        line.appendChild(el);
        els.push(el);
      }
      box.appendChild(line);
      oskEls.push(els);
    }
    osk.r = Math.min(osk.r, oskEls.length - 1);
    osk.c = Math.min(osk.c, oskEls[osk.r].length - 1);
    oskEls[osk.r][osk.c].classList.add("sel");
  }

  function renderOskText() {
    var el = $("oskText"), t = osk.text;
    if (!t) { el.textContent = osk.placeholder; el.className = "ph"; return; }
    el.textContent = osk.secret && !osk.show ? new Array(t.length + 1).join("•") : t;
    el.className = "";
  }

  function oskSelect(r, c) {
    oskEls[osk.r][osk.c].classList.remove("sel");
    osk.r = r;
    osk.c = c;
    oskEls[r][c].classList.add("sel");
  }

  function oskClick(r, c) {
    return function () {
      if (!osk) { return; }
      oskSelect(r, c);
      oskPress(osk.keys[r][c]);
    };
  }

  // Yukarı/aşağıda en yakın sütundaki tuşa geçer (satırların tuş sayısı farklı)
  function oskMove(dx, dy) {
    var r = osk.r, c = osk.c;
    osk.typed = false;
    if (dx) {
      c += dx;
      if (c < 0 || c >= oskEls[r].length) { Sound.play("edge"); return; }
    } else {
      r += dy;
      if (r < 0 || r >= oskEls.length) { Sound.play("edge"); return; }
      var cur = oskEls[osk.r][osk.c], x = cur.offsetLeft + cur.offsetWidth / 2, bd = 1e9;
      for (var i = 0; i < oskEls[r].length; i++) {
        var e = oskEls[r][i], d = Math.abs(e.offsetLeft + e.offsetWidth / 2 - x);
        if (d < bd) { bd = d; c = i; }
      }
    }
    oskSelect(r, c);
    Sound.play("move");
  }

  function oskInsert(ch, typed) {
    if (osk.text.length >= osk.max) { Sound.play("edge"); return; }
    osk.text += ch;
    osk.typed = !!typed;
    renderOskText();
  }

  function oskBack() {
    osk.text = osk.text.slice(0, -1);
    renderOskText();
  }

  function oskPress(k) {
    Sound.play("move");
    if (k.ch) {
      oskInsert(k.ch);
      if (osk.caps) { osk.caps = false; renderOskKeys(); }   // büyük harf tek seferlik
    } else if (k.act === "space") { oskInsert(" "); }
    else if (k.act === "bs") { oskBack(); }
    else if (k.act === "caps") { osk.caps = !osk.caps; renderOskKeys(); }
    else if (k.act === "layer") { osk.layer = osk.layer === "abc" ? "sym" : "abc"; renderOskKeys(); }
    else if (k.act === "show") { osk.show = !osk.show; renderOskKeys(); renderOskText(); }
    else if (k.act === "done") { finishOsk(true); }
  }

  function finishOsk(ok) {
    var o = osk;
    osk = null;
    stage.classList.remove("osk-open");
    mode = o.back;
    Sound.play(ok ? "select" : "close");
    if (ok) { o.onDone(o.text); } else if (o.onCancel) { o.onCancel(); }
  }

  function oskKey(k) {
    if (k === 37) { oskMove(-1, 0); }
    else if (k === 39) { oskMove(1, 0); }
    else if (k === 38) { oskMove(0, -1); }
    else if (k === 40) { oskMove(0, 1); }
    else if (k === 13) { if (osk.typed) { finishOsk(true); } else { oskPress(osk.keys[osk.r][osk.c]); } }
    else if (k === 8) { oskBack(); }
    else if (k === 461 || k === 27) { finishOsk(false); }
    else { return false; }
    return true;
  }

  // ---------- arama ----------
  function searchTargets() {
    var tv = Platform.name() === "tv", out = [];
    CONFIG.rows.forEach(function (row) {
      row.items.forEach(function (it) {
        if (!it.search || !availableHere(it) || S.hidden.indexOf(it.id) >= 0) { return; }
        if (tv && !it.tvParam) { return; }
        out.push(it);
      });
    });
    return out;
  }

  function openSearch(initial) {
    var targets = searchTargets();
    if (!targets.length) { toast("Arama yapılabilecek uygulama yok"); return; }
    showOsk({ title: "Ara", text: initial, placeholder: "Film, dizi, şarkı, kanal…", max: 80,
      onDone: function (q) {
        q = trim(q);
        if (!q) { return; }
        var opts = targets.map(function (it) {
          return { label: it.name, run: function () { searchIn(it, q); } };
        });
        opts.push({ label: "Vazgeç", run: function () {} });
        showMenu("“" + q + "” nerede aransın?", opts);
      } });
  }

  function searchIn(item, q) {
    var url = item.search.replace("{q}", encodeURIComponent(q));
    var params = null;
    if (item.tvParam) { params = {}; params[item.tvParam] = url; }
    launch(item, { url: url, params: params });
  }

  // ---------- Launcher ayarları paneli ----------
  var ON_OFF = { values: [true, false], names: ["Açık", "Kapalı"] };
  // group: panelde bu satırdan önce görünen bölüm başlığı. only: "pc" | "tv" (PC dışı her ortam)
  var PANEL = [
    { group: "Genel", label: "Kullanıcı adı", type: "text", max: 24, placeholder: "Adını yaz",
      get: function () { return S.userName; },
      set: function (v) { S.userName = trim(v).slice(0, 24); save(); tick(); } },
    { key: "clock24", label: "Saat biçimi", values: [true, false], names: ["24 saat", "12 saat"] },
    { group: "Bağlantılar", label: "Wi-Fi", type: "action", only: "pc",
      info: function () { return !net ? "" : net.online ? (net.name || "Bağlı") : "Bağlı değil"; },
      run: function () { fromSettingsRow(openWifi); } },
    { label: "Bluetooth", type: "action", only: "pc",
      info: function () { return btSummary(); },
      run: function () { fromSettingsRow(openBt); } },
    { label: "Telefon kumandası", type: "action", only: "pc",
      info: function () { return !remoteInfo ? "" : remoteInfo.enabled ? "Açık" : "Kapalı"; },
      run: function () { fromSettingsRow(openRemote); } },
    { group: "Bağlantılar", label: "Ağ ve Bluetooth", type: "action", only: "tv",
      info: function () { return "TV ayarlarında açılır"; },
      run: function () { closePanel(); launch(findItem("com.palm.app.settings") || TV_SETTINGS); } },
    { group: "Ekran koruyucu", key: "saverMin", label: "Bekleme süresi", values: [0, 5, 10, 30], names: ["Kapalı", "5 dk", "10 dk", "30 dk"] },
    { key: "saverStyle", label: "Stil", only: "pc", values: ["clock", "hive", "flow", "photos"], names: ["Saat", "Petek", "Renk akışı", "Fotoğraflar"] },
    { key: "saverStyle", label: "Stil", only: "tv", values: ["clock", "hive", "flow"], names: ["Saat", "Petek", "Renk akışı"] },
    { label: "Şimdi dene", type: "action", run: function () { closePanel(); showSaver(); } },
    { group: "Erişilebilirlik", key: "textSize", label: "Yazı boyutu", values: ["normal", "large"], names: ["Normal", "Büyük"] },
    { key: "contrast", label: "Yüksek kontrast", values: ON_OFF.values, names: ON_OFF.names },
    { key: "hints", label: "Tuş ipuçları", values: ["auto", "on", "off"], names: ["İlk açılışlarda", "Hep göster", "Gizle"] },
    { group: "Ses", key: "sounds", label: "Ses efektleri", values: ON_OFF.values, names: ON_OFF.names },
    { key: "volume", label: "Efekt ses düzeyi", values: [0.25, 0.5, 0.75, 1], names: ["%25", "%50", "%75", "%100"] },
    { group: "Görünüm", key: "boot", label: "Açılış animasyonu", values: ON_OFF.values, names: ON_OFF.names },
    { key: "animations", label: "Animasyonlar", values: ON_OFF.values, names: ON_OFF.names },
    { key: "ambient", label: "Arka plan ışığı", values: ON_OFF.values, names: ON_OFF.names },
    { key: "heroDesc", label: "Açıklamalar", values: ON_OFF.values, names: ON_OFF.names },
    { group: "Raflar", key: "sort", label: "Uygulama sırası", values: ["manual", "usage"], names: ["Manuel", "En çok kullanılan"] },
    { key: "allApps", label: "Tüm uygulamalar rafı", only: "tv", values: ON_OFF.values, names: ON_OFF.names },
    { group: "Sıfırlama", label: "Gizli kartları geri getir", type: "action",
      info: function () { return S.hidden.length ? S.hidden.length + " gizli" : "Yok"; },
      run: function () {
        if (!S.hidden.length) { return; }
        S.hidden = [];
        save();
        renderRows();
        toast("Gizli kartlar geri geldi");
      } },
    { label: "Özel sıralamayı sıfırla", type: "action", confirm: true,
      run: function () { S.order = {}; save(); renderRows(); toast("Sıralama sıfırlandı"); } },
    { label: "Kullanım geçmişini sıfırla", type: "action", confirm: true,
      run: function () { S.usage = {}; S.lastOpen = {}; save(); renderRows(); toast("Kullanım geçmişi sıfırlandı"); } },
    { label: "Tüm ayarları sıfırla", type: "action", confirm: true, danger: true,
      run: function () { S = Store.reset(); applySettings(); renderRows(); toast("Tüm ayarlar sıfırlandı"); } }
  ];
  // Panel bir "görünüm" gösterir: { head (HTML), sub, foot, rows, back }. Satır tanımları:
  //   { key, values, names }  S[key] değerini döndürür   { type: "text", get, set, next, secret }  ekran klavyesi
  //   { type: "action", run, info, confirm, danger, big } group: satırdan önceki bölüm başlığı
  var panelIdx = 0, confirmIdx = -1, view = null;
  var fromSettings = false;   // Wi-Fi / Bluetooth / kumanda ekranı ayarlardan mı açıldı (Geri ayarlara döner)
  var settingsAt = 0;         // dönüşte ayarlarda seçili olacak satır
  // TV ayarları kartı gizlenmiş olsa da "Ağ ve Bluetooth" satırı açabilsin
  var TV_SETTINGS = { name: "TV Ayarları", id: "com.palm.app.settings", icon: "gear", colors: SYS };

  // Bağlantı ekranları ayarlardan açıldıysa Geri tuşu ayarlar listesine döner
  function withBack(v) {
    if (fromSettings) {
      v.back = function () {
        fromSettings = false;
        showView(settingsView());
        panelIdx = settingsAt;
        renderPanel();
      };
    }
    return v;
  }

  function fromSettingsRow(open) {
    fromSettings = true;
    settingsAt = panelIdx;
    open();
  }

  function settingsView() {
    var pc = Platform.name() === "pc";
    return { head: "<b>bee</b>OS Ayarları", settings: true,
             rows: PANEL.filter(function (o) { return !o.only || (o.only === "pc") === pc; }),
             sub: "Yukarı/aşağı: seç · Sağ/sol veya OK: değiştir · Geri: kapat",
             foot: "beeOS " + VERSION + "  ·  " + (pc
               ? "F1: ayarlar  ·  Home / Windows tuşu: beeOS'a dön"
               : "Kırmızı tuş: ayarlar  ·  OK'a basılı tut: kart menüsü") };
  }

  function openPanel(v) {
    pressCancel();
    if (mode !== "panel") { Sound.play("open"); }
    mode = "panel";
    showView(v || settingsView());
    stage.classList.add("panel-open");
    if (!v && Platform.name() === "pc") {
      // Bağlantılar bölümündeki özet bilgiler (Bluetooth, kumanda) arka planda gelir
      Platform.api("GET", "/api/bt", null, function (res) { if (res) { bt = res; } refreshView("settings", settingsView); });
      Platform.api("GET", "/api/remote", null, function (res) { if (res && res.pin) { remoteInfo = res; } refreshView("settings", settingsView); });
    }
  }

  function showView(v) {
    view = v;
    panelIdx = 0;
    confirmIdx = -1;
    $("panelHead").innerHTML = v.head;
    $("panelSub").textContent = v.sub || "Yukarı/aşağı: seç · OK: seç · Geri: kapat";
    renderPanel();
  }

  function closePanel() {
    Sound.play("close");
    mode = "home";
    view = null;
    fromSettings = false;
    stage.classList.remove("panel-open");
  }

  function renderPanel() {
    var list = $("panelList");
    var selEl = null, defs = view.rows;
    panelIdx = Math.min(panelIdx, defs.length - 1);
    list.innerHTML = "";
    for (var i = 0; i < defs.length; i++) {
      var o = defs[i];
      if (o.group) { list.appendChild(div("pgroup", o.group)); }
      var el = div("prow" + (i === panelIdx ? " sel" : "") + (o.danger ? " danger" : "") + (o.big ? " big" : ""));
      if (i === panelIdx) { selEl = el; }
      el.appendChild(div("plabel", o.label));
      var val = div("pval");
      if (o.type === "text") {
        var v = o.get();
        val.textContent = v ? (o.secret ? new Array(v.length + 1).join("•") : v) : o.placeholder || "";
        if (!v) { val.className = "pval ph"; }
      } else if (o.type === "action") {
        val.textContent = confirmIdx === i ? "Emin misin? Tekrar OK" : (o.info ? o.info() : "");
        if (confirmIdx === i) { val.className = "pval warn"; }
      } else {
        var at = o.values.indexOf(S[o.key]);
        val.textContent = "‹  " + o.names[at < 0 ? 0 : at] + "  ›";
      }
      el.appendChild(val);
      el.addEventListener("mousemove", panelHover(i));
      el.addEventListener("click", panelClick(i));
      list.appendChild(el);
    }
    // Seçili satır görünür kalsın: liste dikeyde kayar
    var viewH = $("panelView").offsetHeight;
    var bottom = selEl.offsetTop + selEl.offsetHeight + 24;
    var off = bottom > viewH ? bottom - viewH : 0;
    if (panelIdx === 0) { off = 0; }
    setTransform(list, "translate3d(0," + (-off) + "px,0)");
    $("panelFoot").textContent = view.foot || "";
  }

  function panelHover(i) {
    return function () { if (panelIdx !== i && mode === "panel") { panelIdx = i; confirmIdx = -1; renderPanel(); } };
  }

  function panelClick(i) {
    return function () {
      if (mode !== "panel") { return; }
      panelIdx = i;
      activate(view.rows[i]);
    };
  }

  function cycle(o, dir) {
    var n = o.values.length;
    var at = o.values.indexOf(S[o.key]);
    S[o.key] = o.values[(at + dir + n) % n];
    save();
    applySettings();
    if (o.key === "sort" || o.key === "allApps") { renderRows(); }
    renderPanel();
    // ses düzeyi değişince yeni seviyeyi duyur
    Sound.play(o.key === "volume" || o.key === "sounds" ? "select" : "move");
  }

  function activate(o) {
    if (o.type === "text") {
      showOsk({ title: o.label, text: o.get(), secret: o.secret, max: o.max, placeholder: o.placeholder,
        onDone: function (v) {
          o.set(v);
          if (o.next) { o.next(); } else { renderPanel(); }
        } });
    } else if (o.values) {
      cycle(o, 1);
    } else if (o.type === "action") {
      if (o.confirm && confirmIdx !== panelIdx) { confirmIdx = panelIdx; renderPanel(); return; }
      confirmIdx = -1;
      o.run();
      if (mode === "panel") { renderPanel(); }
    }
  }

  function panelKey(k) {
    var n = view.rows.length;
    if (k === 38) { panelIdx = Math.max(0, panelIdx - 1); confirmIdx = -1; renderPanel(); Sound.play("move"); }
    else if (k === 40) { panelIdx = Math.min(n - 1, panelIdx + 1); confirmIdx = -1; renderPanel(); Sound.play("move"); }
    else if (k === 37 || k === 39) { if (view.rows[panelIdx].values) { cycle(view.rows[panelIdx], k === 39 ? 1 : -1); } }
    else if (k === 13) { activate(view.rows[panelIdx]); }
    else if (k === 461 || k === 27 || k === 8) { if (view.back) { Sound.play("back"); view.back(); } else { closePanel(); } }
    else if ((k === 403 || k === 112) && !view.back) { closePanel(); }
    else { return false; }
    return true;
  }

  // ---------- PC: Wi-Fi ----------
  var wifi = null, wifiBusy = "";   // son tarama sonucu; "" | "scan" | bağlanılan ağın adı

  function openWifi() {
    openPanel(wifiView());
    scanWifi();
  }

  function wifiView() {
    var defs = [
      { group: "Bağlantı", label: "Durum", type: "action", run: function () {},
        info: function () {
          if (wifiBusy && wifiBusy !== "scan") { return wifiBusy + " · bağlanıyor…"; }
          if (!wifi) { return wifiBusy ? "Kontrol ediliyor…" : "Bilinmiyor"; }
          return wifi.current ? "Bağlı: " + wifi.current : "Bağlı değil";
        } },
      { label: "Ağları yeniden tara", type: "action", run: scanWifi,
        info: function () { return wifiBusy === "scan" ? "Aranıyor…" : ""; } }
    ];
    var nets = (wifi && wifi.networks) || [];
    for (var i = 0; i < nets.length; i++) { defs.push(netRow(nets[i], i === 0 ? "Ağlar" : null)); }
    if (wifi && !nets.length) {
      defs.push({ group: "Ağlar", label: "Ağ bulunamadı", type: "action", run: scanWifi });
    }
    return withBack({ head: "Wi-Fi", wifi: true, rows: defs, sub: "Yukarı/aşağı: seç · OK: bağlan · Geri: kapat",
             foot: "Kayıtlı ağlara şifresiz bağlanılır. Şifreler sadece bu flash diskte saklanır." });
  }

  function netRow(net, group) {
    var tags = [];
    if (wifi.current === net.ssid) { tags.push("Bağlı"); }
    else if (net.known) { tags.push("Kayıtlı"); }
    tags.push(net.secure ? "Şifreli" : "Açık");
    tags.push("%" + net.signal);
    return { group: group, label: net.ssid, type: "action", info: function () { return tags.join(" · "); },
             run: function () {
               if (wifi.current === net.ssid) { toast(net.ssid + " ağına zaten bağlısın"); return; }
               if (net.secure && !net.known) {
                 // şifre ekranı açılır ve klavye hemen gelir
                 showView(passwordView(net));
                 activate(view.rows[0]);
                 return;
               }
               connectWifi(net.ssid, "");
             } };
  }

  function passwordView(net) {
    var pw = "";
    function back() { showView(wifiView()); }
    function go() {
      if (pw.length < 8) { Sound.play("error"); toast("Şifre en az 8 karakter olmalı"); renderPanel(); return; }
      connectWifi(net.ssid, pw);
    }
    return {
      head: net.ssid, back: back, sub: "OK: şifreyi yaz · Geri: ağ listesi",
      foot: "Kumandayla ekran klavyesinden yaz ya da klavyeyle yazıp Enter'a bas.",
      rows: [
        { label: "Şifre", type: "text", secret: true, max: 63, placeholder: "Şifreyi yaz",
          get: function () { return pw; }, set: function (v) { pw = v; }, next: go },
        { label: "Bağlan", type: "action", run: go },
        { label: "Vazgeç", type: "action", run: back }
      ]
    };
  }

  // Panelde açık görünüm hâlâ aynıysa yeni bilgiyle yeniden çiz (seçili satır korunur)
  function refreshView(flag, build) {
    if (mode !== "panel" || !view || !view[flag]) { return; }
    var keep = panelIdx;
    showView(build());
    panelIdx = keep;
    renderPanel();
  }

  function scanWifi() {
    if (wifiBusy) { return; }
    wifiBusy = "scan";
    refreshView("wifi", wifiView);
    Platform.api("GET", "/api/wifi", null, function (res) {
      wifiBusy = "";
      if (res && res.networks) { wifi = res; } else { toast("Wi-Fi bilgisi alınamadı"); }
      refreshView("wifi", wifiView);
    });
  }

  function connectWifi(ssid, password) {
    if (wifiBusy) { toast("Lütfen bekle…"); return; }
    wifiBusy = ssid;
    showView(wifiView());
    Platform.api("POST", "/api/wifi/connect", { ssid: ssid, password: password }, function (res) {
      wifiBusy = "";
      if (res && res.ok) {
        Sound.play("select");
        toast(ssid + " ağına bağlanıldı");
        pollStatus();
      } else {
        Sound.play("error");
        toast("Bağlanılamadı" + (res && res.error ? ": " + res.error : ""));
      }
      scanWifi();
    });
  }

  // ---------- PC: telefon kumandası ----------
  var remoteInfo = null;

  function openRemote() {
    openPanel(remoteView());
    loadRemote(null);
  }

  function loadRemote(body) {
    Platform.api(body ? "POST" : "GET", "/api/remote", body, function (res) {
      if (res && res.pin) { remoteInfo = res; } else { toast("Kumanda bilgisi alınamadı"); }
      refreshView("remote", remoteView);
    });
  }

  function remoteView() {
    var r = remoteInfo;
    function noop() {}
    return withBack({
      head: "Telefon kumandası", remote: true,
      sub: "Telefonda adresi aç, PIN'i gir. Telefon aynı ağda olmalı.",
      foot: "Telefondaki yazı alanında klavyenin mikrofonuyla sesle arama yapabilirsin.",
      rows: [
        { group: "Bağlantı", label: "Telefon kumandası", type: "action",
          info: function () { return !r ? "…" : r.enabled ? "Açık" : "Kapalı"; },
          run: function () { if (r) { loadRemote({ enabled: !r.enabled }); } } },
        { label: "Adres", type: "action", run: noop, big: true,
          info: function () { return !r ? "…" : r.urls.length ? r.urls[0].replace("http://", "") : "Ağ bağlantısı yok"; } },
        { label: "PIN", type: "action", run: noop, big: true,
          info: function () { return r ? r.pin.replace(/^(\d{3})(\d{3})$/, "$1 $2") : "…"; } },
        { group: "Güvenlik", label: "Yeni PIN üret", type: "action", confirm: true,
          info: function () { return "Telefonlar yeniden PIN ister"; },
          run: function () { loadRemote({ newPin: true }); } }
      ]
    });
  }

  // ---------- PC: Bluetooth ----------
  var bt = null, btBusy = "";   // son durum; "" | "scan" | "power" | işlem yapılan cihazın adresi

  function btSummary() {
    if (!bt) { return ""; }
    if (!bt.ok) { return "Bulunamadı"; }
    if (!bt.powered) { return "Kapalı"; }
    var n = bt.devices.filter(function (d) { return d.connected; }).length;
    return n ? n + " cihaz bağlı" : "Açık";
  }

  function openBt() {
    openPanel(btView());
    loadBt("GET", "/api/bt", null);
  }

  // Bluetooth çağrısı; bitince durum yenilenir ve ekran açıksa yeniden çizilir
  function loadBt(method, path, body, busy, done) {
    btBusy = busy || "";
    refreshView("bt", btView);
    Platform.api(method, path, body, function (res) {
      btBusy = "";
      if (res && res.devices) { bt = res; }
      if (!res || res.ok === false) {
        if (!bt) { bt = { ok: false, powered: false, devices: [] }; }   // ekran "Kontrol ediliyor"da kalmasın
        if (method === "POST" || !res) { Sound.play("error"); toast((res && res.error) || "Bluetooth bilgisi alınamadı"); }
      }
      if (done && res && res.ok !== false) { done(); }
      refreshView("bt", btView);
    });
  }

  function btView() {
    var defs = [
      { group: "Bluetooth", label: "Bluetooth", type: "action",
        info: function () { return btBusy === "power" ? "…" : !bt ? "Kontrol ediliyor…" : !bt.ok ? "Bulunamadı" : bt.powered ? "Açık" : "Kapalı"; },
        run: function () { if (bt && bt.ok && !btBusy) { loadBt("POST", "/api/bt/power", { on: !bt.powered }, "power"); } } }
    ];
    if (bt && bt.powered) {
      defs.push({ label: "Yeni cihaz ara", type: "action",
        info: function () { return btBusy === "scan" ? "Aranıyor… (10 sn)" : "Kulaklık, hoparlör, klavye, oyun kolu"; },
        run: function () { if (!btBusy) { loadBt("POST", "/api/bt/scan", null, "scan"); } } });
      var paired = bt.devices.filter(function (d) { return d.paired; });
      var near = bt.devices.filter(function (d) { return !d.paired; });
      for (var i = 0; i < paired.length; i++) { defs.push(btRow(paired[i], i === 0 ? "Eşleşmiş cihazlar" : null)); }
      for (var j = 0; j < near.length; j++) { defs.push(btRow(near[j], j === 0 ? "Yakındaki cihazlar" : null)); }
    }
    return withBack({ head: "Bluetooth", bt: true, rows: defs, sub: "Yukarı/aşağı: seç · OK: bağlan · Geri: kapat",
             foot: "Eşleştirmek için cihazı eşleşme moduna al, sonra \"Yeni cihaz ara\". Şifre isteyen cihazlar desteklenmez." });
  }

  function btRow(d, group) {
    return { group: group, label: d.name, type: "action",
      info: function () {
        if (btBusy === d.mac) { return d.paired ? "Bağlanıyor…" : "Eşleştiriliyor…"; }
        return !d.paired ? "Eşleştir" : d.connected ? "Bağlı" : "Bağlı değil";
      },
      run: function () {
        if (btBusy) { toast("Lütfen bekle…"); return; }
        if (d.paired) { showView(btDeviceView(d)); return; }
        loadBt("POST", "/api/bt/connect", { mac: d.mac }, d.mac, function () { Sound.play("select"); toast(d.name + " bağlandı"); });
      } };
  }

  function btDeviceView(d) {
    function back() { showView(btView()); }
    return {
      head: d.name, back: back, sub: "OK: seç · Geri: cihaz listesi", foot: d.mac,
      rows: [
        { label: d.connected ? "Bağlantıyı kes" : "Bağlan", type: "action",
          run: function () {
            back();
            loadBt("POST", d.connected ? "/api/bt/disconnect" : "/api/bt/connect", { mac: d.mac }, d.mac,
                   function () { toast(d.name + (d.connected ? " bağlantısı kesildi" : " bağlandı")); });
          } },
        { label: "Cihazı unut", type: "action", confirm: true, danger: true,
          run: function () {
            back();
            loadBt("POST", "/api/bt/remove", { mac: d.mac }, d.mac, function () { toast(d.name + " unutuldu"); });
          } },
        { label: "Vazgeç", type: "action", run: back }
      ]
    };
  }

  // ---------- bildirimler: bağlantı durumu, telefon eşleşmesi ----------
  var net = null, remoteSeq = -1;

  function setNet(online, name) {
    var was = net;
    net = { online: online, name: name || "" };
    $("status").className = online ? "on" : "off";
    $("status").firstChild.innerHTML = ICONS.wifi;
    $("statusText").textContent = online ? (name || "Bağlı") : "İnternet yok";
    if (was && was.online !== online) {
      Sound.play(online ? "select" : "error");
      toast(online ? "İnternete bağlanıldı"
                   : "İnternet bağlantısı koptu" + (Platform.name() === "pc" ? ". Wi-Fi kartından ağ seçebilirsin." : ""));
    }
  }

  function pollStatus() {
    var p = Platform.name();
    if (p === "pc") {
      Platform.api("GET", "/api/status", null, function (res) {
        if (!res || typeof res.online !== "boolean") { return; }
        setNet(res.online, res.name);
        if (remoteSeq >= 0 && res.remoteSeq > remoteSeq) { Sound.play("open"); toast("Telefon kumandası bağlandı"); }
        remoteSeq = res.remoteSeq || 0;
      });
    } else if (p === "tv") {
      luna("luna://com.palm.connectionmanager/getStatus", {}, function (res) {
        if (res && res.returnValue !== false) {
          setNet(res.isInternetConnectionAvailable === true, res.wifi && res.wifi.ssid);
        }
      });
    } else {
      setNet(navigator.onLine !== false, "");
    }
  }

  function applySettings() {
    Sound.set(S.sounds, S.volume);
    setCls(stage, "lite", !S.animations);
    setCls(stage, "no-ambient", !S.ambient);
    setCls(stage, "no-desc", !S.heroDesc);
    setCls(stage, "big", S.textSize === "large");
    setCls(stage, "hc", S.contrast);
    setCls(stage, "no-hint", !(S.hints === "on" || (S.hints === "auto" && S.hintRuns <= 5)));
    if (S.ambient && rows.length) { lastAmbient = ""; setAmbient(curItem().colors[0]); }
    tick();
    resetIdle();
  }

  // ---------- ekran koruyucu (OLED/panel izi önleme) ----------
  // Stiller: saat, petek (süzülen altıgenler), renk akışı, fotoğraflar (PC: flash diskteki klasör)
  var saverTimer = null, saverFlip = 0, hiveBuilt = false;

  function resetIdle() {
    clearTimeout(idleTimer);
    if (S.saverMin > 0) { idleTimer = setTimeout(showSaver, S.saverMin * 60000); }
  }

  function showSaver() {
    if (mode !== "home") { resetIdle(); return; }
    mode = "saver";
    var style = S.saverStyle;
    if (style === "photos" && Platform.name() !== "pc") { style = "flow"; }
    $("saverNote").textContent = "";
    $("saver").className = "st-" + style;
    stage.classList.add("saver-on");
    moveSaver();
    saverMove = setInterval(moveSaver, 30000);
    if (style === "hive") { buildHive(); }
    if (style === "flow") { startFlow(); }
    if (style === "photos") { startPhotos(); }
  }

  function moveSaver() {
    var x = 120 + Math.round(Math.random() * 1150);
    var y = 80 + Math.round(Math.random() * 720);
    setTransform($("saverInner"), "translate3d(" + x + "px," + y + "px,0)");
  }

  function hideSaver() {
    mode = "home";
    stage.classList.remove("saver-on");
    clearInterval(saverMove);
    clearInterval(saverTimer);
    $("saverFlowA").className = $("saverFlowB").className = "flow-layer";
    $("saverPhotoA").className = $("saverPhotoB").className = "photo-layer";
    resetIdle();
  }

  function buildHive() {
    if (hiveBuilt) { return; }
    hiveBuilt = true;
    var html = "";
    for (var i = 0; i < 22; i++) {
      var s = 60 + Math.round(Math.random() * 170);
      var x = Math.round(Math.random() * STAGE_W - s / 2), y = Math.round(Math.random() * STAGE_H - s / 2);
      var dur = 24 + Math.round(Math.random() * 30), delay = -Math.round(Math.random() * dur);
      var anim = "animation-duration:" + dur + "s;animation-delay:" + delay + "s;";
      html += '<div class="hv' + (Math.random() < 0.25 ? " f" : "") + '" style="left:' + x + "px;top:" + y +
              "px;width:" + s + "px;height:" + Math.round(s * 1.15) + "px;-webkit-" + anim + anim + '">' +
              '<svg viewBox="0 0 80 92" width="100%" height="100%"><polygon points="40,3 77,24.5 77,67.5 40,89 3,67.5 3,24.5"/></svg></div>';
    }
    $("saverHive").innerHTML = html;
  }

  function startFlow() {
    var i = Math.floor(Math.random() * PALETTE.length);
    function step() {
      var el = $(saverFlip ? "saverFlowA" : "saverFlowB"), other = $(saverFlip ? "saverFlowB" : "saverFlowA");
      var x = 20 + Math.round(Math.random() * 60), y = 20 + Math.round(Math.random() * 60);
      el.style.background = "radial-gradient(ellipse 1400px 900px at " + x + "% " + y + "%, " +
                            hexToRgba(PALETTE[i++ % PALETTE.length][0], 0.5) + ", rgba(0,0,0,0) 70%)";
      el.className = "flow-layer on";
      other.className = "flow-layer";
      saverFlip = 1 - saverFlip;
    }
    step();
    saverTimer = setInterval(step, 9000);
  }

  function startPhotos() {
    Platform.api("GET", "/api/photos", null, function (res) {
      if (mode !== "saver") { return; }
      var list = (res && res.photos) || [];
      if (!list.length) {
        $("saver").className = "st-flow";
        $("saverNote").textContent = "Fotoğraf bulunamadı. Flash diskin BEEOS-LOG bölümündeki Fotograflar klasörüne fotoğraf koy.";
        startFlow();
        return;
      }
      var i = Math.floor(Math.random() * list.length);
      function step() {
        var img = $(saverFlip ? "saverPhotoA" : "saverPhotoB"), other = $(saverFlip ? "saverPhotoB" : "saverPhotoA");
        img.className = "photo-layer";
        img.onload = function () {
          img.getBoundingClientRect();   // stil yeniden hesaplansın: yakınlaşma baştan başlar
          img.className = "photo-layer on";
          other.className = other.className.indexOf("on") >= 0 ? "photo-layer out" : "photo-layer";
        };
        img.src = list[i++ % list.length];
        saverFlip = 1 - saverFlip;
      }
      step();
      saverTimer = setInterval(step, 15000);
    });
  }

  // ---------- yüklü uygulamalar (sadece TV'de) ----------
  function loadInstalled() {
    var known = {};
    CONFIG.rows.forEach(function (row) { row.items.forEach(function (it) { known[it.id] = true; }); });

    function apply(apps) {
      apps.forEach(function (a) {
        var ic = a.largeIcon || a.icon;
        if (ic) { tvIcons[a.id] = ic; }
      });
      installed = sortBy(apps.filter(function (a) {
        return a.visible !== false && !known[a.id] && a.id !== APP_ID;
      }), function () { return 0; }).sort(function (a, b) {
        return (a.title || "").localeCompare(b.title || "");
      }).map(function (a, i) {
        return { name: a.title || a.id, cat: "Uygulama", sub: "", icon: "play", id: a.id,
                 colors: PALETTE[i % PALETTE.length], desc: "Yüklü uygulama." };
      });
      renderRows();
    }

    function fail() {
      if (installed === "loading") { installed = null; renderRows(); }
    }

    var mock = Platform.name() === "web" && /[?&]mock/.test(location.search);
    if (Platform.name() !== "tv" && !mock) { return; }
    installed = "loading";          // iskelet kartlar görünür
    renderRows();
    var giveUp = setTimeout(fail, 6000);

    if (mock) {
      // Tarayıcı testi: ?mock ile gecikmeli örnek liste
      setTimeout(function () {
        clearTimeout(giveUp);
        apply([{ id: "demo.news", title: "Haberler" }, { id: "demo.weather", title: "Hava Durumu" },
               { id: "demo.music", title: "Radyo" }, { id: "demo.games", title: "Oyunlar" },
               { id: "demo.photos", title: "Fotoğraflar" }]);
      }, 2200);
      return;
    }
    luna("luna://com.webos.applicationManager/listApps", {}, function (res) {
      clearTimeout(giveUp);
      if (res && res.apps) { apply(res.apps); } else { fail(); }
    });
  }

  // ---------- tuşlar ----------
  function homeKey(k) {
    if (k === 37) { move(-1, 0); }
    else if (k === 39) { move(1, 0); }
    else if (k === 38) { move(0, -1); }
    else if (k === 40) { move(0, 1); }
    else if (k === 13) { pressStart(); }
    else if (k === 461 || k === 27 || k === 8) { setFocus(0, 0); Sound.play("back"); }   // Geri: başa dön
    else if (k === 403 || k === 112) { openPanel(); }                // Kırmızı / F1
    else if (k === 404 || k === 113) { openMenu(); }                 // Yeşil / F2
    else if (k >= 49 && k <= 57) {                                   // 1-9: ilk raftaki uygulama
      var it = model[0].items[k - 49];
      if (it) { launch(it); }
    }
    else { return false; }
    return true;
  }

  function onKeyDown(e) {
    var k = e.keyCode;
    resetIdle();
    Sound.unlock();
    if (mode === "boot") { finishBoot(); e.preventDefault(); return; }       // tuş açılışı atlar
    if (mode === "loading") {
      if (k === 461 || k === 27 || k === 8) { cancelLaunch(); }
      e.preventDefault();
      return;
    }
    if (mode === "saver") { hideSaver(); e.preventDefault(); return; }
    var handled = mode === "osk" ? oskKey(k) : mode === "panel" ? panelKey(k) : mode === "menu" ? menuKey(k) : homeKey(k);
    if (handled) { e.preventDefault(); }
  }

  // Yazı tuşları: ekran klavyesi açıksa yazar; ana ekranda harfe basmak aramayı başlatır
  var SEARCH_CHAR = /[a-zA-ZçğıöşüÇĞİÖŞÜ]/;
  function onKeyPress(e) {
    var code = e.charCode || e.keyCode;
    if (!code || code < 32) { return; }
    var ch = String.fromCharCode(code);
    if (mode === "osk") { oskInsert(ch, true); e.preventDefault(); }
    else if (mode === "home" && !pressing && SEARCH_CHAR.test(ch)) { openSearch(ch); e.preventDefault(); }
  }

  function onKeyUp(e) {
    if (e.keyCode !== 13) { return; }
    if (mode === "home") { pressEnd(); } else { pressCancel(); }
  }

  // ---------- saat ----------
  function tick() {
    var d = new Date();
    var h = d.getHours();
    var time = fmtTime(d);
    var date = DAYS[d.getDay()] + ", " + d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear();
    if ($("time").textContent !== time) {
      $("time").textContent = time;
      $("saverTime").textContent = time;
    }
    $("date").textContent = date;
    $("saverDate").textContent = date;
    var hello = h < 6 ? "İyi geceler" : h < 12 ? "Günaydın" : h < 18 ? "İyi günler" : "İyi akşamlar";
    $("greeting").textContent = hello + (S.userName ? ", " + S.userName : "");
  }

  // ---------- başlat ----------
  fitStage();
  window.addEventListener("resize", fitStage);
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keypress", onKeyPress);
  document.addEventListener("keyup", onKeyUp);
  document.addEventListener("mouseup", function () {
    if (mode === "home") { pressEnd(); } else { pressCancel(); }
  });
  document.addEventListener("mousemove", function () {
    if (mode === "saver") { hideSaver(); } else { resetIdle(); }
  });
  document.addEventListener("mousedown", function () {
    Sound.unlock();
    if (mode === "boot") { finishBoot(); }
  });
  $("dim").addEventListener("click", function () {
    if (mode === "osk") { finishOsk(false); }
    else if (mode === "panel") { closePanel(); }
    else if (mode === "menu") { closeMenu(); }
  });
  window.addEventListener("online", pollStatus);
  window.addEventListener("offline", pollStatus);
  // Başka uygulama öne gelince sayfa gizlenir: yükleme ekranını kapat. Geri dönünce durumu yenile.
  function onVisibility(hidden) {
    if (hidden) {
      // Gizliyken solma animasyonu ilerlemez; dönüşte yükleme ekranı hayalet gibi görünmesin
      $("loader").style.webkitTransition = $("loader").style.transition = "none";
      hideLoader();
      launching = null;
      return;
    }
    refreshOpen();
    pollStatus();
  }
  document.addEventListener("visibilitychange", function () { onVisibility(document.hidden); });
  document.addEventListener("webkitvisibilitychange", function () { onVisibility(document.webkitHidden); });

  // ---------- açılış ----------
  // boot: petek hücreleri sırayla belirir, ortadaki hücrede arı konar, "beeOS" yazısı gelir,
  // sonra arayüz satır satır açılır. Herhangi bir tuş atlar.
  function startBoot() {
    if (!S.boot) { finishBoot(); return; }
    mode = "boot";
    stage.classList.add("booting");
    setTimeout(function () {
      stage.classList.add("boot-go");
      Sound.play("boot");
    }, 60);
    bootTimer = setTimeout(finishBoot, 2400);
  }

  function finishBoot() {
    clearTimeout(bootTimer);
    if (mode === "boot") { mode = "home"; }
    stage.classList.remove("booting");
    // bir sonraki karede raflar giriş animasyonuna başlar
    setTimeout(function () { stage.classList.add("ready"); }, 50);
  }

  // PC'de alttaki ipucu satırı farklı tuşları anlatır
  function pcHint() {
    $("hint").innerHTML =
      '<span class="key">Enter</span><span class="lbl">Aç</span>' +
      '<span class="key">Enter basılı</span><span class="lbl">Düzenle</span>' +
      '<span class="key">F1</span><span class="lbl">Ayarlar</span>' +
      '<span class="key">A-Z</span><span class="lbl">Yazarak ara</span>' +
      '<span class="key">Home</span><span class="lbl">beeOS\'a dön</span>';
  }

  // "İlk açılışlarda" ipuçları birkaç açılıştan sonra kendiliğinden gizlenir
  if (S.hintRuns < 99) { S.hintRuns++; save(); }
  focusId = lastOpenedId();     // odak en son açılan uygulamada başlar
  renderRows();
  applySettings();
  startBoot();
  // Ortam belli olunca (PC arka ucu cevap verirse) raflar o ortama göre yeniden çizilir
  Platform.detect(function () {
    if (Platform.name() === "pc") { pcHint(); renderRows(); refreshOpen(); }
    loadInstalled();
    pollStatus();
    setInterval(pollStatus, 20000);
  });
  setInterval(tick, 15000);

  // Hata ayıklama için (ares-inspect konsolundan): __launcher.openPanel() vb.
  window.__launcher = { openPanel: openPanel, showSaver: showSaver, openSearch: openSearch,
                        settings: function () { return S; } };
})();
