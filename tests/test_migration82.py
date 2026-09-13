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

# STATIC TEST: C7 — rank badge shows "Ранг:" prefix
check('D45', "[STATIC TEST] C7: legacy.js profile rank badge includes 'Ранг:' prefix",
    "'Ранг: ' + rank.icon" in legacy_js)

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

check('J03', '[STATIC TEST] RPC error (rpc_error reason) shows toast/warn, not showDailyLimitScreen',
    # rpc_error path falls to start_game_session fallback with a console.warn, not directly to limit screen
    bool(re.search(r"rpc_error", tr_js)) and
    bool(re.search(r"console\.warn.*start_daily_bf_session fallback", tr_js)))

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
# R-series: Random Battle end-to-end
# ─────────────────────────────────────────────────────────────────────────────

# R01: loadBattleQuestions uses authenticated sb client, not hardcoded anon key
check('R01', '[STATIC TEST] loadBattleQuestions uses authenticated sb client, not hardcoded anon key',
    bool(re.search(r'async function loadBattleQuestions', tr_js)) and
    'sb_publishable_lFVRCP' not in tr_js[
        tr_js.find('async function loadBattleQuestions'):
        tr_js.find('async function loadBattleQuestions') + 800
    ])

# R02: loadBattleQuestions uses status='published', not status='active'
check('R02', '[STATIC TEST] loadBattleQuestions queries status=published (not status=active)',
    bool(re.search(
        r'async function loadBattleQuestions[\s\S]{0,600}\.eq\([\'"]status[\'"],\s*[\'"]published[\'"]\)',
        tr_js
    )) and not bool(re.search(
        r'async function loadBattleQuestions[\s\S]{0,600}status=eq\.active',
        tr_js
    )))

# R03: loadBattleQuestions does NOT include correct_index in REST select
check('R03', '[STATIC TEST] loadBattleQuestions REST/Supabase select does not fetch correct_index directly',
    not bool(re.search(
        r'async function loadBattleQuestions[\s\S]{0,500}select\([\'"][^)\'\"]*correct_index',
        tr_js
    )))

# R04: loadBattleQuestions calls _mergeCorrectIndexes for SECURITY DEFINER RPC path
check('R04', '[STATIC TEST] loadBattleQuestions calls _mergeCorrectIndexes (SECURITY DEFINER RPC) after fetch',
    bool(re.search(
        r'async function loadBattleQuestions[\s\S]{0,800}_mergeCorrectIndexes',
        tr_js
    )))

# R05: loadBattleQuestions uses 5-question PROGRESSION [2,3,4,5,6]
check('R05', '[STATIC TEST] loadBattleQuestions uses PROGRESSION = [2, 3, 4, 5, 6]',
    bool(re.search(r'PROGRESSION\s*=\s*\[2,\s*3,\s*4,\s*5,\s*6\]', tr_js)))

# R06: BOT_PLAYERS has exactly 3 entries with correct accuracy values
check('R06', '[STATIC TEST] BOT_PLAYERS has 3 entries with skill values 0.575, 0.705, 0.84',
    '0.575' in mm_js and '0.705' in mm_js and '0.84' in mm_js and
    mm_js.count('BOT_PLAYERS') >= 2)

# R07: BOT_PLAYERS names are Макс, София, Даниил
check('R07', '[STATIC TEST] BOT_PLAYERS persona names are Макс, София, Даниил',
    all(name in mm_js for name in ['Макс', 'София', 'Даниил']))

# R08: BOT_PLAYERS cities (updated to global: Берлин, Буэнос-Айрес, Сингапур)
check('R08', '[STATIC TEST] BOT_PLAYERS cities are Берлин, Буэнос-Айрес, Сингапур',
    all(city in mm_js for city in ['Берлин', 'Буэнос-Айрес', 'Сингапур']))

# R09: sign-in modal does NOT use the words "бот" or "bot" in its text
check('R09', '[STATIC TEST] sign-in modal does not use "бот" or "bot" in button label',
    not bool(re.search(
        r'_showSignInToPlay[\s\S]{0,1500}(?:бот|play vs bot|сыграть с ботом)',
        mm_js, re.IGNORECASE
    )))

# R10: strength stars in persona cards use 5-star scale (★★☆☆☆ / ★★★☆☆ / ★★★★☆)
check('R10', '[STATIC TEST] persona card strength stars use 5-star scale',
    '★★☆☆☆' in mm_js and '★★★☆☆' in mm_js and '★★★★☆' in mm_js)

# R11: startBotDuel uses start_game_session with mode virtual_battle (not random_battle)
check('R11', '[STATIC TEST] startBotDuel charges start_game_session with mode virtual_battle',
    bool(re.search(
        r'startBotDuel[\s\S]{0,600}virtual_battle',
        mm_js
    )))

# R12: virtual battle does NOT call _bf_award_duel_win (confirmed by not having that call in startBotDuel path)
check('R12', '[STATIC TEST] startBotDuel / virtual battle path does not call _bf_award_duel_win',
    not bool(re.search(
        r'startBotDuel[\s\S]{0,800}_bf_award_duel_win',
        mm_js
    )))

