window.__ModuleLoader__.load({
  id: 'dsh-token-heatmap',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
    var React = require('react');
    var h = React.createElement;

    /**
     * Layout effect where the renderer provides one.
     *
     * This surface positions itself from real geometry, so its first paint has to
     * follow that measurement; a passive effect runs after paint and would let the
     * window appear at the viewport origin first. The fallback keeps a renderer
     * without `useLayoutEffect` working rather than crashing.
     */
    var useLayoutEffect = typeof React.useLayoutEffect === 'function' ? React.useLayoutEffect : React.useEffect;

    //#region styles
    /**
     * Every style the surface owns. The window is a frosted card on the same type
     * scale as the Harness stats row; hovering it grows a larger frosted panel
     * above it. Neutrals come from theme tokens, so the glass follows the host
     * palette in both themes; the DeepSeek blue ramp is the only literal artwork
     * colour.
     */
    var CSS = [
      /* -- the floating window ------------------------------------------- */
      '.dsh-th-root{box-sizing:border-box;width:0;height:0;font-size:0;line-height:0}',
      // A zero-size positioning wrapper carries the coordinates and the
      // containing-block correction; the card inside owns everything visible.
      // Splitting them keeps a drag to one transform write and keeps the ambient
      // animation off the element that holds the offsets.
      '.dsh-th-anchorBox{position:fixed;left:0;top:0;z-index:90;pointer-events:none;',
      'transform:translate3d(calc(var(--dsh-th-x,0px) + var(--dsh-th-shift-x,0px)),',
      'calc(var(--dsh-th-y,0px) + var(--dsh-th-shift-y,0px)),0)}',
      '.dsh-th-card{position:relative;pointer-events:auto;box-sizing:border-box;display:flex;flex-direction:column;gap:7px;',
      'padding:8px 10px 9px;max-width:min(420px,calc(100vw - 24px));',
      'border:1px solid var(--dsw-alias-border-l1,rgb(0 0 0 / 10%));border-radius:12px;',
      // The resting surface is a dark glass in both themes: light theme a smoked
      // grey, dark theme near-black. It is an explicit colour, NOT
      // `--dsw-alias-bg-overlay` — that token resolves to `#e9ecf2` in the light
      // theme, so using it as the base painted the window light grey and, worse,
      // silently defeated the fallback that was meant to cover exactly this. The
      // dark glass is a deliberate choice, so it is stated rather than inherited.
      // No gradient layer either: a gradient sits above `background-color` and
      // would hide the one property the live treatment animates.
      'background:rgb(35, 38, 44, 90%);',
      '-webkit-backdrop-filter:blur(18px) saturate(1.45);backdrop-filter:blur(18px) saturate(1.45);',
      'box-shadow:0 6px 22px rgb(0 0 0 / 30%);',
      'color:var(--dsw-alias-label-primary);cursor:grab;',
      'user-select:none;-webkit-user-select:none;',
      'font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);',
      'line-height:20px;font-variant-numeric:tabular-nums}',
      '.dsh-th-card:hover,.dsh-th-card[data-hovering="true"]{',
      'border-color:var(--dsw-alias-border-l2,rgb(0 0 0 / 16%));box-shadow:0 10px 30px rgb(0 0 0 / 38%)}',
      '.dsh-th-card[data-dragging="true"]{cursor:grabbing;box-shadow:0 16px 40px rgb(0 0 0 / 45%)}',
      // Fully opaque, and deliberately so: the pulse trough uses this exact literal,
      // and an alpha difference of a few percent between the resting rule and the
      // trough is a visible seam at every cycle boundary. The frosted look survives
      // because `backdrop-filter` still blurs what is behind the window.
      'body[data-ds-dark-theme] .dsh-th-card{background:rgb(5, 5, 6);',
      'background-image:none;',
      'border-color:var(--dsw-alias-border-l1,rgb(255 255 255 / 12%));color:rgb(249 250 251);',
      'box-shadow:0 6px 24px rgb(0 0 0 / 60%)}',
      'body[data-ds-dark-theme] .dsh-th-card:hover{border-color:var(--dsw-alias-border-l2,rgb(255 255 255 / 18%))}',
      '@supports not ((backdrop-filter:blur(2px)) or (-webkit-backdrop-filter:blur(2px))){',
      '.dsh-th-card,.dsh-th-panel{background:var(--dsw-alias-bg-overlay,#fff)}',
      'body[data-ds-dark-theme] .dsh-th-card,body[data-ds-dark-theme] .dsh-th-panel{background:var(--dsw-alias-bg-overlay,#151517)}}',
      /* -- the legend, self-sufficient by construction --------------------- */
      // Legend swatches are sized and coloured entirely inline by `LegendSwatch`.
      // This rule exists only so the class is documented in the sheet.
      '.dsh-th-swatch{display:inline-block;flex:none}',
      '.dsh-th-legendRow{display:flex;align-items:center;gap:3px;flex:none}',
      // A halo behind the whole window. Its opacity is animated while a Turn runs,
      // which reads from any distance and does not compete with the card's own
      // glass background.
      '.dsh-th-halo{position:absolute;inset:-10px;border-radius:20px;pointer-events:none;z-index:-1;',
      'background:radial-gradient(closest-side,rgba(86,134,254,0.70),rgba(86,134,254,0.26) 62%,rgba(86,134,254,0) 100%);',
      'filter:blur(10px);opacity:0}',
      '.dsh-th-halo[data-active="true"]{opacity:0.9}',
      /* -- a running Turn breathes colour through the window --------------- */
      // The live treatment is driven from JavaScript (Web Animations keyframes on
      // the card and the halo). This rule is the fallback for a renderer without
      // that API, and it deliberately reads its duration from a custom property the
      // script writes, so the two can never disagree about the rhythm — they used
      // to, and the stylesheet winning the fight produced an uneven flash.
      '.dsh-th-card[data-running="true"]{animation:dsh-th-breathe var(--dsh-th-flash,3s) ease-in-out infinite}',
      '@keyframes dsh-th-breathe{',
      '0%,100%{border-color:var(--dsw-alias-border-l1,rgb(255 255 255 / 14%));box-shadow:0 6px 24px rgb(0 0 0 / 55%)}',
      '50%{border-color:rgba(86,134,254,0.90);',
      'box-shadow:0 6px 24px rgb(0 0 0 / 55%),0 0 0 1px rgba(86,134,254,0.45),0 0 30px rgba(86,134,254,0.55)}}',
      '.dsh-th-head{display:flex;align-items:baseline;gap:6px;min-width:0}',
      '.dsh-th-headLabel{color:var(--dsw-alias-label-tertiary);flex:none}',
      // Tabular numerals plus a reserved width: the figure changes without moving
      // anything around it, so a new value can never read as a flicker. The reserve
      // covers the widest form the figure can take at two decimals (`999.99K`).
      '.dsh-th-headValue{color:var(--dsw-alias-label-primary);font-weight:600;font-size:15px;line-height:20px;',
      'font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1;min-width:5.2em;white-space:nowrap}',
      /* -- the heat ramp, one step per level above zero -------------------- */
      // These five values per theme are duplicated in the inline table below, so
      // the two MUST agree: the stylesheet is a fallback for a cell whose inline
      // background is lost, and a fallback that is a different colour is worse than
      // none. Both lists are means of the same five blues, light to deep.
      '.dsh-th-cell[data-level="1"]{background:var(--dsw-static-deepseek-200,#d3e2ff)}',
      '.dsh-th-cell[data-level="2"]{background:var(--dsw-static-deepseek-300,#b7c8fe)}',
      '.dsh-th-cell[data-level="3"]{background:var(--dsw-static-deepseek-400,#7aaaff)}',
      '.dsh-th-cell[data-level="4"]{background:var(--dsw-static-deepseek-450,#5686fe)}',
      '.dsh-th-cell[data-level="5"]{background:var(--dsw-static-deepseek-500,#4176e6)}',
      'body[data-ds-dark-theme] .dsh-th-cell[data-level="1"]{background:var(--dsw-static-deepseek-800,#34415b)}',
      'body[data-ds-dark-theme] .dsh-th-cell[data-level="2"]{background:var(--dsw-static-deepseek-700-delete,#2f4c8f)}',
      'body[data-ds-dark-theme] .dsh-th-cell[data-level="3"]{background:var(--dsw-static-deepseek-600,#4868b2)}',
      'body[data-ds-dark-theme] .dsh-th-cell[data-level="4"]{background:var(--dsw-static-deepseek-450,#5686fe)}',
      'body[data-ds-dark-theme] .dsh-th-cell[data-level="5"]{background:var(--dsw-static-deepseek-400,#7aaaff)}',
      /* -- grids ---------------------------------------------------------- */
      '.dsh-th-gridWrap{display:flex;align-items:flex-start;gap:5px}',
      '.dsh-th-grid{display:grid;gap:2px;--dsh-th-cell:9px}',
      '.dsh-th-cell{width:var(--dsh-th-cell);height:var(--dsh-th-cell);border-radius:2.5px;flex:none;',
      'background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent);outline:none;cursor:default;',
      'transition:transform .1s ease,box-shadow .1s ease}',
      '.dsh-th-cell[data-pad="true"]{background:transparent}',
      '.dsh-th-cell[data-active="true"]{box-shadow:0 0 0 1.5px var(--dsw-alias-label-primary);transform:scale(1.06)}',
      // Today is marked with an `outline`, not a box-shadow. Both rings are single
      // pixels of emphasis on the same element, and today's cell is hoverable like
      // any other: with two box-shadow rules of equal specificity, the later one
      // (today) won and hovering today produced no visible change at all. An
      // outline is a separate property, so the two can coexist.
      '.dsh-th-cell[data-today="true"]{outline:1.5px solid var(--dsw-alias-brand-primary,#4176e6);outline-offset:0}',
      // The weekday rail labels every row. Each row is cell-sized with visible
      // overflow, because a fixed short row is what clipped the CJK glyphs.
      '.dsh-th-rail{display:flex;flex-direction:column;justify-content:flex-start;gap:2px;flex:none;',
      'width:18px;color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:10px;text-align:left}',
      '.dsh-th-railRow{height:var(--dsh-th-cell,9px);display:flex;align-items:center;justify-content:flex-start;',
      'overflow:visible;white-space:nowrap}',
      '.dsh-th-months{position:relative;height:14px}',
      '.dsh-th-month{position:absolute;top:0;color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:14px;white-space:nowrap}',
      /* -- the expanded panel --------------------------------------------- */
      '.dsh-th-panel{position:fixed;z-index:120;box-sizing:border-box;padding:14px 16px 12px;',
      'border:1px solid var(--dsw-alias-border-l1,rgb(0 0 0 / 10%));border-radius:14px;',
      'background:var(--dsw-alias-bg-overlay,rgb(255 255 255 / 82%));',
      'background-image:linear-gradient(180deg,color-mix(in srgb,var(--dsw-static-neutral-bluish-00,#fff) 62%,transparent),',
      'color-mix(in srgb,var(--dsw-static-neutral-bluish-100,#ebeef2) 46%,transparent));',
      '-webkit-backdrop-filter:blur(22px) saturate(1.5);backdrop-filter:blur(22px) saturate(1.5);',
      'box-shadow:var(--dsw-elevation-prominent,0 18px 48px rgb(0 0 0 / 22%));',
      'color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;text-align:left;',
      'transform-origin:bottom left;animation:dsh-th-open .14s ease-out}',
      '@keyframes dsh-th-open{from{opacity:0;transform:translateY(6px) scale(.99)}to{opacity:1;transform:none}}',
      '@media (prefers-reduced-motion:reduce){',
      '.dsh-th-panel{animation:none}',
      // The pulse is a continuous flash, which is the single most important thing
      // to suppress for anyone who has asked for reduced motion. The animation is
      // created from JavaScript, so the media query cannot cancel it — the script
      // checks the same preference and declines to start it — but the *static*
      // warm state still has to be expressed here, or a running task would be
      // invisible to exactly the users who cannot see it flash.
      '.dsh-th-card[data-running="true"]{animation:none;border-color:rgba(86,134,254,0.90);',
      'box-shadow:0 6px 24px rgb(0 0 0 / 55%),0 0 0 1px rgba(86,134,254,0.45)}',
      '.dsh-th-halo[data-active="true"]{opacity:0.55}',
      '.dsh-th-cell{transition:none}}',
      'body[data-ds-dark-theme] .dsh-th-panel{background:var(--dsw-alias-bg-overlay,rgb(21 21 23 / 78%));',
      'background-image:linear-gradient(180deg,color-mix(in srgb,var(--dsw-static-neutral-bluish-1000,#0f1115) 72%,transparent),',
      'color-mix(in srgb,var(--dsw-static-neutral-bluish-900,#1b1b1c) 52%,transparent));',
      'border-color:var(--dsw-alias-border-l1,rgb(255 255 255 / 12%));',
      'box-shadow:var(--dsw-elevation-prominent,0 18px 48px rgb(0 0 0 / 55%))}',
      '.dsh-th-head2{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 10px}',
      '.dsh-th-title{font-size:13px;line-height:20px;font-weight:600}',
      '.dsh-th-sub{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}',
      '.dsh-th-pills{display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
      '.dsh-th-pill{display:inline-flex;align-items:baseline;gap:4px;padding:2px 7px;border-radius:999px;',
      'background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent);color:var(--dsw-alias-label-secondary)}',
      '.dsh-th-pillValue{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;font-weight:500}',
      '.dsh-th-legend{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:10px;',
      'color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:14px}',
      '.dsh-th-legendScale{display:flex;align-items:center;gap:3px;flex:none}',
      '.dsh-th-readout{display:flex;align-items:baseline;gap:8px;margin-top:8px;min-height:18px;',
      'border-top:1px solid var(--dsw-alias-border-l1,rgb(0 0 0 / 8%));padding-top:8px}',
      'body[data-ds-dark-theme] .dsh-th-readout{border-top-color:var(--dsw-alias-border-l1,rgb(255 255 255 / 10%))}',
      '.dsh-th-readoutDate{color:var(--dsw-alias-label-secondary)}',
      '.dsh-th-readoutValue{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;font-weight:600}',
      '.dsh-th-readoutBreak{color:var(--dsw-alias-label-tertiary)}',
      '.dsh-th-error{color:var(--dsw-alias-state-error-primary);font-size:11px;line-height:16px}',
      '.dsh-th-pending{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}',
    ].join('');

    /**
     * Install the surface stylesheet once per page.
     * @returns nothing.
     */
    function installStyles() {
      if (typeof document === 'undefined') return;
      if (document.querySelector('style[data-dsh-token-heatmap]') !== null) return;
      var tag = document.createElement('style');
      tag.dataset.dshTokenHeatmap = '';
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }
    //#endregion

    //#region formatting
    /**
     * Compact token count using the same shape as the official Turn-usage pill.
     * @param value - token count.
     * @param t - locale seat.
     * @param fixedDigits - when given, show exactly this many decimals instead of
     *   the default variable precision. The live figure passes 2 so that a number
     *   climbing during a Turn visibly moves, rather than sitting on one decimal
     *   and appearing stuck.
     * @returns display string.
     */
    function formatTokens(value, t, fixedDigits) {
      var places = typeof fixedDigits === 'number' && fixedDigits >= 0 ? fixedDigits : null;
      var scaled = function (candidate) {
        if (places !== null) return candidate.toFixed(places);
        return candidate >= 100 ? String(Math.round(candidate)) : String(Math.round(candidate * 10) / 10);
      };
      if (!Number.isFinite(value) || value <= 0) return places === null ? '0' : (0).toFixed(places);
      // A count below a thousand is already exact, so there is nothing to round;
      // padding it to `856.00` would add digits without adding information.
      if (value < 1e3) return String(value);
      if (value < 1e6) return t('number.thousand', { value: scaled(value / 1e3) });
      return t('number.million', { value: scaled(value / 1e6) });
    }

    /**
     * Exact count with locale digit grouping.
     * @param value - token count.
     * @param t - locale seat.
     * @returns grouped digits.
     */
    function formatExact(value, t) {
      var digits = String(Math.max(0, Math.round(value)));
      var groups = [];
      for (var end = digits.length; end > 0; end -= 3) {
        groups.unshift(digits.slice(Math.max(0, end - 3), end));
      }
      return groups.join(t('number.groupSeparator'));
    }

    /**
     * `YYYY-MM-DD` to the locale's short numeric date.
     * @param key - day key.
     * @returns display date.
     */
    function formatDay(key) {
      var parts = String(key).split('-');
      if (parts.length !== 3) return key;
      return parts[0] + '/' + String(Number(parts[1])) + '/' + String(Number(parts[2]));
    }

    /**
     * Relative age of the newest payload.
     * @param generatedAt - payload build time.
     * @returns a short `m`/`s` age.
     */
    function formatAge(generatedAt) {
      var seconds = Math.max(0, Math.round((Date.now() - generatedAt) / 1000));
      if (seconds < 60) return seconds + 's';
      return Math.round(seconds / 60) + 'm';
    }

    /**
     * Weekday index for a day key, without time-zone surprises.
     * @param key - `YYYY-MM-DD`.
     * @returns 0 (Sunday) through 6.
     */
    function weekdayOf(key) {
      var parts = String(key).split('-').map(Number);
      return new Date(parts[0], parts[1] - 1, parts[2]).getDay();
    }

    /**
     * The heat ramp for levels 1 through 5, light to deep, per theme.
     *
     * These are the same five values the stylesheet's `[data-level]` rules carry
     * (see the ramp block in `CSS`). Level 0 is not in the ramp: it renders as a
     * faint neutral, because a day with no usage should read as an empty slot
     * rather than as the lightest step of the scale.
     *
     * Applied as inline backgrounds as well as in the sheet, because artwork that
     * depends on a cascade it does not control is how a colour scale ends up
     * rendering as invisible squares.
     */
    var RAMP_LIGHT = ['#d3e2ff', '#b7c8fe', '#7aaaff', '#5686fe', '#4176e6'];
    var RAMP_DARK = ['#34415b', '#2f4c8f', '#4868b2', '#5686fe', '#7aaaff'];

    /**
     * Whether the page is in the dark theme right now, watched for changes.
     * @returns true while `body[data-ds-dark-theme]` is set.
     */
    function useDarkTheme() {
      var state = React.useState(function () {
        if (typeof document === 'undefined' || document.body === undefined || document.body === null) return false;
        return document.body.hasAttribute('data-ds-dark-theme');
      });
      var dark = state[0];
      var setDark = state[1];
      React.useEffect(function () {
        if (typeof document === 'undefined' || document.body === undefined || document.body === null) return undefined;
        if (typeof MutationObserver !== 'function') return undefined;
        var observer = new MutationObserver(function () {
          setDark(document.body.hasAttribute('data-ds-dark-theme'));
        });
        observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] });
        return function () { observer.disconnect(); };
      }, []);
      return dark;
    }

    /**
     * Inline background for one heat level.
     *
     * Cached per theme so a year grid reuses six objects instead of allocating one
     * per cell on every render. Level 0 is the neutral slot; levels 1 through 5
     * index the ramp directly, so there is no unused entry to drift out of step
     * with the stylesheet.
     * @param level - 0 through 5.
     * @param dark - whether the dark ramp applies.
     * @returns a stable style object.
     */
    var LEVEL_STYLES = { light: null, dark: null };
    function levelStyle(level, dark) {
      var key = dark ? 'dark' : 'light';
      if (LEVEL_STYLES[key] === null) {
        var ramp = dark ? RAMP_DARK : RAMP_LIGHT;
        LEVEL_STYLES[key] = [{ background: 'color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)' }]
          .concat(ramp.map(function (color) { return { background: color }; }));
      }
      var table = LEVEL_STYLES[key];
      var index = Math.min(table.length - 1, Math.max(0, Math.round(metric(level, 0))));
      return table[index];
    }

    /**
     * Half the interval between two flashes, in milliseconds.
     *
     * This is how long one transition takes — deep to lit, or lit to deep — so a
     * full blink cycle is twice this. It is deliberately slow: the window stays on
     * screen for the whole conversation, and a fast flash beside the text someone
     * is reading is worse than no signal at all.
     */
    var FLASH_INTERVAL_MS = 1500;

    /** Length of one full blink cycle: deep, lit, deep. */
    var BREATHE_MS = FLASH_INTERVAL_MS * 2;

    /** How long the light is held at full before it starts to fall back. */
    var FLASH_PEAK_HOLD_MS = 180;

    /**
     * The blink, as data.
     *
     * Both the stylesheet rule and the runtime animation are generated from these
     * keyframes. They were previously written out twice at different durations, so
     * the stylesheet animated on a four-second cycle while the script animated on
     * a one-second one and the two fought over the same properties — which is
     * exactly the uneven, stuttering flash that was reported.
     * @param deep - the resting surface colour.
     * @param lit - the lit surface colour.
     * @param calmBorder - the resting border colour.
     * @param warmBorder - the lit border colour.
     * @param litShadow - the glow at full.
     * @param restShadow - the glow at rest.
     * @returns the keyframes of one cycle.
     */
    function breatheKeyframes(deep, lit, calmBorder, warmBorder, litShadow, restShadow) {
      var peakHold = (FLASH_PEAK_HOLD_MS / BREATHE_MS) / 2;
      return [
        { borderColor: calmBorder, backgroundColor: deep, boxShadow: restShadow, offset: 0 },
        { borderColor: warmBorder, backgroundColor: lit, boxShadow: litShadow, offset: 0.5 - peakHold },
        { borderColor: warmBorder, backgroundColor: lit, boxShadow: litShadow, offset: 0.5 + peakHold },
        { borderColor: calmBorder, backgroundColor: deep, boxShadow: restShadow, offset: 1 },
      ];
    }

    /**
     * Whether the user has asked for reduced motion.
     *
     * Re-read on every pulse transition rather than cached, because the preference
     * can be changed while the page is open.
     * @returns true when a continuous flash should not run.
     */
    function prefersReducedMotion() {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
      try {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches === true;
      } catch {
        return false;
      }
    }

    /**
     * The live treatment: while any session is running the window blinks.
     *
     * Driven through the Web Animations API rather than by an attribute selector,
     * so it cannot be lost to a specificity or ordering fight. Its `active` flag is
     * the process-wide run status: it starts on the first session that begins a
     * Turn — including the moment a command is accepted — and keeps looping until
     * the last session reports that it has stopped, so the final flash belongs to
     * the last answer to finish. It is a state, never a per-event flash.
     *
     * The envelope is symmetric: the rise out of rest is as gradual as the fall
     * back into it, because a flash that vanishes slowly but appears instantly
     * reads as a glitch. Both the blink and the settle also hold their peak
     * briefly before turning, so neither edge snaps. Every frame is **fully
     * opaque**, so the resting surface can never show through mid-pulse.
     * @param node - the card element.
     * @param active - whether a task is currently running.
     * @param dark - whether the dark theme is active.
     * @returns a disposer that cancels the animation.
     */
    function startBreathe(node, active, dark) {
      if (node === null || node === undefined) return function () {};
      if (typeof node.animate !== 'function') return function () {};
      var calmBorder = dark ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.16)';
      var warmBorder = 'rgba(86,134,254,0.90)';
      // Opaque pulse frames: black glass at the trough, blue-lit glass at the peak.
      // Written in the legacy comma form deliberately — it parses identically
      // everywhere a `CSSStyleValue` string is accepted.
      //
      // The trough is the *same literal* the stylesheet rests on. If it differed
      // even slightly, every settle would land somewhere the next one had to
      // correct, which is a seam at each cycle boundary.
      var deep = dark ? 'rgb(5, 5, 6)' : 'rgb(35, 38, 44, 90%)';
      var lit = dark ? 'rgb(30, 44, 82)' : 'rgb(58, 68, 104, 94%)';
      var quiet = '0 6px 24px rgba(0,0,0,0.55)';
      var bright = '0 6px 24px rgba(0,0,0,0.55), 0 0 0 1px rgba(86,134,254,0.45), 0 0 30px rgba(86,134,254,0.55)';
      var animation = node.animate(
        active
          ? breatheKeyframes(deep, lit, calmBorder, warmBorder, bright, quiet)
          : [
            // Settling: the same symmetric envelope, one pass, then held at rest.
            { borderColor: calmBorder, backgroundColor: deep, boxShadow: quiet, offset: 0 },
            { borderColor: warmBorder, backgroundColor: lit, boxShadow: bright, offset: 0.5 },
            { borderColor: calmBorder, backgroundColor: deep, boxShadow: quiet, offset: 1 },
          ],
        {
          duration: active ? BREATHE_MS : BREATHE_MS * 2,
          iterations: active ? Infinity : 1,
          easing: 'ease-in-out',
          // While pulsing, every frame is held so the surface can never fall back
          // to its base value mid-state. Once settled the fill is released instead:
          // holding a literal colour forever would pin the card to a black that is
          // only approximately the resting one, so each cycle would end perched on
          // an off-rest value and the next would start by correcting it.
          fill: active ? 'forwards' : 'none',
        },
      );
      if (animation.finished !== undefined && animation.finished !== null
        && typeof animation.finished.catch === 'function') {
        // A cancelled animation rejects `finished`; that is the expected path.
        animation.finished.catch(function () {});
      }
      return function () {
        if (typeof animation.cancel === 'function') animation.cancel();
      };
    }

    /**
     * The halo behind the window: the live treatment's most legible layer.
     *
     * A blurred blue wash whose opacity follows the same symmetric envelope as the
     * card — a gradual rise out of rest, a held peak, and a gradual fall — so the
     * two layers blink in phase. It sits behind the card, so the glass background
     * can never hide it.
     * @param node - the halo element.
     * @param active - whether a task is currently running.
     * @returns a disposer that cancels the animation.
     */
    function startHalo(node, active) {
      if (node === null || node === undefined) return function () {};
      if (typeof node.animate !== 'function') return function () {};
      var peakHold = (FLASH_PEAK_HOLD_MS / BREATHE_MS) / 2;
      var animation = node.animate(
        active
          ? [
            { opacity: 0.12, offset: 0 },
            { opacity: 1, offset: 0.5 - peakHold },
            { opacity: 1, offset: 0.5 + peakHold },
            { opacity: 0.12, offset: 1 },
          ]
          : [
            { opacity: 0.12, offset: 0 },
            { opacity: 1, offset: 0.5 },
            { opacity: 0, offset: 1 },
          ],
        {
          duration: active ? BREATHE_MS : BREATHE_MS * 2,
          iterations: active ? Infinity : 1,
          easing: 'ease-in-out',
          // Released once settled, for the same reason as the card's surface: the
          // halo must return to its own resting opacity, not to a held literal.
          fill: active ? 'forwards' : 'none',
        },
      );
      if (animation.finished !== undefined && animation.finished !== null
        && typeof animation.finished.catch === 'function') {
        animation.finished.catch(function () {});
      }
      return function () {
        if (typeof animation.cancel === 'function') animation.cancel();
      };
    }
    //#endregion

    //#region geometry
    /** Route the Host half serves; same origin, so a plain fetch is authorized. */
    var ENDPOINT = '/api/dsh-token-heatmap/daily';
    /** Poll interval for the daily aggregate. */
    var POLL_MS = 15000;
    /** Grace period before a pointer leaving both surfaces closes the panel. */
    var CLOSE_DELAY_MS = 220;
    /** Delay before a hover expands the window, so a passing pointer cannot. */
    var HOVER_OPEN_DELAY_MS = 160;
    /** Pointer travel that turns a press into a drag instead of a click. */
    var DRAG_THRESHOLD_PX = 4;
    /** Gap kept between a floating surface and the viewport edges. */
    var VIEWPORT_MARGIN = 12;
    /** Gap between the window and the expanded panel. */
    var ANCHOR_GAP = 8;
    /** Expanded-panel width before viewport clamping. */
    var PANEL_WIDTH = 820;
    /** Cell size of the resting 30-day grid, in pixels. */
    var MINI_CELL = 11;
    /**
     * Columns in the resting grid.
     *
     * Six, not five, and fixed. A 30-day window needs `weekday(first) + 30` cells,
     * which ranges from 30 to 36; five columns of seven hold only 35, so on the one
     * day in seven when the window starts on a Saturday the grid spilled into a
     * sixth *implicit* column and the whole window silently grew wider. Declaring
     * six always holds any window and keeps the window's width constant.
     */
    var MINI_COLUMNS = 6;
    /** Cell size of the expanded year grid, in pixels. */
    var YEAR_CELL = 12;
    /** Expanded-panel height used to decide whether it fits above. */
    var PANEL_MAX_HEIGHT = 320;
    /** Days shown in the resting grid. */
    var MINI_DAYS = 30;
    /** localStorage key holding the dragged position. */
    var POSITION_KEY = 'dsh-token-heatmap.position';
    /** Level palette keyed by the payload's `level`. */
    var LEVELS = [0, 1, 2, 3, 4, 5];

    /**
     * Read the remembered window position.
     * @returns stored coordinates, or `undefined`.
     */
    function readStoredPosition() {
      try {
        if (typeof localStorage === 'undefined') return undefined;
        var raw = localStorage.getItem(POSITION_KEY);
        if (raw === null || raw === undefined) return undefined;
        var parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object') return undefined;
        if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return undefined;
        return { x: parsed.x, y: parsed.y };
      } catch {
        return undefined;
      }
    }

    /**
     * Remember the window position.
     * @param position - coordinates to store.
     * @returns nothing.
     */
    function storePosition(position) {
      try {
        if (typeof localStorage === 'undefined') return;
        localStorage.setItem(POSITION_KEY, JSON.stringify(position));
      } catch {
        /* private mode or a full quota; the position is simply not remembered */
      }
    }

    /**
     * Read a viewport metric, refusing anything that is not a finite number.
     *
     * This matters more than it looks: a missing metric reaching the clamp
     * arithmetic as `undefined` yields `NaN`, and a `NaN` inside a `transform`
     * makes the whole declaration invalid — the element is then dropped from
     * layout and the window is simply not there. Every geometry read goes here.
     * @param value - candidate metric.
     * @param fallback - value used when the metric is unusable.
     * @returns a finite number, or the fallback.
     */
    function metric(value, fallback) {
      return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    }

    /**
     * The viewport width in CSS pixels.
     * @returns a finite width.
     */
    function viewportWidth() {
      if (typeof window === 'undefined') return 1024;
      var doc = typeof document === 'undefined' ? undefined : document.documentElement;
      var fromDocument = doc === undefined || doc === null ? undefined : metric(doc.clientWidth, undefined);
      return Math.max(240, metric(metric(window.innerWidth, undefined), metric(fromDocument, 1024)));
    }

    /**
     * The viewport height in CSS pixels.
     * @returns a finite height.
     */
    function viewportHeight() {
      if (typeof window === 'undefined') return 768;
      var doc = typeof document === 'undefined' ? undefined : document.documentElement;
      var fromDocument = doc === undefined || doc === null ? undefined : metric(doc.clientHeight, undefined);
      return Math.max(240, metric(metric(window.innerHeight, undefined), metric(fromDocument, 768)));
    }

    /**
     * Keep a coordinate inside the viewport, tolerating a missing element size.
     * @param value - requested coordinate.
     * @param size - element extent along that axis.
     * @param viewport - viewport extent along that axis.
     * @returns the clamped coordinate, always finite.
     */
    function clampCoordinate(value, size, viewport) {
      var span = metric(viewport, 1024);
      var extent = Math.max(0, metric(size, 0));
      var limit = Math.max(VIEWPORT_MARGIN, span - extent - VIEWPORT_MARGIN);
      var requested = metric(value, VIEWPORT_MARGIN);
      return Math.round(Math.min(Math.max(VIEWPORT_MARGIN, requested), limit));
    }

    /**
     * Whether both coordinates of a position are usable.
     * @param position - candidate position.
     * @returns true when it can be written to CSS.
     */
    function isPlaced(position) {
      return position !== null
        && position !== undefined
        && Number.isFinite(position.x)
        && Number.isFinite(position.y);
    }

    /**
     * Default position: the conversation's lower-left corner, clear of a
     * collapsible sidebar and of the composer.
     * @returns starting coordinates.
     */
    function defaultPosition() {
      var width = viewportWidth();
      var height = viewportHeight();
      return {
        x: width < 900 ? 20 : 300,
        y: Math.max(VIEWPORT_MARGIN, Math.round(height * 0.62)),
      };
    }

    /**
     * Offset between an element's intended viewport coordinates and where it
     * actually lands.
     *
     * A `position: fixed` element is normally laid out against the viewport, but
     * any ancestor with a transform, filter, perspective, backdrop-filter or
     * contain becomes its containing block instead — and the frame-wide overlay
     * layer is exactly the kind of element that can grow one. When that happens
     * the window is silently drawn somewhere else, which reads as "the widget
     * vanished". Measuring the discrepancy and subtracting it pins the window to
     * the coordinates it asked for, whatever the ancestor does.
     * @param node - the positioned element.
     * @param intended - the viewport coordinates it should occupy.
     * @param applied - the shift currently in effect, which is part of its style.
     * @returns the corrected shift, or `null` when it cannot be measured.
     */
    function measureShift(node, intended, applied) {
      if (node === null || node === undefined || typeof node.getBoundingClientRect !== 'function') return null;
      if (!isPlaced(intended)) return null;
      var rect = node.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return null;
      var shiftX = intended.x - rect.left + applied.x;
      var shiftY = intended.y - rect.top + applied.y;
      if (!Number.isFinite(shiftX) || !Number.isFinite(shiftY)) return null;
      return { x: Math.round(shiftX), y: Math.round(shiftY) };
    }

    /**
     * Walk up from an element and return the root of a transformed subtree, which
     * is the containing block a fixed descendant is laid out against.
     * @param node - starting element.
     * @returns the containing-block element, or `null` for the viewport.
     */
    function findShiftedAncestor(node) {
      if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') return null;
      var current = node === null || node === undefined ? null : node.parentElement;
      while (current !== null && current !== undefined) {
        var style = window.getComputedStyle(current);
        if (style === null || style === undefined) return null;
        var transform = style.transform;
        var hasTransform = typeof transform === 'string' && transform !== '' && transform !== 'none';
        var filter = style.filter;
        var hasFilter = typeof filter === 'string' && filter !== '' && filter !== 'none';
        var backdrop = style.backdropFilter;
        var hasBackdrop = typeof backdrop === 'string' && backdrop !== '' && backdrop !== 'none';
        var perspective = style.perspective;
        var hasPerspective = typeof perspective === 'string' && perspective !== '' && perspective !== 'none';
        var contain = style.contain;
        var hasContain = typeof contain === 'string'
          && (contain.indexOf('paint') >= 0 || contain.indexOf('layout') >= 0
            || contain.indexOf('strict') >= 0 || contain.indexOf('content') >= 0);
        var willChange = style.willChange;
        var hasWillChange = typeof willChange === 'string'
          && (willChange.indexOf('transform') >= 0 || willChange.indexOf('filter') >= 0
            || willChange.indexOf('perspective') >= 0);
        if (hasTransform || hasFilter || hasBackdrop || hasPerspective || hasContain || hasWillChange) return current;
        current = current.parentElement;
      }
      return null;
    }

    /**
     * Place the expanded panel above the window, clamped into the viewport.
     * @param card - the window's element.
     * @returns fixed coordinates and width, or `null` when unmeasurable.
     */
    function placePanel(card) {
      if (card === null || card === undefined) return null;
      if (typeof card.getBoundingClientRect !== 'function') return null;
      var rect = card.getBoundingClientRect();
      var width = viewportWidth();
      var height = viewportHeight();
      var panelWidth = Math.min(PANEL_WIDTH, Math.max(240, width - VIEWPORT_MARGIN * 2));
      var left = clampCoordinate(rect.left, panelWidth, width);
      var above = rect.top - ANCHOR_GAP;
      if (above >= PANEL_MAX_HEIGHT) {
        return { left: left, bottom: Math.round(height - above), width: Math.round(panelWidth) };
      }
      // Not enough room above (a short or scrolled viewport): drop it below.
      return {
        left: left,
        top: clampCoordinate(rect.bottom + ANCHOR_GAP, PANEL_MAX_HEIGHT, height),
        width: Math.round(panelWidth),
      };
    }

    /**
     * Inline style for a placed panel.
     * @param position - measured coordinates.
     * @returns a style object, or `undefined` when unmeasured.
     */
    function panelStyle(position) {
      if (position === null || position === undefined) return undefined;
      var style = { left: position.left + 'px', width: position.width + 'px' };
      if (position.bottom !== undefined) style.bottom = position.bottom + 'px';
      if (position.top !== undefined) style.top = position.top + 'px';
      return style;
    }

    /**
     * Fetch the daily aggregate.
     * @param signal - cancellation.
     * @returns the payload.
     */
    async function fetchDaily(signal) {
      var response = await fetch(ENDPOINT, { signal: signal, headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    }

    //#region data cache
    /**
     * The last payload the Host served, held outside the component.
     *
     * This is what makes the display continuous. The figures and the heatmap are
     * rendered from here whenever they exist, so neither a re-render nor a fresh
     * mount can blank them: the only moment there is nothing to show is before the
     * very first response of the page's lifetime. Without it, a refresh that
     * re-initialised the component's state would show `-` and an empty grid for a
     * moment and then restore both, which reads as a flicker.
     */
    var lastPayload = null;

    /** In-flight request, shared by every caller that arrives while it runs. */
    var inflight = null;

    /** When the cached payload was stored, in epoch milliseconds. */
    var lastPayloadAt = 0;

    /** Bumped on every publish; a cheap subscription token for the component. */
    var payloadVersion = 0;

    /** Listeners waiting for the next publish. */
    var payloadListeners = new Set();

    /**
     * Publish a payload to every subscriber.
     * @param payload - the payload to store and announce.
     * @returns nothing.
     */
    function publishPayload(payload) {
      lastPayload = payload;
      lastPayloadAt = Date.now();
      payloadVersion += 1;
      for (var listener of payloadListeners) {
        try {
          listener();
        } catch {
          /* one bad subscriber must not stop the others */
        }
      }
    }

    /**
     * Subscribe to payload publishes.
     * @param listener - called after every publish.
     * @returns the unsubscriber.
     */
    function subscribePayload(listener) {
      payloadListeners.add(listener);
      return function () { payloadListeners.delete(listener); };
    }

    /**
     * The payload the surface should render.
     *
     * Read straight from the module store at render time instead of from component
     * state. That is the whole point: there is no intermediate value to transition
     * through, so a refresh can only ever replace a number with a number. The only
     * moment this is `null` is before the page's first response.
     * @returns the newest payload known, or `null`.
     */
    function currentPayload() {
      return lastPayload;
    }

    /**
     * How long a cached payload is served without asking again.
     *
     * The poll, the session-event refresh and a remount can all request data at
     * nearly the same moment; sharing one answer keeps that from becoming a burst
     * of requests and, more importantly, keeps every caller reading the same
     * numbers.
     */
    var CACHE_TTL_MS = 1500;

    /**
     * Read the daily aggregate, through the shared cache.
     * @param options - call options.
     * @param options.force - bypass the freshness window.
     * @param options.signal - cancellation for a request this call starts.
     * @returns the newest payload known.
     */
    function loadDaily(options) {
      var force = options !== undefined && options.force === true;
      var signal = options === undefined ? undefined : options.signal;
      var now = Date.now();
      if (!force && lastPayload !== null && now - lastPayloadAt < CACHE_TTL_MS) {
        return Promise.resolve(lastPayload);
      }
      if (inflight !== null) return inflight;
      inflight = fetchDaily(signal).then(function (payload) {
        publishPayload(payload);
        inflight = null;
        return payload;
      }).catch(function (error) {
        inflight = null;
        throw error;
      });
      return inflight;
    }

    //#endregion

    //#region view
    /**
     * One heatmap cell.
     * @param props - cell props.
     * @returns the cell element.
     */
    function Cell(props) {
      var day = props.day;
      if (day === undefined) {
        return h('div', { className: 'dsh-th-cell', 'data-pad': 'true' });
      }
      return h('div', {
        className: 'dsh-th-cell',
        'data-level': String(day.level || 0),
        'data-today': day.today === true ? 'true' : undefined,
        'data-active': props.active === true ? 'true' : undefined,
        // The level colour is inline as well as in the stylesheet: the ramp is
        // artwork, and it must not be possible for another rule to blank it.
        style: levelStyle(day.level || 0, props.dark === true),
        tabIndex: props.tabbable === true ? 0 : -1,
        role: 'gridcell',
        'aria-label': props.label,
        title: props.label,
        onMouseEnter: function () { props.onHover(day.date); },
        onMouseLeave: function () { props.onHover(null); },
        onFocus: function () { props.onHover(day.date); },
        onBlur: function () { props.onHover(null); },
      });
    }

    /**
     * A weekday-by-week heatmap grid.
     *
     * Days are laid out in real calendar columns — the 30-day view is a month
     * block and the year view is the familiar 53-column contribution graph — so a
     * column always means the same weekday.
     * @param props - grid props.
     * @returns the grid block.
     */
    function HeatGrid(props) {
      var days = props.days || [];
      var cell = props.cell || 9;
      var columns = props.columns;

      // Real calendar columns: pad the head so day one lands on its weekday.
      var first = days.length === 0 ? null : days[0];
      var lead = first === null ? 0 : weekdayOf(first.date);
      var cells = [];
      for (var pad = 0; pad < lead; pad += 1) cells.push(h(Cell, { key: 'lead-' + pad }));
      for (var index = 0; index < days.length; index += 1) {
        var day = days[index];
        cells.push(h(Cell, {
          key: day.date,
          day: day,
          active: props.hovered === day.date,
          tabbable: props.focusDate === day.date,
          dark: props.dark,
          label: props.labelOf(day),
          onHover: props.onHover,
        }));
      }
      // The declared column count must be able to hold the content. A caller that
      // asks for fewer columns than the window needs would otherwise get an
      // implicit extra column, which is sized by the grid rather than by us and
      // visibly changes the block's width.
      var needed = Math.ceil(cells.length / 7);
      var cols = columns === undefined ? Math.max(1, needed) : Math.max(columns, needed);
      if (columns !== undefined) {
        var total = cols * 7;
        for (var tail = cells.length; tail < total; tail += 1) cells.push(h(Cell, { key: 'tail-' + tail }));
      }

      // The rail labels every weekday row. Rows are cell-sized with visible
      // overflow: a fixed short row is what swallowed the CJK glyphs.
      var weekdays = (props.weekdays || ['日', '一', '二', '三', '四', '五', '六']).slice();
      var rail = h('div', {
        key: 'rail',
        className: 'dsh-th-rail',
        style: { '--dsh-th-cell': cell + 'px' },
        'aria-hidden': 'true',
      }, weekdays.map(function (label, row) {
        return h('div', { key: 'r-' + row, className: 'dsh-th-railRow' }, label);
      }));

      var gridStyle = { '--dsh-th-cell': cell + 'px' };
      gridStyle.gridTemplateColumns = 'repeat(' + cols + ', ' + cell + 'px)';
      gridStyle.gridTemplateRows = 'repeat(7, ' + cell + 'px)';
      gridStyle.gridAutoFlow = 'column';

      return h('div', { className: 'dsh-th-gridWrap' }, [
        rail,
        h('div', {
          key: 'grid',
          className: 'dsh-th-grid',
          style: gridStyle,
          role: 'grid',
          'aria-label': props.gridLabel,
          onKeyDown: props.onKeyDown,
        }, cells),
      ]);
    }

    /**
     * Month captions above a year grid.
     * @param props - caption props.
     * @returns the caption rail.
     */
    function MonthRail(props) {
      var pitch = props.cell + 2;
      var charPx = 6;
      var captionEnd = -Infinity;
      return h('div', {
        className: 'dsh-th-months',
        style: { marginLeft: '23px' },
        'aria-hidden': 'true',
      }, (props.months || []).map(function (month, index) {
        var left = month.column * pitch;
        if (left < captionEnd + 2) return null;
        captionEnd = left + String(month.label).length * charPx * 0.6;
        return h('span', { key: 'm-' + index, className: 'dsh-th-month', style: { left: left + 'px' } }, month.label);
      }));
    }

    /**
     * The hovered-day readout line.
     * @param props - readout props.
     * @returns the readout element.
     */
    function Readout(props) {
      var t = props.t;
      var day = props.day;
      if (day === undefined || day === null) {
        return h('div', { className: 'dsh-th-readout' },
          h('span', { className: 'dsh-th-readoutDate' }, t('hover.hint')));
      }
      var parts = [
        h('span', { key: 'd', className: 'dsh-th-readoutDate' }, formatDay(day.date)),
        h('span', { key: 'v', className: 'dsh-th-readoutValue' }, formatExact(day.tokens, t) + ' ' + t('unit.tokens')),
      ];
      if (day.tokens > 0) {
        parts.push(h('span', { key: 'b', className: 'dsh-th-readoutBreak' }, t('hover.breakdown', {
          input: formatTokens(day.uncachedInputTokens, t),
          read: formatTokens(day.cacheReadTokens, t),
          output: formatTokens(day.outputTokens, t),
        })));
      }
      return h('div', { className: 'dsh-th-readout' }, parts);
    }

    /**
     * One legend swatch.
     *
     * Every property that makes it visible is set here, inline: size, radius,
     * background and flex behaviour. Sharing `.dsh-th-cell` with the grid made the
     * swatches depend on a variable and a cascade the legend does not control, and
     * the observable result was an empty scale beside 少/多. A swatch is artwork,
     * so it carries its own geometry.
     * @param props - swatch props.
     * @returns the swatch element.
     */
    function LegendSwatch(props) {
      var size = 10;
      return h('span', {
        className: 'dsh-th-swatch',
        'aria-hidden': 'true',
        style: {
          display: 'inline-block',
          flex: '0 0 auto',
          width: size + 'px',
          height: size + 'px',
          minWidth: size + 'px',
          minHeight: size + 'px',
          borderRadius: '2.5px',
          boxSizing: 'border-box',
          ...levelStyle(props.level, props.dark === true),
        },
      });
    }

    /**
     * One stat pill.
     * @param label - pill label.
     * @param value - pill value.
     * @param key - React key.
     * @returns the pill element.
     */
    function pill(label, value, key) {
      return h('span', { key: key, className: 'dsh-th-pill' }, [
        h('span', { key: 'l' }, label),
        h('span', { key: 'v', className: 'dsh-th-pillValue' }, value),
      ]);
    }

    /**
     * The expanded year panel.
     * @param props - panel props.
     * @returns the panel element.
     */
    function Panel(props) {
      var t = props.t;
      var payload = props.payload;
      var totals = payload.totals || {};
      var streak = totals.streak || { current: 0, longest: 0 };
      var best = totals.bestDay;
      var days = payload.days || [];
      var weekdays = payload.calendars === undefined || payload.calendars === null
        ? undefined
        : payload.calendars.weekdays;

      var lastActive = -1;
      for (var scan = days.length - 1; scan >= 0; scan -= 1) {
        if (days[scan].tokens > 0) { lastActive = scan; break; }
      }
      var tabbableDate = props.focusDate !== null && props.focusDate !== undefined
        ? props.focusDate
        : (lastActive === -1 ? null : days[lastActive].date);

      return h('div', {
        className: 'dsh-th-panel',
        ref: props.panelRef,
        role: 'dialog',
        'aria-label': t('panel.title'),
        style: panelStyle(props.pos),
        // The panel is a fixed sibling of the window, not a descendant, so the
        // window's own leave event fires as the pointer arrives here. Reporting
        // this surface separately is what keeps the panel open.
        onPointerEnter: props.onPanelEnter,
        onPointerLeave: props.onPanelLeave,
      }, [
        h('div', { key: 'head', className: 'dsh-th-head2' }, [
          h('div', { key: 'title' }, [
            h('div', { key: 't', className: 'dsh-th-title' }, t('panel.title')),
            h('div', { key: 's', className: 'dsh-th-sub' }, t('panel.subtitle', {
              from: formatDay(payload.range.from),
              to: formatDay(payload.range.to),
            })),
          ]),
          h('div', { key: 'pills', className: 'dsh-th-pills' }, [
            pill(t('stat.total'), formatTokens(totals.tokens || 0, t), 'total'),
            pill(t('stat.activeDays'), String(totals.activeDays || 0), 'active'),
            pill(t('stat.average'), formatTokens(totals.averagePerActiveDay || 0, t), 'average'),
            pill(t('stat.streak'), String(streak.current || 0), 'streak'),
            pill(t('stat.best'), best === null || best === undefined ? '-' : formatTokens(best.tokens, t), 'best'),
          ]),
        ]),
        h(MonthRail, {
          key: 'months',
          cell: YEAR_CELL,
          months: (payload.calendars && payload.calendars.months) || [],
        }),
        h(HeatGrid, {
          key: 'grid',
          days: days,
          cell: YEAR_CELL,
          weekdays: weekdays,
          dark: props.dark,
          hovered: props.hovered,
          focusDate: tabbableDate,
          onHover: props.onHover,
          onKeyDown: props.onKeyDown,
          labelOf: props.labelOf,
          gridLabel: t('panel.gridLabel'),
        }),
        h('div', { key: 'legend', className: 'dsh-th-legend' }, [
          h('span', { key: 'left' }, t('legend.longest', { days: String(streak.longest || 0) })),
          h('span', { key: 'right', className: 'dsh-th-legendScale' }, [
            h('span', { key: 'less' }, t('legend.less')),
            LEVELS.map(function (level) {
              return h(LegendSwatch, { key: 'l-' + level, level: level, dark: props.dark === true });
            }),
            h('span', { key: 'more' }, t('legend.more')),
          ]),
        ]),
        h(Readout, { key: 'readout', t: t, day: props.hoveredDay }),
        // A stale-but-real payload can carry an error from a later failed scan, so
        // this is shown whenever one is present rather than only when data is gone.
        props.hostError === null || props.hostError === undefined ? null : h('div', {
          key: 'hostError',
          className: 'dsh-th-error',
          style: { marginTop: '6px' },
          title: props.hostError,
        }, t('state.error', { message: props.hostError })),
        h('div', { key: 'meta', className: 'dsh-th-sub', style: { marginTop: '6px' } }, t('panel.meta', {
          sessions: String(props.sessionCount),
          updated: formatAge(payload.generatedAt),
        })),
      ]);
    }

    /**
     * The draggable floating window: today's usage over a 30-day grid, growing a
     * full-year panel on hover.
     * @param props - injected props.
     * @returns the window element.
     */
    function TokenHeatmap(props) {
      var t = props.t;
      var rootRef = React.useRef(null);
      var cardRef = React.useRef(null);
      var haloRef = React.useRef(null);
      var panelRef = React.useRef(null);
      var closeTimer = React.useRef(null);
      var openTimer = React.useRef(null);
      var dragState = React.useRef(null);
      var anchorRef = React.useRef(null);
      var shiftRef = React.useRef({ x: 0, y: 0 });
      var livePosition = React.useRef({ x: null, y: null });
      var draggingRef = React.useRef(false);
      var hoverCardRef = React.useRef(false);
      var hoverPanelRef = React.useRef(false);

      var drag = React.useState(function () {
        return readStoredPosition() || { x: null, y: null };
      });
      var position = drag[0];
      var setPosition = drag[1];
      var forceTick = React.useState(0);
      var bump = forceTick[1];
      // The figures come from the module store, subscribed to by version. There is
      // deliberately no `status`/`payload` component state for them: a state
      // transition is a value that has to be rendered on the way through, and that
      // is what produced the `-`.
      var versionState = React.useState(payloadVersion);
      var payloadVersionSeen = versionState[0];
      var setPayloadVersionSeen = versionState[1];
      React.useEffect(function () {
        return subscribePayload(function () {
          setPayloadVersionSeen(function (previous) {
            return payloadVersion === previous ? previous : payloadVersion;
          });
        });
      }, []);
      var fetchErrorState = React.useState(null);
      var fetchError = fetchErrorState[0];
      var setFetchError = fetchErrorState[1];
      var draggingState = React.useState(false);
      var dragging = draggingState[0];
      var setDragging = draggingState[1];
      var minimizedState = React.useState(false);
      var minimized = minimizedState[0];
      var setMinimized = minimizedState[1];
      var openState = React.useState(false);
      var open = openState[0];
      var setOpen = openState[1];
      var hoveredState = React.useState(null);
      var hovered = hoveredState[0];
      var setHovered = hoveredState[1];
      var runningState = React.useState(false);
      var running = runningState[0];
      var setRunning = runningState[1];
      var panelPosState = React.useState(null);
      var panelPos = panelPosState[0];
      var setPanelPos = panelPosState[1];
      // Theme is watched rather than inferred, so the inline heat ramp follows a
      // live light/dark switch instead of freezing at whatever it was on mount.
      var dark = useDarkTheme();

      // The breathe is imperative on purpose: created when consumption starts,
      // cancelled when it ends, and re-created when the theme changes. It retries
      // on the next frame when the element is not attached yet, because a live
      // signal that silently finds no node is a live signal that never appears.
      //
      // Only the card's own surface and the halo behind it animate. Nothing inside
      // the window is animated, so a value change can never restart anything.
      //
      // This effect reacts to a *transition*, not to its dependencies: a single
      // animation is created when the pulse turns on and cancelled when it turns
      // off, so the rhythm cannot be interrupted while it runs. Rebuilding it on
      // every state change is what produced the irregular flashing.
      React.useEffect(function () {
        var disposeBreathe = null;
        var disposeHalo = null;
        var attach = function () {
          // Reduced motion: decline to start the flash at all. The stylesheet's
          // `prefers-reduced-motion` block supplies a static warm border instead,
          // so a running task is still legible without anything blinking.
          if (prefersReducedMotion()) return;
          disposeBreathe = startBreathe(cardRef.current, running, dark);
          disposeHalo = startHalo(haloRef.current, running);
        };
        if (cardRef.current !== null && cardRef.current !== undefined
          && haloRef.current !== null && haloRef.current !== undefined) {
          attach();
          return function () {
            if (disposeBreathe !== null) disposeBreathe();
            if (disposeHalo !== null) disposeHalo();
          };
        }
        // Not mounted yet: retry once on the next frame rather than silently doing
        // nothing, because a live signal that finds no node never appears.
        if (typeof requestAnimationFrame !== 'function') return undefined;
        var frame = requestAnimationFrame(attach);
        return function () {
          cancelAnimationFrame(frame);
          if (disposeBreathe !== null) disposeBreathe();
          if (disposeHalo !== null) disposeHalo();
        };
      }, [running, dark]);

      livePosition.current = position;

      /**
       * Write viewport coordinates onto the positioning wrapper.
       * @param next - intended coordinates.
       * @returns nothing.
       */
      function applyPosition(next) {
        var node = anchorRef.current;
        if (node === null || node === undefined || !isPlaced(next)) return;
        node.style.setProperty('--dsh-th-x', next.x + 'px');
        node.style.setProperty('--dsh-th-y', next.y + 'px');
      }

      /**
       * Write the containing-block correction onto the root, where the wrapper
       * inherits it as a custom property.
       * @param shift - correction to apply.
       * @returns nothing.
       */
      function applyShift(shift) {
        var node = rootRef.current;
        if (node === null || node === undefined) return;
        node.style.setProperty('--dsh-th-shift-x', shift.x + 'px');
        node.style.setProperty('--dsh-th-shift-y', shift.y + 'px');
        // The stylesheet's fallback animation reads its duration from here, so the
        // declared rhythm and the scripted one are the same number by construction.
        node.style.setProperty('--dsh-th-flash', BREATHE_MS + 'ms');
      }

      /**
       * Resolve the containing-block offset by inspecting ancestors.
       * @returns nothing.
       */
      function seedShift() {
        var node = rootRef.current;
        if (node === null || node === undefined || typeof document === 'undefined') return;
        var block = findShiftedAncestor(node);
        if (block === null) return;
        var rect = block.getBoundingClientRect();
        if (!Number.isFinite(rect.left) || !Number.isFinite(rect.top)) return;
        if (Math.abs(rect.left) < 0.5 && Math.abs(rect.top) < 0.5) return;
        shiftRef.current = { x: -Math.round(rect.left), y: -Math.round(rect.top) };
        applyShift(shiftRef.current);
      }

      /**
       * Verify the wrapper landed where it was asked to and absorb what is left.
       * @returns nothing.
       */
      function settleAnchor() {
        if (draggingRef.current) return;
        var measured = measureShift(anchorRef.current, livePosition.current, shiftRef.current);
        if (measured === null) return;
        if (measured.x === shiftRef.current.x && measured.y === shiftRef.current.y) return;
        shiftRef.current = measured;
        applyShift(measured);
        applyPosition(livePosition.current);
      }

      /**
       * Commit a position to state and to the element.
       * @param next - coordinates to commit.
       * @returns nothing.
       */
      function commitPosition(next) {
        livePosition.current = next;
        applyPosition(next);
        setPosition(next);
      }

      /**
       * Show the panel, restarting the hover delay.
       * @returns nothing.
       */
      function enter() {
        if (draggingRef.current) return;
        if (closeTimer.current !== null) { clearTimeout(closeTimer.current); closeTimer.current = null; }
        if (open || openTimer.current !== null) return;
        openTimer.current = setTimeout(function () {
          openTimer.current = null;
          setOpen(true);
          bump(function (value) { return value + 1; });
        }, HOVER_OPEN_DELAY_MS);
      }

      /**
       * Note that one surface lost the pointer, closing only once both are clear.
       * @param which - `'card'` or `'panel'`.
       * @returns nothing.
       */
      function leave(which) {
        if (which === 'card') hoverCardRef.current = false;
        else hoverPanelRef.current = false;
        if (draggingRef.current) return;
        if (hoverCardRef.current || hoverPanelRef.current) return;
        if (openTimer.current !== null) { clearTimeout(openTimer.current); openTimer.current = null; }
        if (closeTimer.current !== null) clearTimeout(closeTimer.current);
        closeTimer.current = setTimeout(function () {
          closeTimer.current = null;
          if (hoverCardRef.current || hoverPanelRef.current || draggingRef.current) return;
          setOpen(false);
          setHovered(null);
        }, CLOSE_DELAY_MS);
      }

      /**
       * Note that one surface gained the pointer.
       * @param which - `'card'` or `'panel'`.
       * @returns nothing.
       */
      function enterSurface(which) {
        if (which === 'card') hoverCardRef.current = true;
        else hoverPanelRef.current = true;
        enter();
      }

      /**
       * Begin a drag. The window re-measures itself first so the grab offset is
       * the pointer's real offset rather than a stored guess.
       * @param event - pointer event on the window.
       * @returns nothing.
       */
      function onPointerDown(event) {
        if (event.button !== undefined && event.button !== 0) return;
        var node = cardRef.current;
        if (node === null || node === undefined) return;
        var rect = node.getBoundingClientRect();
        var captured = false;
        if (typeof node.setPointerCapture === 'function') {
          try {
            node.setPointerCapture(event.pointerId);
            captured = true;
          } catch {
            captured = false;
          }
        }
        dragState.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          originX: rect.left,
          originY: rect.top,
          width: rect.width,
          height: rect.height,
          moved: false,
          captured: captured,
        };
      }

      // Seed the containing-block correction and the starting position.
      //
      // Both belong in a layout effect: a passive effect runs after the browser
      // has painted, so a first paint at the viewport origin is visible as the
      // window flashing in the corner — or, when the overlay clips, as the window
      // never appearing at all.
      useLayoutEffect(function () {
        seedShift();
        if (isPlaced(livePosition.current)) {
          var remeasured = measureShift(anchorRef.current, livePosition.current, shiftRef.current);
          if (remeasured !== null
            && (remeasured.x !== shiftRef.current.x || remeasured.y !== shiftRef.current.y)) {
            shiftRef.current = remeasured;
            applyShift(remeasured);
          }
          applyPosition(livePosition.current);
          return;
        }
        var cardRect = cardRef.current === null || cardRef.current === undefined
          ? null
          : cardRef.current.getBoundingClientRect();
        var width = cardRect === null || cardRect.width === 0 ? 200 : cardRect.width;
        var height = cardRect === null || cardRect.height === 0 ? 90 : cardRect.height;
        var base = defaultPosition();
        commitPosition({
          x: clampCoordinate(base.x, width, viewportWidth()),
          y: clampCoordinate(base.y, height, viewportHeight()),
        });
        settleAnchor();
      }, []);

      // Drag transport. Pointer capture keeps every move addressed to the window
      // even when the pointer outruns it, and a direct custom-property write keeps
      // the window pinned to the pointer instead of to the render loop.
      useLayoutEffect(function () {
        var onMove = function (event) {
          var live = dragState.current;
          if (live === null || event.pointerId !== live.pointerId) return;
          var dx = event.clientX - live.startX;
          var dy = event.clientY - live.startY;
          if (!live.moved) {
            if (Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD_PX) return;
            live.moved = true;
            draggingRef.current = true;
            setDragging(true);
            setOpen(false);
            if (openTimer.current !== null) { clearTimeout(openTimer.current); openTimer.current = null; }
          }
          var next = {
            x: clampCoordinate(live.originX + dx, live.width, viewportWidth()),
            y: clampCoordinate(live.originY + dy, live.height, viewportHeight()),
          };
          livePosition.current = next;
          applyPosition(next);
        };
        var onUp = function (event) {
          var live = dragState.current;
          if (live === null || event.pointerId !== live.pointerId) return;
          dragState.current = null;
          var node = cardRef.current;
          if (node !== null && node !== undefined && live.captured
            && typeof node.releasePointerCapture === 'function') {
            try { node.releasePointerCapture(live.pointerId); } catch { /* already released */ }
          }
          draggingRef.current = false;
          setDragging(false);
          if (!live.moved) return;
          var committed = livePosition.current;
          if (isPlaced(committed)) {
            storePosition({ x: committed.x, y: committed.y });
            setPosition({ x: committed.x, y: committed.y });
          }
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
        return function () {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          window.removeEventListener('pointercancel', onUp);
        };
      }, []);

      // A late layout pass (fonts, a sidebar transition, a panel appearing) can
      // change the containing block, so the anchor is re-confirmed on resize and
      // once more after the first frame.
      React.useEffect(function () {
        var onResize = function () {
          if (draggingRef.current) return;
          var previous = livePosition.current;
          if (isPlaced(previous)) {
            var rect = cardRef.current === null || cardRef.current === undefined
              ? null
              : cardRef.current.getBoundingClientRect();
            var next = {
              x: clampCoordinate(previous.x, rect === null ? 200 : rect.width, viewportWidth()),
              y: clampCoordinate(previous.y, rect === null ? 90 : rect.height, viewportHeight()),
            };
            livePosition.current = next;
            applyPosition(next);
            setPosition(next);
          }
          settleAnchor();
        };
        window.addEventListener('resize', onResize);
        var frame = typeof requestAnimationFrame === 'function'
          ? requestAnimationFrame(function () { settleAnchor(); })
          : null;
        return function () {
          window.removeEventListener('resize', onResize);
          if (frame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
        };
      }, []);

      // Data: one poll, plus a refresh after any committed session event. Every
      // result is published to the module store, which is what the surface renders
      // from — nothing here touches component state, so there is no intermediate
      // value for the figure to display on its way from one number to the next.
      React.useEffect(function () {
        var controller = new AbortController();
        var disposed = false;
        var load = function (force) {
          loadDaily({ force: force, signal: controller.signal }).then(function () {
            if (disposed) return;
            setFetchError(null);
          }).catch(function (error) {
            if (disposed || controller.signal.aborted) return;
            // Only surface a failure when there is nothing on screen to keep.
            if (lastPayload === null) {
              setFetchError(error && error.message ? error.message : String(error));
            }
          });
        };
        load(true);
        var timer = setInterval(function () { load(false); }, POLL_MS);
        return function () {
          disposed = true;
          clearInterval(timer);
          controller.abort();
        };
      }, []);

      // ── the primary live signal: is ANY session running? ──────────────────
      //
      // The pulse is a statement about the Harness, not about this Session: it
      // must start the moment a command arrives and stop only once every
      // conversation has finished. So it follows the process-wide run status the
      // Session Controller broadcasts (`api-session/status`), tracking one flag
      // per session id and pulsing while the set is non-empty. That makes the
      // start exact — the first `running: true` — and the end exact, because the
      // last session's `running: false` arrives when its Turn closes.
      React.useEffect(function () {
        // `remote` arrives as a prop rather than being closed over: the component
        // must not reach for a context it does not own, and a prop is what the
        // slot inject actually provides.
        var remote = props.remote;
        if (remote === undefined || remote === null || typeof remote.$on !== 'function') return undefined;
        var runningIds = new Set();
        var unsubscribe = remote.$on('api-session/status', function (sessionId, isRunning) {
          var key = sessionId === undefined || sessionId === null ? 'unknown' : String(sessionId);
          if (isRunning) runningIds.add(key);
          else runningIds.delete(key);
          setRunning(runningIds.size > 0);
        });
        return function () {
          if (typeof unsubscribe === 'function') unsubscribe();
        };
      }, []);

      // The token figures follow this Session's own committed events, and the
      // refetch is scheduled from the same place. It no longer drives the pulse.
      React.useEffect(function () {
        var binding = props.sessionBinding;
        if (binding === undefined || binding === null) return undefined;
        var source = binding.eventSource;
        if (source === undefined || source === null) return undefined;
        var pending = null;
        var initial = source.getSnapshot();
        var previousRevision = initial === undefined ? 0 : initial.revision;
        var unsubscribe = source.subscribe(function () {
          var next = source.getSnapshot();
          if (next === undefined || next.revision === previousRevision) return;
          previousRevision = next.revision;
          if (pending !== null) clearTimeout(pending);
          pending = setTimeout(function () {
            pending = null;
            loadDaily({ force: true }).catch(function () { /* the poll retries */ });
          }, 900);
        });
        return function () {
          unsubscribe();
          if (pending !== null) clearTimeout(pending);
        };
      }, [props.sessionId]);

      // Re-anchor the panel whenever the window settles or the viewport changes.
      React.useEffect(function () {
        if (!open) return undefined;
        var measure = function () { setPanelPos(placePanel(cardRef.current)); };
        measure();
        window.addEventListener('resize', measure);
        return function () { window.removeEventListener('resize', measure); };
      }, [open, position.x, position.y, minimized]);

      React.useEffect(function () {
        return function () {
          if (closeTimer.current !== null) clearTimeout(closeTimer.current);
          if (openTimer.current !== null) clearTimeout(openTimer.current);
        };
      }, []);

      // Read the store at render time. `payloadVersionSeen` is not otherwise used;
      // it exists so a publish re-renders this component.
      void payloadVersionSeen;
      var payload = currentPayload();
      var days = payload === null ? [] : payload.days || [];
      var todayEntry = null;
      for (var index = days.length - 1; index >= 0; index -= 1) {
        if (days[index].today === true) { todayEntry = days[index]; break; }
      }
      var todayTokens = todayEntry === null ? 0 : todayEntry.tokens;
      var miniDays = days.slice(-MINI_DAYS);
      // The Host reports an unreadable corpus *in band*: HTTP 200 carrying an
      // `error` field and no days, so a polling window keeps whatever it had. Left
      // unread, that made a broken corpus indistinguishable from a day with no
      // usage — the figure showed a confident `0`. When a failure leaves nothing to
      // show, the figure says so and the reason is printed beside it.
      var hostError = payload === null || payload.error === undefined || payload.error === null
        ? null
        : String(payload.error);
      var figureUnknown = payload === null || (hostError !== null && days.length === 0);

      var hoveredDay = null;
      for (var scan = 0; scan < days.length; scan += 1) {
        if (days[scan].date === hovered) { hoveredDay = days[scan]; break; }
      }

      var labelOf = function (day) {
        return formatDay(day.date) + ' · ' + formatExact(day.tokens, t) + ' ' + t('unit.tokens');
      };

      /**
       * Build an arrow-key handler for one grid.
       *
       * The step is seven days horizontally and one day vertically, which is the
       * grid's own geometry: seven rows, flowing down a column. It has to be built
       * per grid rather than shared, because each grid walks a different slice of
       * the year — the resting grid shows 30 days and the panel shows all of them,
       * so a shared handler would step the resting grid's highlight onto a day it
       * does not render.
       * @param list - the days this grid renders, in order.
       * @param onEscape - what to do when Escape is pressed.
       * @returns a keydown handler.
       */
      function makeKeyHandler(list, onEscape) {
        return function (event) {
          var found = -1;
          for (var index = 0; index < list.length; index += 1) {
            if (list[index].date === hovered) { found = index; break; }
          }
          var step = 0;
          if (event.key === 'ArrowRight') step = 7;
          else if (event.key === 'ArrowLeft') step = -7;
          else if (event.key === 'ArrowDown') step = 1;
          else if (event.key === 'ArrowUp') step = -1;
          else if (event.key === 'Escape') {
            event.preventDefault();
            setHovered(null);
            onEscape();
            return;
          } else return;
          event.preventDefault();
          var next = found === -1 ? list.length - 1 : Math.min(list.length - 1, Math.max(0, found + step));
          if (list[next] !== undefined) setHovered(list[next].date);
        };
      }

      var panelOpen = open && !minimized && !dragging;

      var card = h('div', {
        key: 'card',
        ref: cardRef,
        className: 'dsh-th-card',
        'data-dragging': dragging ? 'true' : 'false',
        'data-running': running ? 'true' : 'false',
        'data-hovering': open ? 'true' : 'false',
        onPointerEnter: function () { enterSurface('card'); },
        onPointerLeave: function () { leave('card'); },
        onFocus: function () { enterSurface('card'); },
        onBlur: function (event) {
          if (rootRef.current !== null && rootRef.current !== undefined
            && rootRef.current.contains(event.relatedTarget)) return;
          leave('card');
        },
        onPointerDown: onPointerDown,
        onDoubleClick: function () { setMinimized(!minimized); },
      }, [
        // The halo is the widest, most legible layer of the live treatment, so it
        // is a sibling of the content rather than a pseudo-element.
        h('div', {
          key: 'halo',
          ref: haloRef,
          className: 'dsh-th-halo',
          'data-active': running ? 'true' : 'false',
          'aria-hidden': 'true',
        }),
        h('div', {
          key: 'head',
          className: 'dsh-th-head',
        }, [
          h('span', { key: 'label', className: 'dsh-th-headLabel' }, t('window.today')),
          // The figure renders straight from the store. It is plain text with
          // tabular numerals and a reserved width, nothing animates it and nothing
          // re-measures it, so a new value swaps digits in place. It is only ever
          // a placeholder before the page's first response, or when a failed scan
          // has left nothing at all to show — never during an ordinary update.
          // Two decimals, so a figure that is climbing moves on every step.
          h('span', { key: 'value', className: 'dsh-th-headValue' },
            figureUnknown ? '-' : formatTokens(todayTokens, t, 2)),
        ]),
        hostError !== null && !minimized ? h('div', {
          key: 'hostError',
          className: 'dsh-th-error',
          title: hostError,
        }, t('state.error', { message: hostError })) : null,
        minimized ? null : h(HeatGrid, {
          key: 'mini',
          days: miniDays,
          cell: MINI_CELL,
          columns: MINI_COLUMNS,
          dark: dark,
          weekdays: payload !== null && payload.calendars !== undefined && payload.calendars !== null
            ? payload.calendars.weekdays
            : undefined,
          hovered: hovered,
          focusDate: hovered,
          onHover: setHovered,
          // Bound to the days this grid actually shows. Stepping through the full
          // year here would move the highlight to a day the resting grid does not
          // contain, so the ring would simply disappear.
          onKeyDown: makeKeyHandler(miniDays, function () { setOpen(false); }),
          labelOf: labelOf,
          gridLabel: t('window.gridLabel'),
        }),
      ]);

      return h('div', {
        className: 'dsh-th-root',
        ref: rootRef,
        'data-open': panelOpen ? 'true' : 'false',
      }, [
        // The wrapper carries the coordinates; the card inside is what the user
        // sees and grabs. Keeping them apart means a drag only ever writes one
        // transform, on an element with no other styling to fight.
        h('div', {
          key: 'anchorBox',
          className: 'dsh-th-anchorBox',
          ref: anchorRef,
        }, [card]),
        panelOpen && payload !== null ? h(Panel, {
          key: 'panel',
          t: t,
          payload: payload,
          dark: dark,
          hovered: hovered,
          hoveredDay: hoveredDay,
          focusDate: hovered,
          onHover: setHovered,
          onKeyDown: makeKeyHandler(days, function () { setOpen(false); }),
          labelOf: labelOf,
          panelRef: panelRef,
          onPanelEnter: function () { enterSurface('panel'); },
          onPanelLeave: function () { leave('panel'); },
          pos: panelPos,
          hostError: hostError,
          sessionCount: (payload.scan && payload.scan.sessions) || 0,
        }) : null,
        panelOpen && payload === null ? h('div', {
          key: 'pending',
          className: 'dsh-th-panel',
          style: panelStyle(panelPos),
          onPointerEnter: function () { enterSurface('panel'); },
          onPointerLeave: function () { leave('panel'); },
        }, [
          h('div', { key: 't', className: 'dsh-th-title' }, t('panel.title')),
          h('div', {
            key: 'body',
            className: fetchError === null ? 'dsh-th-pending' : 'dsh-th-error',
          }, fetchError === null ? t('state.loading') : t('state.error', { message: fetchError })),
        ]) : null,
      ]);
    }
    //#endregion

    //#region dictionaries
    /** Chinese dictionary (source of truth). */
    var zh = {
      'window.today': '今日',
      'window.gridLabel': '近 30 天 Token 用量',
      'panel.title': 'Token 热力图',
      'panel.subtitle': '{from} 至 {to}',
      'panel.gridLabel': '每日 Token 用量热力图',
      'panel.meta': '统计 {sessions} 个会话 · 更新于 {updated} 前',
      'stat.total': '合计',
      'stat.activeDays': '活跃天数',
      'stat.average': '日均',
      'stat.streak': '连续',
      'stat.best': '最高',
      'legend.less': '少',
      'legend.more': '多',
      'legend.longest': '最长连续 {days} 天',
      'hover.hint': '把光标放到方块上查看当天用量',
      'hover.breakdown': '未缓存输入 {input} · 缓存读取 {read} · 输出 {output}',
      'state.loading': '正在统计历史会话',
      'state.error': '读取用量失败：{message}',
      'unit.tokens': 'tok',
      'number.thousand': '{value}K',
      'number.million': '{value}M',
      'number.groupSeparator': ',',
    };

    /** English dictionary, key-identical. */
    var en = {
      'window.today': 'Today',
      'window.gridLabel': 'Token usage over the last 30 days',
      'panel.title': 'Token heatmap',
      'panel.subtitle': '{from} to {to}',
      'panel.gridLabel': 'Daily token usage heatmap',
      'panel.meta': '{sessions} sessions counted · updated {updated} ago',
      'stat.total': 'Total',
      'stat.activeDays': 'Active days',
      'stat.average': 'Daily avg',
      'stat.streak': 'Streak',
      'stat.best': 'Best',
      'legend.less': 'Less',
      'legend.more': 'More',
      'legend.longest': 'Longest streak {days} days',
      'hover.hint': 'Hover a square to inspect that day',
      'hover.breakdown': 'uncached in {input} · cache read {read} · out {output}',
      'state.loading': 'Counting historical sessions',
      'state.error': 'Usage read failed: {message}',
      'unit.tokens': 'tok',
      'number.thousand': '{value}K',
      'number.million': '{value}M',
      'number.groupSeparator': ',',
    };
    //#endregion

    /** Locale namespace this surface owns. */
    var NS = 'tokenHeatmap';

    /** Services the browser half needs. */
    var inject = ['slots', 'locale', 'sessions', 'remote'];

    /**
     * Browser plugin body: the dictionaries and the floating window.
     * @param ctx - the client root context.
     * @returns nothing.
     */
    function apply(ctx) {
      installStyles();
      ctx.effect(
        function () { return ctx.locale.register(NS, { zh: zh, en: en }); },
        'dsh-token-heatmap: dictionaries',
      );

      // `shell.overlay` is the frame-wide floating layer: above every column and
      // outside their scroll containers, which is the only seat where a window
      // dragged anywhere cannot be clipped by the chrome it passes over. The layer
      // is click-through, so the window opts back into pointer events itself.
      ctx.slots.inject('shell.overlay', function () {
        return ctx.slots.register({
          name: 'shell.overlay',
          id: 'token-heatmap',
          order: 40,
          locale: NS,
          inject: function (sessionId) {
            var binding = sessionId === undefined || sessionId === null
              ? undefined
              : ctx.sessions.binding(sessionId);
            return {
              t: ctx.locale.bind(NS),
              sessionId: sessionId,
              sessionBinding: binding,
              // The process-wide run status lives on the Remote event bus; the slot
              // inject is the only place that can read `ctx`.
              remote: ctx.remote,
            };
          },
        }, TokenHeatmap);
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
