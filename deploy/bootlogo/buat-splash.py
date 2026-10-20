#!/usr/bin/env python3
"""Generator splash boot Santrimu 1920x1080.

Desain: background hitam pekat; logo masjid flat emas (alpha biner, tanpa
shading); garis aksen emas; "Praying Times" (Sketsaramadhan, putih);
"by"; "SANTRIMU" (FiraCode Bold, emas).

Jalankan dari root repo:  python3 deploy/bootlogo/buat-splash.py
Output:  deploy/bootlogo/splash-santrimu.png
Lalu konversi:           python3 deploy/bootlogo/ke-bmp565.py
"""
import os
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT  = os.path.join(ROOT, 'deploy/bootlogo/splash-santrimu.png')

# Sesuaikan path FiraCode bila dipasang di lokasi lain (apt: fonts-firacode)
F_FIRA_B = '/usr/share/fonts/truetype/firacode/FiraCode-Bold.ttf'
F_FIRA_R = '/usr/share/fonts/truetype/firacode/FiraCode-Regular.ttf'
if not os.path.exists(F_FIRA_B):
    import glob
    cand = glob.glob('/var/lib/flatpak/**/FiraCode-Bold.ttf', recursive=True)
    if cand: F_FIRA_B = cand[0]; F_FIRA_R = F_FIRA_B.replace('Bold', 'Regular')

W, H = 1920, 1080
GOLD, WHITE, MUTE = (226, 173, 0), (238, 238, 232), (110, 110, 105)

img = Image.new('RGB', (W, H), (0, 0, 0))

# --- Logo masjid → siluet flat emas (alpha biner: bentuk solid penuh) ---
logo = Image.open(os.path.join(ROOT, 'public/img/logo.webp')).convert('RGB')
gray = ImageOps.invert(logo.convert('L'))
bbox = gray.point(lambda p: 255 if p > 12 else 0).getbbox()
logo = logo.crop(bbox)
gray = ImageOps.invert(logo.convert('L'))
alpha = gray.point(lambda p: 255 if p >= 60 else 0)
flat = Image.new('RGBA', logo.size, GOLD + (0,))
flat.putalpha(alpha)
tw = 300
logo_big = flat.resize((tw, int(flat.height*tw/flat.width)), Image.LANCZOS)
logo_big.putalpha(logo_big.getchannel('A').point(lambda p: 255 if p >= 128 else 0))

CX, CY = 700, 400   # terkalibrasi: u-boot S905 scale ~0.73 + offset
ly = CY - 270
img = img.convert('RGBA')
img.paste(logo_big, (CX - logo_big.width//2, ly), logo_big)

d = ImageDraw.Draw(img)
F_SKETSA = os.path.join(ROOT, 'public/fonts/Sketsaramadhan-nRLAO.otf')

def center(text, font, y, fill, spacing=0):
    if spacing:
        ws = [d.textlength(c, font=font) for c in text]
        x = (CX - (sum(ws) + spacing*(len(text)-1))) / 2
        for c, w in zip(text, ws):
            d.text((x, y), c, font=font, fill=fill); x += w + spacing
    else:
        d.text((CX - d.textlength(text, font=font)/2, y), text, font=font, fill=fill)

y0 = ly + logo_big.height + 18
d.rectangle([CX-130, y0, CX+130, y0+3], fill=GOLD)
center("Praying Times", ImageFont.truetype(F_SKETSA, 105), y0+16, WHITE)
center("by", ImageFont.truetype(F_FIRA_R, 28), y0+130, MUTE)
center("santrimu", ImageFont.truetype(F_FIRA_R, 50), y0+168, GOLD, spacing=8)

img.convert('RGB').save(OUT)
print("tersimpan:", OUT)
