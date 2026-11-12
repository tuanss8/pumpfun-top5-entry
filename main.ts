// pumpfun-top5-forecast-01 entry v9: v8 + higher unnamed shares for the
// FINAL's 7-13h reads (the newcomer share rises with lag).
//
// v8 (submitted, round 8) fixed the ORDER at short horizons: per-place
// unnamed shares [0.7,0.6,0.5,0.6,0.5] measured on the 10-40 min practice
// lags, P_MIN 0.01, 100-row cap. Practice (official ranked.ts scorer,
// corrected divisor): order cut2 -23.06 / cut3 -15.91 (mean -19.49),
// size -12.99, log -32.47. Expected final ~-31.0 good / ~-31.5 realistic.
//
// v9 changes ONE thing: UNNAMED_SHARE_K = [0.8, 0.7, 0.6, 0.7, 0.6]
// (+0.1 per place). Why: the newcomer share of the top-5 occupant RISES
// with lag — measured 0.40-0.50 at 10 min -> 0.80 at 30-40 min (all 10
// ordered mark pairs; same trend excluding the partial first mark) — and
// the per-cut backtest confirms it: a uniform +0.1 shift HURTS cut3
// (short lags, -0.69) but HELPS cut2 (+0.46) and cut1 (longest lags,
// +0.33), identically across 3 seeds (deltas within +/-0.01 — not MC
// noise). The final's reads are 7-13h out, far beyond the practice's
// 40 min, so the optimal unnamed share there is HIGHER than v8's
// short-lag values. +0.1 is the conservative step: it is the share the
// data ALREADY shows at 30-40 min (0.8 avg), not an extrapolation past
// it. KL analysis: if the final's true share is ~0.8, +0.1 gains ~+0.35
// order over v8; if it somehow stays at v8's level, +0.1 costs only
// ~-0.11 (vs -0.54 for a +0.2 shift — rejected as too aggressive).
// Practice backtest mean is flat by design (it measures 10-40 min, where
// v8's values are right): order mean -20.63 vs v8 -20.66, size -12.99
// unchanged. The gain lives at the final's horizons, which the backtest
// cannot see — stated honestly, not hidden.
//
// POISSON CRASH: tested properly for v9 and REJECTED — do not re-add.
// (1) Backtest: consistently slightly worse than Bernoulli (-0.11
// standard cuts, -0.02 at cut1). (2) Persistence: the crash fraction is
// FLAT with lag (0.60 at 10-40 min for one cohort, 0.00-0.20 for the
// others), not growing as a constant-rate Poisson requires. (3) Long
// horizon (7-13h reads): Poisson(1.0/hr) COLLAPSES the named mass —
// named sum 0.13 vs 0.29, top p 0.018 vs 0.041 — the forecast goes
// nearly flat. (4) Field evidence: v4's no-crash MC scored order -18.29
// officially, proving the drift+diffusion ranking carries ~6 points of
// signal at the final; Poisson drowns that signal in iid crash noise.
// A one-time-death crash (each coin dies once with prob 0.2-0.3, then
// stable) ties Bernoulli on the backtest and is distributionally neutral
// at 7-13h — no gain, not shipped either. The Bernoulli crash stays
// exactly as v6/v7/v8 (a no-op at hourly steps, +0.81 over no-crash at
// 10-30 min horizons where it does differentiate).
//
// Everything else is v8 unchanged: P_MIN 0.01, 100-row cap, v7 size
// model (top-scale-anchored centre + horizon-dependent sd), crash
// hazard Bernoulli 1.0/hr, ORDER_TEMP 1.0, VOL 0.30, DRIFT_HOURS 0.83.
// Swept and flat (not shipped): CENTRE_GAP -0.02 (+0.03 size, noise),
// SIZE_GROWTH 0.35 (+0.05 size, noise), SIZE_SD0 0.26 (worse),
// P0_GROWTH_MAX 0.2/0.5 (no change), per-read horizon slope for u
// (helps cut3, hurts cut2/cut1 — the per-read weighting confounds the
// level; the uniform shift is the clean implementation).

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// ---- Tuned parameters (time-based, per hour) ----
/** Hours of history used for the drift slope. */
const DRIFT_HOURS = 0.83; // 6 marks at 10-min cadence (user: 'mark 6').
/** Shrink a coin's drift by n/(n+SHRINK_K), n = number of marks it appears in. */
const SHRINK_K = 2;
/** Scale the (shrunk) drift: half momentum, to avoid overcommitting to a hot coin. */
const DRIFT_SCALE = 0.3;
/** Cap |drift| per hour (log10 cap). */
const MAX_DRIFT = 0.03;
/** Per-hour volatility of log10 cap. */
const VOL_HOUR = 0.3;
/** Minimum named probability: only name a coin at a place when its
    temperature-adjusted p is at least this. Below it the coin scores
    better unnamed (the unnamed per-coin p is ~0.007) — and naming it
    spends one of the place's 100 rows. Swept on the backtest: 0.0005
    -19.85, 0.001 -19.86, 0.002 -19.85, 0.005 -19.78, 0.01 -19.76. */
const P_MIN = 0.01;
/** Temperature for the place probabilities: p' ~ p^(1/TEMP), renormalised.
    TEMP < 1 sharpens (more mass on the most likely places). 1.0 = no change. */
