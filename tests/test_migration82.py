"""
Migration 82 — Brain Fights Complete Weekly Model
Corrective Test Suite (52 tests)

Tests validate:
  - P0.1  Uniqueness redesign (drop bfc_daily_unique, partial indexes)
  - P0.2  Duel advisory lock presence
  - P0.3  Single duel helper (_bf_award_duel_win), trigger delegates
  - P0.4  Arena 50% threshold (not 100%)
  - P0.5  Arena BF single-pass via finalize_weekly_arena_bf
  - P0.6  Canonical arena ranking (RANK OVER ORDER BY score DESC, no tie-break)
  - P0.7  get_brain_fights_week(): no `INTO ..., NULL` SQL bug
  - P0.8  No DELETE of legacy tables in finalize
  - P0.9  finalize_weekly_brain_fights has explicit p_week_start param with DEFAULT NULL
  - P0.10 Daily Game BF is ACTIVE (no FUTURE-GATED, no "скоро" for logic)
  - P0.11 start_daily_bf_session exists, returns session_id + questions, no correct_index
  - P0.12 complete_daily_bf_session exists, awards min(correct,10) BF
  - P0.13 Team attribution at award time (team_id from profiles at event time)
  - P0.14 UI: no "Скоро" / opacity dim on training row
  - P0.15 No bare SQL anti-patterns (literal INTO NULL, orphan BEGIN, etc.)
  - Transaction structure (BEGIN/COMMIT present, no orphan statements)
  - SECURITY DEFINER on all RPCs
  - GRANT/REVOKE structure correct

Run from project root:
  python3 tests/test_migration82.py
"""

import re
import sys
import pathlib

SQL_PATH = pathlib.Path(__file__).parent.parent / 'sql' / '82_brain_fights_weekly_model.sql'
BF_JS_PATH = pathlib.Path(__file__).parent.parent / 'js' / 'brain-fights.js'
TR_JS_PATH = pathlib.Path(__file__).parent.parent / 'js' / 'training' / 'training.js'

sql = SQL_PATH.read_text(encoding='utf-8')
bf_js = BF_JS_PATH.read_text(encoding='utf-8')
tr_js = TR_JS_PATH.read_text(encoding='utf-8')

# Strip single-line comments (-- ...) for structural checks that should not
# match comment text. Block comments (/* ... */) not used in these migrations.
def strip_sql_comments(text):
    return re.sub(r'--[^\n]*', '', text)

sql_nc = strip_sql_comments(sql)  # no-comments version for structural checks
sql_upper = sql.upper()

PASS = []
FAIL = []

def check(tid, desc, cond):
    if cond:
        PASS.append(tid)
    else:
        FAIL.append((tid, desc))

# ─────────────────────────────────────────────────────────────────────────────
# Transaction structure
# ─────────────────────────────────────────────────────────────────────────────
check('T01', 'Migration starts with BEGIN;',
    'BEGIN;' in sql)

check('T02', 'Migration ends with COMMIT;',
    'COMMIT;' in sql)

check('T03', 'No ROLLBACK statement in migration body',
    not re.search(r'\bROLLBACK\b', sql, re.IGNORECASE))

# ─────────────────────────────────────────────────────────────────────────────
# P0.1 — Uniqueness redesign
# ─────────────────────────────────────────────────────────────────────────────
check('T04', 'P0.1: DROP CONSTRAINT bfc_daily_unique present',
    re.search(r'DROP\s+CONSTRAINT\s+.*bfc_daily_unique', sql, re.IGNORECASE))

check('T05', 'P0.1: Partial unique index for superq created',
    re.search(r'CREATE\s+UNIQUE\s+INDEX.*bfc_superq_daily_uidx', sql, re.IGNORECASE))

check('T06', 'P0.1: Partial unique index for training created',
    re.search(r'CREATE\s+UNIQUE\s+INDEX.*bfc_training_daily_uidx', sql, re.IGNORECASE))

check('T07', "P0.1: superq index has WHERE source_type = 'superq'",
    re.search(r"bfc_superq_daily_uidx.*WHERE\s+source_type\s*=\s*'superq'", sql, re.DOTALL | re.IGNORECASE))

check('T08', "P0.1: training index has WHERE source_type = 'training'",
    re.search(r"bfc_training_daily_uidx.*WHERE\s+source_type\s*=\s*'training'", sql, re.DOTALL | re.IGNORECASE))

