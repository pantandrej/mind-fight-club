#!/usr/bin/env python3
"""
BFC Game Upload Script
Usage: python3 scripts/upload_game.py "path/to/file.pptx" folder_name [--push]

Exports slides as images, extracts answer options from PPTX text,
detects org slides and question triplets, generates game.json.

PPTX structure expected:
  Slide 1:       Rules / intro org slide
  Slide 2:       Round 1 org slide
  Slides 3-5:    Q1 (answers slide, question slide, answer slide)
  Slides 6-8:    Q2 ...
  ...
  Slide N:       Round 2 org slide  (every 3*questions_per_round + 1)
  ...

Each "answers slide" has the question text and numbered answer options.
"""

import sys, os, re, json, shutil, subprocess, time
from pathlib import Path
from pptx import Presentation
from pptx.util import Pt

REPO_ROOT = Path(__file__).parent.parent
MEDIA_ROOT = REPO_ROOT / "media"
SCRATCHPAD = Path("/tmp/bfc_upload")

GITHUB_BASE = "https://raw.githubusercontent.com/pantandrej/mind-fight-club/main/media/"


def export_slides_keynote(pptx_path: Path, out_dir: Path) -> list[Path]:
    """Export all slides as JPEG via Keynote AppleScript."""
    out_dir.mkdir(parents=True, exist_ok=True)
    script = f'''
tell application "Keynote"
  open POSIX file "{pptx_path}"
  delay 3
  set theDoc to front document
  export theDoc to POSIX file "{out_dir}" as slide images with properties {{image format:JPEG, compression factor:0.9}}
  close theDoc saving no
end tell
'''
    print("⏳ Exporting slides via Keynote...")
    subprocess.run(["osascript", "-e", script], check=True, capture_output=True)
    time.sleep(1)
    files = sorted(out_dir.glob("*.jpeg")) + sorted(out_dir.glob("*.jpg"))
    print(f"✅ Exported {len(files)} slides")
    return files


def fix_slide_map(slide_dir: Path) -> dict[int, Path]:
    """Build {slide_number: path} map, handling invisible unicode chars in Keynote output."""
    result = {}
    for f in slide_dir.iterdir():
        if f.suffix.lower() not in ('.jpg', '.jpeg'):
            continue
        parts = f.name.split('.')
        if len(parts) < 3:
            continue
        num_str = parts[-2].strip('‎‏​﻿').strip()
        try:
            result[int(num_str)] = f
        except ValueError:
            pass
    return result


def extract_text_from_slide(slide) -> list[str]:
    """Extract all non-empty text runs from a slide."""
    texts = []
    for shape in slide.shapes:
        if not shape.has_text_frame:
            continue
        for para in shape.text_frame.paragraphs:
            line = para.text.strip()
            if line:
                texts.append(line)
    return texts


def parse_answers_from_texts(texts: list[str]) -> tuple[str, list[str]]:
    """
    Parse question text and answer options from slide text lines.
    Answer lines look like: "1. Слева", "2. Справа", "А. Вариант", etc.
    Returns (question_text, [answer1, answer2, ...])
    """
    answer_pattern = re.compile(r'^[\d]+[.)]\s+(.+)$|^[А-ЯA-Z][.)]\s+(.+)$')
    answers = []
    question_lines = []

    for text in texts:
        m = answer_pattern.match(text)
        if m:
            ans = m.group(1) or m.group(2)
            answers.append(ans.strip())
        else:
            question_lines.append(text)

    question_text = ' '.join(question_lines).strip()
    return question_text, answers


def detect_structure(prs: Presentation, slide_map: dict) -> dict:
    """
    Auto-detect org slides vs question triplets.
    Heuristic: slides with answer options (numbered text) are "answer slides".
    Every answer slide starts a question triplet: [answers, question_img, answer_img].
    Other slides are org slides.
    """
    total = len(prs.slides)
    print(f"📊 Total slides: {total}")

    is_answer_slide = {}
    for i, slide in enumerate(prs.slides, 1):
        texts = extract_text_from_slide(slide)
        full = ' '.join(texts)
        # Answer slide has numbered options like "1. X" or "А. X"
        numbered = len(re.findall(r'(?:^|\n)[\d]+[.)]\s', '\n'.join(texts)))
        lettered = len(re.findall(r'(?:^|\n)[А-ЯA-Z][.)]\s', '\n'.join(texts)))
        is_answer_slide[i] = (numbered >= 2 or lettered >= 2)

    # Walk slides and group
    org_slides = []
    questions = []
    i = 1
    while i <= total:
        if is_answer_slide.get(i):
            # Question triplet
            q_num = len(questions) + 1
            slide_ans = i
            slide_q = i + 1
            slide_a = i + 2
            texts = extract_text_from_slide(prs.slides[i - 1])
            q_text, answers = parse_answers_from_texts(texts)
            questions.append({
                "n": q_num,
                "question_text": q_text,
                "answers": answers,
                "correct": None,
                "slides": {"answers": slide_ans, "question": slide_q, "answer": slide_a},
                "audio": None,
                "video": None,
                "answer_audio": None,
                "answer_video": None,
            })
            i += 3
        else:
            org_slides.append({"slide": i, "texts": extract_text_from_slide(prs.slides[i - 1])})
            i += 1

    print(f"📋 Org slides: {len(org_slides)}, Questions: {len(questions)}")
    return {"org_slides": org_slides, "questions": questions, "total": total}


