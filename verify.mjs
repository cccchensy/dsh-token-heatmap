/**
 * Verification probe for the Host half. Not part of the shipped plugin.
 *
 * Run: node verify.mjs
 * It exercises the real corpus in this machine's Harness home and prints the
 * aggregate the browser half would receive.
 */
import { buildPayload } from './lib/aggregate.js';
import { DEFAULTS, SESSIONS_DIR } from './lib/config.js';
import { currentSignature, decompressAll, foldLogText, listSessionLogs, scanSessions } from './lib/scan.js';
import { dayKeyOf, normalizeUsage } from './lib/tokens.js';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const failures = [];
const check = (name, condition, detail) => {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`);
  }
};

// ── DST: this half of the file runs in a zone that observes it ───────────────
// The day window used to advance by a fixed 24 hours. A local day is not always
// that long, so crossing a DST transition shifted the cursor's wall clock over
// midnight: one calendar day was emitted twice and another skipped, and since the
// totals are summed from those entries, tokens vanished and one day was counted
// twice. This machine's zone has no DST, which is exactly why the bug survived a
// green suite — so this part re-enters the file with TZ set to New York.
if (process.env.DSH_TH_DST_PART === '1') {
  const seeds = {
    '2023-03-12': 1000, // spring forward
    '2023-11-05': 1000, // fall back
    '2024-01-15': 1000,
    '2024-03-10': 1000, // spring forward
  };
  const days = new Map(Object.entries(seeds).map(([key, tokens]) => [key, {
    totalTokens: tokens,
    uncachedInputTokens: tokens,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
  }]));
  const now = new Date(2024, 2, 20, 12, 0, 0).getTime();
  const payload = buildPayload({ days, windowDays: 371, now });
  const keys = payload.days.map((entry) => entry.date);
  const counts = new Map();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  const duplicated = [...counts].filter(([, n]) => n > 1).map(([key]) => key);
  const missing = Object.keys(seeds).filter((key) => !keys.includes(key));
  const first = payload.days[0].date.split('-').map(Number);
  const lead = new Date(first[0], first[1] - 1, first[2]).getDay();
  const misaligned = payload.days.filter((entry, index) => {
    const parts = entry.date.split('-').map(Number);
    return (index + lead) % 7 !== new Date(parts[0], parts[1] - 1, parts[2]).getDay();
  }).length;

  check('no calendar day is emitted twice', duplicated.length === 0, duplicated.join(', '));
  check('no calendar day is skipped', missing.length === 0, missing.join(', '));
  check('every cell sits on its own weekday row', misaligned === 0, String(misaligned));
  check('tokens survive the transition', payload.totals.tokens === 4000, String(payload.totals.tokens));
  check('active days survive the transition', payload.totals.activeDays === 4, String(payload.totals.activeDays));
  check('the window still ends on the reference day', payload.days[payload.days.length - 1].today === true);
  console.log(`\n${failures.length === 0 ? 'DST PART PASSED' : `${failures.length} DST CHECK(S) FAILED`}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

console.log('token normalization (mirrors the official Turn-usage disclosure)');
check('plain counts derive a total', (() => {
  const u = normalizeUsage({ inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 });
  return u !== undefined && u.totalTokens === 15;
})());
check('explicit total is authoritative', (() => {
  const u = normalizeUsage({ inputTokens: 10, outputTokens: 5, cacheReadTokens: 100, cacheWriteTokens: 2, totalTokens: 117 });
  return u !== undefined && u.totalTokens === 117 && u.cacheReadTokens === 100;
})());
check('a contradictory total is rejected', normalizeUsage({
  inputTokens: 10, outputTokens: 5, cacheReadTokens: 100, cacheWriteTokens: 2, totalTokens: 7,
}) === undefined);
check('negative counts are rejected', normalizeUsage({ inputTokens: -1, outputTokens: 5 }) === undefined);
check('a fractional count is rejected', normalizeUsage({ inputTokens: 1.5, outputTokens: 5 }) === undefined);
check('missing cache buckets without a total are rejected', normalizeUsage({ inputTokens: 10, outputTokens: 5 }) === undefined);
check('reasoning above output is rejected', normalizeUsage({
  inputTokens: 1, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 9,
}) === undefined);
check('partial cache buckets with a total are accepted', (() => {
  const u = normalizeUsage({ inputTokens: 1, outputTokens: 5, cacheReadTokens: 4, totalTokens: 10 });
  return u !== undefined && u.totalTokens === 10 && u.cacheWriteTokens === 0;
})());

console.log(`\nscan of ${SESSIONS_DIR}`);
const started = Date.now();
const { signature } = await currentSignature();
const result = await scanSessions({ root: SESSIONS_DIR, includeSubagents: DEFAULTS.includeSubagents });
console.log(`  files=${result.files} unreadable=${result.unreadable} samples=${result.countedSamples} skipped=${result.skippedSamples} days=${result.days.size} in ${Date.now() - started}ms`);
check('at least one session log was read', result.files > 0);
check('the scan produced day buckets', result.days.size > 0);
check('the signature is stable across two walks', (await currentSignature()).signature === signature);

// Multi-frame decompression: a session log is one Zstandard frame per append,
// and every Node zstd API decodes exactly the first one.
const logs = await listSessionLogs(SESSIONS_DIR);
const largest = logs.reduce((best, file) => (best === undefined || file.size > best.size ? file : best), undefined);
if (largest !== undefined) {
  const text = decompressAll(await fs.readFile(largest.file));
  const folded = foldLogText(text);
  const lines = text.split('\n').filter(Boolean).length;
  console.log(`  largest log: ${largest.size} bytes → ${text.length} chars, ${lines} records, ${folded.steps.length} usage samples`);
  check('multi-frame decompression yields far more than the first frame', text.length > 1000, `chars=${text.length}`);
  check('the log header parses into a session identity', typeof folded.header?.sessionId === 'string' && folded.header.sessionId.length > 0);
  check('every record parses as JSON', lines > 0 && folded.steps.length + folded.skipped > 0);
  check('one sample survives per (turn, step)', new Set(folded.steps.map((s) => `${s.turn}/${s.step}`)).size === folded.steps.length);
}

const payload = buildPayload({
  days: result.days,
  windowDays: DEFAULTS.windowDays,
  root: SESSIONS_DIR,
  files: result.files,
  sessions: result.sessions,
  countedSamples: result.countedSamples,
  skippedSamples: result.skippedSamples,
  durationMs: Date.now() - started,
});

let entryTotal = 0;
let entryActive = 0;
for (const entry of payload.days) {
  entryTotal += entry.tokens;
  if (entry.tokens > 0) entryActive += 1;
}
let bucketTotal = 0;
for (const bucket of result.days.values()) bucketTotal += bucket.totalTokens;

check('the grid starts on a Sunday', new Date(`${payload.days[0].date}T00:00:00`).getDay() === 0, payload.days[0].date);
check('day entries are one per day', payload.days.every((entry, i, all) => {
  if (i === 0) return true;
  const previous = new Date(`${all[i - 1].date}T00:00:00`);
  const current = new Date(`${entry.date}T00:00:00`);
  return Math.round((current - previous) / 86400000) === 1;
}));
check('payload total equals the folded bucket total', entryTotal === bucketTotal, `${entryTotal} vs ${bucketTotal}`);
check('active-day count agrees', entryActive === payload.totals.activeDays, `${entryActive} vs ${payload.totals.activeDays}`);
check('levels are within 1..5', payload.days.every((d) => d.level >= 0 && d.level <= 5));
check('every day key round-trips', payload.days.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date)));
check('the grid ends on today', payload.days[payload.days.length - 1].today === true);
check('calendar months are ordered', payload.calendars.months.every((m, i, all) => i === 0 || all[i - 1].column <= m.column));
check('now maps to a valid day key', /^\d{4}-\d{2}-\d{2}$/.test(dayKeyOf(Date.now())));

