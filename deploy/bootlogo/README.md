# Boot Logo Santrimu (STB Amlogic / Armbian)

Mengganti logo boot Google bawaan firmware STB dengan splash Santrimu.

## Isi

- `buat-splash.py` — generate desain splash 1920x1080 (logo masjid +
  "Praying Times / by / SANTRIMU") dari aset `public/img/logo.webp` +
  font `public/fonts/Sketsaramadhan-nRLAO.otf`. Output: PNG preview.
- `ke-bmp565.py` — konversi PNG → BMP 16bpp RGB565 header v3 (format yang
  dibaca u-boot Amlogic dari partisi `logo`).
- `splash-santrimu.png` / `splash-santrimu.bmp565` — hasil jadi.

## Menulis ke STB (Amlogic S905, eMMC)

Partisi `logo` di eMMC berada di offset 0x28400000 (32 MB); BMP mulai di
+0x240. Cek dulu struktur partisi perangkat target (bisa berbeda!):

```sh
# di STB, cari partisi logo:
sudo dd if=/dev/mmcblk1 bs=1M count=8 | strings | grep -m1 logo
# atau scan header BMP: cari "BM" 1920x1080 seperti deploy/bootlogo/scan

# backup dulu logo asli!
sudo dd if=/dev/mmcblk1 of=/boot/bootlogo-asli.bmp bs=1 skip=$((0x28400240)) count=4147272 iflag=skip_bytes

# tulis logo baru
sudo dd if=splash-santrimu.bmp565 of=/dev/mmcblk1 bs=1 seek=$((0x28400240)) \
  iflag=fullblock oflag=seek_bytes conv=notrunc
sudo sync
```

Restore logo asli: tulis kembali `/boot/bootlogo-asli.bmp` dengan cara yang sama.

## Catatan

- Logo hanya tampil saat cold boot (u-boot). Reboot hangat kadang melewatinya.
- Offset partisi di atas berlaku untuk eMMC 8 GB STB "rureka" (S905).
  Perangkat lain: selalu verifikasi offset partisi `logo` sebelum menulis.
