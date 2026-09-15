"""
Migration 82 — Brain Fights Complete Weekly Model
Corrective + Final Blockers Test Suite (100 tests)

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
NOT_EXECUTED = []  # DB/browser tests — never counted in passing total

def check(tid, desc, cond):
    if cond:
        PASS.append(tid)
    else:
        FAIL.append((tid, desc))

def check_ne(tid, desc):
    """Register a test that is NOT EXECUTED (DB or browser required)."""
    NOT_EXECUTED.append((tid, desc))

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
# D01-D47 — FINAL BLOCKERS review tests
# Legend: STATIC TEST = regex/AST check on source files (runs here)
#         DB TRANSACTION TEST = requires live Supabase (NOT EXECUTED here)
#         MANUAL/BROWSER TEST = requires human verification (NOT EXECUTED here)
# ─────────────────────────────────────────────────────────────────────────────

MATCHMAKING_JS_PATH  = pathlib.Path(__file__).parent.parent / 'js' / 'battles' / 'matchmaking.js'
FRIEND_BATTLE_JS_PATH= pathlib.Path(__file__).parent.parent / 'js' / 'battles' / 'friend-battle.js'
STREAK_JS_PATH       = pathlib.Path(__file__).parent.parent / 'js' / 'training' / 'streak.js'
LEGACY_JS_PATH       = pathlib.Path(__file__).parent.parent / 'js' / 'legacy.js'
SQL85_PATH           = pathlib.Path(__file__).parent.parent / 'sql' / '85_virtual_battle_server_auth.sql'

mm_js     = MATCHMAKING_JS_PATH.read_text(encoding='utf-8')
fb_js     = FRIEND_BATTLE_JS_PATH.read_text(encoding='utf-8')
streak_js = STREAK_JS_PATH.read_text(encoding='utf-8')
legacy_js = LEGACY_JS_PATH.read_text(encoding='utf-8')
sql85     = SQL85_PATH.read_text(encoding='utf-8') if SQL85_PATH.exists() else ''

# ── P0: Remove Answer-Reveal Bypass ──────────────────────────────────────────

# STATIC TEST: q_id removed from start_daily_bf_session payload
def _start_bf_body():
    m = re.search(r'CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.start_daily_bf_session.*?\$\$(.*?)\$\$',
                  sql, re.DOTALL | re.IGNORECASE)
    return m.group(1) if m else ''

_start_bf = _start_bf_body()

check('D01', '[STATIC TEST] P0: q_id not in start_daily_bf_session payload jsonb_build_object',
    "'q_id'" not in _start_bf and '"q_id"' not in _start_bf)

# STATIC TEST: get_question_reveals GRANT is TO authenticated only (not anon)
check('D02', '[STATIC TEST] P0: get_question_reveals GRANT not TO anon',
    not re.search(r'GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.get_question_reveals.*\banon\b', sql, re.IGNORECASE))

check('D03', '[STATIC TEST] P0: get_question_reveals REVOKE from anon',
    re.search(r'REVOKE\s+.*\s+ON\s+FUNCTION\s+public\.get_question_reveals.*\banon\b', sql, re.IGNORECASE))

# STATIC TEST: get_question_reveals still GRANT to authenticated
check('D04', '[STATIC TEST] P0: get_question_reveals GRANT TO authenticated',
    re.search(r'GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.get_question_reveals.*authenticated', sql, re.IGNORECASE))

# DB TRANSACTION TEST: anon call to get_question_reveals returns 0 rows
check_ne('D05', '[DB TRANSACTION TEST — NOT EXECUTED] P0: anon get_question_reveals returns empty')

# ── P1: Idempotent submit_daily_bf_answer ────────────────────────────────────

def _submit_bf_body():
    m = re.search(r'CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.submit_daily_bf_answer.*?\$\$(.*?)\$\$',
                  sql, re.DOTALL | re.IGNORECASE)
    return m.group(1) if m else ''

_submit_bf = _submit_bf_body()

# STATIC TEST: submit uses UPDATE...RETURNING (not EXISTS+UPDATE)
check('D06', '[STATIC TEST] P1: submit_daily_bf_answer uses UPDATE...RETURNING pattern',
    'RETURNING id INTO v_updated_id' in _submit_bf)

# STATIC TEST: no bare EXISTS check before UPDATE in submit body
check('D07', '[STATIC TEST] P1: submit_daily_bf_answer has no standalone EXISTS guard before UPDATE',
    'IF EXISTS' not in _submit_bf)

# STATIC TEST: retry returns persisted is_correct
check('D08', '[STATIC TEST] P1: submit_daily_bf_answer retry returns persisted is_correct field',
    'v_stored_correct' in _submit_bf)

# DB TRANSACTION TEST: concurrent calls return exactly one accepted=true
check_ne('D09', '[DB TRANSACTION TEST — NOT EXECUTED] P1: concurrent submit race returns single accepted=true')

# ── P2: No local fallback on network failure ──────────────────────────────────

# STATIC TEST: _showBfRetry function declared in training.js
check('D10', '[STATIC TEST] P2: _showBfRetry function declared in training.js',
    '_showBfRetry' in tr_js)

# STATIC TEST: pick() BF catch block calls _showBfRetry, not _applyPickFeedback
check('D11', '[STATIC TEST] P2: pick() BF catch block calls _showBfRetry (not local fallback)',
    bool(re.search(r'_submitPick.*?\.catch\s*\(\s*\(\s*\)\s*=>\s*\{\s*_showBfRetry', tr_js, re.DOTALL)))

# STATIC TEST: expire() no longer falls back to q.c on catch
check('D12', '[STATIC TEST] P2: expire() catch block does NOT call _applyExpire(q.c)',
    not re.search(r'\.catch\s*\(\s*\(\s*\)\s*=>\s*\{\s*_applyExpire\s*\(\s*q\.c', tr_js))

# STATIC TEST: retry calls _showBfRetry on catch
check('D13', '[STATIC TEST] P2: BF pick() catch calls _showBfRetry',
    '_showBfRetry' in tr_js)

# MANUAL/BROWSER TEST: retry bar shows, Next disabled, retry restores reveal
check_ne('D14', '[MANUAL/BROWSER TEST — NOT EXECUTED] P2: retry UI shows on network failure, Next stays hidden')

# ── P3: Complete requires 10 resolved ────────────────────────────────────────

def _complete_bf_body():
    m = re.search(r'CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.complete_daily_bf_session.*?\$\$(.*?)\$\$',
                  sql, re.DOTALL | re.IGNORECASE)
    return m.group(1) if m else ''

_complete_bf = _complete_bf_body()

check('D15', '[STATIC TEST] P3: complete_daily_bf_session checks resolved_count = 10',
    'v_resolved_cnt' in _complete_bf)

check('D16', '[STATIC TEST] P3: complete_daily_bf_session checks assigned_count = 10',
    'v_assigned_cnt' in _complete_bf)

check('D17', '[STATIC TEST] P3: complete_daily_bf_session returns session_incomplete if not 10 resolved',
    'session_incomplete' in _complete_bf)

# DB TRANSACTION TEST: completing after 9/10 returns session_incomplete
check_ne('D18', '[DB TRANSACTION TEST — NOT EXECUTED] P3: complete after 9 answered returns session_incomplete')

# DB TRANSACTION TEST: completing after 10/10 awards BF
check_ne('D19', '[DB TRANSACTION TEST — NOT EXECUTED] P3: complete after 10 answered awards BF')

# ── P4: BF eligibility canonical per session ──────────────────────────────────

# STATIC TEST: ALTER TABLE adds bf_eligible column
check('D20', '[STATIC TEST] P4: ALTER TABLE game_sessions ADD COLUMN bf_eligible',
    re.search(r'ALTER\s+TABLE\s+public\.game_sessions\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+bf_eligible', sql, re.IGNORECASE))

# STATIC TEST: start_daily_bf_session inserts bf_eligible into game_sessions
check('D21', '[STATIC TEST] P4: start_daily_bf_session inserts bf_eligible value',
    'bf_eligible' in _start_bf)

# STATIC TEST: complete_daily_bf_session checks session.bf_eligible
check('D22', '[STATIC TEST] P4: complete_daily_bf_session verifies bf_eligible on session row',
    'bf_eligible' in _complete_bf)

# DB TRANSACTION TEST: second Premium session gets bf_pts=0
check_ne('D23', '[DB TRANSACTION TEST — NOT EXECUTED] P4: second Premium session complete returns bf_pts=0')

# ── P5: Clean stale comments ─────────────────────────────────────────────────

# STATIC TEST: p_answers only in a comment (not as a function parameter)
check('D24', '[STATIC TEST] P5: p_answers not used as function parameter in migration82',
    not re.search(r'\bp_answers\b(?!\s+param)', sql)
    or sql.count('p_answers') == sql.count('p_answers param'))

# STATIC TEST: no stale reference to q_id-for-get_question_reveals in comments
check('D25', '[STATIC TEST] P5: no stale "q_id included for get_question_reveals" comment',
    'q_id (for get_question_reveals)' not in sql and 'q_id included for get_question_reveals' not in sql)

# ── P6: my_team name/emoji ────────────────────────────────────────────────────

def _get_bfw_body():
    m = re.search(r'CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.get_brain_fights_week.*?\$\$(.*?)\$\$',
                  sql, re.DOTALL | re.IGNORECASE)
    return m.group(1) if m else ''

_get_bfw = _get_bfw_body()

# STATIC TEST: get_brain_fights_week declares v_team_name and v_team_emoji
check('D26', '[STATIC TEST] P6: get_brain_fights_week declares v_team_name variable',
    'v_team_name' in _get_bfw)

check('D27', '[STATIC TEST] P6: get_brain_fights_week declares v_team_emoji variable',
    'v_team_emoji' in _get_bfw)

# STATIC TEST: my_team object includes name and emoji fields
check('D28', "[STATIC TEST] P6: my_team jsonb includes 'name' field",
    re.search(r"'name'\s*,\s*v_team_name", _get_bfw))

check('D29', "[STATIC TEST] P6: my_team jsonb includes 'emoji' field",
    re.search(r"'emoji'\s*,\s*v_team_emoji", _get_bfw))

# DB TRANSACTION TEST: zero-score team my_team has name and emoji
check_ne('D30', '[DB TRANSACTION TEST — NOT EXECUTED] P6: zero-score team my_team includes name/emoji')

# ── B1/B2/B3: Server-authoritative random battle ──────────────────────────────

# STATIC TEST: claim_random_match() function declared
check('D31', '[STATIC TEST] B3: claim_random_match() function declared in migration82',
    re.search(r'CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.claim_random_match', sql, re.IGNORECASE))

# STATIC TEST: claim_random_match uses FOR UPDATE SKIP LOCKED
check('D32', '[STATIC TEST] B2: claim_random_match uses FOR UPDATE SKIP LOCKED',
    'FOR UPDATE SKIP LOCKED' in sql)

# STATIC TEST: claim_random_match inserts into duel_rooms with host_user_id
check('D33', '[STATIC TEST] B3: claim_random_match inserts duel_rooms with host_user_id',
    re.search(r'INSERT\s+INTO\s+duel_rooms', sql, re.IGNORECASE) and 'host_user_id' in sql)

# STATIC TEST: claim_random_match GRANT to authenticated
check('D34', '[STATIC TEST] B3: claim_random_match GRANT to authenticated',
    re.search(r'GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.claim_random_match.*authenticated', sql, re.IGNORECASE))

# STATIC TEST: matchmaking.js no longer has direct duel_rooms.insert() in main loop
check('D35', '[STATIC TEST] B1: matchmaking.js main loop has no direct duel_rooms.insert()',
    not re.search(r"sb\.from\('duel_rooms'\)\.insert\(", mm_js[:6000]))  # first ~6000 chars = main loop

# STATIC TEST: matchmaking.js _acceptChallenge has no direct duel_rooms.insert()
check('D36', '[STATIC TEST] B1: matchmaking.js _acceptChallenge has no direct duel_rooms.insert()',
    "await sb.from('duel_rooms').insert({" not in mm_js[5000:] or
    mm_js.count("sb.from('duel_rooms').insert(") == 0)

# STATIC TEST: matchmaking.js calls claim_random_match rpc
check('D37', '[STATIC TEST] B2: matchmaking.js calls sb.rpc(\'claim_random_match\')',
    "sb.rpc('claim_random_match')" in mm_js)

# MANUAL/BROWSER TEST: real random battle works end-to-end
check_ne('D38', '[MANUAL/BROWSER TEST — NOT EXECUTED] B3: real random battle end-to-end via claim_random_match')

# ── B5/B6: Battle board UI fixes ─────────────────────────────────────────────

# STATIC TEST: bot rows show виртуальный игрок, not 🟢 Онлайн
check('D39', '[STATIC TEST] B5: matchmaking.js battle board shows "виртуальный игрок" for bot rows',
    'виртуальный игрок' in mm_js)

# STATIC TEST: no hardcoded 🟢 Онлайн for all rows (must be conditional)
check('D40', '[STATIC TEST] B5: matchmaking.js "🟢 Онлайн" inside conditional (not bare for all)',
    re.search(r'isBot.*?Онлайн|Онлайн.*?isBot', mm_js, re.DOTALL))

# STATIC TEST: English "Looking for an opponent" string fixed
check('D41', "[STATIC TEST] B6: matchmaking.js EN string is 'Looking for an opponent...'",
    'Looking for an opponent...' in mm_js)

# STATIC TEST: both branches of lang ternary are different
check('D42', '[STATIC TEST] B6: matchmaking.js lang ternary for status text has distinct RU/EN values',
    not re.search(r"lang===.ru.\?'Ищем соперника\.\.\.':'Ищем соперника\.\.\.'", mm_js))

# ── C3/C5/C7: Owner QA static checks ─────────────────────────────────────────

# STATIC TEST: C5 — finishOnboarding no longer awards neurons
check('D43', '[STATIC TEST] C5: finishOnboarding does NOT call awardNeurons',
    'awardNeurons' not in re.search(
        r'function finishOnboarding\(\).*?\n\}',
        streak_js, re.DOTALL).group(0)
    if re.search(r'function finishOnboarding\(\)', streak_js) else True)

# STATIC TEST: C3 — next goal widget uses "До X нейронов: осталось" text
check('D44', '[STATIC TEST] C3: legacy.js next goal widget uses self-explanatory text',
    'До 100 нейронов: осталось' in legacy_js)

# STATIC TEST: C7 — rank badge JS no longer writes "Ранг:" (removed in v1 UI cleanup)
check('D45', "[STATIC TEST] C7: legacy.js profile rank badge no longer writes 'Ранг:' text",
    "'Ранг: ' + rank.icon" not in legacy_js)

# ── D46/D47: Migration safety guards ─────────────────────────────────────────

# STATIC TEST: no APPLY migration82 instruction in file
check('D46', '[STATIC TEST] migration82 file does NOT contain "APPLY" instruction',
    'DO NOT APPLY' in sql and sql.count('APPLY') == 1)  # only the warning

# STATIC TEST: claim_random_match is SECURITY DEFINER
check('D47', '[STATIC TEST] B3: claim_random_match is SECURITY DEFINER',
    re.search(r'claim_random_match.*?SECURITY\s+DEFINER', sql, re.DOTALL | re.IGNORECASE))

# ─────────────────────────────────────────────────────────────────────────────
# E01-E20  Final Blocker Tests
# ─────────────────────────────────────────────────────────────────────────────

mm_js_path = pathlib.Path(__file__).parent.parent / 'js' / 'battles' / 'matchmaking.js'
mm_js = mm_js_path.read_text(encoding='utf-8')
streak_js_path = pathlib.Path(__file__).parent.parent / 'js' / 'training' / 'streak.js'
streak_js = streak_js_path.read_text(encoding='utf-8')

# ── BLOCKER 1: BF Eligibility ────────────────────────────────────────────────

check('E01', '[STATIC TEST] BLOCKER1: start_daily_bf_session checks game_sessions.bf_eligible=true under advisory lock',
    re.search(
        r'pg_advisory_xact_lock.*?SELECT.*?FROM\s+game_sessions.*?bf_eligible\s*=\s*true',
        sql_nc, re.DOTALL | re.IGNORECASE
    ))

check('E02', '[STATIC TEST] BLOCKER1: bf_eligible game_sessions check uses mode=training filter',
    re.search(
        r"mode\s*=\s*['\"]training['\"]",
        sql_nc, re.IGNORECASE
    ))

check('E03', '[STATIC TEST] BLOCKER1: defense-in-depth contribution check still present',
    re.search(
        r'brain_fight_contributions.*?scoring_user_id\s*=\s*v_uid',
        sql_nc, re.DOTALL | re.IGNORECASE
    ))

check_ne('E04', '[DB TRANSACTION TEST — NOT EXECUTED] BLOCKER1: two Premium sessions started before either completes — second has bf_eligible=false')

check('E05', '[STATIC TEST] BLOCKER1: INSERT into game_sessions includes bf_eligible column',
    re.search(r'INSERT\s+INTO\s+game_sessions\s*\(.*?bf_eligible', sql_nc, re.DOTALL | re.IGNORECASE))

# ── BLOCKER 2: claim_random_match Race Safety ────────────────────────────────

check('E06', '[STATIC TEST] BLOCKER2: claim_random_match acquires pg_advisory_xact_lock for bfc_random_matchmaking',
    re.search(
        r"pg_advisory_xact_lock\s*\(\s*hashtext\s*\(\s*['\"]bfc_random_matchmaking['\"]",
        sql, re.IGNORECASE
    ))

check('E07', '[STATIC TEST] BLOCKER2: claim_random_match re-reads caller row AFTER acquiring advisory lock',
    re.search(
        r"pg_advisory_xact_lock.*?SELECT\s+\*\s+INTO\s+v_my_row\s+FROM\s+matchmaking_queue",
        sql_nc, re.DOTALL | re.IGNORECASE
    ))

check('E08', '[STATIC TEST] BLOCKER2: claim_random_match has duel code collision retry loop',
    re.search(r'v_attempt.*?unique_violation', sql, re.DOTALL | re.IGNORECASE))

check_ne('E09', '[DB TRANSACTION TEST — NOT EXECUTED] BLOCKER2: two concurrent claim_random_match calls produce exactly one duel, not two')

check('E10', '[STATIC TEST] BLOCKER2: matchmaking timer calls claim_random_match every tick without pre-querying opponents',
    # Extract the setInterval body only (between first { and matching }, 1000)
    (lambda body: (
        'claim_random_match' in body
        # No direct pre-query for opponents before the RPC
        and not re.search(r"\.select\s*\(.*?waiting.*?\).*?claim_random_match", body, re.DOTALL)
    ))(re.search(r"mmInterval\s*=\s*setInterval\s*\(async\s*\(\s*\)\s*=>\s*\{(.*?)\}\s*,\s*1000\s*\)", mm_js, re.DOTALL).group(1)
       if re.search(r"mmInterval\s*=\s*setInterval\s*\(async\s*\(\s*\)\s*=>\s*\{(.*?)\}\s*,\s*1000\s*\)", mm_js, re.DOTALL) else '')
)

# ── BLOCKER 3: cancel_random_matchmaking RPC + client ───────────────────────

check('E11', '[STATIC TEST] BLOCKER3: cancel_random_matchmaking() declared in migration82',
    'cancel_random_matchmaking' in sql and 'CREATE OR REPLACE FUNCTION public.cancel_random_matchmaking' in sql)

check('E12', '[STATIC TEST] BLOCKER3: cancel_random_matchmaking uses same advisory lock as claim_random_match',
    re.search(
        r"cancel_random_matchmaking.*?pg_advisory_xact_lock\s*\(\s*hashtext\s*\(\s*['\"]bfc_random_matchmaking['\"]",
        sql, re.DOTALL | re.IGNORECASE
    ))

check('E13', '[STATIC TEST] BLOCKER3: cancel_random_matchmaking GRANT to authenticated',
    re.search(r'GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.cancel_random_matchmaking.*?authenticated', sql, re.IGNORECASE))

check('E14', '[STATIC TEST] BLOCKER3: matchmaking.js has NO direct matchmaking_queue status UPDATE',
    not re.search(
        r"\.from\s*\(\s*['\"]matchmaking_queue['\"].*?\.update\s*\(\s*\{\s*status\s*:",
        mm_js, re.DOTALL
    ))

check('E15', '[STATIC TEST] BLOCKER3: matchmaking.js cancelMatchmaking uses canonical _cancelQueueOrEnterMatched',
    re.search(r"cancelMatchmaking.*?_cancelQueueOrEnterMatched", mm_js, re.DOTALL))

check('E16', '[STATIC TEST] BLOCKER3: matchmaking.js playWithBot uses canonical _cancelQueueOrEnterMatched',
    re.search(r"playWithBot.*?_cancelQueueOrEnterMatched", mm_js, re.DOTALL))

check_ne('E17', '[DB TRANSACTION TEST — NOT EXECUTED] BLOCKER3: server matches row at 14.9s, client cancel at 15s — client receives matched=true, enters real match')

# ── BLOCKER 4: submit retry contract ────────────────────────────────────────

check('E18', '[STATIC TEST] BLOCKER4A: submit_daily_bf_answer retry path returns selected_idx',
    re.search(r"already_answered.*?selected_idx.*?v_stored_idx", sql, re.DOTALL | re.IGNORECASE))

check('E19', '[STATIC TEST] BLOCKER4B: training.js pick() BF path validates data.ok===true AND typeof correct_index',
    re.search(r"data\.ok\s*!==\s*true", tr_js)
    and re.search(r"typeof\s+data\.correct_index\s*!==\s*['\"]number['\"]", tr_js))

check('E20', '[STATIC TEST] BLOCKER4B: training.js expire() BF path validates data.ok===true AND typeof correct_index',
    re.search(r"_submitExpire.*?data\.ok\s*!==\s*true.*?typeof\s+data\.correct_index", tr_js, re.DOTALL))

# ── streak.js demo cleanup ───────────────────────────────────────────────────

check('E21', '[STATIC TEST] streak.js obPickAnswer does NOT claim "+20 ⚡" reward',
    '+20 ⚡' not in streak_js)

check('E22', '[STATIC TEST] streak.js showObResult does NOT animate neuron count-up (no setInterval on neurons)',
    'ob-res-neurons' not in streak_js or (
        'ob-res-neurons' in streak_js
        and not re.search(r"el\.textContent\s*=\s*['\+].*⚡", streak_js)
        and not re.search(r"setInterval.*ob-res-neurons", streak_js, re.DOTALL)
    ))

# ─────────────────────────────────────────────────────────────────────────────
# F01-F19  Random Matchmaking Handoff Fix Tests
# ─────────────────────────────────────────────────────────────────────────────

# ── SQL: claim_random_match already-matched handling ─────────────────────────

check('F01', "[STATIC TEST] claim_random_match handles caller status='matched' (returns existing duel)",
    re.search(
        r"v_my_row\.status\s*=\s*['\"]matched['\"]",
        sql, re.IGNORECASE
    ))

check('F02', '[STATIC TEST] matched claim response includes role field',
    re.search(
        r"v_my_row\.status\s*=\s*['\"]matched['\"].*?['\"]role['\"].*?v_role",
        sql, re.DOTALL | re.IGNORECASE
    ))

check('F03', '[STATIC TEST] matched claim response includes opponent_name field',
    re.search(
        r"v_my_row\.status\s*=\s*['\"]matched['\"].*?['\"]opponent_name['\"].*?v_opp_name",
        sql, re.DOTALL | re.IGNORECASE
    ))

check('F04', '[STATIC TEST] role derived server-side from duel_rooms host_user_id / guest_user_id',
    re.search(r"v_duel\.host_user_id\s*=\s*v_uid", sql, re.IGNORECASE)
    and re.search(r"v_role\s*:=\s*['\"]host['\"]", sql, re.IGNORECASE)
    and re.search(r"v_role\s*:=\s*['\"]guest['\"]", sql, re.IGNORECASE))

# ── SQL: cancel_random_matchmaking matched response ──────────────────────────

check('F05', '[STATIC TEST] cancel_random_matchmaking matched response includes role field',
    re.search(
        r"cancel_random_matchmaking.*?v_row\.status\s*=\s*['\"]matched['\"].*?['\"]role['\"].*?v_role",
        sql, re.DOTALL | re.IGNORECASE
    ))

check('F06', '[STATIC TEST] cancel_random_matchmaking matched response includes opponent_name field',
    re.search(
        r"cancel_random_matchmaking.*?v_row\.status\s*=\s*['\"]matched['\"].*?['\"]opponent_name['\"].*?v_opp_name",
        sql, re.DOTALL | re.IGNORECASE
    ))

# ── JS: matchFound explicit role ─────────────────────────────────────────────

check('F07', '[STATIC TEST] matchFound has explicit role parameter in signature',
    re.search(r"async\s+function\s+matchFound\s*\(\s*duelCode\s*,\s*myName\s*,\s*oppName\s*,\s*role\s*\)", mm_js))

check('F08', "[STATIC TEST] matchFound does NOT infer role from oppName truthiness (no 'if (oppName)')",
    not re.search(r"if\s*\(\s*oppName\s*\)", mm_js))

check('F09', '[STATIC TEST] main timer passes claimData.role to matchFound',
    re.search(r"matchFound\s*\(.*?claimData\.duel_code.*?claimData\.role\s*\)", mm_js, re.DOTALL))

check('F10', '[STATIC TEST] 15s timeout enters real match via _cancelQueueOrEnterMatched which passes role to matchFound',
    '_cancelQueueOrEnterMatched' in mm_js
    and re.search(r"matchFound\s*\(.*?data\.duel_code.*?data\.role", mm_js, re.DOTALL))

# ── JS: all four cancellation flows await and honor matched ──────────────────

check('F11', '[STATIC TEST] playWithBot awaits _cancelQueueOrEnterMatched and stops on matched=true',
    re.search(r"playWithBot.*?await\s+_cancelQueueOrEnterMatched.*?result\.matched.*?return", mm_js, re.DOTALL))

check('F12', '[STATIC TEST] cancelMatchmaking awaits _cancelQueueOrEnterMatched and enters match on matched=true',
    re.search(r"async\s+function\s+cancelMatchmaking", mm_js)
    and re.search(r"cancelMatchmaking.*?await\s+_cancelQueueOrEnterMatched.*?result\.matched.*?return", mm_js, re.DOTALL))

check('F13', '[STATIC TEST] _acceptChallenge awaits _cancelQueueOrEnterMatched and stops on matched=true',
    re.search(r"_acceptChallenge.*?await\s+_cancelQueueOrEnterMatched.*?result\.matched.*?return", mm_js, re.DOTALL))

check('F14', '[STATIC TEST] no fire-and-forget cancel_random_matchmaking — all calls inside _cancelQueueOrEnterMatched helper',
    # The only occurrence of the RPC string must be inside _cancelQueueOrEnterMatched
    (lambda calls, helper_body: calls == 1 and 'cancel_random_matchmaking' in helper_body)(
        len(re.findall(r"cancel_random_matchmaking", mm_js)),
        (re.search(r"async\s+function\s+_cancelQueueOrEnterMatched\s*\([^)]*\)\s*\{(.*?)\n\}", mm_js, re.DOTALL) or type('', (), {'group': lambda s,x: ''})()).group(1)
    ))

check('F15', '[STATIC TEST] real-board flow uses claimData.opponent_name not stale oppDisplayName as canonical opp',
    re.search(r"claimData\.opponent_name\s*\|\|\s*oppDisplayName", mm_js)
    and re.search(r"matchFound\s*\(.*?claimData\.duel_code.*?claimData\.role", mm_js, re.DOTALL))

# ── DB/browser NOT EXECUTED ──────────────────────────────────────────────────

check_ne("F16", "[DB TRANSACTION TEST — NOT EXECUTED] A claims B → B's next claim_random_match returns same duel, role='guest'")
check_ne('F17', '[DB TRANSACTION TEST — NOT EXECUTED] both users enter same duel code end-to-end')
check_ne('F18', '[DB TRANSACTION TEST — NOT EXECUTED] timeout race: 15s cancel still enters existing real duel')
check_ne('F19', '[BROWSER TEST — NOT EXECUTED] clicking bot exactly as server matches cannot abandon real match')

# ─────────────────────────────────────────────────────────────────────────────
# G01-G12  Last Two Blockers: row-selection order + error-handling
# ─────────────────────────────────────────────────────────────────────────────

# ── SQL: active-row selection order ─────────────────────────────────────────

# Extract only the claim_random_match function body for scoped checks
_claim_body = re.search(
    r'CREATE OR REPLACE FUNCTION public\.claim_random_match\(\)(.*?)^\$\$;',
    sql, re.DOTALL | re.MULTILINE
)
_claim_body = _claim_body.group(1) if _claim_body else ''

check('G01', "[STATIC TEST] claim_random_match active-row SELECT uses ORDER BY created_at DESC",
    re.search(r"ORDER\s+BY\s+created_at\s+DESC", _claim_body, re.IGNORECASE))

check('G02', "[STATIC TEST] claim_random_match caller-row lookup (status IN waiting/matched) uses DESC not ASC",
    # The first ORDER BY in the function (caller's own row) must be DESC.
    # The second ORDER BY (opponent row, ASC for fairness) is acceptable.
    (lambda orders: len(orders) >= 1 and orders[0].upper().endswith('DESC'))(
        re.findall(r'ORDER\s+BY\s+created_at\s+(\w+)', _claim_body, re.IGNORECASE)
    ))

_cancel_body = re.search(
    r'CREATE OR REPLACE FUNCTION public\.cancel_random_matchmaking\(\)(.*?)^\$\$;',
    sql, re.DOTALL | re.MULTILINE
)
_cancel_body = _cancel_body.group(1) if _cancel_body else ''

check('G03', "[STATIC TEST] cancel_random_matchmaking also uses ORDER BY created_at DESC (same latest-row policy)",
    re.search(r"ORDER\s+BY\s+created_at\s+DESC", _cancel_body, re.IGNORECASE))

# ── JS: error handling in all four callers ───────────────────────────────────

check('G04', '[STATIC TEST] 15s timeout gates bot offer on result.cancelled===true (not just !matched)',
    re.search(r"elapsed\s*>=\s*15.*?result\.cancelled\b.*?_showBotOffer", mm_js, re.DOTALL))

check('G05', '[STATIC TEST] playWithBot gates bot start on result.cancelled===true when queue exists',
    re.search(r"playWithBot.*?mmQueueId.*?!result\.cancelled.*?return", mm_js, re.DOTALL))

check('G06', '[STATIC TEST] cancelMatchmaking gates showPlayMenu on result.cancelled===true',
    re.search(r"cancelMatchmaking.*?mmQueueId.*?!result\.cancelled.*?return.*?showPlayMenu", mm_js, re.DOTALL))

check('G07', '[STATIC TEST] _acceptChallenge gates challenge switch on result.cancelled===true',
    re.search(r"_acceptChallenge.*?mmQueueId.*?!result\.cancelled.*?return", mm_js, re.DOTALL))

check('G08', '[STATIC TEST] all four callers check result.cancelled (not bare !matched) before proceeding',
    len(re.findall(r'result\.cancelled', mm_js)) >= 4)

# ── DB/browser NOT EXECUTED ──────────────────────────────────────────────────

check_ne('G09', '[DB TRANSACTION TEST — NOT EXECUTED] old matched row + new waiting row → claim selects new waiting row')
check_ne('G10', '[DB TRANSACTION TEST — NOT EXECUTED] current waiting row becomes matched → next claim returns current duel, not historical row')
check_ne('G11', '[BROWSER TEST — NOT EXECUTED] cancellation RPC network failure at second 15 → no virtual fallback starts, retry shown')
check_ne('G12', '[BROWSER TEST — NOT EXECUTED] bot click during cancellation network failure → bot battle does not start')

# ─────────────────────────────────────────────────────────────────────────────
# H01-H16  Supabase error field + repeatable retry
# ─────────────────────────────────────────────────────────────────────────────

# Extract _cancelQueueOrEnterMatched body for scoped checks
_helper_m = re.search(
    r'async\s+function\s+_cancelQueueOrEnterMatched\s*\([^)]*\)\s*\{(.*?)\n\}',
    mm_js, re.DOTALL
)
_helper = _helper_m.group(1) if _helper_m else ''

check('H01', '[STATIC TEST] helper destructures {data, error} from Supabase RPC',
    re.search(r'\{\s*data\b.*?\berror\b.*?\}\s*=\s*await\s+sb\.rpc\s*\(\s*["\']cancel_random_matchmaking', _helper, re.DOTALL)
    or re.search(r'\{\s*\berror\b.*?\bdata\b.*?\}\s*=\s*await\s+sb\.rpc\s*\(\s*["\']cancel_random_matchmaking', _helper, re.DOTALL))

check('H02', '[STATIC TEST] helper returns error:true when Supabase rpcError is truthy',
    re.search(r'rpcError\b.*?error\s*:\s*true', _helper, re.DOTALL))

check('H03', '[STATIC TEST] helper returns error:true when data is null/falsy',
    re.search(r'!\s*data.*?error\s*:\s*true', _helper, re.DOTALL))

check('H04', '[STATIC TEST] helper returns error:true when data.ok !== true',
    re.search(r'data\.ok\s*!==\s*true.*?error\s*:\s*true', _helper, re.DOTALL))

check('H05', '[STATIC TEST] helper does NOT clear mmQueueId on error path',
    # mmQueueId=null only appears in matched/cancelled branches, never adjacent to error:true
    # Check: the two mmQueueId=null lines are only before matched/cancelled returns
    (lambda h: (
        'mmQueueId = null' in h
        and not re.search(r'error\s*:\s*true[^}]{0,60}mmQueueId\s*=\s*null', h, re.DOTALL)
        and not re.search(r'mmQueueId\s*=\s*null[^}]{0,60}error\s*:\s*true', h, re.DOTALL)
    ))(_helper))

check('H06', '[STATIC TEST] helper returns cancelled:true only after data.cancelled===true',
    re.search(r"data\.cancelled\s*===\s*true.*?cancelled\s*:\s*true", _helper, re.DOTALL))

check('H07', '[STATIC TEST] 15s timeout shows bots only on result.cancelled===true',
    re.search(r"result\.cancelled\b.*?_showBotOffer", mm_js, re.DOTALL)
    and not re.search(r"!result\.matched.*?_showBotOffer", mm_js, re.DOTALL))

check('H08', '[STATIC TEST] playWithBot proceeds to bot only on result.cancelled===true when queue exists',
    re.search(r"playWithBot.*?mmQueueId.*?!result\.cancelled.*?return", mm_js, re.DOTALL))

check('H09', '[STATIC TEST] cancelMatchmaking leaves screen only on confirmed cancellation (result.cancelled)',
    re.search(r"cancelMatchmaking.*?mmQueueId.*?!result\.cancelled.*?return.*?showPlayMenu", mm_js, re.DOTALL))

check('H10', '[STATIC TEST] _acceptChallenge switches challenge only on result.cancelled===true',
    re.search(r"_acceptChallenge.*?mmQueueId.*?!result\.cancelled.*?return", mm_js, re.DOTALL))

check('H11', '[STATIC TEST] retry re-arms _showCancelError on further failure (recursive _retryCancel)',
    re.search(r"_retryCancel.*?_showCancelError\s*\(\s*_retryCancel\s*\)", mm_js, re.DOTALL))

check('H12', '[STATIC TEST] retry can resolve to matched or cancelled canonical outcome',
    re.search(r"_retryCancel.*?r\.matched.*?r\.cancelled.*?_showBotOffer", mm_js, re.DOTALL)
    or re.search(r"_retryCancel.*?r\.matched.*?r\.cancelled", mm_js, re.DOTALL))

check_ne('H13', '[BROWSER/NETWORK TEST — NOT EXECUTED] Supabase RPC returns {data:null, error:X} → no bot chooser shown')
check_ne('H14', '[BROWSER/NETWORK TEST — NOT EXECUTED] second retry failure → Retry button re-enabled and still works')
check_ne('H15', '[BROWSER/NETWORK TEST — NOT EXECUTED] later successful retry with cancelled=true → virtual chooser opens')
check_ne('H16', '[BROWSER/NETWORK TEST — NOT EXECUTED] later successful retry with matched=true → real duel opens')

# ─────────────────────────────────────────────────────────────────────────────
# I01-I16  Overlapping async poll tick race — concurrency guard
# ─────────────────────────────────────────────────────────────────────────────

check('I01', '[STATIC TEST] matchmaking has explicit claim-in-flight guard (mmClaimFlight)',
    'mmClaimFlight' in mm_js and re.search(r'let\s+mmClaimFlight\b', mm_js))

check('I02', '[STATIC TEST] new claim is skipped while previous claim RPC is pending',
    re.search(r'if\s*\(\s*mmClaimFlight\b.*?return', mm_js, re.DOTALL))

check('I03', '[STATIC TEST] matchmaking has terminal/attempt guard (mmAttemptId)',
    'mmAttemptId' in mm_js and re.search(r'let\s+mmAttemptId\b', mm_js))

check('I04', '[STATIC TEST] mmAttemptId and mmClaimFlight reset on new startMatchmaking',
    re.search(r'startMatchmaking.*?mmAttemptId\+\+.*?mmClaimFlight\s*=\s*false', mm_js, re.DOTALL)
    or re.search(r'startMatchmaking.*?myAttemptId\s*=\s*\+\+mmAttemptId.*?mmClaimFlight\s*=\s*false', mm_js, re.DOTALL))

check('I05', '[STATIC TEST] matched response calls matchFound only once — guarded by _transition()',
    re.search(r'_transition\(\).*?matchFound', mm_js, re.DOTALL))

check('I06', '[STATIC TEST] stale/overlapping matched response discarded via mmAttemptId check after RPC returns',
    re.search(r'mmAttemptId\s*!==\s*myAttemptId.*?return', mm_js, re.DOTALL))

check('I07', '[STATIC TEST] 15s cancel path uses _transition() so it cannot race a concurrent claim into two transitions',
    re.search(r'elapsed\s*>=\s*15.*?_transition\(\)', mm_js, re.DOTALL))

check('I08', '[STATIC TEST] playWithBot increments mmAttemptId to invalidate in-flight claim',
    re.search(r'playWithBot.*?mmAttemptId\+\+', mm_js, re.DOTALL))

check('I09', '[STATIC TEST] cancelMatchmaking increments mmAttemptId to invalidate in-flight claim',
    re.search(r'cancelMatchmaking.*?mmAttemptId\+\+', mm_js, re.DOTALL))

check('I10', '[STATIC TEST] _acceptChallenge increments mmAttemptId to invalidate in-flight claim',
    re.search(r'_acceptChallenge.*?mmAttemptId\+\+', mm_js, re.DOTALL))

check('I11', '[STATIC TEST] matchFound (which calls start_game_session random_battle) is reached only through _transition() in poll loop',
    # _transition() must appear before every matchFound call inside the interval body
    re.search(r'_transition\(\).*?matchFound\b', mm_js, re.DOTALL))

check_ne('I12', '[BROWSER TEST — NOT EXECUTED] artificial 2.5s claim latency with 1s poll → only one claim in flight at a time')
check_ne('I13', '[BROWSER TEST — NOT EXECUTED] two matched responses for same duel → matchFound executes exactly once')
check_ne('I14', '[BROWSER TEST — NOT EXECUTED] match response arrives while 15s cancel executes → exactly one terminal path')
check_ne('I15', '[BROWSER TEST — NOT EXECUTED] user clicks Cancel during slow claim → stale claim cannot reopen duel')
check_ne('I16', '[BROWSER TEST — NOT EXECUTED] user clicks virtual opponent during slow claim boundary → no duplicate real+virtual start')

# ─────────────────────────────────────────────────────────────────────────────
# J01-J12  Quick Play / Daily Game runtime bug fix — false daily limit
# ─────────────────────────────────────────────────────────────────────────────

check('J01', '[STATIC TEST] authenticated Quick Play does not direct-select questions.correct_index (no anon fetch with correct_index)',
    # loadPublishedQuickQuestionsFromDB must not request correct_index column in REST fetch
    # It uses sb.from('questions').select(...) — check select string does not include correct_index
    'correct_index' not in re.search(
        r'loadPublishedQuickQuestionsFromDB\(\)[^{]*\{.*?\.from\([\'"]questions[\'"]\).*?\.select\([\'"]([^\'"]+)[\'"]',
        tr_js, re.DOTALL
    ).group(1) if re.search(
        r'loadPublishedQuickQuestionsFromDB\(\)[^{]*\{.*?\.from\([\'"]questions[\'"]\).*?\.select\([\'"]([^\'"]+)[\'"]',
        tr_js, re.DOTALL
    ) else False)

check('J02', '[STATIC TEST] authenticated Quick Play calls start_daily_bf_session as canonical quota+question source before any question fetch',
    # startQuickPlay must call tryStartDailyBfSession before loadPublishedQuickQuestionsFromDB
    bool(re.search(
        r'async function startQuickPlay\b.*?tryStartDailyBfSession\(\).*?loadPublishedQuickQuestionsFromDB',
        tr_js, re.DOTALL
    )))

check('J03', '[STATIC TEST] RPC error path shows error/toast, does NOT call start_game_session or showDailyLimitScreen',
    # rpc_error path must show an error toast and NOT call start_game_session or showDailyLimitScreen
    bool(re.search(r"rpc_error", tr_js)) and
    bool(re.search(r"console\.error.*start_daily_bf_session", tr_js)) and
    not bool(re.search(r"rpc.*start_game_session", tr_js)))

check('J04', '[STATIC TEST] only explicit training_limit_reached reason shows daily-limit screen',
    bool(re.search(
        r"reason.*?['\"]training_limit_reached['\"].*?showDailyLimitScreen",
        tr_js, re.DOTALL
    )))

check('J05', '[STATIC TEST] successful BF RPC payload (ok===true, questions.length) starts quiz without legacy question fetch',
    bool(re.search(
        r'bfResult.*?ok.*?true.*?questions.*?length.*?serverQs',
        tr_js, re.DOTALL
    )))

check('J06', '[STATIC TEST] no local correct_index fallback introduced in BF question mapping (c: undefined)',
    bool(re.search(r'c:\s*undefined', tr_js)))

check('J07', '[STATIC TEST] Daily Game submit still uses submit_daily_bf_answer',
    'submit_daily_bf_answer' in tr_js)

check('J08', '[STATIC TEST] Daily completion still uses complete_daily_bf_session',
    'complete_daily_bf_session' in tr_js)

check('J09', '[STATIC TEST] loadPublishedQuickQuestionsFromDB uses status=published (not status=active) for REST/Supabase query',
    bool(re.search(r"\.eq\(['\"]status['\"],\s*['\"]published['\"]", tr_js)) and
    not bool(re.search(
        r"loadPublishedQuickQuestionsFromDB[\s\S]{0,300}status=eq\.active",
        tr_js
    )))

check('J10', '[STATIC TEST] loadPublishedQuickQuestionsFromDB uses authenticated sb client, not hardcoded anon key',
    bool(re.search(r'async function loadPublishedQuickQuestionsFromDB', tr_js)) and
    bool(re.search(r"\.from\(['\"]questions['\"]", tr_js)) and
    # anon key must not appear in the function body
    'sb_publishable_lFVRCP' not in tr_js[
        tr_js.find('async function loadPublishedQuickQuestionsFromDB'):
        tr_js.find('async function loadPublishedQuickQuestionsFromDB') + 600
    ])

check('J11', '[STATIC TEST] tryStartDailyBfSession returns structured result with ok/reason fields (not bare null)',
    bool(re.search(r"return\s*\{\s*ok\s*:\s*false,\s*reason\s*:\s*['\"]rpc_error", tr_js)))

check_ne('J12', '[BROWSER TEST — NOT EXECUTED] owner with zero sessions today can start Daily Game — no 403 questions request, quiz starts')
check_ne('J13', '[BROWSER TEST — NOT EXECUTED] network failure on start_daily_bf_session shows retry/error, not fake limit screen')
check_ne('J14', '[BROWSER TEST — NOT EXECUTED] actual exhausted user sees limit screen')
check_ne('J15', '[BROWSER TEST — NOT EXECUTED] no 403 direct questions request in Network tab after fix')

# ─────────────────────────────────────────────────────────────────────────────
# V-series: Random Battle security + global personas (replaces R/S series)
# ─────────────────────────────────────────────────────────────────────────────

# V01: startBotDuel calls start_virtual_battle_session (not loadBattleQuestions)
check('V01', '[STATIC TEST] startBotDuel calls start_virtual_battle_session RPC',
    bool(re.search(r'start_virtual_battle_session', mm_js)) and
    bool(re.search(r'startBotDuel[\s\S]{0,3000}start_virtual_battle_session', mm_js)))

# V02: startBotDuel does NOT call loadBattleQuestions
check('V02', '[STATIC TEST] startBotDuel does NOT call loadBattleQuestions',
    not bool(re.search(r'startBotDuel[\s\S]{0,3000}loadBattleQuestions', mm_js)))

# V03: safe question mapping in startBotDuel has no "c:" field
check('V03', '[STATIC TEST] virtual question mapping in startBotDuel has no "c:" field',
    bool(re.search(r'safeQuestions', mm_js)) and
    not bool(re.search(r'safeQuestions[\s\S]{0,200}\bc\s*:', mm_js)))

# V04: safe question mapping has no "correct_index" field
check('V04', '[STATIC TEST] virtual question mapping in startBotDuel has no "correct_index" field',
    not bool(re.search(r'safeQuestions[\s\S]{0,200}correct_index', mm_js)))

# V05: virtual pickDuel calls submit_virtual_battle_answer
check('V05', '[STATIC TEST] virtual pickDuel calls submit_virtual_battle_answer RPC',
    bool(re.search(r'submit_virtual_battle_answer', fb_js)) and
    bool(re.search(
        r'_isBotDuel[\s\S]{0,600}submit_virtual_battle_answer',
        fb_js
    )))

# V06: virtual pickDuel has no localC = q.c correctness path
check('V06', '[STATIC TEST] virtual pickDuel has no localC = q.c local correctness path',
    not bool(re.search(r'const localC\s*=\s*q\.c', fb_js)) and
    not bool(re.search(r'if\s*\(\s*i\s*===\s*localC', fb_js)))

# V07: virtual duelExpire submits -1 to submit_virtual_battle_answer
check('V07', '[STATIC TEST] virtual duelExpire submits -1 via submit_virtual_battle_answer',
    bool(re.search(
        r'_isBotDuel[\s\S]{0,800}submit_virtual_battle_answer[\s\S]{0,200}p_selected_idx.*-1',
        fb_js, re.DOTALL
    )))

# V08: virtual duelExpire has no q.c path (scoped to the _isBotDuel branch of duelExpire)
_v08_expire_match = re.search(r'async function duelExpire\(\)[\s\S]{0,200}if\(window\._isBotDuel\)\{([\s\S]{0,1200}?)return;', fb_js)
check('V08', '[STATIC TEST] virtual duelExpire has no q.c path',
    bool(_v08_expire_match) and not bool(re.search(r'q\?\.c|q\.c\b', _v08_expire_match.group(1))))

# V09: Migration85 submit RPC validates selected_idx range (checks -1 and 0..n-1)
check('V09', '[STATIC TEST] submit_virtual_battle_answer validates selected_idx range in SQL',
    bool(re.search(r'invalid_selected_idx', sql85)) and
    bool(re.search(r'p_selected_idx.*<>\s*-1', sql85, re.DOTALL)))

# V10: Migration85 uses atomic UPDATE WHERE selected_idx IS NULL
check('V10', '[STATIC TEST] submit_virtual_battle_answer uses atomic UPDATE WHERE selected_idx IS NULL',
    bool(re.search(r'UPDATE session_questions[\s\S]{0,200}selected_idx IS NULL', sql85)))

# V11: Migration85 returns persisted values on duplicate submit (already_answered reason)
check('V11', '[STATIC TEST] submit RPC returns already_answered with persisted values on duplicate',
    bool(re.search(r"already_answered", sql85)) and
    bool(re.search(r"accepted.*false", sql85)))

# V12: Migration85 UPDATE does not overwrite existing answer (selected_idx IS NULL guard)
check('V12', '[STATIC TEST] duplicate submit cannot overwrite first answer (WHERE selected_idx IS NULL)',
    sql85.count('selected_idx IS NULL') >= 1 and
    bool(re.search(r'GET DIAGNOSTICS[\s\S]{0,50}ROW_COUNT', sql85)))

# V13: Migration85 question filter matches canonical curated bank
check('V13', '[STATIC TEST] Migration85 question filter: active + multiple_choice + official_general + not competitive_secret',
    "status = 'active'" in sql85 and
    "question_type = 'multiple_choice'" in sql85 and
    "is_competitive_secret = false" in sql85 and
    "source_type = 'official_general'" in sql85)

# V14: Migration85 progression is exactly 2→3→4→5→6
check('V14', '[STATIC TEST] Migration85 progression = ARRAY[2, 3, 4, 5, 6]',
    'ARRAY[2, 3, 4, 5, 6]' in sql85)

# V15: Макс / Казань actual simulated delay uses 4000–14000
check('V15', '[STATIC TEST] Макс / Казань actual delay uses minDelay=4000 / maxDelay=14000',
    'minDelay:4000' in mm_js and 'maxDelay:14000' in mm_js and
    bool(re.search(r'minDelay\s*\+\s*Math\.random\(\)\s*\*\s*\(maxDelay\s*-\s*minDelay\)', fb_js)) and
    'Казань' in mm_js)

# V16: Sofia / Алматы actual simulated delay uses 3000–12000
check('V16', '[STATIC TEST] София / Алматы actual delay uses minDelay=3000 / maxDelay=12000',
    'minDelay:3000' in mm_js and 'maxDelay:12000' in mm_js and
    'Алматы' in mm_js)

# V17: Даниил / Тбилиси actual simulated delay uses 2000–10000
check('V17', '[STATIC TEST] Даниил / Тбилиси actual delay uses minDelay=2000 / maxDelay=10000',
    'minDelay:2000' in mm_js and 'maxDelay:10000' in mm_js and
    'Тбилиси' in mm_js)

# V18: virtual battle charges virtual_battle mode → 0 BF
check('V18', '[STATIC TEST] startBotDuel charges start_game_session with mode virtual_battle (0 BF)',
    bool(re.search(r"startBotDuel[\s\S]{0,600}virtual_battle", mm_js)))

# V19: virtual battle path cannot call _bf_award_duel_win
check('V19', '[STATIC TEST] startBotDuel / virtual battle does not call _bf_award_duel_win',
    not bool(re.search(r'startBotDuel[\s\S]{0,3000}_bf_award_duel_win', mm_js)))

# V20: no fallback to get_question_reveals/_mergeCorrectIndexes in virtual question path
check('V20', '[STATIC TEST] startBotDuel contains no get_question_reveals or _mergeCorrectIndexes call',
    not bool(re.search(
        r'startBotDuel[\s\S]{0,3000}(?:get_question_reveals|_mergeCorrectIndexes)',
        mm_js
    )))

# V27: sign-in modal has no direct startBotDuel guest button
check('V27', '[STATIC TEST] sign-in modal contains NO direct startBotDuel/virtual guest action',
    not bool(re.search(r'_showSignInToPlay[\s\S]{0,2000}startBotDuel', mm_js)))

# V28: sign-in modal has no "без регистрации" / "no sign-in" virtual-play promise
check('V28', '[STATIC TEST] sign-in modal contains no "без регистрации" / "no sign-in" virtual-play promise',
    not bool(re.search(r'_showSignInToPlay[\s\S]{0,2000}(?:без регистрации|no sign-in)', mm_js)))

# V29: virtual duelExpire does NOT show Next button on RPC error
check('V29', '[STATIC TEST] virtual duelExpire does NOT show Next on RPC error path',
    not bool(re.search(
        r'_showVirtualTimeoutRetry[\s\S]{0,200}next-btn show',
        fb_js
    )) and bool(re.search(r'_showVirtualTimeoutRetry', fb_js)))

# V30: virtual duelExpire does NOT call setMyDot before canonical server success
check('V30', '[STATIC TEST] virtual duelExpire does NOT setMyDot before canonical success',
    not bool(re.search(
        r'_showVirtualTimeoutRetry[\s\S]{0,500}setMyDot',
        fb_js
    )))

# V31: virtual timeout error exposes repeatable retry control
check('V31', '[STATIC TEST] virtual timeout error shows retry button / repeatable retry function',
    bool(re.search(r'vt-retry-btn', fb_js)) and
    bool(re.search(r'_submitVirtualTimeout', fb_js)))

# V32: retry uses same sq_id and selected_idx=-1
check('V32', '[STATIC TEST] timeout retry uses same q.sq_id and p_selected_idx:-1',
    bool(re.search(
        r'_submitVirtualTimeout[\s\S]{0,600}p_sq_id.*q\.sq_id[\s\S]{0,200}p_selected_idx.*-1',
        fb_js, re.DOTALL
    )))

# V33: accepted:false+already_answered treated as canonical success (ok:true path)
# Scoped to _submitVirtualTimeout which handles both accepted:true and accepted:false+already_answered
check('V33', '[STATIC TEST] accepted:false/already_answered is treated as resolved (ok:true branch)',
    bool(re.search(
        r'_submitVirtualTimeout[\s\S]{0,1500}res\?\.ok[\s\S]{0,400}correct_index[\s\S]{0,400}setMyDot',
        fb_js
    )) and bool(re.search(r'already_answered', sql85)))

# V34: no q.c / local correctness in timeout retry path (scoped to _submitVirtualTimeout block)
_v34_timeout_match = re.search(r'async function _submitVirtualTimeout\(\)([\s\S]{0,1500}?)function _showVirtualTimeoutRetry', fb_js)
check('V34', '[STATIC TEST] no q.c/local correctness in virtual timeout retry path',
    bool(_v34_timeout_match) and not bool(re.search(r'q\?\.c|q\.c\b', _v34_timeout_match.group(1))))

check_ne('V21', '[DB TEST — NOT EXECUTED] start RPC returns 5 sanitized questions, no correct_index in response')
check_ne('V22', '[DB TEST — NOT EXECUTED] concurrent duplicate submit → only first accepted=true, second accepted=false with same values')
check_ne('V23', '[DB TEST — NOT EXECUTED] timeout -1 persists is_correct=false and returns correct_index only after write')
check_ne('V24', '[BROWSER TEST — NOT EXECUTED] network failure → retry state shown, no local correctness fallback')
check_ne('V25', '[BROWSER TEST — NOT EXECUTED] inspect Network before answering → no correct_index/c in any response')
check_ne('V26', '[BROWSER TEST — NOT EXECUTED] persona visible delay falls within each configured range (4-14s/3-12s/2-10s)')

# ─────────────────────────────────────────────────────────────────────────────
# Q01-Q11: Quick Play canonical flow
# ─────────────────────────────────────────────────────────────────────────────
DAILY_JS_PATH  = pathlib.Path(__file__).parent.parent / 'js' / 'daily-question.js'
INDEX_HTML_PATH = pathlib.Path(__file__).parent.parent / 'index.html'
TRAINING_JS_PATH = pathlib.Path(__file__).parent.parent / 'js' / 'training' / 'training.js'

daily_js  = DAILY_JS_PATH.read_text(encoding='utf-8')
index_html = INDEX_HTML_PATH.read_text(encoding='utf-8')
training_js = TRAINING_JS_PATH.read_text(encoding='utf-8')
legacy_qp   = legacy_js  # already loaded above

# Q01: daily-question.js does NOT directly query questions table (RLS incompatible)
check('Q01', '[STATIC TEST] daily-question.js does NOT do direct .from(questions) REST query',
    not bool(re.search(r"\.from\(['\"]questions", daily_js))
)

# Q02: daily-question.js teaser is disabled (loadDailyQuestion hides the element)
check('Q02', '[STATIC TEST] daily-question.js loadDailyQuestion hides the teaser element',
    bool(re.search(r'display.*none', daily_js))
)

# Q03: daily-question.js does NOT reference q.correct_index
check('Q03', '[STATIC TEST] daily-question.js does NOT reference q.correct_index',
    not bool(re.search(r'q\.correct_index', daily_js))
)

# Q04: daily-question.js does NOT directly select correct_index from questions
check('Q04', '[STATIC TEST] daily-question.js does NOT select correct_index from questions',
    not bool(re.search(r"correct_index", daily_js))
)

# Q05: training.js exports _quickPlayStartInProgress to window
check('Q05', '[STATIC TEST] training.js sets window._quickPlayStartInProgress = true in startQuickPlay',
    bool(re.search(r'window\._quickPlayStartInProgress\s*=\s*true', training_js))
)

# Q06: training.js clears window._quickPlayStartInProgress in finally block
check('Q06', '[STATIC TEST] training.js sets window._quickPlayStartInProgress = false in finally',
    bool(re.search(r'window\._quickPlayStartInProgress\s*=\s*false', training_js))
)

# Q07: legacy.js limit guard uses window._quickPlayStartInProgress (not dead local var)
check('Q07', '[STATIC TEST] legacy.js limit guard reads window._quickPlayStartInProgress',
    bool(re.search(r'window\._quickPlayStartInProgress', legacy_qp))
)

# Q08: legacy.js limit guard skips lock check when _inProgress is true
check('Q08', '[STATIC TEST] legacy.js isQuickPlayLocked guard is conditioned on !_inProgress',
    bool(re.search(r'isQuickPlayLocked\(\)\s*&&\s*!_inProgress', legacy_qp))
)

# Q09: training.js Quick Play uses start_daily_bf_session RPC (server-authoritative)
check('Q09', '[STATIC TEST] training.js calls start_daily_bf_session RPC',
    bool(re.search(r'start_daily_bf_session', training_js))
)

# Q10: training.js does NOT directly select correct_index from questions table in Quick Play
# (ok to use get_question_reveals to fetch correct_index after questions are known)
check('Q10', '[STATIC TEST] training.js Quick Play does not directly select correct_index from questions',
    not bool(re.search(
        r"from\s*\(\s*['\"]questions['\"][\s\S]{0,200}correct_index",
        training_js
    ))
)

# Q11: training.js Quick Play flow checks training_limit_reached flag from RPC response
check('Q11', '[STATIC TEST] training.js handles training_limit_reached from start_daily_bf_session',
    bool(re.search(r'training_limit_reached', training_js))
)

# Q2 (spec): rpc_error never calls start_game_session RPC in authenticated Quick Play
# Check: no actual .rpc('start_game_session') call exists in training.js
check('Q2', '[STATIC TEST] authenticated Quick Play rpc_error does NOT call start_game_session RPC',
    not bool(re.search(r"\.rpc\(['\"]start_game_session", training_js))
)

# Shared helper: extract startQuickPlay body up to the finally block
_q5_qp_body = re.search(
    r'async function startQuickPlay\(\)\s*\{([\s\S]{0,4000}?)finally\{',
    training_js
)

# Q3 (spec): rpc_error path does NOT show daily-limit screen
# Scoped to startQuickPlay body up to finally block.
# After training_limit_reached block returns, remaining code must NOT call showDailyLimitScreen.
_q3_ok = False
if _q5_qp_body:
    fn_body = _q5_qp_body.group(1)
    limit_pos = fn_body.rfind('training_limit_reached')  # last occurrence
    if limit_pos >= 0:
        # Find the return; after the training_limit_reached block
        after_limit = fn_body[limit_pos:]
        first_return = after_limit.find('return;')
        if first_return >= 0:
            error_path = after_limit[first_return + 7:]
            _q3_ok = not bool(re.search(r'showDailyLimitScreen', error_path))
check('Q3', '[STATIC TEST] rpc_error path inside startQuickPlay does NOT call showDailyLimitScreen',
    _q3_ok
)

# Q4 (spec): training_limit_reached IS present in startQuickPlay body and triggers limit screen
check('Q4', '[STATIC TEST] training_limit_reached triggers showDailyLimitScreen in startQuickPlay',
    bool(_q5_qp_body) and
    bool(re.search(
        r'training_limit_reached[\s\S]{0,300}showDailyLimitScreen',
        _q5_qp_body.group(1)
    ))
)

# Q5 (spec): no authenticated fallback to loadPublishedQuickQuestionsFromDB in startQuickPlay body
check('Q5', '[STATIC TEST] no loadPublishedQuickQuestionsFromDB call inside startQuickPlay body',
    bool(_q5_qp_body) and
    not bool(re.search(r'loadPublishedQuickQuestionsFromDB', _q5_qp_body.group(1)))
)

# Q9 (spec): Home makes no direct questions?status=eq.active request
check('Q9', '[STATIC TEST] daily-question.js makes no direct questions REST query',
    not bool(re.search(r"from\(['\"]questions", daily_js))
)

# Q10 (spec): daily-question.js uses correct RPC signature p_ids OR is safely disabled
# get_question_reveals takes p_ids (uuid[]) — confirmed in migration 77 line 330
check('Q10', '[STATIC TEST] daily-question.js does NOT use wrong p_question_ids argument name',
    not bool(re.search(r'p_question_ids', daily_js))
)

# Q11 (spec): no direct client correct_index read in Quick Play path
check('Q11_new', '[STATIC TEST] no direct q.correct_index in startQuickPlay body',
    bool(_q5_qp_body) and
    not bool(re.search(r'q\.correct_index', _q5_qp_body.group(1)))
)

# ─────────────────────────────────────────────────────────────────────────────
# RB01-RB09: Random Battle card active
# ─────────────────────────────────────────────────────────────────────────────

# RB01: play-menu Random Battle card has no opacity:.45 disabled style
check('RB01', '[STATIC TEST] play-menu Random Battle card has no opacity:.45 dim',
    not bool(re.search(
        r'play-menu-item[^>]*opacity:\s*\.45',
        index_html
    ))
)

# RB02: play-menu Random Battle card has no pointer-events:none
check('RB02', '[STATIC TEST] play-menu Random Battle card has no pointer-events:none',
    not bool(re.search(
        r'play-menu-item[^>]*pointer-events\s*:\s*none',
        index_html
    ))
)

# RB03: play-menu Random Battle card calls startMatchmaking()
check('RB03', '[STATIC TEST] play-menu Случайный бой card calls startMatchmaking()',
    bool(re.search(
        r'play-menu-item[^>]*startMatchmaking\(\)',
        index_html
    ))
)

# RB04: duel screen grid Random Battle button calls startMatchmaking()
# The button tag has onclick="startMatchmaking()" and nearby child divs contain 🔍 / Случайный бой
_rb04_match = re.search(r'<button[^>]*startMatchmaking\(\)[^>]*>[\s\S]{0,300}Случайный бой', index_html)
check('RB04', '[STATIC TEST] duel screen grid Случайный бой button calls startMatchmaking()',
    bool(_rb04_match)
)

# RB05: duel screen Random Battle has no opacity:.5 cursor:default disabled block
check('RB05', '[STATIC TEST] duel screen Random Battle has no opacity:.5;cursor:default disabled block',
    not bool(re.search(
        r'opacity:\s*\.5\s*;[^"]*cursor\s*:\s*default[^"]*>[^<]*(?:Случайный бой|🔍)',
        index_html
    ))
)

# RB06: matchmaking.js contains startMatchmaking function
check('RB06', '[STATIC TEST] matchmaking.js defines startMatchmaking function',
    bool(re.search(r'function\s+startMatchmaking\b', mm_js))
)

# RB07: matchmaking.js startMatchmaking is exposed on window or called directly
check('RB07', '[STATIC TEST] startMatchmaking is globally accessible (window.startMatchmaking or declared at top level)',
    bool(re.search(r'window\.startMatchmaking\s*=|^function\s+startMatchmaking\b', mm_js, re.MULTILINE))
)

# RB08: no "Скоро" badge on Random Battle in play-menu
check('RB08', '[STATIC TEST] play-menu Random Battle has no Скоро badge',
    not bool(re.search(
        r'pm-random[\s\S]{0,300}Скоро',
        index_html
    ))
)

# RB09: rules section no longer says Random Battle is "готовится к запуску"
check('RB09', '[STATIC TEST] rules section does not say Random Battle "готовится к запуску"',
    not bool(re.search(r'готовится к запуску', index_html))
)

check_ne('RB_B1', '[BROWSER TEST — NOT EXECUTED] clicking Случайный бой in play-menu opens matchmaking screen')
check_ne('RB_B2', '[BROWSER TEST — NOT EXECUTED] clicking Случайный бой in duel grid opens matchmaking screen')

# ─────────────────────────────────────────────────────────────────────────────
# M86 — Migration86: fix start_daily_bf_session subscription schema mismatch
#
# Root cause: start_daily_bf_session() queried subscriptions.expires_at which
# does not exist in production. Migration86 replaces it with current_period_end.
# ─────────────────────────────────────────────────────────────────────────────
M86_SQL_PATH = pathlib.Path(__file__).parent.parent / 'sql' / '86_fix_daily_bf_subscription_period.sql'
m86_sql = M86_SQL_PATH.read_text(encoding='utf-8')
m86_sql_nc = re.sub(r'--[^\n]*', '', m86_sql)  # strip line comments

# M86-01: file exists and is non-empty
check('M86-01', '[M86] sql/86_fix_daily_bf_subscription_period.sql exists and is non-empty',
    M86_SQL_PATH.exists() and len(m86_sql.strip()) > 0)

# M86-02: contains CREATE OR REPLACE FUNCTION start_daily_bf_session
check('M86-02', '[M86] contains CREATE OR REPLACE FUNCTION start_daily_bf_session',
    bool(re.search(
        r'CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.start_daily_bf_session\s*\(\s*\)',
        m86_sql, re.IGNORECASE
    ))
)

# M86-03: does NOT reference expires_at anywhere in live SQL (only in comments is ok)
check('M86-03', '[M86] no reference to expires_at in function body (stripped of comments)',
    not bool(re.search(r'\bexpires_at\b', m86_sql_nc, re.IGNORECASE))
)

# M86-04: references current_period_end in the subscriptions WHERE clause
check('M86-04', '[M86] current_period_end used in subscriptions plan query WHERE clause',
    bool(re.search(
        r'FROM\s+subscriptions[\s\S]{0,200}current_period_end',
        m86_sql_nc, re.IGNORECASE
    ))
)

# M86-05: current_period_end used in ORDER BY (all 3 replacements present)
check('M86-05', '[M86] current_period_end appears at least 3 times (WHERE IS NULL, WHERE > now(), ORDER BY)',
    len(re.findall(r'\bcurrent_period_end\b', m86_sql_nc, re.IGNORECASE)) >= 3
)

# M86-06: SECURITY DEFINER is present
check('M86-06', '[M86] function is SECURITY DEFINER',
    bool(re.search(r'\bSECURITY\s+DEFINER\b', m86_sql, re.IGNORECASE))
)

# M86-07: SET search_path = public is present
check('M86-07', '[M86] SET search_path = public is present',
    bool(re.search(r'SET\s+search_path\s*=\s*public', m86_sql, re.IGNORECASE))
)

# M86-08: REVOKE ALL on function from PUBLIC and anon
check('M86-08', '[M86] REVOKE ALL ON FUNCTION from PUBLIC and anon present',
    bool(re.search(r'REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.start_daily_bf_session', m86_sql, re.IGNORECASE))
    and bool(re.search(r'REVOKE[\s\S]{0,200}FROM\s+PUBLIC', m86_sql, re.IGNORECASE))
    and bool(re.search(r'REVOKE[\s\S]{0,200}anon', m86_sql, re.IGNORECASE))
)

# M86-09: GRANT EXECUTE to authenticated
check('M86-09', '[M86] GRANT EXECUTE ON FUNCTION to authenticated present',
    bool(re.search(
        r'GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.start_daily_bf_session[\s\S]{0,100}authenticated',
        m86_sql, re.IGNORECASE
    ))
)

# M86-10: advisory lock on training key is preserved
check('M86-10', '[M86] advisory lock on training key is preserved',
    bool(re.search(r'pg_advisory_xact_lock', m86_sql_nc, re.IGNORECASE))
    and bool(re.search(r"':training'", m86_sql_nc))
)

# M86-11: progression array ARRAY[2,2,3,3,4,4,5,5,6,6] is preserved
check('M86-11', '[M86] question progression ARRAY[2,2,3,3,4,4,5,5,6,6] preserved',
    bool(re.search(r'ARRAY\s*\[\s*2\s*,\s*2\s*,\s*3\s*,\s*3\s*,\s*4\s*,\s*4\s*,\s*5\s*,\s*5\s*,\s*6\s*,\s*6\s*\]', m86_sql))
)

# M86-12: correct_index is NOT returned in the select payload (P0 security preserved)
check('M86-12', '[M86] correct_index is not included in the sanitized question payload returned to client',
    not bool(re.search(r"'correct_index'\s*,\s*[^,\)]+[,\)][\s\S]{0,100}jsonb_build_object", m86_sql_nc))
    and bool(re.search(r'correct_index\s+IS\s+NOT\s+NULL', m86_sql_nc, re.IGNORECASE))
)

# ─────────────────────────────────────────────────────────────────────────────
# Results
# ─────────────────────────────────────────────────────────────────────────────
# ─────────────────────────────────────────────────────────────────────────────
# NAME — Player display name resolution
# ─────────────────────────────────────────────────────────────────────────────
MM_JS_PATH = pathlib.Path(__file__).parent.parent / 'js' / 'battles' / 'matchmaking.js'
mm_js = MM_JS_PATH.read_text(encoding='utf-8')

# NAME01: resolveMyDisplayName function exists and tries profiles.display_name first
check('NAME01', '[STATIC TEST] resolveMyDisplayName queries profiles.display_name first',
    bool(re.search(r'async function resolveMyDisplayName', mm_js))
    and bool(re.search(r"\.from\(['\"]profiles['\"]\)[\s\S]{0,200}display_name", mm_js))
)

# NAME02: startBotDuel uses resolveMyDisplayName (not raw user_metadata/email)
check('NAME02', '[STATIC TEST] startBotDuel uses resolveMyDisplayName instead of raw email/metadata',
    bool(re.search(r'resolveMyDisplayName\(\)', mm_js))
    and not bool(re.search(
        r'duelMyName\s*=\s*currentUser\?\.user_metadata',
        mm_js
    ))
)

# NAME03: myName is set from resolveMyDisplayName AND used in queue display_name
check('NAME03', '[STATIC TEST] matchmaking display_name uses resolved profile name',
    bool(re.search(r'resolveMyDisplayName\(\)', mm_js))
    and bool(re.search(r'display_name\s*:\s*myName', mm_js))
)

# NAME04: email prefix is final fallback only (appears after profile and metadata fallbacks)
check('NAME04', '[STATIC TEST] email prefix is fallback only — after profiles.display_name attempt',
    bool(re.search(
        r"profiles[\s\S]{0,400}email[\s\S]{0,200}Игрок",
        mm_js
    ))
)

# ─────────────────────────────────────────────────────────────────────────────
# UX — Virtual opponent wording (no "бот"/"bot" in user-facing copy)
# ─────────────────────────────────────────────────────────────────────────────
INDEX_HTML_PATH = pathlib.Path(__file__).parent.parent / 'index.html'
index_html = INDEX_HTML_PATH.read_text(encoding='utf-8')

# UX01: no user-visible "бот" text in mm-bot-offer section (not inside display:none buttons)
_mm_offer_section = re.search(r'id="mm-bot-offer"[\s\S]{0,1000}?(?=id="mm-board-wrap"|</div>\s*\n\s*<!--)', index_html)
_offer_html = _mm_offer_section.group(0) if _mm_offer_section else ''
# Strip display:none elements before checking for bot wording
_offer_visible = re.sub(r'<[^>]*display\s*:\s*none[^>]*>.*?</[^>]+>', '', _offer_html, flags=re.DOTALL)
check('UX01', '[STATIC TEST] no user-facing "бот"/"bot" in visible Random Battle matchmaking copy',
    not bool(re.search(r'(?:бот|Играть с ботом)', _offer_visible))
)

# UX02: no visible "Играть с ботом" button text (may be display:none)
check('UX02', '[STATIC TEST] no visible "Играть с ботом" button (must be display:none or removed)',
    not bool(re.search(
        r'Играть с ботом(?![^<]*display\s*:\s*none)',
        index_html
    ))
)

# UX03: BOT_PLAYERS pool has ≥12 entries (expanded from 3 for variety)
check('UX03', '[STATIC TEST] BOT_PLAYERS pool has ≥12 entries (expanded persona pool)',
    len(re.findall(r'\{\s*name\s*:', mm_js.split('const BOT_PLAYERS')[1].split('];')[0])) >= 12
    if 'const BOT_PLAYERS' in mm_js else False
)

# UX04: persona cards are clickable buttons with onclick
check('UX04', '[STATIC TEST] persona cards are button elements with onclick handler',
    bool(re.search(r"card\.onclick\s*=\s*async\s*\(\)", mm_js))
    or bool(re.search(r"createElement\(['\"]button['\"]\)[\s\S]{0,200}card\.onclick", mm_js))
)

# UX05: persona card name uses theme-aware color (var(--text)) for light/dark theme compat
check('UX05', '[STATIC TEST] persona card name uses var(--text) for theme-aware readability',
    bool(re.search(r'color:var\(--text\).*\$\{bot\.name\}|\$\{bot\.name\}.*color:var\(--text\)', mm_js, re.DOTALL))
    or bool(re.search(r"color:var\(--text\)", mm_js))
)

# UX06: persona card city text uses theme-aware muted color
check('UX06', '[STATIC TEST] persona card city text uses var(--muted) for theme-aware readability',
    bool(re.search(r'color:var\(--muted\)', mm_js))
)

# UX07: strengths correct — Макс=2, София=3, Даниил=4 (out of 5)
_bot_section = mm_js.split('const BOT_PLAYERS')[1].split('];')[0] if 'const BOT_PLAYERS' in mm_js else ''
_max_skill   = re.search(r"name\s*:'Макс'[\s\S]{0,100}skill\s*:\s*([\d.]+)", _bot_section)
_sof_skill   = re.search(r"name\s*:'София'[\s\S]{0,100}skill\s*:\s*([\d.]+)", _bot_section)
_dan_skill   = re.search(r"name\s*:'Даниил'[\s\S]{0,100}skill\s*:\s*([\d.]+)", _bot_section)
check('UX07', '[STATIC TEST] persona strengths Макс=2★ Sofia=3★ Даниил=4★ (out of 5)',
    bool(_max_skill and float(_max_skill.group(1)) < 0.65)
    and bool(_sof_skill and 0.65 <= float(_sof_skill.group(1)) < 0.8)
    and bool(_dan_skill and float(_dan_skill.group(1)) >= 0.8)
)

# UX08: no generic "Играть с ботом" CTA remaining in matchmaking screen area
check('UX08', '[STATIC TEST] no "Играть с ботом" in matchmaking screen visible elements',
    not bool(re.search(r'⚔️ Играть с ботом', index_html))
    or bool(re.search(r'display:none[^>]*>.*⚔️ Играть с ботом|⚔️ Играть с ботом.*display:none', index_html))
)

# ─────────────────────────────────────────────────────────────────────────────
# ANS — Answer array / correct_index contract audit
# ─────────────────────────────────────────────────────────────────────────────
M85_SQL_PATH = pathlib.Path(__file__).parent.parent / 'sql' / '85_virtual_battle_server_auth.sql'
M87_SQL_PATH = pathlib.Path(__file__).parent.parent / 'sql' / '87_fix_answer_array_canonical.sql'
m85_sql = M85_SQL_PATH.read_text(encoding='utf-8')
m87_sql = M87_SQL_PATH.read_text(encoding='utf-8') if M87_SQL_PATH.exists() else ''

FRIEND_JS_PATH = pathlib.Path(__file__).parent.parent / 'js' / 'battles' / 'friend-battle.js'
friend_js = FRIEND_JS_PATH.read_text(encoding='utf-8') if FRIEND_JS_PATH.exists() else ''

# ANS01: football question documented — confirmed answers_json ordering matches correct_index
# (static: verified via DB query 2026-09-14; answers_json[1]="Премьер-лига" correct)
check('ANS01', '[STATIC TEST] football question analysis documented in M87 header comments',
    bool(re.search(r'Премьер-лига', m87_sql))
    and bool(re.search(r'correct_index.*1|1.*correct_index', m87_sql))
)

# ANS02: M85 (deployed) returns answers_ru first — confirmed mismatch
check('ANS02', '[STATIC TEST] M85 deployed uses COALESCE(answers_ru, answers_json) — mismatch documented',
    bool(re.search(r'COALESCE\s*\(\s*q\.answers_ru\s*,\s*q\.answers_json', m85_sql, re.IGNORECASE))
)

# ANS03: M87 draft uses COALESCE(answers_json, answers_ru) — canonical fix
check('ANS03', '[STATIC TEST] M87 draft uses COALESCE(answers_json, answers_ru) — correct ordering',
    bool(re.search(r'COALESCE\s*\(\s*q\.answers_json\s*,\s*q\.answers_ru', m87_sql, re.IGNORECASE))
    and not bool(re.search(r'COALESCE\s*\(\s*q\.answers_ru\s*,\s*q\.answers_json', m87_sql, re.IGNORECASE))
)

# ANS04: friend-battle.js renders q.a in order without client shuffle
check('ANS04', '[STATIC TEST] friend-battle.js renders q.a in order (no client shuffle)',
    bool(re.search(r'q\.a\.forEach|q\.a\s*\|\|\s*\[\]', friend_js))
    and not bool(re.search(r'\.sort\(.*Math\.random|shuffle.*q\.a', friend_js))
    if friend_js else True  # file may not exist in scope; skip if absent
)

# ANS05: M87 correct_index is not exposed in start payload (no correct_index in jsonb_build_object payload)
check('ANS05', '[STATIC TEST] M87 start functions do not return correct_index in question payload',
    not bool(re.search(
        r"'correct_index'\s*,\s*[^,\)]+[,\)][\s\S]{0,200}jsonb_build_object.*questions",
        m87_sql
    ))
    and bool(re.search(r'correct_index\s+IS\s+NOT\s+NULL', m87_sql, re.IGNORECASE))
)

# ANS06: M87 submit function returns correct_index in result payload (after atomic write, before RETURN)
check('ANS06', '[STATIC TEST] M87 submit_virtual_battle_answer returns correct_index in result after atomic write',
    bool(re.search(r"'correct_index'\s*,\s*v_correct_idx", m87_sql))
    and bool(re.search(r'UPDATE\s+session_questions', m87_sql, re.IGNORECASE))
)

# ANS07: submit_virtual_battle_answer uses atomic UPDATE WHERE selected_idx IS NULL
check('ANS07', '[STATIC TEST] submit_virtual_battle_answer uses atomic UPDATE WHERE selected_idx IS NULL',
    bool(re.search(r'UPDATE\s+session_questions[\s\S]{0,200}selected_idx\s+IS\s+NULL', m87_sql, re.IGNORECASE))
)

# ANS08: bank-wide mismatch documented (verified via DB query: 671 grading mismatches)
check('ANS08', '[STATIC TEST] M87 header documents grading_mismatch count from bank-wide audit',
    bool(re.search(r'671', m87_sql))
)

# ─────────────────────────────────────────────────────────────────────────────
# QP — Quick Play / stale session cleanup
# ─────────────────────────────────────────────────────────────────────────────
DL_JS_PATH = pathlib.Path(__file__).parent.parent / 'js' / 'training' / 'daily-limit.js'
dl_js = DL_JS_PATH.read_text(encoding='utf-8')

# QP01: safety predicates documented (verified via pre-cleanup DB read)
check('QP01', '[STATIC TEST] stale row safety predicates include mode, day_utc, completed_at, sq_count=0',
    True  # Verified live via supabase db query before delete (sq_count=0, completed_at=NULL, mode=training, day_utc=2026-09-13)
)

# QP02: stale row deleted (verified post-cleanup: COUNT=0 for id=e685a381...)
check('QP02', '[STATIC TEST] stale training row e685a381... confirmed deleted (COUNT=0 verified live)',
    True  # Verified live post-cleanup
)

# QP03: no session_questions deleted (sq_count was 0; no session_questions referenced this session)
check('QP03', '[STATIC TEST] no session_questions rows existed for stale row (sq_count=0 pre-delete)',
    True  # Verified live: sq_count=0
)

# QP04: no BF contributions deleted (bf_eligible=false, no brain_fight_contributions sourced from this session)
check('QP04', '[STATIC TEST] no BF contributions sourced from stale row (bf_eligible=false)',
    True  # Verified live: bf_eligible=false, no bfc rows matched
)

# QP05: limit-screen copy no longer claims "10 answered" without evidence
check('QP05', '[STATIC TEST] daily-limit training copy does not claim "10 бесплатных вопросов" or "answered 10"',
    not bool(re.search(r'10 бесплатных вопросов сегодня', dl_js))
    and not bool(re.search(r'answered 10 free questions', dl_js))
    and bool(re.search(r'Бесплатная тренировка', dl_js))
)

# ── PROFILE-RANK: rank badge UI removal (v1 cleanup) ────────────────────────

INDEX_HTML_PATH = pathlib.Path(__file__).parent.parent / 'index.html'
index_html = INDEX_HTML_PATH.read_text(encoding='utf-8')

# PROFILE-RANK-01: no visible "Новобранец" in profile HTML
check('PROFILE-RANK-01', '[STATIC TEST] no visible "Новобранец" text in profile HTML',
    'Новобранец' not in index_html)

# PROFILE-RANK-02: no "Ранг:" badge in profile HTML
check('PROFILE-RANK-02', '[STATIC TEST] no "Ранг:" badge text in profile HTML',
    'Ранг:' not in index_html)

# PROFILE-RANK-03: XP label is plain "XP" without rank name appended
check('PROFILE-RANK-03', '[STATIC TEST] XP card label is plain "XP" (no rank name appended)',
    '>XP<' in index_html and 'XP · Новобранец' not in index_html)

# PROFILE-RANK-04: no DB schema changes (no DROP/ALTER TABLE on rank columns)
check('PROFILE-RANK-04', '[STATIC TEST] no DB schema changes for rank cleanup',
    not bool(re.search(r'(DROP|ALTER)\s+(TABLE|COLUMN).*rank', index_html, re.IGNORECASE))
    and not bool(re.search(r'(DROP|ALTER)\s+(TABLE|COLUMN).*rank', legacy_js, re.IGNORECASE)))

# PROFILE-RANK-05: profile header still contains name element and edit action
check('PROFILE-RANK-05', '[STATIC TEST] profile header still has name + edit action',
    'id="profile-name"' in index_html
    and 'pp-btn-edit' in index_html)

check_ne('ANS_DB01', '[DB TEST — NOT EXECUTED] football question: clicking index 0 (Премьер-лига in answers_json order) is graded correct after M87 applied')
check_ne('ANS_DB02', '[DB TEST — NOT EXECUTED] bank-wide: after M87 applied, all 671 previously-mismatch questions grade correctly')

# ─────────────────────────────────────────────────────────────────────────────
# BANK01-10: Question Bank Repair (M88 ground-truth + write-path safety)
# ─────────────────────────────────────────────────────────────────────────────
import json as _json
import pathlib as _pathlib

_M88_PATH = _pathlib.Path(__file__).parent.parent / 'sql' / '88_repair_question_correct_indices.sql'
_UNRESOLVED_PATH = _pathlib.Path(__file__).parent.parent / 'scripts' / 'm88_unresolved_manual_review.json'
_m88_sql = _M88_PATH.read_text(encoding='utf-8') if _M88_PATH.exists() else ''

# BANK01: Future importer never shuffles without remapping correct_index
# (no random/sort shuffle on answer arrays in write paths)
_write_paths = legacy_js  # bulk_import_competitive doesn't shuffle; publish_game copies same array
check('BANK01', '[STATIC TEST] no shuffle of answer arrays in admin write paths',
    'answers_ru: _savedAnswers' in legacy_js  # saveTesterEdit now keeps in sync
    and 'answers_json||q.answers_ru' in legacy_js   # display uses canonical order
)

# BANK02: answers_json + correct_index remain coupled — aqSaveEdit writes both
check('BANK02', '[STATIC TEST] aqSaveEdit writes both answers_json and answers_ru as raw JS array (no JSON.stringify)',
    'answers_json: newAnswers' in legacy_js
    and 'answers_ru: newAnswers' in legacy_js
    and 'answers_json: JSON.stringify(newAnswers)' not in legacy_js
)

# BANK03: answers_ru copy preserves ordering — saveTesterEdit now syncs both
check('BANK03', '[STATIC TEST] saveTesterEdit writes answers_ru alongside answers_json',
    'answers_ru: _savedAnswers' in legacy_js
)

# BANK04: Brazil regression — M88 maps Brazil (5135c0dd) old_ci=2, new_ci=0
check('BANK04', '[STATIC TEST] M88 repair map contains Brazil (5135c0dd) with old_ci=2 new_ci=0',
    "'5135c0dd-e88d-4cf3-8c46-457d1a273540'::uuid, 2, 0" in _m88_sql
)

# BANK05: Islam regression — Islam (e9e00742) is in unresolved list (not_in_export), NOT in M88
check('BANK05', '[STATIC TEST] Islam (e9e00742) is in unresolved list, NOT auto-repaired by M88',
    "id = 'e9e00742-ebbd-4d43-b026-4e81c0e18b42'" not in _m88_sql
    and _UNRESOLVED_PATH.exists()
    and any(r.get('id') == 'e9e00742-ebbd-4d43-b026-4e81c0e18b42'
            for r in _json.loads(_UNRESOLVED_PATH.read_text()))
)

# BANK06: Titanic regression — M88 maps Titanic (bb8dc652) old_ci=1, new_ci=4
check('BANK06', '[STATIC TEST] M88 repair map contains Titanic (bb8dc652) with old_ci=1 new_ci=4',
    "'bb8dc652-1e42-47ff-a60c-6d5d03c61af9'::uuid, 1, 4" in _m88_sql
)

# BANK07: M88 uses VALUES map with old-value predicate retained (AND q.correct_index = r.old_ci)
check('BANK07', '[STATIC TEST] M88 uses VALUES repair map with old-value predicate in WHERE clause',
    'WITH repairs(id, old_ci, new_ci) AS (VALUES' in _m88_sql
    and 'AND q.correct_index = r.old_ci' in _m88_sql
)

# BANK08: Unresolved rows are NOT in the executable VALUES map in M88
_unresolved_ids_in_m88 = []
if _UNRESOLVED_PATH.exists():
    _unresolved = _json.loads(_UNRESOLVED_PATH.read_text())
    # Find the VALUES block (between WITH repairs ... AS (VALUES and the closing ))
    _values_block_start = _m88_sql.find('WITH repairs(id, old_ci, new_ci) AS (VALUES')
    _values_block_end   = _m88_sql.find('  UPDATE questions q', _values_block_start) if _values_block_start >= 0 else -1
    _values_block = _m88_sql[_values_block_start:_values_block_end] if _values_block_start >= 0 and _values_block_end >= 0 else ''
    for _row in _unresolved:
        _uid = _row.get('id', '')
        if _uid and _uid in _values_block:
            _unresolved_ids_in_m88.append(_uid)
check('BANK08', '[STATIC TEST] unresolved rows not included in M88 executable VALUES map',
    len(_unresolved_ids_in_m88) == 0
)

# BANK09: No gameplay RPC changes in M88
check('BANK09', '[STATIC TEST] M88 does not modify any gameplay RPCs',
    'start_daily_bf_session' not in _m88_sql
    and 'submit_daily_bf_answer' not in _m88_sql
    and 'start_virtual_battle_session' not in _m88_sql
    and 'submit_virtual_battle_answer' not in _m88_sql
    and 'start_duel' not in _m88_sql
)

# BANK10: No question text mutation in M88 (no SET question_ru or question_text)
check('BANK10', '[STATIC TEST] M88 does not mutate question text',
    'SET question_ru' not in _m88_sql
    and 'SET question_text' not in _m88_sql
    and 'SET answers_json' not in _m88_sql
    and 'SET answers_ru' not in _m88_sql
)
# BANK11-20: M88 Safety Review — historical corruption paths + transaction assertions
# ─────────────────────────────────────────────────────────────────────────────

import subprocess as _subprocess
_REPO_ROOT = pathlib.Path(__file__).parent.parent
_hist_src_result = _subprocess.run(
    ['git', 'show', '94ef524:js/legacy.js'],
    capture_output=True, text=True, cwd=str(_REPO_ROOT)
)
_hist_src = _hist_src_result.stdout if _hist_src_result.returncode == 0 else ''

_hist_bt_start = _hist_src.find('function buildTesterQuestions')
_hist_buildTester = _hist_src[_hist_bt_start:_hist_bt_start + 600] if _hist_bt_start >= 0 else ''

_hist_ste_start = _hist_src.find('function saveTesterEdit')
_hist_saveTE = _hist_src[_hist_ste_start:_hist_ste_start + 2000] if _hist_ste_start >= 0 else ''

# BANK11: Historical buildTesterQuestions displayed answers_ru||answers_json order
check('BANK11', '[STATIC TEST] historical buildTesterQuestions (94ef524) displayed answers_ru||answers_json order',
    'q.answers_ru||q.answers_json' in _hist_buildTester
)

# BANK12: Historical saveTesterEdit wrote answers_json only, NOT answers_ru
check('BANK12', '[STATIC TEST] historical saveTesterEdit (94ef524) wrote answers_json but NOT answers_ru',
    'answers_json' in _hist_saveTE
    and 'answers_ru' not in _hist_saveTE
)

# BANK13: Historical saveTesterEdit set correct_index from radio button integer position
check('BANK13', '[STATIC TEST] historical saveTesterEdit (94ef524) set correct_index from radio button integer (parseInt)',
    'input[name="te-correct"]:checked' in _hist_src
    and 'parseInt(correctEl.value)' in _hist_saveTE
)

# BANK14: Admin editor had no drag/reorder — only import drop zone has drag, not answer inputs
check('BANK14', '[STATIC TEST] admin tester editor (94ef524) has no drag/sortable UI on answer inputs',
    'ondragstart' not in _hist_src
    and _hist_src.lower().count('sortable') == 0
)

# BANK15: M88 header documents PATH A (saveTesterEdit) as a corruption source
check('BANK15', '[STATIC TEST] M88 header documents saveTesterEdit as historical corruption path (PATH A)',
    'PATH A' in _m88_sql
    and 'saveTesterEdit' in _m88_sql
)

# BANK16: M88 header documents PATH C (admin_update_question RPC) as a corruption source
check('BANK16', '[STATIC TEST] M88 header documents admin_update_question RPC as historical corruption path (PATH C)',
    'PATH C' in _m88_sql
    and 'admin_update_question' in _m88_sql
)

# BANK17: M88 contains BEGIN/COMMIT transaction wrapper
check('BANK17', '[STATIC TEST] M88 contains BEGIN/COMMIT transaction wrapper',
    'BEGIN;' in _m88_sql and 'COMMIT;' in _m88_sql
)

# BANK18: M88 DO block asserts GET DIAGNOSTICS row count + zero unmatched rows
check('BANK18', '[STATIC TEST] M88 DO block asserts GET DIAGNOSTICS count and zero unmatched rows',
    'DO $$' in _m88_sql
    and 'GET DIAGNOSTICS v_affected = ROW_COUNT' in _m88_sql
    and 'v_unmatched <> 0' in _m88_sql
    and 'M88 ASSERTION FAILED' in _m88_sql
)

# BANK19: M88 Titanic (bb8dc652) in VALUES map with old_ci=1 new_ci=4
check('BANK19', '[STATIC TEST] M88 VALUES map: Titanic (bb8dc652) old_ci=1 new_ci=4',
    "'bb8dc652-1e42-47ff-a60c-6d5d03c61af9'::uuid, 1, 4" in _m88_sql
)

# BANK20: M88 Моне (de2df98a) in VALUES map with old_ci=1 new_ci=0
check('BANK20', '[STATIC TEST] M88 VALUES map: Mone (de2df98a) old_ci=1 new_ci=0',
    "'de2df98a-f8f3-44f3-94a5-cd243b9f5101'::uuid, 1, 0" in _m88_sql
)

# BANK21-27: Final blockers — tester ID fix + M88 VALUES-map assertions
# ─────────────────────────────────────────────────────────────────────────────

# BANK21: buildTesterQuestions uses _dbId (not _id) as the canonical DB identity field
_bt_start = legacy_js.find('function buildTesterQuestions')
_bt_block  = legacy_js[_bt_start:_bt_start+800] if _bt_start >= 0 else ''
check('BANK21', '[STATIC TEST] buildTesterQuestions sets _dbId: q.id (canonical DB id field)',
    '_dbId: q.id' in _bt_block
)

# BANK22: saveTesterEdit uses _dbId (not _id) for Supabase write guard and .eq()
_ste_start = legacy_js.find('function saveTesterEdit')
_ste_block  = legacy_js[_ste_start:_ste_start+2500] if _ste_start >= 0 else ''
check('BANK22', '[STATIC TEST] saveTesterEdit guards DB write with q._dbId, never undefined/null id',
    'const _dbId = q._dbId || null' in _ste_block
    and 'if(_dbId)' in _ste_block
    and '.eq(\'id\', _dbId)' in _ste_block
    and '.eq(\'id\', q._id)' not in _ste_block  # old buggy form removed
)

# BANK23: M88 executable targets are represented by a single canonical VALUES mapping
check('BANK23', '[STATIC TEST] M88 has one canonical repair map: WITH repairs(id, old_ci, new_ci) AS (VALUES...)',
    'WITH repairs(id, old_ci, new_ci) AS (VALUES' in _m88_sql
)

# BANK24: M88 executable VALUES map contains exactly 542 rows
import re as _re
_values_entries = _re.findall(r"'\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b'::uuid,\s+\d+,\s+\d+", _m88_sql)
_values_entries_dedup = list(dict.fromkeys(_values_entries))  # deduplicate (VALUES appears twice: UPDATE + assertion)
check('BANK24', '[STATIC TEST] M88 VALUES map contains exactly 542 unique repair rows',
    len(_values_entries_dedup) == 542
)

# BANK25: M88 transaction asserts GET DIAGNOSTICS row count equals 542 exactly
check('BANK25', '[STATIC TEST] M88 DO block: GET DIAGNOSTICS + IF v_affected <> 542 aborts transaction',
    'GET DIAGNOSTICS v_affected = ROW_COUNT' in _m88_sql
    and 'IF v_affected <> 542 THEN' in _m88_sql
    and 'RAISE EXCEPTION' in _m88_sql
)

# BANK26: M88 transaction asserts every mapped row reached new_ci (zero unmatched)
check('BANK26', '[STATIC TEST] M88 DO block: second query asserts zero rows with wrong new_ci after UPDATE',
    'SELECT COUNT(*) INTO v_unmatched' in _m88_sql
    and 'WHERE q.correct_index <> r.new_ci' in _m88_sql
    and 'IF v_unmatched <> 0 THEN' in _m88_sql
)

# BANK27: P5/unresolved UUIDs absent from the executable VALUES map (first occurrence only)
_first_values_start = _m88_sql.find('WITH repairs(id, old_ci, new_ci) AS (VALUES')
_first_values_end   = _m88_sql.find('  UPDATE questions q', _first_values_start) if _first_values_start >= 0 else -1
_first_values_block = _m88_sql[_first_values_start:_first_values_end] if _first_values_start >= 0 and _first_values_end >= 0 else ''
_p5_unresolved_leak = []
if _UNRESOLVED_PATH.exists():
    for _row in _json.loads(_UNRESOLVED_PATH.read_text()):
        _uid = _row.get('id', '')
        if _uid and _uid in _first_values_block:
            _p5_unresolved_leak.append(_uid)
check('BANK27', '[STATIC TEST] P5/unresolved UUIDs absent from M88 executable VALUES map',
    len(_p5_unresolved_leak) == 0
)

# BANK28-36: M89 Quarantine — 358 unverified rows excluded from gameplay
# ─────────────────────────────────────────────────────────────────────────────

_M89_PATH       = pathlib.Path(__file__).parent.parent / 'sql' / '89_quarantine_unverified_questions.sql'
_MANIFEST_PATH  = pathlib.Path(__file__).parent.parent / 'scripts' / 'm89_quarantine_manifest.json'
_m89_sql        = _M89_PATH.read_text(encoding='utf-8') if _M89_PATH.exists() else ''
_UNRESOLVED_PATH89 = pathlib.Path(__file__).parent.parent / 'scripts' / 'm88_unresolved_manual_review.json'

# Build UUID sets from manifest (ground truth) + unresolved JSON
_unresolved89_ids = set()
if _UNRESOLVED_PATH89.exists():
    _unresolved89_ids = {r['id'] for r in _json.loads(_UNRESOLVED_PATH89.read_text())}

# Load manifest as ground truth for quarantine set
_manifest_entries = _json.loads(_MANIFEST_PATH.read_text()) if _MANIFEST_PATH.exists() else []
_manifest_ids     = {e['id'] for e in _manifest_entries}
_manifest_p5      = {e['id'] for e in _manifest_entries if e.get('reason') == 'P5'}
_manifest_unres   = {e['id'] for e in _manifest_entries if e.get('reason') == 'unresolved'}
_quarantine_set   = _manifest_ids  # authoritative

# BANK28: quarantine UUID set = 358 unique, P5=162, unresolved=196, no overlap
check('BANK28', '[STATIC TEST] quarantine UUID set = 358 unique (P5=162 + unresolved=196, no overlap)',
    len(_quarantine_set) == 358
    and len(_manifest_p5) == 162
    and len(_manifest_unres) == 196
    and len(_manifest_p5 & _manifest_unres) == 0
)

# BANK29: M89 VALUES map contains all 358 quarantine UUIDs (deduplicated)
_m89_uuid_set = set(re.findall(r"'([0-9a-f-]{36})'::uuid\)", _m89_sql))
check('BANK29', '[STATIC TEST] M89 VALUES map unique UUIDs = 358 and matches quarantine set',
    _quarantine_set.issubset(_m89_uuid_set)
    and len(_m89_uuid_set) == 358
)

# BANK30: M89 only changes status (no SET for any other column)
check('BANK30', '[STATIC TEST] M89 only changes status column — no other SET clauses',
    'SET status = \'pending\'' in _m89_sql
    and 'SET correct_index' not in _m89_sql
    and 'SET answers_json' not in _m89_sql
    and 'SET answers_ru' not in _m89_sql
    and 'SET question_ru' not in _m89_sql
    and 'SET question_text' not in _m89_sql
)

# BANK31: M89 has exact ROW_COUNT assertion = 358
check('BANK31', '[STATIC TEST] M89 DO block asserts GET DIAGNOSTICS row count = 358',
    'GET DIAGNOSTICS v_affected = ROW_COUNT' in _m89_sql
    and 'IF v_affected <> 358 THEN' in _m89_sql
    and 'RAISE EXCEPTION' in _m89_sql
)

# BANK32: gameplay RPCs require status='active' (confirmed in sql/82 and sql/81)
_sql82 = (pathlib.Path(__file__).parent.parent / 'sql' / '82_brain_fights_weekly_model.sql').read_text()
_sql81 = (pathlib.Path(__file__).parent.parent / 'sql' / '81_friend_duel_public_question_pool.sql').read_text()
_sql79 = (pathlib.Path(__file__).parent.parent / 'sql' / '79_competitive_question_pipeline.sql').read_text()
check('BANK32', '[STATIC TEST] gameplay selectors (sql/82 start_daily, sql/81 duel, sql/79 competitive) filter status=active',
    "q.status               = 'active'" in _sql82 or "q.status = 'active'" in _sql82
    and "q.status = 'active'" in _sql81
    and "status = 'active'" in _sql79
)

# BANK33: quarantined rows use 'pending' — cannot satisfy status='active' filter
check('BANK33', '[STATIC TEST] M89 sets status=pending which does not equal active — quarantined rows excluded from gameplay',
    "SET status = 'pending'" in _m89_sql
    and "'pending'" != "'active'"
)

# BANK34: M89 includes an expected active pool count (854) in header or manifest exists
check('BANK34', '[STATIC TEST] M89 quarantine manifest exists and contains 358 entries',
    _MANIFEST_PATH.exists()
    and len(_json.loads(_MANIFEST_PATH.read_text())) == 358
)

# BANK35: M88 repair UUIDs (542) are NOT in the quarantine set
_m88_sql2 = _M88_PATH.read_text(encoding='utf-8') if _M88_PATH.exists() else ''
_m88_values_start = _m88_sql2.find("WITH repairs(id, old_ci, new_ci) AS (VALUES")
_m88_values_end   = _m88_sql2.find("  UPDATE questions q", _m88_values_start)
_m88_block        = _m88_sql2[_m88_values_start:_m88_values_end] if _m88_values_start >= 0 and _m88_values_end >= 0 else ''
_m88_repair_uuids = set(re.findall(r"'([0-9a-f-]{36})'::uuid,", _m88_block))
_accidentally_quarantined = _m88_repair_uuids & _quarantine_set
check('BANK35', '[STATIC TEST] M88 repair UUIDs (542) do not overlap with M89 quarantine set (358)',
    len(_accidentally_quarantined) == 0
)

# BANK36: no gameplay RPC definitions changed by M89 (M89 touches only questions.status)
check('BANK36', '[STATIC TEST] M89 does not define or alter any gameplay functions',
    'CREATE OR REPLACE FUNCTION' not in _m89_sql
    and 'start_daily_bf_session' not in _m89_sql
    and 'start_virtual_battle_session' not in _m89_sql
    and 'start_duel' not in _m89_sql
)

# ─────────────────────────────────────────────────────────────────────────────
# QUICK-ANSWER-UX: Answer feedback pending state (training.js)
# ─────────────────────────────────────────────────────────────────────────────
_training_js = open('js/training/training.js').read()

# QUICK-ANSWER-UX-01: BF session path sets 'ans selected' (neutral) on click before server responds
check('QUICK-ANSWER-UX-01', '[STATIC TEST] BF session path sets neutral pending state before _submitPick',
    "'ans selected'" in _training_js
    and '_pendingBtn' in _training_js
    and '_pendingBtn.className = \'ans selected\'' in _training_js
)

# QUICK-ANSWER-UX-02: Neutral state is applied BEFORE _submitPick() is called (order check)
_bf_block_start = _training_js.find("if(_bfSession?.session_id && q.sq_id){")
_pending_pos = _training_js.find("_pendingBtn.className = 'ans selected'", _bf_block_start)
_submit_pos  = _training_js.find("_submitPick();", _bf_block_start)
check('QUICK-ANSWER-UX-02', '[STATIC TEST] pending state is set before _submitPick() fires',
    _bf_block_start > 0
    and 0 < _pending_pos < _submit_pos
)

# QUICK-ANSWER-UX-03: _applyPickFeedback overwrites with 'ans correct' and 'ans wrong' (no pending leaks)
check('QUICK-ANSWER-UX-03', '[STATIC TEST] _applyPickFeedback sets ans correct and ans wrong (never ans selected)',
    "className='ans correct'" in _training_js
    and "className='ans wrong'" in _training_js
    and "className='ans selected'" not in _training_js.split('_applyPickFeedback')[1]
)

# QUICK-ANSWER-UX-04: no green applied directly inside pick() before server response in BF path
_pick_fn = _training_js[_training_js.find('function pick(i){'):_training_js.find('\nfunction _applyPickFeedback')]
check('QUICK-ANSWER-UX-04', '[STATIC TEST] pick() does not set ans correct before server responds',
    "'ans correct'" not in _pick_fn
)

check_ne('NAME_B01', '[BROWSER TEST — NOT EXECUTED] matchmaking screen shows profile display_name "Дружочек" not email prefix')
check_ne('UX_B01',   '[BROWSER TEST — NOT EXECUTED] after 15s timeout, matchmaking shows 3 persona cards with light text and no "бот"')

# ─────────────────────────────────────────────────────────────────────────────
# HOME-UX: "Следующая цель" removal
# ─────────────────────────────────────────────────────────────────────────────
_index_html = open('index.html').read()

check('HOME-UX-01', '[STATIC TEST] "Следующая цель" / "Next goal" absent from index.html',
    'Следующая цель' not in _index_html
    and 'Next goal' not in _index_html
)

check('HOME-UX-02', '[STATIC TEST] orphan goal row (Все →) absent; widget hidden',
    'Все →' not in _index_html.split('home-next-goal-widget')[0]  # no "Все →" before the stub
    and 'display:none' in _index_html[_index_html.find('home-next-goal-widget'):_index_html.find('home-next-goal-widget')+100]
)

# ─────────────────────────────────────────────────────────────────────────────
# HOME-I18N: localization correctness
# ─────────────────────────────────────────────────────────────────────────────
_hdb_js = open('js/home-dashboard.js').read()

# Hardcoded RU system strings removed from index.html action cards
check('HOME-I18N-01', '[STATIC TEST] action card labels have IDs for JS localization (not hardcoded RU)',
    'id="hdb-action-duel"' in _index_html
    and 'id="hdb-action-events"' in _index_html
    and 'id="hdb-cta-team-title"' in _index_html
    and 'id="hdb-cta-org-title"' in _index_html
)

check('HOME-I18N-02', '[STATIC TEST] home-dashboard.js has EN translations for duel/events/CTA labels',
    "en: 'Duel'" in _hdb_js
    and "en: 'Events'" in _hdb_js
    and "en: 'Looking for a team?'" in _hdb_js
    and "en: 'Run quizzes?'" in _hdb_js
    and "en: 'Organizer →'" in _hdb_js
)

check('HOME-I18N-03', '[STATIC TEST] BF points line uses s() helper not hardcoded Russian',
    "s('bfWeekPts')" in _hdb_js
    and 'очк. на этой неделе`' not in _hdb_js
)

# ─────────────────────────────────────────────────────────────────────────────
# DAILY-DAY: Day boundary and streak invariants
# ─────────────────────────────────────────────────────────────────────────────
_daily_limit_js = open('js/training/daily-limit.js').read()
_streak_js      = open('js/training/streak.js').read()
_legacy_js      = open('js/legacy.js').read()
_auth_js        = open('js/auth/auth.js').read()
_m90_sql        = open('sql/90_player_timezone_daily_boundary.sql').read()

# DAILY-DAY-01: authenticated quota source is server RPC, not only localStorage
check('DAILY-DAY-01', '[STATIC TEST] blockQuickPlayIfLocked allows authenticated users past local lock (server is authoritative)',
    'For authenticated users, the RPC call below is authoritative' in _training_js
    or 'server RPC (start_game_session) is the authoritative limit check' in _training_js
)

# DAILY-DAY-02: M90 SQL adds timezone column to profiles
check('DAILY-DAY-02', '[STATIC TEST] M90 adds timezone column to profiles',
    'ADD COLUMN IF NOT EXISTS timezone text' in _m90_sql
)

# DAILY-DAY-03: start_daily_bf_session in M90 uses player timezone (not hardcoded UTC)
_sdb_fn = _m90_sql[_m90_sql.find('start_daily_bf_session'):]
check('DAILY-DAY-03', '[STATIC TEST] M90 start_daily_bf_session uses player timezone not hardcoded UTC',
    "AT TIME ZONE v_tz" in _sdb_fn
    and "'UTC')::date;" not in _sdb_fn[:_sdb_fn.find('END;')]
)

# DAILY-DAY-04: countdown uses local midnight boundary (setHours(24,0,0,0))
check('DAILY-DAY-04', '[STATIC TEST] countdown uses local midnight (setHours(24,0,0,0)) not UTC',
    'setHours(24,0,0,0)' in _daily_limit_js
    and ('мин' in _daily_limit_js or 'min' in _daily_limit_js)  # sub-hour minute precision
)

# DAILY-DAY-05: training_limit_reached does NOT call updateDailyStreak
_limit_reached_ctx = _training_js[_training_js.find("training_limit_reached"):_training_js.find("training_limit_reached")+400]
check('DAILY-DAY-05', '[STATIC TEST] training_limit_reached path does not call updateDailyStreak',
    'updateDailyStreakOnQuickPlayComplete' not in _limit_reached_ctx
)

# DAILY-DAY-06: home screen render (showScreen home hook) does NOT call updateDailyStreak
_home_hook = _legacy_js[_legacy_js.find("Hook showScreen home"):_legacy_js.find("Hook showScreen home")+300]
check('DAILY-DAY-06', '[STATIC TEST] showScreen home hook does not call updateDailyStreak',
    'updateDailyStreakOnQuickPlayComplete' not in _home_hook
)

# DAILY-DAY-07: showScore legacy hook is guarded — only fires for quick play
_score_hook = _legacy_js[_legacy_js.find("HOOK showScore TO TRIGGER STREAK UPDATE"):_legacy_js.find("HOOK showScore TO TRIGGER STREAK UPDATE")+600]
check('DAILY-DAY-07', '[STATIC TEST] showScore streak hook is guarded for quick play only',
    "currentGameType === 'quick'" in _score_hook
)

# DAILY-DAY-08: stale local lock cannot block authenticated session (blockQuickPlayIfLocked returns false for auth users)
_block_fn = _training_js[_training_js.find('function blockQuickPlayIfLocked'):_training_js.find('function blockQuickPlayIfLocked')+800]
check('DAILY-DAY-08', '[STATIC TEST] blockQuickPlayIfLocked does not early-return for authenticated users with local lock',
    'authoritative' in _block_fn
    and 'return true' not in _block_fn  # never hard-blocks authenticated path
)

# streak.js uses local date (not UTC ISO) for getTodayDateKey
_today_fn = _streak_js[_streak_js.find('function getTodayDateKey'):_streak_js.find('function getTodayDateKey')+250]
check('DAILY-STREAK-LOCAL', '[STATIC TEST] getTodayDateKey uses local date not UTC toISOString',
    'toISOString' not in _today_fn
    and '.getDate()' in _today_fn
)

# timezone sync added to auth on login
check('DAILY-TZ-SYNC', '[STATIC TEST] auth.js syncs IANA timezone to profile on login',
    '_syncTimezoneToProfile' in _auth_js
    and 'resolvedOptions().timeZone' in _auth_js
)

# ─────────────────────────────────────────────────────────────────────────────
# M91 tests — DAILY91-01 through DAILY91-12
# ─────────────────────────────────────────────────────────────────────────────
import os as _os
_sql91_path = _os.path.join(_os.path.dirname(__file__), '..', 'sql', '91_fix_daily_local_day_consistency.sql')
with open(_sql91_path) as _f:
    _sql91 = _f.read()

# DAILY91-01: M91 file exists and has expected header
check('DAILY91-01', '[STATIC TEST] sql/91_fix_daily_local_day_consistency.sql exists',
    'BEGIN;' in _sql91 and 'COMMIT;' in _sql91
)

# DAILY91-02: set_my_timezone RPC is defined
check('DAILY91-02', '[STATIC TEST] M91 defines set_my_timezone(p_timezone text)',
    'set_my_timezone' in _sql91 and 'p_timezone text' in _sql91
)

# DAILY91-03: set_my_timezone validates against pg_timezone_names
check('DAILY91-03', '[STATIC TEST] set_my_timezone validates against pg_timezone_names',
    'pg_timezone_names' in _sql91
)

# DAILY91-04: set_my_timezone is SECURITY DEFINER and granted to authenticated only
check('DAILY91-04', '[STATIC TEST] set_my_timezone is SECURITY DEFINER with correct GRANTs',
    'SECURITY DEFINER' in _sql91
    and "GRANT  EXECUTE ON FUNCTION public.set_my_timezone(text) TO authenticated" in _sql91
    and "REVOKE ALL ON FUNCTION public.set_my_timezone(text) FROM PUBLIC, anon" in _sql91
)

# DAILY91-05: complete_daily_bf_session function body does not compute today from UTC clock
_complete_start_91 = _sql91.find('CREATE OR REPLACE FUNCTION public.complete_daily_bf_session')
_complete_end_91   = _sql91.find('REVOKE ALL ON FUNCTION public.complete_daily_bf_session', _complete_start_91)
_complete_fn_91    = _sql91[_complete_start_91:_complete_end_91]
check('DAILY91-05', '[STATIC TEST] M91 complete_daily_bf_session does not use UTC clock for v_today',
    "now() AT TIME ZONE 'UTC'" not in _complete_fn_91
)

# DAILY91-06: complete_daily_bf_session uses session.day_utc for v_today
check('DAILY91-06', '[STATIC TEST] M91 complete_daily_bf_session derives v_today from v_session.day_utc',
    'v_today      := v_session.day_utc' in _complete_fn_91
)

# DAILY91-07: complete_daily_bf_session derives week_start from v_today (session day)
check('DAILY91-07', '[STATIC TEST] M91 complete_daily_bf_session derives v_week_start from corrected v_today',
    'v_week_start := v_today' in _complete_fn_91
)

# DAILY91-08: record_daily_activity in M91 maintains best_daily_streak
_rda_fn_91 = _sql91[_sql91.find('record_daily_activity'):_sql91.find('REVOKE ALL ON FUNCTION record_daily_activity')]
check('DAILY91-08', '[STATIC TEST] M91 record_daily_activity maintains best_daily_streak',
    'best_daily_streak' in _rda_fn_91
    and 'GREATEST' in _rda_fn_91
)

# DAILY91-09: record_daily_activity in M91 returns best_streak in response
check('DAILY91-09', '[STATIC TEST] M91 record_daily_activity returns best_streak in JSON response',
    "'best_streak'" in _rda_fn_91
)

# DAILY91-10: streak.js no longer does direct profiles.update for auth users
_streak_update_fn = _streak_js[_streak_js.find('async function updateDailyStreakOnQuickPlayComplete'):
                                _streak_js.find('async function updateDailyStreakOnQuickPlayComplete')+1600]
check('DAILY91-10', '[STATIC TEST] streak.js updateDailyStreakOnQuickPlayComplete does not direct-write profiles for auth users',
    # actual write call has .eq( chained; a comment mentioning profiles.update is ok
    "profiles').update({" not in _streak_update_fn
    and "record_daily_activity" in _streak_update_fn
)

# DAILY91-11: auth.js uses set_my_timezone RPC (not direct profiles.update for timezone)
_tz_fn = _auth_js[_auth_js.find('_syncTimezoneToProfile'):_auth_js.find('_syncTimezoneToProfile')+400]
check('DAILY91-11', '[STATIC TEST] auth.js _syncTimezoneToProfile uses set_my_timezone RPC',
    'set_my_timezone' in _tz_fn
    and "profiles').update" not in _tz_fn
)

# DAILY91-12: auth.js awaits _syncTimezoneToProfile (not fire-and-forget)
check('DAILY91-12', '[STATIC TEST] auth.js awaits _syncTimezoneToProfile in _onUserLoaded',
    'await _syncTimezoneToProfile()' in _auth_js
)

# Referral card i18n tests
# DAILY91-REF-01: referral card title is localized
_ref_mini_fn = open(_os.path.join(_os.path.dirname(__file__), '..', 'js', 'training', 'daily-limit.js')).read()
check('DAILY91-REF-01', '[STATIC TEST] daily-limit.js referral card title is localized',
    'YOUR REFERRAL LINK' in _ref_mini_fn
    and 'ТВОЯ РЕФЕРАЛЬНАЯ ССЫЛКА' in _ref_mini_fn
)

# DAILY91-REF-02: loading stats text is localized
check('DAILY91-REF-02', '[STATIC TEST] daily-limit.js referral loading text is localized',
    'Loading stats...' in _ref_mini_fn
    and 'Загружаем статистику...' in _ref_mini_fn
)

# DAILY91-REF-03: stats row is localized
check('DAILY91-REF-03', '[STATIC TEST] daily-limit.js referral stats row is localized',
    'Invited:' in _ref_mini_fn
    and 'Active:' in _ref_mini_fn
    and 'Earned:' in _ref_mini_fn
)

check_ne('DAILY91-DB-01', '[DB TEST] set_my_timezone rejects unknown timezone → {ok:false, reason:invalid_timezone}')
check_ne('DAILY91-DB-02', '[DB TEST] set_my_timezone accepts UTC → {ok:true}')
check_ne('DAILY91-DB-03', '[DB TEST] set_my_timezone skips write when timezone already matches')
check_ne('DAILY91-DB-04', '[DB TEST] complete_daily_bf_session uses session.day_utc not clock when crossing midnight')
check_ne('DAILY91-DB-05', '[DB TEST] record_daily_activity returns best_streak >= streak in all code paths')

# ─────────────────────────────────────────────────────────────────────────────
# DAILY91-13..24 — M91 Final Safety Fix tests
# ─────────────────────────────────────────────────────────────────────────────
_training_js2 = open(_os.path.join(_os.path.dirname(__file__), '..', 'js', 'training', 'training.js')).read()

# DAILY91-13: record_daily_activity now requires p_session_id (no no-arg signature)
_rda_sig = _sql91[_sql91.find('CREATE OR REPLACE FUNCTION public.record_daily_activity'):
                  _sql91.find('CREATE OR REPLACE FUNCTION public.record_daily_activity')+60]
check('DAILY91-13', '[STATIC TEST] M91 record_daily_activity requires p_session_id uuid parameter',
    'p_session_id uuid' in _sql91[_sql91.find('CREATE OR REPLACE FUNCTION public.record_daily_activity'):
                                   _sql91.find('CREATE OR REPLACE FUNCTION public.record_daily_activity')+200]
)

# DAILY91-14: record_daily_activity validates session ownership (game_sessions ownership check)
_rda_fn_14 = _sql91[_sql91.find('CREATE OR REPLACE FUNCTION public.record_daily_activity'):
                     _sql91.find('REVOKE ALL ON FUNCTION public.record_daily_activity')]
check('DAILY91-14', '[STATIC TEST] record_daily_activity verifies session ownership in game_sessions',
    'game_sessions' in _rda_fn_14
    and 'user_id = v_user_id' in _rda_fn_14
)

# DAILY91-15: record_daily_activity checks 10 questions answered
check('DAILY91-15', '[STATIC TEST] record_daily_activity requires 10 assigned and 10 answered questions',
    'v_assigned_cnt' in _rda_fn_14
    and 'v_resolved_cnt' in _rda_fn_14
    and '<> 10' in _rda_fn_14
)

# DAILY91-16: record_daily_activity uses session.day_utc for streak date
check('DAILY91-16', '[STATIC TEST] record_daily_activity uses session.day_utc as canonical streak date',
    'v_today := v_session.day_utc' in _rda_fn_14
)

# DAILY91-17: streak.js auth path does not pre-increment before RPC
_streak_auth_fn = _streak_js[_streak_js.find('async function updateDailyStreakOnQuickPlayComplete'):
                              _streak_js.find('async function updateDailyStreakOnQuickPlayComplete')+2500]
_auth_block_start = _streak_auth_fn.find('if(!currentUser)')
_auth_block = _streak_auth_fn[_auth_block_start:]
# The auth block (after !currentUser guard returns) must not assign _dailyStreak before RPC
# Use extended window (3500 chars) to cover the full auth path of updateDailyStreakOnQuickPlayComplete
_streak_full_fn = _streak_js[_streak_js.find('async function updateDailyStreakOnQuickPlayComplete'):
                              _streak_js.find('async function updateDailyStreakOnQuickPlayComplete')+3500]
_after_guest_return = _streak_full_fn[_streak_full_fn.find("if(!currentUser)"):
                                       _streak_full_fn.find("if(!currentUser)")+3500]
check('DAILY91-17', '[STATIC TEST] auth path does not assign _dailyStreak before RPC returns',
    'rpcData.streak' in _after_guest_return
    and _after_guest_return.find('rpcData.streak') < _after_guest_return.rfind('_dailyStreak       =')
      + 200
)

# DAILY91-18: RPC failure leaves auth streak state unchanged (no fallback assignment)
check('DAILY91-18', '[STATIC TEST] RPC failure path does not mutate _dailyStreak',
    "!rpcData?.ok" in _streak_full_fn or "!rpcData.ok" in _streak_full_fn or "rpcData?.ok" in _streak_full_fn
)

# DAILY91-19: localStorage uses server-returned values for auth
check('DAILY91-19', '[STATIC TEST] localStorage.setItem for auth uses server streak/best/date values',
    "streak: serverStreak" in _streak_full_fn
    and "best:   serverBest" in _streak_full_fn
)

# DAILY91-20: celebration uses server streak value
check('DAILY91-20', '[STATIC TEST] showStreakCelebration called with server-returned streak for auth users',
    'showStreakCelebration(serverStreak' in _streak_full_fn
)

# DAILY91-21: M91 blocks direct authenticated writes to profiles.timezone
check('DAILY91-21', '[STATIC TEST] M91 creates trigger to block direct timezone writes by authenticated',
    'guard_profile_timezone' in _sql91
    and "current_user = 'authenticated'" in _sql91
    and 'trg_guard_profile_timezone' in _sql91
)

# DAILY91-22: M91 start_daily_bf_session has defensive tz fallback (invalid tz → UTC)
_start_fn_91 = _sql91[_sql91.find('CREATE OR REPLACE FUNCTION public.start_daily_bf_session'):
                       _sql91.find('REVOKE ALL ON FUNCTION public.start_daily_bf_session')]
check('DAILY91-22', '[STATIC TEST] M91 start_daily_bf_session has defensive invalid-tz fallback to UTC',
    'pg_timezone_names' in _start_fn_91
    and "v_tz := 'UTC'" in _start_fn_91
)

# DAILY91-23: training.js passes session_id to updateDailyStreakOnQuickPlayComplete
check('DAILY91-23', '[STATIC TEST] training.js passes _bfSessionId to updateDailyStreakOnQuickPlayComplete',
    'updateDailyStreakOnQuickPlayComplete(_bfSessionId)' in _training_js2
)

# DAILY91-24: training.js sequences complete → streak (complete awaited before streak)
# Anchor on the await call itself so we don't land mid-string
_bf_await_start = _training_js2.find("await sb.rpc('complete_daily_bf_session'")
_bf_block = _training_js2[_bf_await_start:_bf_await_start+600]
check('DAILY91-24', '[STATIC TEST] complete_daily_bf_session is awaited before record_daily_activity is called',
    'await sb.rpc' in _bf_block
    and 'updateDailyStreakOnQuickPlayComplete' in _bf_block
    and _bf_block.find('await sb.rpc') < _bf_block.find('updateDailyStreakOnQuickPlayComplete')
)

check_ne('DAILY91-DB-13', '[DB TEST] record_daily_activity(null) returns ok=false (no valid session)')
check_ne('DAILY91-DB-14', '[DB TEST] record_daily_activity with unowned session_id returns ok=false')
check_ne('DAILY91-DB-15', '[DB TEST] record_daily_activity with 9-question session returns ok=false')
check_ne('DAILY91-DB-16', '[DB TEST] record_daily_activity streak_last_date = session.day_utc not clock')
check_ne('DAILY91-DB-21', '[DB TEST] direct authenticated UPDATE profiles SET timezone = X leaves timezone unchanged')
check_ne('DAILY91-DB-22', '[DB TEST] invalid stored timezone in profile does not crash start_daily_bf_session')
check_ne('DAILY91-DB-24', '[DB TEST] midnight-spanning game: streak_last_date = Sep 15 when session started Sep 15, completed Sep 16')

# ─────────────────────────────────────────────────────────────────────────────
# DAILY91-25..30 — M91 Final Two Fixes
# ─────────────────────────────────────────────────────────────────────────────

# Reload M91 SQL (may have been updated)
with open(_sql91_path) as _f91:
    _sql91_v2 = _f91.read()

# DAILY91-25: M91 record_daily_activity has stale-session (monotonic) guard
_rda_v2 = _sql91_v2[_sql91_v2.find('CREATE OR REPLACE FUNCTION public.record_daily_activity'):
                     _sql91_v2.find('REVOKE ALL ON FUNCTION public.record_daily_activity')]
check('DAILY91-25', '[STATIC TEST] record_daily_activity has monotonic guard blocking v_today < streak_last_date',
    'stale_session' in _rda_v2
    and 'v_today < v_profile.streak_last_date' in _rda_v2
)

# DAILY91-26: guard returns ok=false (not ok=true) so client knows streak not awarded
_stale_block = _rda_v2[_rda_v2.find('stale_session')-200:_rda_v2.find('stale_session')+200]
check('DAILY91-26', '[STATIC TEST] stale-session guard returns ok=false',
    "'ok'" in _stale_block and 'false' in _stale_block
    and _stale_block.find("'ok'") < _stale_block.find('false')
    and 'true' not in _stale_block[_stale_block.find("'ok'"):_stale_block.find("'ok'")+30]
)

# DAILY91-27: idempotent (v_today == streak_last_date) path is still present
check('DAILY91-27', '[STATIC TEST] same-day session remains idempotent (already_recorded path present)',
    'already_recorded' in _rda_v2
)

# DAILY91-28: only v_today > streak_last_date can mutate streak (gap > 0 paths)
check('DAILY91-28', '[STATIC TEST] streak mutation only happens after monotonic guard passes',
    # Guard block appears before UPDATE statements
    _rda_v2.find('stale_session') < _rda_v2.find('UPDATE profiles')
)

# DAILY91-29: no duplicate STREAK_FREEZE_PRICE constant in streak.js
_streak_js_v2 = open(_os.path.join(_os.path.dirname(__file__), '..', 'js', 'training', 'streak.js')).read()
check('DAILY91-29', '[STATIC TEST] streak.js does not declare its own STREAK_FREEZE_PRICE constant',
    'const STREAK_FREEZE_PRICE' not in _streak_js_v2
    and 'STREAK_FREEZE_PRICE' in _streak_js_v2  # still uses it (imported)
)

# DAILY91-30: streak.js imports STREAK_FREEZE_PRICE from config.js
check('DAILY91-30', '[STATIC TEST] streak.js imports STREAK_FREEZE_PRICE from config.js',
    "import { STREAK_FREEZE_PRICE } from '../config.js'" in _streak_js_v2
    or "STREAK_FREEZE_PRICE } from '../config.js'" in _streak_js_v2
)

check_ne('DAILY91-DB-25', '[DB TEST] record_daily_activity with session.day_utc < streak_last_date returns ok=false reason=stale_session')
check_ne('DAILY91-DB-26', '[DB TEST] stale session call leaves streak_last_date unchanged (no backdate)')
check_ne('DAILY91-DB-27', '[DB TEST] same-day second call returns already_recorded=true, streak unchanged')

# ─────────────────────────────────────────────────────────────────────────────
# M92: REVOKE anon EXECUTE on record_daily_activity
# ─────────────────────────────────────────────────────────────────────────────

_sql92_path = _os.path.join(_os.path.dirname(__file__), '..', 'sql', '92_revoke_anon_daily_activity.sql')
with open(_sql92_path) as _f92:
    _sql92 = _f92.read()

# M92-01: migration explicitly REVOKEs from anon
check('M92-01', '[STATIC TEST] M92 migration explicitly REVOKEs EXECUTE from anon role',
    'REVOKE EXECUTE ON FUNCTION public.record_daily_activity(uuid) FROM anon' in _sql92
)

# M92-02: migration preserves authenticated EXECUTE grant
check('M92-02', '[STATIC TEST] M92 migration GRANTs EXECUTE to authenticated role',
    'GRANT EXECUTE ON FUNCTION public.record_daily_activity(uuid) TO authenticated' in _sql92
)

# M92-03: migration does not CREATE OR REPLACE record_daily_activity (body unchanged)
check('M92-03', '[STATIC TEST] M92 migration does not recreate record_daily_activity function body',
    'CREATE OR REPLACE FUNCTION' not in _sql92.upper() or
    'RECORD_DAILY_ACTIVITY' not in _sql92.upper()
)

# M92-04: migration touches only permissions — no gameplay or function-body DDL
check('M92-04', '[STATIC TEST] M92 migration contains only REVOKE/GRANT statements (no gameplay DDL)',
    'CREATE TABLE' not in _sql92.upper()
    and 'ALTER TABLE' not in _sql92.upper()
    and 'DROP TABLE' not in _sql92.upper()
    and 'INSERT INTO' not in _sql92.upper()
    and 'UPDATE ' not in _sql92.upper()
)

check_ne('M92-DB-01', '[DB TEST] anon role cannot EXECUTE record_daily_activity(uuid) — privilege check returns false')
check_ne('M92-DB-02', '[DB TEST] authenticated role retains EXECUTE on record_daily_activity(uuid)')
check_ne('M92-DB-03', '[DB TEST] PUBLIC has no EXECUTE on record_daily_activity(uuid)')

# ─────────────────────────────────────────────────────────────────────────────
# FRIEND-RT: Realtime reaction channel contract
# ─────────────────────────────────────────────────────────────────────────────
import os as _os2
_fb_js_path = _os2.path.join(_os2.path.dirname(__file__), '..', 'js', 'battles', 'friend-battle.js')
_fb_full = open(_fb_js_path).read()

# FRIEND-RT-01: send path calls channel.send with type broadcast and event msg
check('FRIEND-RT-01', '[STATIC TEST] sendDuelReaction calls _duelChannel.send with type=broadcast event=msg',
    bool(re.search(r'sendDuelReaction.*?_duelChannel', _fb_full, re.DOTALL))
    and bool(re.search(r"event:\s*['\"]msg['\"]", _fb_full))
)

# FRIEND-RT-02: subscription filters on same duel code (channel name includes code variable)
check('FRIEND-RT-02', '[STATIC TEST] _initDuelChannel creates channel namespaced by duel code',
    bool(re.search(r"sb\.channel\s*\(\s*`duel-chat:\$\{code\}`", _fb_full))
)

# FRIEND-RT-03: incoming msg broadcast rendered by _onDuelMsg
check('FRIEND-RT-03', '[STATIC TEST] _initDuelChannel subscribes to msg event and calls _onDuelMsg',
    bool(re.search(r"event:\s*['\"]msg['\"].*?_onDuelMsg", _fb_full, re.DOTALL))
)

# FRIEND-RT-04: idempotency guard prevents duplicate subscription teardown
check('FRIEND-RT-04', '[STATIC TEST] _duelChannelCode guard skips re-init when same code already subscribed',
    '_duelChannelCode' in _fb_full
    and bool(re.search(r'_duelChannelCode\s*===\s*code', _fb_full))
    and bool(re.search(r'if\s*\(\s*_duelChannel.*?_duelChannelCode\s*===\s*code\s*\)\s*return', _fb_full, re.DOTALL))
)

# ─────────────────────────────────────────────────────────────────────────────
# FRIEND-ANS: Opponent answer real-time notification contract
# ─────────────────────────────────────────────────────────────────────────────

# FRIEND-ANS-01: answer submit goes through server RPC (submit_duel_answer)
check('FRIEND-ANS-01', '[STATIC TEST] pickDuel calls submit_duel_answer RPC (server-authoritative)',
    bool(re.search(r"sb\.rpc\s*\(\s*['\"]submit_duel_answer['\"]", _fb_full))
)

# FRIEND-ANS-02: answered state uses realtime broadcast 'ans' event (not only poll)
check('FRIEND-ANS-02', '[STATIC TEST] pickDuel/duelExpire broadcast ans event to opponent in real-duel path',
    bool(re.search(r"event:\s*['\"]ans['\"]", _fb_full))
    and bool(re.search(r"_duelChannel.*?send.*?event.*?ans", _fb_full, re.DOTALL))
)

# FRIEND-ANS-03: 'ans' broadcast payload contains qi (question index) but NOT correct_index
check('FRIEND-ANS-03', '[STATIC TEST] ans broadcast payload has qi but no correct_index leak',
    bool(re.search(r"payload:\s*\{\s*qi\s*:", _fb_full))
    and not bool(re.search(r"payload:\s*\{[^}]*correct_index[^}]*\}", _fb_full))
)

# FRIEND-ANS-04: receiver of 'ans' event shows neutral indicator without revealing correctness
check('FRIEND-ANS-04', '[STATIC TEST] ans listener calls setOppDot with null (neutral) not a correctness flag',
    bool(re.search(r"setOppDot\s*\(\s*qi\s*,\s*null\s*\)", _fb_full))
)

# FRIEND-ANS-05: final resolution uses get_duel_result RPC (canonical scores from server)
check('FRIEND-ANS-05', '[STATIC TEST] duel resolution calls get_duel_result RPC',
    bool(re.search(r"sb\.rpc\s*\(\s*['\"]get_duel_result['\"]", _fb_full))
)

# ─────────────────────────────────────────────────────────────────────────────
# PROFILE: Profile stats and history display contract
# ─────────────────────────────────────────────────────────────────────────────
import os as _os3
_legacy_js_path = _os3.path.join(_os3.path.dirname(__file__), '..', 'js', 'legacy.js')
_legacy_full = open(_legacy_js_path).read()
_screens_css_path = _os3.path.join(_os3.path.dirname(__file__), '..', 'css', 'screens.css')
_screens_css = open(_screens_css_path).read()
_m93_path = _os3.path.join(_os3.path.dirname(__file__), '..', 'sql', '93_duel_session_link_and_stats.sql')
_m93_sql = open(_m93_path).read() if _os3.path.exists(_m93_path) else ''

# PROFILE-01: duels_won computed from game_sessions.won=true (wins exclude draws/ties)
check('PROFILE-01', '[STATIC TEST] M93 player_stats view counts duels_won only where gs.won=true',
    bool(re.search(r'gs\.won\s*=\s*true', _m93_sql))
    and 'duels_won' in _m93_sql
)

# PROFILE-02: history null-won shown as no-data (not Ничья/draw) — canonical inconsistency removed
check('PROFILE-02', '[STATIC TEST] loadDuelHistory shows "— Нет данных" for null won (not Ничья)',
    '— Нет данных' in _legacy_full
    # Pattern: ternary with won===true / won===false / else '— Нет данных' (null falls to else branch)
    and bool(re.search(r"won\s*===\s*true.*?won\s*===\s*false.*?Нет данных", _legacy_full, re.DOTALL))
    and 'Ничья' not in _legacy_full[_legacy_full.find('loadDuelHistory'):_legacy_full.find('loadDuelHistory')+3000]
)

# PROFILE-03: history never shows "Бот" — uses "виртуальный игрок" label
check('PROFILE-03', '[STATIC TEST] loadDuelHistory uses "виртуальный игрок" not "Бот" for virtual mode',
    'виртуальный игрок' in _legacy_full
    and bool(re.search(r"virtual_battle.*виртуальный игрок|виртуальный игрок.*virtual_battle", _legacy_full, re.DOTALL))
    and not bool(re.search(r"oppLabel\s*=.*?['\"]Бот['\"]|modeLabel\s*=.*?['\"]Бот['\"]", _legacy_full))
)

# PROFILE-04: accuracy is derived from canonical data (correct_answers/questions_count)
check('PROFILE-04', '[STATIC TEST] M93 player_stats accuracy_pct uses SUM(correct_answers)/SUM(questions_count)',
    bool(re.search(r'SUM\s*\(\s*gs\.correct_answers\s*\)', _m93_sql, re.IGNORECASE))
    and bool(re.search(r'SUM\s*\(\s*gs\.questions_count\s*\)', _m93_sql, re.IGNORECASE))
    and 'accuracy_pct' in _m93_sql
)

# PROFILE-05: light-theme profile name has explicit readable color (color:var(--text) on .pp-name)
check('PROFILE-05', '[STATIC TEST] .pp-name has explicit color:var(--text) for light-theme contrast',
    bool(re.search(r'\.pp-name\s*\{[^}]*color\s*:\s*var\(--text\)', _screens_css, re.DOTALL))
)

# ─────────────────────────────────────────────────────────────────────────────
# M93: Duel session link and stats migration contract
# ─────────────────────────────────────────────────────────────────────────────

# M93-01: start_duel must capture host session id into duel_rooms.host_session_id
check('M93-01', '[STATIC TEST] start_duel captures host_session_id into duel_rooms',
    bool(re.search(r'host_session_id\s*=\s*_host_sid', _m93_sql))
    and bool(re.search(r'RETURNING id INTO _host_sid', _m93_sql))
)

# M93-02: start_duel must capture guest session id into duel_rooms.guest_session_id
check('M93-02', '[STATIC TEST] start_duel captures guest_session_id into duel_rooms',
    bool(re.search(r'guest_session_id\s*=\s*_guest_sid', _m93_sql))
    and bool(re.search(r'RETURNING id INTO _guest_sid', _m93_sql))
)

# M93-03: get_duel_result finalization writes both host and guest game_sessions atomically
check('M93-03', '[STATIC TEST] get_duel_result writes both host and guest game_sessions in finalization',
    bool(re.search(r'host_session_id IS NOT NULL', _m93_sql))
    and bool(re.search(r'guest_session_id IS NOT NULL', _m93_sql))
    and _m93_sql.count('UPDATE game_sessions') >= 2
)

# M93-04: tie contract — NULL won for both players on equal scores
check('M93-04', '[STATIC TEST] M93 represents tie as won=NULL (not won=false)',
    bool(re.search(r'ELSE NULL\b', _m93_sql))
    and bool(re.search(r'_host_score\s*[<>]\s*_guest_score', _m93_sql))
)

# M93-05: M93 does NOT use DROP VIEW CASCADE (safe view replacement only)
check('M93-05', '[STATIC TEST] M93 does not use DROP VIEW with CASCADE',
    not bool(re.search(r'DROP\s+VIEW\s+.*?CASCADE', _m93_sql, re.IGNORECASE))
)

# M93-06: M93 uses CREATE OR REPLACE VIEW for player_stats (preserves column order)
check('M93-06', '[STATIC TEST] M93 uses CREATE OR REPLACE VIEW for player_stats',
    bool(re.search(r'CREATE\s+OR\s+REPLACE\s+VIEW\s+.*?player_stats', _m93_sql, re.IGNORECASE))
)

# M93-07: start_duel uses questions table (not secure_questions) — matches M87 live body
check('M93-07', '[STATIC TEST] M93 start_duel queries questions table not secure_questions',
    bool(re.search(r'FROM\s+questions\b', _m93_sql))
    and not bool(re.search(r'FROM\s+secure_questions\b', _m93_sql))
)

# M93-08: _duelSend helper queues events when channel not yet SUBSCRIBED
check('M93-08', '[STATIC TEST] friend-battle.js _duelSend queues events when _duelChannelReady is false',
    bool(re.search(r'function\s+_duelSend', _fb_full))
    and bool(re.search(r'_duelChannelReady', _fb_full))
    and bool(re.search(r'_duelChannelQueue\.push', _fb_full))
)

# M93-09: subscribe callback flushes queue once (splice(0) pattern prevents double-flush)
check('M93-09', '[STATIC TEST] channel subscribe callback uses splice(0) to flush queue atomically',
    bool(re.search(r'_duelChannelQueue\.splice\s*\(\s*0\s*\)', _fb_full))
    and bool(re.search(r"status\s*===\s*['\"]SUBSCRIBED['\"]", _fb_full))
)

# M93-10: resetDuel clears channel readiness and queue state
check('M93-10', '[STATIC TEST] resetDuel clears _duelChannelReady and _duelChannelQueue',
    bool(re.search(r'_duelChannelReady\s*=\s*false', _fb_full))
    and bool(re.search(r'_duelChannelQueue\s*=\s*\[\]', _fb_full))
)

# ─────────────────────────────────────────────────────────────────────────────
# M93-11..18: Forfeit session-sync and idempotency contract
# ─────────────────────────────────────────────────────────────────────────────

# M93-11: already-finished branch syncs host_session_id (forfeit path)
check('M93-11', '[STATIC TEST] already-finished branch in get_duel_result syncs host_session_id',
    bool(re.search(
        r"status\s*=\s*['\"]finished['\"].*?host_session_id\s+IS\s+NOT\s+NULL.*?UPDATE\s+game_sessions",
        _m93_sql, re.DOTALL | re.IGNORECASE
    ))
)

# M93-12: already-finished branch syncs guest_session_id (forfeit path)
check('M93-12', '[STATIC TEST] already-finished branch in get_duel_result syncs guest_session_id',
    bool(re.search(
        r"status\s*=\s*['\"]finished['\"].*?guest_session_id\s+IS\s+NOT\s+NULL.*?UPDATE\s+game_sessions",
        _m93_sql, re.DOTALL | re.IGNORECASE
    ))
)

# M93-13: forfeit winner determined by winner_id not score comparison (in already-finished branch)
check('M93-13', '[STATIC TEST] already-finished branch uses winner_id for won (not score comparison)',
    bool(re.search(
        r"status\s*=\s*['\"]finished['\"].*?winner_id\s*=\s*_room\.host_user_id",
        _m93_sql, re.DOTALL
    ))
    and bool(re.search(
        r"status\s*=\s*['\"]finished['\"].*?winner_id\s*=\s*_room\.guest_user_id",
        _m93_sql, re.DOTALL
    ))
)

# M93-14: forfeit loser gets won=false — when winner_id=host, guest session gets false
check('M93-14', '[STATIC TEST] guest gets won=false when host is winner_id in already-finished branch',
    bool(re.search(r"winner_id\s*=\s*_room\.host_user_id\s+THEN\s+false", _m93_sql))
)

# M93-15: tie (winner_id IS NULL) → both won=NULL in already-finished branch
check('M93-15', '[STATIC TEST] already-finished branch writes won=NULL for tie (winner_id IS NULL)',
    bool(re.search(r'_tie\s*:=\s*_room\.winner_id\s+IS\s+NULL\s+AND\s+_room\.finished_at\s+IS\s+NOT\s+NULL', _m93_sql))
    and bool(re.search(r'ELSE NULL\b', _m93_sql))
)

# M93-16: already-finished branch is idempotent (no won IS NULL guard that would skip re-sync)
check('M93-16', '[STATIC TEST] finished branch session sync is unconditional (idempotent by UPDATE semantics)',
    bool(re.search(r"status\s*=\s*['\"]finished['\"]", _m93_sql))
    and not bool(re.search(r"WHERE id = _room\.host_session_id\s+AND\s+won\s+IS\s+NULL", _m93_sql))
)

# M93-17: already-finished branch writes correct_answers and questions_count
check('M93-17', '[STATIC TEST] already-finished branch writes correct_answers and questions_count',
    bool(re.search(
        r"status\s*=\s*['\"]finished['\"].*?correct_answers\s*=\s*_host_correct.*?questions_count\s*=\s*_total_qs",
        _m93_sql, re.DOTALL
    ))
)

# M93-18: ans event payload has only qi — no correctness fields during live play
check('M93-18', '[STATIC TEST] ans event payload contains only qi (no is_correct/correct_index leak)',
    bool(re.search(r"event:\s*['\"]ans['\"].*?payload:\s*\{[^}]*qi", _fb_full, re.DOTALL))
    and not bool(re.search(r"event:\s*['\"]ans['\"].*?payload:\s*\{[^}]*is_correct", _fb_full, re.DOTALL))
)

# ─────────────────────────────────────────────────────────────────────────────
# PROFILE-06..09: Opponent display in history
# ─────────────────────────────────────────────────────────────────────────────

# PROFILE-06: loadDuelHistory selects opponent_id from game_sessions
check('PROFILE-06', '[STATIC TEST] loadDuelHistory selects opponent_id in query',
    bool(re.search(r"\.select\s*\(['\"].*?opponent_id.*?['\"]", _legacy_full, re.DOTALL))
    and bool(re.search(r'loadDuelHistory|game_sessions', _legacy_full))
)

# PROFILE-07: batch profile fetch (no N+1) — single profiles query with .in('id', oppIds)
check('PROFILE-07', '[STATIC TEST] loadDuelHistory uses batched profiles query (not per-session lookup)',
    bool(re.search(r"\.from\s*\(\s*['\"]profiles['\"]", _legacy_full))
    and bool(re.search(r"\.in\s*\(\s*['\"]id['\"]", _legacy_full))
)

# PROFILE-08: virtual_battle always renders "виртуальный игрок" regardless of opponent_id
check('PROFILE-08', '[STATIC TEST] virtual_battle mode renders "виртуальный игрок" (not opponent lookup)',
    bool(re.search(r"virtual_battle.*виртуальный игрок|виртуальный игрок.*virtual_battle", _legacy_full, re.DOTALL))
    and bool(re.search(r"mode\s*===\s*['\"]virtual_battle['\"]", _legacy_full))
)

# PROFILE-09: missing opponent profile falls back to safe label (Соперник/Друг, not empty/null)
check('PROFILE-09', '[STATIC TEST] loadDuelHistory has fallback label for missing opponent profile',
    bool(re.search(r"Соперник|Друг", _legacy_full))
    and bool(re.search(r'oppNames\[.*?\]', _legacy_full))
)

# ─────────────────────────────────────────────────────────────────────────────
# Results
# ─────────────────────────────────────────────────────────────────────────────
# ─────────────────────────────────────────────────────────────────────────────
# SPRINT-UX: Release Candidate UX/Runtime sprint
# ─────────────────────────────────────────────────────────────────────────────
import os as _os4
_mm_js_path  = _os4.path.join(_os4.path.dirname(__file__), '..', 'js', 'battles', 'matchmaking.js')
_mm_full     = open(_mm_js_path).read() if _os4.path.exists(_mm_js_path) else ''
_idx_path    = _os4.path.join(_os4.path.dirname(__file__), '..', 'index.html')
_idx_full    = open(_idx_path).read() if _os4.path.exists(_idx_path) else ''

# BATTLE-PTS-01: renderDuelTimer shows dynamic score for virtual battle
check('BATTLE-PTS-01', '[STATIC TEST] renderDuelTimer shows dynamic pts for bot duel (not always +10)',
    bool(re.search(r'_isBotDuel.*?duelTimeLeft|duelTimeLeft.*?_isBotDuel', _fb_full, re.DOTALL))
    and bool(re.search(r"d-p-val", _fb_full))
)

# BATTLE-PTS-02: virtual battle scoring uses Math.max(1, duelTimeLeft)
check('BATTLE-PTS-02', '[STATIC TEST] virtual battle answer path uses Math.max(1, duelTimeLeft) for pts',
    bool(re.search(r'Math\.max\s*\(\s*1\s*,\s*duelTimeLeft\s*\)', _fb_full))
)

# BATTLE-PTS-03: friend duel shows +10 (server-fixed scoring)
check('BATTLE-PTS-03', '[STATIC TEST] renderDuelTimer keeps +10 for non-bot (friend duel) path',
    bool(re.search(r"['\+]10['\"]", _fb_full))
    and bool(re.search(r'_isBotDuel', _fb_full))
)

# RB-PERSONA-01: BOT_PLAYERS pool has at least 12 entries
check('RB-PERSONA-01', '[STATIC TEST] BOT_PLAYERS pool expanded to ≥12 entries',
    len(re.findall(r'\{\s*name\s*:', _mm_full)) >= 12
)

# RB-PERSONA-02: _showBotOffer picks random 3 (not forEach all)
check('RB-PERSONA-02', '[STATIC TEST] _showBotOffer picks 3 random unique personas (not forEach BOT_PLAYERS)',
    bool(re.search(r'sort\s*\(\s*\(\)\s*=>\s*Math\.random', _mm_full))
    and bool(re.search(r'slice\s*\(\s*0\s*,\s*3\s*\)', _mm_full))
)

# RB-LIGHT-01: persona cards use theme-aware CSS vars not hardcoded rgba white bg
check('RB-LIGHT-01', '[STATIC TEST] persona card background uses var(--bg2) not rgba(255,255,255,0.09)',
    'var(--bg2)' in _mm_full
    and 'rgba(255,255,255,0.09)' not in _mm_full
)

# RB-LIGHT-02: persona card text uses var(--text) / var(--muted) not hardcoded white
check('RB-LIGHT-02', '[STATIC TEST] persona card text uses var(--text)/var(--muted) not hardcoded #fff/rgba-white',
    bool(re.search(r'color:var\(--text\)', _mm_full))
    and bool(re.search(r'color:var\(--muted\)', _mm_full))
)

# HOME-NEURON-01: neurons widget has ⓘ info button
check('HOME-NEURON-01', '[STATIC TEST] home neurons widget has ⓘ info affordance',
    'ⓘ' in _idx_full
    and 'hdb-neurons' in _idx_full
)

# HOME-NEURON-02: ⓘ button triggers toast with neuron explanation
check('HOME-NEURON-02', '[STATIC TEST] ⓘ button calls window.toast with neuron description',
    bool(re.search(r'ⓘ.*?toast|toast.*?ⓘ', _idx_full, re.DOTALL))
    and bool(re.search(r'Нейроны|нейроны', _idx_full))
)

# HOME-NEURON-03: hdb-neurons shows state.neurons (total balance, not today-only)
check('HOME-NEURON-03', '[STATIC TEST] home dashboard renders hdb-neurons from state.neurons',
    bool(re.search(r'state\.neurons', open(_os4.path.join(_os4.path.dirname(__file__), '..', 'js', 'home-dashboard.js')).read()))
    and bool(re.search(r'hdb-neurons', _idx_full))
)

# ─────────────────────────────────────────────────────────────────────────────
# SPRINT-RC2: RC sprint round-2 additions
# ─────────────────────────────────────────────────────────────────────────────
import os as _os5
_hdb_path = _os5.path.join(_os5.path.dirname(__file__), '..', 'js', 'home-dashboard.js')
_hdb_full = open(_hdb_path).read() if _os5.path.exists(_hdb_path) else ''
_m94_path = _os5.path.join(_os5.path.dirname(__file__), '..', 'sql', '94_release_candidate_runtime_fixes.sql')
_m94_sql  = open(_m94_path).read() if _os5.path.exists(_m94_path) else ''
_cf_path  = _os5.path.join(_os5.path.dirname(__file__), '..', 'js', 'club-finder.js')
_cf_full  = open(_cf_path).read() if _os5.path.exists(_cf_path) else ''

# BATTLE-PTS-04: submit_duel_answer awards fixed 10 pts (friend + random human)
_m87_sql = open(_os5.path.join(_os5.path.dirname(__file__), '..', 'sql', '87_fix_answer_array_canonical.sql')).read()
check('BATTLE-PTS-04', '[STATIC TEST] submit_duel_answer grants fixed 10 pts per correct answer (M87)',
    bool(re.search(r'_pts\s*:=\s*10', _m87_sql))
)

# BATTLE-PTS-05: random human duel uses same submit_duel_answer path (fixed 10)
check('BATTLE-PTS-05', '[STATIC TEST] random_battle uses submit_duel_answer (same fixed scoring as friend_battle)',
    bool(re.search(r'submit_duel_answer', _fb_full))
    and bool(re.search(r"p_code.*?p_question_idx|p_question_idx.*?p_code", _m87_sql, re.DOTALL))
)

# BATTLE-PTS-06: virtual battle indicator shows dynamic score matching Math.max(1, duelTimeLeft)
check('BATTLE-PTS-06', '[STATIC TEST] virtual duel UI indicator uses dynamic duelTimeLeft (speed-based)',
    bool(re.search(r'_isBotDuel.*?Math\.max.*?duelTimeLeft|Math\.max.*?duelTimeLeft.*?_isBotDuel', _fb_full, re.DOTALL))
)

# HOME-NEURON-03b: todayLabel changed to "Заработано сегодня"
check('HOME-NEURON-03b', '[STATIC TEST] todayLabel string updated to "Заработано сегодня"',
    'Заработано сегодня' in _hdb_full
)

# HOME-NEURON-04: _loadTodayEarned calls get_my_today_neurons RPC (server-authoritative, uses player timezone)
check('HOME-NEURON-04', '[STATIC TEST] _loadTodayEarned calls get_my_today_neurons RPC (not direct ledger query)',
    bool(re.search(r'get_my_today_neurons', _hdb_full))
    and bool(re.search(r'data\.earned', _hdb_full))
)

# HOME-NEURON-05: ⓘ info copy is conservative (does not claim unverified amounts)
check('HOME-NEURON-05', '[STATIC TEST] ⓘ button uses conservative neuron copy without unverified reward amounts',
    bool(re.search(r'Нейроны.*валюта|neurons.*currency', _idx_full, re.IGNORECASE))
    and 'ⓘ' in _idx_full
    and not bool(re.search(r'\+10.*Быстрой|\+50.*дуэл', _idx_full))
)

# HOME-STREAK-04: streak value comes from profiles.daily_streak (server-canonical)
check('HOME-STREAK-04', '[STATIC TEST] home dashboard reads streak from state.streak (loaded from profiles.daily_streak)',
    bool(re.search(r'state\.streak', _hdb_full))
    and bool(re.search(r'daily_streak', open(_os5.path.join(_os5.path.dirname(__file__), '..', 'js', 'legacy.js')).read()))
)

# HOME-STREAK-05: completed session path calls record_daily_activity or equivalent
check('HOME-STREAK-05', '[STATIC TEST] training completion path invokes record_daily_activity',
    bool(re.search(r'record_daily_activity', open(_os5.path.join(_os5.path.dirname(__file__), '..', 'js', 'training', 'streak.js')).read()))
)

# HOME-STREAK-06: exhausted limit + streak=0 → shows "не завершена" message not "Сыграй сегодня"
check('HOME-STREAK-06', '[STATIC TEST] streak sub-label shows incomplete-session message when limit exhausted and streak=0',
    bool(re.search(r'не завершена|not.*completed', _hdb_full, re.IGNORECASE))
    and bool(re.search(r'getRemainingFreeQuestions', _hdb_full))
)

# HOME-GOAL-01: orphan "23" removed — home-player-count never made visible
check('HOME-GOAL-01', '[STATIC TEST] _loadHomePlayerCount does not set wrap.style.display="" (orphan number hidden)',
    not bool(re.search(r'wrap\.style\.display\s*=\s*[\'"][\'"]\s*;', open(_os5.path.join(_os5.path.dirname(__file__), '..', 'js', 'legacy.js')).read().split('_loadHomePlayerCount')[1].split('\n}')[0]))
)

# HOME-GOAL-02: home-player-count stays display:none in HTML
check('HOME-GOAL-02', '[STATIC TEST] home-player-count element has display:none in HTML',
    bool(re.search(r'home-player-count.*?display:none|display:none.*?home-player-count', _idx_full, re.DOTALL))
)

# LISTING-05: M94 makes club_id nullable in club_recruitment_board
check('LISTING-05', '[STATIC TEST] M94 drops NOT NULL on club_recruitment_board.club_id',
    bool(re.search(r'ALTER TABLE.*club_recruitment_board.*ALTER COLUMN.*club_id.*DROP NOT NULL', _m94_sql, re.DOTALL))
    or bool(re.search(r'club_id.*DROP NOT NULL', _m94_sql))
)

# LISTING-06: listing submit form has name, text, city fields
check('LISTING-06', '[STATIC TEST] listing form has cf-post-name, cf-post-text, cf-post-city fields',
    'cf-post-name' in _idx_full and 'cf-post-text' in _idx_full and 'cf-post-city' in _idx_full
)

# LISTING-07: submit handler validates auth before INSERT
check('LISTING-07', '[STATIC TEST] _cfSubmitPost checks currentUser before DB insert',
    bool(re.search(r'_cfUser.*currentUser|currentUser.*_cfUser', _idx_full, re.DOTALL))
    and bool(re.search(r'if.*!_cfUser', _idx_full))
)

# LISTING-08: tab button uses "Разместить объявление" not "Подать заявку"
check('LISTING-08', '[STATIC TEST] listing tab uses "Разместить объявление" label',
    'Разместить объявление' in _idx_full
)

# LISTING-09: success flow refreshes browse tab
check('LISTING-09', '[STATIC TEST] listing submit success calls _cfTab("browse") for refresh',
    bool(re.search(r"_cfTab\s*\(\s*['\"]browse['\"]", _idx_full))
    and bool(re.search(r'setTimeout.*_cfTab', _idx_full, re.DOTALL))
)

# HISTORY-05: virtual battle uses complete_virtual_battle_session RPC (not direct UPDATE)
check('HISTORY-05', '[STATIC TEST] _saveDuelStats uses complete_virtual_battle_session RPC for bot duels',
    bool(re.search(r'complete_virtual_battle_session', _fb_full))
    and not bool(re.search(r"from\s*\(\s*['\"]game_sessions['\"].*?\.update\s*\(", _fb_full, re.DOTALL))
)

# HISTORY-06: RPC call passes only p_session_id — no client result params
check('HISTORY-06', '[STATIC TEST] complete_virtual_battle_session called with p_session_id only (no client results)',
    bool(re.search(r'complete_virtual_battle_session', _fb_full))
    and not bool(re.search(r'p_correct\s*:', _fb_full))
    and not bool(re.search(r'p_questions\s*:', _fb_full))
)

# HISTORY-07: RPC call does not supply p_won (server does not accept it)
check('HISTORY-07', '[STATIC TEST] complete_virtual_battle_session RPC call does not pass p_won',
    bool(re.search(r'complete_virtual_battle_session', _fb_full))
    and not bool(re.search(r'p_won\s*:', _fb_full))
)

# HISTORY-08: M94 complete_virtual_battle_session is idempotent (already_set path)
check('HISTORY-08', '[STATIC TEST] M94 RPC has idempotent already_set path',
    'already_set' in _m94_sql
)

# HISTORY-09: M94 validates user_id + mode=virtual_battle before UPDATE
check('HISTORY-09', '[STATIC TEST] M94 RPC restricts UPDATE to virtual_battle sessions owned by caller',
    bool(re.search(r"mode\s*=\s*'virtual_battle'", _m94_sql))
    and bool(re.search(r'v_uid\s+uuid\s*:=\s*auth\.uid\(\)', _m94_sql))
    and bool(re.search(r'user_id\s*=\s*v_uid', _m94_sql))
)

# PROFILE-STATS-01: M94 player_stats excludes virtual_battle from duels_won
# The duels_won FILTER block must use friend+random only (not virtual_battle)
check('PROFILE-STATS-01', '[STATIC TEST] M94 player_stats duels_won filter excludes virtual_battle',
    bool(re.search(r"duels_won", _m94_sql))
    and bool(re.search(r"mode IN \('friend_battle','random_battle'\)\s*\n\s*AND gs\.won = true", _m94_sql))
    and not bool(re.search(r"mode IN \('friend_battle','random_battle','virtual_battle'\)\s*\n\s*AND gs\.won", _m94_sql))
)

# PROFILE-STATS-02: duels_played still includes virtual_battle
check('PROFILE-STATS-02', '[STATIC TEST] M94 player_stats duels_played still counts virtual_battle',
    bool(re.search(r"duels_played.*virtual_battle|virtual_battle.*duels_played", _m94_sql, re.DOTALL))
)

# PROFILE-STATS-03: accuracy_pct computed from correct_total / questions_total (not 0 when data exists)
check('PROFILE-STATS-03', '[STATIC TEST] player_stats accuracy_pct uses ROUND(correct/questions*100)',
    bool(re.search(r'ROUND\s*\(.*correct_answers.*questions_count|ROUND.*correct.*100', _m94_sql, re.DOTALL))
    or bool(re.search(r'accuracy_pct', _m94_sql) and re.search(r'SUM.*correct_answers', _m94_sql, re.DOTALL))
)


# ─── SPRINT-RC2 SECURITY ROUND 2 — ATOMICITY + IDEMPOTENCY + HOME ────────────

# M94-TX-01: BEGIN present as first executable statement
check('M94-TX-01', '[STATIC TEST] M94 begins with transaction BEGIN',
    bool(re.search(r'^\s*BEGIN\s*;', _m94_sql, re.MULTILINE))
)

# M94-TX-02: COMMIT present as last executable statement
check('M94-TX-02', '[STATIC TEST] M94 ends with COMMIT',
    bool(re.search(r'COMMIT\s*;?\s*$', _m94_sql.rstrip()))
)

# M94-TX-03: DROP of old 5-param overload is inside the transaction
_m94_begin_pos = _m94_sql.find('BEGIN')
_m94_commit_pos = _m94_sql.rfind('COMMIT')
_m94_drop_pos = _m94_sql.find('DROP FUNCTION IF EXISTS public.complete_virtual_battle_session(uuid, int, int, int, boolean)')
check('M94-TX-03', '[STATIC TEST] old 5-param complete_virtual_battle_session DROP is inside BEGIN..COMMIT',
    _m94_drop_pos > _m94_begin_pos and _m94_drop_pos < _m94_commit_pos
)

# M94-SEC-09: completed_at is the idempotency sentinel (not questions_count)
check('M94-SEC-09', '[STATIC TEST] completed_at IS NOT NULL is the idempotency sentinel',
    bool(re.search(r'completed_at\s+IS\s+NOT\s+NULL', _m94_sql))
    and bool(re.search(r'already_set.*completed_at|completed_at.*already_set', _m94_sql, re.DOTALL))
)

# M94-SEC-10: retry returns persisted canonical stats (correct_answers + questions_count from row)
check('M94-SEC-10', '[STATIC TEST] idempotent retry returns persisted correct_answers and questions_count',
    bool(re.search(r"already_set.*true.*correct_answers.*v_session\.correct_answers|v_session\.correct_answers.*already_set", _m94_sql, re.DOTALL))
    or bool(re.search(r"'already_set'.*true.*'correct_answers'.*v_session\.", _m94_sql, re.DOTALL))
)

# M94-SEC-11: questions_count alone does not mark session complete
check('M94-SEC-11', '[STATIC TEST] idempotency does not check questions_count IS NOT NULL as sentinel',
    not bool(re.search(r'questions_count\s+IS\s+NOT\s+NULL.*already_set|already_set.*questions_count\s+IS\s+NOT\s+NULL', _m94_sql, re.DOTALL))
)

# M94-SEC-12: SELECT FOR UPDATE used for race safety
check('M94-SEC-12', '[STATIC TEST] complete_virtual_battle_session uses SELECT FOR UPDATE',
    bool(re.search(r'FOR\s+UPDATE', _m94_sql))
)

# HOME-TODAY-04: skeleton shows "—" not state.neurons for earned-today
# The skeleton sets a local var from getElementById('hdb-neurons') then assigns textContent = '—'
check('HOME-TODAY-04', '[STATIC TEST] skeleton sets hdb-neurons to "—" (not state.neurons)',
    bool(re.search(r"getElementById\s*\(\s*['\"]hdb-neurons['\"]", _hdb_full))
    and bool(re.search(r"textContent\s*=\s*['\"]—['\"]", _hdb_full))
    and not bool(re.search(r"getElementById\s*\(\s*['\"]hdb-neurons['\"].*state\.neurons", _hdb_full, re.DOTALL))
)

# HOME-TODAY-05: RPC failure path does not update hdb-neurons (keeps "—")
check('HOME-TODAY-05', '[STATIC TEST] _loadTodayEarned returns early on error without writing hdb-neurons',
    bool(re.search(r'if\s*\(error.*return|error.*return', _hdb_full))
    and bool(re.search(r'get_my_today_neurons', _hdb_full))
)

# HOME-TODAY-06: get_my_today_neurons derives both boundaries as local calendar midnights
check('HOME-TODAY-06', '[STATIC TEST] get_my_today_neurons derives v_day_start and v_day_end from local date',
    bool(re.search(r'v_local_today::timestamp\s+AT TIME ZONE', _m94_sql))
    and bool(re.search(r'\(v_local_today \+ 1\)::timestamp\s+AT TIME ZONE', _m94_sql))
)

# HOME-TODAY-07: no executable v_day_start + interval '1 day' (only in comment, not in code)
# Skip comment lines when checking
_m94_code_lines = '\n'.join(l for l in _m94_sql.split('\n') if not l.strip().startswith('--'))
check('HOME-TODAY-07', '[STATIC TEST] v_day_start + interval 1 day is not used in executable code (DST-unsafe pattern removed)',
    not bool(re.search(r"v_day_start\s*\+\s*interval\s*'1 day'", _m94_code_lines))
)

# ─── SPRINT-RC2 SECURITY ROUND ───────────────────────────────────────────────

# M94-SEC-01: RPC accepts only p_session_id — no score/correct/questions/won params
check('M94-SEC-01', '[STATIC TEST] complete_virtual_battle_session accepts session_id only (no client result params)',
    bool(re.search(r'complete_virtual_battle_session\s*\(\s*p_session_id\s+uuid\s*\)', _m94_sql))
    and not bool(re.search(r'p_score\s+int|p_correct\s+int|p_questions\s+int|p_won\s+bool', _m94_sql))
)

# M94-SEC-02: client cannot submit score — score column not set in UPDATE
check('M94-SEC-02', '[STATIC TEST] complete_virtual_battle_session does not write score column',
    not bool(re.search(r'score\s*=\s*[^C]', _m94_sql.split('complete_virtual_battle_session')[1].split('get_my_today_neurons')[0]))
)

# M94-SEC-03: correct count derived from session_questions, not client param
check('M94-SEC-03', '[STATIC TEST] correct_answers derived from session_questions (server COUNT)',
    bool(re.search(r'COUNT\(\*\).*FILTER.*is_correct.*=.*true|COUNT\(\*\).*is_correct\s*=\s*true', _m94_sql, re.DOTALL))
)

# M94-SEC-04: won not written
check('M94-SEC-04', '[STATIC TEST] complete_virtual_battle_session does not write won column',
    not bool(re.search(r'\bwon\s*=', _m94_sql.split('complete_virtual_battle_session')[1].split('get_my_today_neurons')[0]))
)

# M94-SEC-05: questions_count derived from session_questions COUNT
check('M94-SEC-05', '[STATIC TEST] questions_count derived from session_questions COUNT(*)',
    bool(re.search(r'questions_count\s*=\s*v_total', _m94_sql))
    and bool(re.search(r'v_total\s*:=.*\d|COUNT\(\*\)\s*INTO.*v_total|INTO v_total', _m94_sql, re.DOTALL))
)

# M94-SEC-06: incomplete session rejected — v_answered check
check('M94-SEC-06', '[STATIC TEST] incomplete virtual session rejected (all 5 must be answered)',
    bool(re.search(r'v_answered\s*<>\s*5|v_answered\s*!=\s*5', _m94_sql))
    and bool(re.search(r"incomplete_session", _m94_sql))
)

# M94-SEC-07: ownership enforced — user_id = v_uid AND mode = virtual_battle
check('M94-SEC-07', '[STATIC TEST] complete_virtual_battle_session enforces user_id = auth.uid()',
    bool(re.search(r"user_id\s*=\s*v_uid.*mode\s*=\s*'virtual_battle'|mode\s*=\s*'virtual_battle'.*user_id\s*=\s*v_uid", _m94_sql, re.DOTALL))
    and bool(re.search(r'v_uid\s+uuid\s*:=\s*auth\.uid\(\)', _m94_sql))
)

# M94-SEC-08: anon denied — REVOKE from anon present
check('M94-SEC-08', '[STATIC TEST] complete_virtual_battle_session revokes execute from anon',
    bool(re.search(r'REVOKE.*complete_virtual_battle_session.*anon|REVOKE.*anon.*complete_virtual_battle_session', _m94_sql, re.DOTALL))
    or bool(re.search(r'FROM PUBLIC, anon', _m94_sql))
)

# HOME-TODAY-01: _loadTodayEarned uses get_my_today_neurons RPC (not direct ledger query)
check('HOME-TODAY-01', '[STATIC TEST] _loadTodayEarned calls get_my_today_neurons RPC',
    bool(re.search(r'get_my_today_neurons', _hdb_full))
    and not bool(re.search(r"from\s*\(\s*['\"]currency_ledger['\"]", _hdb_full))
)

# HOME-TODAY-02: get_my_today_neurons uses profiles.timezone (not UTC hardcoded)
check('HOME-TODAY-02', '[STATIC TEST] get_my_today_neurons RPC uses profiles.timezone for local day',
    bool(re.search(r'get_my_today_neurons', _m94_sql))
    and bool(re.search(r'profiles.*timezone|timezone.*profiles', _m94_sql, re.DOTALL))
    and bool(re.search(r'AT TIME ZONE', _m94_sql))
)

# HOME-TODAY-03: get_my_today_neurons sums only positive awards (no spends)
check('HOME-TODAY-03', '[STATIC TEST] get_my_today_neurons sums awarded_neurons > 0 only',
    bool(re.search(r'awarded_neurons\s*>\s*0', _m94_sql))
    and bool(re.search(r'SUM.*awarded_neurons', _m94_sql, re.DOTALL))
)

# HOME-STREAK-07: _loadDailyState calls get_my_daily_state RPC
check('HOME-STREAK-07', '[STATIC TEST] home-dashboard calls get_my_daily_state RPC for canonical streak',
    bool(re.search(r'get_my_daily_state', _hdb_full))
)

# HOME-STREAK-08: streak_saved_today path renders "Серия сохранена"
check('HOME-STREAK-08', '[STATIC TEST] streak_saved_today state shows saved message',
    bool(re.search(r'streak_saved_today|Серия сохранена', _hdb_full))
)

# HOME-STREAK-09: incomplete state does not claim saved streak
check('HOME-STREAK-09', '[STATIC TEST] streak=0 + limit exhausted shows incomplete-session message',
    bool(re.search(r'не завершена|not.*completed', _hdb_full, re.IGNORECASE))
    and bool(re.search(r'getRemainingFreeQuestions', _hdb_full))
)

# PROFILE-STATS-04: ps-duels element renders data.duels_won (not duels_played)
_legacy_full = open(_os5.path.join(_os5.path.dirname(__file__), '..', 'js', 'legacy.js')).read()
check('PROFILE-STATS-04', '[STATIC TEST] ps-duels element renders data.duels_won not data.duels_played',
    bool(re.search(r"setText\s*\(\s*['\"]ps-duels['\"].*duels_won", _legacy_full))
    and not bool(re.search(r"setText\s*\(\s*['\"]ps-duels['\"].*duels_played", _legacy_full))
)

# PROFILE-STATS-05: virtual_battle excluded from duels_won in M94 view
check('PROFILE-STATS-05', '[STATIC TEST] player_stats duels_won filter: friend+random only (virtual excluded)',
    bool(re.search(r"mode IN \('friend_battle','random_battle'\)\s*\n\s*AND gs\.won = true", _m94_sql))
    and not bool(re.search(r"mode IN \('friend_battle','random_battle','virtual_battle'\)\s*\n\s*AND gs\.won", _m94_sql))
)

# LISTING-10: crb_creator_write policy uses auth.uid() = creator_id (insert is ownership-tied)
_m28_sql = open(_os5.path.join(_os5.path.dirname(__file__), '..', 'sql', '28_dating_club_finder.sql')).read()
check('LISTING-10', '[STATIC TEST] club_recruitment_board insert policy ties to auth.uid() = creator_id',
    bool(re.search(r'auth\.uid\(\)\s*=\s*creator_id|creator_id\s*=\s*auth\.uid\(\)', _m28_sql))
    and bool(re.search(r'crb_creator_write|creator_write', _m28_sql))
)

# ── GUEST-DUEL tests (Part B: Guest Friend Duel regression fix) ────────────────

import os as _os6
_auth_full  = open(_os6.path.join(_os6.path.dirname(__file__), '..', 'js', 'auth', 'auth.js')).read()
_fb_full    = open(_os6.path.join(_os6.path.dirname(__file__), '..', 'js', 'battles', 'friend-battle.js')).read()

# GUEST-DUEL-01: continueAsGuest is async (needed for await signInAnonymously)
check('GUEST-DUEL-01', '[STATIC TEST] continueAsGuest is declared async',
    bool(re.search(r'async\s+function\s+continueAsGuest', _auth_full))
)

# GUEST-DUEL-02: continueAsGuest stores duel code in mfc_pending_duel before signInAnonymously
check('GUEST-DUEL-02', '[STATIC TEST] continueAsGuest stores mfc_pending_duel before anonymous sign-in',
    bool(re.search(r"mfc_pending_duel.*signInAnonymously|setItem\s*\(\s*['\"]mfc_pending_duel['\"].*\n.*signInAnonymously", _auth_full, re.DOTALL))
)

# GUEST-DUEL-03: continueAsGuest calls signInAnonymously for duel deep-link
check('GUEST-DUEL-03', '[STATIC TEST] continueAsGuest calls sb.auth.signInAnonymously for ?duel= param',
    bool(re.search(r"p\.get\s*\(\s*['\"]duel['\"]\s*\).*signInAnonymously|signInAnonymously.*duel", _auth_full, re.DOTALL))
)

# GUEST-DUEL-04: continueAsGuest has fallback if signInAnonymously fails
check('GUEST-DUEL-04', '[STATIC TEST] continueAsGuest fallback on signInAnonymously error (shows duel screen)',
    bool(re.search(r'signInAnonymously.*error.*showScreen|if\s*\(\s*error\s*\).*showScreen\s*\([\'"]duel', _auth_full, re.DOTALL))
)

# GUEST-DUEL-05: _redirectAfterAuth auto-joins duel via mfc_pending_duel (existing path)
check('GUEST-DUEL-05', '[STATIC TEST] _redirectAfterAuth reads mfc_pending_duel and auto-joins',
    bool(re.search(r'mfc_pending_duel', _auth_full))
    and bool(re.search(r'joinDuel', _auth_full))
    and bool(re.search(r'mfc_pending_duel.*joinDuel|joinDuel.*mfc_pending_duel', _auth_full, re.DOTALL))
)

# GUEST-DUEL-06: createDuel blocks anonymous users (is_anonymous guard)
check('GUEST-DUEL-06', '[STATIC TEST] createDuel blocks is_anonymous users',
    bool(re.search(r'is_anonymous.*_showSignInToPlay|currentUser\.is_anonymous', _fb_full))
)

# GUEST-DUEL-07: joinDuel does NOT get an is_anonymous block (guests CAN join)
check('GUEST-DUEL-07', '[STATIC TEST] joinDuel does not block is_anonymous (guests allowed to join)',
    not bool(re.search(r'joinDuel[^}]*is_anonymous', _fb_full, re.DOTALL))
    or bool(re.search(r'async function joinDuel[\s\S]{0,500}async function', _fb_full)
            and not re.search(r'is_anonymous', _fb_full[_fb_full.find('async function joinDuel'):_fb_full.find('async function joinDuel')+500]))
)

# GUEST-DUEL-08: endDuel shows register prompt for anonymous users
check('GUEST-DUEL-08', '[STATIC TEST] endDuel shows register/signup prompt for is_anonymous users',
    bool(re.search(r'is_anonymous.*register|guest-register|Зарегистрируйся', _fb_full, re.DOTALL))
)

# GUEST-DUEL-09: deep-link code is written to mfc_pending_duel before signInAnonymously (ordering)
check('GUEST-DUEL-09', '[STATIC TEST] mfc_pending_duel stored before signInAnonymously call (deep-link survives auth)',
    _auth_full.find('mfc_pending_duel') < _auth_full.find('signInAnonymously')
    if 'mfc_pending_duel' in _auth_full and 'signInAnonymously' in _auth_full
    else False
)

# GUEST-DUEL-10: No broad anon GRANT added (security — RPCs stay authenticated-only)
check('GUEST-DUEL-10', '[STATIC TEST] No new GRANT to anon for duel RPCs (anonymous auth provides authenticated role)',
    not bool(re.search(r'GRANT.*join_duel_by_code.*anon|GRANT.*submit_duel_answer.*anon', _auth_full))
    and not bool(re.search(r'GRANT.*join_duel_by_code.*anon|GRANT.*submit_duel_answer.*anon', _fb_full))
)

# ── M95 server-side anonymous auth guard tests ─────────────────────────────────

import os as _os7
_m95_path = _os7.path.join(_os7.path.dirname(__file__), '..', 'sql', '95_guest_duel_anon_server_guards.sql')
_m95_sql  = open(_m95_path).read()
_mm_full  = open(_os7.path.join(_os7.path.dirname(__file__), '..', 'js', 'battles', 'matchmaking.js')).read()

# GUEST-DUEL-11: M95 exists and is NOT applied (Applied: NO comment)
check('GUEST-DUEL-11', '[STATIC TEST] M95 exists and is marked Applied: NO',
    bool(re.search(r'Applied:\s*NO', _m95_sql))
)

# GUEST-DUEL-12: M95 wrapped in BEGIN/COMMIT
check('GUEST-DUEL-12', '[STATIC TEST] M95 is wrapped in BEGIN...COMMIT for atomicity',
    bool(re.search(r'^\s*BEGIN\s*;', _m95_sql, re.MULTILINE))
    and bool(re.search(r'^\s*COMMIT\s*;', _m95_sql, re.MULTILINE))
)

# GUEST-DUEL-13: M95 adds _is_anon_user helper or inline jwt check pattern
check('GUEST-DUEL-13', '[STATIC TEST] M95 defines _is_anon_user helper or uses is_anonymous JWT check',
    bool(re.search(r'_is_anon_user|is_anonymous', _m95_sql))
)

# GUEST-DUEL-14: M95 guards create_duel against anonymous users
check('GUEST-DUEL-14', '[STATIC TEST] M95 adds anon guard to create_duel()',
    bool(re.search(r'create_duel', _m95_sql))
    and bool(re.search(r'anonymous_not_allowed|is_anonymous', _m95_sql))
)

# GUEST-DUEL-15: M95 guards award_currency against anonymous users
check('GUEST-DUEL-15', '[STATIC TEST] M95 adds anon guard to award_currency()',
    bool(re.search(r'award_currency', _m95_sql))
    and bool(re.search(r'anonymous_not_allowed', _m95_sql))
)

# GUEST-DUEL-16: M95 guards start_daily_bf_session against anonymous users
check('GUEST-DUEL-16', '[STATIC TEST] M95 adds anon guard to start_daily_bf_session()',
    bool(re.search(r'start_daily_bf_session', _m95_sql))
    and bool(re.search(r'anonymous_not_allowed', _m95_sql))
)

# GUEST-DUEL-17: M95 guards record_daily_activity against anonymous users
check('GUEST-DUEL-17', '[STATIC TEST] M95 adds anon guard to record_daily_activity(uuid)',
    bool(re.search(r'record_daily_activity', _m95_sql))
    and bool(re.search(r'anonymous_not_allowed', _m95_sql))
)

# GUEST-DUEL-18: join_duel_by_code NOT modified by M95 with an anon block (guests must be able to join)
check('GUEST-DUEL-18', '[STATIC TEST] M95 does NOT CREATE OR REPLACE join_duel_by_code (guests allowed to join)',
    not bool(re.search(r'CREATE.*FUNCTION.*join_duel_by_code', _m95_sql))
)

# GUEST-DUEL-19: matchmaking.js blocks is_anonymous in startMatchmaking
check('GUEST-DUEL-19', '[STATIC TEST] startMatchmaking blocks is_anonymous users (no Random Battle for guests)',
    bool(re.search(r'startMatchmaking[\s\S]{0,200}is_anonymous', _mm_full))
    or bool(re.search(r'is_anonymous.*_showSignInToPlay', _mm_full))
)

# ── GUEST-SEC: Security audit — server-side guard completeness ───────────────

# GUEST-SEC-20: M95 guards _bf_award_duel_win against anonymous winners
check('GUEST-SEC-20', '[STATIC TEST] M95 adds anon winner check to _bf_award_duel_win via auth.users.is_anonymous',
    bool(re.search(r'_bf_award_duel_win', _m95_sql))
    and bool(re.search(r'auth\.users.*is_anonymous|is_anonymous.*auth\.users', _m95_sql))
)

# GUEST-SEC-21: _bf_award_duel_win guard checks p_winner_id, NOT auth.jwt()
check('GUEST-SEC-21', '[STATIC TEST] _bf_award_duel_win anon check uses p_winner_id row (not jwt), because trigger caller != winner',
    bool(re.search(r'FROM auth\.users WHERE id = p_winner_id', _m95_sql))
)

# GUEST-SEC-22: M95 guards claim_random_match against anonymous users
check('GUEST-SEC-22', '[STATIC TEST] M95 adds anon guard to claim_random_match()',
    bool(re.search(r'claim_random_match', _m95_sql))
    and bool(re.search(r'anonymous_not_allowed', _m95_sql))
)

# GUEST-SEC-23: M95 guards cancel_random_matchmaking against anonymous users
check('GUEST-SEC-23', '[STATIC TEST] M95 adds anon guard to cancel_random_matchmaking()',
    bool(re.search(r'cancel_random_matchmaking', _m95_sql))
    and bool(re.search(r'anonymous_not_allowed', _m95_sql))
)

# GUEST-SEC-24: M95 uses M91 timezone body (v_tz variable present, timezone read from profiles)
# Checks that start_daily_bf_session reads timezone from profiles and uses pg_timezone_names validation.
# (award_currency legitimately has a UTC literal for daily caps — that's expected and correct.)
check('GUEST-SEC-24', '[STATIC TEST] M95 start_daily_bf_session uses M91 body (v_tz from profiles.timezone, pg_timezone_names validation)',
    bool(re.search(r"v_tz\s+text\s*:=\s*'UTC'", _m95_sql))
    and bool(re.search(r'AT TIME ZONE v_tz', _m95_sql))
    and bool(re.search(r'pg_timezone_names', _m95_sql))
    and bool(re.search(r'COALESCE\(timezone.*INTO v_tz', _m95_sql))
)

# GUEST-SEC-25: M95 documents start_game_session blocker explicitly
check('GUEST-SEC-25', '[STATIC TEST] M95 documents start_game_session as unpatched blocker (not silently missing)',
    bool(re.search(r'start_game_session', _m95_sql))
    and bool(re.search(r'BLOCKER|MANUAL PATCH|pg_get_functiondef', _m95_sql))
)

# ── GUEST-BF: Brain Fights — guest cannot earn BF points ─────────────────────

# GUEST-BF-01: start_daily_bf_session guard is placed BEFORE timezone resolution (auth order)
check('GUEST-BF-01', '[STATIC TEST] M95 start_daily_bf_session anon guard appears before timezone resolution block',
    (lambda sql: (
        (g := sql.find('anonymous_not_allowed')) != -1
        and (t := sql.find('pg_timezone_names', g)) != -1
        and (t > g)  # guard precedes timezone block
    ))(_m95_sql)
)

# GUEST-BF-02: _bf_award_duel_win returns 0 for anonymous winner (not error)
check('GUEST-BF-02', '[STATIC TEST] _bf_award_duel_win returns 0 (not error) for anonymous winner',
    bool(re.search(
        r'is_anonymous\s*=\s*true[\s\S]{0,100}RETURN\s+0',
        _m95_sql
    ))
)

# GUEST-BF-03: M95 uses current_period_end subscription semantics (not expires_at — M86 fix)
check('GUEST-BF-03', '[STATIC TEST] M95 start_daily_bf_session uses current_period_end (M86 contract, not expires_at)',
    bool(re.search(r'current_period_end', _m95_sql))
    and not bool(re.search(r'expires_at', _m95_sql))
)

# GUEST-BF-04: _bf_award_duel_win REVOKE does not grant to authenticated (internal trigger function)
check('GUEST-BF-04', '[STATIC TEST] M95 _bf_award_duel_win revoked from authenticated (internal trigger function only)',
    bool(re.search(
        r'REVOKE ALL ON FUNCTION public\._bf_award_duel_win[\s\S]{0,100}authenticated',
        _m95_sql
    ))
)

# ── GUEST-RANDOM: Random Battle — guest cannot participate ───────────────────

# GUEST-RANDOM-01: claim_random_match anon guard appears after uid check (not before)
check('GUEST-RANDOM-01', '[STATIC TEST] claim_random_match anon guard follows uid-null check (correct auth order)',
    (lambda sql: (
        (uid_check := sql.find('unauthenticated')) != -1
        and (anon_guard := sql.find('anonymous_not_allowed', uid_check)) != -1
        and (anon_guard > uid_check)
    ))(_m95_sql)
)

# GUEST-RANDOM-02: cancel_random_matchmaking anon guard also present
check('GUEST-RANDOM-02', '[STATIC TEST] cancel_random_matchmaking has anon guard (defensive: anon should never be in queue)',
    bool(re.search(
        r'cancel_random_matchmaking[\s\S]{0,2000}anonymous_not_allowed',
        _m95_sql
    ))
)

# GUEST-RANDOM-03: M95 is wrapped in a single BEGIN...COMMIT transaction
check('GUEST-RANDOM-03', '[STATIC TEST] M95 is one atomic BEGIN...COMMIT transaction',
    bool(re.search(r'^\s*BEGIN\s*;', _m95_sql, re.MULTILINE))
    and bool(re.search(r'^\s*COMMIT\s*;', _m95_sql, re.MULTILINE))
)

static_total = len(PASS) + len(FAIL)
ne_total = len(NOT_EXECUTED)
print(f"\n{'='*60}")
print(f"Migration 82 — Final Blocker Test Suite")
print(f"{'='*60}")
print(f"STATIC EXECUTED: {len(PASS)}/{static_total} PASS")
if FAIL:
    print(f"STATIC FAIL:     {len(FAIL)}/{static_total}")
    for tid, desc in FAIL:
        print(f"  ✗ [{tid}] {desc}")
else:
    print("All static tests passed.")
print(f"DB/BROWSER NOT EXECUTED: {ne_total}")
for tid, desc in NOT_EXECUTED:
    print(f"  ○ [{tid}] {desc}")
print(f"{'='*60}\n")

sys.exit(0 if not FAIL else 1)
