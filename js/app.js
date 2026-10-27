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

  function $(id) { return document.getElementById(id); }
  var stage = $("stage"), rowsEl = $("rows"), heroEl = $("hero"), toastEl = $("toast");
  var layers = [$("ambA"), $("ambB")];

  var S = Store.load();
  var model = [];          // ayarlara göre sıralanmış/filtrelenmiş raflar
  var rows = [];           // { el, track, cards[], index, cardW }
  var focusRow = 0;
  var focusId = null;      // yeniden çizimden sonra odaklanacak kart
  var mode = "home";       // home | panel | menu | input | saver
  var installed = null;    // TV'den gelen yüklü uygulamalar (rafa eklenenler)
  var tvIcons = {};        // { uygulamaId: TV'deki gerçek ikon yolu }
  var missingImg = {};     // yüklenemeyen görseller: tekrar denenmez

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
      rowsEl.appendChild(rowEl);
      rows.push({ el: rowEl, track: track, cards: cards, index: 0, cardW: CARD_W[def.size] });
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
      putLogo(hi, item, function (s) {
        setCls(hi, "logo", s === "img");
        setCls(hi, "brand", s === "brand");
      });
      heroEl.classList.remove("out");
    }, 140);
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

  function launch(item) {
    if (item.skeleton) { Sound.play("edge"); return; }
    S.usage[item.id] = (S.usage[item.id] || 0) + 1;
    save();
    if (item.id === "@settings") { openPanel(); return; }
    if (item.id === "@wifi") { openWifi(); return; }
    if (item.id === "@power") { openPower(); return; }
    Sound.play("select");
    showLoader(item);
    if (Platform.name() === "pc") {
      Platform.api("POST", "/api/launch", { id: item.id, url: item.web, ua: item.ua || "" }, function (res) {
        if (!res || !res.ok) { launchFailed(item, res && res.error); return; }
        if (Platform.mock()) { hideLoader(); toast("Test: " + item.name + " → " + item.web); }
      });
      return;
    }
    if (Platform.name() !== "tv") {
      // Tarayıcı testi: yükleme ekranını kısa süre göster
      loadTimer = setTimeout(function () {
        hideLoader();
        toast("Test: " + item.name + " (" + item.id + ")");
      }, 1400);
      return;
    }
    luna("luna://com.webos.service.applicationmanager/launch", { id: item.id }, function (res) {
      if (!res || res.returnValue === false) { launchFailed(item, res && res.errorText); }
    });
  }

  function launchFailed(item, why) {
    hideLoader();
    Sound.play("error");
    toast(item.name + " açılamadı" + (why ? ": " + why : ""));
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
    stage.classList.add("loading-on");
    clearTimeout(loadTimer);
    // Uygulama öne gelince sayfa gizlenir (visibilitychange). Gelmezse 8 sn sonra kapat.
    loadTimer = setTimeout(hideLoader, 8000);
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

  // ---------- Launcher ayarları paneli ----------
  var ON_OFF = { values: [true, false], names: ["Açık", "Kapalı"] };
  // group: panelde bu satırdan önce görünen bölüm başlığı
  var PANEL = [
    { group: "Genel", label: "Kullanıcı adı", type: "text", max: 24, placeholder: "Adını yaz",
      get: function () { return S.userName; },
      set: function (v) { S.userName = v.replace(/^\s+|\s+$/g, "").slice(0, 24); save(); tick(); } },
    { key: "clock24", label: "Saat biçimi", values: [true, false], names: ["24 saat", "12 saat"] },
    { key: "saverMin", label: "Ekran koruyucu", values: [0, 5, 10, 30], names: ["Kapalı", "5 dk", "10 dk", "30 dk"] },
    { group: "Ses", key: "sounds", label: "Ses efektleri", values: ON_OFF.values, names: ON_OFF.names },
    { key: "volume", label: "Efekt ses düzeyi", values: [0.25, 0.5, 0.75, 1], names: ["%25", "%50", "%75", "%100"] },
    { group: "Görünüm", key: "boot", label: "Açılış animasyonu", values: ON_OFF.values, names: ON_OFF.names },
    { key: "animations", label: "Animasyonlar", values: ON_OFF.values, names: ON_OFF.names },
    { key: "ambient", label: "Arka plan ışığı", values: ON_OFF.values, names: ON_OFF.names },
    { key: "heroDesc", label: "Açıklamalar", values: ON_OFF.values, names: ON_OFF.names },
    { group: "Raflar", key: "sort", label: "Uygulama sırası", values: ["manual", "usage"], names: ["Manuel", "En çok kullanılan"] },
    { key: "allApps", label: "Tüm uygulamalar rafı", values: ON_OFF.values, names: ON_OFF.names },
    { group: "Sıfırlama", label: "Gizli kartları geri getir", type: "action",
      info: function () { return S.hidden.length ? S.hidden.length + " gizli" : "Yok"; },
      run: function () {
        if (!S.hidden.length) { return; }
        S.hidden = [];
        save();
        renderRows();
        toast("Gizli kartlar geri geldi");
      } },
    { label: "Özel sıralamayı sıfırla", type: "action",
      run: function () { S.order = {}; save(); renderRows(); toast("Sıralama sıfırlandı"); } },
    { label: "Kullanım istatistiğini sıfırla", type: "action",
      run: function () { S.usage = {}; save(); renderRows(); toast("İstatistik sıfırlandı"); } },
    { label: "Tüm ayarları sıfırla", type: "action", confirm: true, danger: true,
      run: function () { S = Store.reset(); applySettings(); renderRows(); toast("Tüm ayarlar sıfırlandı"); } }
  ];
  // Panel bir "görünüm" gösterir: { head (HTML), sub, foot, rows, back }. Satır tanımları:
  //   { key, values, names }  S[key] değerini döndürür   { type: "text", get, set, next }  yazı kutusu
  //   { type: "action", run, info, confirm, danger }      group: satırdan önceki bölüm başlığı
  var panelIdx = 0, confirmIdx = -1, view = null;
  var textInput = document.createElement("input");
  textInput.id = "nameInput";
  textInput.type = "text";
  textInput.addEventListener("focus", function () { mode = "input"; });
  textInput.addEventListener("blur", function () { if (mode === "input") { commitText(true); } });

  function settingsView() {
    var pc = Platform.name() === "pc";
    return { head: "<b>bee</b>OS Ayarları",
             rows: PANEL.filter(function (o) { return !(pc && o.key === "allApps"); }),
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
      var el = div("prow" + (i === panelIdx ? " sel" : "") + (o.danger ? " danger" : ""));
      if (i === panelIdx) { selEl = el; }
      el.appendChild(div("plabel", o.label));
      var val = div("pval");
      if (o.type === "text") {
        textInput.type = o.secret ? "password" : "text";
        textInput.maxLength = o.max || 64;
        textInput.placeholder = o.placeholder || "";
        textInput.value = o.get();
        val.appendChild(textInput);
      } else if (o.type === "action") {
        val.textContent = confirmIdx === i ? "Emin misin? Tekrar OK" : (o.info ? o.info() : "");
        if (confirmIdx === i) { val.className = "pval warn"; }
      } else {
        val.textContent = "‹  " + o.names[o.values.indexOf(S[o.key])] + "  ›";
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
    return function (e) {
      if (e.target === textInput) { return; }
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
      textInput.focus();       // TV'de ekran klavyesi açılır
    } else if (o.values) {
      cycle(o, 1);
    } else if (o.type === "action") {
      if (o.confirm && confirmIdx !== panelIdx) { confirmIdx = panelIdx; renderPanel(); return; }
      confirmIdx = -1;
      o.run();
      if (mode === "panel") { renderPanel(); }
    }
  }

  // keep: yazılanı kaydet. Enter ile bitince satırın next() işlevi çalışır (örn. Wi-Fi'ye bağlan).
  function commitText(keep, viaEnter) {
    var o = view && view.rows[panelIdx];
    mode = "panel";
    if (keep && o && o.type === "text") { o.set(textInput.value); }
    textInput.blur();
    if (!view) { return; }
    if (viaEnter && o && o.next) { o.next(); return; }
    renderPanel();
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
    return { head: "Wi-Fi", wifi: true, rows: defs, sub: "Yukarı/aşağı: seç · OK: bağlan · Geri: kapat",
             foot: "Kayıtlı ağlara şifresiz bağlanılır. Şifreler sadece bu flash diskte saklanır." };
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
               if (net.secure && !net.known) { showView(passwordView(net)); return; }
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
      head: net.ssid, back: back, sub: "OK: şifreyi yaz · Enter: bağlan · Geri: ağ listesi",
      foot: "Şifreyi klavyeyle yaz, sonra Enter'a bas.",
      rows: [
        { label: "Şifre", type: "text", secret: true, max: 63, placeholder: "Şifreyi yaz",
          get: function () { return pw; }, set: function (v) { pw = v; }, next: go },
        { label: "Bağlan", type: "action", run: go },
        { label: "Vazgeç", type: "action", run: back }
      ]
    };
  }

  // Wi-Fi ekranı hâlâ açıksa yeni bilgiyle yeniden çiz (seçili satır korunur)
  function refreshWifiView() {
    if (mode !== "panel" || !view || !view.wifi) { return; }
    var keep = panelIdx;
    showView(wifiView());
    panelIdx = keep;
    renderPanel();
  }

  function scanWifi() {
    if (wifiBusy) { return; }
    wifiBusy = "scan";
    refreshWifiView();
    Platform.api("GET", "/api/wifi", null, function (res) {
      wifiBusy = "";
      if (res && res.networks) { wifi = res; } else { toast("Wi-Fi bilgisi alınamadı"); }
      refreshWifiView();
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
      } else {
        Sound.play("error");
        toast("Bağlanılamadı" + (res && res.error ? ": " + res.error : ""));
      }
      scanWifi();
    });
  }

  function applySettings() {
    Sound.set(S.sounds, S.volume);
    setCls(stage, "lite", !S.animations);
    setCls(stage, "no-ambient", !S.ambient);
    setCls(stage, "no-desc", !S.heroDesc);
    if (S.ambient && rows.length) { lastAmbient = ""; setAmbient(curItem().colors[0]); }
    tick();
    resetIdle();
  }

  // ---------- ekran koruyucu (OLED/panel izi önleme) ----------
  function resetIdle() {
    clearTimeout(idleTimer);
    if (S.saverMin > 0) { idleTimer = setTimeout(showSaver, S.saverMin * 60000); }
  }

  function showSaver() {
    if (mode !== "home") { resetIdle(); return; }
    mode = "saver";
    stage.classList.add("saver-on");
    moveSaver();
    saverMove = setInterval(moveSaver, 30000);
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
    resetIdle();
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
      if (k === 461 || k === 27 || k === 8) { hideLoader(); Sound.play("back"); }
      e.preventDefault();
      return;
    }
    if (mode === "saver") { hideSaver(); e.preventDefault(); return; }
    if (mode === "input") {
      if (k === 13) { commitText(true, true); }
      else if (k === 461 || k === 27) { commitText(false); }
      else { return; }               // diğer tuşlar yazıya gitsin
      e.preventDefault();
      return;
    }
    var handled = mode === "panel" ? panelKey(k) : mode === "menu" ? menuKey(k) : homeKey(k);
    if (handled) { e.preventDefault(); }
  }

  function onKeyUp(e) {
    if (e.keyCode !== 13) { return; }
    if (mode === "home") { pressEnd(); } else { pressCancel(); }
  }

  // ---------- saat ----------
  var DAYS = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
  var MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz",
                "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

  function pad(n) { return n < 10 ? "0" + n : "" + n; }

  function tick() {
    var d = new Date();
    var h = d.getHours();
    var time = S.clock24
      ? pad(h) + ":" + pad(d.getMinutes())
      : (h % 12 || 12) + ":" + pad(d.getMinutes()) + (h < 12 ? " ÖÖ" : " ÖS");
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
    if (mode === "panel") { closePanel(); } else if (mode === "menu") { closeMenu(); }
  });
  // Başka uygulama öne gelince sayfa gizlenir: yükleme ekranını kapat
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) { hideLoader(); }
  });
  document.addEventListener("webkitvisibilitychange", function () {
    if (document.webkitHidden) { hideLoader(); }
  });

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
      '<span class="key">Home</span><span class="lbl">Uygulamadan beeOS\'a dön</span>';
  }

  renderRows();
  applySettings();
  startBoot();
  // Ortam belli olunca (PC arka ucu cevap verirse) raflar o ortama göre yeniden çizilir
  Platform.detect(function () {
    if (Platform.name() === "pc") { pcHint(); renderRows(); }
    loadInstalled();
  });
  setInterval(tick, 15000);

  // Hata ayıklama için (ares-inspect konsolundan): __launcher.openPanel() vb.
  window.__launcher = { openPanel: openPanel, showSaver: showSaver, settings: function () { return S; } };
})();
