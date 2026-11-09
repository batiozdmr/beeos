// Wi-Fi hatalarını somut mesajlara çevirir. nmcli / wpa_supplicant çıktıları çok teknik; kullanıcı
// "bir şeyler ters gitti" yerine ne yapması gerektiğini görsün.
var WifiErrors = (function () {
  // Anahtar: nmcli'nin dönüş kodu + stderr'deki belirteç. Değer: {baslik, ipucu}.
  var MAP = [
    { re: /secrets were required|802-11-wireless-security|psk|password/i,
      baslik: "Şifre yanlış", ipucu: "Wi-Fi şifresini kontrol edip tekrar dene. Büyük/küçük harf önemli." },
    { re: /ssid not found|no network with ssid|not available/i,
      baslik: "Ağ bulunamadı", ipucu: "Ağ kapsama alanında mı? Modem yeniden başlatılmış olabilir." },
    { re: /association took too long|timeout|timed out/i,
      baslik: "Sinyal zayıf", ipucu: "Modeme daha yakın bir yere taşımayı dene veya ağı unut, yeniden ekle." },
    { re: /connection activation failed.*dhcp|dhcp.*failed|no ipv4/i,
      baslik: "IP adresi alınamadı", ipucu: "Modemde DHCP kapalı olabilir. Modemi yeniden başlatmayı dene." },
    { re: /nameserver|dns|resolve/i,
      baslik: "İnternete çıkılamıyor", ipucu: "Wi-Fi bağlandı ama internet yok. Modemin internet ışığını kontrol et." },
    { re: /rfkill|disabled by hardware/i,
      baslik: "Wi-Fi donanımsal olarak kapalı", ipucu: "Bilgisayarın Wi-Fi tuşu kapalı olabilir (genelde F tuşlarından biri)." }
  ];

  function explain(stderr, code) {
    stderr = String(stderr || "");
    for (var i = 0; i < MAP.length; i++) {
      if (MAP[i].re.test(stderr)) { return { baslik: MAP[i].baslik, ipucu: MAP[i].ipucu }; }
    }
    if (code === 0) { return { baslik: "Bağlantı tamamlanamadı", ipucu: "Ağı unutup yeniden eklemeyi dene." }; }
    return { baslik: "Wi-Fi bağlanamadı", ipucu: "Modemi yeniden başlatıp tekrar dene; sorun devam ederse farklı bir ağla test et." };
  }

  return { explain: explain };
})();
