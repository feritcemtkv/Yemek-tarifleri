#!/usr/bin/env python3
"""Eski tarif arşivini (tarif_projesi/tarifler) Tariflerim sunucusuna aktarır.

Her tarif klasöründen veri.json, kapak.jpg ve Tarifi_Ac.html içine gömülü videoyu alır.
Instagram kısa koduna göre daha önce aktarılmış tarifleri atlar; tekrar çalıştırmak güvenlidir.

Kullanım (Surface'ta):
    python3 ~/tarif-site/eski-tarifleri-aktar.py ~/tarif-aktarim/tarifler [--deneme]
"""
import base64
import json
import os
import re
import secrets
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

SUNUCU = 'http://127.0.0.1:8095'
PB = os.path.expanduser('~/tarif-site/pb/pocketbase')
VERI = os.path.expanduser('~/tarif-site/veri')
ATLA = {'Mobil'}  # liste sayfaları, tarif değil


def yonetici_belirteci():
    """Yerel yönetici hesabının şifresini rastgele yeniler ve belirteç alır."""
    sifre = secrets.token_urlsafe(24)
    subprocess.run([PB, 'superuser', 'upsert', 'betik@yerel.test', sifre, f'--dir={VERI}'],
                   check=True, capture_output=True)
    return istek('/api/collections/_superusers/auth-with-password',
                 json.dumps({'identity': 'betik@yerel.test', 'password': sifre}).encode(),
                 {'Content-Type': 'application/json'})['token']


def istek(yol, govde=None, basliklar=None, yontem=None):
    r = urllib.request.Request(SUNUCU + yol, data=govde, headers=basliklar or {},
                               method=yontem or ('POST' if govde is not None else 'GET'))
    with urllib.request.urlopen(r, timeout=300) as y:
        return json.load(y)


def cok_parcali(alanlar, dosyalar):
    sinir = uuid.uuid4().hex
    parcalar = []
    for ad, deger in alanlar.items():
        parcalar.append(f'--{sinir}\r\nContent-Disposition: form-data; name="{ad}"\r\n\r\n'.encode()
                        + str(deger).encode() + b'\r\n')
    for ad, (dosya_adi, tur, veri) in dosyalar.items():
        parcalar.append(f'--{sinir}\r\nContent-Disposition: form-data; name="{ad}"; filename="{dosya_adi}"\r\n'
                        f'Content-Type: {tur}\r\n\r\n'.encode() + veri + b'\r\n')
    parcalar.append(f'--{sinir}--\r\n'.encode())
    return b''.join(parcalar), f'multipart/form-data; boundary={sinir}'


def malzeme_metni(m):
    if isinstance(m, str):
        return m.strip()
    miktar, birim, ad = (str(m.get(k) or '').strip() for k in ('miktar', 'birim', 'ad'))
    gram = str(m.get('gram_karsiligi') or '').strip()
    metin = ' '.join(x for x in (miktar, birim, ad) if x)
    if gram and not (birim in ('gram', 'g', 'gr') and gram == miktar):
        metin += f' ({gram} g)'
    return metin


def metin_listesi(x):
    if isinstance(x, list):
        return '\n'.join(str(s).strip() for s in x if str(s).strip())
    return str(x or '').strip()


def kisa_kod(d, klasor):
    if d.get('shortcode'):
        return d['shortcode']
    m = re.search(r'instagram\.com/(?:p|reel|reels)/([^/?#]+)', d.get('instagram_url') or '')
    return m.group(1) if m else 'klasor:' + klasor


def video_cikar(html_yolu):
    if not os.path.exists(html_yolu):
        return None
    with open(html_yolu, encoding='utf-8') as f:
        html = f.read()
    m = re.search(r'src="data:(video/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)"', html)
    if not m:
        return None
    return m.group(1), base64.b64decode(m.group(2))


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    kok = os.path.expanduser(sys.argv[1])
    deneme = '--deneme' in sys.argv

    sira = {}
    try:
        with open(os.path.join(kok, '_islenen_tarifler.json'), encoding='utf-8') as f:
            for kod, bilgi in json.load(f).items():
                sira[bilgi.get('klasor', '')] = bilgi.get('eklenme_tarihi', '')
    except (OSError, ValueError):
        pass

    klasorler = []
    for kategori in sorted(os.listdir(kok)):
        kyol = os.path.join(kok, kategori)
        if kategori.startswith(('_', '.')) or kategori in ATLA or not os.path.isdir(kyol):
            continue
        for ad in sorted(os.listdir(kyol)):
            if os.path.exists(os.path.join(kyol, ad, 'veri.json')):
                klasorler.append(f'{kategori}/{ad}')
    klasorler.sort(key=lambda k: sira.get(k, ''))  # en eski önce; uygulamada en yeni üstte görünür
    print(f'{len(klasorler)} tarif klasörü bulundu.')

    token = None if deneme else yonetici_belirteci()
    eklendi = atlandi = hata = 0
    for i, klasor in enumerate(klasorler, 1):
        yol = os.path.join(kok, klasor)
        with open(os.path.join(yol, 'veri.json'), encoding='utf-8') as f:
            d = json.load(f)
        kod = kisa_kod(d, klasor)
        kayit = {
            'title': (d.get('baslik') or klasor.split('/')[-1].replace('_', ' ')).strip(),
            'category': (d.get('kategori') or klasor.split('/')[0]).strip(),
            'ingredients': json.dumps([s for s in map(malzeme_metni, d.get('malzemeler') or []) if s],
                                      ensure_ascii=False),
            'instructions': metin_listesi(d.get('adimlar')),
            'url': d.get('instagram_url') or '',
            'porsiyon': d.get('porsiyon') or '',
            'hazirlik': d.get('hazirlik_suresi') or '',
            'pisirme': d.get('pisirme_suresi') or '',
            'notlar': metin_listesi(d.get('notlar')),
            'thermomix': metin_listesi(d.get('thermomix_adimlar')),
            'yazar': d.get('yazar') or '',
            'kod': kod,
            'favorite': 'false',
        }
        dosyalar = {}
        kapak = os.path.join(yol, 'kapak.jpg')
        if os.path.exists(kapak):
            with open(kapak, 'rb') as f:
                dosyalar['kapak'] = ('kapak.jpg', 'image/jpeg', f.read())
        video = video_cikar(os.path.join(yol, 'Tarifi_Ac.html'))
        if video:
            tur, veri = video
            dosyalar['video'] = ('video.mp4' if tur == 'video/mp4' else 'video.mov', tur, veri)

        etiket = f'[{i}/{len(klasorler)}] {kayit["title"]}'
        if deneme:
            print(etiket, '| kapak' if 'kapak' in dosyalar else '| kapak YOK',
                  f'| video {len(video[1]) // 1024 // 1024} MB' if video else '| video YOK')
            continue
        filtre = urllib.parse.quote(f'kod="{kod}"')
        var = istek(f'/api/collections/tarifler/records?filter={filtre}&perPage=1&skipTotal=1',
                    basliklar={'Authorization': token})['items']
        if var:
            atlandi += 1
            continue
        govde, tur = cok_parcali(kayit, dosyalar)
        try:
            istek('/api/collections/tarifler/records', govde, {'Content-Type': tur, 'Authorization': token})
            eklendi += 1
            print(etiket, 'eklendi')
        except urllib.error.HTTPError as e:
            hata += 1
            print(etiket, 'HATA', e.code, e.read().decode()[:300])
    if not deneme:
        print(f'Bitti: {eklendi} eklendi, {atlandi} zaten vardı, {hata} hata.')
    sys.exit(1 if hata else 0)


if __name__ == '__main__':
    main()