def copy_media_files(pptx_dir: Path, folder: str) -> dict[str, str]:
    """
    Look for audio/video files in the same dir as the PPTX.
    Match by naming convention: q01_audio.mp3, q01_video.mp4, q01_a_video.mp4 etc.
    Returns {filename: folder/filename}
    """
    media = {}
    for f in pptx_dir.iterdir():
        if f.suffix.lower() in ('.mp3', '.mp4', '.wav', '.m4a'):
            media[f.name] = f
    return media


def main():
    if len(sys.argv) < 3:
        print("Usage: python3 scripts/upload_game.py <file.pptx> <folder_name> [--push]")
        print("Example: python3 scripts/upload_game.py 'Второй турнир.pptx' t2 --push")
        sys.exit(1)

    pptx_path = Path(sys.argv[1]).expanduser().resolve()
    folder = sys.argv[2].strip('/')
    do_push = '--push' in sys.argv

    if not pptx_path.exists():
        print(f"❌ File not found: {pptx_path}")
        sys.exit(1)

    dest_dir = MEDIA_ROOT / folder
    dest_dir.mkdir(parents=True, exist_ok=True)

    # 1. Export slides
    slide_out = SCRATCHPAD / folder / "slides"
    slide_out.mkdir(parents=True, exist_ok=True)
    export_slides_keynote(pptx_path, slide_out)
    slide_map = fix_slide_map(slide_out)

    if not slide_map:
        print("❌ No slides exported. Check Keynote is installed.")
        sys.exit(1)

    # 2. Parse PPTX structure
    prs = Presentation(str(pptx_path))
    structure = detect_structure(prs, slide_map)

    # 3. Copy org slides
    base_url = GITHUB_BASE + folder + "/"
    org_out = []
    for idx, org in enumerate(structure["org_slides"]):
        snum = org["slide"]
        name = f"org_{idx+1:02d}.jpg"
        src = slide_map.get(snum)
        if src:
            shutil.copy(src, dest_dir / name)
            org["url"] = base_url + name
            org["filename"] = name
            print(f"  📄 Org slide {snum} → {name}")
        org_out.append(org)

    # 4. Copy question slides
    for q in structure["questions"]:
        n = q["n"]
        sq_name = f"q{n:02d}_sq.jpg"
        sa_name = f"q{n:02d}_sa.jpg"

        src_q = slide_map.get(q["slides"]["question"])
        src_a = slide_map.get(q["slides"]["answer"])

        if src_q:
            shutil.copy(src_q, dest_dir / sq_name)
            q["slide_q_url"] = base_url + sq_name
            print(f"  🖼  Q{n} question slide → {sq_name}")
        if src_a:
            shutil.copy(src_a, dest_dir / sa_name)
            q["slide_a_url"] = base_url + sa_name
            print(f"  🖼  Q{n} answer slide  → {sa_name}")

    # 5. Copy audio/video from PPTX directory
    pptx_dir = pptx_path.parent
    media_files = copy_media_files(pptx_dir, folder)
    for fname, fpath in media_files.items():
        shutil.copy(fpath, dest_dir / fname)
        print(f"  🎵 Media: {fname}")
        # Auto-detect which question this belongs to
        m = re.match(r'q(\d+)_?(audio|video|a_video|a_audio)', fname, re.I)
        if m:
            qn = int(m.group(1))
            kind = m.group(2).lower()
            url = base_url + fname
            for q in structure["questions"]:
                if q["n"] == qn:
                    if kind == 'audio':   q["audio"] = url
                    elif kind == 'video': q["video"] = url
                    elif kind == 'a_video': q["answer_video"] = url
                    elif kind == 'a_audio': q["answer_audio"] = url

    # 6. Write game.json
    game_json = {
        "folder": folder,
        "base_url": base_url,
        "total_slides": structure["total"],
        "org_slides": org_out,
        "questions": structure["questions"],
        "published": False,
    }
    json_path = dest_dir / "game.json"
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(game_json, f, ensure_ascii=False, indent=2)
    print(f"\n✅ game.json written to {json_path}")
    print(f"📦 Total files in {dest_dir}: {len(list(dest_dir.iterdir()))}")

    # 7. Git commit + push
    print("\n📤 Committing to GitHub...")
    subprocess.run(["git", "add", f"media/{folder}/"], cwd=REPO_ROOT, check=True)
    subprocess.run(["git", "commit", "-m", f"media: upload game '{folder}' ({len(structure['questions'])} questions)"],
                   cwd=REPO_ROOT, check=True)
    if do_push:
        subprocess.run(["git", "push", "origin", "main"], cwd=REPO_ROOT, check=True)
        print("✅ Pushed to GitHub!")
    else:
        print("ℹ️  Run with --push to push to GitHub, or: git push origin main")

    print(f"\n🎮 Next step: open Admin → Game Creator and load:")
    print(f"   {base_url}game.json")


if __name__ == "__main__":
    main()
