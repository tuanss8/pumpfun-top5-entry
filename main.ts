// pumpfun-top5-forecast-01 entry v3: low-vol order + direct explosion size model.
//
// v1 scored -35.1 (order -19.48, size -15.63), rank 53/358.
// v2 scored -35.5 (order -19.77, size -15.75), rank 78 -- BOTH worse.
// v2 diagnosis (measured): the crash hazard + cap-dependent vol hurt the order
// (-0.29), and the 50/50 newcomer size blend hurt the size (-0.12) because its
// centre was too low (3.63) and its sd too wide (0.30).
//
// v3 reverts to v1's order model and fixes the two real errors:
//   (1) ORDER: volatility. A vol sweep on the last-read order score shows a
//       clear optimum near VOL 0.10-0.15/hour (v1 0.30 -> -23.26, 0.20 -> -23.14,
//       0.15 -> -23.09, 0.10 -> -23.07, 0.07 -> -23.14, 0.05 -> -23.30).
//       Lower vol concentrates p on the coins most likely to be top-5; below
//       0.10 it over-concentrates on the wrong coins. v3 uses 0.15 (robust:
//       0.10 is best on that one read by only 0.02, but puts p=0.37 on the
//       current #1, a bet the extreme top-5 churn contradicts).
//   (2) SIZE: the top cap EXPLODES. Measured: top log10 cap 3.04 -> 3.56 in
//       40 min (+0.79/hour). v1's place-1 size mean (3.71) sits far below
//       where the top cap actually lands (~3.9-4.2 at the answer reads), and
//       low vol pulls the simulated mean even lower (3.58). So v3 DECOUPLES
//       size from the order simulation: each place's size is a Normal centred
//       on the extrapolated top cap (logarithmic growth with horizon, capped)
//       minus a small gap, with a moderate sd. This is the "place-1 explosion
//       sizes" the rank-3 entry's title points at.
// The order still uses v1's momentum drift (DRIFT_SCALE 0.3, MAX_DRIFT 0.03)
// and UNNAMED_SHARE 0.6 (tuned: 0.5 and 0.7 are both worse on the last read).
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
/** Per-hour volatility of log10 cap (ORDER simulation). Vol sweep on the
    last-read order score: 0.30 -> -23.26, 0.20 -> -23.14, 0.15 -> -23.09,
    0.10 -> -23.07, 0.07 -> -23.14, 0.05 -> -23.30. 0.10 is best on that one
    read by 0.02, but it puts p=0.37 on the current #1 (a bet it stays #1
    across all 7 reads, which the extreme top-5 churn contradicts). 0.15 is
    the robust choice: nearly the same last-read score, far less concentrated.
    Verified: v3 last-read order -23.09, best of v1 (-23.26) and v2 (-23.40). */
const VOL_HOUR = 0.15;
/** Fraction of each place left unnamed (for newcomers born after the cut). */
const UNNAMED_SHARE = 0.6;
/** Monte Carlo paths. */
const N_PATHS = 4000;
/** Deterministic seed. */
const SEED = 20261112;
// ---- Size model (decoupled from the order simulation) ----
/** Growth rate of the top cap (log10 per ln-hour). Measured top-cap growth
    is ~0.79/hour early on; the logarithmic form saturates so the final's
    long horizon does not run away. */
const SIZE_GROWTH_TOP = 0.5;
/** Max upward shift of the place-1 centre above the last-mark top cap. */
const SIZE_GROWTH_CAP = 0.8;
/** Gap between consecutive places' size centres (the top-5 cluster tightly). */
const SIZE_GAP = 0.12;
/** Size sd at place 1 (the explosion is wide) and at places 2-5. */
const SIZE_SD_TOP = 0.18;
const SIZE_SD_REST = 0.14;

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

