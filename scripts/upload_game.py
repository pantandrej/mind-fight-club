#!/usr/bin/env python3
"""
BFC Game Upload — Simple Mode
Usage: python3 scripts/upload_game.py game.zip folder [--push]

Renders PDF slides to images, copies media files.
Question text, options, and correct answers are set manually in the Game Creator.
"""
import sys, json, shutil, subprocess, zipfile
from pathlib import Path

REPO_ROOT   = Path(__file__).parent.parent
MEDIA_ROOT  = REPO_ROOT / "media"
SCRATCHPAD  = Path("/tmp/bfc_upload")
GITHUB_BASE = "https://raw.githubusercontent.com/pantandrej/mind-fight-club/main/media/"


def main():
    if len(sys.argv) < 3:
        print("Usage: python3 scripts/upload_game.py <file.zip> <folder> [--push]")
        sys.exit(1)

    input_path = Path(sys.argv[1]).expanduser().resolve()
    folder     = sys.argv[2].strip('/')
    do_push    = '--push' in sys.argv

    if not input_path.exists():
        print(f"❌ Not found: {input_path}")
        sys.exit(1)

    work_dir = SCRATCHPAD / folder
    work_dir.mkdir(parents=True, exist_ok=True)

    # Extract ZIP
    print("📦 Extracting...")
    with zipfile.ZipFile(input_path) as zf:
        zf.extractall(work_dir / "src")

    src = work_dir / "src"

    # Find PDF
    pdfs = sorted(f for f in src.rglob("*.pdf") if not f.name.startswith('._'))
    if not pdfs:
        print("❌ No PDF found in ZIP — add a PDF export of the presentation.")
        sys.exit(1)
    pdf_path = pdfs[0]
    print(f"📄 PDF: {pdf_path.name}")

    # Render slides
    import fitz
    dest     = MEDIA_ROOT / folder
    dest.mkdir(parents=True, exist_ok=True)
    base_url = GITHUB_BASE + folder + "/"

    doc    = fitz.open(str(pdf_path))
    slides = []
    print(f"⏳ Rendering {len(doc)} pages...")
    for i, page in enumerate(doc, 1):
        pix  = page.get_pixmap(matrix=fitz.Matrix(2.0, 2.0))
        name = f"slide_{i:03d}.jpg"
        pix.save(str(dest / name))
        slides.append({"n": i, "url": base_url + name})
    doc.close()
    print(f"✅ {len(slides)} slides")

    # Copy media files
    media = []
    for f in sorted(pdf_path.parent.iterdir()):
        if f.suffix.lower() in ('.mp3', '.mp4', '.wav', '.m4a') and not f.name.startswith('._'):
            shutil.copy(f, dest / f.name)
            mtype = "video" if f.suffix.lower() == '.mp4' else "audio"
            media.append({"name": f.name, "url": base_url + f.name, "type": mtype})
            print(f"  🎵 {f.name}")

    # Write game.json  (questions left empty — filled in Game Creator)
    game = {
        "folder":    folder,
        "base_url":  base_url,
        "slides":    slides,
        "media":     media,
        "questions": [],
    }
    json_path = dest / "game.json"
    json_path.write_text(json.dumps(game, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f"📄 game.json — {len(slides)} слайдов, {len(media)} медиа")

    # Commit + push
    subprocess.run(["git", "add", f"media/{folder}/"], cwd=REPO_ROOT, check=True)
    subprocess.run(["git", "commit", "-m",
                    f"media: upload '{folder}' ({len(slides)} slides)"],
                   cwd=REPO_ROOT, check=True)
    if do_push:
        subprocess.run(["git", "push", "origin", "main"], cwd=REPO_ROOT, check=True)
        print("✅ Pushed!")

    print(f"\n🎮 Открой Конструктор → загрузи:")
    print(f"   {base_url}game.json")


if __name__ == "__main__":
    main()
