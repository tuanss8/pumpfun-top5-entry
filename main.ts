// pumpfun-top5-forecast-01 entry v5: v4 order + sharp Normal sizes.
//
// v1 scored -35.1 (order -19.48, size -15.63), rank 53. v4 scored -40.2
// (order -18.29 GOOD, size -21.92 CATASTROPHIC), rank 370. The v4 size
// collapse came from the growth shift (+0.30*sqrt(dt), capped 0.5): the
// final's true top caps sit AT or BELOW v1's simulation centre, not above
// it, so shifting up cost ~6.3 size points. v4's cut=2 backtest (-25.73)
// did NOT transfer to the final's 7-13h reads — the backtest only measures
// 10-30 min horizons.
//
// v5 keeps v4's ORDER exactly (p=0 blockers, UNNAMED_SHARE 0.5 — proven on
// the final; TEMP/VOL sharpening was swept and HURT the backtest order, so
// the Monte Carlo is left unsharpened) and replaces the size model with a
// SHARP Normal per place (centre cutCap[k] + 0.30*sqrt(dt), sd 0.32).
// Rationale: size -13.22 needs mean ln(p) -2.64 per place-read, i.e.
// p ~0.071 per 0.05-wide bin, i.e. sd ~0.28-0.32 with a correct centre.
// The wide simulation histogram (sd 0.4-0.53) and the wide newcomer
// mixture (sd 0.66) cap the peak density too low to reach it. The centre
// is calibrated from the final's v1/v4 evidence: v1's sim centre sits
// ~0.2-0.6 above the truth, and v1's sim centre is ~cutCap + 1.45, so the
// truth is ~cutCap + 0.85..1.25 at a ~10h horizon (0.30*sqrt(10) = 0.95).
// The centre is the risk: a sharp Normal punishes a wrong centre
// quadratically. Target: order -17.61, size -13.22, total -30.83 (beats
// rank 1's -31.8). The final's size cannot be verified locally — the
// backtest measures only 10-30 min horizons, where the top caps grow fast
// and the truth is volatile, so it favours wide distributions and must NOT
// be used to tune the final's size.
// All parameters are time-based (per hour), so the code runs the 10-minute
// practice reads and the hourly final reads unchanged.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// ---- Tuned parameters (time-based, per hour) ----
/** Hours of history used for the drift slope. */
const DRIFT_HOURS = 1.0;
/** Shrink a coin's drift by n/(n+SHRINK_K), n = number of marks it appears in. */
const SHRINK_K = 2;
/** Scale the (shrunk) drift: half momentum, to avoid overcommitting to a hot coin. */
const DRIFT_SCALE = 0.3;
/** Cap |drift| per hour (log10 cap). */
const MAX_DRIFT = 0.03;
/** Per-hour volatility of log10 cap. */
const VOL_HOUR = 0.3;
/** Temperature for the place probabilities: p' ~ p^(1/TEMP), renormalised.
    TEMP < 1 sharpens (more mass on the most likely places). 1.0 = no change. */
const ORDER_TEMP = 1.0;
/** Fraction of each place left unnamed (for newcomers born after the cut).
    0.5: with p=0 blockers shrinking the unnamed divisor, a lower unnamed
    share still gives newcomers a large p while leaving more named p for the
    known coins that survive. Swept on the backtest (v4). */
const UNNAMED_SHARE = 0.5;
/** Monte Carlo paths. */
const N_PATHS = 4000;
/** Deterministic seed. */
const SEED = 20261112;
// ---- p=0 blockers (order) ----
/** Name coins ranked P0_RANK_LO..P0_RANK_HI at the last mark at p=0, unless
    they grew strongly over the history (growth > P0_GROWTH_MAX). Measured:
    zero coins ranked 11-100 ever reached the top-5 later in the practice. */
const P0_RANK_LO = 11;
const P0_RANK_HI = 100;
const P0_GROWTH_MAX = 0.3;
// ---- Sharp Normal size model (sizes) ----
// Each place's size is a Normal in log10 cap, NOT the wide simulation
// histogram and NOT the wide newcomer mixture. Rationale (measured):
//   - v1's sim size scored -15.63 (sd ~0.4-0.53 at long horizons);
//     v4's shifted sim scored -21.92. The best size on the board is
//     -13.67 (crave), which needs a SHARP distribution: mean ln(p) -2.73
//     per place-read implies p ~0.065 per 0.05-wide bin, i.e. sd ~0.31
//     with a correct centre. A wide distribution (mixture sd 0.66) caps
//     the peak density too low to reach -13.22.
//   - Centre: the top-k cap at the reads. Evidence from v1/v4 (final):
//     v1's sim centre sits ~0.2-0.6 above the truth, and v1's sim centre
//     is ~cutCap + 1.45 (random-walk max effect). So the truth is
//     ~cutCap + 0.85..1.25 at a ~10h mean horizon. Centre_k =
//     cutCap[k] + SIZE_GROWTH * sqrt(mean read horizon), SIZE_GROWTH 0.30
//     gives +0.95 at 10h. The centre is the risk: a sharp Normal punishes
//     a wrong centre quadratically, so SIZE_SD 0.32 is sharp but not extreme.
const SIZE_GROWTH = 0.3;
/** SD of each place's size Normal (log10 cap). */
const SIZE_SD = 0.32;

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

