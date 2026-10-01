# dsh-token-heatmap

A GitHub-contribution-style heatmap of **daily token usage** in a draggable
floating window. Today's number sits on top and the last 30 days sit under it;
hover the window and a larger frosted panel grows above it with a full year.
Every number matches what the Harness itself reports for a Turn.

```
        ┌───────────────────────────┐
        │ 今日  83.6M               │  ← drag anywhere to move
        │ 日  ▫▫▫▫▫▫▫               │
        │ 二  ▫▫▫▫▫▫▫  ← last 30 days│
        │ 四  ▫▫▫▫▫▫▫               │
        │ 六  ▫▫▫▫▫▫▫               │
        └───────────────────────────┘
                    ↕ hover
   ┌─────────────────────────────────────────────────────────────┐
   │ Token 热力图            合计 129M  活跃 2  日均 64.4M  …    │
   │ 2025/9/21 至 2026/10/1                                      │
   │      9月   11月   12月   1月   …   ← one square per local day│
   │ 日  ▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫      │
   │ 二  ▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫      │
   │ 四  ▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫      │
   │ 六  ▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫      │
   │ 最长连续 2 天                            少 ▪▪▪▪▪ 多        │
   │ 2026/10/1   83,638,723 tok                                  │
   │ 未缓存输入 … · 缓存读取 … · 输出 …                           │
   └─────────────────────────────────────────────────────────────┘
```

## What it does

- **One draggable floating window.** A single entry in `shell.overlay` — the
  frame-wide floating layer above every column, so the window cannot be clipped
  by whatever chrome it is dragged over. Drag it anywhere; the position is
  clamped to the viewport and remembered in `localStorage`. Double-click
  collapses it to the header row alone.
- **Dragging tracks the pointer exactly.** Three mechanisms, because any one
  alone fails:
  - `setPointerCapture` on the window addresses every subsequent move to the
    window even when the pointer outruns the element — without it, a fast drag
    loses the element and the window only resumes following once the pointer
    comes back, the classic "it desyncs and catches up" symptom.
  - Move frames write the position **straight to the element** as a custom
    property. React state is committed once, on pointer-up, so a drag never waits
    on a render and React cannot write a stale coordinate over the in-flight one.
  - All drag listeners live on `window`, registered in a layout effect, so they
    are installed before the first pointer interaction.
