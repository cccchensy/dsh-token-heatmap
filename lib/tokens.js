/**
 * Token accounting shared by the Host aggregation and its tests.
 *
 * This module is the single authority on *what a token count means*. It mirrors
 * the official DSH Turn-usage disclosure (`TurnUsagePanel` +
 * `deriveTurnTokenUsage` in `@deepseek-ai/dsh-client-ui-chat`) so the heatmap
 * reports the same number a user reads on a finished Turn:
 *
 * 1. A `TokenUsage` sample is accepted only when its counts are safe integers
 *    and internally consistent (`normalizeUsage`).
 * 2. `totalTokens` is authoritative when present and must be at least the known
 *    prompt size; otherwise it is derived from the prompt plus output.
 * 3. One `assistant/message` event is one billed attempt, so a day's usage is
 *    the sum of every such event's normalized total.
 */

/** Largest count accepted, matching the official `isCount` guard. */
const MAX_TOKEN_COUNT = Number.MAX_SAFE_INTEGER;

/**
 * Whether a value is a usable token count.
 * @param value - candidate count.
 * @returns true when the value is a non-negative safe integer.
 */
export function isCount(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Sum counts without losing the "unknown" signal.
 * @param values - candidate counts.
 * @returns the sum, or `undefined` when any element is not a count.
 */
export function safeSum(values) {
  let total = 0;
  for (const value of values) {
    if (!isCount(value)) return undefined;
    total += value;
    if (total > MAX_TOKEN_COUNT) return undefined;
  }
  return total;
}

/**
 * Raw usage buckets before normalization.
 * @typedef {object} RawUsage
 * @property {unknown} [inputTokens] uncached prompt tokens.
 * @property {unknown} [outputTokens] generated tokens.
 * @property {unknown} [totalTokens] provider-reported total.
 * @property {unknown} [cacheReadTokens] prompt tokens served from cache.
 * @property {unknown} [cacheWriteTokens] prompt tokens written to cache.
 * @property {unknown} [reasoningTokens] reasoning tokens inside the output.
 */

/**
 * Normalized usage buckets.
 * @typedef {object} NormalizedUsage
 * @property {number} uncachedInputTokens prompt tokens that missed the cache.
 * @property {number} outputTokens generated tokens, reasoning included.
 * @property {number} cacheReadTokens prompt tokens read from cache (0 when unknown).
 * @property {number} cacheWriteTokens prompt tokens written to cache (0 when unknown).
 * @property {number} totalTokens billed total for the attempt.
 * @property {number} [reasoningTokens] reasoning subset of the output.
 */

/**
 * Normalize one usage sample under the official acceptance rules.
 * @param usage - raw usage object from a session event.
 * @returns normalized buckets, or `undefined` when the sample cannot be trusted.
 */
export function normalizeUsage(usage) {
  if (usage === null || typeof usage !== 'object') return undefined;
  const {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens,
    totalTokens,
  } = /** @type {RawUsage} */ (usage);

  if (!isCount(inputTokens) || !isCount(outputTokens)) return undefined;
  if (cacheReadTokens !== undefined && !isCount(cacheReadTokens)) return undefined;
  if (cacheWriteTokens !== undefined && !isCount(cacheWriteTokens)) return undefined;
  if (reasoningTokens !== undefined && (!isCount(reasoningTokens) || reasoningTokens > outputTokens)) {
    return undefined;
  }

  const knownPrompt = safeSum([
    inputTokens,
    ...(cacheReadTokens === undefined ? [] : [cacheReadTokens]),
    ...(cacheWriteTokens === undefined ? [] : [cacheWriteTokens]),
  ]);
  if (knownPrompt === undefined) return undefined;

  let total;
  if (totalTokens !== undefined) {
    if (!isCount(totalTokens)) return undefined;
    const exactPrompt = totalTokens - outputTokens;
    if (!isCount(exactPrompt) || exactPrompt < knownPrompt) return undefined;
    if (
      cacheReadTokens !== undefined
      && cacheWriteTokens !== undefined
      && exactPrompt !== knownPrompt
    ) {
      return undefined;
    }
    total = totalTokens;
  } else {
    if (cacheReadTokens === undefined || cacheWriteTokens === undefined) return undefined;
    const derived = safeSum([knownPrompt, outputTokens]);
    if (derived === undefined) return undefined;
    total = derived;
  }

  return {
    uncachedInputTokens: inputTokens,
    outputTokens,
    cacheReadTokens: cacheReadTokens ?? 0,
    cacheWriteTokens: cacheWriteTokens ?? 0,
    totalTokens: total,
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
  };
}

/**
 * Add normalized usage into an accumulator in place.
 * @param target - mutable bucket totals.
 * @param usage - normalized usage to add.
 * @returns the same accumulator.
 */
export function accumulate(target, usage) {
  target.totalTokens += usage.totalTokens;
  target.uncachedInputTokens += usage.uncachedInputTokens;
  target.outputTokens += usage.outputTokens;
  target.cacheReadTokens += usage.cacheReadTokens;
  target.cacheWriteTokens += usage.cacheWriteTokens;
  target.reasoningTokens += usage.reasoningTokens ?? 0;
  return target;
}

/**
 * Create an empty accumulator.
 * @returns zeroed bucket totals.
 */
export function emptyCounts() {
  return {
    totalTokens: 0,
    uncachedInputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
  };
}

/**
 * Local calendar day key (`YYYY-MM-DD`) for an epoch-millisecond timestamp.
 *
 * The key is derived from the machine's local time so a "day" matches the day
 * the user worked, not a UTC boundary.
 * @param timeMs - epoch milliseconds.
 * @returns the local day key.
 */
export function dayKeyOf(timeMs) {
  const date = new Date(timeMs);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Local day key for a `Date`.
 * @param date - local date.
 * @returns the local day key.
 */
export function dayKeyOfDate(date) {
  return dayKeyOf(date.getTime());
}

/**
 * Parse a day key back into a local `Date` at midnight.
 * @param key - `YYYY-MM-DD`.
 * @returns the local midnight date.
 */
export function dateOfDayKey(key) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}
