// Extension: screenshot-review
//
// Canvas extension for the GitHub Copilot app. Opens a side-panel showing the
// screenshot-regression status of the current session's associated PR:
//   - a banner + button to post `/regenerate-screenshots` when the
//     "Screenshots" CI check has failed
//   - a before/after draggable-slider comparison for every changed screenshot
//     in the PR, with an "Analyze with AI" button per image that asks the
//     agent to describe the visual diff and shows the result inline
//
// The extension process does all git/gh/file work; the served HTML page is a
// thin, dependency-free renderer that talks back to the same local server.

import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { joinSession, createCanvas } from "@github/copilot-sdk/extension";

const execFileAsync = promisify(execFile);

const SCREENSHOT_DIR = "docs/screenshots";
const IMAGE_EXT_RE = /\.(png|jpe?g|webp)$/i;
const CI_CHECK_NAME_RE = /screenshot/i;

// One local HTTP server per open canvas instance.
const servers = new Map();

async function run(cmd, args, opts = {}) {
    try {
        const { stdout } = await execFileAsync(cmd, args, {
            cwd: opts.cwd,
            maxBuffer: 1024 * 1024 * 64,
        });
        return stdout;
    } catch (err) {
        const stderr = err && err.stderr ? String(err.stderr) : "";
        throw new Error(`${cmd} ${args.join(" ")} failed: ${stderr || err.message}`);
    }
}

function repoRootFor(ctx) {
    return (ctx && ctx.session && ctx.session.workingDirectory) || process.cwd();
}

function mimeFor(file) {
    const ext = path.extname(file).toLowerCase();
    if (ext === ".png") return "image/png";
    if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
    if (ext === ".webp") return "image/webp";
    return "application/octet-stream";
}

async function readAsDataUri(cwd, filePath) {
    try {
        const buf = await fs.readFile(path.join(cwd, filePath));
        return `data:${mimeFor(filePath)};base64,${buf.toString("base64")}`;
    } catch {
        return null;
    }
}

async function readAtRevAsDataUri(cwd, rev, filePath) {
    try {
        const { stdout } = await execFileAsync("git", ["show", `${rev}:${filePath}`], {
            cwd,
            encoding: "buffer",
            maxBuffer: 1024 * 1024 * 64,
        });
        return `data:${mimeFor(filePath)};base64,${stdout.toString("base64")}`;
    } catch {
        return null; // file didn't exist at that revision (new screenshot)
    }
}

async function getRepoNameWithOwner(cwd) {
    try {
        const out = await run("gh", ["repo", "view", "--json", "nameWithOwner"], { cwd });
        return JSON.parse(out).nameWithOwner;
    } catch {
        return null;
    }
}

// Finds the most recent "Regenerate Screenshots" workflow run associated with
// this PR. That workflow is triggered by `issue_comment`, which carries no
// direct PR/run linkage in the API, but GitHub sets the run's `display_title`
// to the PR title for issue_comment-triggered runs — so we match on that.
async function getRegenerateRun(cwd, pr) {
    const nameWithOwner = await getRepoNameWithOwner(cwd);
    if (!nameWithOwner) return null;
    try {
        const out = await run(
            "gh",
            [
                "api",
                `repos/${nameWithOwner}/actions/workflows/screenshots-regenerate.yml/runs`,
                "--jq",
                ".workflow_runs[] | {id, status, conclusion, event, display_title, created_at, html_url}",
            ],
            { cwd },
        );
        const runs = out
            .split("\n")
            .filter(Boolean)
            .map((l) => JSON.parse(l))
            .filter((r) => r.event === "issue_comment" && r.display_title === pr.title)
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        if (runs.length === 0) return null;
        const latest = runs[0];
        return {
            status: latest.status, // queued | in_progress | completed
            conclusion: latest.conclusion, // success | failure | ... | null
            url: latest.html_url,
            createdAt: latest.created_at,
        };
    } catch {
        return null;
    }
}


