/**
 * Session-log reading: turn durable `session.v*.jsonl[.zstd]` files into daily
 * token buckets.
 *
 * The session log is the only source of truth, so this module never keeps state
 * of its own: it walks the Harness `sessions/` directory, decompresses each log
 * (concatenated Zstandard frames, one per append), and folds every
 * `assistant/message` event's usage into the local day the event happened on.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

import {
  LOG_FILE_NAMES,
  MAX_LOG_BYTES,
  SCAN_CONCURRENCY,
  SESSIONS_DIR,
} from './config.js';
import { accumulate, dayKeyOf, emptyCounts, normalizeUsage } from './tokens.js';

/** Zstandard frame magic, little-endian bytes as stored in the file. */
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

/**
 * Split a buffer into concatenated Zstandard frames.
 *
 * Node's zstd APIs decode exactly one frame, so a session log — one frame per
 * durable append — needs the frames located explicitly. A candidate boundary is
 * accepted only when the bytes before it actually decode, so a magic sequence
 * occurring inside compressed payload cannot truncate the log.
 * @param buffer - raw file bytes.
 * @returns frame boundaries as `[start, end)` pairs.
 */
function splitZstdFrames(buffer) {
  const starts = [];
  let from = 0;
  for (;;) {
    const found = buffer.indexOf(ZSTD_MAGIC, from);
    if (found === -1) break;
    starts.push(found);
    from = found + ZSTD_MAGIC.length;
  }
  if (starts.length === 0) return [[0, buffer.length]];

  const frames = [];
  let start = starts[0];
  for (let index = 1; index < starts.length; index += 1) {
    const candidate = starts[index];
    if (candidate <= start) continue;
    try {
      zlib.zstdDecompressSync(buffer.subarray(start, candidate));
      frames.push([start, candidate]);
      start = candidate;
    } catch {
      /* the magic sits inside the current frame's payload */
    }
  }
  frames.push([start, buffer.length]);
  return frames;
}

/**
 * Decompress a buffer that may hold many concatenated Zstandard frames.
 * @param buffer - raw file bytes.
 * @returns decompressed UTF-8 text.
 */
export function decompressAll(buffer) {
  if (buffer.length === 0) return '';
  // A plain `.jsonl` log is already text.
  if (buffer[0] === 0x7b /* '{' */ || buffer[0] === 0x0a) return buffer.toString('utf8');
  if (typeof zlib.zstdDecompressSync !== 'function') {
    throw new Error('node:zlib in this runtime has no Zstandard decompressor');
  }

  const chunks = [];
  for (const [start, end] of splitZstdFrames(buffer)) {
    try {
      chunks.push(zlib.zstdDecompressSync(buffer.subarray(start, end)));
    } catch {
      // The final frame is allowed to be torn: the writer was mid-append.
    }
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Read one session log file into its decompressed text.
 * @param file - absolute log path.
 * @returns decompressed text, or `undefined` when it cannot be read.
 */
async function readLogText(file) {
  let handle;
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_LOG_BYTES) return undefined;
    handle = await fs.open(file, 'r');
    const buffer = await handle.readFile();
    return await decompressAll(buffer);
  } catch {
    return undefined;
  } finally {
    if (handle !== undefined) {
      try {
        await handle.close();
      } catch {
        /* the read already decided the outcome */
      }
    }
  }
}

/**
 * One discovered session log.
 * @typedef {object} SessionLogFile
 * @property {string} file absolute path to the log.
 * @property {string} sessionId session identity from the header line.
 * @property {number} createdAt header creation time (epoch ms).
 * @property {number} size current byte size.
 * @property {number} mtimeMs current modification time.
 */

/**
 * Parse the header record of a decompressed log.
 * @param text - decompressed log text.
 * @returns header facts, or `undefined` when no header is present.
 */
function parseHeader(text) {
  const newline = text.indexOf('\n');
  const first = (newline === -1 ? text : text.slice(0, newline)).trim();
  if (first === '') return undefined;
  let record;
  try {
    record = JSON.parse(first);
  } catch {
    return undefined;
  }
  if (record === null || typeof record !== 'object' || record.type !== 'session') return undefined;
  return {
    sessionId: typeof record.id === 'string' ? record.id : '',
    createdAt: typeof record.createdAt === 'number' ? record.createdAt : 0,
    parentSession: typeof record.parentSession === 'string' ? record.parentSession : undefined,
    origin: typeof record.origin === 'string' ? record.origin : undefined,
    delegationDepth: typeof record.delegationDepth === 'number' ? record.delegationDepth : undefined,
    cwd: typeof record.cwd === 'string' ? record.cwd : undefined,
  };
}

/**
 * List every session log under the sessions root.
 *
 * The layout is `<root>/<workspace>/<session-id>/session.v*.jsonl[.zstd]`, and
 * older homes kept the log directly under the session directory, so the walk is
 * bounded rather than fixed-depth. A directory whose name already matches a
 * session id is not descended into twice.
 * @param root - sessions directory.
 * @returns discovered log files, oldest mtime first.
 */
