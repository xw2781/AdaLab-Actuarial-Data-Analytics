from pathlib import Path
import sys
from PIL import Image

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from core.utils import resolve_existing_path

def png_to_ico(png_path: str, ico_path: str | None = None, sizes=None) -> str:
    """
    Convert a PNG (with transparency) to a multi-size ICO, preserving alpha.

    Requirements:
      pip install pillow
    """
    png_path = Path(png_path)
    if ico_path is None:
        ico_path = png_path.with_suffix(".ico")
    else:
        ico_path = Path(ico_path)

    if sizes is None:
        # Good defaults for Windows icons
        sizes = [(16,16), (24,24), (32,32), (48,48), (64,64), (128,128), (256,256)]

    img = Image.open(png_path)

    # Ensure alpha channel is preserved
    if img.mode not in ("RGBA", "LA"):
        img = img.convert("RGBA")
    else:
        img = img.convert("RGBA")

    # Save as ICO with embedded sizes
    # Pillow will generate the requested sizes from the source image.
    img.save(ico_path, format="ICO", sizes=sizes)

    return str(ico_path)

if __name__ == "__main__":
    # Example usage:
    #   python png_to_ico.py
    png = resolve_existing_path(
        PROJECT_ROOT / "library" / "icon" / "ArcRhoV8.png",
        PROJECT_ROOT / "library" / "icon" / "ADASV8.png",
    )
    out = png.with_suffix(".ico")
    ico_file = png_to_ico(png, out)
    print("ICO saved:", ico_file)
