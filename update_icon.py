#!/usr/bin/env python3
"""
Script untuk mengupdate icon ekstensi Zendesk Notifier.
Tempatkan gambar baru dengan nama 'new_icon.png' di folder ini,
lalu jalankan script ini untuk generate semua ukuran icon.
"""

import os
from PIL import Image

def update_icons():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    input_path = os.path.join(base_dir, "new_icon.png")
    
    # Cek juga format lain yang mungkin digunakan user
    alt_names = ["new_icon.jpg", "new_icon.jpeg", "logo.png", "logo.jpg", "icon_new.png"]
    
    source_image = None
    if os.path.exists(input_path):
        source_image = input_path
    else:
        for alt in alt_names:
            alt_path = os.path.join(base_dir, alt)
            if os.path.exists(alt_path):
                source_image = alt_path
                break
    
    if not source_image:
        print("❌ Error: Tidak menemukan file gambar baru.")
        print("📁 Silakan tempatkan gambar dengan salah satu nama berikut di folder ini:")
        print("   - new_icon.png (disarankan)")
        print("   - new_icon.jpg / new_icon.jpeg")
        print("   - logo.png / logo.jpg")
        print("   - icon_new.png")
        return
    
    print(f"✅ Menemukan gambar: {os.path.basename(source_image)}")
    
    try:
        # Buka gambar
        img = Image.open(source_image)
        
        # Convert ke RGBA untuk mendukung transparansi
        if img.mode != 'RGBA':
            img = img.convert('RGBA')
        
        # Crop ke persegi (center crop)
        width, height = img.size
        min_dim = min(width, height)
        left = (width - min_dim) // 2
        top = (height - min_dim) // 2
        right = left + min_dim
        bottom = top + min_dim
        
        img_cropped = img.crop((left, top, right, bottom))
        print(f"📐 Cropped ke persegi: {min_dim}x{min_dim}")
        
        # Definisi ukuran icon yang dibutuhkan
        icons = {
            "icon16.png": (16, 16),
            "icon48.png": (48, 48),
            "icon128.png": (128, 128),
            "icon.png": (64, 64),  # Untuk notifikasi
        }
        
        # Generate dan simpan setiap ukuran
        for filename, size in icons.items():
            output_path = os.path.join(base_dir, filename)
            resized = img_cropped.resize(size, Image.Resampling.LANCZOS)
            
            # Untuk icon kecil (16x16), gunakan mode PNG dengan transparansi
            resized.save(output_path, "PNG")
            print(f"💾 Generated: {filename} ({size[0]}x{size[1]})")
        
        print("\n✅ Semua icon berhasil diupdate!")
        print("🔄 Silakan reload ekstensi di chrome://extensions/ untuk melihat perubahan.")
        
        # Hapus file sumber setelah berhasil (opsional)
        # os.remove(source_image)
        # print(f"🗑️  File sumber '{os.path.basename(source_image)}' dihapus.")
        
    except Exception as e:
        print(f"❌ Error saat memproses gambar: {e}")
        print("💡 Pastikan file gambar tidak corrupt dan formatnya didukung (PNG/JPG).")

if __name__ == "__main__":
    update_icons()
