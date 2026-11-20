# Tariflerim: Surface kurulumu

Bu dosya, Surface'a bağlı Claude sohbetine (ödev takip) verilmek için yazıldı.
Uygulama `app/` klasöründe, veritabanı ayarı `sunucu/pb_migrations/` klasöründe.

## Sohbete yapıştırılacak metin

> Yemek-tarifleri deposunun `tarif-pwa` dalındaki `sunucu/SURFACE-KURULUM.md` dosyasını oku ve
> Surface'ta (feritcem@192.168.1.95) kurulumu yap. Mevcut sitelere (ödev takip, LGS) ve onların
> portlarına dokunma. sudo gereken adımları bana betik olarak ver. Bitince her adımı
> "çalıştı / engellendi / yapılmadı" diye listele.

## Nasıl çalışıyor

- Surface'ta ayrı bir **PocketBase** süreci çalışır. Tarifler, kullanıcı girişi ve uygulama
  dosyaları buradan sunulur. GitHub'a ihtiyaç yoktur.
- iPhone'daki uygulama `https://tarif.ogrencitakip.net.tr` adresinden açılır ve ana ekrana eklenir.
- Uygulama son tarif listesini telefonda da saklar. Surface'a ulaşamadığında da tarifler açılır.
- Tarifleri yalnızca giriş yapan kullanıcı görür. Dışarıdan kayıt olma kapalıdır (migration kapatır).

## Adımlar

Yollar öneridir. Surface'taki mevcut düzene (`/srv/src`, `~/sunucu`, `~/yedekler`) uyduracak şekilde değiştirilebilir.

### 1. Klasörler ve dosyalar

```bash
mkdir -p ~/tarif/app ~/tarif/pb_migrations ~/yedekler/tarif
```

Mac'teki depodan uygulamayı ve migration'ı Surface'a kopyala (GitHub gerekmez):

```bash
cd ~/Library/CloudStorage/OneDrive-Kişisel/Proje/Yemek-tarifleri
git fetch origin && git checkout tarif-pwa && git pull
rsync -a --delete app/ feritcem@192.168.1.95:tarif/app/
rsync -a sunucu/pb_migrations/ feritcem@192.168.1.95:tarif/pb_migrations/
```

### 2. PocketBase

Surface'ın mimarisine (`uname -m`) uygun en güncel PocketBase sürümünü
(test edilen sürüm v0.40.6) `~/tarif/pocketbase` olarak kur. Migration v0.23 ve sonrası içindir.

**Port:** LGS için 8090 düşünülmüştü. Tarif için **8095** kullan. Önce `ss -ltn` ile boş olduğunu doğrula.

