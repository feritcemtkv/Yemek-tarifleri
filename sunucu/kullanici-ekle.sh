#!/bin/bash
# iPhone'dan giriş için uygulama hesabı oluşturur (veya şifresini değiştirir).
# Kullanım (Mac terminalinde):  ssh -t feritcem@surface '~/tarif-site/kullanici-ekle.sh'
set -euo pipefail
PB="$HOME/tarif-site/pb/pocketbase"
VERI="$HOME/tarif-site/veri"
read -rp "Uygulama e-postası: " EPOSTA
read -rsp "Şifre (en az 8 karakter): " SIFRE; echo
read -rsp "Şifre (tekrar): " SIFRE2; echo
[ "$SIFRE" = "$SIFRE2" ] || { echo "Şifreler aynı değil."; exit 1; }
[ ${#SIFRE} -ge 8 ] || { echo "Şifre en az 8 karakter olmalı."; exit 1; }
# Yerel yönetici hesabının şifresi her çalıştırmada rastgele yenilenir; kimse bilmez.
# (İnternetten yönetici girişi panel-kapat.pb.js ile zaten kapalı.)
GECICI="betik@yerel.test"
GSIFRE="$(head -c 24 /dev/urandom | base64 | tr -dc A-Za-z0-9)"
"$PB" superuser upsert "$GECICI" "$GSIFRE" --dir="$VERI" >/dev/null 2>&1
python3 - "$GECICI" "$GSIFRE" "$EPOSTA" "$SIFRE" <<'PY'
import json, sys, urllib.request, urllib.error, urllib.parse
g, gs, e, s = sys.argv[1:]
B = 'http://127.0.0.1:8095/api/collections/'
def istek(yol, veri=None, token=None, yontem=None):
    r = urllib.request.Request(B + yol, data=json.dumps(veri).encode() if veri is not None else None,
                               method=yontem or ('POST' if veri is not None else 'GET'),
                               headers={'Content-Type': 'application/json', **({'Authorization': token} if token else {})})
    with urllib.request.urlopen(r) as y: return json.load(y)
t = istek('_superusers/auth-with-password', {'identity': g, 'password': gs})['token']
filtre = urllib.parse.quote(f'email="{e}"')
var = istek(f'users/records?filter={filtre}', token=t)['items']
veri = {'email': e, 'password': s, 'passwordConfirm': s, 'verified': True}
try:
    if var:
        istek(f'users/records/{var[0]["id"]}', veri, t, 'PATCH'); print('Şifre güncellendi:', e)
    else:
        istek('users/records', veri, t); print('Hesap oluşturuldu:', e)
except urllib.error.HTTPError as h:
    print('Olmadı:', h.read().decode()); sys.exit(1)
PY
