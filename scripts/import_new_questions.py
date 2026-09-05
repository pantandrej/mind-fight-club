#!/usr/bin/env python3
import json, sys, subprocess, tempfile, os

SUPA_URL = 'https://nhmidxkohjpcnhjucuuh.supabase.co'

if len(sys.argv) < 2:
    print("Usage: python3 import_new_questions.py <service_role_key>")
    sys.exit(1)

JWT = sys.argv[1]

with open('scripts/new_questions_batch.json', encoding='utf-8') as f:
    raw = json.load(f)

rows = []
for q in raw:
    rows.append({
        'question_ru': q['question'],
        'question_text': q['question'],
        'answers_json': q['answers'],
        'correct_index': q['correct'],
        'category': q.get('category', 'GENERAL'),
        'source_type': 'manual_import',
        'status': 'pending',
    })

BATCH = 50
total_ok = 0

for i in range(0, len(rows), BATCH):
    batch = rows[i:i+BATCH]

    tmp = tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', suffix='.json', delete=False)
    json.dump(batch, tmp, ensure_ascii=False)
    tmp.close()

    result = subprocess.run([
        'curl', '-s', '-o', '/dev/null', '-w', '%{http_code}',
        '-X', 'POST',
        f'{SUPA_URL}/rest/v1/questions',
        '-H', f'apikey: {JWT}',
        '-H', f'Authorization: Bearer {JWT}',
        '-H', 'Content-Type: application/json',
        '-H', 'Prefer: return=minimal',
        '--data-binary', f'@{tmp.name}',
        '-k'
    ], capture_output=True, text=True)

    os.unlink(tmp.name)
    code = result.stdout.strip()

    if code in ('200', '201'):
        total_ok += len(batch)
        print(f"Batch {i//BATCH+1}: OK ({len(batch)} questions)")
    else:
        print(f"Batch {i//BATCH+1}: ERROR {code} - {result.stderr[:200]}")

print(f"\nTotal inserted: {total_ok}")