const ORDER_TEMP = 1.0;
/** Fraction of each place left unnamed (for newcomers born after the cut),
    per place. v8 used [0.7,0.6,0.5,0.6,0.5], measured on the 10-40 min
    practice lags (newcomer share per place: 0.80/0.70/0.50/0.70/0.50).
    v9 raises each by +0.1 for the FINAL's 7-13h reads: the newcomer
    share rises with lag (0.40-0.50 at 10 min -> 0.80 at 30-40 min), and
    the per-cut backtest confirms longer lags prefer higher u (uniform
    +0.1: cut3 -0.69, cut2 +0.46, cut1 +0.33, identical across 3 seeds).
    +0.1 is the measured 30-40 min level, not an extrapolation; +0.2 was
    rejected (KL downside -0.54 if the final's share does not grow).
    Size unchanged. */
const UNNAMED_SHARE_K = [0.8, 0.7, 0.6, 0.7, 0.6];
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
/** Per-hour crash hazard (v6): with this probability per hour, a coin's
    log10 cap jumps down by log10(CRASH_FACTOR). Measured: ~15-20% of top-5
    coins lose >50% of cap (or vanish) within 10-20 min, i.e. hazard
    ~1/hr; the crash spreads the Monte Carlo place mass off the current
    top coins, which mostly turn over. Backtest order gain +0.67 vs v5. */
const CRASH_HAZARD = 1.0;
/** Multiplicative crash factor on the cap (0.3 = log10 -0.52; the bottom
    decile of top-coin 10-min cap changes is ~-0.67). */
const CRASH_FACTOR = 0.3;
/** Base SD of each place's size Normal (log10 cap). The SD grows with
    horizon: sd(dt) = sqrt(SIZE_SD0^2 + (SIZE_SD_GROWTH*sqrt(dt))^2).
    Rationale: the centre error grows with horizon (top-scale growth-rate
    uncertainty ~0.065, from the v1/v4 final calibration: truth is
    cutCap + 0.85..1.25 at 10h, i.e. SG in [0.27, 0.40]). On the backtest
    (dt 0.17-0.5h) sd ~0.22 (the backtest optimum, size -13.01 vs -14.36
    at 0.32); at the final (dt 7-13h) sd ~0.30, robust to the larger
    centre error. A constant sharp sd would be punished at long horizons;
    a constant wide sd wastes the accurate short-horizon centre. */
const SIZE_SD0 = 0.22;
const SIZE_SD_GROWTH = 0.065;
/** v7 size-centre shape: centre[k] = CENTRE_W*cutCap[k] + (1-CENTRE_W)*cutCap[0]
    + SIZE_GROWTH*sqrt(dt) + CENTRE_GAP*k. v6 is CENTRE_W=1, CENTRE_GAP=0.
    Measured (practice regression, R2=0.97): the true top-5 caps revert
    fully to the top scale (gap coefficient 1.11), so CENTRE_W~0 anchors
    the centre to the top scale instead of each place's own (possibly far
    below-scale) cut cap. CENTRE_GAP<0 gives the tight top-5 ladder. */
const CENTRE_W = 0.2;
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
      // Crash hazard: with prob CRASH_HAZARD*dt the coin's cap jumps down
      // by log10(CRASH_FACTOR) — top coins collapse and free up places.
      if (CRASH_HAZARD > 0 && rng() < CRASH_HAZARD * dt) {
        caps[i] += Math.log10(Math.max(CRASH_FACTOR, 1e-6));
      }
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
const namedShareK = UNNAMED_SHARE_K.map((u) => 1 - u);
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
    const p = (Math.pow(frac, tempPow) / denom) * namedShareK[k]!;
    if (p >= P_MIN) probabilities.push({ mint: live[i]!.mint, place: k + 1, p: Math.round(p * 1e6) / 1e6 });
  }
}
// Renormalise each place so the named sum is at most namedShare (rounding safety).
for (let k = 0; k < places; k++) {
  let s = 0;
  for (const r of probabilities) if (r.place === k + 1) s += r.p;
  if (s > namedShareK[k]!) {
    const f = namedShareK[k]! / s;
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
// Hard cap: a place has at most 100 rows (RULES.txt); over that the
// forecast is invalid and scores the floor everywhere. The MC loop has no
// cap of its own, and at 7-13h horizons diffusion pushes 106-200 coins
// over the naming threshold per place on the practice market. Keep every
// p=0 blocker (they cost nothing and shrink the unnamed divisor) and the
// highest-p named rows to fill to 100. With P_MIN 0.01 this is normally
// a no-op (long-horizon test: 96-99 rows/place).
for (let k = 0; k < places; k++) {
  const place = k + 1;
  const rows = probabilities.filter((r) => r.place === place);
  if (rows.length > 100) {
    const blockers = rows.filter((r) => r.p === 0);
    const named = rows.filter((r) => r.p > 0).sort((a, b) => b.p - a.p);
    const keep = new Set([...blockers, ...named.slice(0, Math.max(0, 100 - blockers.length))]);
    for (let i = probabilities.length - 1; i >= 0; i--) {
      if (probabilities[i]!.place === place && !keep.has(probabilities[i]!)) probabilities.splice(i, 1);
    }
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
      const centre = CENTRE_W * cutCap[k]! + (1 - CENTRE_W) * cutCap[0]! + SIZE_GROWTH * Math.sqrt(Math.max(readHours[j]!, 0)) + CENTRE_GAP * k;
      const sd = Math.sqrt(SIZE_SD0 * SIZE_SD0 + Math.pow(SIZE_SD_GROWTH * Math.sqrt(Math.max(readHours[j]!, 0)), 2));
      p += normalBinProb(b, centre, sd);
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