async function gatherData(cwd) {
    let pr;
    try {
        const out = await run(
            "gh",
            [
                "pr",
                "view",
                "--json",
                "number,url,title,state,headRefName,baseRefName,statusCheckRollup",
            ],
            { cwd },
        );
        pr = JSON.parse(out);
    } catch (err) {
        return { pr: null, error: err.message };
    }

    const checks = Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : [];
    const screenshotChecks = checks.filter((c) => {
        const label = `${c.name || ""} ${c.workflowName || ""} ${c.context || ""}`;
        return CI_CHECK_NAME_RE.test(label);
    });
    const ciStatus = summarizeChecks(screenshotChecks);
    if (ciStatus.state === "failed") {
        ciStatus.changedFileCount = await getChangedFileCountFromFailedCheck(cwd, ciStatus.checks);
    }

    // Changed files in the PR, filtered to screenshot images.
    let changedFiles = [];
    try {
        const out = await run("gh", ["pr", "diff", String(pr.number), "--name-only"], { cwd });
        changedFiles = out
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l.startsWith(SCREENSHOT_DIR + "/") && IMAGE_EXT_RE.test(l));
    } catch {
        // Non-fatal; just show no screenshots.
    }

    let mergeBase = null;
    try {
        const baseRef = pr.baseRefName || "main";
        // Prefer a remote-tracking ref if present, else fall back to the local branch name.
        let baseRev = `origin/${baseRef}`;
        try {
            await run("git", ["rev-parse", "--verify", baseRev], { cwd });
        } catch {
            baseRev = baseRef;
        }
        mergeBase = (await run("git", ["merge-base", baseRev, "HEAD"], { cwd })).trim();
    } catch {
        mergeBase = null;
    }

    const screenshots = [];
    for (const file of changedFiles) {
        const after = await readAsDataUri(cwd, file);
        const before = mergeBase ? await readAtRevAsDataUri(cwd, mergeBase, file) : null;
        screenshots.push({ path: file, before, after });
    }

    const regenerateRun = await getRegenerateRun(cwd, pr);

    return {
        pr: {
            number: pr.number,
            url: pr.url,
            title: pr.title,
            state: pr.state,
            headRefName: pr.headRefName,
            baseRefName: pr.baseRefName,
        },
        ciStatus,
        regenerateRun,
        screenshots,
    };
}

function summarizeChecks(checks) {
    if (checks.length === 0) return { state: "unknown", checks: [] };
    const normalized = checks.map((c) => ({
        name: c.name || c.context || c.workflowName || "Screenshots",
        state: (c.conclusion || c.state || "").toUpperCase(),
        url: c.detailsUrl || c.targetUrl || null,
    }));
    const failed = normalized.some((c) => ["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT"].includes(c.state));
    const pending = normalized.some((c) => ["PENDING", "IN_PROGRESS", "QUEUED", ""].includes(c.state));
    const state = failed ? "failed" : pending ? "pending" : "passed";
    return { state, checks: normalized };
}

// Extracts the "N files changed, ..." summary line git prints when the
// verify-screenshots CI step fails, by pulling the failed job's log via `gh
// run view --log-failed`. The job/run IDs are parsed out of the check's
// `detailsUrl` (…/actions/runs/<runId>/job/<jobId>).
async function getChangedFileCountFromFailedCheck(cwd, checks) {
    const withUrl = checks.find((c) => c.url && /\/actions\/runs\/\d+\/job\/\d+/.test(c.url));
    if (!withUrl) return null;
    const match = withUrl.url.match(/\/actions\/runs\/(\d+)\/job\/(\d+)/);
    if (!match) return null;
    const [, runId, jobId] = match;
    try {
        const log = await run("gh", ["run", "view", runId, "--job", jobId, "--log-failed"], { cwd });
        const fileMatch = log.match(/(\d+) files? changed/);
        return fileMatch ? Number(fileMatch[1]) : null;
    } catch {
        return null;
    }
}

async function postRegenerateComment(cwd, prNumber) {
    await run("gh", ["pr", "comment", String(prNumber), "--body", "/regenerate-screenshots"], { cwd });
}

async function analyzeScreenshot(session, cwd, screenshotPath, before, after) {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "screenshot-review-"));
    const ext = path.extname(screenshotPath) || ".png";
    const beforePath = path.join(tmpDir, `before${ext}`);
    const afterPath = path.join(tmpDir, `after${ext}`);
    const attachments = [];
    try {
        if (before) {
            await fs.writeFile(beforePath, Buffer.from(before.split(",")[1], "base64"));
            attachments.push({ type: "file", path: beforePath });
        }
        if (after) {
            await fs.writeFile(afterPath, Buffer.from(after.split(",")[1], "base64"));
            attachments.push({ type: "file", path: afterPath });
        }

        const prompt = before
            ? `Compare these two screenshots of "${screenshotPath}" from the SharedSpaces app. ` +
              `The first attachment is the "before" version and the second is the "after" version ` +
              `from an open pull request. Describe the visual differences concisely (layout, spacing, ` +
              `color, text, overflow, alignment). Call out anything that looks like a regression or a ` +
              `bug versus an intentional change. Keep the answer under 150 words.`
            : `This is a newly added screenshot "${screenshotPath}" in the SharedSpaces app (no "before" ` +
              `version exists). Briefly describe what it shows and flag any obvious layout issues, ` +
              `overflow, or broken rendering. Keep the answer under 100 words.`;

        const response = await session.sendAndWait({ prompt, attachments }, 180_000);
        const content = response && response.data && response.data.content;
        return typeof content === "string" && content.trim().length > 0
            ? content.trim()
            : "No analysis text was returned.";
    } finally {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
}

