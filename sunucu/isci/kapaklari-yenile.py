#!/usr/bin/env python3
"""Mevcut tariflerin kapaklarını videodan seçilen en iyi kareyle yeniler.

Her tarif için Claude, mevcut kapak ve videodan 16 kare arasından seçim yapar. Mevcut kapak
iyiyse dokunulmaz. Değişen eski kapaklar ~/yedekler/tarif/eski-kapaklar/ altına kopyalanır.
Yarıda kalırsa tekrar çalıştırmak güvenlidir; işlenenler kapaklar-durum.json'da tutulur.

Kullanım:  ~/tarif-site/isci/.venv/bin/python ~/tarif-site/isci/kapaklari-yenile.py [--hepsi-yeniden]
"""
from __future__ import annotations

import json
import shutil
import sqlite3
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import importlib.util  # noqa: E402

_spec = importlib.util.spec_from_file_location("tarif_isci", Path(__file__).resolve().parent / "tarif-isci.py")
isci = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(isci)
import kapak  # noqa: E402

DURUM = isci.ISCI / "kapaklar-durum.json"
YEDEK = Path.home() / "yedekler" / "tarif" / "eski-kapaklar"


def main():
    durum = {} if "--hepsi-yeniden" in sys.argv or not DURUM.exists() else json.loads(DURUM.read_text())
    YEDEK.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(f"file:{isci.VERI / 'data.db'}?mode=ro", uri=True)
    cid = db.execute("select id from _collections where name='tarifler'").fetchone()[0]
    kayitlar = db.execute("select id, title, kapak, video from tarifler order by created").fetchall()
    db.close()
    depo = isci.VERI / "storage" / cid
    sunucu = isci.Sunucu()
    sunucu_hesap = "kapak@yerel.test"
    isci.HESAP = sunucu_hesap          # bu betik kendi yönetici hesabını kullansın
    degisti = ayni = hata = 0
    (isci.ISCI / "gecici").mkdir(parents=True, exist_ok=True)
    for n, (rid, baslik, kapak_ad, video_ad) in enumerate(kayitlar, 1):
        if rid in durum:
            continue
        etiket = f"[{n}/{len(kayitlar)}] {baslik}"
        mevcut = depo / rid / kapak_ad if kapak_ad else None
        video = depo / rid / video_ad if video_ad else None
        if not video or not video.exists():
            durum[rid] = {"sonuc": "video yok"}
            continue
        with tempfile.TemporaryDirectory(prefix="kapak-", dir=isci.ISCI / "gecici") as g:
            k = Path(g)
            try:
                yeni, secim, neden = kapak.en_iyi_kapak(k, baslik, mevcut if mevcut and mevcut.exists() else None,
                                                       video, isci.CLAUDE)
                if yeni:
                    if mevcut and mevcut.exists():
                        shutil.copyfile(mevcut, YEDEK / f"{rid}.jpg")
                    sunucu.istek_dosya(rid, yeni)
                    degisti += 1
                    durum[rid] = {"sonuc": "degisti", "secim": secim, "neden": neden}
                    print(etiket, f"→ kare {secim}: {neden}", flush=True)
                else:
                    ayni += 1
                    durum[rid] = {"sonuc": "ayni", "secim": secim, "neden": neden}
                    print(etiket, f"→ aynı kaldı: {neden}", flush=True)
            except Exception as e:  # tek tarifin hatası diğerlerini durdurmasın
                hata += 1
                print(etiket, "HATA", str(e)[:300], flush=True)
                if "limit" in str(e).lower():
                    print("Claude kullanım sınırı; 10 dakika bekleniyor", flush=True)
                    time.sleep(600)
                continue
        DURUM.write_text(json.dumps(durum, ensure_ascii=False, indent=1))
    DURUM.write_text(json.dumps(durum, ensure_ascii=False, indent=1))
    print(datetime.now().strftime("%F %T"), f"Bitti: {degisti} kapak değişti, {ayni} aynı kaldı, {hata} hata.", flush=True)


if __name__ == "__main__":
    main()
