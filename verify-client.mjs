/**
 * Structural test for the browser bundle. Not part of the shipped plugin.
 *
 * The bundle is hand-authored rather than compiled, so this stubs the two
 * contracts the page provides — `window.__ModuleLoader__.load` and `require` —
 * and checks that the factory registers the right id, declares its services,
 * installs its stylesheet, and contributes exactly one slot entry whose injected
 * props carry a translate seat and the session id.
 *
 * It cannot prove what the component looks like; only the connected page can.
 */

/** Registrations captured from the stubbed loader. */
const registered = [];

/** Style elements appended by the bundle. */
const styles = [];

/** localStorage stand-in so the drag position round-trips. */
const stored = new Map();

globalThis.localStorage = {
  getItem: (key) => (stored.has(key) ? stored.get(key) : null),
  setItem: (key, value) => stored.set(key, String(value)),
};

globalThis.window = {
  innerWidth: 1200,
  innerHeight: 800,
  addEventListener() {},
  removeEventListener() {},
  __ModuleLoader__: {
    load(entry) {
      registered.push(entry);
    },
  },
};

globalThis.document = {
  head: {
    appendChild(node) {
      styles.push(node);
    },
  },
  querySelector() {
    return null;
  },
  createElement(tag) {
    return { tag, dataset: {}, textContent: '' };
  },
};

/**
 * Minimal re-rendering hook runtime.
 *
 * The window reads its own state back inside an effect (it seeds the default
 * position when none is stored), so a stub that returns a constant from
 * `useState` cannot exercise that path. Hooks are therefore slotted per render
 * and a setter re-renders, exactly as React would for this component.
 */
const hookSlots = [];
let hookIndex = 0;
let currentRender = null;
let cleanupFns = [];
let effectRuns = 0;
/** The most recent element a `render()` call produced. */
let currentTree = null;

const react = {
  createElement(type, props, ...children) {
    // React flattens nested child arrays; the component passes them inline.
    return { type, props: props ?? {}, children: children.flat(Infinity) };
  },
  useRef(initial) {
    const slot = hookIndex;
    hookIndex += 1;
    if (hookSlots[slot] === undefined) {
      hookSlots[slot] = {
        current: initial,
        // Enough of an element for the panel's anchor measurement.
        getBoundingClientRect: () => ({ right: 900, bottom: 60, top: 40, left: 860, width: 40, height: 20 }),
      };
    }
    return hookSlots[slot];
  },
  useState(initial) {
    const slot = hookIndex;
    hookIndex += 1;
    if (hookSlots[slot] === undefined) {
      hookSlots[slot] = { value: typeof initial === 'function' ? initial() : initial };
    }
    const cell = hookSlots[slot];
    return [cell.value, (next) => {
      cell.value = typeof next === 'function' ? next(cell.value) : next;
      if (currentRender !== null) {
        currentRender();
        currentRender = null;
      }
    }];
  },
  useEffect(fn) {
    const slot = hookIndex;
    hookIndex += 1;
    // A real renderer runs an empty-dependency effect once per mount. This stub
    // re-renders to observe a seeded position, so each effect body runs once and
    // its cleanup is deferred to keep the poll timer from stacking.
    if (effectRuns >= 12 || hookSlots[`e${slot}`] === true) return;
    hookSlots[`e${slot}`] = true;
    effectRuns += 1;
    const cleanup = fn();
    if (typeof cleanup === 'function') cleanupFns.push(cleanup);
  },
};

/**
 * Run the component body the way a renderer would.
 *
 * Host component elements (`HeatGrid`, `Panel`, `Cell`, …) are rendered inline,
 * so a walker sees the real output rather than an unresolved element.
 * @param fn - the component.
 * @param props - its props.
 * @returns the rendered element.
 */
function render(fn, props) {
  hookIndex = 0;
  currentRender = () => render(fn, props);
  const element = fn(props);
  currentTree = element;
  currentRender = null;
  return element;
}

/**
 * Expand a rendered tree, calling every function component it contains.
 * @param element - a rendered element.
 * @returns the tree with host elements only.
 */
function expand(element) {
  if (element === null || element === undefined || typeof element !== 'object') return element;
  if (Array.isArray(element)) return element.map(expand);
  const { type, props } = element;
  if (typeof type === 'function') {
    return expand(type(props));
  }
  return { type, props, children: (element.children ?? []).map(expand) };
}

/**
 * Collect every node in an expanded tree whose className matches.
 * @param node - expanded tree node.
 * @param className - exact class to match.
 * @returns matching nodes.
 */
function findAll(node, className) {
  const found = [];
  const walk = (current) => {
    if (current === null || current === undefined || typeof current !== 'object') return;
    if (Array.isArray(current)) {
      current.forEach(walk);
      return;
    }
    if (current.props?.className === className) found.push(current);
    (current.children ?? []).forEach(walk);
  };
  walk(node);
  return found;
}

/**
 * Find the first node in an expanded tree whose className matches.
 * @param node - expanded tree node.
 * @param className - exact class to match.
 * @returns the node, or undefined.
 */
function findOne(node, className) {
  return findAll(node, className)[0];
}

globalThis.require = (id) => {
  if (id === 'react') return react;
  throw new Error(`unexpected module request: ${id}`);
};

