/**
 * Resolved configuration for the daily token aggregation.
 *
 * The plugin declares no `Config` export, so every value here has a safe
 * default and the loaded object is frozen. Nothing in this module touches the
 * filesystem; it only decides where to look.
 */

import os from 'node:os';
import path from 'node:path';

/** Environment variable naming the Harness home directory. */
const HOME_ENV = 'DSH_HOME';

/** Fallback home directory, matching the Harness default layout. */
const FALLBACK_HOME = path.join(os.homedir(), '.dsh');

/**
 * Resolve the Harness home directory the same way the process was launched.
 * @returns {string} absolute home directory.
 */
function resolveHome() {
  const fromEnv = process.env[HOME_ENV];
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return path.resolve(fromEnv.trim());
  return FALLBACK_HOME;
}

/** The Harness home directory that owns `sessions/`. */
export const HOME = resolveHome();

/** Directory holding one sub-directory per logical session. */
export const SESSIONS_DIR = path.join(HOME, 'sessions');

/** File names a durable session log may use, newest format first. */
export const LOG_FILE_NAMES = ['session.v4.jsonl.zstd', 'session.v4.jsonl', 'session.v3.jsonl.zstd'];

/**
 * Hard per-file decompression bound. A single session log stays far below
 * this; the bound only exists so a pathological file cannot exhaust memory.
 */
export const MAX_LOG_BYTES = 192 * 1024 * 1024;

/** Concurrency for the cold full scan. */
export const SCAN_CONCURRENCY = 4;

/**
 * A cached scan is reused while the directory and every known log keep the same
 * size/mtime signature. `stat` is much cheaper than decompressing.
 */
export const REFRESH_MIN_INTERVAL_MS = 1500;

/** Route path served through the shared `/api` fetch channel. */
export const ROUTE_PATH = '/api/dsh-token-heatmap/daily';

/** Aggregation defaults; documented in the README. */
export const DEFAULTS = Object.freeze({
  /** Count sessions whose header marks them as subagent runs. */
  includeSubagents: true,
  /** Days returned to the browser (a year plus the alignment tail). */
  windowDays: 371,
});
