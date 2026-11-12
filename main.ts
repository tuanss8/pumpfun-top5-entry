// pumpfun-top5-forecast-01 entry v2: survival-aware Monte Carlo log10-cap forecaster.
//
// v1 (Monte Carlo with momentum drift) scored -35.1 (order -19.48, size -15.63),
// rank 53/358. Its two errors, measured on the practice history:
//   (1) Momentum drift chases spikes. The data says top coins MEAN-REVERT DOWN:
//       top-5 coins lose -0.14 log10 per 10 min on average (sd 0.32, p10 -0.67),
//       rank 6-20 lose -0.066, the tail ~0. But the decline is NOT a uniform
//       slide: the median top coin is roughly flat and a minority crashes hard
//       (p10 -0.67). v2 therefore keeps only a weak mean-reverting drift and
//       models the decline as a discrete CRASH HAZARD: each step, a coin crashes
//       (log10 cap drops 0.4-0.9) with a per-hour probability that grows with
//       how far above the floor it sits. Hot young coins crash; floor coins don't.
//   (2) Volatility is cap-dependent, not global. Top-5 coins move sd 0.32 per
//       10 min (~0.77/hr), the tail only 0.04 (~0.10/hr). v1's flat 0.30/hr
//       understates the top (so it over-concentrates on the current #1) and
//       overstates the tail. v2 uses vol = VOL_FLOOR + VOL_SLOPE*(cap-FLOOR_CAP).
// A large share of each place is still left unnamed for coins born after the cut
// (in the practice, 3 of the 5 coins at the last read were not in the history).
// Place sizes come from the same simulations, histogrammed into the 82 bins.
// All parameters are time-based (per hour), so the code runs the 10-minute
// practice reads and the hourly final reads unchanged.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// ---- Tuned parameters (time-based, per hour) ----
/** log10 cap (SOL) of the floor: most newcomers are born here. */
const FLOOR_CAP = 1.45;
/** Mean-reversion rate: drift = -MEAN_REV * (cap - FLOOR_CAP). Kept near zero:
    the top coins' mean decline (-0.14/10 min) is driven by a minority that
    crashes hard (p10 -0.67), not by a uniform slide -- the median top coin is
    roughly flat. The crash is modelled discretely below instead. */
const MEAN_REV = 0.05;
/** Volatility at the floor (log10 per sqrt-hour). */
const VOL_FLOOR = 0.1;
/** Extra volatility per log10 above the floor. */
const VOL_SLOPE = 0.25;
/** Crash hazard: per hour, a coin at (cap - FLOOR_CAP) above the floor crashes
    with probability CRASH_RATE_SLOPE * (cap - FLOOR_CAP) * AGE_FACTOR * dt.
    Top coins crash often; floor coins never do. AGE_FACTOR makes the hazard
    age-dependent: a coin that just spiked (young, freshly created) crashes far
    more readily than one that has held a high cap for a while (a survivor).
    AGE_FACTOR = 1 / (1 + age_hours / AGE_HALF_LIFE). */
const CRASH_RATE_SLOPE = 0.2;
/** AGE_HALF_LIFE 0.5h: tested 0.25h (last-read order -21.12, worse) and reverted. */
const AGE_HALF_LIFE = 0.5;
/** A crash drops the log10 cap by a uniform amount in this range. */
const CRASH_MIN = 0.4;
const CRASH_MAX = 0.9;
/** Newcomer size component: the top-5 at a future read is set by coins born
    after the cut, not by the decaying survivors, so the size distribution
    blends the simulation with a newcomer component. NEW_SIZE_W is its weight.
    The newcomer top cap grows only logarithmically with horizon (extreme value
    over more newborn coins), so NEW_GROWTH is small; places 2-5 sit below
    place 1 by NEW_GAP and cluster there. */
const NEW_SIZE_W = 0.5;
const NEW_GROWTH = 0.1;
const NEW_GAP = 0.25;
const NEW_SD_TOP = 0.3;
const NEW_SD_REST = 0.2;
/** Fraction of each place left unnamed (for newcomers born after the cut). */
const UNNAMED_SHARE = 0.6;
/** Monte Carlo paths. */
const N_PATHS = 4000;
/** Deterministic seed. */
const SEED = 20261112;

