/**
 * Host half of `dsh-token-heatmap`.
 *
 * Responsibilities, and deliberately nothing else:
 *
 * 1. Fold every durable session log in the Harness home into per-local-day token
 *    buckets (the numbers match the official Turn-usage disclosure because
 *    `tokens.js` mirrors its acceptance rules).
 * 2. Cache the fold and re-run it only when a log actually changed, decided by a
 *    stat-level signature rather than by polling contents.
 * 3. Serve that projection as read-only JSON on the shared `/api` fetch channel,
 *    which the browser half fetches. No session event is written and no service
 *    is replaced, so the plugin is inert with respect to the model.
 *
 * @module dsh-token-heatmap
 */

import { buildPayload, emptyPayload } from './aggregate.js';
import {
  DEFAULTS,
  REFRESH_MIN_INTERVAL_MS,
  ROUTE_PATH,
  SESSIONS_DIR,
} from './config.js';
import { currentSignature, scanSessions } from './scan.js';
import { dayKeyOfDate } from './tokens.js';

/** Services this plugin needs before it activates. */
export const inject = ['webServer', 'connection'];

/** JSON body type for the route. */
const JSON_TYPE = 'application/json; charset=utf-8';

/**
 * Build the daily-token cache and its refresh discipline.
 *
 * Exported so the refresh rules — the freshness window, the stat signature and the
 * day rollover — can be driven directly against a controlled root, without the
 * live corpus deciding the outcome.
 * @param options - cache inputs.
 * @param options.root - sessions directory.
 * @returns a cache handle.
 */
export function createCache(options) {
  const root = options.root ?? SESSIONS_DIR;
  const state = {
    payload: undefined,
    signature: undefined,
    // The local day the cached payload was built for. Everything date-derived in
    // it — which entry carries `today`, `range.to`, and where the 371-day window
    // ends — is only correct for that day.
    payloadDay: undefined,
    checkedMs: 0,
    pending: undefined,
    error: undefined,
  };

  /**
   * Rebuild the payload from a fresh full scan.
   * @returns the new payload.
   */
  async function rebuild() {
    const startedAt = Date.now();
    const result = await scanSessions({ root, includeSubagents: DEFAULTS.includeSubagents });
    const payload = buildPayload({
      days: result.days,
      windowDays: DEFAULTS.windowDays,
      now: startedAt,
      durationMs: Date.now() - startedAt,
      root,
      files: result.files,
      sessions: result.sessions,
      countedSamples: result.countedSamples,
      skippedSamples: result.skippedSamples,
    });
    payload.scan.unreadable = result.unreadable;
    state.payload = payload;
    state.signature = result.signature;
    // Bind the day to the instant the payload was built FOR, not to the moment the
    // scan happened to finish. A scan that spans midnight would otherwise be filed
    // under the new day while its `today` flag still marks the old one, and it
    // would then be treated as current until something else forced a rebuild.
    state.payloadDay = dayKeyOfDate(new Date(payload.generatedAt));
    state.checkedMs = Date.now();
    state.error = undefined;
    return payload;
  }

  /**
   * Return a payload no older than the freshness window.
   *
   * The cheap path is one directory walk plus `stat` per log; the expensive path
   * is a decompression pass, taken only when a size or mtime moved.
   * @param force - ignore the freshness window and always re-check.
   * @returns the payload to serve.
   */
  async function get(force = false) {
    const now = Date.now();
    // A cached payload is only valid for the local day it was built on. Nothing
    // else here notices a date change: with DSH left open overnight and no session
    // activity, no log's size or mtime moves, so the freshness window and the
    // signature both say "nothing changed" — while the payload's `today` flag,
    // `range.to` and window end all still describe yesterday. The client polls
    // forever and would show yesterday's tokens as today's, indefinitely.
    if (state.payload !== undefined && state.payloadDay !== dayKeyOfDate(new Date(now))) {
      force = true;
    }
    if (state.payload !== undefined && !force && now - state.checkedMs < REFRESH_MIN_INTERVAL_MS) {
      return state.payload;
    }
    if (state.pending !== undefined) return state.pending;

    state.pending = (async () => {
      try {
        if (state.payload !== undefined && !force) {
          const { signature } = await currentSignature(root);
          state.checkedMs = Date.now();
          if (signature === state.signature) return state.payload;
        }
        return await rebuild();
      } catch (error) {
        state.error = error;
        if (state.payload !== undefined) return state.payload;
        return emptyPayload(error);
      } finally {
        state.pending = undefined;
      }
    })();
    return state.pending;
  }

  /**
   * Drop the freshness window so the next read re-checks the corpus.
   * @returns nothing.
   */
  function invalidate() {
    state.checkedMs = 0;
  }

  return { get, invalidate, rebuild, state };
}

/**
 * Host plugin body.
 * @param ctx - the plugin's Cordis context.
 * @returns nothing.
 */
export function apply(ctx) {
  const cache = createCache({ root: SESSIONS_DIR });

  // Warm the cache once at activation so the first paint does not wait on a
  // cold decompression pass. Failure here is not fatal: a request retries it.
  void cache.get(true).catch(() => undefined);

  // Any committed session event may have moved today's number. Invalidate the
  // freshness window; the next request decides whether a rebuild is needed.
  ctx.effect(
    () => ctx.on('session/event', () => cache.invalidate()),
    'dsh-token-heatmap: session activity invalidation',
  );

  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: ROUTE_PATH,
      handler: async (req, res) => {
        // The route hangs off the shared `/api` prefix, so it applies the same
        // trust fence the rest of the API does rather than inventing its own.
        const rejection = ctx.connection.requestRejection({ headers: req.headers });
        if (rejection !== undefined) {
          res.writeHead(rejection);
          res.end(rejection === 401 ? 'unauthorized' : 'forbidden');
          return;
        }
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405, { 'content-type': JSON_TYPE, allow: 'GET, HEAD' });
          res.end(JSON.stringify({ error: 'method not allowed' }));
          return;
        }
        let body;
        try {
          const payload = await cache.get();
          body = JSON.stringify(payload);
        } catch (error) {
          res.writeHead(500, { 'content-type': JSON_TYPE });
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
          return;
        }
        res.writeHead(200, {
          'content-type': JSON_TYPE,
          'cache-control': 'no-store',
          'content-length': Buffer.byteLength(body),
        });
        res.end(req.method === 'HEAD' ? undefined : body);
      },
    }),
    'dsh-token-heatmap: daily route',
  );
}
