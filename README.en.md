# dsh-token-heatmap

**English** | [中文](./README.md)

A draggable floating window that shows your DeepSeek Harness token usage as a
GitHub-style contribution heatmap: today's total on top, the last 30 days below,
and a full year in a panel that grows above it when you hover.

![The token heatmap window in the lower-left of the Harness UI, with the year panel expanded](docs/preview.png)

## Install

Needs DeepSeek Harness with the Plugin Manager. Open the sidebar's **Plugins**
page and install this spec:

```
github:cccchensy/dsh-token-heatmap
```

Or just ask the agent in any session: *install the plugin
`github:cccchensy/dsh-token-heatmap`*. If you cloned the repo, install its
directory path instead.

The window then appears in the lower-left of the conversation area. Uninstall from
the same Plugins page.

- Plugins are per profile and survive a restart.
- **Restart DSH after updating the plugin** — replacing an installed package needs
  a restart to load new code.
- Nothing leaves your machine. It reads your own session logs and serves the
  aggregate in-process: no network calls, no telemetry.

## Use

![Hovering expands the year panel; dragging moves the window](docs/demo1.gif)

![The blink: the window slowly lights and dims while a session is running](docs/demo2.gif)

- **Drag** anywhere to move it. The position is remembered.
- **Hover** to grow the year panel above it: totals, active days, average, current
  and longest streak, best day, a colour legend, and each day's input / cache /
  output split.
- **Double-click** to collapse it to the header row.
- The window **blinks slowly while any session is running**, and stops when the
  last one finishes. Nothing inside it is animated, so the numbers never flicker.

## Limits

- Today's figure is accurate to the last committed step, not the last generated
  token.
- Counts use the same rules as the Harness usage pill for an ordinary Turn, with
  one known gap: a **retried step is undercounted**, because only
  `assistant/message` events are folded while the official total also sums each
  `assistant/attempt`.
- The blink means "a session is running", not "tokens are being spent right now".

## Development

```
node verify.mjs          # token rules + a scan of the real session logs
node verify-client.mjs   # the browser bundle
node verify-host.mjs     # the HTTP route, end to end
```

Knobs — window length, subagent inclusion, scan concurrency, freshness window —
live in [`lib/config.js`](lib/config.js). The Host half is plain ESM with no
dependencies and no build step.

MIT licensed.