- **Hover that survives the trip to the panel.** `shell.overlay` is the one seat
  where the panel must be a *sibling* of the window (a fixed element is outside
  its parent's hover box), so "still hovering" is the union of two reported
  surfaces: the window and the panel each report their own pointer enter/leave,
  and the panel closes only when both are clear.
- **Today on top, 30 days underneath.** The header is today's total; the body is
  the last 30 days laid out as a real calendar block — columns are weekdays, so a
  Monday is always the second row.
- **The pulse is driven, not declared.** Both layers are created, started and
  cancelled through the **Web Animations API** on real refs, because a live signal
  that depends on winning a cascade is a live signal that can silently not happen.
  The stylesheet keeps a matching `[data-running]` rule as a static warm border for
  a renderer without the animation API. This replaced an indicator dot, which never
  read clearly at this size.
- **Hover for a year.** After a short hover delay a larger frosted panel grows
  *above* the window, clamped into the viewport, showing the full 53-week
  contribution graph with totals, active days, average, current and longest
  streak, best day, a legend, and a per-day readout with the input/cache/output
  split. It drops below instead when there is no room above.
- **Nothing inside the window is animated.** The pulse is confined to the card's
  own surface and the halo behind it. An earlier version also animated the header
  figure's colour, which was wrong twice over: the number shimmered, and because
  the value was an effect dependency, **every value change cancelled and restarted
  that animation** — so updating the count flickered. The figure is now plain text
  with `tabular-nums` and a reserved `min-width`, so a new value swaps digits in
  place with no reflow, and the animation effect depends only on `running` and
  `dark`.
- **A dark glass surface in both themes, stated rather than inherited.** The
  resting window is an explicit smoked grey in the light theme
  (`rgb(35, 38, 44, 90%)`) and opaque near-black in the dark theme (`rgb(5, 5, 6)`),
  over `backdrop-filter: blur(18px)`. It is **not** `--dsw-alias-bg-overlay`: that
  token resolves to `#e9ecf2` in the light theme, so using it as the base painted
  the window light grey *and* silently overrode the fallback written to prevent
  exactly that. The card carries no `background-image` either, because a gradient
  paints above `background-color` and would hide the one property the live
  treatment animates.
- **The trough is the resting colour, byte for byte.** The pulse's low frame uses
  the same literal the stylesheet rests on (dark theme opaque, which is why that
  rule has no alpha), so a settle lands exactly where the next cycle begins —
  otherwise every cycle boundary would carry a seam.
- **The figures never blank and the grid never vanishes.** The payload lives in a
  **module store** outside the component (`lastPayload`, with
  `publishPayload`/`subscribePayload`/`currentPayload`), and the figure and the
  heatmap render from it at render time. There is deliberately no
  `status`/`payload` component state for them: a state transition is a value that
  has to be rendered *on the way through*, and that intermediate value was the
  `-`. A refresh can therefore only replace a number with a number. The one dash
  shown is before the page's first response. Simultaneous requests — the poll, the
  session-event refresh, a remount — share one in-flight promise behind a 1.5s
  cache window, so they cannot disagree.
- **The blink reacts to a transition, not to a re-render.** One animation is
  created when the pulse turns on and cancelled when it turns off, so the rhythm
  cannot be interrupted while it runs. The effect's dependency list is exactly
  `[running, dark]`: a value change, a panel toggle or a drag can never restart it
  mid-cycle. The stylesheet fallback reads its duration from a `--dsh-th-flash`
  custom property the script writes, so the declared and scripted rhythms are the
  same number by construction — they used to be written out twice at different
  durations and fought over the same properties, which produced an uneven flash.
- **When the blink starts and stops.** The pulse is a statement about the Harness,
  not about one Session, so it follows the **process-wide run status** the Session
  Controller broadcasts on the Remote event bus: `api-session/status(sessionId,
  running)`. The component keeps a `Set` of running session ids; the first
  `running: true` — which includes the moment a command is accepted — turns the
  pulse on, and it stays on while the set is non-empty, so the last conversation
  to finish owns the final flash. When the final `running: false` arrives the
  settle animation plays once and the window rests. Nothing is time-inferred: both
  the start and the end are exact events, and the earlier "hold for N seconds after
  the last session event" heuristic is gone.
- **The envelope is symmetric and the timing is named.** `FLASH_INTERVAL_MS` (500)
  is one transition, so a full blink cycle is `BREATHE_MS` = 1000ms: one flash per
  second. The keyframes rise out of rest **and** fall back into it over the same
  span, because a flash that vanishes slowly but appears instantly reads as a
  glitch. `FLASH_PEAK_HOLD_MS` (120) holds the light at full before it turns, so
  the peak is a plateau rather than a single touched instant. The settling
  animation uses the same three-point envelope over four cycles, so it eases in as
  well instead of only fading out. While pulsing, every frame is **fully opaque**
  and **held** (`fill: 'forwards'`), so the resting surface can neither show
  through mid-pulse nor snap back between states. Once settled the fill is
  **released** (`fill: 'none'`): holding a literal colour forever would pin the
  card to a black only approximately equal to its resting one, so each cycle would
  end perched on an off-rest value and the next would start by correcting it — a
  seam at every cycle boundary. Two layers blink in phase: the border and outer
  glow with the card's own background (a black trough to a blue-lit peak), and the
  blurred blue **halo** behind the window. Nothing else in the window is animated,
  so unchanged heatmap squares never blink.
- **DeepSeek blue ramp.** Day squares run from a neutral empty cell to the
  DeepSeek blue scale, light to deep
  (`--dsw-static-deepseek-100/200/300/400/500`), with a parallel dark-theme ramp
  (`800/700/600/450/400`). Levels are quintiles of the *observed* active days, so
  the map stays readable at any scale.
- **The ramp is applied inline, not only by the cascade.** The same colours exist
  as `data-level` rules, but every cell carries its colour as an inline
  background, and the legend samples carry their colour **and their geometry**
  inline through a dedicated `LegendSwatch` component: explicit `width`, `height`,
  `minWidth`, `borderRadius`, `flex: 0 0 auto` and `display`. Two invisible-legend
  bugs came from the opposite approach — a swatch that shares `.dsh-th-cell` with
  the grid inherits a `var(--dsh-th-cell)` size and competes for space in a flex
  row, so it can be measured against the wrong variable or shrunk to nothing.
  `levelStyle()` caches one object per level per theme, so a 382-cell year grid
  allocates six styles rather than 382. Level 0 stays a neutral `color-mix` empty
  cell — never a blue — and the ramp follows a live light/dark switch through a
  `MutationObserver` on `body[data-ds-dark-theme]`.
- **Weekday gutter that renders all seven rows.** Every row is labelled, Sunday
  included, and each label gets its own cell-sized row with `overflow: visible`
  and a reserved width. Two earlier states hid the 日 glyph: a blank first label
  (which reads as a missing glyph rather than as "Sunday"), and a fixed 9px grid
  row with hidden overflow that clipped it.
- **Month captions never collide.** Captions sit where each month begins and are
  rotated when the next month starts within three columns — which is what happens
  to the two partial months at the window's edges — and are then spaced by text
  width.
- **A year of history, back-filled.** The Host scans every durable session log,
  so the map is populated the first time it loads rather than starting empty.

## Numbers match the Harness

Daily usage is folded from the durable session log with exactly the acceptance
rules the official Turn-usage disclosure applies
(`TurnUsagePanel` / `deriveTurnTokenUsage` in `@deepseek-ai/dsh-client-ui-chat`)
— see [`lib/tokens.js`](lib/tokens.js):

| Rule | Behaviour |
|---|---|
| `inputTokens` / `outputTokens` | must be non-negative safe integers, or the sample is dropped |
| `cacheReadTokens` / `cacheWriteTokens` | validated when present; unknown cache buckets without a total are dropped |
| `reasoningTokens` | validated and must not exceed the output |
| `totalTokens` | authoritative when present, and must be at least the known prompt; otherwise derived from prompt + output |
| one sample per `(turn, step)` | the **newest** sample wins, because a retried or resumed Step reports cumulative usage |

`totalTokens` is the billed total: uncached input + cache reads + output. The
heatmap therefore reports the same figure as the Turn-usage pill, summed per
local calendar day. A day is a **local** day (`YYYY-MM-DD` in the machine's time
zone), because that is the day the work happened.

Sessions whose header marks them as subagent runs (`origin: 'subagent'` or a
`parentSession`) are counted too, since their tokens are billed the same way.
Set `includeSubagents: false` in `lib/config.js` to follow only top-level
sessions.

## Architecture

```
lib/client.js   browser half — module-loader factory, overlay entry, draggable window, styles
lib/index.js    host half  — cache, JSON route, session-event invalidation
lib/scan.js     log discovery + concatenated-Zstandard decompression + per-Step fold
lib/tokens.js   the token-accounting authority shared with the checks
lib/aggregate.js  day grid, streaks, quintile levels, month captions, wire payload
lib/config.js   paths and defaults
```

The two halves talk over one read-only route:

```
GET /api/dsh-token-heatmap/daily   → { days, totals, calendars, scan, timeZone, … }
```

It is registered with `kind: 'exact'` under the shared `/api` prefix, so it rides
the same trust fence the rest of the API does (`requestRejection` → `401`/`403`),
and the browser fetches it same-origin with its own signed cookie. Nothing is
written to any session, no service is replaced, and no tool or prompt is added —
the model never sees this plugin.

**Caching.** A stat-level signature (`path:size:mtime` per log) decides freshness,
so a repeat request costs one directory walk and a `stat` per log; the expensive
decompression pass runs only when a log actually changed. A committed
`session/event` drops the freshness window, and the browser additionally polls
every 15 seconds and refreshes about a second after any session event lands.

**Reading the log.** A session log is many concatenated Zstandard frames, one per
durable append, and every Node zstd API decodes exactly the first frame. The
reader locates frame boundaries by magic bytes and *verifies* each candidate by
decompressing the bytes before it, so a magic sequence inside compressed payload
cannot truncate the log, and a torn final frame is tolerated.

## Install

```
plugin_manager  action: install_bundle  target: D:\DeepSeekHarness\plugins\dsh-token-heatmap
```

The manager links the package into the profile, selects the bundle in
`package.json`, and activates the row through HMR. The bundle inserts one Host
row; the browser half loads from the package's `./client` export.

## Verify

```
node verify.mjs          # token rules + real corpus scan + payload invariants
node verify-client.mjs   # bundle registration, slot entry, dictionaries, styles
node verify-host.mjs     # live HTTP route over the plugin's real handler
```

`verify-host.mjs` starts a throwaway HTTP server on an ephemeral port and drives
the registered handler; all three are standalone and write nothing.

## Configuration

There is deliberately no `Config` export in this first version, so the row
carries no `config:` block. The knobs live in [`lib/config.js`](lib/config.js):
`HOME`/`SESSIONS_DIR` resolution, the window length (`windowDays`, 371 days), the
scan concurrency, and the freshness window.

## Placement, and why a window can vanish

The window is `position: fixed`, but it is positioned in two independent ways,
and both are needed:

1. **Coordinates** are written onto a zero-size wrapper as `--dsh-th-x` / `--dsh-th-y`
   custom properties. Drag frames update those two properties only, so a drag
   never triggers a render.
2. **A containing-block correction** is written onto the root as
   `--dsh-th-shift-x` / `--dsh-th-shift-y` and added by the wrapper's `transform`.

The second exists because a `position: fixed` element is laid out against the
viewport **only while no ancestor establishes a containing block**. Any ancestor
with a transform, filter, backdrop-filter, perspective or `contain` silently
re-parents it — and the frame-wide overlay layer is exactly the kind of element
that can grow one. `findShiftedAncestor()` walks the chain and `measureShift()`
verifies the result, so the window lands where it asked to regardless.

Three failure modes produced a window that was present in the DOM and invisible on
screen, and each is now guarded:

- **`NaN` coordinates.** A viewport metric read as `undefined` reached the clamp
  arithmetic, produced `NaN`, and a `NaN` inside a `transform` invalidates the
  whole declaration — so the element leaves layout completely. Every geometry read
  now goes through `metric()`, `viewportWidth()` and `viewportHeight()`, which
  refuse non-finite values and fall back to `documentElement` and then to a
  constant. `isPlaced()` refuses to write a position that is not finite.
- **First paint before measurement.** A passive effect runs *after* paint, so the
  window was briefly rendered at the viewport origin — visible as a flash, or as
  nothing at all when the overlay clips. Seeding now happens in
  `useLayoutEffect`.
- **A zero-size anchor.** The window's size is measured from the card, never from
  the positioning wrapper, which is deliberately `0x0`.

`verify-client.mjs` lifts the pure geometry helpers out of the bundle and runs
them, asserting that a missing `window`/`document` still yields finite
coordinates — that regression is the one that made the window disappear.

## Limits

- The window cannot show usage that the Host has not folded yet. A turn's tokens
  appear when the assistant message is committed to the session log, so the figure
  is accurate to the last committed step rather than to the last generated token.
- Token accounting mirrors the official Turn-usage projection, so it agrees with
  the Harness UI; it is not a second implementation of the API's billing.
- The pulse says "a session is running", not "tokens are being spent". A turn that
  is thinking, calling a tool or waiting on a stream is still running, and the
  window pulses throughout — that is the point, but it is a statement about
  activity rather than about spend.
- **The day window steps in calendar days, never in fixed 24-hour blocks.** A local
  day is not always 86400000ms long. Stepping the cursor by a fixed day length
  across a DST transition shifts its wall clock by an hour and can push it over
  local midnight, which emits one calendar day **twice** and skips another
  outright. Because the totals are summed from those entries, tokens silently
  disappear and one day is counted twice. `setDate` asks the calendar instead. The
  regression test re-enters `verify.mjs` under `TZ=America/New_York`, because this
  machine's zone has no DST — which is exactly why the bug survived a green suite.
- **A cached payload never outlives its own day.** Everything date-derived in the
  payload — which entry carries `today`, `range.to`, where the 371-day window ends
  — is only correct for the local day it was built for. With DSH left open
  overnight and no session activity, no log's size or mtime moves, so the freshness
  window and the stat signature both report "nothing changed" while the payload
  describes yesterday. The cache now forces a rebuild when the payload's day is not
  today, bound to the payload's own `generatedAt` rather than the wall clock at scan
  completion, so a scan spanning midnight cannot be filed under the wrong day.
- **The Host may legitimately reuse a fold.** When no log's size or mtime moved, the
  next request re-checks the corpus and then serves the same payload: the numbers
  are unchanged because nothing changed, not because the refresh failed.

## Notes on what the verification does and does not prove

The three suites are `node verify.mjs` (token rules and a real corpus scan),
`node verify-client.mjs` (the browser bundle) and `node verify-host.mjs` (the
route). They share one important weakness worth stating plainly: **a large share
of the client checks match source text rather than behaviour.** They catch a
deleted function or a renamed dependency, and they cannot catch a handler that
never fires. Concretely, the panel never renders in the harness (`open` is
false), drag persistence, the keyboard handler and the fetch error path are all
exercised only by substring, and the formatters were stubbed out until they were
lifted for real. Treat a green run as "no regression in what is asserted", not as
"the surface works".


- **Retried or resumed Steps are settled once.** The newest sample for a
  `(turn, step)` wins, which matches the official disclosure. Every log on this
  machine had exactly one sample per Step, so the two rules agree in practice.
- **Compaction and forks are counted as written.** A forked session re-counts the
  tokens it inherited only if its own log carries those usage events.
- **A session being written is read at its last durable flush**, so the current
  Turn appears once its events land, not token by token.
- **Deep links are not per-day.** The panel is informational; it opens no
  conversation and filters nothing.
- **The running signal is a whole-Session observation.** The window sees that the
  Session moved, not which event carried the last assistant message, so the
  breathe begins on any committed event and settles six seconds later.
