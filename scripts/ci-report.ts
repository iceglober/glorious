#!/usr/bin/env bun
/**
 * CI Report Generator
 *
 * Fetches GitHub Actions data and generates a self-contained interactive HTML
 * report with health verdict, flakiness detection, time-to-merge, and
 * per-workflow drill-ins.
 *
 * Usage: bun scripts/ci-report.ts [--repo owner/name] [--days N] [--output path]
 */

import { $ } from "bun";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
function flag(name: string, fallback: string): string {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}

const DAYS = parseInt(flag("days", "30"), 10);
const OUTPUT = flag("output", "ci-report.html");
const REPO = flag("repo", "");
const SINCE = new Date(Date.now() - DAYS * 86_400_000).toISOString();
const NOW = Date.now();

const REPO_SLUG =
  REPO || (await $`gh repo view --json nameWithOwner -q .nameWithOwner`.text()).trim();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WorkflowRun {
  id: number;
  name: string;
  workflow_id: number;
  conclusion: string | null;
  status: string;
  run_started_at: string;
  updated_at: string;
  created_at: string;
  head_branch: string;
  event: string;
  run_number: number;
  run_attempt: number;
  html_url: string;
}

interface Job {
  id: number;
  name: string;
  conclusion: string | null;
  started_at: string;
  completed_at: string;
  run_id: number;
}

