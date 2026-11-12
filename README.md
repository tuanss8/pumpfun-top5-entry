# Pump.fun top-5 forecaster v2 — survival-aware Monte Carlo

Entry for `pumpfun-top5-forecast-01` (round 2). Predicts the top 5 new Solana
coins by market cap, 24 hours out, as `node /bot/main.ts` (Node 22, stdlib only,
no network, deterministic).

## v1 result (for reference)

v1 (Monte Carlo log10-cap random walk with momentum drift) scored **-35.1**
(order -19.48, size -15.63), **rank 53/358**. Rank 1 is -32.1 (order -18.17,
size -13.89); the rank-10 prize cutoff is -33.7. Gaps: order 1.31, size 1.74.

## What v2 changes

### 1. Crash / survival hazard (order)

v1's momentum drift chases spikes: a coin that just spiked gets a positive
drift. The practice data says the opposite. Top-5 coins lose **-0.14 log10 per
10 min on average** (sd 0.32, p10 -0.67); rank 6-20 lose -0.066; the tail ~0.
But the decline is not a uniform slide — the median top coin is roughly flat
and a minority crashes hard. So v2 replaces momentum drift with:

- a **weak mean-reverting drift** (`-0.05 * (cap - floor)`, near zero), and
- a **discrete crash hazard**: each step, a coin's log10 cap drops by a uniform
  0.4-0.9 with a per-hour probability that grows with how far above the floor
  it sits (`0.20 * (cap - floor)`) and **fades with age** (`1 / (1 + age / 0.5h)`
  from `created_at`). A coin that just spiked (young, hot) crashes readily; a
  coin that has held a high cap for a while is a survivor.

Effect: the current #1's P(place 1) falls from 0.19 (v1) to 0.11, the named
mass spreads over mid-rank survivors, and the unnamed share (newcomers) gains.
Last-read order score on the practice: **-21.09** (v1 -21.00) — essentially
tied on this single read; the hazard is calibrated for the 7-read average,
where most top coins do fall out (only 1/5 of the last mark's top 5 held a
top-5 place at the last answer read).

### 2. Cap-dependent volatility (order + size)

Volatility is not global. Top-5 coins move sd 0.32 per 10 min (~0.77/hr), the
tail only 0.04 (~0.10/hr). v1's flat 0.30/hr understates the top (so it
over-concentrates on the current #1) and overstates the tail. v2 uses
`vol = 0.10 + 0.25 * (cap - floor)` per sqrt-hour.

### 3. Newcomer size component (size — the bigger gap, 1.74)

v1's sizes come only from the simulation of the decaying survivors. But the
top-5 at a future read is set by coins born after the cut, which arrive with
big caps (the top cap grows 1086 -> 3638 SOL over 50 min, driven by newcomers,
not by existing coins growing). So v2 blends the simulation histogram 50/50
with a **newcomer component**: a Normal per place, centred on the extrapolated
newcomer top cap (the current top cap plus slow logarithmic growth with
horizon, `0.10 * ln(1 + dt)` — extreme value over more newborn coins),
minus a 0.25 gap for places 2-5 (which cluster below place 1), with a wide sd
at place 1 (0.30) for the "explosion" (a newborn can arrive far above the
current top) and 0.20 elsewhere.

Size distribution change vs v1 (practice, per place: mean / sd / top-bin p):

| place | v1 | v2 |
|------:|----|----|
| 1 | 3.71 / 0.18 / 0.115 | 3.73 / 0.36 / 0.065 |
| 2 | 3.55 / 0.14 / 0.152 | 3.46 / 0.25 / 0.089 |
| 3 | 3.44 / 0.12 / 0.175 | 3.35 / 0.21 / 0.102 |
| 4 | 3.36 / 0.11 / 0.195 | 3.26 / 0.20 / 0.105 |
| 5 | 3.29 / 0.10 / 0.211 | 3.18 / 0.19 / 0.106 |

v2's centres are slightly lower (the newcomers that actually fill places 2-5
land below v1's survivor-based centre) and the spread is roughly doubled —
v1's sd of 0.10-0.18 is too narrow for how much the actual caps vary across
reads, so v1 often misses the bin entirely. The wider, newcomer-centred
distribution should recover a good part of the 1.74 size gap.

## Parameters (all time-based, per hour)

| parameter | value | source |
|---|---:|---|
| FLOOR_CAP | 1.45 | median newborn cap (28 SOL) |
| MEAN_REV | 0.05 | weak; the decline is a crash, not a slide |
| VOL_FLOOR / VOL_SLOPE | 0.10 / 0.25 | tail sd 0.10/hr, top sd ~0.77/hr |
| CRASH_RATE_SLOPE | 0.20 | top-5 mean -0.14/10 min, p10 -0.67 |
| CRASH_MIN / CRASH_MAX | 0.4 / 0.9 | crash size range (log10) |
| AGE_HALF_LIFE | 0.5 h | hazard fades with age since `created_at` |
| UNNAMED_SHARE | 0.6 | 3/5 of the answer top 5 are newcomers |
| NEW_SIZE_W / NEW_GROWTH / NEW_GAP | 0.5 / 0.10 / 0.25 | newcomer size blend |
| NEW_SD_TOP / NEW_SD_REST | 0.30 / 0.20 | place-1 explosion, rest clustered |
| N_PATHS / SEED | 4000 / 20261112 | deterministic |

## Local check

```
MAKEFUN_INPUT_DIR=<kit>/input MAKEFUN_OUTPUT_DIR=out node main.ts
```

Two runs are byte-identical. Output is a valid forecast (3 keys; per-place
named sums <= 0.4, size sums ~1.0). Last-read order score (the only locally
measurable ground truth): **-21.09** vs v1's -21.00.