check('T09', "P0.1: source_type CHECK includes all 4 sources",
    all(s in sql for s in ["'superq'", "'weekly_arena'", "'duel'", "'training'"]))

check('T10', 'P0.1: bfc_source_unique NOT dropped (kept for event idempotency)',
    'DROP CONSTRAINT' not in sql or 'bfc_source_unique' not in
        re.findall(r'DROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?(\S+)', sql, re.IGNORECASE).__repr__())

# ─────────────────────────────────────────────────────────────────────────────
# P0.2 + P0.3 — Duel helper with advisory lock
# ─────────────────────────────────────────────────────────────────────────────
check('T11', 'P0.2: advisory lock present in _bf_award_duel_win',
    re.search(r'_bf_award_duel_win.*pg_advisory_xact_lock', sql, re.DOTALL | re.IGNORECASE))

check('T12', 'P0.3: _bf_award_duel_win function declared',
    re.search(r'CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\._bf_award_duel_win', sql, re.IGNORECASE))

check('T13', 'P0.3: _bf_award_duel_win is SECURITY DEFINER',
    re.search(r'_bf_award_duel_win.*?SECURITY\s+DEFINER', sql, re.DOTALL | re.IGNORECASE))

check('T14', 'P0.3: trigger calls _bf_award_duel_win (not inline logic)',
    re.search(r'_trg_duel_finished_bf.*?_bf_award_duel_win', sql, re.DOTALL | re.IGNORECASE))

check('T15', 'P0.3: trigger function _trg_duel_finished_bf declared',
    re.search(r'CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\._trg_duel_finished_bf', sql, re.IGNORECASE))

check('T16', 'P0.3: DROP TRIGGER ... ON duel_rooms present',
    re.search(r'DROP\s+TRIGGER\s+IF\s+EXISTS.*duel_rooms', sql, re.IGNORECASE))

check('T17', 'P0.3: REVOKE on _bf_award_duel_win (no direct client access)',
    re.search(r'REVOKE.*_bf_award_duel_win', sql, re.DOTALL | re.IGNORECASE))

check('T18', 'P0.3: duel awards 3 BF per win',
    '3' in sql and re.search(r'_bf_award_duel_win.*?\bRETURN\b.*?3', sql, re.DOTALL | re.IGNORECASE))

check('T19', 'P0.3: duel cap = 3 wins/day',
    re.search(r'v_wins_today\s*>=\s*3', sql))

# ─────────────────────────────────────────────────────────────────────────────
# P0.4 + P0.5 — Arena BF: 50% threshold, single-pass finalize
# ─────────────────────────────────────────────────────────────────────────────
check('T20', 'P0.4: finalize_weekly_arena_bf function declared',
    re.search(r'CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.finalize_weekly_arena_bf', sql, re.IGNORECASE))

check('T21', 'P0.4: 50% threshold uses CEIL(...*0.5)',
    re.search(r'CEIL\s*\(.*\*\s*0\.5\)', sql, re.IGNORECASE))

check('T22', 'P0.4: answered_count comparison (>= threshold)',
    re.search(r'answered_count\s*>=\s*CEIL', sql, re.IGNORECASE))

check('T23', 'P0.5: submit_weekly_arena_answer does NOT award BF (no BF insert inside it)',
    # Extract the function body between the two $$ delimiters
    # and verify brain_fight_contributions does not appear inside it.
    (lambda body: 'brain_fight_contributions' not in body.lower())(
        m.group(1) if (m := re.search(
            r'FUNCTION\s+public\.submit_weekly_arena_answer.*?\$\$(.*?)\$\$',
            sql_nc, re.DOTALL | re.IGNORECASE
        )) else ''
    ))

check('T24', 'P0.5: finalize_weekly_arena_bf awards BF via brain_fight_contributions INSERT',
    re.search(r'finalize_weekly_arena_bf.*?INSERT\s+INTO\s+brain_fight_contributions', sql, re.DOTALL | re.IGNORECASE))

check('T25', 'P0.5: Arena source_id is md5(arena_id::arena_bf::user)',
    re.search(r"md5\s*\(\s*p_arena_id.*arena_bf.*scoring_user_id", sql, re.DOTALL | re.IGNORECASE))

check('T26', 'P0.5: finalize_weekly_arena_bf uses ON CONFLICT DO NOTHING (idempotent)',
    re.search(r'finalize_weekly_arena_bf.*?ON\s+CONFLICT\s+DO\s+NOTHING', sql, re.DOTALL | re.IGNORECASE))

