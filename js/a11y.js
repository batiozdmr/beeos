// Erişilebilirlik yardımcıları:
//  - Ekran dışı bir aria-live bölgesine duyuru gönderir (odak değişimi, kanal değişimi, bildirim).
//  - İşletim sistemi "hareketi azalt" diyorsa beeOS Ayarlar > Animasyonlar'ı kapalıya zorlar (kullanıcı değiştirene kadar).
var A11y = (function () {
  var live, assertive, lastMsg = "", lastT = 0;

  function ensure() {
    if (live) { return; }
    function make(role) {
      var el = document.createElement("div");
      el.setAttribute("role", role);
      el.setAttribute("aria-live", role === "alert" ? "assertive" : "polite");
      el.setAttribute("aria-atomic", "true");
      el.style.cssText = "position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden";
      document.body.appendChild(el);
      return el;
    }
    live = make("status");
    assertive = make("alert");
  }

  // Aynı mesajı 1 sn içinde tekrar okuma. urgent=true → aria-live="assertive".
  function say(msg, urgent) {
    if (!msg) { return; }
    ensure();
    var now = Date.now();
    if (msg === lastMsg && now - lastT < 1000) { return; }
    lastMsg = msg; lastT = now;
    var el = urgent ? assertive : live;
    el.textContent = "";                               // aynı metin tekrar atansa bile okunsun
    setTimeout(function () { el.textContent = msg; }, 20);
  }

  // İşletim sistemi tercihi: hareketi azalt. İlk okunduğunda uygula, sonra kullanıcı değiştirirse ona saygı duy.
  function syncReducedMotion() {
    if (!window.matchMedia) { return; }
    var mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    // Doğrudan Store'a yazmıyoruz: ayarlar S nesnesi üzerinden yönetiliyor. Burada sadece
    // CSS tarafında bir sınıf açarız; applySettings bunu görürse animasyonları kapatır. Kullanıcı
    // ayarlardan animasyonu açık bırakmayı seçerse ona saygı duyarız.
    function apply() {
      try {
        var raw = localStorage.getItem("beeos.settings.v1");
        var s = raw ? JSON.parse(raw) : {};
        if (s && s.reducedMotionSource === "user") { return; }
      } catch (e) {}
      document.documentElement.classList.toggle("reduced-motion", mq.matches);
    }
    apply();
    if (mq.addEventListener) { mq.addEventListener("change", apply); }
    else if (mq.addListener) { mq.addListener(apply); }
  }

  return { say: say, syncReducedMotion: syncReducedMotion };
})();

// Örnek kullanım (app.js içinde):
//   A11y.say("Kanal " + chan.name);
//   A11y.say("İnternet bağlantısı koptu", true);
//   document.addEventListener("DOMContentLoaded", A11y.syncReducedMotion);
