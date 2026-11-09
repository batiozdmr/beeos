# Marka politikası ve takedown

beeOS bir kullanıcı arayüzüdür; **Netflix, YouTube, Prime Video, Disney+, Spotify** ve diğer tüm
üçüncü taraf marka adları ile logoları sahiplerinin tescilli markalarıdır. beeOS bu şirketlerle
bağlantılı değildir, onların adına çalışmaz, onların adına kullanıcı verisi toplamaz.

## Logo kaynakları
Ayrıntılı liste [LOGOS.md](LOGOS.md) içinde — her logonun lisansı, sürümü, nereden alındığı.

## Kullanım ilkesi
- Logolar değiştirilmez, üstüne yazılmaz, başka bir marka/ürünle karıştırılacak biçimde yan yana gelmez.
- beeOS bir kartın açacağı uygulamanın **kısayolu** olarak logoyu gösterir; o uygulamayı barındırmaz,
  içeriğini sunmaz, trafiğini aracılar.
- Canlı TV kartında yalnızca yayıncıların kendi sitelerinde **ücretsiz** sundukları resmî HLS
  adresleri kullanılır. Şifreli/süreli imzalı yayınlar, üçüncü kişilerin yeniden yayınları eklenmez.

## Takedown süreci
Marka sahibi veya yetkili temsilcisi iseniz ve bir logonun / adın kaldırılmasını istiyorsanız:

1. `legal@beeuptech.example` adresine aşağıdakileri içeren bir e-posta atın:
   - Marka / logo adı
   - Hak sahipliğini gösteren belge (tescil numarası veya temsil yetki belgesi)
   - İstenen eylem: kaldırma / değiştirme / jenerik ikonla değiştirme
2. **Taahhüt süresi: 48 saat** içinde doğrulama sonrası ilgili dosya `logos/<marka>.png` ve
   `js/config.js` kartı:
   - Logo yerine `logos/placeholder.png` ile değiştirilir (`tools/build_logos.py --redact <marka>`)
   - Kart etiketi "<marka>" → "Uygulama" olarak genelleştirilir
   - Yeni bir patch sürüm yayımlanır, güncelleme sistemiyle cihazlara iner
3. Değişiklik git geçmişinde `trademark: <marka> redaction` commit mesajıyla kalır.

## Disney+ işareti
Disney+ için şu an `logos/disneyplus.png` elle çizilmiş bir işarettir (Simple Icons kataloğunda
CC0 Disney+ logosu bulunmuyor). Marka sahibinden geri bildirim gelirse:
- Birincil: logo tümüyle kaldırılır, generic "D+" metin işareti kullanılır
- İkincil: resmi marka yönergesine uyan bir sürüm sağlanırsa o kullanılır
