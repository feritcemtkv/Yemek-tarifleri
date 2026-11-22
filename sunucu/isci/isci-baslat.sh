#!/bin/bash
# Tariflerim işçisi: Instagram isteklerini işler. Cron her 5 dakikada ve açılışta çağırır;
# zaten çalışıyorsa hiçbir şey yapmaz.
cd "$HOME/tarif-site/isci" || exit 1
pgrep -u "$USER" -f 'tarif-site/isci/tarif-isci.py' >/dev/null && exit 0
export PATH="$HOME/.local/bin:$PATH"
nohup nice -n 10 "$HOME/tarif-site/isci/.venv/bin/python" "$HOME/tarif-site/isci/tarif-isci.py" >> "$HOME/tarif-site/isci/isci.log" 2>&1 &
