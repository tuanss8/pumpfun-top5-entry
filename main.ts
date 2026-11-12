// pumpfun-top5-forecast-01 entry v10: v11 order + horizon-dependent size.
//
// ORDER (v11, unchanged from v9-hybrid): momentum-scored top 10 + 90
// epsilon rows per place (unnamed 0.50). Officially scored order -17.96
// (v9-hybrid, round 9) — the BEST order we ever had, better than rank 1's
// -18.88. Backtest mean order -18.58 (cuts 2,3).
//
// SIZE (v10, NEW — the fix for the -21.33 catastrophe): v7/v8/v9-hybrid
// all share the v8 size (top-scale-anchored centre + 0.30*sqrt(dt),
// sd 0.22-0.32) and ALL scored size -21.33 in the final, despite -12.99
// in backtest. Diagnosis (see pumpfun-top5-v10-status.md):
//   * The anchor helps in the 1h practice (+4.37 over no-anchor) because
//     the top-5 spread collapses in 10-40 min — but it HURTS in the final
//     (v8 -21.33 vs v5 -18.56, same growth/sd, anchor is the only diff).
//   * The 0.30*sqrt(dt) growth extrapolates to +0.95 at 10h, but the
//     official scores (v5 -18.56, v1 -15.63) triangulate true growth at
//     ~+0.5 over ~10h — growth saturates, it does not keep rising as sqrt.
//   * sd ~0.30 is the RIGHT tightness for size -13 (needs p~0.07/bin);
//     widening the sd caps the score at ~-16. So the fix is the CENTRE,
//     not the width.
// v10 size: centre = W(dt)*cutCap[k] + (1-W(dt))*cutCap[0] + G(dt), with
//   W(dt) = 1 - 0.8*exp(-dt/4): anchored (0.2) at short horizons where the
//     spread collapses, ~unanchored (0.93-0.97) at 7-13h where it hurts.
//   G(dt) = 0.6*(1-exp(-dt/2)): saturating growth, ~+0.58 at 7-13h.
//   sd(dt) = sqrt(0.22^2 + (0.065*sqrt(dt))^2): ~0.30 at 10h — the tight
//     sd is REQUIRED for size -13 (peak p ~0.066/bin); a wider sd caps the
//     score at ~-15 even with a perfect centre, so no width hedge.
// Backtest (cuts 3,2,1): order -19.82, size -15.17, log -35.00 — worse
// than v8's -14.35 in backtest BY DESIGN (the backtest measures 10-60 min,
// where the anchor helps; the final is 7-13h, where it hurts). The final
// is what matters: if the triangulation is right, size ~-13.5 to -14.5 and
// total ~-31.5 to -32.5 with order -17.96. If the triangulation is wrong,
// the downside is bounded (~v5's -18.56, not -21.33).
//
// Deterministic: no randomness anywhere. No network, no model calls.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// ---- Order parameters (v11) ----
/** Coins considered per place: the top ORDER_CANDIDATES of the last mark. */
const ORDER_CANDIDATES = 30;
/** Of them, the top ORDER_KEEP by score share the named probability. */
const ORDER_KEEP = 10;
/** Probability shared by the top ORDER_KEEP (proportional to score). */
const NAMED_SHARE = 0.5;
/** Epsilon probability for each of the next EPSILON_COUNT coins. */
const EPSILON = 0.0001;
const EPSILON_COUNT = 90;
/** Momentum weight: momentum_w = 1 + MOMENTUM_BETA * max(0, momentum). */
const MOMENTUM_BETA = 2;
// ---- Size parameters (v10: horizon-dependent anchor + saturating growth) ----
/** Anchor at dt=0: W(0) = ANCHOR_W0 (v8's 0.2). */
const ANCHOR_W0 = 0.2;
/** Anchor decay timescale (hours): W(dt) = 1-(1-W0)*exp(-dt/ANCHOR_TAU). */
const ANCHOR_TAU = 4;
/** Saturating growth ceiling (log10): G(dt) = GROWTH_MAX*(1-exp(-dt/GROWTH_TAU)). */
const GROWTH_MAX = 0.6;
/** Growth saturation timescale (hours). */
const GROWTH_TAU = 2;
/** Base SD of each place's size Normal (log10 cap). */
const SIZE_SD0 = 0.22;
/** SD growth with horizon: sd(dt) = sqrt(SIZE_SD0^2 + (SIZE_SD_GROWTH*sqrt(dt))^2). */
const SIZE_SD_GROWTH = 0.065;
const CENTRE_GAP = 0;

interface Row {
  rank: number;
  mint: string;
  market_cap_lamports: string | number;
  venue?: string;
  mayhem?: boolean;
}
interface Mark {
  at: string;
  ok: boolean;
  rows: Row[] | null;
}

const task = JSON.parse(readFileSync(join(INPUT_DIR, 'task.json'), 'utf8')) as {
  places: number;
  output: string;
  reads: string[];
  size: { edges: number[] };
};
const lines = readFileSync(join(INPUT_DIR, 'history.ndjson'), 'utf8')
  .split('\n')
  .filter((l) => l !== '');
const marks = lines
  .map((l) => JSON.parse(l) as Mark)
  .filter((m) => m.ok === true && Array.isArray(m.rows));
if (marks.length === 0) throw new Error('the history holds no ok mark');
const lastMark = marks[marks.length - 1]!;
const lastAt = Date.parse(lastMark.at);
const readTimes = task.reads.map((r) => Date.parse(r)).sort((a, b) => a - b);
// Hours from the last mark to each answer read.
const readHours = readTimes.map((t) => Math.max(0, (t - lastAt) / 3600000));

