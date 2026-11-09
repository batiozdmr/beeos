// localStorage kotası (çoğu tarayıcıda ~5 MB) aşılırsa en eski "son açılanlar" girişlerini temizler.
// Her Store.set çağrısında QuotaExceededError yakalanır; burada çözüm uygulanır.
// Çağrı sırası: store.js içinde set() QuotaGuard.makeRoom(key) → tekrar dene → başarısızsa sessizce vazgeç.
var QuotaGuard = (function () {
  var TRIM_KEYS = ["recent", "search_history", "card_log"];   // sırayla budanır
  var TRIM_MAX = { recent: 50, search_history: 20, card_log: 100 };

  // Bir anahtarın uzun dizisini sondan buda. Dönüş: alan açıldı mı?
  function trim(key) {
    try {
      var raw = localStorage.getItem("beeos:" + key);
      if (!raw) { return false; }
      var arr = JSON.parse(raw);
      if (!arr || !arr.length) { return false; }
      var max = TRIM_MAX[key] || 20;
      if (arr.length <= max / 2) { return false; }
      arr = arr.slice(0, Math.max(5, Math.floor(max / 2)));
      localStorage.setItem("beeos:" + key, JSON.stringify(arr));
      return true;
    } catch (e) { return false; }
  }

  return {
    makeRoom: function (/* failingKey */) {
      for (var i = 0; i < TRIM_KEYS.length; i++) {
        if (trim(TRIM_KEYS[i])) { return true; }
      }
      return false;
    },
    report: function () {
      var total = 0;
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        var v = localStorage.getItem(k) || "";
        total += k.length + v.length;
      }
      return { bytes: total, approxMB: Math.round(total / 1024 / 1024 * 100) / 100 };
    }
  };
})();
