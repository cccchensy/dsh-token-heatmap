/**
 * Payload shape shared with the browser half.
 *
 * The Host computes everything the heatmap needs — day buckets, the contiguous
 * window, streaks and per-bucket maxima, plus an intensity level per day — so
 * the Client renders rather than folds. Levels are assigned from the bucket
 * maxima by rank, which makes the palette self-calibrating instead of tied to
 * fixed thresholds that a heavy or a light week would both saturate.
 */

import { DEFAULTS } from './config.js';
import { dateOfDayKey, dayKeyOfDate, emptyCounts } from './tokens.js';

/**
 * Nominal day length, deliberately not used to advance the day window.
 *
 * A local day is not always this long: stepping the cursor by a fixed 24 hours
 * across a DST transition shifts its wall clock by an hour, which duplicates one
 * calendar day and skips another. The window advances with `setDate` instead.
 */

/**
 * Build the wire payload.
 * @param options - aggregation inputs.
 * @param options.days - day key to accumulator.
 * @param options.windowDays - how many days to include.
 * @param options.now - reference instant (defaults to `Date.now()`).
 * @param options.root - sessions directory reported for diagnostics.
 * @param options.files - number of scanned logs.
 * @param options.countedSamples - usage samples accepted.
 * @param options.skippedSamples - usage samples rejected.
 * @param options.sessions - per-session scan rows.
 * @param options.startedAt - scan start time.
 * @returns the JSON-serializable payload.
 */
export function buildPayload(options) {
  const windowDays = options.windowDays ?? DEFAULTS.windowDays;
  const now = options.now ?? Date.now();
  const days = options.days ?? new Map();

  const todayKey = dayKeyOfDate(new Date(now));
  // Step in CALENDAR days, never in fixed 24-hour blocks.
  //
  // A local day is not always 86400000ms long. `now - n * DAY_MS` and
  // `cursor + DAY_MS` do arithmetic on instants, so crossing a DST transition
  // shifts the cursor's wall clock by an hour and can push it over local midnight:
  // one calendar day is then emitted twice and another is skipped outright. Those
  // entries are what the totals are summed from, so tokens silently disappear and
  // one day's usage is counted twice. `setDate` asks the calendar instead.
  const firstDate = new Date(now);
  firstDate.setDate(firstDate.getDate() - (windowDays - 1));
  firstDate.setHours(0, 0, 0, 0);
  // Align the window start to the locale week so the grid columns are whole weeks.
  const firstWeekday = firstDate.getDay();
  const gridStart = new Date(firstDate);
  gridStart.setDate(gridStart.getDate() - firstWeekday);

  /** @type {Array<object>} */
  const entries = [];
  const activeTotals = [];
  let totalTokens = 0;
  let activeDays = 0;
  let bestKey;
  let bestTokens = -1;

  for (const cursor = new Date(gridStart); cursor.getTime() <= now; cursor.setDate(cursor.getDate() + 1)) {
    const key = dayKeyOfDate(cursor);
    const bucket = days.get(key);
    const tokens = bucket === undefined ? 0 : bucket.totalTokens;
    const entry = {
      date: key,
      tokens,
      uncachedInputTokens: bucket === undefined ? 0 : bucket.uncachedInputTokens,
      outputTokens: bucket === undefined ? 0 : bucket.outputTokens,
      cacheReadTokens: bucket === undefined ? 0 : bucket.cacheReadTokens,
      cacheWriteTokens: bucket === undefined ? 0 : bucket.cacheWriteTokens,
      reasoningTokens: bucket === undefined ? 0 : bucket.reasoningTokens,
      level: 0,
      today: key === todayKey,
    };
    totalTokens += tokens;
    if (tokens > 0) {
      activeDays += 1;
      activeTotals.push(tokens);
      if (tokens > bestTokens) {
        bestTokens = tokens;
        bestKey = key;
      }
    }
    entries.push(entry);
  }

  assignLevels(entries, activeTotals);

  const duration = options.durationMs ?? 0;
  return {
    version: 1,
    timeZone: resolveTimeZone(),
    unit: 'tokens',
    generatedAt: now,
    windowDays,
    range: {
      from: entries.length === 0 ? todayKey : entries[0].date,
      to: todayKey,
    },
    totals: {
      tokens: totalTokens,
      activeDays,
      averagePerActiveDay: activeDays === 0 ? 0 : Math.round(totalTokens / activeDays),
      bestDay: bestKey === undefined ? null : { date: bestKey, tokens: Math.max(bestTokens, 0) },
      streak: streaks(entries),
    },
    days: entries,
    scan: {
      sessionsDir: options.root,
      files: options.files ?? 0,
      sessions: (options.sessions ?? []).length,
      countedSamples: options.countedSamples ?? 0,
      skippedSamples: options.skippedSamples ?? 0,
      durationMs: duration,
    },
    calendars: calendars(entries),
  };
}