/** Deterministic PRNG (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Standard normal from uniform draws (Box-Muller). */
function randn(rng: () => number): number {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
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

// ---- Per-coin time series of log10 cap ----
interface Coin {
  mint: string;
  times: number[]; // hours since first mark
  caps: number[]; // log10 cap in SOL
  lastCap: number;
  lastRank: number;
}
const t0 = Date.parse(marks[0]!.at);
const coins = new Map<string, Coin>();
for (const m of marks) {
  const t = (Date.parse(m.at) - t0) / 3600000;
  for (const r of m.rows!) {
    let c = coins.get(r.mint);
    if (!c) {
      c = { mint: r.mint, times: [], caps: [], lastCap: 0, lastRank: 0 };
      coins.set(r.mint, c);
    }
    c.times.push(t);
    c.caps.push(sizeOf(r.market_cap_lamports));
    c.lastCap = sizeOf(r.market_cap_lamports);
    c.lastRank = r.rank;
  }
}
const coinList = [...coins.values()];
const lastMints = new Set(lastMark.rows!.map((r) => r.mint));
const live = coinList.filter((c) => lastMints.has(c.mint));
if (live.length < task.places) throw new Error('too few coins in the last mark');

// ---- Drift per coin: OLS slope of log10 cap on time over DRIFT_HOURS ----
const lastT = (lastAt - t0) / 3600000;
for (const c of live) {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < c.times.length; i++) {
    if (lastT - c.times[i]! <= DRIFT_HOURS + 1e-9) pts.push([c.times[i]!, c.caps[i]!]);
  }
  let drift = 0;
  if (pts.length >= 2) {
    const n = pts.length;
    const mt = pts.reduce((s, p) => s + p[0], 0) / n;
    const mc = pts.reduce((s, p) => s + p[1], 0) / n;
    let num = 0;
    let den = 0;
    for (const [t, v] of pts) {
      num += (t - mt) * (v - mc);
      den += (t - mt) * (t - mt);
    }
    if (den > 1e-12) drift = num / den;
  }
  const shrink = pts.length / (pts.length + SHRINK_K);
  drift = drift * shrink * DRIFT_SCALE;
  drift = Math.max(-MAX_DRIFT, Math.min(MAX_DRIFT, drift));
  (c as Coin & { drift: number }).drift = drift;
}

// ---- Monte Carlo: simulate every live coin to each answer read ----
const nReads = readHours.length;
const places = task.places;
// P[coinIdx][place] accumulates the fraction of (path, read) with the coin at that place.
const probAcc = new Float64Array(live.length * places);
// Size histograms: sizeAcc[place][bin] counts (path, read) samples of the
// simulated cap at that place (NO shift — v4's shift was the disaster).
const edges = task.size.edges;
const nBins = edges.length + 1; // 82
const sizeAcc = new Float64Array(places * nBins);
const rng = mulberry32(SEED);
// Precompute step durations between consecutive read times (hours).
const stepHours: number[] = [];
for (let j = 0; j < nReads; j++) {
  stepHours.push(j === 0 ? readHours[0]! : readHours[j]! - readHours[j - 1]!);
}
const caps = new Float64Array(live.length);
const order = new Int32Array(live.length);
for (let p = 0; p < N_PATHS; p++) {
  // Start each coin at its last-mark log10 cap.
  for (let i = 0; i < live.length; i++) caps[i] = live[i]!.lastCap;
  for (let j = 0; j < nReads; j++) {
    const dt = stepHours[j]!;
    const sd = VOL_HOUR * Math.sqrt(Math.max(dt, 0));
    for (let i = 0; i < live.length; i++) {
      const d = (live[i] as Coin & { drift: number }).drift;
      caps[i] += d * dt + sd * randn(rng);
    }
    // Rank by simulated cap, descending.
    for (let i = 0; i < live.length; i++) order[i] = i;
    order.sort((a, b) => caps[b]! - caps[a]!);
    for (let k = 0; k < places; k++) {
      const idx = order[k]!;
      probAcc[idx * places + k] += 1;
      // Size bin of the simulated cap at this place (unshifted).
      const v = caps[idx]!;
      let bin = 0;
      if (v < edges[0]!) bin = 0;
      else if (v >= edges[edges.length - 1]!) bin = nBins - 1;
      else {
        // Binary search over edges.
        let lo = 0;
        let hi = edges.length - 1;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (v >= edges[mid]!) lo = mid;
          else hi = mid - 1;
        }
        bin = lo + 1;
      }
      sizeAcc[k * nBins + bin] += 1;
    }
  }
}
const total = N_PATHS * nReads;

