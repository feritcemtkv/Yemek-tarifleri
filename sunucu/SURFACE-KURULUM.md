# Tariflerim: Surface kurulumu

Uygulama `app/` klasöründe, sunucu dosyaları bu klasörde. Surface'taki LGS kurulumuyla aynı düzende çalışır.

## Nasıl çalışıyor

- Surface'ta ayrı bir **PocketBase** süreci `127.0.0.1:8095` adresinde çalışır. Tarifler, kullanıcı
  girişi ve uygulama dosyaları buradan sunulur. GitHub'a ihtiyaç yoktur.
- Cloudflare Tunnel `tarif.ogrencitakip.net.tr` adresini doğrudan bu porta bağlar. Apache kullanılmaz.
- Yönetim paneli (`/_/`) ve yönetici girişi internetten kapalıdır (`pb_hooks/panel-kapat.pb.js`).
- Dışarıdan kayıt olma kapalıdır. Tarifleri yalnızca giriş yapan kullanıcı görür.
- Uygulama son tarif listesini telefonda da saklar. Surface'a ulaşamadığında da tarifler açılır.

## Surface'taki dosyalar

```
~/tarif-site/
  baslat.sh            cron her 5 dakikada ve açılışta çalıştırır
  yedek-al.sh          her gece 23:20, ~/yedekler/tarif/<tarih>/ (30 gün) + medya/ aynası
  eski-tarifleri-aktar.py  eski arşivi fotoğraf ve videolarıyla aktarır
  kullanici-ekle.sh    uygulama hesabı oluşturur / şifre değiştirir
  pb/pocketbase
  pb/pb_public/        app/ klasörünün kopyası
  pb/pb_migrations/
  pb/pb_hooks/
  veri/                veritabanı
  pb.log
```

Crontab satırları:

```
@reboot $HOME/tarif-site/baslat.sh
*/5 * * * * $HOME/tarif-site/baslat.sh
20 23 * * * $HOME/tarif-site/yedek-al.sh >> $HOME/yedek/tarif.log 2>&1
```

## Kullanıcının yapacakları

1. **Cloudflare:** Zero Trust → Networks → Tunnels → mevcut tünel → Public Hostname → Add:
   subdomain `tarif`, domain `ogrencitakip.net.tr`, service `HTTP` → `localhost:8095`.
2. **Hesap:** Mac terminalinde şunu çalıştır, e-posta ve şifreyi kendin yaz:

   ```bash
   ssh -t feritcem@100.73.206.24 '~/tarif-site/kullanici-ekle.sh'
   ```

3. **iPhone:** Safari'de `https://tarif.ogrencitakip.net.tr` → Paylaş → **Ana Ekrana Ekle**.
   Ana ekrandaki **Tariflerim** ikonundan aç, giriş yap. Ayarlar'dan Gemini API anahtarını gir.

## Yönetim paneli

Yalnızca SSH tüneliyle açılır:

```bash
ssh -L 8095:127.0.0.1:8095 feritcem@100.73.206.24
```

Sonra tarayıcıda `http://127.0.0.1:8095/_/`. Panel hesabı yoksa Surface'ta:
`~/tarif-site/pb/pocketbase superuser upsert EPOSTA 'SIFRE' --dir=$HOME/tarif-site/veri`

## Güncelleme

`app/` değişince `app/sw.js` içindeki `SURUM` değerini artır, dosyaları `~/tarif-site/pb/pb_public/`
altına kopyala. Servisi yeniden başlatmak gerekmez. Migration veya hook değişirse:
`pkill -f 'tarif-site/pb/pocketbase serve' && ~/tarif-site/baslat.sh`

## Eski tarifleri aktarma

Eski arşiv (`tarif_projesi/tarifler/<Kategori>/<Tarif>/`) fotoğraf ve videolarıyla birlikte
`eski-tarifleri-aktar.py` ile aktarılır. Arşivi Surface'a kopyala, sonra:

```bash
python3 ~/tarif-site/eski-tarifleri-aktar.py ~/tarif-aktarim/tarifler --deneme   # yalnızca listeler
python3 ~/tarif-site/eski-tarifleri-aktar.py ~/tarif-aktarim/tarifler
```

Instagram kısa koduna göre aktarılmış tarifleri atlar; yarıda kalırsa tekrar çalıştırmak güvenlidir.

Fotoğraf ve videolar `~/tarif-site/veri/storage/` altında durur. Gece yedeği bunları
`~/yedekler/tarif/medya/` aynasına ekler.

Uygulamada Ayarlar → **Dosyadan tarif aktar** ayrıca şu biçimdeki JSON listesini kabul eder.
Aynı adlı tarifler atlanır.

```json
[{ "title": "...", "category": "...", "ingredients": ["..."], "instructions": "adım 1\nadım 2", "url": "" }]
```
