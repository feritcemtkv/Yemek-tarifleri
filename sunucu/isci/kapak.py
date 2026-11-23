"""Tarif kapağı seçimi: videodan aday kareler çıkarır, Claude'a en iyi kapağı seçtirir.

Aday 0 her zaman mevcut kapaktır (varsa). Claude yazısız, insansız ve bitmiş yemeği
iştah açıcı gösteren kareyi seçer; seçilen kare tam çözünürlükte kapak.jpg olarak yazılır.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

ADAY = 16                 # videodan alınacak kare sayısı
HUCRE = (240, 300)        # panodaki her karenin boyutu (dikey video oranı)
SUTUN = 6

SEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["secim", "neden"],
    "properties": {"secim": {"type": "integer"}, "neden": {"type": "string"}},
}


def ffmpeg():
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def video_suresi(video: Path) -> float:
    r = subprocess.run([ffmpeg(), "-i", str(video)], capture_output=True, text=True)
    import re
    m = re.search(r"Duration: (\d+):(\d+):(\d+\.\d+)", r.stderr)
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3)) if m else 0.0


def kare_al(video: Path, saniye: float, hedef: Path, genislik: int | None = None) -> bool:
    vf = ["-vf", f"scale='min({genislik},iw)':-2"] if genislik else []
    subprocess.run([ffmpeg(), "-v", "error", "-y", "-ss", f"{saniye:.2f}", "-i", str(video),
                    "-frames:v", "1", *vf, "-q:v", "2", str(hedef)], capture_output=True)
    return hedef.exists() and hedef.stat().st_size > 0


def pano_yap(klasor: Path, mevcut_kapak: Path | None, video: Path | None):
    """Numaralı aday panosu (pano.jpg) üretir. Dönen sözlük: numara -> ('kapak', yol) | ('kare', saniye)."""
    from PIL import Image, ImageDraw, ImageFont, ImageOps
    adaylar: dict[int, tuple[str, object]] = {}
    resimler = []
    if mevcut_kapak and mevcut_kapak.exists():
        adaylar[0] = ("kapak", mevcut_kapak)
        resimler.append((0, mevcut_kapak))
    if video:
        sure = video_suresi(video)
        if sure > 1:
            bas, son = sure * 0.04, sure * 0.97
            for j in range(ADAY):
                s = bas + (son - bas) * j / (ADAY - 1)
                p = klasor / f"aday_{j + 1:02d}.jpg"
                if kare_al(video, s, p, 480):
                    adaylar[j + 1] = ("kare", s)
                    resimler.append((j + 1, p))
    if not resimler:
        return None, {}
    satir = (len(resimler) + SUTUN - 1) // SUTUN
    pano = Image.new("RGB", (HUCRE[0] * SUTUN, HUCRE[1] * satir), "white")
    try:
        yazi = ImageFont.truetype("DejaVuSans-Bold.ttf", 34)
    except OSError:
        yazi = ImageFont.load_default(size=34)
    for n, (no, yol) in enumerate(resimler):
        im = ImageOps.fit(Image.open(yol).convert("RGB"), HUCRE)
        x, y = (n % SUTUN) * HUCRE[0], (n // SUTUN) * HUCRE[1]
        pano.paste(im, (x, y))
        d = ImageDraw.Draw(pano)
        d.rectangle([x + 6, y + 6, x + 62, y + 50], fill=(0, 0, 0))
        d.text((x + 34, y + 28), str(no), fill=(255, 255, 0), font=yazi, anchor="mm")
    pano.save(klasor / "pano.jpg", quality=85)
    return klasor / "pano.jpg", adaylar


ISTEM = """pano.jpg dosyasını Read aracıyla aç. Bu bir yemek tarifinin kapak resmi için adayları gösteren
numaralı bir pano ("{baslik}"). Her karenin sol üst köşesinde siyah kutuda numarası yazıyor.{mevcut}

Tarif listesinde kapak olarak en iyi duracak kareyi seç:
- Bitmiş yemeği (tabakta, tavada ya da serviste) net ve iştah açıcı göstersin.
- Üzerinde büyük yazı, altyazı, logo ya da "before/after" gibi etiketler olmasın.
- İnsan yüzü veya yemekle ilgisi olmayan sahne olmasın; yemeği tutan el sorun değil.
- Bulanık, karanlık ya da geçiş anına denk gelen kareleri seçme.
Mevcut kapak bu koşulları zaten iyi karşılıyorsa onu (0) seç. Hiçbiri mükemmel değilse en iyisini seç.
Seçtiğin numarayı ve kısa nedenini istenen JSON yapısında ver."""


def claude_sec(klasor: Path, baslik: str, mevcut_var: bool, claude: str, sure: int = 300) -> tuple[int, str]:
    mevcut = " 0 numaralı kare şu anki kapak; diğerleri videodan alınmış kareler." if mevcut_var else ""
    komut = [claude, "-p", ISTEM.format(baslik=baslik.replace('"', "'"), mevcut=mevcut),
             "--tools", "Read", "--allowedTools", "Read", "--strict-mcp-config", "--no-session-persistence",
             "--output-format", "json", "--json-schema", json.dumps(SEMA)]
    r = subprocess.run(komut, cwd=klasor, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=sure)
    cevap = json.loads(r.stdout)
    if cevap.get("is_error"):
        raise RuntimeError(str(cevap.get("result"))[:300])
    s = cevap.get("structured_output") or json.loads(cevap.get("result") or "{}")
    return int(s["secim"]), str(s.get("neden", ""))


def en_iyi_kapak(klasor: Path, baslik: str, mevcut_kapak: Path | None, video: Path | None,
                 claude: str) -> tuple[Path | None, int, str]:
    """Seçilen kapağı klasor/kapak-secilen.jpg olarak yazar. (yol, seçim, neden) döner; yol None ise değişiklik yok."""
    pano, adaylar = pano_yap(klasor, mevcut_kapak, video)
    if not pano:
        return None, -1, "aday yok"
    secim, neden = claude_sec(klasor, baslik, 0 in adaylar, claude)
    if secim not in adaylar:
        return None, secim, "geçersiz seçim"
    tur, deger = adaylar[secim]
    hedef = klasor / "kapak-secilen.jpg"
    if tur == "kapak":
        shutil.copyfile(deger, hedef)
        return (hedef if mevcut_kapak is None else None), secim, neden
    if not kare_al(video, float(deger), hedef, 1080):
        return None, secim, "kare çıkarılamadı"
    return hedef, secim, neden