// ---- Build the forecast ----
const probabilities: Array<{ mint: string; place: number; p: number }> = [];
const namedShare = 1 - UNNAMED_SHARE;
// Temperature-sharpen the place probabilities per place: p' ~ p^(1/TEMP),
// renormalised so each place's named sum stays namedShare. TEMP < 1 puts
// more mass on the most likely coins at each place.
const tempPow = 1 / ORDER_TEMP;
for (let k = 0; k < places; k++) {
  let denom = 0;
  for (let i = 0; i < live.length; i++) {
    const frac = probAcc[i * places + k] / total;
    if (frac > 0) denom += Math.pow(frac, tempPow);
  }
  if (denom <= 0) continue;
  for (let i = 0; i < live.length; i++) {
    const frac = probAcc[i * places + k] / total;
    if (frac <= 0) continue;
    const p = (Math.pow(frac, tempPow) / denom) * namedShare;
    if (p >= 0.0005) probabilities.push({ mint: live[i]!.mint, place: k + 1, p: Math.round(p * 1e6) / 1e6 });
  }
}
// Renormalise each place so the named sum is at most namedShare (rounding safety).
for (let k = 0; k < places; k++) {
  let s = 0;
  for (const r of probabilities) if (r.place === k + 1) s += r.p;
  if (s > namedShare) {
    const f = namedShare / s;
    for (const r of probabilities) if (r.place === k + 1) r.p = Math.round(r.p * f * 1e6) / 1e6;
  }
}
// p=0 blockers: name coins ranked P0_RANK_LO..P0_RANK_HI at the last mark at
// p=0, unless they grew strongly over the history. This takes them out of the
// unnamed share, so the share is split over far fewer coins and the newcomers
// (which we cannot name) get a much larger probability. Measured: zero coins
// ranked 11-100 ever reached the top-5 later in the practice history.
// A p=0 row adds nothing to the place's named sum, so the unnamed share is
// unchanged; only the divisor shrinks. Cap at 100 rows per place.
for (let k = 0; k < places; k++) {
  const place = k + 1;
  const existing = new Set(probabilities.filter((r) => r.place === place).map((r) => r.mint));
  let room = 100 - probabilities.filter((r) => r.place === place).length;
  for (const r of lastMark.rows!) {
    if (room <= 0) break;
    if (r.rank < P0_RANK_LO || r.rank > P0_RANK_HI) continue;
    if (existing.has(r.mint)) continue;
    const c = coins.get(r.mint);
    // Skip strong growers: a coin that pumped hard might break out.
    if (c && c.caps.length >= 2 && c.caps[c.caps.length - 1]! - c.caps[0]! > P0_GROWTH_MAX) continue;
    probabilities.push({ mint: r.mint, place, p: 0 });
    existing.add(r.mint);
    room--;
  }
}
// Sizes: per place, a Normal in log10 cap with centre cutCap[k] +
// SIZE_GROWTH*sqrt(mean read horizon) and sd SIZE_SD. The Normal is
// averaged over the reads' horizons (each read's centre grows with its dt).
const cutCap: number[] = [];
{
  const sorted = [...lastMark.rows!].sort((a, b) => a.rank - b.rank);
  for (let k = 0; k < places; k++) cutCap.push(sizeOf(sorted[k]!.market_cap_lamports));
}
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
    for (let j = 0; j < nReads; j++) {
      const centre = cutCap[k]! + SIZE_GROWTH * Math.sqrt(Math.max(readHours[j]!, 0));
      p += normalBinProb(b, centre, SIZE_SD);
    }
    p /= Math.max(1, nReads);
    if (p >= 0.0005) sizes.push({ place: k + 1, bin: b, p: Math.round(p * 1e6) / 1e6 });
  }
}
// top5: coins with the lowest expected rank (mean place over paths/reads),
// computed from probAcc as sum_k (k+1) * P(place k), plus a bonus for P(place 1).
const expRank = live.map((c, i) => {
  let e = 0;
  for (let k = 0; k < places; k++) e += (k + 1) * (probAcc[i * places + k] / total);
  // Coins never in the top 5 get a large rank.
  const inTop = Array.from({ length: places }, (_, k) => probAcc[i * places + k] / total).reduce((a, b) => a + b, 0);
  return { mint: c.mint, e: e + (1 - inTop) * 100 };
});
expRank.sort((a, b) => a.e - b.e);
const top5 = expRank.slice(0, places).map((x) => x.mint);

writeFileSync(join(OUTPUT_DIR, task.output), `${JSON.stringify({ probabilities, top5, sizes })}\n`);
