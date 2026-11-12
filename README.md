# Pump.fun top-5 forecaster v6

**Target: rank 1 (now crave -31.7). Stretch: order -17.61, size -13.22, total -30.83.**

## What v6 is

v5 + one order change: a **crash hazard** in the Monte Carlo, plus a **6-mark drift window**.

- **Order: v5's model + crash hazard.** Per hour, each coin's log10 cap jumps
  down by log10(0.3) with probability 1.0. Measured: 15-20% of top-5 coins
  lose >50% of cap (or vanish) within 10-20 min; the bottom decile of 10-min
  top-coin cap changes is -0.67. The hazard spreads the Monte Carlo place
  mass off the current top coins, which mostly turn over, and makes the
  forecast less sensitive to Monte Carlo noise. Drift window set to 6 marks
  (DRIFT_HOURS 0.83; user: "mark 6") — the drift window is unidentifiable on
  the 1h practice (drift is dwarfed by volatility at 10-50 min horizons), so
  6 marks is adopted literally with zero change to the practice score.
- **Size: identical to v5** (sharp Normal per place, centre
  `cutCap[k] + 0.30*sqrt(dt_hours)`, sd 0.32). The size model ignores the
  Monte Carlo histogram, so the crash hazard does not touch the size score.

## Measured (practice backtest, OFFICIAL ranked.ts scorer)

Important correction vs the v5 report: the v5 backtest used the wrong
unnamed divisor (100 - named count). The official rule shares the unnamed
mass over the **answer chart's ids NOT named** (divisor ~70, not ~5, because
the answer chart is full of newcomers). The corrected v5 baseline is
cut=3 order -16.06, cut=2 order -25.16 — much closer to v4's final -18.29.

| config | cut=3 order | cut=2 order | mean order |
|---|---|---|---|
| v5 | -16.06 | -25.16 | -20.61 |
| **v6 (crash 1.0)** | **-15.79** | **-23.92** | **-19.85** |

Mean over seeds 1/7/20261112: v5 -20.57, v6 -19.89 — **+0.67 order, consistent
across seeds**. Size identical to v5 (cut=3 -14.08, cut=2 -20.64).
u-sweep on the corrected scorer is flat (best u=0.6 -20.55 vs u=0.5 -20.61),
so UNNAMED_SHARE stays 0.5. Breakout: no effect (dropped). TEMP/VOL
sharpening: hurt (v5). Growth-shifted sizes, wide newcomer mixture,
decoupled Normal size: all previously rejected, not retried.

## Expected final

Order ~-17.6 to -18.0 (if the +0.67 backtest gain transfers), size -13.22
good / ~-14.5 realistic => total ~-30.8 good, ~-32.3 realistic. Rank 1
(-31.7) is beatable in the good case. The -30.83 stretch target needs order
-17.61 AND size -13.22 together. Transfer risk: the backtest measures
10-50 min horizons; the final reads are 7-13h out, where the crash hazard
compounds — CH=1.0 matches the measured hourly hazard, while CH=2-3 scored
slightly better on the backtest (+0.85) but risks over-diffusion at long
horizons, so 1.0 was chosen.

## Status

Built 2026-11-12. NOT pushed, NOT submitted. Deadline tonight 21:00 WIB.
5 slots left (5/10 used). v5 (round 5) is submitted and awaiting its
official score.