const failures = [];
const check = (name, condition, detail) => {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`);
  }
};

// Execute the bundle exactly as the page does: it registers a factory only.
const source = await import('node:fs/promises').then((fs) => fs.readFile(new URL('./lib/client.js', import.meta.url), 'utf8'));
// The bundle is a script, not a module: evaluate its body with the global stubs.
// eslint-disable-next-line no-new-func
new Function(source)();

check('the bundle registers exactly one factory', registered.length === 1, `count=${registered.length}`);
const entry = registered[0];
check('the factory id is the package name', entry?.id === 'dsh-token-heatmap', String(entry?.id));

const plugin = entry.factory(globalThis.require);
check('the factory exports apply', typeof plugin.apply === 'function');
check('the factory declares applied services', Array.isArray(plugin.inject)
  && plugin.inject.includes('slots')
  && plugin.inject.includes('locale')
  && plugin.inject.includes('sessions'), JSON.stringify(plugin.inject));

const dictionaryCalls = [];
const effects = [];
const injections = [];
const registrations = [];
const ctx = {
  effect(callback, label) {
    effects.push(label);
    const disposer = callback();
    return typeof disposer === 'function' ? disposer : () => {};
  },
  locale: {
    register(ns, dicts) {
      dictionaryCalls.push({ ns, dicts });
      return () => {};
    },
    bind(ns) {
      return (key, params) => {
        const dict = dictionaryCalls[0]?.dicts?.zh ?? {};
        let template = dict[key] ?? key;
        for (const [name, value] of Object.entries(params ?? {})) {
          template = template.replaceAll(`{${name}}`, String(value));
        }
        return template;
      };
    },
  },
  slots: {
    inject(key, callback) {
      injections.push(key);
      callback();
      return () => {};
    },
    register(spec, component) {
      registrations.push({ spec, component });
      return () => {};
    },
  },
  sessions: {
    binding(sessionId) {
      return { sessionId, session: {}, eventSource: { getSnapshot: () => ({ revision: 0, entries: [] }), subscribe: () => () => {} } };
    },
  },
};

plugin.apply(ctx);

check('apply installs exactly one stylesheet', styles.length === 1 && styles[0].dataset.dshTokenHeatmap === '');
check('the stylesheet uses theme tokens', styles.length === 1 && styles[0].textContent.includes('--dsw-alias-'));
check('the stylesheet carries the DeepSeek blue ramp', styles.length === 1
  && styles[0].textContent.includes('--dsw-static-deepseek-500')
  && styles[0].textContent.includes('--dsw-static-deepseek-800'));
check('the stylesheet carries both frosted backgrounds', styles.length === 1
  && styles[0].textContent.includes('body[data-ds-dark-theme] .dsh-th-panel'));
check('the window glass follows the theme', (() => {
  const css = styles[0]?.textContent ?? '';
  // Matched as declarations, because these rules span several joined strings.
  const light = /\.dsh-th-card\{[^}]*?background:(rgb\([^)]*\))/.exec(css)?.[1];
  const dark = /body\[data-ds-dark-theme\] \.dsh-th-card\{[^}]*?background:(rgb\([^)]*\))/.exec(css)?.[1];
  const lightRule = css.slice(css.indexOf('.dsh-th-card{'), css.indexOf('border-radius:12px;'));
  const darkRule = css.slice(css.indexOf('body[data-ds-dark-theme] .dsh-th-card{'), css.indexOf('color:rgb(249 250 251);'));
  // Guarded: if either sentinel ever moves, the slice is empty and every
  // `!includes(...)` below would pass for the wrong reason.
  if (!(lightRule.length > 0 && darkRule.length > 0)) return false;
  const brightness = (rgb) => {
    const [r, g, b] = (rgb.match(/\d+/g) ?? []).map(Number);
    return r + g + b;
  };
  // The two surfaces must be on opposite sides of mid-grey, and neither may lean on
  // `--dsw-alias-bg-overlay`: that token is `#e9ecf2` in the light theme, so it
  // silently overrode the fallback that was written to sit under it.
  return light === 'rgb(233, 236, 242, 88%)'
    && dark === 'rgb(5, 5, 6)'
    && brightness(light) > 600 && brightness(dark) < 100
    && !lightRule.includes('--dsw-alias-bg-overlay')
    && !darkRule.includes('--dsw-alias-bg-overlay');
})(), JSON.stringify({
  light: /\.dsh-th-card\{[^}]*?background:(rgb\([^)]*\))/.exec(styles[0]?.textContent ?? '')?.[1],
  dark: /body\[data-ds-dark-theme\] \.dsh-th-card\{[^}]*?background:(rgb\([^)]*\))/.exec(styles[0]?.textContent ?? '')?.[1],
}));
check('no gradient layer covers the card colour the animation tints', (() => {
  const css = styles[0]?.textContent ?? '';
  const start = css.indexOf('.dsh-th-card{');
  const darkStart = css.indexOf('body[data-ds-dark-theme] .dsh-th-card{');
  if (start < 0 || darkStart < 0) return false;
  const light = css.slice(start, css.indexOf('}', start));
  const dark = css.slice(darkStart, css.indexOf('}', darkStart));
  if (light.length === 0 || dark.length === 0) return false;
  // A gradient is painted above `background-color`, so any gradient on the card
  // would hide the one property the live treatment animates.
  return !light.includes('background-image') && dark.includes('background-image:none');
})());
check('the stylesheet never requires a Client package', styles.length === 1
  && !styles[0].textContent.includes('dsh-client-ui-primitives'));

// ── the three fixes for reported display defects ─────────────────────────────
check('today uses an outline so hovering it still shows the hover ring', (() => {
  const css = styles[0]?.textContent ?? '';
  const active = /\.dsh-th-cell\[data-active="true"\]\{([^}]*)\}/.exec(css)?.[1] ?? '';
  const today = /\.dsh-th-cell\[data-today="true"\]\{([^}]*)\}/.exec(css)?.[1] ?? '';
  // Both are single-pixel emphasis on the same element. With two box-shadow rules
  // of equal specificity the later one (today) won, so hovering today's cell
  // produced no visible change at all.
  return active.includes('box-shadow') && today.includes('outline') && !today.includes('box-shadow');
})());
check('the pulse is suppressed under reduced motion, in script and in style', (() => {
  const css = styles[0]?.textContent ?? '';
  const media = /@media \(prefers-reduced-motion:reduce\)\{([\s\S]*)\}\}?$/.exec(css)?.[1] ?? '';
  return source.includes("window.matchMedia('(prefers-reduced-motion: reduce)')")
    && source.includes('if (prefersReducedMotion()) return;')
    && media.includes('.dsh-th-card[data-running="true"]{animation:none');
})());
check('each grid gets a key handler bound to the days it shows', (() => {
  // The resting grid shows 30 days and the panel shows the year. A shared handler
  // stepped the resting grid's highlight onto a day it does not render, so the
  // ring simply vanished.
  return source.includes('function makeKeyHandler(list, onEscape)')
    && source.includes('onKeyDown: makeKeyHandler(miniDays,')
    && source.includes('onKeyDown: makeKeyHandler(days,')
    && !source.includes('onKeyDown: function () {}');
})());
check('the resting grid is keyboard reachable', (() => {
  // `focusDate: null` gave every cell tabIndex -1, so the grid advertised
  // role="grid" with no way to reach it and its key handler could never fire.
  const mini = source.indexOf('key: \'mini\'');
  const block = source.slice(mini, mini + 900);
  return mini > 0 && block.includes('focusDate: hovered');
})());

check('one dictionary namespace is registered', dictionaryCalls.length === 1);
check('the dictionary is bilingual', dictionaryCalls[0]?.dicts?.zh !== undefined && dictionaryCalls[0]?.dicts?.en !== undefined);
check('both dictionaries carry identical keys', (() => {
  const zhKeys = Object.keys(dictionaryCalls[0]?.dicts?.zh ?? {}).sort().join(',');
  const enKeys = Object.keys(dictionaryCalls[0]?.dicts?.en ?? {}).sort().join(',');
  return zhKeys === enKeys && zhKeys.length > 0;
})());
check('the surface registers an effect for its dictionary', effects.some((label) => String(label).includes('dictionar')), JSON.stringify(effects));
check('it injects into the frame-wide overlay', injections.length === 1
  && injections[0] === 'shell.overlay', JSON.stringify(injections));
check('exactly one slot entry is registered', registrations.length === 1);
check('the slot entry declares id and order', registrations[0]?.spec?.id === 'token-heatmap' && typeof registrations[0]?.spec?.order === 'number');
check('the slot entry is bound to the plugin locale namespace', registrations[0]?.spec?.locale === 'tokenHeatmap');

const injected = registrations[0]?.spec?.inject('session-test');
check('injection returns a translate seat', typeof injected?.t === 'function');
check('injection returns the session id', injected?.sessionId === 'session-test');
check('injection returns a session binding or undefined', injected?.sessionBinding === undefined || typeof injected?.sessionBinding === 'object');
// The process-wide run status travels through the inject face, because the slot
// inject is the only place a client plugin can read `ctx`.
const statusEvents = [];
injected.remote = { $on: (event, listener) => { statusEvents.push({ event, listener }); return () => {}; } };
check('injection hands the component the Remote event bus', typeof injected.remote?.$on === 'function');

const tree = render(registrations[0]?.component, injected);
// Effects have run and may have re-rendered (the window seeds its default
// position that way), and host components are expanded, so assertions read the
// settled, fully-rendered tree.
const settled = expand(currentTree ?? tree);
check('the component renders without throwing', settled !== undefined && settled !== null);
check('the component renders the overlay root', settled?.props?.className === 'dsh-th-root');
check('an unresolved component element never reaches the tree', !JSON.stringify(settled, (k, v) => (typeof v === 'function' ? '[fn]' : v)).includes('"type":"HeatGrid"'));

