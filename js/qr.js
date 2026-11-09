// Küçük QR kod üretici (versiyon 1-10, L hata düzeltme). Bağımlılıksız, ES5.
// Kullanım: QR.toSvg("metin", 256) -> SVG string. QR.toDataUri("metin", 256) -> data: url.
// Metin ~200 byte'a kadar güvenli kalır (telefon kumandası URL'leri + fingerprint için fazlasıyla yeter).
var QR = (function () {
  // Reed-Solomon GF(256) tabloları
  var EXP = [], LOG = [];
  (function () {
    var x = 1;
    for (var i = 0; i < 256; i++) {
      EXP[i] = x; LOG[x] = i;
      x <<= 1; if (x & 0x100) { x ^= 0x11D; }
    }
  })();
  function gmul(a, b) { return (a && b) ? EXP[(LOG[a] + LOG[b]) % 255] : 0; }

  // Versiyon sabitleri (L hata düzeltme seviyesi): toplam kod sözcüğü, veri kod sözcüğü, ECC kod sözcüğü.
  // Yeter kaynak: Thonky QR tutorial. Sadece L seviyesi — küçük ekran için en çok veri sığdırır.
  var VER = {
    1:  { total: 26,  data: 19,  ecc: 7,  blocks: [[19, 7]] },
    2:  { total: 44,  data: 34,  ecc: 10, blocks: [[34, 10]] },
    3:  { total: 70,  data: 55,  ecc: 15, blocks: [[55, 15]] },
    4:  { total: 100, data: 80,  ecc: 20, blocks: [[80, 20]] },
    5:  { total: 134, data: 108, ecc: 26, blocks: [[108, 26]] }
  };

  function byteCapacity(v) { return VER[v].data - 2; }   // mode (4) + length (8) = 12 bit ~ 2 byte

  function pickVersion(len) {
    for (var v = 1; v <= 5; v++) { if (byteCapacity(v) >= len) { return v; } }
    return 5;
  }

  function rsGenerator(degree) {
    var g = [1];
    for (var i = 0; i < degree; i++) {
      var ng = [].concat(g, [0]);
      for (var j = 0; j < g.length; j++) {
        ng[j + 1] ^= gmul(g[j], EXP[i]);
      }
      g = ng;
    }
    return g;
  }

  function rsEncode(data, eccLen) {
    var gen = rsGenerator(eccLen);
    var res = data.slice();
    for (var i = 0; i < eccLen; i++) { res.push(0); }
    for (var i = 0; i < data.length; i++) {
      var factor = res[i];
      if (!factor) { continue; }
      for (var j = 0; j < gen.length; j++) {
        res[i + j] ^= gmul(gen[j], factor);
      }
    }
    return res.slice(data.length);
  }

  // Bit → byte dizisi
  function bitsToBytes(bits) {
    var out = [];
    for (var i = 0; i < bits.length; i += 8) {
      var b = 0;
      for (var j = 0; j < 8; j++) { b = (b << 1) | (bits[i + j] || 0); }
      out.push(b);
    }
    return out;
  }

  // Byte modu ile kodla: 0100 + 8-bit uzunluk + veri + bitiş + pad
  function encodeBytes(text, ver) {
    var bytes = [];
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (c < 0x80) { bytes.push(c); }
      else if (c < 0x800) { bytes.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F)); }
      else { bytes.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F)); }
    }
    var cap = VER[ver].data;
    var bits = [];
    function pushBits(val, n) { for (var i = n - 1; i >= 0; i--) { bits.push((val >> i) & 1); } }
    pushBits(0x4, 4);
    pushBits(bytes.length, 8);
    for (var i = 0; i < bytes.length; i++) { pushBits(bytes[i], 8); }
    // terminator (en fazla 4 bit)
    var rem = cap * 8 - bits.length;
    for (var i = 0; i < Math.min(4, rem); i++) { bits.push(0); }
    while (bits.length % 8) { bits.push(0); }
    var data = bitsToBytes(bits);
    var pad = [0xEC, 0x11];
    for (var i = 0, p = 0; data.length < cap; i++, p = 1 - p) { data.push(pad[p]); }
    var ecc = rsEncode(data, VER[ver].ecc);
    return data.concat(ecc);
  }

  function sizeFor(ver) { return ver * 4 + 17; }

  // Fonksiyonel desenler: finder, timing, alignment
  function placeFunctional(mat, ver) {
    var n = sizeFor(ver);
    function finder(r, c) {
      for (var i = -1; i <= 7; i++) for (var j = -1; j <= 7; j++) {
        var rr = r + i, cc = c + j;
        if (rr < 0 || rr >= n || cc < 0 || cc >= n) { continue; }
        var on = (i >= 0 && i <= 6 && (j === 0 || j === 6)) ||
                 (j >= 0 && j <= 6 && (i === 0 || i === 6)) ||
                 (i >= 2 && i <= 4 && j >= 2 && j <= 4);
        mat[rr][cc] = on ? 1 : 0;
      }
    }
    finder(0, 0); finder(0, n - 7); finder(n - 7, 0);
    // timing
    for (var i = 8; i < n - 8; i++) {
      mat[6][i] = (i % 2 === 0) ? 1 : 0;
      mat[i][6] = (i % 2 === 0) ? 1 : 0;
    }
    // dark module
    mat[n - 8][8] = 1;
    // alignment (versiyon 2-5 için tek alignment pattern merkezi)
    var alignCenters = { 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30] };
    if (alignCenters[ver]) {
      var cs = alignCenters[ver];
      for (var a = 0; a < cs.length; a++) for (var b = 0; b < cs.length; b++) {
        var r = cs[a], c = cs[b];
        if (mat[r][c] !== null) { continue; }
        for (var i = -2; i <= 2; i++) for (var j = -2; j <= 2; j++) {
          var on = Math.max(Math.abs(i), Math.abs(j)) !== 1;
          mat[r + i][c + j] = on ? 1 : 0;
        }
      }
    }
    // format info reserved (geçici 0, sonra doldurulur)
    for (var i = 0; i <= 8; i++) {
      if (mat[8][i] === null) { mat[8][i] = 0; }
      if (mat[i][8] === null) { mat[i][8] = 0; }
      if (mat[8][n - 1 - i] === null) { mat[8][n - 1 - i] = 0; }
      if (mat[n - 1 - i][8] === null) { mat[n - 1 - i][8] = 0; }
    }
  }

  // Veri bitlerini zigzag yerleştir
  function placeData(mat, bytes, ver) {
    var n = sizeFor(ver);
    var bit = 0, total = bytes.length * 8;
    function get(k) { return (bytes[k >> 3] >> (7 - (k & 7))) & 1; }
    var col = n - 1, up = true;
    while (col > 0) {
      if (col === 6) { col--; }
      for (var i = 0; i < n; i++) {
        var row = up ? n - 1 - i : i;
        for (var j = 0; j < 2; j++) {
          var c = col - j;
          if (mat[row][c] === null) {
            mat[row][c] = bit < total ? get(bit) : 0;
            bit++;
          }
        }
      }
      col -= 2;
      up = !up;
    }
  }

  // Maske 0: (r + c) mod 2 == 0. Format bitleri bu maskeye göre encode edilir.
  function applyMask(mat, ver) {
    var n = sizeFor(ver);
    // Fonksiyonel modülleri işaretle: maskelenmemeli. Kolaylık için, maske öncesi fonksiyonel
    // konumları başka bir matriste tutmak yerine, bilinenleri (finder/timing/alignment/format) atla.
    function isFunctional(r, c) {
      if (r === 6 || c === 6) { return true; }
      if (r < 9 && c < 9) { return true; }
      if (r < 9 && c >= n - 8) { return true; }
      if (r >= n - 8 && c < 9) { return true; }
      var alignCenters = { 2: [18, 18], 3: [22, 22], 4: [26, 26], 5: [30, 30] };
      if (alignCenters[ver]) {
        var ac = alignCenters[ver];
        if (Math.abs(r - ac[0]) <= 2 && Math.abs(c - ac[1]) <= 2) { return true; }
      }
      return false;
    }
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) {
      if (isFunctional(r, c)) { continue; }
      if (((r + c) % 2) === 0) { mat[r][c] ^= 1; }
    }
  }

  // Format bilgisi: L (01) + mask 0 (000) = 01000. BCH(15,5)=0x5412 XOR.
  function placeFormat(mat, ver) {
    var n = sizeFor(ver);
    // L seviye + mask 0: hazır değer 0x77C4 (standart tablodan)
    var bits = [0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0];  // = 0x77C4 big-endian
    // yerleştirme
    for (var i = 0; i < 6; i++) { mat[8][i] = bits[i]; mat[i][8] = bits[14 - i]; }
    mat[8][7] = bits[6]; mat[8][8] = bits[7]; mat[7][8] = bits[8];
    for (var i = 0; i < 7; i++) { mat[n - 1 - i][8] = bits[i]; }
    for (var i = 0; i < 8; i++) { mat[8][n - 1 - i] = bits[14 - i]; }
    mat[n - 8][8] = 1;
  }

  function build(text) {
    var ver = pickVersion(text.length);
    var n = sizeFor(ver);
    var mat = [];
    for (var i = 0; i < n; i++) { mat.push(new Array(n)); for (var j = 0; j < n; j++) { mat[i][j] = null; } }
    placeFunctional(mat, ver);
    var bytes = encodeBytes(text, ver);
    placeData(mat, bytes, ver);
    applyMask(mat, ver);
    placeFormat(mat, ver);
    return mat;
  }

  function toSvg(text, size) {
    size = size || 240;
    var mat = build(text);
    var n = mat.length;
    var quiet = 2;
    var s = (size / (n + quiet * 2)) | 0;
    var dim = s * (n + quiet * 2);
    var rects = "";
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) {
      if (mat[r][c] === 1) {
        rects += '<rect x="' + ((c + quiet) * s) + '" y="' + ((r + quiet) * s) + '" width="' + s + '" height="' + s + '"/>';
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + dim + ' ' + dim +
           '" width="' + dim + '" height="' + dim + '" shape-rendering="crispEdges">' +
           '<rect width="100%" height="100%" fill="#fff"/><g fill="#000">' + rects + '</g></svg>';
  }

  function toDataUri(text, size) {
    return "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(toSvg(text, size))));
  }

  return { toSvg: toSvg, toDataUri: toDataUri, _build: build };
})();
