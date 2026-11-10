// İlk açılış sihirbazı: yeni cihazda kullanıcıyı kısa adımlarla yönlendirir.
// Store.onboarded = true oluncaya kadar başlar. ES5 (webOS Chromium 38 uyumlu).
// Kullanım: Onboarding.start(platform, callbacks) — platform "pc" | "tv" | "web".
//   callbacks: { done: fn, launchCard: fn(id), openWifi: fn, openRemote: fn }
var Onboarding = (function () {
  var cur = 0, steps = [], root = null, cbs = null, plat = "pc";
  var popularIds = ["youtube.leanback.v4", "netflix", "amazon",
                    "com.disney.disneyplus-prod", "spotify-beehive"];

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) { e.className = cls; }
    if (html != null) { e.innerHTML = html; }
    return e;
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function injectStyle() {
    if (document.getElementById("onbStyle")) { return; }
    var css =
      "#onb{position:fixed;inset:0;z-index:9000;background:radial-gradient(120% 60% at 50% -10%," +
      "rgba(255,176,40,.16),transparent 60%),#07090f;color:#f4f6fb;display:flex;" +
      "flex-direction:column;overflow:hidden;font-family:inherit}" +
      "#onb.hide{opacity:0;pointer-events:none;transition:opacity .4s}" +
      "#onbHead{display:flex;align-items:center;gap:12px;padding:28px 44px}" +
      "#onbHead .b{font-size:22px;font-weight:300;letter-spacing:-.01em}" +
      "#onbHead .b b{color:#ffc83d;font-weight:800}" +
      "#onbDots{margin-left:auto;display:flex;gap:8px}" +
      "#onbDots .d{width:10px;height:10px;border-radius:50%;background:#2a3344}" +
      "#onbDots .d.on{background:#ffc83d}" +
      "#onbBody{flex:1;display:flex;align-items:center;justify-content:center;padding:0 48px}" +
      ".onb-step{display:none;max-width:900px;width:100%;text-align:center;animation:onbIn .35s ease-out}" +
      ".onb-step.on{display:block}" +
      "@keyframes onbIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}" +
      ".onb-step h1{font-size:64px;font-weight:300;letter-spacing:-.03em;margin:0 0 22px;line-height:1.05}" +
      ".onb-step h1 b{color:#ffc83d;font-weight:800}" +
      ".onb-step p{font-size:24px;color:#8b93a7;line-height:1.5;margin:0 auto 36px;max-width:640px}" +
      ".onb-step .big{font-size:160px;line-height:1;margin:10px 0 24px;filter:drop-shadow(0 20px 60px rgba(255,170,30,.4))}" +
      ".onb-input{width:min(440px,90%);height:72px;padding:0 24px;border-radius:18px;background:#10141e;" +
      "border:2px solid #2a3344;color:#fff;font-size:26px;text-align:center;outline:none;margin:0 auto 32px;display:block}" +
      ".onb-input:focus{border-color:#ffc83d}" +
      ".onb-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;" +
      "max-width:760px;margin:0 auto 32px}" +
      ".onb-card{position:relative;padding:18px 14px;border-radius:18px;border:2px solid #2a3344;" +
      "background:#10141e;cursor:pointer;transition:transform .12s,border-color .12s;font-size:18px;font-weight:600}" +
      ".onb-card:hover,.onb-card.focus{border-color:#ffc83d;transform:translateY(-3px)}" +
      ".onb-card.on{border-color:#ffc83d;background:rgba(255,200,61,.1)}" +
      ".onb-card .ch{position:absolute;top:10px;right:10px;width:24px;height:24px;border-radius:50%;" +
      "background:#ffc83d;color:#1c1300;display:none;align-items:center;justify-content:center;font-weight:800;font-size:16px}" +
      ".onb-card.on .ch{display:flex}" +
      ".onb-qr{display:inline-flex;flex-direction:column;align-items:center;gap:14px;" +
      "padding:22px;border-radius:22px;background:#fff;color:#000}" +
      ".onb-qr img{width:240px;height:240px;display:block}" +
      ".onb-qr .url{font-size:16px;font-weight:600;color:#333}" +
      ".onb-row{display:flex;gap:28px;align-items:center;justify-content:center;flex-wrap:wrap;margin:10px 0 32px}" +
      ".onb-kbd{display:inline-grid;grid-template-columns:auto 1fr;column-gap:16px;row-gap:12px;" +
      "max-width:560px;margin:0 auto 32px;text-align:left;font-size:20px}" +
      ".onb-kbd .k{background:#10141e;border:1px solid #2a3344;border-radius:10px;padding:8px 14px;" +
      "font-weight:600;color:#ffc83d;text-align:center;min-width:120px}" +
      ".onb-kbd .v{color:#c7cdda;line-height:1.5}" +
      "#onbFoot{display:flex;gap:16px;justify-content:center;padding:28px 44px 48px}" +
      ".onb-btn{height:64px;padding:0 36px;border-radius:18px;border:0;font:inherit;font-size:20px;" +
      "font-weight:700;cursor:pointer;transition:transform .08s,filter .12s}" +
      ".onb-btn:active{transform:scale(.97)}" +
      ".onb-btn.primary{background:linear-gradient(180deg,#ffd65a,#ff9f1a);color:#1c1300;" +
      "box-shadow:0 10px 28px rgba(255,160,30,.35)}" +
      ".onb-btn.primary:hover{filter:brightness(1.05)}" +
      ".onb-btn.ghost{background:#1a2030;color:#c7cdda;border:1px solid #2a3344}" +
      ".onb-btn.ghost:hover{background:#242b3f}" +
      ".onb-net{display:inline-flex;align-items:center;gap:12px;padding:12px 22px;border-radius:99px;" +
      "background:#10141e;border:1px solid #2a3344;font-size:17px;margin-bottom:28px}" +
      ".onb-net i{width:10px;height:10px;border-radius:50%;background:#5b6377}" +
      ".onb-net.on i{background:#3ddc84;box-shadow:0 0 0 4px rgba(61,220,132,.2)}" +
      ".onb-net.off i{background:#ff5f5f;box-shadow:0 0 0 4px rgba(255,95,95,.2)}" +
      "@media (max-width:900px){.onb-step h1{font-size:40px}.onb-step p{font-size:18px}" +
      ".onb-step .big{font-size:120px}}";
    var s = el("style");
    s.id = "onbStyle";
    s.appendChild(document.createTextNode(css));
    document.head.appendChild(s);
  }

  function build(S) {
    injectStyle();
    root = el("div");
    root.id = "onb";
    var header = el("div", null); header.id = "onbHead";
    header.appendChild(el("span", "b", 'beeOS\'a hoş geldin'));
    var dots = el("div"); dots.id = "onbDots";
    header.appendChild(dots);
    var body = el("div"); body.id = "onbBody";
    var foot = el("div"); foot.id = "onbFoot";

    root.appendChild(header);
    root.appendChild(body);
    root.appendChild(foot);
    document.body.appendChild(root);

    // Adımlar: PC'de 6, TV'de 5 (Wi-Fi atlanır — TV kendi ayarları ile bağlanır)
    steps = [
      welcomeStep(),
      nameStep(S),
      plat === "pc" ? wifiStep() : null,
      remoteStep(S),
      favoritesStep(S),
      finishStep()
    ];
    steps = steps.filter(function (x) { return x; });

    for (var i = 0; i < steps.length; i++) {
      body.appendChild(steps[i].el);
      var d = el("div", "d");
      dots.appendChild(d);
    }

    showStep(0);
  }

  function showStep(i) {
    cur = Math.max(0, Math.min(steps.length - 1, i));
    for (var k = 0; k < steps.length; k++) {
      steps[k].el.classList.toggle("on", k === cur);
    }
    var dots = document.getElementById("onbDots").children;
    for (var k2 = 0; k2 < dots.length; k2++) {
      dots[k2].className = "d" + (k2 === cur ? " on" : "");
    }
    renderFoot();
    try { steps[cur].enter && steps[cur].enter(); } catch (e) {}
  }

  function renderFoot() {
    var foot = document.getElementById("onbFoot");
    foot.innerHTML = "";
    var st = steps[cur];
    if (cur > 0 && !st.hideBack) {
      var back = el("button", "onb-btn ghost", "‹ Geri");
      back.onclick = function () { showStep(cur - 1); };
      foot.appendChild(back);
    }
    if (st.optional && cur < steps.length - 1) {
      var skip = el("button", "onb-btn ghost", "Atla");
      skip.onclick = function () { showStep(cur + 1); };
      foot.appendChild(skip);
    }
    var nextLabel = cur === steps.length - 1 ? "Başla ›" : "Devam ›";
    if (st.nextLabel) { nextLabel = st.nextLabel; }
    var next = el("button", "onb-btn primary", nextLabel);
    next.onclick = function () {
      try { st.before && st.before(); } catch (e) {}
      if (cur === steps.length - 1) { finish(); } else { showStep(cur + 1); }
    };
    foot.appendChild(next);
    try { next.focus(); } catch (e) {}
  }

  // --- Adım 1: Hoş geldin ---
  function welcomeStep() {
    var s = el("div", "onb-step");
    s.innerHTML =
      '<div class="big">🐝</div>' +
      '<h1>beeOS\'a hoş geldin</h1>' +
      '<p>Favori uygulamaların tek ekranda, telefonun kumanda. Birkaç adımda hazır olalım.</p>';
    return { el: s, hideBack: true };
  }

  // --- Adım 2: İsim (opsiyonel) ---
  function nameStep(S) {
    var s = el("div", "onb-step");
    s.innerHTML =
      '<h1>Seni nasıl çağıralım?</h1>' +
      '<p>Adın ana ekranda "Günaydın Ahmet" gibi karşılama yazısında görünür. İstersen boş bırak.</p>' +
      '<input class="onb-input" id="onbName" placeholder="Adın (opsiyonel)" maxlength="40">';
    return {
      el: s,
      optional: true,
      enter: function () {
        var i = s.querySelector("#onbName");
        if (i) { i.value = S.userName || ""; setTimeout(function () { try { i.focus(); } catch (e) {} }, 100); }
      },
      before: function () {
        var i = s.querySelector("#onbName");
        if (i) { S.userName = String(i.value || "").slice(0, 40); }
      }
    };
  }

  // --- Adım 3: Wi-Fi (sadece PC) ---
  function wifiStep() {
    var s = el("div", "onb-step");
    var status = el("div", "onb-net", '<i></i><span>Ağ durumu kontrol ediliyor…</span>');
    s.innerHTML =
      '<h1>İnternete bağlı mısın?</h1>' +
      '<p>Birçok özellik için ağ gerekir. Zaten bağlıysan "Devam" diyebilirsin.</p>';
    s.appendChild(status);
    return {
      el: s,
      optional: true,
      enter: function () {
        if (!Platform || !Platform.api) { return; }
        Platform.api("GET", "/api/status", null, function (res) {
          if (res && res.online) {
            status.className = "onb-net on";
            status.innerHTML = '<i></i><span>Bağlı' + (res.name ? ' · ' + esc(res.name) : '') + '</span>';
          } else {
            status.className = "onb-net off";
            status.innerHTML = '<i></i><span>Bağlı değil — kurulumdan sonra Ayarlar > Wi-Fi\'den bağlanabilirsin</span>';
          }
        });
      }
    };
  }

  // --- Adım 4: Telefon kumandası (QR + PIN) ---
  function remoteStep(S) {
    var s = el("div", "onb-step");
    s.innerHTML =
      '<h1>Telefonu kumanda yap</h1>' +
      '<p>Kodu telefonun kamerasıyla okut; adresi ve PIN\'i otomatik açsın. Aynı Wi-Fi\'de olmalısın.</p>' +
      '<div class="onb-row"><div class="onb-qr" id="onbQr"><div style="width:240px;height:240px;' +
      'display:flex;align-items:center;justify-content:center;color:#666;font-size:16px">Yükleniyor…</div>' +
      '<div class="url" id="onbUrl">—</div></div></div>' +
      '<p style="font-size:17px;margin-top:4px">Sonra: <b>Sistem › Telefon</b> ile her an bulabilirsin.</p>';
    return {
      el: s,
      optional: true,
      enter: function () {
        if (!Platform || !Platform.api || plat !== "pc") {
          s.querySelector("#onbQr").innerHTML = '<div style="padding:28px;color:#666">' +
            'Telefon kumandası yalnız beeOS PC sürümünde çalışır.</div>';
          return;
        }
        Platform.api("GET", "/api/remote", null, function (res) {
          var q = s.querySelector("#onbQr"), u = s.querySelector("#onbUrl");
          if (!res || !res.urls || !res.urls.length) {
            q.innerHTML = '<div style="padding:28px;color:#666">Henüz ağ yok. Önce Wi-Fi\'ye bağlan.</div>';
            return;
          }
          var url = res.urls[0];
          if (res.fingerprint) { url += "#fp=" + res.fingerprint; }
          try {
            q.innerHTML = '<img src="' + QR.toDataUri(url, 240) + '" alt="QR">';
            q.appendChild(el("div", "url", res.urls[0] + " · PIN " +
              (res.pin || "").replace(/^(\d{3})(\d{3})$/, "$1 $2")));
          } catch (e) {
            q.innerHTML = '<div style="padding:28px;color:#666">QR üretilemedi</div>';
          }
          u.textContent = "";
        });
      }
    };
  }

  // --- Adım 5: Favoriler (seç 0-6) ---
  function favoritesStep(S) {
    var s = el("div", "onb-step");
    s.innerHTML =
      '<h1>Favorilerini seç</h1>' +
      '<p>Favoriler ana ekranın en üstünde "Favoriler" rafında görünür. Sonra istediğin an değiştirebilirsin.</p>';
    var grid = el("div", "onb-grid");
    s.appendChild(grid);

    // CONFIG'ten tanınan popüler kartları çıkar
    var items = [];
    try {
      var rows = (typeof CONFIG !== "undefined" ? CONFIG.rows : []) || [];
      var seen = {};
      for (var r = 0; r < rows.length; r++) {
        var it = rows[r].items || [];
        for (var k = 0; k < it.length; k++) {
          var id = it[k].id;
          if (popularIds.indexOf(id) >= 0 && !seen[id]) { items.push(it[k]); seen[id] = 1; }
        }
      }
    } catch (e) {}

    for (var i = 0; i < items.length; i++) {
      var it2 = items[i];
      var c = (it2.colors || ["#2a3142", "#151a26"]);
      var card = el("button", "onb-card");
      card.setAttribute("data-id", it2.id);
      card.style.borderColor = "transparent";
      card.style.background = "linear-gradient(145deg," + c[0] + "," + (c[1] || c[0]) + ")";
      card.innerHTML = '<span class="ch">✓</span>' +
        '<div style="font-size:19px;font-weight:700;line-height:1.1">' + esc(it2.name) + '</div>' +
        (it2.sub ? '<div style="font-size:13px;opacity:.8;margin-top:4px">' + esc(it2.sub) + '</div>' : "");
      if ((S.favorites || []).indexOf(it2.id) >= 0) { card.classList.add("on"); }
      (function (c) {
        c.onclick = function () { c.classList.toggle("on"); };
      })(card);
      grid.appendChild(card);
    }
    if (!items.length) { grid.innerHTML = '<div style="color:#8b93a7">Uygulamalar henüz yüklenmedi.</div>'; }

    return {
      el: s,
      optional: true,
      before: function () {
        var chosen = [];
        var cards = grid.getElementsByClassName("onb-card");
        for (var i = 0; i < cards.length; i++) {
          if (cards[i].classList.contains("on")) { chosen.push(cards[i].getAttribute("data-id")); }
        }
        S.favorites = chosen;
      }
    };
  }

  // --- Adım 6: Bitti + tuş ipuçları ---
  function finishStep() {
    var s = el("div", "onb-step");
    var kbd = plat === "pc"
      ? '<div class="onb-kbd">' +
        '<div class="k">Enter</div><div class="v">Uygulamayı aç</div>' +
        '<div class="k">Yön tuşları</div><div class="v">Kartlar arası gez</div>' +
        '<div class="k">F1</div><div class="v">beeOS ayarları</div>' +
        '<div class="k">A–Z yaz</div><div class="v">Arama başlat</div>' +
        '<div class="k">Home</div><div class="v">beeOS ana ekrana dön</div>' +
        '</div>'
      : '<div class="onb-kbd">' +
        '<div class="k">OK</div><div class="v">Uygulamayı aç</div>' +
        '<div class="k">Yön tuşları</div><div class="v">Kartlar arası gez</div>' +
        '<div class="k">OK basılı tut</div><div class="v">Kartı taşı veya gizle</div>' +
        '<div class="k">Geri</div><div class="v">Uygulamadan çıkma / beeOS\'a dön</div>' +
        '</div>';
    s.innerHTML =
      '<div class="big">🐝</div>' +
      '<h1>Hepsi bu kadar!</h1>' +
      '<p>İşte hatırlaman gereken tuşlar:</p>' +
      kbd +
      '<p style="font-size:17px">Sistem > beeOS ayarlarından her şeyi değiştirebilirsin.</p>';
    return { el: s, nextLabel: "Başla ›" };
  }

  function finish() {
    try {
      if (cbs && typeof cbs.saveSettings === "function") { cbs.saveSettings(); }
    } catch (e) {}
    if (root) {
      root.classList.add("hide");
      setTimeout(function () { try { root.parentNode.removeChild(root); } catch (e) {} root = null; }, 450);
    }
    try { if (cbs && cbs.done) { cbs.done(); } } catch (e) {}
  }

  // Dpad desteği (TV uzaktan kumanda / OK)
  function keydown(ev) {
    if (!root) { return; }
    var k = ev.key;
    if (k === "ArrowRight" || k === "Enter") {
      var btn = root.querySelector("#onbFoot .primary");
      if (btn) { btn.click(); ev.preventDefault(); }
    } else if (k === "ArrowLeft") {
      var back = root.querySelector("#onbFoot .ghost");
      if (back && back.textContent.indexOf("Geri") >= 0) { back.click(); ev.preventDefault(); }
    } else if (k === "Escape" || k === "Backspace") {
      if (cur > 0) { showStep(cur - 1); ev.preventDefault(); }
    }
  }

  function start(platform, callbacks) {
    plat = platform || "pc";
    cbs = callbacks || {};
    build(cbs.store || {});
    document.addEventListener("keydown", keydown, true);
  }

  return { start: start };
})();