/** The draggable window element. */
const card = findOne(settled, 'dsh-th-card');
check('the window renders as a draggable card', card !== undefined);
check('the window starts a drag from its own pointer events', typeof card?.props?.onPointerDown === 'function');
check('the window captures the pointer and tracks it globally', source.includes("window.addEventListener('pointermove'")
  && source.includes('setPointerCapture')
  && source.includes('releasePointerCapture'));
check('drag frames bypass React state', source.includes('livePosition.current = next')
  && source.includes("setProperty('--dsh-th-x'"));
check('the window hover is a two-surface union', typeof card?.props?.onPointerEnter === 'function'
  && typeof card?.props?.onPointerLeave === 'function'
  && source.includes("enterSurface('panel')")
  && source.includes("leave('panel')"));
check('the panel root reports its own hover', source.includes('onPointerEnter: props.onPanelEnter')
  && source.includes('onPointerLeave: props.onPanelLeave'));
check('both surfaces feed the same hover union', source.includes("onPanelEnter: function () { enterSurface('panel'); }")
  && source.includes("onPanelLeave: function () { leave('panel'); }"));
check('hover closes only when both surfaces are clear',
  source.includes('if (hoverCardRef.current || hoverPanelRef.current) return;'));
check('the window can collapse on double click', typeof card?.props?.onDoubleClick === 'function');
check('the window is not a chrome-less button any more', findAll(settled, 'dsh-th-pill').length === 0
  && findAll(settled, 'dsh-th-trigger').length === 0);

/** Header and 30-day grid inside the window. */
const headValue = findOne(settled, 'dsh-th-headValue');
check('the window header shows today', findOne(settled, 'dsh-th-headLabel') !== undefined && headValue !== undefined);
check('the header renders a pending placeholder before data arrives', (() => {
  const rendered = Array.isArray(headValue?.children) ? headValue.children[0] : headValue?.children;
  return rendered === '-';
})());
check('the three-dot grip is gone', findAll(settled, 'dsh-th-grip').length === 0
  && !source.includes('dsh-th-grip'));
check('the pulse dot is gone in favour of an ambient animation', findAll(settled, 'dsh-th-live').length === 0
  && !source.includes('dsh-th-live'));
check('a running Turn drives that animation', source.includes("'data-running': running")
  && source.includes('.dsh-th-card[data-running="true"]{animation:dsh-th-breathe')
  && source.includes('@keyframes dsh-th-breathe'));

/** The resting 30-day grid. */
const miniGrid = findAll(settled, 'dsh-th-grid')[0];
check('the resting window renders a 30-day grid', miniGrid !== undefined
  && String(miniGrid.props.style.gridTemplateColumns).includes('repeat(6,'));