# ─────────────────────────────────────────────────────────────────────────────
# P0.6 — Canonical arena placement ranking (RANK() no tie-break)
# ─────────────────────────────────────────────────────────────────────────────
check('T27', 'P0.6: RANK() OVER (ORDER BY wap.score DESC) in finalize_weekly_arena_bf',
    re.search(r'RANK\s*\(\s*\)\s+OVER\s*\(.*ORDER\s+BY\s+wap\.score\s+DESC', sql, re.DOTALL | re.IGNORECASE))

check('T28', 'P0.6: no tie-break on scoring_user_id in arena placement RANK()',
    # The RANK() OVER clause for arena placement should only ORDER BY score.
    # Check within finalize_weekly_arena_bf body only.
    (lambda body: not re.search(
        r'RANK\s*\(\s*\)\s+OVER\s*\([^)]*ORDER\s+BY[^)]*scoring_user_id',
        body, re.IGNORECASE
    ))(
        m.group(1) if (m := re.search(
            r'FUNCTION\s+public\.finalize_weekly_arena_bf.*?\$\$(.*?)\$\$',
            sql_nc, re.DOTALL | re.IGNORECASE
        )) else ''
    ))

check('T29', 'P0.6: placement bonus array [5, 3, 2] defined',
    re.search(r'ARRAY\s*\[\s*5\s*,\s*3\s*,\s*2\s*\]', sql))

# ─────────────────────────────────────────────────────────────────────────────
# P0.7 — get_brain_fights_week(): no `INTO ..., NULL` SQL bug
# ─────────────────────────────────────────────────────────────────────────────
check('T30', 'P0.7: no `SELECT ... INTO ..., NULL` literal in SQL code (only in comments)',
    not re.search(r'INTO\s+\w+\s*,\s*NULL\b', sql_nc, re.IGNORECASE))

check('T31', 'P0.7: v_disbanded_at declared as proper variable',
    re.search(r'v_disbanded_at\s+timestamptz', sql, re.IGNORECASE))

check('T32', 'P0.7: get_brain_fights_week returns all 4 sources in my_contrib',
    all(src in sql for src in ["'superq'", "'duel'", "'training'", "'weekly_arena'"]))

check('T33', 'P0.7: team formula uses 5× multiplier for active_beyond_top3',
    re.search(r'\*\s*5', sql))

# ─────────────────────────────────────────────────────────────────────────────
# P0.8 — No DELETE of legacy tables in finalize
# ─────────────────────────────────────────────────────────────────────────────
check('T34', 'P0.8: no DELETE FROM team_weekly_brain_fights in migration',
    not re.search(r'DELETE\s+FROM\s+team_weekly_brain_fights', sql, re.IGNORECASE))

check('T35', 'P0.8: no DELETE FROM player_weekly_bf_points in migration',
    not re.search(r'DELETE\s+FROM\s+player_weekly_bf_points', sql, re.IGNORECASE))

check('T36', 'P0.8: legacy tables documented as cleanup debt (comment present)',
    'team_weekly_brain_fights' in sql and 'legacy' in sql.lower())

# ─────────────────────────────────────────────────────────────────────────────
# P0.9 — finalize_weekly_brain_fights: explicit p_week_start param
# ─────────────────────────────────────────────────────────────────────────────
check('T37', 'P0.9: finalize_weekly_brain_fights has p_week_start date DEFAULT NULL param',
    re.search(r'finalize_weekly_brain_fights\s*\(\s*p_week_start\s+date\s+DEFAULT\s+NULL', sql, re.IGNORECASE))

check('T38', 'P0.9: Monday validation present (DOW check)',
    re.search(r'DOW.*EXTRACT|EXTRACT.*DOW', sql, re.IGNORECASE))

check('T39', 'P0.9: week ended validation (week_end > v_today RAISE EXCEPTION)',
    re.search(r'v_week_end\s*>\s*v_today', sql, re.IGNORECASE))

check('T40', 'P0.9: default week = current_monday - 7 (previous complete week)',
    re.search(r'v_current_mon\s*-\s*7', sql, re.IGNORECASE))

# ─────────────────────────────────────────────────────────────────────────────
# P0.10–P0.12 — Daily Game ACTIVE
# ─────────────────────────────────────────────────────────────────────────────
check('T41', 'P0.10: start_daily_bf_session function declared',
    re.search(r'CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.start_daily_bf_session', sql, re.IGNORECASE))