Yönetici hesabı (yalnızca Surface'tan kullanılır, internete açılmaz):

```bash
cd ~/tarif && ./pocketbase superuser upsert YONETICI_EPOSTA 'GUCLU_SIFRE'
```

### 3. Kullanıcı servisi

`~/.config/systemd/user/tarif.service`:

```ini
[Unit]
Description=Tariflerim (PocketBase)
After=network-online.target

[Service]
WorkingDirectory=%h/tarif
ExecStart=%h/tarif/pocketbase serve --http 127.0.0.1:8095 --dir %h/tarif/pb_data --migrationsDir %h/tarif/pb_migrations --publicDir %h/tarif/app
Restart=on-failure

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload && systemctl --user enable --now tarif
loginctl enable-linger "$USER"   # oturum kapalıyken de çalışsın (zaten açıksa gerekmez)
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8095/   # 200 beklenir
```

### 4. Uygulama kullanıcısı

iPhone'dan girişte kullanılacak hesap. Yönetici belirteciyle oluşturulur:

```bash
T=$(curl -s -X POST http://127.0.0.1:8095/api/collections/_superusers/auth-with-password \
  -H 'Content-Type: application/json' \
  -d '{"identity":"YONETICI_EPOSTA","password":"GUCLU_SIFRE"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
curl -s -X POST http://127.0.0.1:8095/api/collections/users/records -H "Authorization: $T" \
  -H 'Content-Type: application/json' \
  -d '{"email":"KULLANICI_EPOSTA","password":"SIFRE","passwordConfirm":"SIFRE","verified":true}'
```

Şifreler sohbete yazılmamalı. Kullanıcı bu komutu kendi doldurup çalıştırsın.

### 5. İnternetten erişim (Apache + Cloudflare Tunnel)

Mevcut sitelerle aynı düzen: Apache'de yeni bir sanal sunucu, tünelde yeni bir adres.
**Yönetim paneli (`/_/`) internete kapalı olmalı.**

```apache
<VirtualHost 127.0.0.1:8096>
    ServerName tarif.ogrencitakip.net.tr
    ProxyPreserveHost On
    <Location "/_/">
        Require all denied
    </Location>
    ProxyPass        /_/ !
    ProxyPass        / http://127.0.0.1:8095/
    ProxyPassReverse / http://127.0.0.1:8095/
</VirtualHost>
```

(8096 örnektir. Apache'nin diğer siteler için kullandığı dinleme düzenine uydur.)

Cloudflare: Zero Trust → Networks → Tunnels → mevcut tünel → Public Hostname →
`tarif.ogrencitakip.net.tr` → `http://localhost:8096`. Bu adımı kullanıcı panelden yapar.

**Önbellek:** `sw.js`, `app.js` ve `index.html` için Cloudflare önbelleğini atla (Cache Rule:
hostname `tarif.ogrencitakip.net.tr` → Bypass cache). Böylece güncellemeler hemen gelir.

Kontrol:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://tarif.ogrencitakip.net.tr/        # 200
curl -s -o /dev/null -w "%{http_code}\n" https://tarif.ogrencitakip.net.tr/_/      # 403
curl -s https://tarif.ogrencitakip.net.tr/api/collections/tarifler/records          # boş liste (girişsiz)
```

### 6. Yedek

PocketBase'in kendi yedeğini kullan. Yönetim paneline yalnızca SSH tüneliyle gir:

```bash
ssh -L 8095:127.0.0.1:8095 feritcem@192.168.1.95   # Mac'te; sonra tarayıcıda http://127.0.0.1:8095/_/
```

Settings → Backups → otomatik yedek: `0 3 * * *`, en fazla 30 yedek. Yedekler
`~/tarif/pb_data/backups/` içine düşer. Mevcut yedek düzenine eklemek için crontab:

```
20 3 * * * rsync -a $HOME/tarif/pb_data/backups/ $HOME/yedekler/tarif/ >> $HOME/yedek/tarif.log 2>&1
```

Mac'e çeken mevcut betik (`mac-kopya.sh`) `~/yedekler/` altını alıyorsa tarif yedekleri de otomatik gelir.

### 7. Eski tarifleri aktarma

Uygulamada Ayarlar → **Dosyadan tarif aktar** şu biçimde bir JSON listesi kabul eder.
Aynı adlı tarifler atlanır.

```json
[{ "title": "...", "category": "...", "ingredients": ["..."], "instructions": "adım 1\nadım 2", "url": "" }]
```

Mac'te `OneDrive/Desktop/tarif_projesi/tarifler/Mobil/Yemek_Tarifleri.html` içinde 146 tarif var.
Bunları bu biçime çeviren bir JSON dosyası çıkar, kullanıcı da iPhone'dan veya Mac'ten içe aktarsın.

### 8. Güncelleme

`app/` değiştiğinde `sw.js` içindeki `SURUM` değerini artır ve 1. adımdaki `rsync` satırını tekrar çalıştır.
Servisi yeniden başlatmak gerekmez. Migration eklenirse `systemctl --user restart tarif`.

## iPhone'a kurulum

1. iPhone'da **Safari** ile `https://tarif.ogrencitakip.net.tr` adresini aç.
2. Paylaş düğmesi → **Ana Ekrana Ekle** → Ekle.
3. Ana ekrandaki **Tariflerim** ikonundan aç ve 4. adımdaki hesapla giriş yap.
4. Ayarlar → Gemini API anahtarını gir. Yapay zekayla tarif düzenleme bununla çalışır.
