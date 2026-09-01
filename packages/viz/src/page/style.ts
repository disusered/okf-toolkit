/**
 * Embedded stylesheet for the self-contained generated page.
 */
export const PAGE_STYLE = String.raw`
:root {
  color-scheme: light dark;
  --page: #f8fafc;
  --panel: #ffffff;
  --ink: #0f172a;
  --muted: #64748b;
  --line: #e2e8f0;
  --accent: #b45309;
  --code: #f1f5f9;
}

@media (prefers-color-scheme: dark) {
  :root {
    --page: #0b1120;
    --panel: #111827;
    --ink: #e5e7eb;
    --muted: #94a3b8;
    --line: #1f2937;
    --accent: #fbbf24;
    --code: #1f2937;
  }
}

* { box-sizing: border-box; }

/*
 * The hidden attribute is how this page shows and hides controls, and any explicit display
 * rule silently defeats it. Restate it with precedence so a later layout rule cannot.
 */
[hidden] { display: none !important; }

body {
  margin: 0;
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--page);
  color: var(--ink);
  font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
}

header {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: var(--panel);
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
}

.brand strong { font-size: 16px; margin-right: 8px; }
.muted { color: var(--muted); font-size: 12px; }
.controls { display: flex; flex-wrap: wrap; gap: 8px; }

.controls input,
.controls select,
.controls button {
  font: inherit;
  font-size: 13px;
  padding: 5px 8px;
  color: var(--ink);
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 4px;
}

.controls input[type="search"] { width: 240px; }
.controls input[type="checkbox"] { width: auto; margin: 0 4px 0 0; }
#stale-only-label { display: inline-flex; align-items: center; font-size: 13px; }
.controls button { cursor: pointer; }
.controls button:hover { border-color: var(--muted); }

/*
 * Columns by default: graph beside reader. --split drives the graph's share in either
 * orientation, so the toggle only has to change flex-direction.
 */
main { display: flex; flex-direction: row; flex: 1; min-height: 0; }

#graph {
  flex: 0 0 var(--split, 60%);
  min-height: 0;
  min-width: 0;
  background: var(--panel);
}

#split {
  flex: 0 0 6px;
  background: var(--line);
  cursor: col-resize;
  touch-action: none;
}

#split:hover, #split:focus-visible { background: var(--accent); outline: none; }

/* min-height:0 is what lets the reader scroll instead of growing past the viewport. */
#detail {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  overflow-y: auto;
  padding: 18px 22px;
  background: var(--panel);
  border-left: 1px solid var(--line);
}

main[data-orientation="rows"] { flex-direction: column; }
main[data-orientation="rows"] > #graph { min-height: 160px; }
main[data-orientation="rows"] > #split { cursor: row-resize; }
main[data-orientation="rows"] > #detail { border-left: 0; border-top: 1px solid var(--line); }

#detail h1 { font-size: 19px; margin: 6px 0 2px; }
#detail h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin: 22px 0 6px; }

.chip {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
  color: #fff;
  background: var(--muted);
  text-transform: uppercase;
}

.path { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--muted); margin: 0 0 14px; }

dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; margin: 0 0 6px; }
dt { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
dd { margin: 0; }

hr { border: none; border-top: 1px solid var(--line); margin: 18px 0; }

#detail-body h1, #detail-body h2, #detail-body h3,
#detail-body h4, #detail-body h5, #detail-body h6 {
  font-size: 15px;
  margin: 18px 0 6px;
  text-transform: none;
  letter-spacing: 0;
  color: var(--ink);
}

#detail-body p { margin: 0 0 10px; }
#detail-body ul, #detail-body ol { margin: 0 0 10px; padding-left: 22px; }
#detail-body li { margin-bottom: 3px; }
#detail-body blockquote { margin: 0 0 10px; padding-left: 12px; border-left: 3px solid var(--line); color: var(--muted); }

#detail-body pre {
  background: var(--code);
  padding: 10px 12px;
  border-radius: 4px;
  overflow-x: auto;
  margin: 0 0 10px;
}

code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
:not(pre) > code { background: var(--code); padding: 1px 4px; border-radius: 3px; }

#detail-body table { border-collapse: collapse; margin: 0 0 10px; width: 100%; }
#detail-body th, #detail-body td { border: 1px solid var(--line); padding: 5px 8px; text-align: left; vertical-align: top; }
#detail-body th { background: var(--code); }

a { color: var(--ink); }

.internal {
  font: inherit;
  padding: 0;
  border: 0;
  background: none;
  color: var(--ink);
  text-decoration: underline;
  text-decoration-style: dotted;
  cursor: pointer;
}

.internal:hover { color: var(--accent); }

ul.plain { list-style: none; margin: 0; padding: 0; }
ul.plain li { margin-bottom: 5px; }
ul.plain .muted { display: block; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }

.empty { color: var(--muted); margin-top: 40px; text-align: center; }

.chip.warn { background: var(--accent); margin-left: 6px; }

.actor { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
.warn-text { color: var(--accent); }

/* Source and verification entries stack their signals under the label. */
#detail-sources .muted, #detail-verified .muted { display: block; }
#detail-verified ul { margin-bottom: 4px; }

#detail-computation h2 { margin-top: 22px; }
#detail-computation p { margin: 0 0 8px; }

.tag {
  font: inherit;
  font-size: 11px;
  padding: 1px 7px;
  margin: 0 4px 4px 0;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--code);
  color: var(--ink);
  cursor: pointer;
}

.tag:hover { border-color: var(--accent); }

/*
 * The dated strip. Every mark is placed along one shared axis as a percentage, so the strip
 * stays proportional at any panel width. Labels alternate above and below the axis, which is
 * what stops two nearby dates from printing over each other, and the marks near either end
 * anchor their label inward instead of centring it off the edge.
 */
#detail-timeline { margin: 0 0 18px; }

.timeline { position: relative; height: 88px; }

.timeline-track {
  position: absolute;
  left: 0;
  right: 0;
  top: calc(50% - 1px);
  height: 2px;
  background: var(--line);
}

/*
 * The stretch a page has already outlived, drawn from its expiry to the evaluation date.
 * Hatched rather than tinted so the overrun still reads where the accent colour does not.
 */
.timeline-overrun {
  position: absolute;
  top: calc(50% - 4px);
  height: 8px;
  border-radius: 4px;
  background: repeating-linear-gradient(
    135deg,
    var(--accent),
    var(--accent) 2px,
    var(--panel) 2px,
    var(--panel) 5px
  );
}

.timeline-marks { position: absolute; left: 0; right: 0; top: 0; bottom: 0; }

/* Zero width: the mark is a point on the axis, and everything hangs off that point. */
.tl-mark { position: absolute; top: 0; bottom: 0; width: 0; }

.tl-dot {
  position: absolute;
  top: calc(50% - 5px);
  left: -5px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--ink);
  box-shadow: 0 0 0 2px var(--panel);
}

.tl-stem { position: absolute; left: 0; width: 1px; background: var(--line); }
.tl-above > .tl-stem { top: 34px; height: calc(50% - 34px); }
.tl-below > .tl-stem { top: 50%; height: 34px; }

.tl-label {
  position: absolute;
  left: 0;
  display: block;
  max-width: 132px;
  transform: translateX(-50%);
  text-align: center;
  line-height: 1.25;
}

.tl-above > .tl-label { bottom: calc(50% + 12px); }
.tl-below > .tl-label { top: calc(50% + 12px); }
.tl-start > .tl-label { transform: none; text-align: left; }
.tl-end > .tl-label { transform: translateX(-100%); text-align: right; }

.tl-what, .tl-when { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tl-what { font-size: 11px; font-weight: 600; color: var(--ink); }
.tl-when { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10.5px; color: var(--muted); }

/* Shape carries the kind as well as colour, so the strip survives a monochrome print. */
.tl-written > .tl-dot { border-radius: 2px; background: var(--muted); }
.tl-checked > .tl-what { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10.5px; font-weight: 400; }
.tl-expires > .tl-dot { border-radius: 2px; background: var(--accent); transform: rotate(45deg); }
.tl-today > .tl-dot { background: var(--panel); box-shadow: 0 0 0 2px var(--ink); }
.tl-today > .tl-stem { top: 12px; height: calc(100% - 24px); width: 0; background: none; border-left: 1px dashed var(--muted); }

.timeline-note { margin: 0; font-size: 11.5px; color: var(--accent); }

/* Usage bars scale to the busiest source on the page, never to anything off it. */
.usage { display: flex; align-items: center; gap: 8px; margin-top: 4px; }

.usage-bar {
  flex: 0 0 130px;
  height: 6px;
  border-radius: 3px;
  background: var(--code);
  overflow: hidden;
}

.usage-fill { display: block; height: 100%; min-width: 2px; border-radius: 3px; background: var(--muted); }
.usage-count { font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }
.usage-window { margin-top: 8px; font-size: 11px; color: var(--muted); }


/* Narrow viewports stack however the toggle is set; columns needs width to earn its keep. */
@media (max-width: 820px) {
  main { flex-direction: column; }
  main > #graph { min-height: 160px; }
  main > #split { cursor: row-resize; }
  main > #detail { border-left: 0; border-top: 1px solid var(--line); }
}

/* Stacked on a short viewport, 60% leaves no usable reading pane. */
@media (max-height: 620px) {
  main[data-orientation="rows"] > #graph { flex-basis: 40%; }
}
`;
