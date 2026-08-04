#!/usr/bin/env node
// Reads status.json at the repo root and writes status.html, reproducing
// the hand-authored status.html template (see git history / design doc).
// No dependencies: Node built-ins only.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const statusJsonPath = resolve(rootDir, "status.json");
const statusHtmlPath = resolve(rootDir, "status.html");

/** @param {unknown} value */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const status = JSON.parse(readFileSync(statusJsonPath, "utf8"));

const phases = Array.isArray(status.phases) ? status.phases : [];
const doneCount = phases.filter((p) => p.state === "done").length;
const totalCount = phases.length;
const percent = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

const phaseChipClass = (state) =>
  state === "done" ? "done" : state === "active" ? "active" : "pending";

const phaseItems = phases
  .map((p) => {
    const cls = phaseChipClass(p.state);
    const title = escapeHtml(p.title);
    const label = typeof p.id === "number" ? `${p.id} · ${title}` : title;
    return `    <li class="${cls}"><span class="chip">${cls}</span>${label}</li>`;
  })
  .join("\n");

const tests = status.tests ?? {};
const passed = escapeHtml(tests.passed ?? 0);
const failed = escapeHtml(tests.failed ?? 0);
const lastRun = tests.lastRun ? escapeHtml(tests.lastRun) : "—";

const blockers = Array.isArray(status.blockers) ? status.blockers : [];
const blockersSection =
  blockers.length > 0
    ? `
  <h2>Blockers</h2>
  <ul class="blockers">
${blockers.map((b) => `    <li>${escapeHtml(typeof b === "string" ? b : JSON.stringify(b))}</li>`).join("\n")}
  </ul>
`
    : "";

const log = Array.isArray(status.log) ? [...status.log].reverse() : [];
const logItems = log
  .map(
    (entry) =>
      `    <li><time>${escapeHtml(entry.time)}</time>${escapeHtml(entry.message)}</li>`,
  )
  .join("\n");

const project = escapeHtml(status.project ?? "pcg-ts");
const updated = escapeHtml(status.updated ?? "");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${project} — build status</title>
<style>
  :root { color-scheme: light dark;
    --bg:#fff; --fg:#1a1d21; --muted:#6b7280; --line:#e5e7eb; --card:#f8fafc;
    --done:#16a34a; --active:#2563eb; --pending:#9ca3af; --fail:#dc2626; }
  @media (prefers-color-scheme: dark) { :root {
    --bg:#101418; --fg:#e6e8ea; --muted:#8b949e; --line:#2a3138; --card:#171c22; } }
  * { box-sizing:border-box; margin:0; }
  body { background:var(--bg); color:var(--fg);
    font:15px/1.55 system-ui, "Segoe UI", sans-serif; max-width:760px;
    margin:0 auto; padding:40px 20px 80px; }
  h1 { font-size:22px; letter-spacing:-.01em; }
  .sub { color:var(--muted); margin:4px 0 24px; }
  .bar { height:8px; border-radius:4px; background:var(--line);
    overflow:hidden; margin-bottom:28px; }
  .bar > div { height:100%; background:var(--done); width:${percent}%; }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:.08em;
    color:var(--muted); margin:28px 0 10px; }
  ul.phases { list-style:none; }
  ul.phases li { display:flex; align-items:center; gap:10px; padding:9px 12px;
    border:1px solid var(--line); border-radius:8px; margin-bottom:6px;
    background:var(--card); }
  .chip { font-size:11px; font-weight:600; padding:2px 8px; border-radius:99px;
    color:#fff; flex:none; width:70px; text-align:center; }
  .done   .chip { background:var(--done); }
  .active .chip { background:var(--active); }
  .pending .chip { background:var(--pending); }
  .pending { color:var(--muted); }
  ul.blockers { list-style:none; }
  ul.blockers li { padding:9px 12px; border:1px solid var(--fail); border-radius:8px;
    margin-bottom:6px; background:var(--card); color:var(--fail); }
  .stats { display:flex; gap:24px; padding:12px 14px; border:1px solid var(--line);
    border-radius:8px; background:var(--card); }
  .stats b { font-size:20px; display:block; }
  .stats span { font-size:12px; color:var(--muted); }
  ol.log { list-style:none; }
  ol.log li { padding:8px 0; border-bottom:1px solid var(--line); }
  ol.log time { color:var(--muted); font-size:12px; display:block; }
</style>
</head>
<body>
  <h1>${project}</h1>
  <p class="sub">Procedural content generation for TypeScript &middot; updated ${updated}</p>
  <div class="bar"><div style="width:${percent}%"></div></div>

  <h2>Phases</h2>
  <ul class="phases">
${phaseItems}
  </ul>
${blockersSection}
  <h2>Tests</h2>
  <div class="stats">
    <div><b>${passed}</b><span>passed</span></div>
    <div><b>${failed}</b><span>failed</span></div>
    <div><b>${lastRun}</b><span>last run</span></div>
  </div>

  <h2>Log</h2>
  <ol class="log">
${logItems}
  </ol>
</body>
</html>
`;

writeFileSync(statusHtmlPath, html, "utf8");

console.log(
  `status: wrote status.html (${doneCount}/${totalCount} phases done, ${percent}%, ${log.length} log entries)`,
);