check('the resting grid is wide enough for any 30-day window', (() => {
  // A 30-day window needs weekday(first) + 30 cells = 30..36. The block is six
  // columns of seven = 42, so it always holds the content. With five columns it
  // held only 35, and a window starting on a Saturday spilled into an implicit
  // sixth column that silently widened the whole window.
  const cells = findAll(settled, 'dsh-th-cell').length;
  const cols = Number(/repeat\((\d+),/.exec(String(miniGrid?.props?.style?.gridTemplateColumns))?.[1]);
  return cols === 6 && cells >= 36 && cells <= 42;
})(), JSON.stringify({
  cells: findAll(settled, 'dsh-th-cell').length,
  cols: String(miniGrid?.props?.style?.gridTemplateColumns),
}));
check('the mini grid uses a larger cell than the old 9px', String(miniGrid?.props?.style?.['--dsh-th-cell']) === '11px');
check('the mini grid uses real calendar columns', miniGrid?.props.style.gridAutoFlow === 'column'
  && String(miniGrid.props.style.gridTemplateRows).includes('repeat(7,'));

/** The weekday rail: the fix for the clipped 日. */
const rail = findOne(settled, 'dsh-th-rail');
check('the window renders a seven-row weekday rail', rail !== undefined && rail.children.length === 7);
check('the rail labels every row including Sunday', (() => {
  if (rail === undefined) return false;
  const labels = rail.children.map((row) => row?.children?.[0] ?? '');
  return labels.length === 7 && labels[0] === '日' && labels.every((label) => typeof label === 'string' && label.length > 0);
})());
check('the rail defaults to labelled rows before data arrives', (() => {
  if (rail === undefined) return false;
  return rail.children[0]?.children?.[0] === '日';
})());
check('the rail reserves room for its glyph', (() => {
  const css = styles[0].textContent;
  const start = css.indexOf('.dsh-th-rail{');
  const rule = css.slice(start, css.indexOf('}', start) + 1);
  return start >= 0 && rule.includes('width:18px') && rule.includes('text-align:left');
})());
check('the rail rows are cell-sized and not clipped', (() => {
  const rows = findAll(settled, 'dsh-th-railRow');
  const css = styles[0].textContent;
  const start = css.indexOf('.dsh-th-railRow{');
  const rule = css.slice(start, css.indexOf('}', start) + 1);
  // The rows must not clip: a fixed 9px grid row with hidden overflow is what
  // swallowed 日 before, because a 10px glyph did not fit its cell.
  return rows.length === 7 && start >= 0 && rule.includes('overflow:visible')
    && rule.includes('height:var(--dsh-th-cell');
})());
check('the translate seat resolves a real dictionary entry', injected.t('panel.title') === 'Token 热力图', injected.t('panel.title'));

// Geometry and behaviour contracts that only exist in the bundle source.
check('the window is drag-positioned from a stored or default point', source.includes('dsh-token-heatmap.position')
  && source.includes('function defaultPosition'));
check('the expanded panel anchors above the window', source.includes('rect.top - ANCHOR_GAP'));
check('the expanded panel width is clamped to the viewport', source.includes('PANEL_WIDTH, Math.max(240, width - VIEWPORT_MARGIN * 2)'));
check('a non-finite viewport metric cannot reach the geometry', source.includes('function metric(')
  && source.includes('function viewportWidth()')
  && source.includes('!isPlaced(next)'));
check('the containing-block offset is measured and corrected', source.includes('function findShiftedAncestor')
  && source.includes('function measureShift')
  && source.includes('--dsh-th-shift-x'));
check('the window is positioned from a layout effect, not after paint', source.includes('useLayoutEffect(function () {')
  && source.includes('React.useLayoutEffect'));
check('the window is no longer registered in the header or the composer dock',
  !source.includes('conversation.session.header.utilities') && !source.includes('conversation.composer.dock'));
check('the larger year cells are used by the expanded grid', source.includes('YEAR_CELL = 12'));

// ── geometry ─────────────────────────────────────────────────────────────────
// The bundle cannot be imported as a module (it registers itself with the page's
// loader), so its pure geometry helpers are lifted out of the source and run
// directly. These are the functions whose failure made the window disappear: a
// missing viewport metric used to reach the clamp as `undefined`, produce `NaN`,
// and invalidate the `transform` that positions the window — leaving it out of
// layout entirely.
const geometry = [
  'const VIEWPORT_MARGIN = 12;',
  'const PANEL_WIDTH = 820;',
  'const PANEL_MAX_HEIGHT = 320;',
  'function metric(',
  'function viewportWidth(',
  'function viewportHeight(',
  'function clampCoordinate(',
  'function isPlaced(',
  'function defaultPosition(',
].map((marker) => {
  if (marker.startsWith('const')) return marker;
  const start = source.indexOf(marker);
  if (start < 0) return '';
  const brace = source.indexOf('{', start);
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return '';
}).join('\n');
check('every geometry helper was lifted out of the bundle', geometry.includes('function metric(')
  && geometry.includes('function clampCoordinate(')
  && geometry.includes('function defaultPosition(')
  && geometry.includes('const VIEWPORT_MARGIN'));

let geometryWorks = false;
try {
  const build = new Function('window', 'document', `
    ${geometry}
    return { clampCoordinate, defaultPosition, viewportWidth, viewportHeight, isPlaced };
  `);
  const withWindow = build({ innerWidth: 1200, innerHeight: 800 }, { documentElement: { clientWidth: 1200, clientHeight: 800 } });
  const noWindow = build({}, {});
  const placed = noWindow.defaultPosition();
  const clamped = noWindow.clampCoordinate(5000, 200, undefined);
  geometryWorks = Number.isFinite(withWindow.viewportWidth())
    && Number.isFinite(withWindow.viewportHeight())
    && Number.isFinite(placed.x)
    && Number.isFinite(placed.y)
    && Number.isFinite(clamped)
    && noWindow.viewportWidth() >= 240
    && noWindow.viewportHeight() >= 240
    && withWindow.viewportWidth() === 1200
    && withWindow.clampCoordinate(5000, 200, 1200) === 988
    && withWindow.isPlaced({ x: 1, y: 2 }) === true
    && withWindow.isPlaced({ x: NaN, y: 2 }) === false
    && noWindow.isPlaced({ x: null, y: null }) === false;
} catch (error) {
  console.log(`  [geometry] ${error.message}`);
}
check('a missing viewport metric can never produce NaN geometry', geometryWorks);

// ── the heat ramp is artwork, so it must be inline ───────────────────────────
// The expanded panel never renders in this harness (it is behind `open`), so its
// components are lifted out of the bundle and rendered against a synthetic
// payload. The legend swatches were the reported defect: correct markup, no
// visible colour, because the ramp lived only in a stylesheet the cascade could
// quietly override.
const lifted = [
  ['function Cell(props)', 'function HeatGrid'],
  ['function HeatGrid(props)', 'function MonthRail'],
  ['function MonthRail(props)', 'function Readout'],
  ['function Readout(props)', 'function LegendSwatch'],
  ['function LegendSwatch(props)', 'function pill('],
  ['function pill(', 'function Panel'],
  ['function Panel(props)', 'function TokenHeatmap'],
  // The real formatters, not stubs. Replacing them with `String(value)` is what
  // let the thousands/millions thresholds, digit grouping, the day format and the
  // age boundary sit behind a green suite with no coverage at all.
  ['//#region formatting', 'var RAMP_LIGHT'],
  ['var RAMP_LIGHT', 'function useDarkTheme'],
  ['var LEVEL_STYLES', '//#endregion'],
  ['function metric(', 'function viewportWidth'],
].map(([from, to]) => {
  const start = source.indexOf(from);
  if (start < 0) return '';
  const end = source.indexOf(to, start);
  return end < 0 ? '' : source.slice(start, end);
}).join('\n')
  + '\nfunction panelStyle(p) { return p === null ? undefined : { left: p.left + "px", width: p.width + "px", bottom: p.bottom + "px" }; }'
  + '\nconst YEAR_CELL = 12;\nconst LEVELS = [0, 1, 2, 3, 4, 5];';

// ── the formatters, against their real implementations ───────────────────────
// These were stubbed out for the whole life of this suite, so nothing checked the
// thresholds where a compact count changes shape, the digit grouping, the day
// format, or the age boundary. Every expectation below is written out rather than
// read back from the source.
const formatting = new Function(`${lifted}\nreturn { formatTokens, formatExact, formatDay, formatAge };`);
let formatters = null;
try {
  formatters = formatting();
} catch (error) {
  console.log('[formatting] ' + String(error && error.message ? error.message : error));
}
if (formatters !== null) {
  const tk = injected.t;
  const cases = [
    ['a count below a thousand is shown as-is', formatters.formatTokens(999, tk), '999'],
    ['a thousand switches to the K form', formatters.formatTokens(1000, tk), tk('number.thousand', { value: '1' })],
    ['1500 keeps one decimal below 100', formatters.formatTokens(1500, tk), tk('number.thousand', { value: '1.5' })],
    ['100000 drops the decimal at 100 and above', formatters.formatTokens(100000, tk), tk('number.thousand', { value: '100' })],
    ['a million switches to the M form', formatters.formatTokens(2400000, tk), tk('number.million', { value: '2.4' })],
    ['zero is not rendered as an empty string', formatters.formatTokens(0, tk), '0'],
    ['a negative count cannot appear', formatters.formatTokens(-5, tk), '0'],
    ['a non-finite count cannot appear', formatters.formatTokens(NaN, tk), '0'],
    ['exact counts are grouped in thousands', formatters.formatExact(1234567, tk), '1' + tk('number.groupSeparator') + '234' + tk('number.groupSeparator') + '567'],
    ['exact counts round rather than truncate', formatters.formatExact(999.6, tk), '1' + tk('number.groupSeparator') + '000'],
    ['a negative exact count clamps to zero', formatters.formatExact(-5, tk), '0'],
    ['a day key is rendered without leading zeros', formatters.formatDay('2026-10-01'), '2026/10/1'],
    ['a malformed day key is passed through untouched', formatters.formatDay('nonsense'), 'nonsense'],
    ['a fresh payload reads as seconds', /^\d+s$/.test(formatters.formatAge(Date.now())), true],
    ['an older payload reads as minutes', formatters.formatAge(Date.now() - 90000), '2m'],
    ['over an hour reads as hours and minutes', formatters.formatAge(Date.now() - 11100000), '3h5m'],
    ['a whole number of hours keeps its zero minutes', formatters.formatAge(Date.now() - 7200000), '2h0m'],
    ['just under a day stays in hours', formatters.formatAge(Date.now() - 86340000), '23h59m'],
    ['over a day reads as days, hours and minutes', formatters.formatAge(Date.now() - 189060000), '2d4h31m'],
    ['a whole number of days keeps its zeros', formatters.formatAge(Date.now() - 86400000), '1d0h0m'],
  ];
  for (const [name, actual, expected] of cases) {
    check('formatting: ' + name, actual === expected, JSON.stringify({ actual, expected }));
  }

  // The live figure asks for exactly two decimals, which is the whole point: a
  // number climbing during a Turn has to move, and one decimal cannot show it.
  const fixed = [
    ['two decimals are padded, not dropped', formatters.formatTokens(83600000, tk, 2), tk('number.million', { value: '83.60' })],
    ['two decimals round rather than truncate', formatters.formatTokens(83656000, tk, 2), tk('number.million', { value: '83.66' })],
    ['the thousands form also carries two decimals', formatters.formatTokens(1500, tk, 2), tk('number.thousand', { value: '1.50' })],
    ['a whole million keeps its two decimals', formatters.formatTokens(2000000, tk, 2), tk('number.million', { value: '2.00' })],
    ['an empty day reads as zero point zero zero', formatters.formatTokens(0, tk, 2), '0.00'],
    ['a count below a thousand stays exact', formatters.formatTokens(856, tk, 2), '856'],
  ];
  for (const [name, actual, expected] of fixed) {
    check('formatting (two decimals): ' + name, actual === expected, JSON.stringify({ actual, expected }));
  }
  check('formatting: the panel keeps its own precision',
    formatters.formatTokens(83600000, tk) === tk('number.million', { value: '83.6' }),
    formatters.formatTokens(83600000, tk));
}

// ── the ramp reaches the DOM, in both themes ─────────────────────────────────
if (formatters !== null) {
  const rampCheck = new Function('h', `${lifted}\nreturn { levelStyle, LegendSwatch };`);
  try {
    const { levelStyle: ls, LegendSwatch: Sw } = rampCheck(react.createElement);
    const lightValues = [1, 2, 3, 4, 5].map((level) => ls(level, false).background);
    const darkValues = [1, 2, 3, 4, 5].map((level) => ls(level, true).background);
    const cssRamp = /\.dsh-th-cell\[data-level="1"\]\{background:[^#]*#([0-9a-f]{6})/.exec(source)?.[1];
    const brightness = (hex) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
    check('level 0 is a neutral slot, not the lightest blue',
      String(ls(0, false).background).includes('color-mix'));
    check('the five light levels are five distinct blues',
      new Set(lightValues).size === 5 && lightValues.every((v) => /^#[0-9a-f]{6}$/.test(v)),
      JSON.stringify(lightValues));
    // Not "the dark ramp is darker at every level": the deep end of the scale is
    // shared between themes on purpose. What matters is that the first step of each
    // ramp reads as a filled slot against its own surface — a light blue on the
    // near-black card, a dim slate on the dark glass — because a first step that is
    // too close to the empty slot is a day that looks like it had no usage.
    check('the first ramp step is a filled slot on its own surface',
      brightness(lightValues[0]) > 600 && brightness(darkValues[0]) < 300,
      JSON.stringify({ light1: lightValues[0], dark1: darkValues[0] }));
    check('the stylesheet ramp and the inline ramp are the same colours', (() => {
      // The sheet is the fallback for a cell whose inline background is lost, so a
      // mismatch between them is a cell that changes colour when a rule is dropped.
      const lightRule = /\.dsh-th-cell\[data-level="1"\]\{background:[^#]*#([0-9a-f]{6})/.exec(source)?.[1];
      const darkRule = /body\[data-ds-dark-theme\] \.dsh-th-cell\[data-level="1"\]\{background:[^#]*#([0-9a-f]{6})/.exec(source)?.[1];
      return lightValues[0] === '#' + lightRule && darkValues[0] === '#' + darkRule;
    })(), JSON.stringify({ lightValues, cssRamp }));
    const swatch = Sw({ level: 5, dark: false });
    check('a legend swatch carries its colour and its own geometry',
      swatch.props.style.background === lightValues[4]
      && swatch.props.style.width === '10px'
      && swatch.props.style.flex === '0 0 auto');
    const darkSwatch = Sw({ level: 1, dark: true });
    check('a dark legend swatch uses the dark ramp', darkSwatch.props.style.background === darkValues[0]);
  } catch (error) {
    console.log('[ramp2] ' + String(error && error.message ? error.message : error));
  }
}


let legendStyles = [];
let legendGeometry = [];
let legendLabels = [];
let gridStyles = [];
try {
  const build = new Function('h', `${lifted}\nreturn Panel;`);
  const Panel = build(react.createElement);
  const samplePayload = {
    version: 1,
    generatedAt: Date.now(),
    range: { from: '2026-09-01', to: '2026-10-01' },
    totals: {
      tokens: 1000,
      activeDays: 2,
      averagePerActiveDay: 500,
      bestDay: { date: '2026-10-01', tokens: 800 },
      streak: { current: 1, longest: 2 },
    },
    days: [
      { date: '2026-09-28', tokens: 0, level: 0, today: false },
      { date: '2026-09-29', tokens: 10, level: 1, today: false },
      { date: '2026-09-30', tokens: 200, level: 3, today: false },
      { date: '2026-10-01', tokens: 800, level: 5, today: true },
    ],
    calendars: { weeks: 1, months: [], weekdays: ['日', '一', '二', '三', '四', '五', '六'] },
    scan: { sessions: 3 },
  };
  const rendered = expand(Panel({
    t: injected.t,
    payload: samplePayload,
    dark: false,
    hovered: null,
    hoveredDay: null,
    focusDate: null,
    onHover: () => {},
    onKeyDown: () => {},
    labelOf: (day) => day.date,
    panelRef: { current: null },
    onPanelEnter: () => {},
    onPanelLeave: () => {},
    pos: { left: 100, bottom: 200, width: 820 },
    sessionCount: 3,
  }));
  const scale = findOne(rendered, 'dsh-th-legendScale');
  const swatches = findAll(rendered, 'dsh-th-swatch');
  legendStyles = swatches.map((child) => child.props.style?.background);
  legendGeometry = swatches.map((child) => ({
    width: child.props.style?.width,
    height: child.props.style?.height,
    minWidth: child.props.style?.minWidth,
    flex: child.props.style?.flex,
    display: child.props.style?.display,
    radius: child.props.style?.borderRadius,
  }));
  gridStyles = findAll(rendered, 'dsh-th-cell')
    .filter((cell) => cell?.props?.role === 'gridcell')
    .map((cell) => ({ level: cell.props['data-level'], background: cell.props.style?.background }));
  legendLabels = (scale?.children ?? [])
    .filter((child) => child === undefined || child === null || child.type === 'span' && child.props.className === undefined)
    .map((child) => child?.children?.[0])
    .filter((text) => typeof text === 'string');
} catch (error) {
  console.log(`  [ramp] ${error.message}`);
}

check('the legend renders six ramp samples', legendStyles.length === 6, JSON.stringify(legendStyles));
check('each legend sample carries an explicit colour', legendStyles.every((value) => typeof value === 'string' && value.length > 0),
  JSON.stringify(legendStyles));
check('the ramp deepens from light to dark', (() => {
  const deep = legendStyles.slice(1);
  const distinct = new Set(deep).size;
  // #d3e2ff -> #b7c8fe -> #7aaaff -> #5686fe -> #4176e6, all distinct and progressively deeper.
  return distinct === 5 && deep[0] === '#d3e2ff' && deep[4] === '#4176e6';
})(), JSON.stringify(legendStyles));
check('every swatch is sized and cannot shrink to nothing', legendGeometry.length === 6
  && legendGeometry.every((box) => box.width === '10px'
    && box.height === '10px'
    && box.minWidth === '10px'
    && box.flex === '0 0 auto'
    && box.display === 'inline-block'
    && box.radius === '2.5px'), JSON.stringify(legendGeometry[0]));
check('the swatches do not depend on the grid cell class', !source.includes("className: 'dsh-th-cell', 'data-level': String(level)")
  && source.includes("className: 'dsh-th-swatch'"));
check('the legend keeps its 少 / 多 end labels', legendLabels.includes('少') && legendLabels.includes('多'),
  JSON.stringify(legendLabels));
check('level 0 stays a neutral empty cell, not a blue', String(legendStyles[0]).includes('color-mix'),
  String(legendStyles[0]));
check('a year grid cell carries its level colour inline too', (() => {
  const deep = gridStyles.filter((cell) => cell.level !== '0');
  return deep.length > 0 && deep.every((cell) => typeof cell.background === 'string' && cell.background.startsWith('#'));
})(), JSON.stringify(gridStyles));
check('the ramp is theme-aware', source.includes('RAMP_DARK') && source.includes('function useDarkTheme')
  && source.includes('useDarkTheme()'));

// ── the live treatment is imperative, not a stylesheet rule ──────────────────
// An attribute-selector animation was the second reported miss. The breathe is
// now created on the card element through the Web Animations API, so it starts
// when a Turn starts regardless of what any rule does.
check('the breathe is created through the animation API', source.includes('function startBreathe(')
  && source.includes('node.animate(')
  && source.includes('iterations: active ? Infinity : 1'));
check('the breathe animates the card, not a descendant',
  source.includes('startBreathe(cardRef.current, running, dark)'));
check('the animation reacts only to the run state and the theme',
  source.includes('}, [running, dark]);'));
check('the breathe rejects nothing when the API is missing',
  source.includes("if (typeof node.animate !== 'function') return function () {};"));
check('the stylesheet fallback shares the scripted rhythm',
  source.includes('animation:dsh-th-breathe var(--dsh-th-flash,3s) ease-in-out infinite')
  && source.includes("node.style.setProperty('--dsh-th-flash', BREATHE_MS + 'ms')"));
check('the flash timing is named, derived from one interval constant',
  source.includes('var FLASH_INTERVAL_MS = 1500;')
  && source.includes('var BREATHE_MS = FLASH_INTERVAL_MS * 2;')
  && source.includes('var FLASH_PEAK_HOLD_MS = 180;'));
check('the keyframes have exactly one definition, shared by both layers',
  (source.match(/function breatheKeyframes\(/g) ?? []).length === 1
  && source.includes('breatheKeyframes(deep, lit, calmBorder, warmBorder, bright, quiet)'));

// The three live treatments are pure functions of (node, active, dark), so they
// are lifted out of the bundle and driven directly. This is the check that was
// missing when the breathe was reported invisible: the previous harness ran each
// effect body once and never again, so it could not observe anything that reacts
// to a state change — exactly what a "while a Turn runs" visual does.
let breathe = null;
try {
  const build = new Function('metric', `
    const FLASH_INTERVAL_MS = 1500;
    const BREATHE_MS = FLASH_INTERVAL_MS * 2;
    const FLASH_PEAK_HOLD_MS = 180;
    ${['breatheKeyframes', 'startBreathe', 'startHalo'].map((name) => {
      const start = source.indexOf(`function ${name}(`);
      if (start < 0) return '';
      const brace = source.indexOf('{', start);
      let depth = 0;
      for (let index = brace; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        else if (source[index] === '}') {
          depth -= 1;
          if (depth === 0) return source.slice(start, index + 1);
        }
      }
      return '';
    }).join('\n')}
    return { breatheKeyframes, startBreathe, startHalo };
  `);
  const liftedAnimation = build((value, fallback) => (Number.isFinite(value) ? value : fallback));

  /**
   * Run an animation function against a recording element.
   * @param fn - the lifted animation function.
   * @param active - whether the Turn is running.
   * @returns recorded calls and the disposer.
   */
  const drive = (fn, active, dark) => {
    const calls = [];
    let cancelled = 0;
    const node = {
      animate(keyframes, options) {
        calls.push({ keyframes, options });
        return { cancel() { cancelled += 1; }, finished: Promise.resolve() };
      },
    };
    const dispose = fn(node, active, dark === true);
    return { calls, dispose, cancelled: () => cancelled };
  };

  const idle = drive(liftedAnimation.startBreathe, false, false);
  const live = drive(liftedAnimation.startBreathe, true, false);
  const liveDark = drive(liftedAnimation.startBreathe, true, true);
  const halo = drive(liftedAnimation.startHalo, false);
  const haloLive = drive(liftedAnimation.startHalo, true);

  breathe = { idle, live, liveDark, halo, haloLive };
} catch (error) {
  console.log(`  [live] ${error.message}`);
}

check('the live treatment animates when a Turn runs and settles when it ends', breathe !== null
  && breathe.live.calls.length === 1
  && breathe.idle.calls.length === 1,
  JSON.stringify(breathe?.live?.calls?.length));

check('the running animation loops forever and the settling one does not', breathe !== null
  && breathe.live.calls[0].options.iterations === Infinity
  && breathe.idle.calls[0].options.iterations === 1,
  JSON.stringify(breathe?.live?.calls?.[0]?.options));

/** The pure run-state helpers, lifted so their precedence rules can be exercised. */
const liftedRunState = (() => {
  const start = source.indexOf('function anyRunningIn(');
  const end = source.indexOf('function useNoSessionStatus(', start);
  return start < 0 || end < 0 ? '' : source.slice(start, end);
})();

check('the pulse reads the whole-profile run roster, not this Session',
  // The roster the Harness hands every slot entry covers every session in the
  // profile, so a task in another workspace lights the pulse up. A per-session
  // subscription cannot answer that, which is why the window used to stay dark.
  source.includes('props.useSessionStatus')
  && source.includes('var statuses = useSessionStatus(function (value) { return value; });')
  && source.includes('var running = resolveRunning(statuses, remoteRunning);')
  && source.includes('function anyRunningIn(statuses)'));
check('the run state resolves from the roster, falling back only when it is empty', (() => {
  try {
    // eslint-disable-next-line no-new-func
    const resolve = new Function(`${liftedRunState}\nreturn { anyRunningIn, resolveRunning };`)();
    const roster = (entries) => new Map(Object.entries(entries));
    const cases = [
      ['an empty roster is not running', resolve.resolveRunning(roster({}), false), false],
      ['one running session is enough', resolve.resolveRunning(roster({ a: { running: false }, b: { running: true } }), false), true],
      ['all idle means not running', resolve.resolveRunning(roster({ a: { running: false }, b: { running: false } }), false), false],
      ['a null entry is tolerated', resolve.resolveRunning(roster({ a: null, b: { running: true } }), false), true],
      // The reason the roster wins: a missed `running: false` on the event bus must
      // not be able to pin the pulse on for ever.
      ['a populated idle roster overrides a stale event flag', resolve.resolveRunning(roster({ a: { running: false } }), true), false],
      ['an unavailable roster defers to the event bus', resolve.resolveRunning(null, true), true],
      ['an unavailable roster with no events is idle', resolve.resolveRunning(null, false), false],
      ['a roster without values() is treated as unavailable', resolve.resolveRunning({}, true), true],
    ];
    const bad = cases.filter(([, actual, expected]) => actual !== expected);
    for (const [name, actual, expected] of cases) {
      check('run state: ' + name, actual === expected, JSON.stringify({ actual, expected }));
    }
    return bad.length === 0;
  } catch (error) {
    console.log('[runstate] ' + String(error && error.message ? error.message : error));
    return false;
  }
})(), '');
check('the token figures refresh faster while anything runs', (() => {
  // Work in another workspace only reaches this page through the poll, so a fixed
  // fifteen-second period makes a climbing total look stalled.
  return source.includes('var RUNNING_POLL_MS = 3000;')
    && source.includes('timer = setTimeout(tick, runningRef.current ? RUNNING_POLL_MS : POLL_MS);')
    && source.includes('runningRef.current = running;')
    && !source.includes('setInterval(function () { load(false); }, POLL_MS);');
})());
check('the pulse starts on the first running session and ends on the last', (() => {
  // One flag per session id, added on start and removed on stop; that set is the
  // fallback the roster takes over from once it has entries.
  const subscribeAt = source.indexOf("remote.$on('api-session/status'");
  const subscribeBody = source.slice(subscribeAt, subscribeAt + 600);
  return subscribeAt > 0
    && subscribeBody.includes('runningIds.add(key)')
    && subscribeBody.includes('runningIds.delete(key)')
    && source.includes('setRemoteRunning(runningIds.size > 0)');
})(), 'subscribe=' + String(source.indexOf("remote.$on('api-session/status'")));
check('the old per-event hold heuristic is gone', !source.includes('RUN_HOLD_MS')
  && !source.includes('pulseTimer')
  && !source.includes('snapshotRef')
  && !source.includes('generatedAt !== '));
check('the figure refetch is no longer what drives the pulse', (() => {
  const start = source.indexOf('The token figures follow this Session');
  const body = source.slice(start, source.indexOf('}, [props.sessionId]);', start));
  return start > 0 && !body.includes('setRunning');
})());

// ── continuity: the numbers must never blank on a refresh ────────────────────
// The reported symptom was `-` appearing and the grid vanishing between flashes.
// Neither came from the animation: a refresh re-initialised the component's own
// state, so for one commit there was no payload to render. The payload now lives
// in a module store the component subscribes to, so the figure can only ever be
// replaced by another figure.
check('the payload lives outside the component, in a subscribed store',
  source.includes('var lastPayload = null;')
  && source.includes('function publishPayload(payload)')
  && source.includes('function subscribePayload(listener)')
  && source.includes('function currentPayload()'));
check('the figure renders from the store, not from component state', (() => {
  const start = source.indexOf('var payload = currentPayload();');
  const value = source.indexOf("className: 'dsh-th-headValue'");
  if (!(start > 0 && value > start)) return false;
  const block = source.slice(value, value + 260);
  return block.includes('figureUnknown ?')
    && !block.includes('snapshot')
    && !block.includes('status ===');
})(), '');
check('a failed scan is reported instead of rendering as a confident zero', (() => {
  // The Host signals an unreadable corpus in band: HTTP 200 with an `error` field
  // and no days. Nothing read it, so a broken corpus looked exactly like a day
  // with no usage.
  return source.includes('var hostError = payload === null || payload.error === undefined')
    && source.includes('var figureUnknown = payload === null || (hostError !== null && days.length === 0);')
    && source.includes("t('state.error', { message: hostError })")
    && source.includes('hostError: hostError,');
})());
check('no refresh path can blank the figure', !source.includes('setSnapshot')
  && !source.includes('visiblePayload')
  && !source.includes("status: 'loading'")
  && !source.includes("status === 'loading'"));
check('simultaneous refreshes share one request', source.includes('var inflight = null;')
  && source.includes('if (inflight !== null) return inflight;')
  && source.includes('var CACHE_TTL_MS = 1500;'));
check('the poll reuses the cache instead of forcing every tick', (() => {
  const start = source.indexOf('var load = function (force)');
  const body = source.slice(start, source.indexOf('load(true);', start));
  return start > 0 && body.includes('loadDaily({ force: force, signal: controller.signal })');
})());

check('the window animates border, background and glow together', breathe !== null
  && ['borderColor', 'backgroundColor', 'boxShadow'].every(
    (property) => property in breathe.live.calls[0].keyframes[0],
  ), JSON.stringify(Object.keys(breathe?.live?.calls?.[0]?.keyframes?.[0] ?? {})));

check('the dark window keeps its deep black glass while it warms', (() => {
  const frames = breathe?.liveDark?.calls?.[0]?.keyframes ?? [];
  const mid = frames[1];
  return frames.length === 4
    && typeof mid?.borderColor === 'string'
    && mid.borderColor.includes('86,134,254')
    && mid.boxShadow.includes('86,134,254');
})(), JSON.stringify(breathe?.liveDark?.calls?.[0]?.keyframes?.[1]));
check('every pulse frame is opaque, so rest can never show through', (() => {
  const frames = breathe?.live?.calls?.[0]?.keyframes ?? [];
  const darkFrames = breathe?.liveDark?.calls?.[0]?.keyframes ?? [];
  // Opaque means an `rgb(...)` literal with no alpha channel at all.
  const opaque = (value) => typeof value === 'string' && /^rgb\([^)]*\)$/.test(value);
  return frames.length === 4
    && frames.every((frame) => opaque(frame.backgroundColor))
    && darkFrames.every((frame) => opaque(frame.backgroundColor));
})(), JSON.stringify((breathe?.live?.calls?.[0]?.keyframes ?? []).map((f) => f.backgroundColor)));
check('the pulse moves between a black trough and a lit peak', (() => {
  const frames = breathe?.liveDark?.calls?.[0]?.keyframes ?? [];
  return frames.length === 4
    && frames[0]?.backgroundColor === 'rgb(5, 5, 6)'
    && frames[1]?.backgroundColor === 'rgb(30, 44, 82)'
    && frames[2]?.backgroundColor === 'rgb(30, 44, 82)'
    && frames[3]?.backgroundColor === 'rgb(5, 5, 6)';
})(), JSON.stringify((breathe?.liveDark?.calls?.[0]?.keyframes ?? []).map((f) => f.backgroundColor)));
check('one blink cycle is three seconds, i.e. 1.5s per transition', (() => {
  const options = breathe?.live?.calls?.[0]?.options ?? {};
  const frames = breathe?.live?.calls?.[0]?.keyframes ?? [];
  if (options.duration !== 3000 || frames.length !== 4) return false;
  const trough = frames[0].offset;
  const peak = frames[1].offset;
  const back = frames[3].offset;
  return Math.abs(trough - 0) < 1e-9 && Math.abs(back - 1) < 1e-9
    && Math.abs((peak - trough) - (back - peak)) < 0.15;
})(), JSON.stringify(breathe?.live?.calls?.[0]?.options));
check('the envelope is symmetric: it eases in as gradually as it eases out', (() => {
  const frames = breathe?.live?.calls?.[0]?.keyframes ?? [];
  if (frames.length !== 4) return false;
  // Measured from the PEAK, not from the ends. `0.5 - frames[0].offset` is always
  // 0.5 because frames[0] is pinned to offset 0, so that form could not notice a
  // ramp that had been made shorter on one side — which is the whole property
  // under test.
  const riseSpan = frames[1].offset - frames[0].offset;
  const fallSpan = frames[3].offset - frames[2].offset;
  const restAtStart = frames[0].backgroundColor === frames[3].backgroundColor;
  const restAtEnd = frames[0].boxShadow === frames[3].boxShadow;
  return restAtStart && restAtEnd
    && riseSpan > 0.1 && riseSpan < 0.5
    && Math.abs(riseSpan - fallSpan) < 1e-9;
})(), JSON.stringify((breathe?.live?.calls?.[0]?.keyframes ?? []).map((f) => f.offset)));
check('the peak is held briefly instead of touched for an instant', (() => {
  const frames = breathe?.live?.calls?.[0]?.keyframes ?? [];
  const options = breathe?.live?.calls?.[0]?.options ?? {};
  if (frames.length !== 4 || !(options.duration > 0)) return false;
  // The plateau must be a small but non-zero share of the cycle. Asserting the
  // millisecond value would just restate FLASH_PEAK_HOLD_MS from the source.
  const holdFraction = frames[2].offset - frames[1].offset;
  return holdFraction > 0 && holdFraction < 0.1
    && frames[1].offset < 0.5 && frames[2].offset > 0.5;
})(), JSON.stringify((breathe?.live?.calls?.[0]?.keyframes ?? []).map((f) => f.offset)));
check('the settling animation eases in as well', (() => {
  const options = breathe?.idle?.calls?.[0]?.options ?? {};
  const live = breathe?.live?.calls?.[0]?.options ?? {};
  const frames = breathe?.idle?.calls?.[0]?.keyframes ?? [];
  return frames.length === 3
    && frames[0].offset === 0
    && frames[1].offset === 0.5
    && frames[2].offset === 1
    && frames[0].backgroundColor === frames[2].backgroundColor
    // Both halves progress under one easing function, so the settle cannot rise
    // abruptly and then fade slowly.
    && options.easing === 'ease-in-out'
    && options.easing === live.easing
    && options.duration > 0;
})(), JSON.stringify({ idle: breathe?.idle?.calls?.[0]?.options, live: breathe?.live?.calls?.[0]?.options }));
check('the pulse is a state, not a one-shot flash', breathe !== null
  && breathe.live.calls[0].options.iterations === Infinity
  && breathe.idle.calls[0].options.iterations === 1,
  JSON.stringify({ live: breathe?.live?.calls?.[0]?.options, idle: breathe?.idle?.calls?.[0]?.options }));
check('every pulse frame is held, so the surface never snaps back', breathe !== null
  && breathe.live.calls[0].options.fill === 'forwards');
check('the settle releases its hold so the card returns to its resting style', breathe !== null
  && breathe.idle.calls[0].options.fill === 'none'
  && breathe.halo.calls[0].options.fill === 'none');
check('the settle starts and ends at the resting colour', (() => {
  const frames = breathe?.idle?.calls?.[0]?.keyframes ?? [];
  const live = breathe?.live?.calls?.[0]?.keyframes ?? [];
  // A cycle begins and ends on the same frame the settle ends on, so consecutive
  // cycles and the transition into rest are all the same value — no seam.
  return frames.length === 3
    && frames[0].backgroundColor === live[0].backgroundColor
    && frames[2].backgroundColor === live[0].backgroundColor
    && frames[0].borderColor === live[0].borderColor
    && frames[2].borderColor === live[0].borderColor;
})(), JSON.stringify((breathe?.idle?.calls?.[0]?.keyframes ?? []).map((f) => f.backgroundColor)));
check('a live pulse loops forever and the settle runs once', (() => {
  const liveOptions = breathe?.live?.calls?.[0]?.options ?? {};
  const idleOptions = breathe?.idle?.calls?.[0]?.options ?? {};
  return liveOptions.iterations === Infinity
    && idleOptions.iterations === 1
    && source.includes('startBreathe(cardRef.current, running, dark)')
    && source.includes('startHalo(haloRef.current, running)')
    && !source.includes('preview');
})(), JSON.stringify(breathe?.live?.calls?.[0]?.options));

check('the header figure is never animated, so a new value cannot flicker',
  !source.includes('startValueGlow')
  && !source.includes('valueRef')
  && !/class(Name)?: 'dsh-th-headValue'[^}]*animate\(/.test(source)
  && source.includes("font-variant-numeric:tabular-nums;font-feature-settings:\"tnum\" 1;min-width:5.2em"));
check('nothing inside the window is animated', (() => {
  // Declarations call themselves `startX(node, …)`; the component's call sites name
  // a ref. Only the card's own surface and the halo behind it may be animated.
  const callSites = [...source.matchAll(/start(Breathe|Halo)\(([^)]*)\)/g)]
    .map((match) => match[0])
    .filter((call) => !call.startsWith('startBreathe(node') && !call.startsWith('startHalo(node'));
  return callSites.length === 2
    && callSites.every((call) => call.includes('cardRef.current') || call.includes('haloRef.current'));
})(), JSON.stringify([...source.matchAll(/start(Breathe|Halo)\(([^)]*)\)/g)].map((m) => m[0])));
check('an animation is never restarted by a value change', (() => {
  const start = source.indexOf('}, [running, dark]);');
  if (start < 0) return false;
  const effect = source.slice(source.lastIndexOf('React.useEffect', start), start + 40);
  // The token figures, the position and the panel state must all stay out of the
  // dependency list, or updating the number would restart the pulse mid-rhythm.
  return !effect.includes('snapshot')
    && !effect.includes('todayTokens')
    && !effect.includes('payload')
    && !effect.includes('position')
    && !effect.includes('panelPos');
})());
check('the effect reacts to a transition, not to its own dependencies', (() => {
  // One animation is created when the pulse turns on and cancelled when it turns
  // off. Rebuilding it on every dependency change is what caused the stutter.
  const start = source.indexOf('}, [running, dark]);');
  const effect = source.slice(source.lastIndexOf('React.useEffect', start), start + 40);
  return effect.includes('var disposeBreathe = null;')
    && effect.includes('disposeBreathe = startBreathe(')
    && effect.includes('if (disposeBreathe !== null) disposeBreathe();');
})());

check('the resting colour and the pulse trough are the same value', (() => {
  const css = styles[0]?.textContent ?? '';
  // The card rules span several joined strings, so the declaration is matched
  // directly rather than by slicing to a brace.
  const lightRest = /\.dsh-th-card\{[^}]*?background:(rgb\([^)]*\))/.exec(css)?.[1];
  const darkRest = /body\[data-ds-dark-theme\] \.dsh-th-card\{[^}]*?background:(rgb\([^)]*\))/.exec(css)?.[1];
  const lightTrough = breathe?.live?.calls?.[0]?.keyframes?.[0]?.backgroundColor;
  const darkTrough = breathe?.liveDark?.calls?.[0]?.keyframes?.[0]?.backgroundColor;
  // The trough must be the same literal the stylesheet rests on; if it differed
  // even slightly, every settle would land where the next had to correct it.
  return lightRest !== undefined && darkRest !== undefined
    && lightTrough === lightRest && darkTrough === darkRest;
})(), JSON.stringify({
  lightRest: /\.dsh-th-card\{[^}]*?background:(rgb\([^)]*\))/.exec(styles[0]?.textContent ?? '')?.[1],
  lightTrough: breathe?.live?.calls?.[0]?.keyframes?.[0]?.backgroundColor,
  darkRest: /body\[data-ds-dark-theme\] \.dsh-th-card\{[^}]*?background:(rgb\([^)]*\))/.exec(styles[0]?.textContent ?? '')?.[1],
  darkTrough: breathe?.liveDark?.calls?.[0]?.keyframes?.[0]?.backgroundColor,
}));

check('the halo loops and returns to rest when it settles', breathe !== null
  && breathe.haloLive.calls[0].options.iterations === Infinity
  && breathe.halo.calls[0].options.iterations === 1
  && breathe.halo.calls[0].options.fill === 'none'
  && breathe.haloLive.calls[0].keyframes[1].opacity === 1
  && breathe.halo.calls[0].keyframes[2].opacity === 0);

check('a settling animation is cancellable and cancels', (() => {
  if (breathe === null) return false;
  breathe.idle.dispose();
  breathe.live.dispose();
  breathe.halo.dispose();
  return breathe.idle.cancelled() === 1 && breathe.live.cancelled() === 1 && breathe.halo.cancelled() === 1;
})());

check('a renderer without the animation API is tolerated', (() => {
  try {
    const build = new Function(`
      const BREATHE_MS = 1;
      ${source.slice(source.indexOf('function startHalo('), source.indexOf('//#endregion', source.indexOf('function startHalo(')))}
      return startHalo;
    `);
    const startHalo = build();
    const dispose = startHalo({}, true, false);
    return typeof dispose === 'function';
  } catch {
    return false;
  }
})());

check('the component anchors both treatments to real refs',
  source.includes('startBreathe(cardRef.current, running, dark)')
  && source.includes('startHalo(haloRef.current, running)')
  && source.includes('}, [running, dark]);'));

console.log(`\n${failures.length === 0 ? 'ALL CHECKS PASSED' : `${failures.length} CHECK(S) FAILED`}`);
process.exit(failures.length === 0 ? 0 : 1);
