import struct
from PIL import Image

im = Image.open('/tmp/splash-preview2.png').convert('RGB')
w, h = im.size
assert (w, h) == (1920, 1080)
px = im.load()

# BMP v3 header (56 bytes info header), 16bpp, BI_BITFIELDS, RGB565, bottom-up
row = w * 2
imgsize = row * h
dataoffset = 14 + 56
filesize = dataoffset + imgsize

out = bytearray()
out += struct.pack('<2sIHHI', b'BM', filesize, 0, 0, dataoffset)
out += struct.pack('<IiiHHIIiiII', 56, w, h, 1, 16, 3, imgsize, 2835, 2835, 0, 0)
out += struct.pack('<III', 0xF800, 0x07E0, 0x001F)  # masks RGB565

buf = bytearray(imgsize)
for y in range(h):
    yy = h - 1 - y          # bottom-up
    base = yy * row
    for x in range(w):
        r, g, b = px[x, y]
        v = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)
        buf[base + x*2] = v & 0xFF
        buf[base + x*2 + 1] = (v >> 8) & 0xFF
out += buf
open('/tmp/splash-santrimu.bmp', 'wb').write(bytes(out))
print("BMP:", len(out), "bytes (asli Google:", 4147272, ")")
