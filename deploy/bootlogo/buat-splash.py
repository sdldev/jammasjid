from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageOps

W, H = 1920, 1080
img = Image.new('RGB', (W, H), (0, 0, 0))

logo = Image.open('/home/indatech/Documents/MASJID/jam-masjid/public/img/logo.webp').convert('RGB')
gray = ImageOps.invert(logo.convert('L'))
bbox = gray.point(lambda p: 255 if p > 12 else 0).getbbox()
logo = logo.crop(bbox)
gray = ImageOps.invert(logo.convert('L'))
alpha = gray.point(lambda p: 0 if p < 20 else min(255, int((p-20)*255/235)))
rgba = logo.convert('RGBA'); rgba.putalpha(alpha)
target_w = 400
ratio = target_w / rgba.width
logo_big = rgba.resize((target_w, int(rgba.height*ratio)), Image.LANCZOS)

# Blok konten: logo(~370) + judul(~120) + garis + by + brand(~90) ≈ 700px
# Tengah optik sedikit di atas tengah layar → mulai di y ≈ 170
ly = 170
lx = (W - logo_big.width)//2

glow = Image.new('RGBA', (W, H), (0,0,0,0))
gd = ImageDraw.Draw(glow)
gcx, gcy = W//2, ly + logo_big.height//2
for r, a in [(340, 16), (250, 22), (180, 28)]:
    gd.ellipse([gcx-r, gcy-r, gcx+r, gcy+r], fill=(18, 80, 55, a))
glow = glow.filter(ImageFilter.GaussianBlur(50))
img = Image.alpha_composite(img.convert('RGBA'), glow)
img.paste(logo_big, (lx, ly), logo_big)

d = ImageDraw.Draw(img)
F_SKETSA = '/home/indatech/Documents/MASJID/jam-masjid/public/fonts/Sketsaramadhan-nRLAO.otf'
F_FIRA_B = '/var/lib/flatpak/app/com.jetbrains.IntelliJ-IDEA-Community/x86_64/stable/c2a0d9fbe72049af239042eded486d666619d9cd10d1c0462bb106a077ad7a45/files/jbr/lib/fonts/FiraCode-Bold.ttf'
F_FIRA_R = '/var/lib/flatpak/app/com.jetbrains.IntelliJ-IDEA-Community/x86_64/stable/c2a0d9fbe72049af239042eded486d666619d9cd10d1c0462bb106a077ad7a45/files/jbr/lib/fonts/FiraCode-Regular.ttf'

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

gold  = (226, 173, 0)
white = (238, 238, 232)

y0 = ly + logo_big.height + 25

# garis aksen DI ATAS judul
line_w = 240
d.rectangle([(W-line_w)//2, y0, (W+line_w)//2, y0+3], fill=gold)

f_title = ImageFont.truetype(F_SKETSA, 118)
center("Praying Times", f_title, y0+28, white)

f_by = ImageFont.truetype(F_FIRA_R, 32)
center("by", f_by, y0+170, (110, 110, 105))

f_brand = ImageFont.truetype(F_FIRA_B, 74)
center("SANTRIMU", f_brand, y0+216, gold, spacing=12)

img.convert('RGB').save('/tmp/splash-preview4.png')
print("blok bawah berakhir y ≈", y0+216+85)
