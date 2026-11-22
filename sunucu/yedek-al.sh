#!/bin/bash
# Tariflerim: veritabanının güvenli kopyası (SQLite backup API). 30 günlük.
# ~/yedekler/tarif/<tarih>/ ve okunabilir JSON dökümü tarifler.json
set -euo pipefail
umask 077
H="$HOME/yedekler/tarif/$(date +%F)"
mkdir -p "$H"
python3 - "$H" <<'PY'
import sqlite3, sys, os, json
h = sys.argv[1]
v = os.path.expanduser('~/tarif-site/veri')
for ad in ('data.db', 'auxiliary.db'):
    k = sqlite3.connect(f'file:{v}/{ad}?mode=ro', uri=True); y = sqlite3.connect(f'{h}/{ad}.YARIM')
    k.backup(y); y.close(); k.close()
    c = sqlite3.connect(f'{h}/{ad}.YARIM'); ok = c.execute('pragma integrity_check').fetchone()[0]; c.close()
    if ok != 'ok': raise SystemExit(f'{ad} bozuk: {ok}')
    os.rename(f'{h}/{ad}.YARIM', f'{h}/{ad}')
c = sqlite3.connect(f'{h}/data.db')
c.row_factory = sqlite3.Row
rows = [dict(r) for r in c.execute('select title, category, ingredients, instructions, url, favorite, created from tarifler order by created')]
for r in rows:
    try: r['ingredients'] = json.loads(r['ingredients'] or '[]')
    except ValueError: pass
    r['favorite'] = bool(r['favorite'])
json.dump(rows, open(f'{h}/tarifler.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'{len(rows)} tarif')
PY
echo "$(date '+%F %T') yedek alindi: $H"
find "$HOME/yedekler/tarif" -mindepth 1 -maxdepth 1 -type d -name '20??-??-??' -mtime +30 -exec rm -rf {} +
