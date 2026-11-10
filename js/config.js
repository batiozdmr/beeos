// Ekranda görünen kartlar. `id` = webOS uygulama kimliği (modele göre değişebilir).
// Doğru kimliği bulmak için TV'de: ares-launch --device tv --running  (veya  ares-device -i)
// size: "large" (büyük kartlar) | "small" (küçük kartlar)
// icon: ICONS içindeki anahtar. sub: kartın alt etiketi (sadece büyük kartlarda görünür).
// web: PC'de (flash disk) açılacak adres; olmayan kart PC'de görünmez.
// ua: "tv" ise sayfa TV tarayıcısı kimliğiyle açılır (YouTube TV arayüzü bunu ister).
// only: "tv" | "pc"  kart sadece o ortamda görünür.
// search: arama adresi ({q} = aranan söz). tvParam: TV'de aramanın uygulamaya hangi parametreyle
//   gideceği (yoksa kart TV'de arama listesinde çıkmaz).
// "@" ile başlayan kimlikler beeOS'un kendi ekranlarıdır (@tv: internet TV, @settings: ayarlar...).

function svgIcon(inner) {
  return '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="#fff" ' +
         'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
}

var ICONS = {
  play: svgIcon('<circle cx="12" cy="12" r="9.5"/><path d="M10 8.2l6 3.8-6 3.8z" fill="#fff"/>'),
  gamepad: svgIcon('<path d="M7 9h10a4 4 0 014 4v2a4 4 0 01-7 2h-4a4 4 0 01-7-2v-2a4 4 0 014-4z"/><path d="M8 12v3M6.5 13.5h3M15 13h.01M17 15h.01"/>'),
  music: svgIcon('<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>'),
  globe: svgIcon('<circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19M12 2.5c3 3 3 16.5 0 19M12 2.5c-3 3-3 16.5 0 19"/>'),
  tv: svgIcon('<rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>'),
  hdmi: svgIcon('<path d="M3 8h18v5l-3 4H6l-3-4z"/><path d="M8 11v2M12 11v2M16 11v2"/>'),
  settings: svgIcon('<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2.2"/><circle cx="8" cy="17" r="2.2"/>'),
  hex: svgIcon('<path d="M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5z"/><path d="M12 8l3.5 2v4L12 16l-3.5-2v-4z" fill="#fff"/>'),
  gear: svgIcon('<circle cx="12" cy="12" r="3.5"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>'),
  wifi: svgIcon('<path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.6 16a5 5 0 0 1 6.8 0"/><circle cx="12" cy="19.3" r="1.1" fill="#fff"/>'),
  power: svgIcon('<path d="M12 3v9"/><path d="M6.6 6.6a8 8 0 1 0 10.8 0"/>'),
  search: svgIcon('<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5l5.5 5.5"/>'),
  phone: svgIcon('<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/>'),
  folder: svgIcon('<path d="M3 7.5a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>')
};

// Sistem kartlarının ortak, sakin rengi: uygulamalarla yarışmasın
var SYS = ["#3b4659", "#141a26"];