/**
 * Resolve the process time zone name for display.
 * @returns an IANA zone name, or a UTC-offset fallback.
 */
function resolveTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Assign intensity levels by rank over the active days.
 *
 * Level 0 is "no usage"; levels 1..5 are quintiles of the *observed* active
 * days, so the ramp stays readable whatever the user's scale is.
 * @param entries - payload day entries (mutated).
 * @param activeTotals - tokens of every active day.
 * @returns nothing.
 */
function assignLevels(entries, activeTotals) {
  if (activeTotals.length === 0) return;
  const sorted = [...activeTotals].sort((a, b) => a - b);
  const quantile = (fraction) => {
    const index = Math.min(sorted.length - 1, Math.max(0, Math.round(fraction * (sorted.length - 1))));
    return sorted[index];
  };
  const thresholds = [quantile(0.2), quantile(0.4), quantile(0.6), quantile(0.8)];
  for (const entry of entries) {
    if (entry.tokens <= 0) continue;
    let level = 1;
    for (const threshold of thresholds) {
      if (entry.tokens > threshold) level += 1;
    }
    entry.level = Math.min(5, level);
  }
}

/**
 * Current and longest consecutive active-day streaks.
 * @param entries - ordered day entries.
 * @returns streak facts.
 */
function streaks(entries) {
  let longest = 0;
  let running = 0;
  let current = 0;
  let seenToday = false;
  let cursorStreak = 0;

  for (const entry of entries) {
    if (entry.tokens > 0) {
      running += 1;
      longest = Math.max(longest, running);
    } else {
      running = 0;
    }
  }

  // Walk backwards from the last day for the current streak; a day with no
  // usage yet today does not break yesterday's streak.
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.tokens > 0) {
      cursorStreak += 1;
      if (entry.today) seenToday = true;
      continue;
    }
    if (entry.today && !seenToday) continue;
    break;
  }
  current = cursorStreak;

  return { current, longest };
}

/**
 * Month captions and weekday headers for the grid.
 *
 * Captions are rotated rather than drawn for every month: a caption is skipped
 * when its month starts too soon after the previous caption, which happens for
 * the two partial months at the window's edges. The renderer spaces them by
 * text width on top of that.
 * @param entries - ordered day entries.
 * @returns calendar facts for the Client.
 */
function calendars(entries) {
  const months = [];
  const weekdays = [];
  let lastMonth = -1;
  let lastCaptionColumn = -Infinity;
  let column = 0;
  let lastDate = null;
  let maxLabelChars = 3;
  for (const entry of entries) {
    const date = dateOfDayKey(entry.date);
    if (lastDate !== null && date.getDay() === 0) column += 1;
    if (date.getMonth() !== lastMonth) {
      lastMonth = date.getMonth();
      const label = monthLabel(date);
      // Skip a caption that would collide with the one before it.
      if (column - lastCaptionColumn >= 3) {
        months.push({ column, label });
        lastCaptionColumn = column;
        maxLabelChars = Math.max(maxLabelChars, label.length);
      }
    }
    lastDate = date;
  }
  for (let day = 0; day < 7; day += 1) {
    // Every row is labelled, Sunday included: a blank first label reads as a
    // missing glyph rather than as "Sunday".
    weekdays.push(weekdayLabel(day));
  }
  return { weeks: column + 1, months, weekdays, maxLabelChars };
}

/**
 * Short month label in the active locale.
 * @param date - any date inside the month.
 * @returns the label.
 */
function monthLabel(date) {
  try {
    return new Intl.DateTimeFormat(undefined, { month: 'short' }).format(date);
  } catch {
    return `${date.getMonth() + 1}`;
  }
}

/**
 * Short weekday label in the active locale.
 * @param day - `Date#getDay()` value.
 * @returns the label.
 */
function weekdayLabel(day) {
  // 2024-01-07 is a Sunday, so adding the weekday index lands on that weekday.
  const date = new Date(2024, 0, 7 + day);
  try {
    return new Intl.DateTimeFormat(undefined, { weekday: 'narrow' }).format(date);
  } catch {
    return '';
  }
}

/**
 * Convenience wrapper: empty payload for an unreadable corpus.
 * @param error - the failure to report.
 * @returns a payload carrying no days.
 */
export function emptyPayload(error) {
  const payload = buildPayload({ days: new Map(), files: 0, sessions: [] });
  payload.error = error instanceof Error ? error.message : String(error);
  payload.days = [];
  payload.totals = {
    tokens: 0,
    activeDays: 0,
    averagePerActiveDay: 0,
    bestDay: null,
    streak: { current: 0, longest: 0 },
  };
  return payload;
}

export { emptyCounts };
