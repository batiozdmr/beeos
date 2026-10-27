// ES5 yazıldı: eski webOS (Chromium 38) uyumlu.
(function () {
  var APP_ID = "com.ozdem.beeos";
  var VERSION = "0.3.0";
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
  function computeModel() {
    var defs = CONFIG.rows.slice();
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
    Sound.play("select");
    showLoader(item);
    if (typeof PalmServiceBridge === "undefined") {
      // Tarayıcı testi: yükleme ekranını kısa süre göster
      loadTimer = setTimeout(function () {
        hideLoader();
        toast("Test: " + item.name + " (" + item.id + ")");
      }, 1400);
      return;
    }
    luna("luna://com.webos.service.applicationmanager/launch", { id: item.id }, function (res) {
      if (!res || res.returnValue === false) {
        hideLoader();
        Sound.play("error");
        toast(item.name + " açılamadı" + (res && res.errorText ? ": " + res.errorText : ""));
      }
    });
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
    Sound.play("open");
    menuOpts = [];
    if (i > 0) { menuOpts.push({ label: "Sola taşı", run: function () { moveItem(-1); } }); }
    if (i < n - 1) { menuOpts.push({ label: "Sağa taşı", run: function () { moveItem(1); } }); }
    if (i > 0) { menuOpts.push({ label: "Başa taşı", run: function () { moveItem("first"); } }); }
    if (item.id !== "@settings") { menuOpts.push({ label: "Gizle", run: hideItem }); }
    menuOpts.push({ label: "Kapat", run: function () {} });
    menuIdx = 0;
    $("menuTitle").textContent = item.name;
    renderMenu();
    mode = "menu";
    stage.classList.add("menu-open");
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
    { group: "Genel", key: "userName", label: "Kullanıcı adı", type: "text" },
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
  var panelIdx = 0, confirmIdx = -1;
  var nameInput = document.createElement("input");
  nameInput.id = "nameInput";
  nameInput.type = "text";
  nameInput.maxLength = 24;
  nameInput.placeholder = "Adını yaz";
  nameInput.addEventListener("focus", function () { mode = "input"; });
  nameInput.addEventListener("blur", function () { if (mode === "input") { commitName(true); } });

  function openPanel() {
    pressCancel();
    Sound.play("open");
    panelIdx = 0;
    confirmIdx = -1;
    renderPanel();
    mode = "panel";
    stage.classList.add("panel-open");
  }

  function closePanel() {
    Sound.play("close");
    mode = "home";
    stage.classList.remove("panel-open");
  }

  function renderPanel() {
    var list = $("panelList");
    var selEl = null;
    list.innerHTML = "";
    for (var i = 0; i < PANEL.length; i++) {
      var o = PANEL[i];
      if (o.group) { list.appendChild(div("pgroup", o.group)); }
      var el = div("prow" + (i === panelIdx ? " sel" : "") + (o.danger ? " danger" : ""));
      if (i === panelIdx) { selEl = el; }
      el.appendChild(div("plabel", o.label));
      var val = div("pval");
      if (o.type === "text") {
        nameInput.value = S.userName;
        val.appendChild(nameInput);
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
    $("panelFoot").textContent = "beeOS " + VERSION + "  ·  Kırmızı tuş: ayarlar  ·  OK'a basılı tut: kart menüsü";
  }

  function panelHover(i) {
    return function () { if (panelIdx !== i && mode === "panel") { panelIdx = i; confirmIdx = -1; renderPanel(); } };
  }

  function panelClick(i) {
    return function (e) {
      if (e.target === nameInput) { return; }
      panelIdx = i;
      activate(PANEL[i]);
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
      nameInput.focus();       // TV'de ekran klavyesi açılır
    } else if (o.values) {
      cycle(o, 1);
    } else if (o.type === "action") {
      if (o.confirm && confirmIdx !== panelIdx) { confirmIdx = panelIdx; renderPanel(); return; }
      confirmIdx = -1;
      o.run();
      renderPanel();
    }
  }

  function commitName(keep) {
    mode = "panel";
    if (keep) {
      S.userName = nameInput.value.replace(/^\s+|\s+$/g, "").slice(0, 24);
      save();
      tick();
    }
    nameInput.blur();
    renderPanel();
  }

  function panelKey(k) {
    if (k === 38) { panelIdx = Math.max(0, panelIdx - 1); confirmIdx = -1; renderPanel(); Sound.play("move"); }
    else if (k === 40) { panelIdx = Math.min(PANEL.length - 1, panelIdx + 1); confirmIdx = -1; renderPanel(); Sound.play("move"); }
    else if (k === 37 || k === 39) { if (PANEL[panelIdx].values) { cycle(PANEL[panelIdx], k === 39 ? 1 : -1); } }
    else if (k === 13) { activate(PANEL[panelIdx]); }
    else if (k === 461 || k === 27 || k === 8 || k === 403 || k === 112) { closePanel(); }
    else { return false; }
    return true;
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

    var mock = typeof PalmServiceBridge === "undefined" && /[?&]mock/.test(location.search);
    if (typeof PalmServiceBridge === "undefined" && !mock) { return; }
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
      if (k === 13) { commitName(true); }
      else if (k === 461 || k === 27) { commitName(false); }
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

  renderRows();
  applySettings();
  startBoot();
  loadInstalled();
  setInterval(tick, 15000);

  // Hata ayıklama için (ares-inspect konsolundan): __launcher.openPanel() vb.
  window.__launcher = { openPanel: openPanel, showSaver: showSaver, settings: function () { return S; } };
})();
