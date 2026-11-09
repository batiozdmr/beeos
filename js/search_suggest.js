// Ekran klavyesinde arama tahmini. Geçmiş aramaları (son 100) yerelde tutar, kullanıcı yazdıkça
// önek eşleşenlerini sıklıkla ağırlıklandırılmış sırayla döndürür. Bağ yok, ağa çıkmaz.
var SearchSuggest = (function () {
  var KEY = "search_history";
  var MAX = 100;

  function load() {
    try { return JSON.parse(localStorage.getItem("beeos:" + KEY) || "[]"); }
    catch (e) { return []; }
  }

  function save(list) {
    try { localStorage.setItem("beeos:" + KEY, JSON.stringify(list.slice(0, MAX))); } catch (e) {}
  }

  // {q, n, t}: sorgu, sıklık, son kullanım (ms)
  function record(q) {
    q = String(q || "").trim();
    if (!q) { return; }
    var list = load();
    var found = null;
    for (var i = 0; i < list.length; i++) { if (list[i].q === q) { found = list[i]; break; } }
    if (found) { found.n = (found.n || 1) + 1; found.t = Date.now(); }
    else { list.unshift({ q: q, n: 1, t: Date.now() }); }
    list.sort(function (a, b) { return (b.n * 1000 + Math.min(999, (b.t - a.t) / 86400000 | 0)) - (a.n * 1000); });
    save(list);
  }

  function suggest(prefix, n) {
    n = n || 6;
    prefix = String(prefix || "").trim().toLocaleLowerCase("tr");
    if (!prefix) { return load().slice(0, n).map(function (r) { return r.q; }); }
    var out = [];
    var list = load();
    for (var i = 0; i < list.length && out.length < n; i++) {
      if (list[i].q.toLocaleLowerCase("tr").indexOf(prefix) === 0) { out.push(list[i].q); }
    }
    return out;
  }

  function clear() { try { localStorage.removeItem("beeos:" + KEY); } catch (e) {} }

  return { record: record, suggest: suggest, clear: clear };
})();