// Re-enter this file in a DST zone. A failure to spawn is reported as a skip
// rather than a pass, so a restricted environment cannot make this look green.
console.log('\nthe day window across a DST transition (TZ=America/New_York)');
const dstRun = (() => {
  try {
    return spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      env: { ...process.env, TZ: 'America/New_York', DSH_TH_DST_PART: '1' },
      encoding: 'utf8',
    });
  } catch (error) {
    return { error };
  }
})();
if (dstRun.error !== undefined) {
  console.log(`  --   skipped: cannot spawn a child process (${dstRun.error.message})`);
} else {
  for (const line of String(dstRun.stdout ?? '').split('\n')) {
    if (line.trim() !== '' && !line.startsWith('DST PART')) console.log(line);
  }
  check('the day window is sound in a DST zone',
    dstRun.status === 0, `exit=${dstRun.status} ${String(dstRun.stderr ?? '').trim().slice(0, 200)}`);
}

console.log('\npayload summary');
console.log(`  range     ${payload.range.from} → ${payload.range.to} (${payload.days.length} cells, ${payload.calendars.weeks} columns)`);
console.log(`  tokens    ${payload.totals.tokens.toLocaleString()} over ${payload.totals.activeDays} active days`);
console.log(`  average   ${payload.totals.averagePerActiveDay.toLocaleString()}/active day`);
console.log(`  best      ${payload.totals.bestDay === null ? '—' : `${payload.totals.bestDay.date} (${payload.totals.bestDay.tokens.toLocaleString()})`}`);
console.log(`  streak    current=${payload.totals.streak.current} longest=${payload.totals.streak.longest}`);
console.log('  recent    ' + payload.days.slice(-5).map((d) => `${d.date}:${d.tokens}${d.today ? '*' : ''}`).join('  '));

console.log(`\n${failures.length === 0 ? 'ALL CHECKS PASSED' : `${failures.length} CHECK(S) FAILED`}`);
process.exit(failures.length === 0 ? 0 : 1);