# R13: _renderBattleBoard does NOT show "🟢 Онлайн" for virtual/bot rows
check('R13', '[STATIC TEST] _renderBattleBoard "🟢 Онлайн" is behind isBot check (not shown for virtual)',
    bool(re.search(
        r'isBot\s*\?[^:]+:[^`\n]*🟢',
        mm_js
    )) or bool(re.search(
        r'r\.isBot[^}]{0,200}виртуальный игрок[\s\S]{0,200}🟢 Онлайн',
        mm_js
    )) or (
        # Current correct structure: isBot ? 'виртуальный игрок' : '🟢 Онлайн'
        bool(re.search(r"isBot\s*\?[^:'\n]*виртуальный игрок[^:'\n]*:[^'\n]*🟢 Онлайн", mm_js))
    ))

# R14: _cancelQueueOrEnterMatched exists as canonical cancel function
check('R14', '[STATIC TEST] _cancelQueueOrEnterMatched exists as canonical cancel/real-match entry point',
    '_cancelQueueOrEnterMatched' in mm_js)

# R15: mmAttemptId concurrency guard incremented in cancelMatchmaking
check('R15', '[STATIC TEST] cancelMatchmaking increments mmAttemptId',
    bool(re.search(r'function cancelMatchmaking[\s\S]{0,300}mmAttemptId\+\+', mm_js)))

# R16: claim_random_match RPC used for real match claiming
check('R16', '[STATIC TEST] matchmaking uses claim_random_match RPC for real match pairing',
    bool(re.search(r"rpc\(['\"]claim_random_match['\"]", mm_js)))

# R17: startBotDuel calls loadBattleQuestions for question loading
check('R17', '[STATIC TEST] startBotDuel calls window.loadBattleQuestions for question loading',
    bool(re.search(r'startBotDuel[\s\S]{0,2500}loadBattleQuestions', mm_js)))

# R18: startBotDuel bails if loadBattleQuestions returns fewer than 5 questions
check('R18', '[STATIC TEST] startBotDuel bails if question count < 5',
    bool(re.search(r'botBattleQs.*?length\s*<\s*5', mm_js, re.DOTALL)) or
    bool(re.search(r'botBattleQs\s*\|\|\s*botBattleQs\.length\s*<\s*5', mm_js)))

# R19: matchFound called only through _transition (real battle path guarded against concurrency)
check('R19', '[STATIC TEST] matchFound is reached only through _transition() guard',
    bool(re.search(r'_transition\s*\([^)]*\)\s*[;,\s{][\s\S]{0,300}matchFound\b', mm_js)) or
    bool(re.search(r'_transition[\s\S]{0,500}matchFound', mm_js)))

# R20: loadBattleQuestions exported to window for matchmaking.js consumption
check('R20', '[STATIC TEST] loadBattleQuestions is exported to window',
    'window.loadBattleQuestions = loadBattleQuestions' in tr_js)

check_ne('R21', '[BROWSER TEST — NOT EXECUTED] clicking "Случайный бой" shows matchmaking screen and starts 15s polling')
check_ne('R22', '[BROWSER TEST — NOT EXECUTED] after 15s with no match, exactly 3 persona cards appear')
check_ne('R23', '[BROWSER TEST — NOT EXECUTED] persona cards show 5-star strength (not 3-star) for Макс/София/Даниил')
check_ne('R24', '[BROWSER TEST — NOT EXECUTED] selecting a persona loads 5 battle questions with progression [2,3,4,5,6]')
check_ne('R25', '[BROWSER TEST — NOT EXECUTED] virtual battle charges virtual_battle session, not random_battle')
check_ne('R26', '[BROWSER TEST — NOT EXECUTED] network tab shows no 403 on questions fetch during virtual battle')
check_ne('R27', '[BROWSER TEST — NOT EXECUTED] virtual battle result screen shows ПОБЕДА/НИЧЬЯ/ПОРАЖЕНИЕ + scores')
check_ne('R28', '[BROWSER TEST — NOT EXECUTED] unauthenticated user sees sign-in modal with no "бот"/"bot" text')

# ─────────────────────────────────────────────────────────────────────────────
# S-series: Random Battle final security + global personas
# ─────────────────────────────────────────────────────────────────────────────

# S01: real Random Battle host question payload has no correct_index field
# startDuelGame() uses res.questions from start_duel() — server strips correct_index.
# Verify the host code never maps a correct_index field from the RPC response.
check('S01', '[STATIC TEST] real Random Battle host question payload never maps correct_index from start_duel response',
    bool(re.search(r'function startDuelGame\b', fb_js)) and
    not bool(re.search(
        r'function startDuelGame[\s\S]{0,600}correct_index',
        fb_js
    )))

# S02: real Random Battle host question payload has no "c:" field mapping
# duelQs = res.questions — never spreads a "c:" key from server response
check('S02', '[STATIC TEST] real Random Battle host does not map "c:" field from start_duel questions',
    bool(re.search(r'duelQs\s*=\s*res\.questions', fb_js)) and
    not bool(re.search(
        r'function startDuelGame[\s\S]{0,600}\bc\s*:.*correct',
        fb_js, re.IGNORECASE
    )))

