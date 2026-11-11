// İlk açılış sihirbazı. ES5 (webOS Chromium 38): grid/gap/inset kullanılmaz, stil css/style.css'te.
// Sahnenin (#stage, 1920x1080, ekrana göre ölçeklenir) içine yerleşir; tüm tuşları app.js katman
// (overlay) düzeniyle alır, arkadaki ana ekrana tuş sızmaz.
//
// Onboarding.start(host) -> { el, key(keyCode) -> bool, char(ch) }
// host: { platform, store, catalog, available(item), api(method, path, body, cb) | null, qr,
//         sound(name), askText({title, text, max, placeholder}, cb(text)), done() }
var Onboarding = (function () {
  var POPULAR = ["youtube.leanback.v4", "netflix", "amazon", "com.disney.disneyplus-prod",
                 "spotify-beehive", "com.webos.app.browser"];
  var BEE = '<svg viewBox="0 0 80 92" width="150" height="172"><defs><linearGradient id="onbG" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#ffd65a"/><stop offset="1" stop-color="#ff9f1a"/></linearGradient></defs>' +
    '<polygon points="40,3 77,24.5 77,67.5 40,89 3,67.5 3,24.5" fill="url(#onbG)"/>' +
    '<ellipse cx="31" cy="38" rx="10" ry="6.5" fill="#fff" opacity="0.9" transform="rotate(-28 31 38)"/>' +
    '<ellipse cx="49" cy="38" rx="10" ry="6.5" fill="#fff" opacity="0.9" transform="rotate(28 49 38)"/>' +
    '<ellipse cx="40" cy="55" rx="11" ry="15" fill="#1a1200"/>' +
    '<rect x="29.5" y="50" width="21" height="3.6" fill="#ffc83d"/>' +
    '<rect x="30.5" y="58" width="19" height="3.6" fill="#ffc83d"/></svg>';

  function mk(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) { e.className = cls; }
    if (text != null) { e.textContent = text; }
    return e;
  }
  function setCls(el, c, on) { if (on) { el.classList.add(c); } else { el.classList.remove(c); } }

  function start(host) {
    var S = host.store, pc = host.platform === "pc";
    var root = mk("div", "ovl onb");
    var top = mk("div", "onb-top");
    top.innerHTML = '<div class="onb-brand"><b>bee</b>OS</div><div class="onb-count"></div>' +
                    '<div class="onb-bar"><i></i></div>';
    var body = mk("div", "onb-body");
    var foot = mk("div", "onb-foot");
    root.appendChild(top);
    root.appendChild(body);
    root.appendChild(foot);

    var steps = [welcome, name];
    if (pc) { steps.push(network, phone); }     // TV kendi ağ ayarını kullanır; telefon kumandası PC'de
    steps.push(favorites, finish);

    var cur = -1, step = null, grid = [], fr = 0, fc = 0, pollT = null;

    // ---- odak (kumanda) ----
    function focusable(el, act) {
      el.className += " onb-f";
      el.__act = act;
      el.addEventListener("click", function () {
        for (var r = 0; r < grid.length; r++) {
          var c = grid[r].indexOf(el);
          if (c >= 0) { fr = r; fc = c; }
        }
        paint();
        act();
      });
      return el;
    }
    function paint() {
      for (var r = 0; r < grid.length; r++) {
        for (var c = 0; c < grid[r].length; c++) { setCls(grid[r][c], "sel", r === fr && c === fc); }
      }
    }
    function focusEl(el) {
      for (var r = 0; r < grid.length; r++) {
        var c = grid[r].indexOf(el);
        if (c >= 0) { fr = r; fc = c; paint(); return; }
      }
    }
    function moveFocus(dr, dc) {
      if (!grid.length) { return; }
      if (dr) {
        var nr = fr + dr;
        if (nr < 0 || nr >= grid.length) { host.sound("edge"); return; }
        // aynı hizadaki öğeye geç (yatay merkeze en yakın)
        var from = grid[fr][fc], x = from.getBoundingClientRect(), mid = x.left + x.width / 2;
        var best = 0, bd = 1e9;
        for (var i = 0; i < grid[nr].length; i++) {
          var b = grid[nr][i].getBoundingClientRect(), d = Math.abs(b.left + b.width / 2 - mid);
          if (d < bd) { bd = d; best = i; }
        }
        fr = nr; fc = best;
      } else {
        var nc = fc + dc;
        if (nc < 0 || nc >= grid[fr].length) { host.sound("edge"); return; }
        fc = nc;
      }
      host.sound("move");
      paint();
    }

    // ---- adım geçişi ----
    function show(i) {
      clearInterval(pollT);
      pollT = null;
      cur = i;
      step = steps[i]();
      body.innerHTML = "";
      body.appendChild(step.el);
      step.el.className += " onb-in";
      top.querySelector(".onb-count").textContent = "Adım " + (i + 1) + " / " + steps.length;
      top.querySelector(".onb-bar i").style.width = Math.round((i + 1) / steps.length * 100) + "%";
      renderFoot();
    }
    function renderFoot() {
      foot.innerHTML = "";
      var row = [];
      if (cur > 0) { row.push(focusable(mk("div", "onb-btn", "‹ Geri"), back)); }
      var primary = focusable(mk("div", "onb-btn primary", step.next ? step.next() : "Devam ›"), next);
      row.push(primary);
      for (var i = 0; i < row.length; i++) { foot.appendChild(row[i]); }
      grid = (step.rows || []).concat([row]);
      fr = step.focusRow != null ? step.focusRow : grid.length - 1;
      fc = fr === grid.length - 1 ? row.length - 1 : 0;
      paint();
    }
    // Birincil düğme etiketi adım içinde değişebilir (ör. ad yazılınca "Atla" -> "Devam")
    function refreshPrimary() {
      var p = foot.querySelector(".primary");
      if (p && step.next) { p.textContent = step.next(); }
    }
    function next() {
      host.sound("select");
      if (step.leave) { step.leave(); }
      if (cur === steps.length - 1) { clearInterval(pollT); host.done(); return; }
      show(cur + 1);
    }
    function back() {
      if (cur === 0) { host.sound("edge"); return; }
      host.sound("back");
      show(cur - 1);
    }

    // ---- adımlar ----
    function welcome() {
      var el = mk("div", "onb-step");
      el.innerHTML = '<div class="onb-logo">' + BEE + '</div>';
      el.appendChild(mk("h1", "", "beeOS'a hoş geldin"));
      el.appendChild(mk("p", "", "Uygulamaların tek ekranda, telefonun kumandada. Birkaç kısa adımda hazırız."));
      return { el: el, next: function () { return "Başlayalım ›"; } };
    }

    function name() {
      var el = mk("div", "onb-step");
      el.appendChild(mk("h1", "", "Sana nasıl hitap edelim?"));
      el.appendChild(mk("p", "", "Adın ana ekranda “Günaydın, Ayşe” gibi görünür. İstemezsen boş bırak."));
      var field = mk("div", "onb-field");
      function paintField() {
        field.textContent = S.userName || "Adını yazmak için OK'a bas";
        setCls(field, "ph", !S.userName);
      }
      function edit(initial) {
        host.askText({ title: "Adın", text: initial != null ? initial : S.userName, max: 24, placeholder: "Adını yaz" },
          function (v) {
            S.userName = String(v || "").replace(/^\s+|\s+$/g, "").slice(0, 24);
            paintField();
            refreshPrimary();
            if (S.userName) { focusEl(foot.querySelector(".primary")); }
          });
      }
      focusable(field, function () { edit(); });
      paintField();
      el.appendChild(field);
      // Ad zaten varsa odak "Devam"da başlar; yoksa alanda (OK klavyeyi açar)
      return { el: el, rows: [[field]], focusRow: S.userName ? null : 0,
               next: function () { return S.userName ? "Devam ›" : "Şimdilik atla ›"; },
               onChar: function (ch) { edit((S.userName || "") + ch); } };
    }

    function network() {
      var el = mk("div", "onb-step");
      el.appendChild(mk("h1", "", "İnternet bağlantısı"));
      var pill = mk("div", "onb-pill", "Kontrol ediliyor…");
      var hint = mk("p", "", "");
      var retry = mk("div", "onb-btn small", "Tekrar kontrol et");
      el.appendChild(pill);
      el.appendChild(hint);
      var res = { el: el, rows: [] };
      function check() {
        pill.className = "onb-pill";
        pill.textContent = "Kontrol ediliyor…";
        if (!host.api) { offline(); return; }
        host.api("GET", "/api/status", null, function (r) {
          if (r && r.online) {
            pill.className = "onb-pill ok";
            pill.textContent = "Bağlı" + (r.name ? " · " + r.name : "");
            hint.textContent = "Her şey yolunda. Devam edebilirsin.";
            if (retry.parentNode) { retry.parentNode.removeChild(retry); }
            grid = [grid[grid.length - 1]]; fr = 0; fc = grid[0].length - 1; paint();
          } else { offline(); }
        });
      }
      function offline() {
        pill.className = "onb-pill bad";
        pill.textContent = "Bağlı değil";
        hint.textContent = "Netflix, YouTube gibi uygulamalar için internet gerekir. Kurulumdan sonra " +
                           "Ayarlar › Wi-Fi'den bağlanabilirsin.";
        if (!retry.parentNode) {
          el.appendChild(retry);
          grid = [[retry], grid[grid.length - 1]];
          fr = 1; fc = grid[1].length - 1;      // odak "Devam"da kalsın
          paint();
        }
      }
      focusable(retry, function () { host.sound("select"); check(); });
      setTimeout(check, 0);
      return res;
    }

    function phone() {
      var el = mk("div", "onb-step");
      el.appendChild(mk("h1", "", "Telefonun kumanda olsun"));
      var wrap = mk("div", "onb-phone");
      var qr = mk("div", "onb-qr");
      qr.appendChild(mk("div", "onb-qr-wait", "Hazırlanıyor…"));
      var list = mk("div", "onb-howto");
      list.innerHTML =
        '<div class="li"><span>1</span>Telefonun kamerasını aç ve kodu okut.</div>' +
        '<div class="li"><span>2</span>Tarayıcı “bağlantı gizli değil” derse <b>Gelişmiş › Devam et</b>. ' +
        'Bu, TV\'nin kendi yerel sertifikası.</div>' +
        '<div class="li"><span>3</span>Kumanda kendiliğinden bağlanır; PIN yazman gerekmez.</div>';
      var manual = mk("div", "onb-manual", "");
      var state = mk("div", "onb-pill", "Telefon bekleniyor…");
      list.appendChild(manual);
      list.appendChild(state);
      wrap.appendChild(qr);
      wrap.appendChild(list);
      el.appendChild(wrap);
      var connected = false, seq0 = -1;
      var res = { el: el, next: function () { return connected ? "Devam ›" : "Şimdilik atla ›"; } };
      if (host.api) {
        host.api("GET", "/api/remote", null, function (r) {
          qr.innerHTML = "";
          if (!r || !r.urls || !r.urls.length) {
            qr.appendChild(mk("div", "onb-qr-wait", "Ağ yok. Önce internete bağlan."));
            state.textContent = "Ağ bağlantısı gerekli";
            return;
          }
          var url = r.urls[0] + "#pin=" + r.pin + (r.fingerprint ? "&fp=" + r.fingerprint : "");
          try {
            var img = mk("img");
            img.src = host.qr.toDataUri(url, 300);
            img.alt = "QR kod";
            qr.appendChild(img);
          } catch (e) { qr.appendChild(mk("div", "onb-qr-wait", "QR üretilemedi")); }
          manual.textContent = "Kamerasız: " + r.urls[0].replace(/^https?:\/\//, "") + "  ·  PIN " +
                               String(r.pin || "").replace(/^(\d{3})(\d{3})$/, "$1 $2");
        });
        // Telefon bağlanınca (başarılı eşleşme sayacı artınca) adım kendini günceller
        function poll() {
          host.api("GET", "/api/status", null, function (r) {
            if (!r || typeof r.remoteSeq !== "number") { return; }
            if (seq0 < 0) { seq0 = r.remoteSeq; return; }
            if (r.remoteSeq > seq0 && !connected) {
              connected = true;
              state.className = "onb-pill ok";
              state.textContent = "Telefon bağlandı";
              host.sound("open");
              refreshPrimary();
              focusEl(foot.querySelector(".primary"));
            }
          });
        }
        poll();
        pollT = setInterval(poll, 2000);
      }
      return res;
    }

    function favorites() {
      var el = mk("div", "onb-step");
      el.appendChild(mk("h1", "", "Favori uygulamalarını seç"));
      el.appendChild(mk("p", "", "Seçtiklerin ana ekranın en üstünde durur. Sonra kart menüsünden değiştirebilirsin."));
      var items = [], seen = {};
      for (var r = 0; r < host.catalog.length; r++) {
        var list = host.catalog[r].items || [];
        for (var k = 0; k < list.length; k++) {
          var it = list[k];
          if (POPULAR.indexOf(it.id) >= 0 && !seen[it.id] && host.available(it)) { items.push(it); seen[it.id] = 1; }
        }
      }
      items.sort(function (a, b) { return POPULAR.indexOf(a.id) - POPULAR.indexOf(b.id); });
      var chosen = (S.favorites || []).slice();
      var box = mk("div", "onb-cards");
      var count = mk("div", "onb-count2", "");
      var rows = [], perRow = items.length > 4 ? 3 : items.length;
      function paintCount() {
        count.textContent = chosen.length ? chosen.length + " uygulama seçildi" : "Henüz seçim yok";
      }
      items.forEach(function (it, i) {
        var c = it.colors || ["#2a3142", "#151a26"];
        var card = mk("div", "onb-card");
        card.style.background = "-webkit-linear-gradient(-55deg," + c[0] + "," + (c[1] || c[0]) + ")";
        card.style.background = "linear-gradient(145deg," + c[0] + "," + (c[1] || c[0]) + ")";
        card.appendChild(mk("div", "onb-card-n", it.name));
        card.appendChild(mk("div", "onb-card-s", it.sub || ""));
        card.appendChild(mk("div", "onb-check", "✓"));
        setCls(card, "on", chosen.indexOf(it.id) >= 0);
        focusable(card, function () {
          var at = chosen.indexOf(it.id);
          if (at >= 0) { chosen.splice(at, 1); } else { chosen.push(it.id); }
          setCls(card, "on", at < 0);
          host.sound(at < 0 ? "select" : "back");
          paintCount();
          refreshPrimary();
        });
        if (i % perRow === 0) { rows.push([]); box.appendChild(mk("div", "onb-cardrow")); }
        rows[rows.length - 1].push(card);
        box.lastChild.appendChild(card);
      });
      if (!items.length) { box.appendChild(mk("p", "", "Uygulama listesi henüz hazır değil; sonra da seçebilirsin.")); }
      paintCount();
      el.appendChild(box);
      el.appendChild(count);
      return { el: el, rows: rows, focusRow: rows.length ? 0 : null,
               next: function () { return chosen.length ? "Devam ›" : "Seçmeden devam et ›"; },
               leave: function () { S.favorites = chosen.slice(); } };
    }

    function finish() {
      var el = mk("div", "onb-step");
      el.innerHTML = '<div class="onb-logo small">' + BEE + '</div>';
      el.appendChild(mk("h1", "", S.userName ? "Hazırsın, " + S.userName + "!" : "Hazırsın!"));
      el.appendChild(mk("p", "", "Hatırlaman gereken birkaç tuş:"));
      var keys = pc
        ? [["Yön tuşları", "Kartlar arasında gez"], ["Enter", "Uygulamayı aç"],
           ["Enter basılı tut", "Kartı taşı, gizle, favorile"], ["F1", "beeOS ayarları"],
           ["Harf yaz", "Aramayı başlat"], ["Home", "Her yerden beeOS'a dön"]]
        : [["Yön tuşları", "Kartlar arasında gez"], ["OK", "Uygulamayı aç"],
           ["OK basılı tut", "Kartı taşı, gizle, favorile"], ["Kırmızı tuş", "beeOS ayarları"],
           ["Geri", "Bir önceki ekrana dön"]];
      var tbl = mk("div", "onb-keys");
      keys.forEach(function (k) {
        var row = mk("div", "onb-krow");
        row.appendChild(mk("span", "onb-kbd", k[0]));
        row.appendChild(mk("span", "onb-kdesc", k[1]));
        tbl.appendChild(row);
      });
      el.appendChild(tbl);
      return { el: el, next: function () { return "Ana ekrana git ›"; } };
    }

    show(0);

    return {
      el: root,
      key: function (k) {
        if (k === 37) { moveFocus(0, -1); }
        else if (k === 39) { moveFocus(0, 1); }
        else if (k === 38) { moveFocus(-1, 0); }
        else if (k === 40) { moveFocus(1, 0); }
        else if (k === 13) { var el = grid[fr] && grid[fr][fc]; if (el) { el.__act(); } }
        else if (k === 461 || k === 27 || k === 8) { back(); }
        return true;     // sihirbaz açıkken hiçbir tuş ana ekrana gitmez
      },
      char: function (ch) { if (step && step.onChar) { step.onChar(ch); } }
    };
  }

  return { start: start };
})();
