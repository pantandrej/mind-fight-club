#!/usr/bin/env python3
"""
BFC Game Publisher
Usage: python3 scripts/publish_game.py questions.json --name "МБ4" --code MB4 [--type pack|tournament] [--time 20]

Publishes a game to Supabase using service role key (bypasses RLS).
Export questions.json from the Game Creator using the "Экспорт JSON" button.
"""
import sys, json, requests, argparse
from pathlib import Path

# Load credentials from .env
env_path = Path(__file__).parent / '.env'
creds = {}
if env_path.exists():
    for line in env_path.read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            creds[k.strip()] = v.strip()

SUPABASE_URL = creds.get('SUPABASE_URL', '')
SERVICE_KEY  = creds.get('SUPABASE_SERVICE_KEY', '')

if not SUPABASE_URL or not SERVICE_KEY:
    print("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in scripts/.env")
    sys.exit(1)

HEADERS = {
    "apikey": SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
    "Content-Type": "application/json",
}

def post(table, data, prefer="return=representation"):
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers={**HEADERS, "Prefer": prefer},
        json=data
    )
    if not r.ok:
        raise RuntimeError(f"{table}: {r.status_code} {r.text}")
    return r.json()

def upsert(table, data, on_conflict):
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/{table}?on_conflict={on_conflict}",
        headers={**HEADERS, "Prefer": "resolution=merge-duplicates,return=representation"},
        json=data
    )
    if not r.ok:
        raise RuntimeError(f"{table}: {r.status_code} {r.text}")
    return r.json()

def delete_where(table, field, value):
    r = requests.delete(
        f"{SUPABASE_URL}/rest/v1/{table}?{field}=eq.{value}",
        headers=HEADERS
    )
    if not r.ok:
        print(f"  ⚠️  delete {table}: {r.status_code} {r.text}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('questions_json', help='Path to questions.json exported from Game Creator')
    parser.add_argument('--name', required=True, help='Game name')
    parser.add_argument('--code', required=True, help='Game code/slug (e.g. MB4)')
    parser.add_argument('--type', default='pack', choices=['pack', 'tournament'])
    parser.add_argument('--time', type=int, default=20, help='Seconds per question')
    args = parser.parse_args()

    questions = json.loads(Path(args.questions_json).read_text(encoding='utf-8'))
    code = args.code.upper()
    name = args.name
    time_per_q = args.time

    print(f"📦 Publishing '{name}' ({code}) — {len(questions)} questions, type={args.type}")

    if args.type == 'pack':
        # Upsert pack
        rows = upsert('game_packs', {
            'title_ru': name,
            'import_key': code.lower(),
            'status': 'draft',
            'pack_type': 'standard',
            'source_type': 'official_pack',
        }, 'import_key')
        pack_id = rows[0]['id']
        print(f"  📦 Pack id={pack_id}")

        # Clear old questions
        delete_where('game_pack_questions', 'game_pack_id', pack_id)

        # Insert questions
        for i, q in enumerate(questions):
            qrow = post('questions', {
                'q': q.get('question_text') or f'Вопрос {i+1}',
                'a': q['answers'],
                'c': q['correct'],
                't': time_per_q,
                'image_url':        q.get('slide_q_url'),
                'answer_image_url': q.get('slide_a_url'),
                'audio_url':        q.get('audio'),
                'video_url':        q.get('video'),
                'media_type': 'audio' if q.get('audio') else 'video' if q.get('video') else 'image' if q.get('slide_q_url') else 'text',
                'lang': 'ru',
                'cat': code.lower(),
            })
            qid = qrow[0]['id']
            post('game_pack_questions', {'game_pack_id': pack_id, 'question_id': qid, 'order_index': i + 1})
            print(f"  ✅ Q{i+1}: {q.get('question_text') or '(no text)'[:40]}")

        print(f"\n🎉 Пак опубликован как черновик!")
        print(f"   Название: {name}")
        print(f"   Код: {code.lower()}")
        print(f"   ID: {pack_id}")

    else:
        # Tournament
        rows = post('official_tournaments', {
            'name': name,
            'code': code,
            'status': 'lobby',
            'sync_mode': False,
            'is_private': False,
        })
        t_id = rows[0]['id']
        print(f"  🏆 Tournament id={t_id}")

        for i, q in enumerate(questions):
            qrow = post('questions', {
                'q': q.get('question_text') or f'Вопрос {i+1}',
                'a': q['answers'],
                'c': q['correct'],
                't': time_per_q,
                'image_url':        q.get('slide_q_url'),
                'answer_image_url': q.get('slide_a_url'),
                'audio_url':        q.get('audio'),
                'video_url':        q.get('video'),
                'media_type': 'audio' if q.get('audio') else 'video' if q.get('video') else 'image' if q.get('slide_q_url') else 'text',
                'lang': 'ru',
                'cat': 'general',
            })
            qid = qrow[0]['id']
            post('official_tournament_questions', {'tournament_id': t_id, 'question_id': qid, 'order_index': i + 1})
            print(f"  ✅ Q{i+1}: {q.get('question_text') or '(no text)'[:40]}")

        print(f"\n🎉 Турнир создан! Код: {code}")


if __name__ == '__main__':
    main()