interface Row {
  rank: number;
  mint: string;
  market_cap_lamports: string | number;
  venue?: string;
  mayhem?: boolean;
  created_at?: string;
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

// ---- Per-coin last log10 cap (live chart only) ----
interface Coin {
  mint: string;
  lastCap: number;
  lastRank: number;
  createdAt: number; // ms since epoch, from the row's created_at
}
const coins = new Map<string, Coin>();
for (const m of marks) {
  for (const r of m.rows!) {
    let c = coins.get(r.mint);
    if (!c) {
      c = { mint: r.mint, lastCap: 0, lastRank: 0, createdAt: Date.parse((r as Row & { created_at?: string }).created_at ?? m.at) };
      coins.set(r.mint, c);
    }
    c.lastCap = sizeOf(r.market_cap_lamports);
    c.lastRank = r.rank;
  }
}
const lastMints = new Set(lastMark.rows!.map((r) => r.mint));
const live = [...coins.values()].filter((c) => lastMints.has(c.mint));
if (live.length < task.places) throw new Error('too few coins in the last mark');

// ---- Monte Carlo: simulate every live coin to each answer read ----
// Each coin's log10 cap mean-reverts toward FLOOR_CAP with cap-dependent
// volatility. A coin that just spiked to the top decays fast and swings wide,
// so the current #1 is far less likely to still be #1 than v1 believed, and
// the top-5 mass spreads over the mid-rank survivors and the unnamed newcomers.
const nReads = readHours.length;
const places = task.places;
// P[coinIdx][place] accumulates the fraction of (path, read) with the coin at that place.
const probAcc = new Float64Array(live.length * places);
// Size histograms: sizeAcc[place][bin] counts (path, read) samples.
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
    for (let i = 0; i < live.length; i++) {
      const cap = caps[i]!;
      const above = Math.max(0, cap - FLOOR_CAP);
      const drift = -MEAN_REV * above;
      const vol = VOL_FLOOR + VOL_SLOPE * above;
      let next = cap + drift * dt + vol * Math.sqrt(Math.max(dt, 0)) * randn(rng);
      // Crash hazard: a discrete jump down. Hot (high-cap, young) coins crash;
      // the crash rate scales with how far above the floor the coin sits and
      // fades with age (a coin that has held its cap for a while is a survivor).
      const ageHours = Math.max(0, (lastAt - live[i]!.createdAt) / 3600000);
      const ageFactor = 1 / (1 + ageHours / AGE_HALF_LIFE);
      const crashP = CRASH_RATE_SLOPE * above * ageFactor * dt;
      if (crashP > 0 && rng() < crashP) {
        next -= CRASH_MIN + rng() * (CRASH_MAX - CRASH_MIN);
      }
      caps[i] = next;
    }
    // Rank by simulated cap, descending.
    for (let i = 0; i < live.length; i++) order[i] = i;
    order.sort((a, b) => caps[b]! - caps[a]!);
    for (let k = 0; k < places; k++) {
      const idx = order[k]!;
      probAcc[idx * places + k] += 1;
      // Size bin of the cap at this place.
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
for (let i = 0; i < live.length; i++) {
  for (let k = 0; k < places; k++) {
    const frac = probAcc[i * places + k] / total;
    const p = frac * namedShare;
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
// Sizes: blend the simulation histogram with a newcomer component.
// The simulation only has the decaying survivors, but the top-5 at a future
// read is set by coins born after the cut, which arrive with big caps. The
// newcomer component is a Normal per place, centred on the extrapolated
// newcomer top cap (logarithmic growth with horizon) minus a gap for places
// 2-5, with a wide sd at place 1 for the "explosion" (a newborn can arrive
// far above the current top). The blend keeps the survivor shape and lifts
// the centre toward where newcomers actually land.
const topCap = Math.max(...live.map((c) => c.lastCap));
const newAcc = new Float64Array(places * nBins);
// Normal CDF helper (Abramowitz-Stegun 7.1.26).
const normCdf = (x: number): number => {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-(x * x) / 2);
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (x > 0) p = 1 - p;
  return p;
};
// Bin edges in log10: bin b covers [lo, hi).
const binLo = (b: number): number => (b === 0 ? -Infinity : b === nBins - 1 ? edges[edges.length - 1]! : edges[b - 1]!);
const binHi = (b: number): number => (b === 0 ? edges[0]! : b === nBins - 1 ? Infinity : edges[b]!);
for (let j = 0; j < nReads; j++) {
  const dt = readHours[j]!;
  const center1 = topCap + NEW_GROWTH * Math.log(1 + dt);
  for (let k = 0; k < places; k++) {
    const center = k === 0 ? center1 : center1 - NEW_GAP - 0.05 * (k - 1);
    const sd = k === 0 ? NEW_SD_TOP : NEW_SD_REST;
    for (let b = 0; b < nBins; b++) {
      const lo = binLo(b);
      const hi = binHi(b);
      const pLo = lo === -Infinity ? 0 : normCdf((lo - center) / sd);
      const pHi = hi === Infinity ? 1 : normCdf((hi - center) / sd);
      newAcc[k * nBins + b] += pHi - pLo;
    }
  }
}
const sizes: Array<{ place: number; bin: number; p: number }> = [];
for (let k = 0; k < places; k++) {
  for (let b = 0; b < nBins; b++) {
    const simFrac = sizeAcc[k * nBins + b] / total;
    const newFrac = newAcc[k * nBins + b] / nReads;
    const p = (1 - NEW_SIZE_W) * simFrac + NEW_SIZE_W * newFrac;
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
