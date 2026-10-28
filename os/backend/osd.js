// beeOS ses göstergesi. Arka uç bu dosyayı Chrome DevTools ile öndeki sekmeye (beeOS ya da açık
// uygulama: Netflix, YouTube...) enjekte eder, ardından window.__beeosOSD.show(durum) çağırır.
// Sitelerin CSP / Trusted Types kurallarına takılmamak için innerHTML ve <style> kullanılmaz:
// öğeler DOM ile, stil ise oluşturulabilir stil sayfasıyla (adoptedStyleSheets) kurulur.
(function () {
  var V = 1;
  if (window.__beeosOSD && window.__beeosOSD.v === V) { return; }

  var CSS =
    ":host{all:initial}" +
    ".wrap{position:fixed;left:0;top:0;width:1920px;pointer-events:none;transform-origin:0 0}" +
    ".osd{position:absolute;left:50%;top:56px;width:600px;height:88px;margin-left:-300px;box-sizing:border-box;" +
    "padding:0 34px 0 30px;display:flex;align-items:center;border-radius:44px;background:rgba(16,20,31,.94);" +
    "border:1px solid rgba(255,255,255,.12);box-shadow:0 18px 50px rgba(0,0,0,.55);" +
    "font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#fff;" +
    "opacity:0;transform:translateY(-16px) scale(.97);transition:opacity .18s ease-out,transform .18s ease-out}" +
    ".osd.on{opacity:1;transform:none}" +
    ".ic{width:44px;height:44px;flex:none;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}" +
    ".ic .body{fill:#fff;stroke:none}.ic .w1,.ic .w2,.ic .x{display:none}" +
    ".l1 .w1,.l2 .w1,.l2 .w2,.muted .x{display:inline}.muted .w1,.muted .w2{display:none}" +
    ".track{position:relative;flex:1;height:10px;margin:0 26px 0 22px;border-radius:5px;background:rgba(255,255,255,.14);overflow:hidden}" +
    ".fill{position:absolute;left:0;top:0;width:100%;height:100%;border-radius:5px;background:#ffc83d;" +
    "transform-origin:0 0;transition:transform .12s ease-out}" +
    ".muted .fill{background:rgba(255,255,255,.35)}" +
    ".num{width:104px;flex:none;text-align:right;font-size:36px;font-weight:600;font-variant-numeric:tabular-nums;letter-spacing:.5px}" +
    ".num small{font-size:22px;font-weight:500;opacity:.55;margin-left:3px}" +
    ".muted .num{font-size:26px;color:rgba(255,255,255,.7)}" +
    ".err .track{display:none}.err .num{width:auto;flex:1;text-align:left;margin-left:22px;font-size:26px;font-weight:500}";

  var NS = "http://www.w3.org/2000/svg";
  function el(tag, cls, parent) {
    var e = document.createElement(tag);
    if (cls) { e.className = cls; }
    if (parent) { parent.appendChild(e); }
    return e;
  }
  function path(svg, cls, d) {
    var p = document.createElementNS(NS, "path");
    p.setAttribute("class", cls);
    p.setAttribute("d", d);
    svg.appendChild(p);
  }

  // Özel etiket adı: sayfanın div/span kuralları göstergeye uygulanmaz
  var host = document.createElement("beeos-osd");
  host.style.setProperty("all", "initial");
  host.style.setProperty("position", "fixed");
  host.style.setProperty("inset", "0");
  host.style.setProperty("z-index", "2147483647");
  host.style.setProperty("pointer-events", "none");
  var root = host.attachShadow({ mode: "closed" });
  var sheet = new CSSStyleSheet();
  sheet.replaceSync(CSS);
  root.adoptedStyleSheets = [sheet];

  var wrap = el("div", "wrap", root);
  var box = el("div", "osd", wrap);
  var svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "ic");
  svg.setAttribute("viewBox", "0 0 24 24");
  path(svg, "body", "M4 9.5h3.2L12 5.2v13.6L7.2 14.5H4z");
  path(svg, "w1", "M15.2 9.3a3.8 3.8 0 0 1 0 5.4");
  path(svg, "w2", "M17.8 6.6a7.6 7.6 0 0 1 0 10.8");
  path(svg, "x", "M15.5 9.5l5 5m0-5l-5 5");
  box.appendChild(svg);
  var fill = el("div", "fill", el("div", "track", box));
  var num = el("div", "num", box);
  var hideTimer = null;

  function place() {
    // Tam ekran oynatıcı varsa gösterge onun içinde çizilir (yoksa videonun altında kalır)
    var fs = document.fullscreenElement || document.webkitFullscreenElement;
    var parent = fs && fs.tagName !== "VIDEO" && fs.tagName !== "IFRAME" ? fs : document.documentElement;
    if (host.parentNode !== parent) { parent.appendChild(host); }
    wrap.style.transform = "scale(" + (window.innerWidth / 1920) + ")";
  }

  function show(s) {
    place();
    var level = Math.max(0, Math.min(100, s.level || 0));
    box.className = "osd on" + (s.error ? " err" : s.muted ? " muted" : level === 0 ? "" : level < 50 ? " l1" : " l2");
    fill.style.transform = "scaleX(" + (level / 100) + ")";
    while (num.firstChild) { num.removeChild(num.firstChild); }
    if (s.error || s.muted) {
      num.textContent = s.error || "Sessiz";
    } else {
      num.appendChild(document.createTextNode(String(level)));
      el("small", "", num).textContent = "%";
    }
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () { box.classList.remove("on"); }, 1800);
  }

  window.__beeosOSD = { v: V, show: show };
})();