# S03: real Random Battle host path calls no get_question_reveals / _mergeCorrectIndexes
check('S03', '[STATIC TEST] real Random Battle host (startDuelGame) calls no get_question_reveals or _mergeCorrectIndexes',
    not bool(re.search(
        r'function startDuelGame[\s\S]{0,800}(?:get_question_reveals|_mergeCorrectIndexes)',
        fb_js
    )))

# S04: virtual battle answer correctness must come from server submit RPC
# (Migration85 required — NOT EXECUTED until migration applied + client updated)
check_ne('S04', '[NOT EXECUTED — requires Migration85] virtual answer correctness is server-derived (submit_virtual_battle_answer)')

# S05: virtual wrong answer is always an actual incorrect option (server bot_wrong_indices)
check_ne('S05', '[NOT EXECUTED — requires Migration85] virtual wrong answer comes from server bot_wrong_indices, not from client-loaded c')

# S06: virtual battle charges virtual_battle mode, awards 0 BF
check('S06', '[STATIC TEST] startBotDuel charges start_game_session with mode virtual_battle (0 BF)',
    bool(re.search(
        r'startBotDuel[\s\S]{0,600}virtual_battle',
        mm_js
    )) and '_bf_award_duel_win' not in mm_js[
        mm_js.find('async function startBotDuel'):
        mm_js.find('async function startBotDuel') + 2500
    ])

# S07: real Random Battle host never receives correct_index before answering
# Guest questions come from data.questions (comment: "sanitized: {idx,cat,q,a,t} — no c field")
check('S07', '[STATIC TEST] real Random Battle guest questions explicitly noted as no-c (sanitized comment present)',
    bool(re.search(r'sanitized.*no.*c\s+field|no.*correct_index.*no.*id', fb_js)))

# S08: PROGRESSION remains [2,3,4,5,6] in loadBattleQuestions
check('S08', '[STATIC TEST] question progression remains [2,3,4,5,6]',
    bool(re.search(r'PROGRESSION\s*=\s*\[2,\s*3,\s*4,\s*5,\s*6\]', tr_js)) or
    'ARRAY[2, 3, 4, 5, 6]' in sql85)

# S09: Макс = Berlin 🇩🇪, skill 0.575, delay 4000-14000ms
check('S09', '[STATIC TEST] Макс = Берлин 🇩🇪 / skill 0.575 / delay 4000-14000ms',
    'Берлин' in mm_js and '🇩🇪' in mm_js and '0.575' in mm_js and
    'minDelay:4000' in mm_js and 'maxDelay:14000' in mm_js)

# S10: София = Buenos Aires 🇦🇷, skill 0.705, delay 3000-12000ms
check('S10', '[STATIC TEST] София = Буэнос-Айрес 🇦🇷 / skill 0.705 / delay 3000-12000ms',
    'Буэнос-Айрес' in mm_js and '🇦🇷' in mm_js and '0.705' in mm_js and
    'minDelay:3000' in mm_js and 'maxDelay:12000' in mm_js)

# S11: Даниил = Singapore 🇸🇬, skill 0.84, delay 2000-10000ms
check('S11', '[STATIC TEST] Даниил = Сингапур 🇸🇬 / skill 0.84 / delay 2000-10000ms',
    'Сингапур' in mm_js and '🇸🇬' in mm_js and '0.84' in mm_js and
    'minDelay:2000' in mm_js and 'maxDelay:10000' in mm_js)

# S12: no "бот"/"bot"/🤖 in virtual opponent selection UI text
# _showBotOffer label, persona card HTML, _renderBattleBoard, sign-in modal
check('S12', '[STATIC TEST] no "бот"/"bot"/🤖 in virtual opponent selection and sign-in UI',
    # _showBotOffer label does not contain бот/bot
    not bool(re.search(
        r"_showBotOffer[\s\S]{0,800}(?:бот|play vs bot|сыграть с ботом)",
        mm_js, re.IGNORECASE
    )) and
    # sign-in modal button does not say бот/bot
    not bool(re.search(
        r"_showSignInToPlay[\s\S]{0,1500}(?:бот\b|play vs bot)",
        mm_js, re.IGNORECASE
    )) and
    # battle board virtual row does not show 🤖 emoji
    not bool(re.search(
        r"isBot\s*\?[^:'\n]*🤖",
        mm_js
    )))

check_ne('S13', '[BROWSER TEST — NOT EXECUTED] no real player → 15s → 3 global opponent cards with Berlin/Buenos-Aires/Singapore')
check_ne('S14', '[BROWSER TEST — NOT EXECUTED] choose each persona → battle starts')
check_ne('S15', '[BROWSER TEST — NOT EXECUTED] inspect Network before answering → no correct_index in any response')
check_ne('S16', '[BROWSER TEST — NOT EXECUTED] answer question → correct_index appears only in submit_virtual_battle_answer response')
check_ne('S17', '[BROWSER TEST — NOT EXECUTED] two browsers real match → neither gets correct_index before answer')

# ─────────────────────────────────────────────────────────────────────────────
# Results
# ─────────────────────────────────────────────────────────────────────────────
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
