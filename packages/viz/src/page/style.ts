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

.controls input { width: 240px; }
.controls button { cursor: pointer; }
.controls button:hover { border-color: var(--muted); }

main { display: flex; flex: 1; min-height: 0; }

#graph {
  flex: 1 1 60%;
  min-width: 0;
  background: var(--panel);
  border-right: 1px solid var(--line);
}

#detail {
  flex: 0 0 38%;
  min-width: 300px;
  overflow-y: auto;
  padding: 18px 22px;
  background: var(--panel);
}

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

@media (max-width: 820px) {
  main { flex-direction: column; }
  #graph { flex: 1 1 50%; border-right: none; border-bottom: 1px solid var(--line); }
  #detail { flex: 1 1 50%; min-width: 0; }
}
`;
