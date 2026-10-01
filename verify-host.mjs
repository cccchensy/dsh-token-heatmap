/**
 * End-to-end probe for the Host plugin surface: it mounts the plugin against a
 * stub Cordis context, then drives the registered route with real Node HTTP
 * requests. Not part of the shipped plugin.
 *
 * Run: node verify-host.mjs
 */

import http from 'node:http';
import { mkdtemp, readFile, readdir, rm, stat, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as plugin from './lib/index.js';
import { SESSIONS_DIR } from './lib/config.js';

/** One day in milliseconds, for the clock-driven cache checks. */
const DAY = 24 * 60 * 60 * 1000;

/**
 * Find session logs, bounded in depth so a deep tree cannot stall the probe.
 * @param root - directory to search.
 * @param depth - remaining depth.
 * @returns absolute log paths.
 */
async function findSessionLogs(root, depth = 3) {
  if (depth < 0) return [];
  const found = [];
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) found.push(...await findSessionLogs(full, depth - 1));
    else if (entry.name.endsWith('.jsonl.zstd')) found.push(full);
  }
  return found;
}

const failures = [];
const check = (name, condition, detail) => {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`);
  }
};

/** Routes registered by the plugin under test. */
const routes = [];
/** Effect labels registered by the plugin under test. */
const effects = [];
/** Session-event listeners registered by the plugin under test. */
let eventListener;
/** Whether requests are admitted. */
let admit = true;

const ctx = {
  effect(callback, label) {
    effects.push(label);
    const disposer = callback();
    return typeof disposer === 'function' ? disposer : () => {};
  },
  on(name, listener) {
    if (name === 'session/event') eventListener = listener;
    return () => {};
  },
  webServer: {
    register(route) {
      routes.push(route);
      return () => {
        const index = routes.indexOf(route);
        if (index >= 0) routes.splice(index, 1);
      };
    },
  },
  connection: {
    requestRejection() {
      return admit ? undefined : 401;
    },
  },
};

plugin.apply(ctx);

check('the plugin declares webServer and connection', Array.isArray(plugin.inject)
  && plugin.inject.includes('webServer')
  && plugin.inject.includes('connection'), JSON.stringify(plugin.inject));
check('exactly one route is registered', routes.length === 1, `count=${routes.length}`);
const route = routes[0];
check('the route is exact and under /api', route?.kind === 'exact' && route?.path === '/api/dsh-token-heatmap/daily', String(route?.path));
check('the plugin subscribes to session events for liveness', typeof eventListener === 'function');
check('the plugin warms its cache in an effect', effects.some((label) => String(label).includes('dsh-token-heatmap')),
  JSON.stringify(effects));

/**
 * Drive one request through the registered node-http handler.
 * @param server - server owning the handler.
 * @param path - request path.
 * @param method - HTTP method.
 * @returns status, headers, and body.
 */
function drive(server, path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const request = http.request({ host: '127.0.0.1', port: address.port, path, method }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    request.on('error', reject);
    request.end();
  });
}

const server = http.createServer((req, res) => {
  const handled = route.handler(req, res);
  if (handled !== undefined) handled.catch((error) => {
    res.writeHead(500);
    res.end(String(error));
  });
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

const ok = await drive(server, route.path);
check('a GET returns 200 JSON', ok.status === 200 && ok.headers['content-type']?.startsWith('application/json'), `${ok.status} ${ok.headers['content-type']}`);
// `route.path` is pinned to a literal at the top of this file, so a misspelled
// constant cannot agree with itself here. What no check covered is that the
// browser half fetches the SAME path the host half serves: the two live in
// separate files, and a mismatch between them is a window that never loads.
const clientSource = await readFile(new URL('./lib/client.js', import.meta.url), 'utf8');
const clientEndpoint = /var ENDPOINT = '([^']+)'/.exec(clientSource)?.[1];
check('the path the client fetches is the path the host serves',
  clientEndpoint !== undefined && clientEndpoint === route.path,
  `client=${clientEndpoint} host=${route.path}`);
check('a polled response is never cached by the browser',
  ok.headers['cache-control'] === 'no-store', String(ok.headers['cache-control']));
check('the declared length matches the body',
  Number(ok.headers['content-length']) === Buffer.byteLength(ok.body),
  `${ok.headers['content-length']} vs ${Buffer.byteLength(ok.body)}`);

let payload;
try {
  payload = JSON.parse(ok.body);
} catch (error) {
  check('the body is valid JSON', false, String(error));
}
if (payload !== undefined) {
  check('the payload carries the day grid', Array.isArray(payload.days) && payload.days.length > 0, `days=${payload.days?.length}`);
  check('the payload reports totals', typeof payload.totals?.tokens === 'number' && payload.totals.tokens > 0,
    String(payload.totals?.tokens));
  check('the payload ends on today', payload.days[payload.days.length - 1].today === true);
  check('the payload declares its time zone', typeof payload.timeZone === 'string' && payload.timeZone.length > 0);
  check('the payload reports how many logs were scanned', payload.scan?.files > 0, JSON.stringify(payload.scan));
  check('every day carries a level in 0..5', payload.days.every((day) => day.level >= 0 && day.level <= 5));
  console.log(`\n  route responded: ${payload.totals.tokens.toLocaleString()} tokens over ${payload.totals.activeDays} active days, ${payload.scan.files} logs, ${payload.scan.countedSamples} samples, ${payload.scan.durationMs}ms`);
}

const head = await drive(server, route.path, 'HEAD');
check('a HEAD returns 200 with no body', head.status === 200 && head.body === '', `${head.status} body=${head.body.length}`);

const post = await drive(server, route.path, 'POST');
check('a POST is refused with 405', post.status === 405, String(post.status));

admit = false;
const denied = await drive(server, route.path);
check('a rejected request is refused with 401', denied.status === 401, String(denied.status));
admit = true;

// A second GET inside the freshness window must reuse the cache: the stat pass
// is what runs, not the decompression pass.
const second = await drive(server, route.path);
const secondPayload = JSON.parse(second.body);
check('a repeat GET reuses the cached fold', secondPayload.generatedAt === payload?.generatedAt,
  `${secondPayload.generatedAt} vs ${payload?.generatedAt}`);

// A committed session event drops the freshness window so the next read re-checks
// the corpus. Re-checking is not the same as rebuilding: when nothing on disk
// moved, reusing the fold is correct and `generatedAt` must NOT change. So the
// corpus is moved first, which is the only state in which invalidation is
// observable at all.
const logs = await findSessionLogs(SESSIONS_DIR);
if (logs.length === 0) {
  console.log('  --   skipping the invalidation check: no session logs on this machine');
} else {
  const target = logs[0];
  const original = await stat(target);
  try {
    eventListener({ type: 'turn/end' });
    // Nudge the stat signature the cache compares against.
    const moved = new Date(original.mtimeMs + 60000);
    await utimes(target, moved, moved);
    eventListener({ type: 'turn/end' });
    const after = await drive(server, route.path);
    const afterPayload = JSON.parse(after.body);
    check('a session event over a changed corpus rebuilds the fold',
      afterPayload.generatedAt > secondPayload.generatedAt,
      `${afterPayload.generatedAt} vs ${secondPayload.generatedAt}`);
    check('a rebuilt fold re-runs the scan and is still correct',
      afterPayload.scan.durationMs > 0
      && afterPayload.totals.tokens === secondPayload.totals.tokens,
      JSON.stringify({ rebuilt: afterPayload.scan.durationMs, tokens: afterPayload.totals.tokens }));
  } finally {
    await utimes(target, original.atime, original.mtime);
  }
}

// ── a payload must not outlive its own day ───────────────────────────────────
// Every date-derived field in the payload — which entry carries `today`,
// `range.to`, where the window ends — is only correct for the local day it was
// built on. Nothing in the cache used to notice a date change, so with DSH left
// open overnight and no session activity (no log size or mtime moves) the payload
// was re-served indefinitely and "Today" showed yesterday's tokens.
//
// Driven against an empty temporary root, so the stat signature is stable and the
// day rollover is the only thing that can force a rebuild.
{
  const tmp = await mkdtemp(join(tmpdir(), 'dsh-th-'));
  try {
    const cache = plugin.createCache({ root: tmp });
    const before = await cache.get();
    const realNow = Date.now;
    try {
      // Stand the plugin a day later without moving any file.
      Date.now = () => realNow() + DAY;
      const after = await cache.get();
      check('a payload is not served past its own day',
        after.range.to !== before.range.to,
        `${before.range.to} -> ${after.range.to}`);
      check('the rolled-over payload still ends on the new today',
        after.days[after.days.length - 1].today === true && after.range.to === after.days[after.days.length - 1].date,
        `${after.range.to} vs ${after.days[after.days.length - 1].date}`);
      check('the rollover is a rebuild, not a re-read',
        after.generatedAt > before.generatedAt,
        `${before.generatedAt} -> ${after.generatedAt}`);
      // The rollover must not have broken the cache itself: a second read on the
      // SAME day, over the same empty root, has to reuse the fold it just built.
      Date.now = () => realNow() + DAY + 100;
      const again = await cache.get();
      check('the same day still reuses the fold after a rollover',
        again.generatedAt === after.generatedAt,
        `${after.generatedAt} vs ${again.generatedAt}`);
      // And it must roll over again on the next day, not just once.
      Date.now = () => realNow() + DAY * 2;
      const dayThree = await cache.get();
      check('the rollover repeats on every day, not once',
        dayThree.range.to !== after.range.to,
        `${after.range.to} -> ${dayThree.range.to}`);
    } finally {
      Date.now = realNow;
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

await new Promise((resolve) => server.close(resolve));

console.log(`\n${failures.length === 0 ? 'ALL CHECKS PASSED' : `${failures.length} CHECK(S) FAILED`}`);
process.exit(failures.length === 0 ? 0 : 1);