interface PR {
  number: number;
  title: string;
  created_at: string;
  merged_at: string | null;
  head: { ref: string };
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function ghApi<T>(endpoint: string): Promise<T> {
  const result = await $`gh api ${endpoint}`.text();
  return JSON.parse(result);
}

let runsTruncated = false;
let totalRunCount = 0;

// Paginate a single endpoint, up to the GitHub 1000-result cap (10 pages × 100)
async function paginateRuns(endpoint: string): Promise<{ runs: WorkflowRun[]; total: number; capped: boolean }> {
  const runs: WorkflowRun[] = [];
  let page = 1;
  let total = 0;
  let capped = false;
  while (true) {
    const data = await ghApi<{ workflow_runs: WorkflowRun[]; total_count: number }>(
      `${endpoint}${endpoint.includes("?") ? "&" : "?"}per_page=100&page=${page}`
    );
    total = data.total_count;
    runs.push(...data.workflow_runs);
    if (runs.length >= data.total_count || data.workflow_runs.length < 100) break;
    if (page >= 10) { capped = true; break; }
    page++;
  }
  return { runs, total, capped };
}

// Split a date range into N equal chunks, returning [start, end] ISO date strings
function splitDateRange(startMs: number, endMs: number, chunks: number): [string, string][] {
  const chunkSize = Math.ceil((endMs - startMs) / chunks);
  const ranges: [string, string][] = [];
  for (let i = 0; i < chunks; i++) {
    const s = new Date(startMs + i * chunkSize).toISOString().slice(0, 10);
    const e = new Date(Math.min(startMs + (i + 1) * chunkSize, endMs)).toISOString().slice(0, 10);
    ranges.push([s, e]);
  }
  return ranges;
}

async function fetchAllRuns(): Promise<WorkflowRun[]> {
  const startMs = new Date(SINCE).getTime();
  const endMs = NOW;
  const allRuns = new Map<number, WorkflowRun>(); // dedupe by run ID

  // ---------------------------------------------------------------------------
  // Strategy 1: Single global query (works for small repos)
  // ---------------------------------------------------------------------------
  const globalResult = await paginateRuns(
    `repos/${REPO_SLUG}/actions/runs?created=>${SINCE.slice(0, 10)}`
  );
  totalRunCount = globalResult.total;

  if (!globalResult.capped) {
    return globalResult.runs.filter((r) => r.status === "completed");
  }

  console.log(`  API limit hit (1000/${globalResult.total}). Splitting into date-range chunks...`);

  // ---------------------------------------------------------------------------
  // Strategy 2: Split the date range into chunks, each gets its own 1000 cap
  // Adaptive: aim for ~800 runs per chunk to stay safely under 1000
  // ---------------------------------------------------------------------------
  const numChunks = Math.max(2, Math.ceil(globalResult.total / 800));
  const dateChunks = splitDateRange(startMs, endMs, numChunks);
  let anyChunkCapped = false;
  const cappedChunks: [string, string][] = [];

  // Fetch date chunks in parallel batches of 3
  const CHUNK_BATCH = 3;
  for (let i = 0; i < dateChunks.length; i += CHUNK_BATCH) {
    const batch = dateChunks.slice(i, i + CHUNK_BATCH);
    const results = await Promise.all(
      batch.map(async ([start, end]) => {
        const result = await paginateRuns(
          `repos/${REPO_SLUG}/actions/runs?created=${start}..${end}`
        );
        if (result.capped) cappedChunks.push([start, end]);
        return result;
      })
    );
    for (const result of results) {
      for (const run of result.runs) allRuns.set(run.id, run);
    }
    process.stdout.write(`  ${Math.min(i + CHUNK_BATCH, dateChunks.length)}/${dateChunks.length} date chunks fetched (${allRuns.size} runs)\r`);
  }
  console.log(`  ${dateChunks.length}/${dateChunks.length} date chunks fetched — ${allRuns.size} runs`);

  if (!cappedChunks.length) {
    totalRunCount = allRuns.size;
    return [...allRuns.values()].filter((r) => r.status === "completed");
  }

  // ---------------------------------------------------------------------------
  // Strategy 3: For any date chunks that were STILL capped, fetch per-workflow
  // within that date range. Each workflow × date chunk gets its own 1000 cap.
  // ---------------------------------------------------------------------------
  console.log(`  ${cappedChunks.length} chunk(s) still capped. Fetching per-workflow for those ranges...`);

  const workflows = await ghApi<{ workflows: { id: number; name: string }[] }>(
    `repos/${REPO_SLUG}/actions/workflows?per_page=100`
  );

  let anyStillCapped = false;
  for (const [start, end] of cappedChunks) {
    const WF_BATCH = 3;
    for (let i = 0; i < workflows.workflows.length; i += WF_BATCH) {
      const batch = workflows.workflows.slice(i, i + WF_BATCH);
      const results = await Promise.all(
        batch.map(async (wf) => {
          const result = await paginateRuns(
            `repos/${REPO_SLUG}/actions/workflows/${wf.id}/runs?created=${start}..${end}`
          );
          if (result.capped) {
            console.warn(`  ⚠ ${wf.name} (${start}..${end}): fetched 1000 of ${result.total} runs`);
            anyStillCapped = true;
          }
          return result;
        })
      );
      for (const result of results) {
        for (const run of result.runs) allRuns.set(run.id, run);
      }
    }
  }
  console.log(`  Per-workflow fallback complete — ${allRuns.size} total unique runs`);

  totalRunCount = allRuns.size;
  runsTruncated = anyStillCapped;
  if (anyStillCapped) {
    console.warn(`  ⚠ Some workflow+date ranges still exceeded 1000 runs. Use a shorter --days window.`);
  }

  return [...allRuns.values()].filter((r) => r.status === "completed");
}

async function fetchJobsForRun(runId: number): Promise<Job[]> {
  const data = await ghApi<{ jobs: Job[] }>(
    `repos/${REPO_SLUG}/actions/runs/${runId}/jobs?per_page=100`
  );
  return data.jobs;
}

async function fetchMergedPRs(): Promise<PR[]> {
  const prs: PR[] = [];
  let page = 1;
  while (page <= 5) {
    const data = await ghApi<PR[]>(
      `repos/${REPO_SLUG}/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=${page}`
    );
    if (!data.length) break;
    for (const pr of data) {
      if (!pr.merged_at) continue;
      if (new Date(pr.merged_at).getTime() < new Date(SINCE).getTime()) {
        return prs; // Past our window, stop
      }
      prs.push(pr);
    }
    page++;
  }
  return prs;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function durSec(start: string, end: string): number {
  return (new Date(end).getTime() - new Date(start).getTime()) / 1000;
}
function dateKey(iso: string): string {
  return iso.slice(0, 10);
}
function weekKey(iso: string): string {
  const d = new Date(iso);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const ys = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const wn = Math.ceil(((d.getTime() - ys.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(wn).padStart(2, "0")}`;
}
function avg(a: number[]): number {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
}
function median(a: number[]): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function p95(a: number[]): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length * 0.95)];
}
function fmtDur(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) {
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return s ? `${m}m ${s}s` : `${m}m`;
  }
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}
function r1(n: number): number {
  return Math.round(n * 10) / 10;
}
function timeAgo(iso: string): string {
  const diff = (NOW - new Date(iso).getTime()) / 1000;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Inline SVG line chart (server-side rendered)
function svgLine(
  points: number[],
  w: number,
  h: number,
  color: string,
  opts?: { fill?: boolean; yMin?: number; yMax?: number }
): string {
  if (points.length < 2)
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"></svg>`;
  const yMin = opts?.yMin ?? Math.min(...points);
  const yMax = opts?.yMax ?? Math.max(...points);
  const range = yMax - yMin || 1;
  const pad = 2;
  const iw = w - pad * 2;
  const ih = h - pad * 2;
  const coords = points.map((v, i) => {
    const x = pad + (i / (points.length - 1)) * iw;
    const y = pad + ih - ((v - yMin) / range) * ih;
    return `${r1(x)},${r1(y)}`;
  });
  const polyline = `<polyline points="${coords.join(" ")}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  let fillPoly = "";
  if (opts?.fill) {
    const bottom = pad + ih;
    fillPoly = `<polygon points="${r1(pad)},${bottom} ${coords.join(" ")} ${r1(pad + iw)},${bottom}" fill="${color}" opacity="0.1"/>`;
  }
  // End dot
  const lastCoord = coords[coords.length - 1].split(",");
  const dot = `<circle cx="${lastCoord[0]}" cy="${lastCoord[1]}" r="2.5" fill="${color}"/>`;
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${fillPoly}${polyline}${dot}</svg>`;
}

// Delta arrow HTML — shows percentage change, requires both periods to have data
function deltaArrow(
  current: number,
  previous: number,
  invertColor = false,
  opts?: { currentN?: number; previousN?: number }
): string {
  const minN = 2;
  // If either period has insufficient data, don't show a misleading delta
  if (opts && ((opts.previousN ?? 0) < minN || (opts.currentN ?? 0) < minN))
    return `<span style="color:var(--text2)">—</span>`;
  if (previous === 0 && current === 0) return `<span style="color:var(--text2)">—</span>`;
  if (previous === 0) return `<span style="color:var(--text2)">—</span>`;
  const pctChange = ((current - previous) / Math.abs(previous)) * 100;
  if (Math.abs(pctChange) < 1) return `<span style="color:var(--text2)">→</span>`;
  const up = pctChange > 0;
  const arrow = up ? "↑" : "↓";
  const good = invertColor ? !up : up;
  const color = good ? "var(--green)" : "var(--red)";
  return `<span style="color:${color}">${arrow}${Math.abs(Math.round(pctChange))}%</span>`;
}

// Success rate inline bar (pure HTML)
function rateBar(rate: number): string {
  const color = rate >= 95 ? "var(--green)" : rate >= 80 ? "var(--orange)" : "var(--red)";
  return `<div style="display:flex;align-items:center;gap:8px;">` +
    `<span style="color:${color};font-weight:600;min-width:42px">${r1(rate)}%</span>` +
    `<div style="flex:1;height:6px;background:var(--border);border-radius:3px;min-width:60px;max-width:120px;">` +
    `<div style="width:${Math.min(rate, 100)}%;height:100%;background:${color};border-radius:3px;"></div>` +
    `</div></div>`;
}

// ---------------------------------------------------------------------------
// Fetch data
// ---------------------------------------------------------------------------

console.log(`Fetching data for ${REPO_SLUG} (last ${DAYS} days)...`);

const [runs, mergedPRs] = await Promise.all([fetchAllRuns(), fetchMergedPRs()]);
console.log(`  ${runs.length} completed runs, ${mergedPRs.length} merged PRs`);
console.log(`  Fetching job details...`);

const allJobs: { run: WorkflowRun; jobs: Job[] }[] = [];
const BATCH = 20;
for (let i = 0; i < runs.length; i += BATCH) {
  const batch = runs.slice(i, i + BATCH);
  const results = await Promise.all(
    batch.map(async (run) => ({ run, jobs: await fetchJobsForRun(run.id) }))
  );
  allJobs.push(...results);
  if (i + BATCH < runs.length)
    process.stdout.write(`  ${Math.min(i + BATCH, runs.length)}/${runs.length}\r`);
}
console.log(`  ${runs.length}/${runs.length} runs processed`);

// ---------------------------------------------------------------------------
// Compute metrics
// ---------------------------------------------------------------------------

// Split window for delta computation: recent half vs prior half
const midpoint = NOW - (DAYS * 86_400_000) / 2;
const recentRuns = allJobs.filter(({ run }) => new Date(run.run_started_at).getTime() >= midpoint);
const priorRuns = allJobs.filter(({ run }) => new Date(run.run_started_at).getTime() < midpoint);

function computeRate(items: { run: WorkflowRun }[]): number {
  if (!items.length) return 0;
  return (items.filter(({ run }) => run.conclusion === "success").length / items.length) * 100;
}
function computeAvgDur(items: { run: WorkflowRun }[]): number {
  if (!items.length) return 0;
  return avg(items.map(({ run }) => durSec(run.run_started_at, run.updated_at)));
}

const recentRate = computeRate(recentRuns);
const priorRate = computeRate(priorRuns);
const recentAvgDur = computeAvgDur(recentRuns);
const priorAvgDur = computeAvgDur(priorRuns);

// -- Flakiness detection --
// Flaky = mixed pass/fail on same workflow+branch OR run_attempt > 1 (retried)
interface FlakyEntry {
  workflow: string;
  branch: string;
  total: number;
  failures: number;
  successes: number;
  retries: number;
}
const flakyMap = new Map<
  string,
  { workflow: string; branch: string; conclusions: string[]; retries: number }
>();
for (const { run } of allJobs) {
  const key = `${run.name}::${run.head_branch}`;
  let entry = flakyMap.get(key);
  if (!entry) entry = { workflow: run.name, branch: run.head_branch, conclusions: [], retries: 0 };
  entry.conclusions.push(run.conclusion || "unknown");
  if (run.run_attempt > 1) entry.retries += run.run_attempt - 1;
  flakyMap.set(key, entry);
}

const flakyEntries: FlakyEntry[] = [];
for (const [, entry] of flakyMap) {
  const successes = entry.conclusions.filter((c) => c === "success").length;
  const failures = entry.conclusions.filter((c) => c !== "success").length;
  const isMixed = successes > 0 && failures > 0;
  const hasRetries = entry.retries > 0;
  if (isMixed || hasRetries) {
    flakyEntries.push({
      workflow: entry.workflow,
      branch: entry.branch,
      total: entry.conclusions.length,
      failures,
      successes,
      retries: entry.retries,
    });
  }
}
flakyEntries.sort((a, b) => (b.failures + b.retries) - (a.failures + a.retries));

// Total retries across all runs
const totalRetries = allJobs.reduce((sum, { run }) => sum + Math.max(0, run.run_attempt - 1), 0);

// First-attempt success rate — the true reliability signal
const firstAttemptRuns = allJobs.filter(({ run }) => run.run_attempt === 1);
const firstAttemptSuccesses = firstAttemptRuns.filter(({ run }) => run.conclusion === "success").length;
const firstAttemptRate = firstAttemptRuns.length
  ? r1((firstAttemptSuccesses / firstAttemptRuns.length) * 100)
  : 0;

// -- Time-to-merge --
interface MergeEntry {
  number: number;
  title: string;
  duration: number; // seconds
  mergedAt: string;
}
const mergeEntries: MergeEntry[] = mergedPRs
  .filter((pr) => pr.merged_at)
  .map((pr) => ({
    number: pr.number,
    title: pr.title,
    duration: durSec(pr.created_at, pr.merged_at!),
    mergedAt: pr.merged_at!,
  }))
  .sort((a, b) => b.mergedAt.localeCompare(a.mergedAt));

const mergeDurations = mergeEntries.map((e) => e.duration);
const recentMerges = mergeEntries.filter((e) => new Date(e.mergedAt).getTime() >= midpoint);
const priorMerges = mergeEntries.filter((e) => new Date(e.mergedAt).getTime() < midpoint);

// -- Recent failures with resolved status --
interface FailureEntry {
  workflow: string;
  branch: string;
  date: string;
  timeAgo: string;
  url: string;
  resolved: boolean;
}
// Find the most recent conclusion per workflow+branch
const latestConclusion = new Map<string, string>();
for (const { run } of [...allJobs].sort(
  (a, b) => new Date(b.run.run_started_at).getTime() - new Date(a.run.run_started_at).getTime()
)) {
  const key = `${run.name}::${run.head_branch}`;
  if (!latestConclusion.has(key)) latestConclusion.set(key, run.conclusion || "unknown");
}

const recentFailures: FailureEntry[] = allJobs
  .filter(({ run }) => run.conclusion !== "success")
  .map(({ run }) => {
    const key = `${run.name}::${run.head_branch}`;
    return {
      workflow: run.name,
      branch: run.head_branch,
      date: run.run_started_at,
      timeAgo: timeAgo(run.run_started_at),
      url: run.html_url,
      resolved: latestConclusion.get(key) === "success",
    };
  })
  .sort((a, b) => b.date.localeCompare(a.date))
  .slice(0, 10);

const unresolvedCount = new Set(
  recentFailures.filter((f) => !f.resolved).map((f) => `${f.workflow}::${f.branch}`)
).size;

// -- Health verdict --
const totalRuns = runs.length;
const totalSuccesses = runs.filter((r) => r.conclusion === "success").length;
const overallRate = totalRuns ? r1((totalSuccesses / totalRuns) * 100) : 0;
const allDurations = allJobs.map(({ run }) => durSec(run.run_started_at, run.updated_at));
const failures7d = allJobs.filter(
  ({ run }) =>
    run.conclusion !== "success" &&
    NOW - new Date(run.run_started_at).getTime() < 7 * 86_400_000
).length;

let health: "healthy" | "attention" | "failing";
const retryRatePct = totalRuns ? (totalRetries / totalRuns) * 100 : 0;
if (overallRate >= 95 && unresolvedCount === 0 && firstAttemptRate >= 90) health = "healthy";
else if (overallRate >= 80 && firstAttemptRate >= 70) health = "attention";
else health = "failing";

// -- Daily metrics --
const dailyMap = new Map<string, { total: number; successes: number; failures: number; durations: number[] }>();
for (const { run } of allJobs) {
  const dk = dateKey(run.run_started_at);
  let d = dailyMap.get(dk);
  if (!d) d = { total: 0, successes: 0, failures: 0, durations: [] };
  d.total++;
  if (run.conclusion === "success") d.successes++;
  else d.failures++;
  d.durations.push(durSec(run.run_started_at, run.updated_at));
  dailyMap.set(dk, d);
}
const daily = [...dailyMap.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([date, d]) => ({
    date,
    total: d.total,
    successes: d.successes,
    failures: d.failures,
    avgDuration: Math.round(avg(d.durations)),
  }));

// -- Per-workflow data --
const allWeeks = new Set<string>();
const wfAccum = new Map<
  string,
  {
    durations: number[];
    successes: number;
    failures: number;
    total: number;
    recentDurations: number[];
    priorDurations: number[];
    recentSuccesses: number;
    recentTotal: number;
    priorSuccesses: number;
    priorTotal: number;
    jobMap: Map<string, { durations: number[]; successes: number; failures: number; total: number }>;
    weekMap: Map<string, { total: number; successes: number; durations: number[] }>;
    dailyMap: Map<string, { total: number; successes: number; durations: number[] }>;
    runs: {
      date: string;
      branch: string;
      conclusion: string;
      duration: string;
      url: string;
    }[];
  }
>();

for (const { run, jobs } of allJobs) {
  let w = wfAccum.get(run.name);
  if (!w) {
    w = {
      durations: [], successes: 0, failures: 0, total: 0,
      recentDurations: [], priorDurations: [],
      recentSuccesses: 0, recentTotal: 0, priorSuccesses: 0, priorTotal: 0,
      jobMap: new Map(), weekMap: new Map(), dailyMap: new Map(), runs: [],
    };
    wfAccum.set(run.name, w);
  }

  const dur = durSec(run.run_started_at, run.updated_at);
  const isRecent = new Date(run.run_started_at).getTime() >= midpoint;
  w.total++;
  w.durations.push(dur);
  if (run.conclusion === "success") w.successes++;
  else w.failures++;

  if (isRecent) {
    w.recentTotal++;
    w.recentDurations.push(dur);
    if (run.conclusion === "success") w.recentSuccesses++;
  } else {
    w.priorTotal++;
    w.priorDurations.push(dur);
    if (run.conclusion === "success") w.priorSuccesses++;
  }

  w.runs.push({
    date: dateKey(run.run_started_at),
    branch: run.head_branch,
    conclusion: run.conclusion || "unknown",
    duration: fmtDur(dur),
    url: run.html_url,
  });

  const wk = weekKey(run.run_started_at);
  allWeeks.add(wk);
  let wp = w.weekMap.get(wk);
  if (!wp) wp = { total: 0, successes: 0, durations: [] };
  wp.total++;
  if (run.conclusion === "success") wp.successes++;
  wp.durations.push(dur);
  w.weekMap.set(wk, wp);

  const dk = dateKey(run.run_started_at);
  let dp = w.dailyMap.get(dk);
  if (!dp) dp = { total: 0, successes: 0, durations: [] };
  dp.total++;
  if (run.conclusion === "success") dp.successes++;
  dp.durations.push(dur);
  w.dailyMap.set(dk, dp);

  for (const job of jobs) {
    let jm = w.jobMap.get(job.name);
    if (!jm) jm = { durations: [], successes: 0, failures: 0, total: 0 };
    jm.total++;
    if (job.conclusion === "success") jm.successes++;
    else jm.failures++;
    if (job.started_at && job.completed_at) jm.durations.push(durSec(job.started_at, job.completed_at));
    w.jobMap.set(job.name, jm);
  }
}

const sortedWeeks = [...allWeeks].sort();

// Build per-workflow objects sorted by failure rate (worst first)
const workflows = [...wfAccum.entries()]
  .map(([name, w]) => {
    const rate = w.total ? r1((w.successes / w.total) * 100) : 0;
    const recentRate = w.recentTotal ? (w.recentSuccesses / w.recentTotal) * 100 : 0;
    const priorRate = w.priorTotal ? (w.priorSuccesses / w.priorTotal) * 100 : 0;
    const recentDur = avg(w.recentDurations);
    const priorDur = avg(w.priorDurations);

    return {
      name,
      total: w.total,
      successes: w.successes,
      failures: w.failures,
      rate,
      avgDur: avg(w.durations),
      recentRate,
      priorRate,
      recentDur,
      priorDur,
      recentN: w.recentTotal,
      priorN: w.priorTotal,
      jobs: [...w.jobMap.entries()]
        .sort(([, a], [, b]) => b.total - a.total)
        .map(([jn, jm]) => ({
          name: jn,
          total: jm.total,
          successes: jm.successes,
          failures: jm.failures,
          avg: fmtDur(avg(jm.durations)),
          median: fmtDur(median(jm.durations)),
          p95: fmtDur(p95(jm.durations)),
        })),
      weekly: sortedWeeks.map((wk) => {
        const wp = w.weekMap.get(wk);
        if (!wp) return { week: wk, total: 0, successes: 0, successRate: 0, avgDurMin: 0 };
        return {
          week: wk,
          total: wp.total,
          successes: wp.successes,
          successRate: r1(wp.total ? (wp.successes / wp.total) * 100 : 0),
          avgDurMin: r1(avg(wp.durations) / 60),
        };
      }),
      daily: [...w.dailyMap.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, dp]) => ({
          date,
          total: dp.total,
          successes: dp.successes,
          avgDurSec: Math.round(avg(dp.durations)),
        })),
      runs: w.runs.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20),
    };
  })
  .sort((a, b) => a.rate - b.rate); // Worst first

// ---------------------------------------------------------------------------
// Build the HTML
// ---------------------------------------------------------------------------

const COLORS = ["#58a6ff", "#3fb950", "#d29922", "#f85149", "#bc8cff", "#f0883e", "#56d4dd", "#db61a2"];
const healthColor = health === "healthy" ? "var(--green)" : health === "attention" ? "var(--orange)" : "var(--red)";
const healthLabel = health === "healthy" ? "Healthy" : health === "attention" ? "Needs Attention" : "Failing";

// -- Failures callout HTML --
const failuresHtml = recentFailures.length
  ? `<div class="callout failures-callout">
      <div class="callout-title">Recent Failures</div>
      ${recentFailures
        .slice(0, 6)
        .map(
          (f) =>
            `<div class="failure-row">
              <span class="failure-wf">${esc(f.workflow)}</span>
              <span class="failure-branch">${esc(f.branch)}</span>
              <span class="badge ${f.resolved ? "resolved" : "unresolved"}">${f.resolved ? "resolved" : "unresolved"}</span>
              <span class="failure-time">${f.timeAgo}</span>
              <a href="${f.url}" target="_blank">View</a>
            </div>`
        )
        .join("")}
    </div>`
  : "";

// -- Flaky callout HTML --
const flakyHtml = flakyEntries.length
  ? `<div class="callout flaky-callout">
      <div class="callout-title">Flaky Pipelines <span class="callout-count">${flakyEntries.length}</span></div>
      <div class="callout-subtitle">Branches with mixed pass/fail results or retries on the same workflow${totalRetries ? ` &middot; ${totalRetries} total retries` : ""}</div>
      <table class="mini-table">
        <thead><tr><th>Workflow</th><th>Branch</th><th>Runs</th><th>Failures</th><th>Retries</th><th>Flake Rate</th></tr></thead>
        <tbody>${flakyEntries
          .slice(0, 10)
          .map(
            (f) =>
              `<tr><td>${esc(f.workflow)}</td><td>${esc(f.branch)}</td><td>${f.total}</td>` +
              `<td class="red">${f.failures}</td>` +
              `<td>${f.retries || "—"}</td>` +
              `<td>${r1(((f.failures + f.retries) / (f.total + f.retries)) * 100)}%</td></tr>`
          )
          .join("")}</tbody>
      </table>
    </div>`
  : "";

// -- Time-to-merge HTML --
const ttmHtml = mergeEntries.length
  ? `<div class="section">
      <h2>Time-to-Merge</h2>
      <div class="kpi-row" style="margin-bottom:1.25rem;">
        <div class="kpi"><div class="kpi-value">${fmtDur(avg(mergeDurations))}</div><div class="kpi-label">Avg</div></div>
        <div class="kpi"><div class="kpi-value">${fmtDur(median(mergeDurations))}</div><div class="kpi-label">Median</div></div>
        <div class="kpi"><div class="kpi-value">${fmtDur(p95(mergeDurations))}</div><div class="kpi-label">P95</div></div>
        <div class="kpi">
          <div class="kpi-value">${(() => {
            const recent = avg(recentMerges.map((e) => e.duration));
            const prior = avg(priorMerges.map((e) => e.duration));
            return deltaArrow(recent, prior, true, { currentN: recentMerges.length, previousN: priorMerges.length });
          })()}</div>
          <div class="kpi-label">Trend</div>
        </div>
      </div>
      <table class="mini-table">
        <thead><tr><th>PR</th><th>Title</th><th>Time to Merge</th><th>Merged</th></tr></thead>
        <tbody>${mergeEntries
          .slice(0, 10)
          .map(
            (e) =>
              `<tr><td>#${e.number}</td><td>${esc(e.title)}</td>` +
              `<td>${fmtDur(e.duration)}</td><td>${timeAgo(e.mergedAt)}</td></tr>`
          )
          .join("")}</tbody>
      </table>
    </div>`
  : "";

// -- Workflow table rows --
const wfRowsHtml = workflows
  .map(
    (wf, i) =>
      `<tr class="wf-row" data-idx="${i}">
        <td><span class="wf-chevron">&#9654;</span>${esc(wf.name)}</td>
        <td>${wf.total}</td>
        <td>${rateBar(wf.rate)}</td>
        <td>${deltaArrow(wf.recentRate, wf.priorRate, false, { currentN: wf.recentN, previousN: wf.priorN })}</td>
        <td>${fmtDur(wf.avgDur)}</td>
        <td>${deltaArrow(wf.recentDur, wf.priorDur, true, { currentN: wf.recentN, previousN: wf.priorN })}</td>
      </tr>
      <tr class="wf-detail" id="wf-detail-${i}"><td colspan="6"><div class="wf-detail-inner" id="wf-inner-${i}"></div></td></tr>`
  )
  .join("");

// -- Small multiples (inline SVG) --
// Compute global y ranges for consistent axes across workflows
const allWeeklyRates = workflows.flatMap((wf) => wf.weekly.map((w) => w.successRate));
const allWeeklyDurs = workflows.flatMap((wf) => wf.weekly.map((w) => w.avgDurMin));
const rateMin = Math.min(...allWeeklyRates, 0);
const rateMax = Math.max(...allWeeklyRates, 100);
const durMin = Math.min(...allWeeklyDurs, 0);
const durMax = Math.max(...allWeeklyDurs, 1);

const smallMultiplesHtml = workflows
  .map((wf, i) => {
    const color = COLORS[i % COLORS.length];
    const rates = wf.weekly.map((w) => w.successRate);
    const durs = wf.weekly.map((w) => w.avgDurMin);
    return `<div class="sm-row">
      <div class="sm-label" style="border-left:3px solid ${color}">${esc(wf.name)}</div>
      <div class="sm-chart">${svgLine(rates, 200, 48, color, { yMin: rateMin, yMax: rateMax })}
        <span class="sm-value">${r1(rates[rates.length - 1] ?? 0)}%</span></div>
      <div class="sm-chart">${svgLine(durs, 200, 48, color, { yMin: durMin, yMax: durMax })}
        <span class="sm-value">${r1(durs[durs.length - 1] ?? 0)}m</span></div>
    </div>`;
  })
  .join("");

// -- Embed workflow data as JSON for drill-in interactivity --
const wfDataJson = JSON.stringify(
  workflows.map((wf, i) => ({
    ...wf,
    color: COLORS[i % COLORS.length],
    avgDur: fmtDur(wf.avgDur),
  }))
);

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CI Report — ${esc(REPO_SLUG)}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<style>
:root {
  --bg: #0d1117; --surface: #161b22; --border: #30363d;
  --text: #e6edf3; --text2: #8b949e; --green: #3fb950;
  --red: #f85149; --blue: #58a6ff; --orange: #d29922;
  --purple: #bc8cff; --hover: #1c2129;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  background: var(--bg); color: var(--text); padding: 2rem 2.5rem; line-height: 1.5;
  max-width: 1100px; margin: 0 auto; }

/* Header */
.header { margin-bottom: 2rem; }
.header h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 0.15rem; }
.header .subtitle { color: var(--text2); font-size: 0.82rem; }

/* Health verdict */
.verdict { background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
  padding: 1.5rem 1.75rem; margin-bottom: 1.5rem; }
.verdict-top { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1.25rem; }
.health-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.health-label { font-size: 1.1rem; font-weight: 600; }

.kpi-row { display: flex; gap: 2rem; flex-wrap: wrap; }
.kpi { }
.kpi-value { font-size: 1.35rem; font-weight: 600; }
.kpi-label { font-size: 0.72rem; color: var(--text2); text-transform: uppercase; letter-spacing: 0.04em; }

/* Callouts */
.callout { background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
  padding: 1.25rem 1.5rem; margin-bottom: 1.25rem; }
.callout-title { font-weight: 600; font-size: 0.9rem; margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.5rem; }
.callout-subtitle { font-size: 0.78rem; color: var(--text2); margin-bottom: 0.75rem; }
.callout-count { background: var(--border); padding: 0.1rem 0.5rem; border-radius: 10px; font-size: 0.75rem; font-weight: 500; }
.callout-note { font-size: 0.78rem; color: var(--text2); margin-top: 0.5rem; }

.failure-row { display: flex; align-items: center; gap: 0.75rem; padding: 0.3rem 0; font-size: 0.82rem; }
.failure-wf { font-weight: 500; min-width: 120px; }
.failure-branch { color: var(--text2); font-family: monospace; font-size: 0.78rem; }
.failure-time { color: var(--text2); font-size: 0.78rem; }

.badge { display: inline-block; padding: 0.1rem 0.45rem; border-radius: 10px; font-size: 0.7rem; font-weight: 500; }
.badge.resolved { background: rgba(63,185,80,0.12); color: var(--green); }
.badge.unresolved { background: rgba(248,81,73,0.12); color: var(--red); }
.badge.success { background: rgba(63,185,80,0.12); color: var(--green); }
.badge.failure { background: rgba(248,81,73,0.12); color: var(--red); }

/* Sections */
.section { margin-bottom: 2rem; }
.section h2 { font-size: 1.1rem; font-weight: 600; margin-bottom: 0.75rem;
  padding-bottom: 0.4rem; border-bottom: 1px solid var(--border); }

/* Tables */
table { width: 100%; border-collapse: collapse; }
.mini-table { background: transparent; }
.mini-table th, .mini-table td { padding: 0.4rem 0.6rem; font-size: 0.8rem;
  border-bottom: 1px solid var(--border); text-align: left; }
.mini-table th { color: var(--text2); font-weight: 500; text-transform: uppercase;
  font-size: 0.68rem; letter-spacing: 0.04em; }
.mini-table tr:last-child td { border-bottom: none; }

/* Workflow table */
.wf-table { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
.wf-table th, .wf-table td { padding: 0.65rem 0.9rem; font-size: 0.84rem;
  border-bottom: 1px solid var(--border); text-align: left; }
.wf-table th { color: var(--text2); font-weight: 500; text-transform: uppercase;
  font-size: 0.68rem; letter-spacing: 0.04em; }
.wf-row { cursor: pointer; transition: background 0.12s; }
.wf-row:hover { background: var(--hover); }
.wf-row td:first-child { font-weight: 600; }
.wf-chevron { display: inline-block; transition: transform 0.2s; margin-right: 0.4rem;
  color: var(--text2); font-size: 0.65rem; }
.wf-row.open .wf-chevron { transform: rotate(90deg); }
.wf-detail { display: none; }
.wf-detail.open { display: table-row; }
.wf-detail-inner { padding: 1.25rem; background: var(--bg); }
.wf-detail-inner .detail-charts { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin: 1rem 0; }
.wf-detail-inner .chart-box { background: var(--surface); border: 1px solid var(--border);
  border-radius: 8px; padding: 1rem; }
.wf-detail-inner .chart-box h4 { font-size: 0.78rem; color: var(--text2); margin-bottom: 0.5rem; font-weight: 500; }

/* Small multiples */
.sm-section { background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
  padding: 1.25rem 1.5rem; }
.sm-header { display: grid; grid-template-columns: 140px 1fr 1fr; gap: 0.5rem;
  padding-bottom: 0.5rem; margin-bottom: 0.25rem; border-bottom: 1px solid var(--border); }
.sm-header span { font-size: 0.68rem; color: var(--text2); text-transform: uppercase;
  letter-spacing: 0.04em; font-weight: 500; }
.sm-row { display: grid; grid-template-columns: 140px 1fr 1fr; gap: 0.5rem;
  align-items: center; padding: 0.4rem 0; }
.sm-label { font-size: 0.82rem; font-weight: 500; padding-left: 0.5rem; }
.sm-chart { display: flex; align-items: center; gap: 0.5rem; }
.sm-chart svg { flex-shrink: 0; }
.sm-value { font-size: 0.78rem; color: var(--text2); font-weight: 500; min-width: 36px; }

/* Daily charts */
.daily-charts { display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem; margin-bottom: 1.5rem; }
.daily-chart-box { background: var(--surface); border: 1px solid var(--border);
  border-radius: 10px; padding: 1.25rem; }
.daily-chart-box h3 { font-size: 0.82rem; color: var(--text2); margin-bottom: 0.75rem; font-weight: 500; }

a { color: var(--blue); text-decoration: none; }
a:hover { text-decoration: underline; }
.green { color: var(--green); } .red { color: var(--red); } .blue { color: var(--blue); }

@media (max-width: 768px) {
  body { padding: 1rem; }
  .daily-charts, .wf-detail-inner .detail-charts { grid-template-columns: 1fr; }
  .kpi-row { gap: 1rem; }
  .sm-header, .sm-row { grid-template-columns: 100px 1fr 1fr; }
}
</style>
</head>
<body>

<!-- Header -->
<div class="header">
  <h1>${esc(REPO_SLUG)}</h1>
  <div class="subtitle">CI Report &middot; Last ${DAYS} days &middot; Generated ${new Date().toISOString().slice(0, 10)}${runsTruncated ? ` &middot; <span style="color:var(--orange)">Showing ${runs.length} of ${totalRunCount} runs (GitHub API limit &mdash; use a shorter --days window)</span>` : ""}</div>
</div>

<!-- Health Verdict -->
<div class="verdict">
  <div class="verdict-top">
    <div class="health-dot" style="background:${healthColor}"></div>
    <div class="health-label" style="color:${healthColor}">${healthLabel}</div>
  </div>
  <div class="kpi-row">
    <div class="kpi">
      <div class="kpi-value">${overallRate}% ${deltaArrow(recentRate, priorRate, false, { currentN: recentRuns.length, previousN: priorRuns.length })}</div>
      <div class="kpi-label">Success Rate</div>
    </div>
    <div class="kpi">
      <div class="kpi-value${firstAttemptRate < overallRate - 1 ? " orange" : ""}">${firstAttemptRate}%</div>
      <div class="kpi-label">1st Attempt Pass</div>
    </div>
    <div class="kpi">
      <div class="kpi-value">${fmtDur(avg(allDurations))} ${deltaArrow(recentAvgDur, priorAvgDur, true, { currentN: recentRuns.length, previousN: priorRuns.length })}</div>
      <div class="kpi-label">Avg Duration</div>
    </div>
    <div class="kpi">
      <div class="kpi-value${failures7d > 0 ? " red" : ""}">${failures7d}</div>
      <div class="kpi-label">Failures (7d)</div>
    </div>
    <div class="kpi">
      <div class="kpi-value">${flakyEntries.length}${totalRetries ? ` <span style="font-size:0.75em;color:var(--text2)">(${totalRetries} retries)</span>` : ""}</div>
      <div class="kpi-label">Flaky Pipelines</div>
    </div>
    <div class="kpi">
      <div class="kpi-value">${mergeEntries.length ? fmtDur(median(mergeDurations)) : "—"}</div>
      <div class="kpi-label">Median TTM</div>
    </div>
    <div class="kpi">
      <div class="kpi-value blue">${totalRuns}</div>
      <div class="kpi-label">Total Runs</div>
    </div>
  </div>
</div>

<!-- Failures callout -->
${failuresHtml}

<!-- Flaky callout -->
${flakyHtml}

<!-- Daily charts -->
<div class="daily-charts">
  <div class="daily-chart-box">
    <h3>Daily Runs</h3>
    <canvas id="dailyChart" height="160"></canvas>
  </div>
  <div class="daily-chart-box">
    <h3>Daily Avg Duration</h3>
    <canvas id="durationChart" height="160"></canvas>
  </div>
</div>

<!-- Workflows -->
<div class="section">
  <h2>Workflows</h2>
  <table class="wf-table">
    <thead>
      <tr><th>Workflow</th><th>Runs</th><th>Success Rate</th><th></th><th>Avg Duration</th><th></th></tr>
    </thead>
    <tbody>${wfRowsHtml}</tbody>
  </table>
</div>

<!-- Trends (small multiples) -->
<div class="section">
  <h2>Trends</h2>
  <div class="sm-section">
    <div class="sm-header">
      <span>Workflow</span>
      <span>Success Rate (${sortedWeeks[0] ?? ""} → ${sortedWeeks[sortedWeeks.length - 1] ?? ""})</span>
      <span>Avg Duration</span>
    </div>
    ${smallMultiplesHtml}
  </div>
</div>

<!-- Time-to-Merge -->
${ttmHtml}

<script>
// ---------- Data for drill-ins ----------
const WF_DATA = ${wfDataJson};

// ---------- Chart config ----------
const CD = {
  responsive: true,
  plugins: { legend: { labels: { color: '#8b949e', boxWidth: 12, padding: 12 } } },
  scales: {
    x: { ticks: { color: '#8b949e', maxRotation: 45, font: { size: 10 } }, grid: { color: '#21262d' } },
    y: { ticks: { color: '#8b949e', font: { size: 10 } }, grid: { color: '#21262d' }, beginAtZero: true }
  }
};

// ---------- Daily charts ----------
new Chart(document.getElementById('dailyChart'), {
  type: 'bar',
  data: {
    labels: ${JSON.stringify(daily.map((d) => d.date))},
    datasets: [
      { label: 'Pass', data: ${JSON.stringify(daily.map((d) => d.successes))}, backgroundColor: '#238636', borderRadius: 2, order: 2 },
      { label: 'Fail', data: ${JSON.stringify(daily.map((d) => d.failures))}, backgroundColor: '#da3633', borderRadius: 2, order: 1 },
    ]
  },
  options: { ...CD, scales: {
    x: { ...CD.scales.x, stacked: true }, y: { ...CD.scales.y, stacked: true }
  }}
});

new Chart(document.getElementById('durationChart'), {
  type: 'line',
  data: {
    labels: ${JSON.stringify(daily.map((d) => d.date))},
    datasets: [{
      label: 'Avg (s)', data: ${JSON.stringify(daily.map((d) => d.avgDuration))},
      borderColor: '#58a6ff', backgroundColor: 'rgba(88,166,255,0.06)',
      fill: true, tension: 0.3, pointRadius: 2, borderWidth: 1.5
    }]
  },
  options: CD
});

// ---------- Workflow drill-in ----------
const detailCharts = {};

document.querySelectorAll('.wf-row').forEach(row => {
  row.addEventListener('click', () => {
    const i = parseInt(row.dataset.idx);
    const detail = document.getElementById('wf-detail-' + i);
    const isOpen = detail.classList.contains('open');

    if (isOpen) {
      detail.classList.remove('open');
      row.classList.remove('open');
      if (detailCharts[i]) { detailCharts[i].forEach(c => c.destroy()); delete detailCharts[i]; }
      return;
    }

    detail.classList.add('open');
    row.classList.add('open');
    const wf = WF_DATA[i];
    const inner = document.getElementById('wf-inner-' + i);

    inner.innerHTML =
      '<table class="mini-table"><thead><tr><th>Job</th><th>Runs</th><th>Success Rate</th><th>Avg</th><th>Median</th><th>P95</th></tr></thead><tbody>' +
      wf.jobs.map(j => {
        const jr = j.total ? Math.round(j.successes / j.total * 1000) / 10 : 0;
        const jc = jr >= 95 ? 'green' : jr >= 80 ? 'orange' : 'red';
        return '<tr><td>' + esc(j.name) + '</td><td>' + j.total + '</td><td class="' + jc + '">' + jr + '%</td>' +
          '<td>' + j.avg + '</td><td>' + j.median + '</td><td>' + j.p95 + '</td></tr>';
      }).join('') +
      '</tbody></table>' +
      '<div class="chart-box" style="margin:1rem 0;"><h4>Daily Avg Duration (seconds)</h4><canvas id="wf-daily-' + i + '"></canvas></div>' +
      '<div class="detail-charts">' +
        '<div class="chart-box"><h4>Weekly Success Rate</h4><canvas id="wf-sr-' + i + '"></canvas></div>' +
        '<div class="chart-box"><h4>Weekly Avg Duration (min)</h4><canvas id="wf-dur-' + i + '"></canvas></div>' +
      '</div>' +
      '<table class="mini-table"><thead><tr><th>Date</th><th>Branch</th><th>Status</th><th>Duration</th><th></th></tr></thead><tbody>' +
      wf.runs.map(r =>
        '<tr><td>' + r.date + '</td><td style="font-family:monospace;font-size:0.78rem;color:var(--text2)">' + esc(r.branch) + '</td>' +
        '<td><span class="badge ' + r.conclusion + '">' + r.conclusion + '</span></td>' +
        '<td>' + r.duration + '</td>' +
        '<td><a href="' + r.url + '" target="_blank">View</a></td></tr>'
      ).join('') +
      '</tbody></table>';

    const miniCD = {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#8b949e', font: { size: 9 } }, grid: { color: '#21262d' } },
        y: { ticks: { color: '#8b949e', font: { size: 9 } }, grid: { color: '#21262d' }, beginAtZero: true }
      }
    };

    const dailyChart = new Chart(document.getElementById('wf-daily-' + i), {
      type: 'bar',
      data: {
        labels: wf.daily.map(d => d.date),
        datasets: [{
          label: 'Avg Duration (s)',
          data: wf.daily.map(d => d.avgDurSec),
          backgroundColor: wf.color + '66',
          borderColor: wf.color,
          borderWidth: 1,
          borderRadius: 2,
        }]
      },
      options: miniCD
    });
    const srChart = new Chart(document.getElementById('wf-sr-' + i), {
      type: 'line',
      data: {
        labels: wf.weekly.map(w => w.week),
        datasets: [{
          data: wf.weekly.map(w => w.successRate),
          borderColor: wf.color, pointRadius: 3, tension: 0.3, fill: false, borderWidth: 1.5
        }]
      },
      options: { ...miniCD, scales: { ...miniCD.scales, y: { ...miniCD.scales.y, min: 0, max: 100 } } }
    });
    const durChart = new Chart(document.getElementById('wf-dur-' + i), {
      type: 'line',
      data: {
        labels: wf.weekly.map(w => w.week),
        datasets: [{
          data: wf.weekly.map(w => w.avgDurMin),
          borderColor: wf.color, pointRadius: 3, tension: 0.3, fill: false, borderWidth: 1.5
        }]
      },
      options: miniCD
    });
    detailCharts[i] = [dailyChart, srChart, durChart];
  });
});

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
</script>
</body>
</html>`;

await Bun.write(OUTPUT, html);
console.log(`\n✓ Report written to ${OUTPUT}`);
console.log(`  Open with: open ${OUTPUT}`);
