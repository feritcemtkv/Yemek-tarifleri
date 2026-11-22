#!/bin/bash
# Tariflerim (PocketBase). 127.0.0.1:8095'te çalışır; internete Cloudflare Tunnel ile açılır.
# Cron her 5 dakikada ve açılışta çağırır; zaten çalışıyorsa hiçbir şey yapmaz.
cd "$HOME/tarif-site/pb" || exit 1
pgrep -u "$USER" -f 'tarif-site/pb/pocketbase serve' >/dev/null && exit 0
nohup "$HOME/tarif-site/pb/pocketbase" serve --http=127.0.0.1:8095 --dir="$HOME/tarif-site/veri" --migrationsDir="$HOME/tarif-site/pb/pb_migrations" --hooksDir="$HOME/tarif-site/pb/pb_hooks" --publicDir="$HOME/tarif-site/pb/pb_public" >> "$HOME/tarif-site/pb.log" 2>&1 &
