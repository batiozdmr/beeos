// Ekranda görünen kartlar. `id` = webOS uygulama kimliği (modele göre değişebilir).
// Doğru kimliği bulmak için TV'de: ares-launch --device tv --running  (veya  ares-device -i)
// size: "large" (büyük kartlar) | "small" (küçük kartlar)
// icon: ICONS içindeki anahtar. sub: kartın alt etiketi (sadece büyük kartlarda görünür).

function svgIcon(inner) {
  return '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="#fff" ' +
         'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
}

var ICONS = {
  play: svgIcon('<circle cx="12" cy="12" r="9.5"/><path d="M10 8.2l6 3.8-6 3.8z" fill="#fff"/>'),
  music: svgIcon('<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>'),
  globe: svgIcon('<circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19M12 2.5c3 3 3 16.5 0 19M12 2.5c-3 3-3 16.5 0 19"/>'),
  tv: svgIcon('<rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>'),
  hdmi: svgIcon('<path d="M3 8h18v5l-3 4H6l-3-4z"/><path d="M8 11v2M12 11v2M16 11v2"/>'),
  settings: svgIcon('<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2.2"/><circle cx="8" cy="17" r="2.2"/>'),
  hex: svgIcon('<path d="M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5z"/><path d="M12 8l3.5 2v4L12 16l-3.5-2v-4z" fill="#fff"/>'),
  gear: svgIcon('<circle cx="12" cy="12" r="3.5"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>'),
  folder: svgIcon('<path d="M3 7.5a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>')
};

// cat: üstteki büyük bilgi alanındaki etiket. desc: aynı alandaki açıklama.
var CONFIG = {
  userName: "",
  rows: [
    {
      title: "Uygulamalar",
      size: "large",
      items: [
        { name: "YouTube",     cat: "Uygulama", sub: "Video",       icon: "play",  id: "youtube.leanback.v4",        colors: ["#ef2b22", "#6d0a0a"], desc: "Videolar, canlı yayınlar ve müzik. Sevdiğin kanallar tek dokunuş uzağında." },
        { name: "Netflix",     cat: "Uygulama", sub: "Dizi & Film", icon: "play",  id: "netflix",                    colors: ["#e50914", "#4a0207"], desc: "Diziler, filmler ve belgeseller. Kaldığın yerden devam et." },
        { name: "Prime Video", cat: "Uygulama", sub: "Dizi & Film", icon: "play",  id: "amazon",                     colors: ["#0aa5df", "#06374f"], desc: "Orijinal yapımlar, filmler ve diziler." },
        { name: "Disney+",     cat: "Uygulama", sub: "Dizi & Film", icon: "play",  id: "com.disney.disneyplus-prod", colors: ["#2a54e0", "#0a1650"], desc: "Disney, Marvel, Star Wars ve daha fazlası." },
        { name: "Spotify",     cat: "Uygulama", sub: "Müzik",       icon: "music", id: "spotify-beehive",            colors: ["#1fc45c", "#0a4a22"], desc: "Çalma listeleri, podcast'ler ve sevdiğin sanatçılar." },
        { name: "Tarayıcı",    cat: "Uygulama", sub: "İnternet",    icon: "globe", id: "com.webos.app.browser",      colors: ["#8b4cf0", "#2a1066"], desc: "İnternette gez, haberleri oku, siteleri aç." }
      ]
    },
    {
      title: "Girişler ve Sistem",
      size: "small",
      items: [
        { name: "Canlı TV", cat: "Giriş",  icon: "tv",       id: "com.webos.app.livetv",         colors: ["#f5a30b", "#6b3d02"], desc: "Kanallara dön ve canlı yayını izle." },
        { name: "HDMI 1",   cat: "Giriş",  icon: "hdmi",     id: "com.webos.app.hdmi1",          colors: ["#1aa7ec", "#06384f"], desc: "HDMI 1 girişine bağlı cihazı göster." },
        { name: "HDMI 2",   cat: "Giriş",  icon: "hdmi",     id: "com.webos.app.hdmi2",          colors: ["#1aa7ec", "#06384f"], desc: "HDMI 2 girişine bağlı cihazı göster." },
        { name: "HDMI 3",   cat: "Giriş",  icon: "hdmi",     id: "com.webos.app.hdmi3",          colors: ["#1aa7ec", "#06384f"], desc: "HDMI 3 girişine bağlı cihazı göster." },
        { name: "TV Ayarları", cat: "Sistem", icon: "gear",   id: "com.palm.app.settings",        colors: ["#71829c", "#222c3c"], desc: "Görüntü, ses, ağ ve TV ayarları." },
        { name: "Medya",    cat: "Sistem", icon: "folder",   id: "com.webos.app.mediadiscovery", colors: ["#ec4f9d", "#5c1237"], desc: "USB ve ağdaki fotoğraf, müzik ve videolar." },
        // "@settings" özel kimliktir: uygulama açmaz, beeOS ayar panelini açar. Gizlenemez.
        { name: "beeOS", cat: "Sistem", icon: "hex", id: "@settings",                            colors: ["#f5b700", "#6b4300"], desc: "beeOS ayarları: görünüm, ses, sıralama, ekran koruyucu." }
      ]
    }
  ]
};
