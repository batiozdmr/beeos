// Yerleşik TV kanalları: yayıncıların kendi sitelerinde ücretsiz sundukları canlı yayın (HLS) adresleri.
// Sadece adresi yayıncının kendisine / kendi dağıtım ağına ait olanlar listede. Şifreli (süreli
// anahtarlı) yayınlar ve üçüncü kişilerin yeniden yayınları eklenmez. Adresler zamanla değişebilir:
// açılmayan kanal olursa yayıncının "canlı yayın" sayfasından yenisi bulunur.
// Bazı TRT kanalları (TRT 2, TRT Genç, TRT Spor Yıldız) sadece Türkiye'den açılır.
// group: kanal listesindeki grup. Sıra = kanal numarası (1'den başlar).
var TV_CHANNELS = [
  { group: "Ulusal", name: "TRT 1",       url: "https://tv-trt1.medya.trt.com.tr/master.m3u8" },
  { group: "Ulusal", name: "Kanal D",     url: "https://demiroren.daioncdn.net/kanald/kanald.m3u8?app=kanald_web&ce=3" },
  { group: "Ulusal", name: "Star TV",     url: "https://dogus.daioncdn.net/startv/startv.m3u8?app=startv_web&ce=3" },
  { group: "Ulusal", name: "TV8",         url: "https://tv8.daioncdn.net/tv8/tv8.m3u8?app=7ddc255a-ef47-4e81-ab14-c0e5f2949788&ce=3" },
  { group: "Ulusal", name: "TRT 2",       url: "https://tv-trt2.medya.trt.com.tr/master.m3u8" },
  { group: "Haber",  name: "TRT Haber",   url: "https://tv-trthaber.medya.trt.com.tr/master.m3u8" },
  { group: "Haber",  name: "NTV",         url: "https://dogus.daioncdn.net/ntv/ntv.m3u8?app=ntv_web" },
  { group: "Haber",  name: "Habertürk",   url: "https://ciner.daioncdn.net/haberturktv/haberturktv.m3u8?app=c98ab0b0-50cc-495b-bb37-778e91f5ff5b&ce=3" },
  { group: "Haber",  name: "Halk TV",     url: "https://halktv-live.daioncdn.net/halktv/halktv.m3u8" },
  { group: "Haber",  name: "Sözcü TV",    url: "https://sozcutv-live.daioncdn.net/sozcutv/sozcutv.m3u8" },
  { group: "Haber",  name: "TGRT Haber",  url: "https://canli.tgrthaber.com/tgrt.m3u8" },
  { group: "Haber",  name: "24 TV",       url: "https://turkmedya-live.ercdn.net/tv24/tv24.m3u8" },
  { group: "Haber",  name: "TRT World",   url: "https://tv-trtworld.medya.trt.com.tr/master.m3u8" },
  { group: "Haber",  name: "TBMM TV",     url: "https://meclistv-live.ercdn.net/meclistv/meclistv.m3u8" },
  { group: "Ekonomi", name: "Bloomberg HT", url: "https://ciner.daioncdn.net/bloomberght/bloomberght.m3u8?app=web&ce=3" },
  { group: "Ekonomi", name: "Ekotürk",    url: "https://cdn.ekoturk.net/hls/master.m3u8" },
  { group: "Spor",   name: "TRT Spor",    url: "https://tv-trtspor1.medya.trt.com.tr/master.m3u8" },
  { group: "Spor",   name: "TRT Spor Yıldız", url: "https://tv-trtspor2.medya.trt.com.tr/master.m3u8" },
  { group: "Spor",   name: "HT Spor",     url: "https://ciner.daioncdn.net/ht-spor/ht-spor.m3u8?app=web" },
  { group: "Spor",   name: "TJK TV",      url: "https://tjktv-live.tjk.org/tjktv.m3u8" },
  { group: "Çocuk",  name: "TRT Çocuk",   url: "https://tv-trtcocuk.medya.trt.com.tr/master.m3u8" },
  { group: "Çocuk",  name: "TRT Diyanet Çocuk", url: "https://tv-trtdiyanetcocuk.medya.trt.com.tr/master.m3u8" },
  { group: "Belgesel ve Kültür", name: "TRT Belgesel", url: "https://tv-trtbelgesel.medya.trt.com.tr/master.m3u8" },
  { group: "Belgesel ve Kültür", name: "TRT Genç",     url: "https://tv-trtgenc.medya.trt.com.tr/master.m3u8" },
  { group: "Belgesel ve Kültür", name: "TRT Türk",     url: "https://tv-trtturk.medya.trt.com.tr/master.m3u8" },
  { group: "Belgesel ve Kültür", name: "TRT Avaz",     url: "https://tv-trtavaz.medya.trt.com.tr/master.m3u8" },
  { group: "Belgesel ve Kültür", name: "TRT Kurdî",    url: "https://tv-trtkurdi.medya.trt.com.tr/master.m3u8" },
  { group: "Belgesel ve Kültür", name: "TRT EBA",      url: "https://tv-e-okul01.medya.trt.com.tr/master.m3u8" },
  { group: "Belgesel ve Kültür", name: "TV4",          url: "https://turkmedya-live.ercdn.net/tv4/tv4.m3u8" },
  { group: "Müzik",  name: "TRT Müzik",   url: "https://tv-trtmuzik.medya.trt.com.tr/master.m3u8" },
  { group: "Müzik",  name: "Kral Pop TV", url: "https://dogus-live.daioncdn.net/kralpoptv/playlist.m3u8" }
];
