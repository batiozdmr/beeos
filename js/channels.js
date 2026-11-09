// Yerleşik TV kanalları: yayıncıların kendi sitelerinde ücretsiz sundukları canlı yayın (HLS) adresleri.
// Sadece adresi yayıncının kendisine / kendi dağıtım ağına ait olanlar listede. Şifreli (süreli
// anahtarlı) yayınlar ve üçüncü kişilerin yeniden yayınları eklenmez. Adresler zamanla değişebilir:
// açılmayan kanal olursa yayıncının "canlı yayın" sayfasından yenisi bulunur.
// Bazı TRT kanalları (TRT 2, TRT Genç, TRT Spor Yıldız) sadece Türkiye'den açılır.
// group: kanal listesindeki grup. Sıra = kanal numarası (1'den başlar).
// tvgId: XMLTV (EPG) eşleşmesi için kullanılan kimlik. Varsayılan kaynak: iptv-org/epg. Yanlışsa
//   kanalın "şimdi / sırada" bilgisi boş kalır; başka bir kaynak farklı kimlik kullanıyorsa güncellenir.
var TV_CHANNELS = [
  { group: "Ulusal", name: "TRT 1",       tvgId: "TRT1.tr",         url: "https://tv-trt1.medya.trt.com.tr/master.m3u8" },
  { group: "Ulusal", name: "Kanal D",     tvgId: "KanalD.tr",       url: "https://demiroren.daioncdn.net/kanald/kanald.m3u8?app=kanald_web&ce=3" },
  { group: "Ulusal", name: "Star TV",     tvgId: "StarTV.tr",       url: "https://dogus.daioncdn.net/startv/startv.m3u8?app=startv_web&ce=3" },
  { group: "Ulusal", name: "TV8",         tvgId: "TV8.tr",          url: "https://tv8.daioncdn.net/tv8/tv8.m3u8?app=7ddc255a-ef47-4e81-ab14-c0e5f2949788&ce=3" },
  { group: "Ulusal", name: "TRT 2",       tvgId: "TRT2.tr",         url: "https://tv-trt2.medya.trt.com.tr/master.m3u8" },
  { group: "Haber",  name: "TRT Haber",   tvgId: "TRTHaber.tr",     url: "https://tv-trthaber.medya.trt.com.tr/master.m3u8" },
  { group: "Haber",  name: "NTV",         tvgId: "NTV.tr",          url: "https://dogus.daioncdn.net/ntv/ntv.m3u8?app=ntv_web" },
  { group: "Haber",  name: "Habertürk",   tvgId: "Haberturk.tr",    url: "https://ciner.daioncdn.net/haberturktv/haberturktv.m3u8?app=c98ab0b0-50cc-495b-bb37-778e91f5ff5b&ce=3" },
  { group: "Haber",  name: "Halk TV",     tvgId: "HalkTV.tr",       url: "https://halktv-live.daioncdn.net/halktv/halktv.m3u8" },
  { group: "Haber",  name: "Sözcü TV",    tvgId: "SozcuTV.tr",      url: "https://sozcutv-live.daioncdn.net/sozcutv/sozcutv.m3u8" },
  { group: "Haber",  name: "TGRT Haber",  tvgId: "TGRTHaber.tr",    url: "https://canli.tgrthaber.com/tgrt.m3u8" },
  { group: "Haber",  name: "24 TV",       tvgId: "TV24.tr",         url: "https://turkmedya-live.ercdn.net/tv24/tv24.m3u8" },
  { group: "Haber",  name: "TRT World",   tvgId: "TRTWorld.tr",     url: "https://tv-trtworld.medya.trt.com.tr/master.m3u8" },
  { group: "Haber",  name: "TBMM TV",     tvgId: "TBMMTV.tr",       url: "https://meclistv-live.ercdn.net/meclistv/meclistv.m3u8" },
  { group: "Ekonomi", name: "Bloomberg HT", tvgId: "BloombergHT.tr", url: "https://ciner.daioncdn.net/bloomberght/bloomberght.m3u8?app=web&ce=3" },
  { group: "Ekonomi", name: "Ekotürk",    tvgId: "Ekoturk.tr",      url: "https://cdn.ekoturk.net/hls/master.m3u8" },
  { group: "Spor",   name: "TRT Spor",    tvgId: "TRTSpor.tr",      url: "https://tv-trtspor1.medya.trt.com.tr/master.m3u8" },
  { group: "Spor",   name: "TRT Spor Yıldız", tvgId: "TRTSporYildiz.tr", url: "https://tv-trtspor2.medya.trt.com.tr/master.m3u8" },
  { group: "Spor",   name: "HT Spor",     tvgId: "HTSpor.tr",       url: "https://ciner.daioncdn.net/ht-spor/ht-spor.m3u8?app=web" },
  { group: "Spor",   name: "TJK TV",      tvgId: "TJKTV.tr",        url: "https://tjktv-live.tjk.org/tjktv.m3u8" },
  { group: "Çocuk",  name: "TRT Çocuk",   tvgId: "TRTCocuk.tr",     url: "https://tv-trtcocuk.medya.trt.com.tr/master.m3u8" },
  { group: "Çocuk",  name: "TRT Diyanet Çocuk", tvgId: "TRTDiyanetCocuk.tr", url: "https://tv-trtdiyanetcocuk.medya.trt.com.tr/master.m3u8" },
  { group: "Belgesel ve Kültür", name: "TRT Belgesel", tvgId: "TRTBelgesel.tr", url: "https://tv-trtbelgesel.medya.trt.com.tr/master.m3u8" },
  { group: "Belgesel ve Kültür", name: "TRT Genç",     tvgId: "TRTGenc.tr",     url: "https://tv-trtgenc.medya.trt.com.tr/master.m3u8" },
  { group: "Belgesel ve Kültür", name: "TRT Türk",     tvgId: "TRTTurk.tr",     url: "https://tv-trtturk.medya.trt.com.tr/master.m3u8" },
  { group: "Belgesel ve Kültür", name: "TRT Avaz",     tvgId: "TRTAvaz.tr",     url: "https://tv-trtavaz.medya.trt.com.tr/master.m3u8" },
  { group: "Belgesel ve Kültür", name: "TRT Kurdî",    tvgId: "TRTKurdi.tr",    url: "https://tv-trtkurdi.medya.trt.com.tr/master.m3u8" },
  { group: "Belgesel ve Kültür", name: "TRT EBA",      tvgId: "TRTEBATV.tr",    url: "https://tv-e-okul01.medya.trt.com.tr/master.m3u8" },
  { group: "Belgesel ve Kültür", name: "TV4",          tvgId: "TV4.tr",         url: "https://turkmedya-live.ercdn.net/tv4/tv4.m3u8" },
  { group: "Müzik",  name: "TRT Müzik",   tvgId: "TRTMuzik.tr",     url: "https://tv-trtmuzik.medya.trt.com.tr/master.m3u8" },
  { group: "Müzik",  name: "Kral Pop TV", tvgId: "KralPopTV.tr",    url: "https://dogus-live.daioncdn.net/kralpoptv/playlist.m3u8" }
];

if (typeof module !== "undefined" && module.exports) { module.exports = TV_CHANNELS; }