// cat: üstteki büyük bilgi alanındaki etiket. desc: aynı alandaki açıklama.
var CONFIG = {
  userName: "",
  rows: [
    {
      title: "Uygulamalar",
      size: "large",
      items: [
        { name: "YouTube",     cat: "Uygulama", sub: "Video",       icon: "play",  id: "youtube.leanback.v4", web: "https://www.youtube.com/tv", ua: "tv", search: "https://www.youtube.com/tv#/search?q={q}", tvParam: "contentTarget", colors: ["#ef2b22", "#6d0a0a"], desc: "Videolar, canlı yayınlar ve müzik. Sevdiğin kanallar tek dokunuş uzağında." },
        { name: "Netflix",     cat: "Uygulama", sub: "Dizi & Film", icon: "play",  id: "netflix", web: "https://www.netflix.com/browse", search: "https://www.netflix.com/search?q={q}", colors: ["#e50914", "#4a0207"], desc: "Diziler, filmler ve belgeseller. Kaldığın yerden devam et." },
        { name: "Prime Video", cat: "Uygulama", sub: "Dizi & Film", icon: "play",  id: "amazon", web: "https://www.primevideo.com", search: "https://www.primevideo.com/search?phrase={q}", colors: ["#0aa5df", "#06374f"], desc: "Orijinal yapımlar, filmler ve diziler." },
        { name: "Disney+",     cat: "Uygulama", sub: "Dizi & Film", icon: "play",  id: "com.disney.disneyplus-prod", web: "https://www.disneyplus.com", search: "https://www.disneyplus.com/search?q={q}", colors: ["#2a54e0", "#0a1650"], desc: "Disney, Marvel, Star Wars ve daha fazlası." },
        { name: "Spotify",     cat: "Uygulama", sub: "Müzik",       icon: "music", id: "spotify-beehive", web: "https://open.spotify.com", search: "https://open.spotify.com/search/{q}", colors: ["#1fc45c", "#0a4a22"], desc: "Çalma listeleri, podcast'ler ve sevdiğin sanatçılar." },
        { name: "TV",          cat: "Canlı TV", sub: "Kanallar",    icon: "tv",    id: "@tv", colors: ["#f5a524", "#5a3405"], desc: "Antensiz, internetten canlı TV kanalları. Yukarı/aşağı ile kanal değiştir, OK ile kanal listesi." },
        { name: "Tarayıcı",    cat: "Uygulama", sub: "İnternet",    icon: "globe", id: "com.webos.app.browser", web: "https://www.google.com", search: "https://www.google.com/search?q={q}", tvParam: "target", colors: ["#8b4cf0", "#2a1066"], desc: "İnternette gez, haberleri oku, siteleri aç." },
        { name: "GeForce Now", cat: "Oyun",     sub: "Bulut oyun",  icon: "gamepad", id: "beeos.geforcenow", web: "https://play.geforcenow.com/", only: "pc", colors: ["#76b900", "#1f3100"], desc: "Nvidia GeForce Now bulut oyun: AAA oyunları tarayıcıdan oyna. Oyun kolu veya klavye ister; Nvidia hesabı gerekir." },
        { name: "Xbox Cloud Gaming", cat: "Oyun", sub: "Bulut oyun", icon: "gamepad", id: "beeos.xboxcloud", web: "https://www.xbox.com/play", only: "pc", colors: ["#107c10", "#0a3309"], desc: "Microsoft Xbox Cloud Gaming: Game Pass oyunları tarayıcıdan oyna. Xbox hesabı ve Game Pass Ultimate gerekir." },
        { name: "Boosteroid", cat: "Oyun", sub: "Bulut oyun", icon: "gamepad", id: "beeos.boosteroid", web: "https://cloud.boosteroid.com/", only: "pc", colors: ["#9146ff", "#2a0f4e"], desc: "Ukrayna merkezli bulut oyun servisi; aylık abonelikle AAA oyunlar." },
        { name: "now.gg", cat: "Oyun", sub: "Bulut oyun", icon: "gamepad", id: "beeos.nowgg", web: "https://now.gg/", only: "pc", colors: ["#00c2ff", "#003a5c"], desc: "Android oyunlarını tarayıcıda oyna. Ücretsiz; reklam destekli." },
        { name: "YouTube Music", cat: "Müzik", sub: "Çalma listeleri", icon: "music", id: "youtube.music", web: "https://music.youtube.com", search: "https://music.youtube.com/search?q={q}", colors: ["#ff0033", "#4a0010"], desc: "YouTube Music: albümler, çalma listeleri ve resmi klipler." },
        { name: "Deezer", cat: "Müzik", sub: "Flow", icon: "music", id: "deezer", web: "https://www.deezer.com", search: "https://www.deezer.com/search/{q}", colors: ["#a238ff", "#2a0a4a"], desc: "Deezer: akıllı Flow önerisi ve yüksek kaliteli ses." },
        { name: "BBC News", cat: "Haber", sub: "İngilizce", icon: "globe", id: "beeos.bbc", web: "https://www.bbc.com/news", only: "pc", colors: ["#bb1919", "#4d0a0a"], desc: "BBC News: dünya haberleri, canlı yayınlar ve analiz." },
        { name: "DW Türkçe", cat: "Haber", sub: "Türkçe", icon: "globe", id: "beeos.dw", web: "https://www.dw.com/tr/", only: "pc", colors: ["#002d5b", "#000f20"], desc: "Deutsche Welle Türkçe: Avrupa ve dünya gündemi." }
      ]
    },
    {
      title: "Girişler ve Sistem", pcTitle: "Sistem",
      size: "small",
      items: [
        { name: "Ara",      cat: "Sistem", icon: "search",   id: "@search",                         colors: SYS, desc: "Film, dizi, şarkı ya da kanal ara; sonra nerede aranacağını seç." },
        { name: "Canlı TV", cat: "Giriş",  icon: "tv",       id: "com.webos.app.livetv", only: "tv",         colors: SYS, desc: "Kanallara dön ve canlı yayını izle." },
        { name: "HDMI 1",   cat: "Giriş",  icon: "hdmi",     id: "com.webos.app.hdmi1", only: "tv",          colors: SYS, desc: "HDMI 1 girişine bağlı cihazı göster." },
        { name: "HDMI 2",   cat: "Giriş",  icon: "hdmi",     id: "com.webos.app.hdmi2", only: "tv",          colors: SYS, desc: "HDMI 2 girişine bağlı cihazı göster." },
        { name: "HDMI 3",   cat: "Giriş",  icon: "hdmi",     id: "com.webos.app.hdmi3", only: "tv",          colors: SYS, desc: "HDMI 3 girişine bağlı cihazı göster." },
        { name: "TV Ayarları", cat: "Sistem", icon: "gear",   id: "com.palm.app.settings", only: "tv",        colors: SYS, desc: "Görüntü, ses, ağ ve TV ayarları." },
        { name: "Medya",    cat: "Sistem", icon: "folder",   id: "com.webos.app.mediadiscovery", only: "tv", colors: SYS, desc: "USB ve ağdaki fotoğraf, müzik ve videolar." },
        { name: "Wi-Fi",    cat: "Sistem", icon: "wifi",     id: "@wifi",  only: "pc",                colors: SYS, desc: "Kablosuz ağlar: bağlan, şifre gir, durumu gör." },
        { name: "Güç",      cat: "Sistem", icon: "power",    id: "@power", only: "pc",                colors: SYS, desc: "Bilgisayarı kapat, yeniden başlat veya açık uygulamaları kapat." },
        { name: "Telefon",  cat: "Sistem", icon: "phone",    id: "@remote", only: "pc",             colors: SYS, desc: "Telefonunu kumanda yap: yön tuşları, ses düzeyi, yazı ve sesle yazma." },
        // "@settings" özel kimliktir: uygulama açmaz, beeOS ayar panelini açar. Gizlenemez.
        { name: "beeOS", cat: "Sistem", icon: "hex", id: "@settings",                            colors: SYS, desc: "beeOS ayarları: görünüm, ses, sıralama, ekran koruyucu." }
      ]
    }
  ]
};
