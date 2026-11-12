# Pump.fun top-5 forecaster v3

Monte Carlo log10-cap forecaster for `pumpfun-top5-forecast-01`
("Predict the top 5 new Solana coins by market cap, 24 hours out").

## Model

- **Order**: each live coin's log10 market cap is a random walk with a drift
  estimated from its recent OLS slope (shrunk, scaled 0.3, capped ±0.03/hour)
  and a per-hour volatility. We simulate every coin forward to each of the
  seven answer reads, rank the simulated caps, and average P(coin at place k).
  60% of each place is left unnamed for coins born after the history cut
  (in the practice, 3 of the 5 coins at the last read were not in the history).
- **Volatility (the v3 order fix)**: a vol sweep on the last-read order score
  shows the optimum near 0.10–0.15/hour (v1's 0.30 → −23.26, 0.20 → −23.14,
  0.15 → −23.09, 0.10 → −23.07, 0.07 → −23.14, 0.05 → −23.30). v3 uses
  0.15/hour — nearly the best on the measured read, but far less concentrated
  on the current #1 (p=0.32 vs 0.37 at 0.10), which the extreme top-5 churn
  contradicts.
- **Sizes (the v3 size fix, decoupled from the order simulation)**: the top
  cap EXPLODES — measured top log10 cap 3.04 → 3.56 in 40 minutes
  (+0.79/hour). v1's place-1 size mean (3.71) sits far below where the top
  cap actually lands. So each place's size is a Normal centred on the
  extrapolated top cap (logarithmic growth with horizon, capped at +0.8)
  minus a small gap per place (0.12), with sd 0.18 at place 1 and 0.14
  elsewhere.

## Why v2 was reverted

v2 (survival-aware crash hazard + cap-dependent vol + 50/50 newcomer size
blend) scored −35.5 (order −19.77, size −15.75), rank 78 — WORSE than v1's
−35.1 (order −19.48, size −15.63), rank 53. The crash hazard hurt the order
(−0.29) and the newcomer blend hurt the size (−0.12): its centre was too low
(3.63) and its sd too wide (0.30). v3 reverts to v1's order model and fixes
the size centre directly instead of blending.

## Scores (practice, server-graded)

| version | log | order | size | rank |
|---|---:|---:|---:|---:|
| v1 | −35.1 | −19.48 | −15.63 | 53/358 |
| v2 | −35.5 | −19.77 | −15.75 | 78/380 |
| v3 | — | −23.09 last-read order (v1 −23.26, v2 −23.40 on the same scorer) | — | — |

Rank 1 is −32.1 (order −18.17, size −13.89); rank 10 is −33.7.
Baseline (house persistence) is −40.41.

## Run

```sh
MAKEFUN_INPUT_DIR=<kit>/input MAKEFUN_OUTPUT_DIR=out node main.ts
```

Deterministic (seeded PRNG, two runs are byte-identical). Node 22 stdlib
only, no network, no model calls.
