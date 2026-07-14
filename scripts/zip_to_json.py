#!/usr/bin/env python3
"""
BFC Game Importer
Usage: python3 scripts/zip_to_json.py /path/to/game.zip --code T1

Extracts PPTX slides as images, uploads media to Supabase Storage,
and generates a ready-to-import JSON for the admin panel.
"""
import sys, os, json, re, subprocess, tempfile, zipfile, requests, argparse, shutil
from pathlib import Path

env_path = Path(__file__).parent / '.env'
creds = {}
if env_path.exists():
    for line in env_path.read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            creds[k.strip()] = v.strip()

SUPABASE_URL = creds.get('SUPABASE_URL', '')
SERVICE_KEY  = creds.get('SUPABASE_SERVICE_KEY', '')
HEADERS = {
    "apikey": SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
}

def upload_to_storage(local_path, storage_path):
    """Upload file to Supabase Storage, return public URL."""
    mime = 'audio/mpeg' if local_path.endswith('.mp3') else \
           'video/mp4'  if local_path.endswith('.mp4') else \
           'image/jpeg' if local_path.endswith(('.jpg','.jpeg')) else 'application/octet-stream'
    with open(local_path, 'rb') as f:
        r = requests.post(
            f"{SUPABASE_URL}/storage/v1/object/mfc-media/{storage_path}",
            headers={**HEADERS, "Content-Type": mime, "x-upsert": "true"},
            data=f
        )
    if not r.ok:
        print(f"  ⚠️  Upload failed {storage_path}: {r.status_code} {r.text[:100]}")
        return None
    return f"{SUPABASE_URL}/storage/v1/object/public/mfc-media/{storage_path}"

def export_slides_with_keynote(pptx_path, out_dir):
    """Export PPTX slides as JPEGs using Keynote on macOS."""
    script = f'''
tell application "Keynote"
    set pptxPath to POSIX file "{pptx_path}"
    set outFolder to POSIX file "{out_dir}/"
    open pptxPath
    delay 3
    set theDoc to front document
    export theDoc to outFolder as slide images with properties {{image format:JPEG, compression factor:0.85}}
    close theDoc saving no
end tell
'''
    result = subprocess.run(['osascript', '-e', script], capture_output=True, text=True)
    if result.returncode != 0:
        print(f"  ⚠️  Keynote export failed: {result.stderr}")
        return False
    return True

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('zip_path', help='Path to game zip archive')
    parser.add_argument('--code', required=True, help='Game code slug (e.g. T1)')
    args = parser.parse_args()

    code = args.code.lower()
    zip_path = args.zip_path

    print(f"🎮 Processing {zip_path} → code={code}")

    with tempfile.TemporaryDirectory() as tmpdir:
        # Extract zip
        print("📦 Extracting zip...")
        with zipfile.ZipFile(zip_path) as z:
            z.extractall(tmpdir)

        # Find PPTX
        pptx_files = list(Path(tmpdir).rglob('*.pptx'))
        if not pptx_files:
            print("❌ No PPTX found in zip"); sys.exit(1)
        pptx_path = str(pptx_files[0])
        print(f"  📊 Found: {pptx_path}")

        # Find media files (audio/video)
        media_files = {}
        for ext in ['*.mp3', '*.mp4', '*.wav', '*.ogg']:
            for f in Path(tmpdir).rglob(ext):
                if '__MACOSX' not in str(f):
                    media_files[f.name] = str(f)
        print(f"  🎵 Media files: {list(media_files.keys())}")

        # Export slides via Keynote
        slides_dir = os.path.join(tmpdir, 'slides')
        os.makedirs(slides_dir, exist_ok=True)
        print("🖼 Exporting slides via Keynote...")
        if not export_slides_with_keynote(pptx_path, slides_dir):
            sys.exit(1)

        slide_files = sorted([f for f in os.listdir(slides_dir) if f.endswith('.jpeg') or f.endswith('.jpg')])
        print(f"  ✅ {len(slide_files)} slides exported")

        # Upload slides to Supabase Storage
        print("☁️  Uploading slides to Supabase Storage...")
        slide_urls = {}
        for i, fname in enumerate(slide_files, 1):
            local = os.path.join(slides_dir, fname)
            storage_path = f"games/{code}/slide_{i:03d}.jpg"
            url = upload_to_storage(local, storage_path)
            slide_urls[i] = url
            print(f"  ✅ slide {i:03d} → {url}")

        # Upload media to Supabase Storage
        print("☁️  Uploading media to Supabase Storage...")
        media_urls = {}
        for fname, local in media_files.items():
            storage_path = f"games/{code}/media/{fname}"
            url = upload_to_storage(local, storage_path)
            media_urls[fname] = url
            print(f"  ✅ {fname} → {url}")

        # Parse PPTX for question text
        print("📝 Parsing PPTX questions...")
        try:
            from pptx import Presentation
            prs = Presentation(pptx_path)
            slides_text = []
            for slide in prs.slides:
                texts = []
                for shape in slide.shapes:
                    if shape.has_text_frame:
                        for para in shape.text_frame.paragraphs:
                            t = para.text.strip()
                            if t:
                                texts.append(t)
                slides_text.append(texts)
        except Exception as e:
            print(f"  ⚠️  PPTX parse error: {e}")
            slides_text = [[] for _ in slide_files]

        # Build questions JSON
        # TODO: customize this mapping per game structure
        # Default: print slide texts so user knows what's on each slide
        print("\n📋 Slide contents (for your reference):")
        for i, texts in enumerate(slides_text, 1):
            print(f"  Slide {i}: {' | '.join(texts[:3])}")

        # Generate import JSON in admin panel format
        # User will need to map slides → questions manually or we auto-detect
        # For now: generate one entry per slide with all available info
        questions = []
        for i, texts in enumerate(slides_text, 1):
            slide_url = slide_urls.get(i)
            entry = {
                "question": texts[0] if texts else f"Слайд {i}",
                "answer_a": "",
                "answer_b": "",
                "answer_c": "",
                "answer_d": "",
                "answer_e": "",
                "answer_f": "",
                "correct_answer": "A",
                "category": "GENERAL",
                "explanation": "",
                "slide_img_url": slide_url,
                "answer_slide_img_url": None,
                "_slide_num": i,
                "_slide_texts": texts,
            }
            questions.append(entry)

        out_path = Path(__file__).parent / f"{code}_import.json"
        out_path.write_text(json.dumps(questions, ensure_ascii=False, indent=2), encoding='utf-8')
        print(f"\n✅ JSON saved to {out_path}")
        print(f"   Upload this file in the admin panel → Импорт игр")
        print(f"\n📊 Summary:")
        print(f"   Slides: {len(slide_files)}")
        print(f"   Media:  {len(media_files)} files uploaded")
        print(f"   Code:   {code}")

if __name__ == '__main__':
    main()
