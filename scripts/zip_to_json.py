#!/usr/bin/env python3
"""
BFC Game Importer
Usage: python3 scripts/zip_to_json.py /path/to/game.zip --code T1 [--github-repo pantandrej/mind-fight-club]

Exports PPTX slides as images, uploads everything to Supabase Storage,
parses questions/answers from slide text, and generates a ready-to-import
JSON for the admin panel (Импорт игр).
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
GITHUB_REPO  = 'pantandrej/mind-fight-club'

HEADERS = {
    "apikey": SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
}

def upload_to_storage(local_path, storage_path):
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

def export_slides_keynote(pptx_path, out_dir):
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
    return result.returncode == 0

def parse_pptx_slides(pptx_path):
    """Returns list of slide text lists."""
    try:
        from pptx import Presentation
        prs = Presentation(pptx_path)
        result = []
        for slide in prs.slides:
            texts = []
            for shape in slide.shapes:
                if shape.has_text_frame:
                    for para in shape.text_frame.paragraphs:
                        t = para.text.strip()
                        if t:
                            texts.append(t)
            result.append(texts)
        return result
    except Exception as e:
        print(f"  ⚠️  PPTX parse error: {e}")
        return []

# Patterns for organizational/info slides
INFO_PATTERNS = re.compile(
    r'^(ПЕРВЫЙ|ВТОРОЙ|ТРЕТИЙ|ЧЕТВЁРТЫЙ|ПЯТЫЙ|ШЕСТОЙ|СЕДЬМОЙ|ВОСЬМОЙ|'
    r'первый|второй|третий|РАУНД|раунд|СПАСИБО|ПРАВИЛА|правила|'
    r'ПИШИТЕ|СКОЛЬКО БАЛЛОВ|ИТОГО|ФИНАЛ|РАЗМИНКА|РАЗОГРЕВ)',
    re.IGNORECASE
)

def classify_slide(texts, slide_num):
    """Returns 'info', 'question', 'answer_only', or 'skip'."""
    if not texts:
        return 'skip'
    full = ' '.join(texts)
    first = texts[0] if texts else ''

    # Short single-text slides (round headers etc)
    if len(texts) <= 2 and len(full) < 60:
        if INFO_PATTERNS.match(first):
            return 'info'
        # Slides with just a number are answer-only
        if re.match(r'^\d+$', full.strip()):
            return 'answer_only'

    # Slides that look like "answer only" (question text + number, no answer options)
    has_numbered_options = bool(re.search(r'\b[1-6]\.\s+\S', full))
    if not has_numbered_options and len(texts) <= 3:
        return 'answer_only'

    if has_numbered_options:
        return 'question'

    # Info patterns anywhere in text
    if INFO_PATTERNS.match(first):
        return 'info'

    return 'question'

def extract_answers_from_texts(texts):
    """Extract numbered answer options like '1. Foo', '2. Bar'."""
    answers = []
    for t in texts:
        m = re.match(r'^[1-6]\.\s+(.+)', t.strip())
        if m:
            answers.append(m.group(1).strip())
    return answers

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('zip_path')
    parser.add_argument('--code', required=True, help='Game code slug (e.g. t1)')
    parser.add_argument('--github-repo', default=GITHUB_REPO)
    args = parser.parse_args()

    code = args.code.lower()

    print(f"🎮 Processing → code={code}")

    with tempfile.TemporaryDirectory() as tmpdir:
        # Extract zip
        with zipfile.ZipFile(args.zip_path) as z:
            z.extractall(tmpdir)

        pptx_files = list(Path(tmpdir).rglob('*.pptx'))
        if not pptx_files:
            print("❌ No PPTX found"); sys.exit(1)
        pptx_path = str(pptx_files[0])
        print(f"  📊 PPTX: {Path(pptx_path).name}")

        # Find media (skip files with о/o suffix — those are answer videos)
        media_files = {}
        answer_media = {}
        for ext in ['*.mp3', '*.mp4', '*.wav']:
            for f in Path(tmpdir).rglob(ext):
                if '__MACOSX' in str(f): continue
                name = f.name
                # Files ending in о (cyrillic) or _answer are answer reveal media
                stem = f.stem
                if stem.endswith('о') or stem.endswith('o') and stem[:-1].isdigit():
                    answer_media[name] = str(f)
                else:
                    media_files[name] = str(f)

        print(f"  🎵 Question media: {list(media_files.keys())}")
        print(f"  🎵 Answer media: {list(answer_media.keys())}")

        # Export slides via Keynote
        slides_dir = os.path.join(tmpdir, 'slides')
        os.makedirs(slides_dir, exist_ok=True)
        print("🖼  Exporting slides via Keynote...")
        if not export_slides_keynote(pptx_path, slides_dir):
            print("❌ Keynote export failed"); sys.exit(1)

        slide_files = sorted([f for f in os.listdir(slides_dir) if f.endswith(('.jpeg','.jpg'))])
        n_slides = len(slide_files)
        print(f"  ✅ {n_slides} slides")

        # Upload slides to Supabase Storage
        print("☁️  Uploading slides...")
        slide_urls = {}
        for i, fname in enumerate(slide_files, 1):
            local = os.path.join(slides_dir, fname)
            url = upload_to_storage(local, f"games/{code}/slide_{i:03d}.jpg")
            if url:
                slide_urls[i] = url
                print(f"  ✅ slide {i:03d}")
            else:
                # Fallback: GitHub raw URL (if slides already pushed)
                gh = f"https://raw.githubusercontent.com/{args.github_repo}/main/public/games/{code}/slide_{i:03d}.jpg"
                slide_urls[i] = gh
                print(f"  ↩️  slide {i:03d} → GitHub fallback")

        # Upload media
        print("☁️  Uploading media...")
        media_urls = {}
        for fname, local in {**media_files, **answer_media}.items():
            safe_name = re.sub(r'[^\w.\-]', '_', fname)
            url = upload_to_storage(local, f"games/{code}/media/{safe_name}")
            if url:
                media_urls[fname] = url
                print(f"  ✅ {fname}")

        # Parse slide texts
        slide_texts = parse_pptx_slides(pptx_path)
        while len(slide_texts) < n_slides:
            slide_texts.append([])

        # Build Game Creator format: {folder, slides, media}
        slides_list = [{"n": i, "url": url} for i, url in sorted(slide_urls.items())]
        media_list  = [{"url": url, "name": fname} for fname, url in media_urls.items()]

        out_data = {
            "folder": code,
            "slides": slides_list,
            "media":  media_list,
        }

        out_path = Path(__file__).parent / f"{code}_import.json"
        out_path.write_text(json.dumps(out_data, ensure_ascii=False, indent=2), encoding='utf-8')

        print(f"\n✅ {out_path.name} готов")
        print(f"   Слайдов: {len(slides_list)} | Медиа: {len(media_list)}")
        print(f"\n👉 Загрузи в Админка → Конструктор игр → Выбрать файл → {out_path.name}")

if __name__ == '__main__':
    main()