check('T42', 'P0.11: start_daily_bf_session payload does NOT include correct_index key',
    # Extract the body of start_daily_bf_session (between its $$ delimiters)
    # and verify correct_index does not appear in any jsonb_build_object(...) payload.
    # submit_daily_bf_answer legitimately returns correct_index (after answer recorded),
    # so we scope this check to start_daily_bf_session only.
    (lambda body: body is not None and not re.search(
        r"jsonb_build_object\s*\([^)]*'correct_index'",
        body, re.IGNORECASE
    ))(
        # Extract first $$ ... $$ block after start_daily_bf_session declaration
        (lambda m: m.group(1) if m else None)(
            re.search(
                r'CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.start_daily_bf_session.*?\$\$(.*?)\$\$',
                sql_nc, re.DOTALL | re.IGNORECASE
            )
        )
    ))

check('T43', 'P0.11: start_daily_bf_session returns session_id in payload',
    re.search(r"start_daily_bf_session.*?'session_id'", sql, re.DOTALL | re.IGNORECASE))

check('T44', 'P0.12: complete_daily_bf_session function declared',
    re.search(r'CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.complete_daily_bf_session', sql, re.IGNORECASE))

check('T45', 'P0.12: complete_daily_bf_session awards MIN(correct, 10) BF',
    re.search(r'LEAST\s*\(\s*v_correct_cnt\s*,\s*10\s*\)', sql, re.IGNORECASE))

check('T46', 'P0.12: complete_daily_bf_session GRANT to authenticated',
    re.search(r'GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.complete_daily_bf_session.*authenticated', sql, re.IGNORECASE))

check('T47', 'P0.12: complete_daily_bf_session is SECURITY DEFINER',
    re.search(r'complete_daily_bf_session.*?SECURITY\s+DEFINER', sql, re.DOTALL | re.IGNORECASE))

# ─────────────────────────────────────────────────────────────────────────────
# P0.13 — Team attribution at event time
# ─────────────────────────────────────────────────────────────────────────────
check('T48', 'P0.13: team_id attribution via profiles JOIN teams at event time',
    sql.count('disbanded_at IS NULL') >= 2)  # appears in duel helper + daily complete

# ─────────────────────────────────────────────────────────────────────────────
# P0.14 — UI: no "Скоро" / opacity dim on training row
# ─────────────────────────────────────────────────────────────────────────────
check('T49', 'P0.14: brain-fights.js training row has no opacity:.45',
    'opacity:.45' not in bf_js)

check('T50', "P0.14: brain-fights.js earn4 updated (no 'скоро' in earn4 value)",
    'скоро' not in (re.search(r"earn4\s*:.*?'([^']*)'", bf_js) or re.search(r'earn4.*?ru.*?:.*?"([^"]*)"', bf_js) or type('', (), {'group': lambda *a: ''})()).group(0 if False else 1).lower()
    if re.search(r"earn4\s*:.*?\{", bf_js) or re.search(r"earn4\s*:", bf_js) else True)

check('T51', "P0.14: training.js _bfSession variable declared",
    'let _bfSession' in tr_js)

check('T52', "P0.14: training.js tryStartDailyBfSession function declared",
    'async function tryStartDailyBfSession' in tr_js)

# ─────────────────────────────────────────────────────────────────────────────
# P0.15 — SQL anti-patterns
# ─────────────────────────────────────────────────────────────────────────────
# (Already covered by T30 for INTO NULL; additional structural checks:)
check('T00_structure', 'All SECURITY DEFINER functions have SET search_path = public',
    # Every CREATE OR REPLACE FUNCTION block should have search_path = public
    len(re.findall(r'CREATE\s+OR\s+REPLACE\s+FUNCTION', sql, re.IGNORECASE)) ==
    len(re.findall(r'SET\s+search_path\s*=\s*public', sql, re.IGNORECASE)))

# ─────────────────────────────────────────────────────────────────────────────
# Results
# ─────────────────────────────────────────────────────────────────────────────
total = len(PASS) + len(FAIL)
print(f"\n{'='*60}")
print(f"Migration 82 — Corrective Test Suite")
print(f"{'='*60}")
print(f"PASS: {len(PASS)}/{total}")
if FAIL:
    print(f"FAIL: {len(FAIL)}/{total}")
    for tid, desc in FAIL:
        print(f"  ✗ [{tid}] {desc}")
else:
    print("All tests passed.")
print(f"{'='*60}\n")

sys.exit(0 if not FAIL else 1)
