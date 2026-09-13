// ── Daily Question ────────────────────────────────────────────────────
// One question per day from pack questions, seeded by date.
// Awards +25 neurons on correct answer.
//
// DISABLED (v1): direct REST queries on the questions table fail RLS for
// authenticated users. No safe server-side "pick daily question" RPC exists yet.
// The home teaser is hidden until a SECURITY DEFINER RPC is added in a future
// migration. get_question_reveals (p_ids) remains available for answer-time reveals.

export function isDailyDone() {
  return false; // teaser disabled — always report not done so callers don't cache
}

export async function loadDailyQuestion() {
  const el = document.getElementById('home-daily-teaser');
  if (el) el.style.display = 'none'; // hidden until safe RPC is available
}