function renderHtml() {
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Screenshot Review</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    margin: 0; padding: 16px; background: #0d1117; color: #e6edf3;
  }
  h1 { font-size: 16px; margin: 0 0 4px; }
  a { color: #58a6ff; }
  .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  .pr-meta { font-size: 13px; color: #9198a1; }
  .btn {
    background: #238636; color: #fff; border: none; border-radius: 6px;
    padding: 6px 12px; font-size: 13px; cursor: pointer;
  }
  .btn:hover { background: #2ea043; }
  .btn:disabled { background: #30363d; color: #8b949e; cursor: not-allowed; }
  .btn.secondary { background: #21262d; border: 1px solid #30363d; }
  .btn.secondary:hover { background: #30363d; }
  .banner {
    display: flex; justify-content: space-between; align-items: center; gap: 12px;
    background: #3d1f1f; border: 1px solid #f85149; border-radius: 6px;
    padding: 10px 14px; margin-bottom: 16px; font-size: 13px;
  }
  .banner strong { color: #ffa198; }
  .empty { color: #9198a1; font-size: 13px; padding: 24px 0; text-align: center; }
  .card {
    border: 1px solid #30363d; border-radius: 8px; padding: 12px; margin-bottom: 16px; background: #161b22;
  }
  .card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .card-path { font-family: ui-monospace, monospace; font-size: 12px; color: #c9d1d9; word-break: break-all; }
  .slider-wrap {
    position: relative; width: 100%; max-width: 640px; overflow: hidden;
    border: 1px solid #30363d; border-radius: 6px; background: #010409;
    -webkit-user-select: none; -moz-user-select: none; -ms-user-select: none; user-select: none;
  }
  .slider-wrap img {
    display: block; width: 100%; height: auto; pointer-events: none;
    -webkit-user-select: none; -moz-user-select: none; -ms-user-select: none; user-select: none;
    -webkit-user-drag: none;
  }
  .after-layer { position: absolute; top: 0; left: 0; height: 100%; overflow: hidden; }
  .after-layer img { width: var(--img-width, 640px); max-width: none; }
  .handle {
    position: absolute; top: 0; bottom: 0; width: 2px; background: #58a6ff;
    cursor: ew-resize; left: 50%; transform: translateX(-1px);
  }
  .handle::after {
    content: "\\2194"; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
    width: 24px; height: 24px; background: #58a6ff; color: #0d1117; border-radius: 50%;
    display: flex; align-items: center; justify-content: center; font-size: 14px;
  }
  .new-badge { font-size: 11px; color: #9198a1; }
  .analysis { margin-top: 10px; font-size: 13px; line-height: 1.5; white-space: pre-wrap; }
  .analysis.pending { color: #9198a1; font-style: italic; }
  .row { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
  .spinner {
    width: 12px; height: 12px; border: 2px solid #30363d; border-top-color: #58a6ff;
    border-radius: 50%; animation: spin 0.8s linear infinite; display: inline-block;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
  <div class="header">
    <div>
      <h1 id="title">Screenshot Review</h1>
      <div class="pr-meta" id="pr-meta">Loading&hellip;</div>
    </div>
    <button class="btn secondary" id="refresh-btn">Refresh</button>
  </div>
  <div id="content"><div class="empty">Loading&hellip;</div></div>

<script>
const state = { data: null };

async function loadData() {
  document.getElementById('content').innerHTML = '<div class="empty">Loading&hellip;</div>';
  const res = await fetch('/api/data');
  state.data = await res.json();
  render();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function render() {
  const d = state.data;
  const prMeta = document.getElementById('pr-meta');
  const content = document.getElementById('content');

  if (d.error || !d.pr) {
    prMeta.textContent = 'No pull request found for this branch.';
    content.innerHTML = '<div class="empty">' + escapeHtml(d.error || 'Open or push a PR for this branch to see screenshot review.') + '</div>';
    return;
  }

  prMeta.innerHTML = '#' + d.pr.number + ' &middot; ' + escapeHtml(d.pr.title) +
    ' &middot; <a href="' + d.pr.url + '" target="_blank">view on GitHub</a> &middot; ' + escapeHtml(d.pr.state);

  let html = '';

  const checkUrl = (d.ciStatus.checks || []).find((c) => c.url)?.url;
  const checkLink = checkUrl
    ? '<a href="' + checkUrl + '" target="_blank" style="white-space:nowrap;">View check</a>'
    : '';

  if (d.regenerateRun && (d.regenerateRun.status === 'in_progress' || d.regenerateRun.status === 'queued')) {
    html += '<div class="banner" style="background:#1a2b3d;border-color:#58a6ff;">' +
      '<span><span class="spinner"></span> Regenerate screenshots workflow is running&hellip;</span>' +
      '<a href="' + d.regenerateRun.url + '" target="_blank" style="white-space:nowrap;">View run</a>' +
      '</div>';
  }

  if (d.ciStatus.state === 'failed') {
    const countText = typeof d.ciStatus.changedFileCount === 'number'
      ? ' (' + d.ciStatus.changedFileCount + ' file' + (d.ciStatus.changedFileCount === 1 ? '' : 's') + ' changed)'
      : '';
    html += '<div class="banner">' +
      '<span><strong>Screenshot check failed.</strong> The committed screenshots are out of date' + countText + '.</span>' +
      '<div class="row" style="margin-top:0;">' + checkLink +
      '<button class="btn" id="regen-btn">Post /regenerate-screenshots</button></div>' +
      '</div>';
  } else if (d.ciStatus.state === 'pending') {
    html += '<div class="banner" style="background:#3b2f1f;border-color:#d29922;">' +
      '<span>Screenshot check is still running&hellip;</span>' + checkLink +
      '</div>';
  }

  if (!d.screenshots || d.screenshots.length === 0) {
    html += '<div class="empty">No changed screenshots in this PR.</div>';
  } else {
    d.screenshots.forEach((s, i) => {
      html += renderCard(s, i);
    });
  }

  content.innerHTML = html;

  const regenBtn = document.getElementById('regen-btn');
  if (regenBtn) regenBtn.addEventListener('click', onRegenerate);

  d.screenshots?.forEach((s, i) => {
    setupSlider(i);
    const analyzeBtn = document.getElementById('analyze-btn-' + i);
    if (analyzeBtn) analyzeBtn.addEventListener('click', () => onAnalyze(i));
  });
}

function renderCard(s, i) {
  const hasBefore = !!s.before;
  const after = s.after || '';
  const before = s.before || s.after || '';
  return '<div class="card">' +
    '<div class="card-header">' +
      '<span class="card-path">' + escapeHtml(s.path) + '</span>' +
      (hasBefore ? '' : '<span class="new-badge">new file</span>') +
    '</div>' +
    '<div class="slider-wrap" id="slider-' + i + '">' +
      '<img src="' + before + '" draggable="false" />' +
      '<div class="after-layer" id="after-layer-' + i + '"><img src="' + after + '" draggable="false" /></div>' +
      '<div class="handle" id="handle-' + i + '"></div>' +
    '</div>' +
    '<div class="row">' +
      '<button class="btn secondary" id="analyze-btn-' + i + '">Analyze with AI</button>' +
    '</div>' +
    '<div class="analysis" id="analysis-' + i + '"></div>' +
  '</div>';
}

function setupSlider(i) {
  const wrap = document.getElementById('slider-' + i);
  const layer = document.getElementById('after-layer-' + i);
  const handle = document.getElementById('handle-' + i);
  if (!wrap || !layer || !handle) return;

  function setPct(pct) {
    pct = Math.max(0, Math.min(100, pct));
    layer.style.width = pct + '%';
    handle.style.left = pct + '%';
    const w = wrap.clientWidth;
    layer.querySelector('img').style.setProperty('--img-width', w + 'px');
    layer.querySelector('img').style.width = w + 'px';
  }

  let dragging = false;
  function onMove(clientX) {
    const rect = wrap.getBoundingClientRect();
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setPct(pct);
  }
  handle.addEventListener('mousedown', () => { dragging = true; });
  window.addEventListener('mouseup', () => { dragging = false; });
  window.addEventListener('mousemove', (e) => { if (dragging) onMove(e.clientX); });
  wrap.addEventListener('click', (e) => onMove(e.clientX));
  // Initial split + keep in sync with layout/image load.
  setPct(50);
  window.addEventListener('resize', () => setPct(parseFloat(handle.style.left) || 50));
  wrap.querySelector('img').addEventListener('load', () => setPct(parseFloat(handle.style.left) || 50));
}

async function onRegenerate() {
  const btn = document.getElementById('regen-btn');
  btn.disabled = true;
  btn.textContent = 'Posting…';
  try {
    const res = await fetch('/api/regenerate', { method: 'POST' });
    if (!res.ok) throw new Error(await res.text());
    btn.textContent = 'Comment posted ✓';
  } catch (err) {
    btn.textContent = 'Failed: ' + err.message;
    btn.disabled = false;
  }
}

async function onAnalyze(i) {
  const btn = document.getElementById('analyze-btn-' + i);
  const out = document.getElementById('analysis-' + i);
  btn.disabled = true;
  out.className = 'analysis pending';
  out.innerHTML = '<span class="spinner"></span> Analyzing…';
  try {
    const s = state.data.screenshots[i];
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: s.path }),
    });
    if (!res.ok) throw new Error(await res.text());
    const { text } = await res.json();
    out.className = 'analysis';
    out.textContent = text;
  } catch (err) {
    out.className = 'analysis';
    out.textContent = 'Analysis failed: ' + err.message;
  } finally {
    btn.disabled = false;
  }
}

document.getElementById('refresh-btn').addEventListener('click', loadData);
loadData();
</script>
</body>
</html>`;
}

async function startServer(instanceId, session, ctx) {
    const cwd = repoRootFor(ctx);

    const server = createServer(async (req, res) => {
        try {
            const url = new URL(req.url, "http://localhost");
            if (req.method === "GET" && url.pathname === "/") {
                res.setHeader("Content-Type", "text/html; charset=utf-8");
                res.end(renderHtml());
                return;
            }
            if (req.method === "GET" && url.pathname === "/api/data") {
                const data = await gatherData(cwd);
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify(data));
                return;
            }
            if (req.method === "POST" && url.pathname === "/api/regenerate") {
                const data = await gatherData(cwd);
                if (!data.pr) {
                    res.statusCode = 400;
                    res.end("No PR found for this branch.");
                    return;
                }
                await postRegenerateComment(cwd, data.pr.number);
                res.end("ok");
                return;
            }
            if (req.method === "POST" && url.pathname === "/api/analyze") {
                const body = await readBody(req);
                const { path: screenshotPath } = JSON.parse(body || "{}");
                const data = await gatherData(cwd);
                const shot = data.screenshots?.find((s) => s.path === screenshotPath);
                if (!shot) {
                    res.statusCode = 404;
                    res.end("Screenshot not found.");
                    return;
                }
                const text = await analyzeScreenshot(session, cwd, shot.path, shot.before, shot.after);
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify({ text }));
                return;
            }
            res.statusCode = 404;
            res.end("Not found");
        } catch (err) {
            res.statusCode = 500;
            res.end(String(err && err.message ? err.message : err));
        }
    });

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    return { server, url: `http://127.0.0.1:${port}/` };
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let data = "";
        req.on("data", (chunk) => (data += chunk));
        req.on("end", () => resolve(data));
        req.on("error", reject);
    });
}

const session = await joinSession({
    canvases: [
        createCanvas({
            id: "screenshot-review",
            displayName: "Screenshot Review",
            description:
                "Review the current PR's screenshot CI status, regenerate screenshots, and compare/analyze changed screenshots with a draggable before/after slider.",
            actions: [
                {
                    name: "refresh",
                    description: "Re-fetch the PR's screenshot CI status and changed screenshots.",
                    handler: async (ctx) => {
                        const entry = servers.get(ctx.instanceId);
                        if (!entry) return { ok: false, error: "Canvas instance not open." };
                        const data = await gatherData(repoRootFor(ctx));
                        return { ok: true, pr: data.pr, ciStatus: data.ciStatus, screenshotCount: data.screenshots.length };
                    },
                },
            ],
            open: async (ctx) => {
                let entry = servers.get(ctx.instanceId);
                if (!entry) {
                    entry = await startServer(ctx.instanceId, session, ctx);
                    servers.set(ctx.instanceId, entry);
                }
                return {
                    title: "Screenshot Review",
                    url: entry.url,
                };
            },
            onClose: async (ctx) => {
                const entry = servers.get(ctx.instanceId);
                if (entry) {
                    servers.delete(ctx.instanceId);
                    await new Promise((resolve) => entry.server.close(() => resolve()));
                }
            },
        }),
    ],
});
