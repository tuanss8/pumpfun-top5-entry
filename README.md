# Pump.fun top-5 forecaster v9

v8 + higher unnamed shares for the final's 7-13h reads. Everything else
is v8 unchanged (P_MIN 0.01, 100-row cap, v7 size model, Bernoulli crash
hazard 1.0/hr, ORDER_TEMP 1.0, VOL 0.30, DRIFT_HOURS 0.83).

## The one change

UNNAMED_SHARE_K = [0.8, 0.7, 0.6, 0.7, 0.6] (v8: [0.7, 0.6, 0.5, 0.6, 0.5],
+0.1 per place). The newcomer share of the top-5 occupant RISES with lag:
measured 0.40-0.50 at 10 min -> 0.80 at 30-40 min (all 10 ordered mark
pairs; same trend excluding the partial first mark). The per-cut backtest
confirms it: a uniform +0.1 shift HURTS cut3 (short lags, -0.69) but
HELPS cut2 (+0.46) and cut1 (longest lags, +0.33), identically across
3 seeds (deltas within +/-0.01 — not MC noise). The final's reads are
7-13h out, far beyond the practice's 40 min, so the optimal unnamed
share there is higher than v8's short-lag values. +0.1 is the
conservative step: it is the share the data already shows at 30-40 min
(0.8 avg), not an extrapolation past it. KL analysis: if the final's
true share is ~0.8, +0.1 gains ~+0.35 order over v8; if it somehow stays
at v8's level, +0.1 costs only ~-0.11 (a +0.2 shift was rejected: KL
downside -0.54 in the no-growth case).

## Practice backtest (official ranked.ts scorer, corrected divisor)

| config | cut=3 order | cut=2 order | cut=1 order | mean order | mean size | mean log |
|---|---|---|---|---|---|---|
| v8 | -15.91 | -23.06 | -23.02 | -20.66 | -14.35 | -35.02 |
| **v9** | **-16.60** | **-22.60** | **-22.69** | **-20.63** | **-14.35** | **-34.98** |

Means are over cuts 3,2,1. (v8's published mean over cuts 3,2 only: order
-19.49, size -12.99, log -32.47; v9 on cuts 3,2 only: order -19.60,
size -12.99, log -32.59.) The backtest mean is flat by design: it
measures 10-40 min, where v8's values are right. The gain lives at the
final's 7-13h horizons, which the backtest cannot see. Size identical to
v8 (untouched).

Multi-seed (1/7/20261112): the per-cut +0.1 deltas are identical across
seeds (cut3 -0.68..-0.69, cut2 +0.46..+0.47, cut1 +0.33..+0.34).

Long-horizon check (full history, final-like reads 7-13h): rows 96-98/place
(<=100, cap holds), named sums 0.17-0.27, top p 0.022-0.038 (still well
above the unnamed per-coin p ~0.007-0.015 — the named signal survives,
unlike Poisson), top5 5 distinct mints, same top5 as v8.

## Poisson crash — tested and REJECTED (do not re-add)

1. Backtest: consistently slightly worse than Bernoulli (-0.11 standard
   cuts, -0.02 at cut1). 2. Persistence: the crash fraction is FLAT with
   lag (0.60 at 10-40 min for one cohort, 0.00-0.20 for the others), not
   growing as a constant-rate Poisson requires. 3. Long horizon (7-13h):
   Poisson(1.0/hr) COLLAPSES the named mass (named sum 0.13 vs 0.29,
   top p 0.018 vs 0.041) — the forecast goes nearly flat. 4. Field
   evidence: v4's no-crash MC scored order -18.29 officially, proving
   the drift+diffusion ranking carries ~6 points of signal at the final;
   Poisson drowns that signal in iid crash noise. A one-time-death crash
   (each coin dies once with prob 0.2-0.3, then stable) ties Bernoulli on
   the backtest and is distributionally neutral at 7-13h — no gain, not
   shipped. The Bernoulli crash stays as v6/v7/v8.

## Expected final vs rank 1 (-31.7)

v8: ~-31.0 good / ~-31.5 realistic. v9: order ~-17.5..-17.7 in the good
case (v8's -17.8..-18.0 plus the transferred +0.1-shift gain ~+0.35),
size ~-13.2 good / ~-13.5 realistic => total ~-30.7 good / ~-31.2
realistic — beats rank 1 (-31.7) in the good-to-realistic case, and the
-30.83 stretch target is within reach in the good case. Downside if the
final's newcomer share does not grow: ~-0.11 order vs v8 (v9 then
~-31.1 good / ~-31.6 realistic — still around rank 1). Transfer risk
(the v4 lesson) remains: the backtest cannot validate the 7-13h part.

Run: `node main.ts` with MAKEFUN_INPUT_DIR / MAKEFUN_OUTPUT_DIR set