// ---- Monte Carlo (ORDER only): simulate every live coin to each answer read ----
const nReads = readHours.length;
const places = task.places;
const probAcc = new Float64Array(live.length * places);
const edges = task.size.edges;
const nBins = edges.length + 1; // 82
const rng = mulberry32(SEED);
const stepHours: number[] = [];
for (let j = 0; j < nReads; j++) {
  stepHours.push(j === 0 ? readHours[0]! : readHours[j]! - readHours[j - 1]!);
}
const caps = new Float64Array(live.length);
const order = new Int32Array(live.length);
for (let p = 0; p < N_PATHS; p++) {
  for (let i = 0; i < live.length; i++) caps[i] = live[i]!.lastCap;
  for (let j = 0; j < nReads; j++) {
    const dt = stepHours[j]!;
    const sd = VOL_HOUR * Math.sqrt(Math.max(dt, 0));
    for (let i = 0; i < live.length; i++) {
      const d = (live[i] as Coin & { drift: number }).drift;
      caps[i] += d * dt + sd * randn(rng);
    }
    for (let i = 0; i < live.length; i++) order[i] = i;
    order.sort((a, b) => caps[b]! - caps[a]!);
    for (let k = 0; k < places; k++) {
      probAcc[order[k]! * places + k] += 1;
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
for (let k = 0; k < places; k++) {
  let s = 0;
  for (const r of probabilities) if (r.place === k + 1) s += r.p;
  if (s > namedShare) {
    const f = namedShare / s;
    for (const r of probabilities) if (r.place === k + 1) r.p = Math.round(r.p * f * 1e6) / 1e6;
  }
}

// ---- Sizes: direct Normal per place (decoupled from the order simulation) ----
// Centre: the last-mark top cap grown logarithmically with horizon (the top
// cap explodes as newcomers arrive), minus a small gap per place. The growth
// is capped so the final's long horizon does not run away.
const topCap = Math.max(...live.map((c) => c.lastCap));
// Normal CDF helper (Abramowitz-Stegun 7.1.26).
const normCdf = (x: number): number => {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-(x * x) / 2);
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (x > 0) p = 1 - p;
  return p;
};
const binLo = (b: number): number => (b === 0 ? -Infinity : b === nBins - 1 ? edges[edges.length - 1]! : edges[b - 1]!);
const binHi = (b: number): number => (b === 0 ? edges[0]! : b === nBins - 1 ? Infinity : edges[b]!);
const sizes: Array<{ place: number; bin: number; p: number }> = [];
for (let k = 0; k < places; k++) {
  // Average the Normal over the reads (each read has its own horizon).
  const acc = new Float64Array(nBins);
  for (let j = 0; j < nReads; j++) {
    const dt = readHours[j]!;
    const growth = Math.min(SIZE_GROWTH_CAP, SIZE_GROWTH_TOP * Math.log(1 + dt));
    const center = topCap + growth - SIZE_GAP * k;
    const sd = k === 0 ? SIZE_SD_TOP : SIZE_SD_REST;
    for (let b = 0; b < nBins; b++) {
      const lo = binLo(b);
      const hi = binHi(b);
      const pLo = lo === -Infinity ? 0 : normCdf((lo - center) / sd);
      const pHi = hi === Infinity ? 1 : normCdf((hi - center) / sd);
      acc[b] += pHi - pLo;
    }
  }
  for (let b = 0; b < nBins; b++) {
    const p = acc[b] / nReads;
    if (p >= 0.0005) sizes.push({ place: k + 1, bin: b, p: Math.round(p * 1e6) / 1e6 });
  }
}
// top5: coins with the lowest expected rank.
const expRank = live.map((c, i) => {
  let e = 0;
  for (let k = 0; k < places; k++) e += (k + 1) * (probAcc[i * places + k] / total);
  const inTop = Array.from({ length: places }, (_, k) => probAcc[i * places + k] / total).reduce((a, b) => a + b, 0);
  return { mint: c.mint, e: e + (1 - inTop) * 100 };
});
expRank.sort((a, b) => a.e - b.e);
const top5 = expRank.slice(0, places).map((x) => x.mint);

writeFileSync(join(OUTPUT_DIR, task.output), `${JSON.stringify({ probabilities, top5, sizes })}\n`);
