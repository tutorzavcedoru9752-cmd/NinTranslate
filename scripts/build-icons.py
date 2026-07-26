from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
BRAND_DIR = ROOT / "resources" / "brand"
SOURCE = BRAND_DIR / "nintranslate-icon.png"
MASTER = BRAND_DIR / "nintranslate-app-icon.png"
WINDOW_ICON = BRAND_DIR / "nintranslate-window.png"
TRAY_ICON = BRAND_DIR / "nintranslate-tray.png"
ICO = BRAND_DIR / "nintranslate.ico"
PREVIEW = BRAND_DIR / "nintranslate-preview.png"


def normalized_master(source: Image.Image) -> Image.Image:
    source = source.convert("RGBA")
    alpha_box = source.getchannel("A").getbbox()
    if not alpha_box:
        raise RuntimeError("图标母版没有可见像素")

    content = source.crop(alpha_box)
    canvas_size = 1024
    content_size = 880
    content.thumbnail((content_size, content_size), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    offset = ((canvas_size - content.width) // 2, (canvas_size - content.height) // 2)
    canvas.alpha_composite(content, offset)
    return canvas


def main() -> None:
    BRAND_DIR.mkdir(parents=True, exist_ok=True)
    master = normalized_master(Image.open(SOURCE))
    master.save(MASTER, optimize=True)

    window_icon = master.resize((256, 256), Image.Resampling.LANCZOS)
    window_icon.save(WINDOW_ICON, optimize=True)

    tray_icon = master.resize((32, 32), Image.Resampling.LANCZOS)
    tray_icon.save(TRAY_ICON, optimize=True)

    ico_sizes = [(16, 16), (20, 20), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    master.save(ICO, format="ICO", sizes=ico_sizes)

    checker = Image.new("RGBA", (1024, 1024), (238, 240, 244, 255))
    tile = 64
    for y in range(0, checker.height, tile):
        for x in range(0, checker.width, tile):
            if (x // tile + y // tile) % 2:
                checker.paste((218, 222, 230, 255), (x, y, x + tile, y + tile))
    checker.alpha_composite(master)
    checker.convert("RGB").save(PREVIEW, quality=92, optimize=True)

    print(f"Generated {ICO}")
    print(f"ICO sizes: {', '.join(f'{w}x{h}' for w, h in ico_sizes)}")


if __name__ == "__main__":
    main()
