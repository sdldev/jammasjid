from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageOps

W, H = 1920, 1080
img = Image.new('RGB', (W, H), (0, 0, 0))
top = (2, 6, 5)
bot = (6, 26, 20)
for y in range(H):
    t = y / H
    img.paste((int(top[0]+(bot[0]-top[0])*t), int(top[1]+(bot[1]-top[1])*t), int(top[2]+(bot[2]-top[2])*t)), (0, y, W, y+1))

# --- Logo: crop ketat ke konten, alpha dari luminansi, lalu dipertajam ---
logo = Image.open('/home/indatech/Documents/MASJID/jam-masjid/public/img/logo.webp').convert('RGB')
gray = ImageOps.invert(logo.convert('L'))
bbox = gray.point(lambda p: 255 if p > 12 else 0).getbbox()
logo = logo.crop(bbox)
gray = ImageOps.invert(logo.convert('L'))
# bersihkan noise: threshold lembut
alpha = gray.point(lambda p: 0 if p < 20 else min(255, int((p-20) * 255/235)))
rgba = logo.convert('RGBA'); rgba.putalpha(alpha)
target_w = 520
ratio = target_w / rgba.width
logo_big = rgba.resize((target_w, int(rgba.height*ratio)), Image.LANCZOS)

lx = (W - logo_big.width)//2
ly = 150

# glow lembut di belakang
glow = Image.new('RGBA', (W, H), (0,0,0,0))
gd = ImageDraw.Draw(glow)
gcx, gcy = W//2, ly + logo_big.height//2
for r, a in [(420, 14), (320, 20), (230, 26)]:
    gd.ellipse([gcx-r, gcy-r, gcx+r, gcy+r], fill=(20, 90, 60, a))
glow = glow.filter(ImageFilter.GaussianBlur(60))
img = Image.alpha_composite(img.convert('RGBA'), glow)
img.paste(logo_big, (lx, ly), logo_big)

d = ImageDraw.Draw(img)
F_SKETSA = '/home/indatech/Documents/MASJID/jam-masjid/public/fonts/Sketsaramadhan-nRLAO.otf'
F_SANS_B = '/usr/share/fonts/opentype/urw-base35/NimbusSans-Bold.otf'
F_SANS   = '/usr/share/fonts/opentype/urw-base35/NimbusSans-Regular.otf'

def center(text, font, y, fill, spacing=0):
    if spacing:
        widths = [d.textlength(ch, font=font) for ch in text]
        total = sum(widths) + spacing*(len(text)-1)
        x = (W-total)/2
        for ch, wch in zip(text, widths):
            d.text((x, y), ch, font=font, fill=fill)
            x += wch + spacing
    else:
        tw = d.textlength(text, font=font)
        d.text(((W-tw)/2, y), text, font=font, fill=fill)

gold = (226, 173, 0); white = (240, 240, 235); teal = (51, 204, 204)

y0 = ly + logo_big.height + 70          # ~770
f_title = ImageFont.truetype(F_SKETSA, 140)
center("Praying Times", f_title, y0, white)

line_w = 300
d.rectangle([(W-line_w)//2, y0+190, (W+line_w)//2, y0+193], fill=gold)

f_by = ImageFont.truetype(F_SANS, 36)
center("by", f_by, y0+222, (150, 150, 145))

f_brand = ImageFont.truetype(F_SANS_B, 72)
center("SANTRIMU", f_brand, y0+278, teal, spacing=16)   # ~y0+350 masih < 1080

img.convert('RGB').save('/tmp/splash-preview2.png')
print("OK", img.size)