// log10 of a cap in SOL: log10(lamports) - 9.
const sizeOf = (lamports: string | number): number =>
  Math.log10(Number(BigInt(lamports))) - 9;

// ---- Per-coin time series of log10 cap (for momentum) ----
interface Coin {
  mint: string;
  firstCap: number;
  lastCap: number;
  firstIdx: number;
  lastIdx: number;
  lastRank: number;
}
const coins = new Map<string, Coin>();
marks.forEach((m, mi) => {
  for (const r of m.rows!) {
    const cap = sizeOf(r.market_cap_lamports);
    let c = coins.get(r.mint);
    if (!c) {
      c = { mint: r.mint, firstCap: cap, lastCap: cap, firstIdx: mi, lastIdx: mi, lastRank: r.rank };
      coins.set(r.mint, c);
    } else {
      c.lastCap = cap;
      c.lastIdx = mi;
      c.lastRank = r.rank;
    }
  }
});
const places = task.places;
const lastRows = [...lastMark.rows!].sort((a, b) => a.rank - b.rank);
if (lastRows.length < places) throw new Error('too few coins in the last mark');

// ---- ORDER (v11): momentum-scored top 10 + 90 epsilon rows per place ----
const probabilities: Array<{ mint: string; place: number; p: number }> = [];
for (let k = 0; k < places; k++) {
  const place = k + 1;
  // Score the top ORDER_CANDIDATES coins of the last mark for this place.
  const scored = lastRows.slice(0, ORDER_CANDIDATES).map((r) => {
    const c = coins.get(r.mint)!;
    const span = c.lastIdx - c.firstIdx;
    const momentum = span > 0 ? (c.lastCap - c.firstCap) / span : 0;
    const rankW = 1 / r.rank;
    const momentumW = 1 + MOMENTUM_BETA * Math.max(0, momentum);
    const placeW = 1 / (1 + Math.abs(r.rank - place));
    return { mint: r.mint, score: rankW * momentumW * placeW };
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, ORDER_KEEP);
  const totalScore = top.reduce((s, x) => s + x.score, 0);
  const topMints = new Set<string>();
  for (const x of top) {
    const p = totalScore > 0 ? (x.score / totalScore) * NAMED_SHARE : NAMED_SHARE / top.length;
    probabilities.push({ mint: x.mint, place, p: Math.round(p * 1e6) / 1e6 });
    topMints.add(x.mint);
  }
  // Epsilon rows: the next EPSILON_COUNT coins of the last mark by rank,
  // skipping the top 10. Naming 100 coins/place shrinks the unnamed
  // divisor, so the unnamed share gives each newcomer a larger p.
  let n = 0;
  for (const r of lastRows) {
    if (n >= EPSILON_COUNT) break;
    if (topMints.has(r.mint)) continue;
    probabilities.push({ mint: r.mint, place, p: EPSILON });
    n++;
  }
}

// ---- SIZE (v8, exact): top-scale-anchored Normal, averaged over reads ----
const edges = task.size.edges;
const nBins = edges.length + 1; // 82
const cutCap: number[] = [];
for (let k = 0; k < places; k++) cutCap.push(sizeOf(lastRows[k]!.market_cap_lamports));
/** erfc(x), Numerical Recipes' erfcc (fractional error under 1.2e-7). */
function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}
/** P(X >= x) for X normal with mean `mean` and sd `sd`. */
const above = (x: number, mean: number, sd: number): number => (x === -Infinity ? 1 : x === Infinity ? 0 : 0.5 * erfc((x - mean) / (sd * Math.SQRT2)));
/** P(X in bin b) for X ~ Normal(mean, sd); bins are the task's size edges. */
function normalBinProb(bin: number, mean: number, sd: number): number {
  const lo = bin === 0 ? -Infinity : edges[bin - 1]!;
  const hi = bin === nBins - 1 ? Infinity : edges[bin]!;
  return Math.max(0, above(lo, mean, sd) - above(hi, mean, sd));
}
const sizes: Array<{ place: number; bin: number; p: number }> = [];
for (let k = 0; k < places; k++) {
  for (let b = 0; b < nBins; b++) {
    let p = 0;
    for (let j = 0; j < readHours.length; j++) {
      const dt = Math.max(readHours[j]!, 0);
      const w = 1 - (1 - ANCHOR_W0) * Math.exp(-dt / ANCHOR_TAU);
      const g = GROWTH_MAX * (1 - Math.exp(-dt / GROWTH_TAU));
      const centre = w * cutCap[k]! + (1 - w) * cutCap[0]! + g + CENTRE_GAP * k;
      const sd = Math.sqrt(SIZE_SD0 * SIZE_SD0 + Math.pow(SIZE_SD_GROWTH * Math.sqrt(dt), 2));
      p += normalBinProb(b, centre, sd);
    }
    p /= Math.max(1, readHours.length);
    if (p >= 0.0005) sizes.push({ place: k + 1, bin: b, p: Math.round(p * 1e6) / 1e6 });
  }
}

// top5: the last mark's top 5 coins, in order.
const top5 = lastRows.slice(0, places).map((r) => r.mint);

writeFileSync(join(OUTPUT_DIR, task.output), `${JSON.stringify({ probabilities, top5, sizes })}\n`);