export async function listSessionLogs(root = SESSIONS_DIR) {
  const files = [];
  const names = new Set(LOG_FILE_NAMES);

  /**
   * Collect log files under one directory.
   * @param dir - directory to read.
   * @param depth - remaining descent budget.
   * @returns nothing.
   */
  async function walk(dir, depth) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const subdirectories = [];
    for (const entry of entries) {
      if (names.has(entry.name)) {
        if (!entry.isFile()) continue;
        const file = path.join(dir, entry.name);
        try {
          const stat = await fs.stat(file);
          if (!stat.isFile() || stat.size === 0) continue;
          files.push({ file, size: stat.size, mtimeMs: stat.mtimeMs });
        } catch {
          /* the file vanished between readdir and stat */
        }
        continue;
      }
      if (depth > 0 && entry.isDirectory()) subdirectories.push(path.join(dir, entry.name));
    }
    for (const next of subdirectories) await walk(next, depth - 1);
  }

  await walk(root, 3);
  files.sort((a, b) => a.mtimeMs - b.mtimeMs);
  return files;
}

/**
 * Fold one decompressed log into per-step usage samples.
 *
 * One `(turn, step)` is one billed attempt series, so only its **last** usage
 * sample is kept: a retried or resumed Step reports cumulative usage, and the
 * official Turn-usage disclosure settles each attempt once. The retained sample
 * carries the event's own timestamp so the caller can bucket it by local day.
 * @param text - decompressed log text.
 * @returns the header and one sample per counted Step.
 */
export function foldLogText(text) {
  const lines = text.split('\n');
  let header;
  /** Step key to the newest retained sample for that step. */
  const steps = new Map();
  let skipped = 0;

  for (const line of lines) {
    if (line === '') continue;
    if (header === undefined) {
      header = parseHeader(`${line}\n`);
      continue;
    }
    // Cheap rejection before JSON.parse: most log lines are not usage events.
    if (!line.includes('assistant/message')) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      skipped += 1;
      continue;
    }
    if (event === null || typeof event !== 'object' || event.type !== 'assistant/message') continue;
    const data = event.data;
    const usage = data === null || typeof data !== 'object' ? undefined : data.usage;
    const normalized = normalizeUsage(usage);
    if (normalized === undefined) {
      skipped += 1;
      continue;
    }
    const turn = data.turn ?? '?';
    const step = data.step ?? '?';
    steps.set(`${turn}/${step}`, {
      turn,
      step,
      time: typeof event.time === 'number' ? event.time : header?.createdAt ?? Date.now(),
      usage: normalized,
    });
  }

  return { header, steps: [...steps.values()], skipped };
}

/**
 * Scan every session log into day buckets.
 * @param options - scan inputs.
 * @param options.root - sessions directory.
 * @param options.includeSubagents - count subagent sessions too.
 * @returns aggregated scan result.
 */
export async function scanSessions(options = {}) {
  const root = options.root ?? SESSIONS_DIR;
  const includeSubagents = options.includeSubagents ?? true;

  const files = await listSessionLogs(root);
  const buckets = new Map();
  const sessions = [];
  let skippedSamples = 0;
  let countedSamples = 0;
  let unreadable = 0;

  let cursor = 0;
  const workers = Array.from({ length: Math.min(SCAN_CONCURRENCY, Math.max(files.length, 1)) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= files.length) return;
      const entry = files[index];
      const text = await readLogText(entry.file);
      if (text === undefined) {
        unreadable += 1;
        continue;
      }
      const header = parseHeader(text);
      if (header === undefined) {
        unreadable += 1;
        continue;
      }
      const isSubagent = header.origin === 'subagent' || header.parentSession !== undefined;
      const localBuckets = new Map();
      const stats = foldLogText(text);
      for (const sample of stats.steps) {
        const key = dayKeyOf(sample.time);
        let bucket = localBuckets.get(key);
        if (bucket === undefined) {
          bucket = emptyCounts();
          localBuckets.set(key, bucket);
        }
        accumulate(bucket, sample.usage);
      }
      const sessionDays = [...localBuckets.keys()].sort();
      const sessionTokens = [...localBuckets.values()].reduce((sum, b) => sum + b.totalTokens, 0);

      if (includeSubagents || !isSubagent) {
        for (const [key, bucket] of localBuckets) {
          let target = buckets.get(key);
          if (target === undefined) {
            target = emptyCounts();
            buckets.set(key, target);
          }
          accumulate(target, bucket);
        }
        skippedSamples += stats.skipped;
        countedSamples += stats.steps.length;
      }

      sessions.push({
        sessionId: header.sessionId,
        createdAt: header.createdAt,
        cwd: header.cwd,
        subagent: isSubagent,
        counted: includeSubagents || !isSubagent,
        samples: stats.steps.length,
        skipped: stats.skipped,
        tokens: sessionTokens,
        days: sessionDays,
        bytes: entry.size,
        mtimeMs: entry.mtimeMs,
      });
    }
  });
  await Promise.all(workers);

  return {
    root,
    files: files.length,
    unreadable,
    sessions,
    days: buckets,
    countedSamples,
    skippedSamples,
    signature: signatureOf(files),
  };
}

/**
 * Build the cache signature of a log listing.
 * @param files - discovered logs.
 * @returns a stable string that changes whenever a log grows or is rewritten.
 */
export function signatureOf(files) {
  return files.map((f) => `${f.file}:${f.size}:${Math.round(f.mtimeMs)}`).join('|');
}

/**
 * Statistic-only signature used to decide whether a cached scan is still fresh.
 * @param root - sessions directory.
 * @returns the signature plus the file listing.
 */
export async function currentSignature(root = SESSIONS_DIR) {
  const files = await listSessionLogs(root);
  return { signature: signatureOf(files), files };
}
