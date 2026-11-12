# Pump.fun Top-5 Forecaster v10

v11 order + horizon-dependent size. Built to fix the size catastrophe:
v7/v8/v9-hybrid all share the v8 size and ALL scored size **-21.33** in the
final despite -12.99 in backtest. Order is already solved (v9-hybrid's
official order -17.96 beats rank 1's -18.88); v10 fixes the size.

- **ORDER — v11 momentum method** (unchanged from v9-hybrid, deterministic):
  per place, score the last mark's top 30 coins by
  `rank_w × momentum_w × place_w`, top 10 share 0.50, 90 epsilon rows at
  0.0001 (100 rows/place), 0.50 unnamed. `top5` = last mark's top 5.
- **SIZE — v10 horizon-dependent Normal** (exact, deterministic):
  centre `W(dt)·cutCap[k] + (1-W(dt))·cutCap[0] + G(dt)`,
  `W(dt) = 1 - 0.8·exp(-dt/4)`, `G(dt) = 0.6·(1-exp(-dt/2))`,
  sd `√(0.22² + (0.065·√dt)²)`, averaged over the reads' horizons.
  Anchored at short horizons (where the spread collapses), ~unanchored at
  7–13h (where the anchor hurts); growth saturates instead of rising as √dt.

## Measured backtest (correct divisor, chart=100)

| version | cut2 order | cut3 order | mean order (2,3) | mean size (2,3) | mean log (2,3) |
|---------|-----------|-----------|-----------------|----------------|----------------|
| v9-hybrid | -22.08 | -15.08 | -18.58 | -12.99 | -31.57 |
| **v10** | **-22.08** | **-15.08** | **-18.58** | **-13.48** | **-32.06** |

Order is byte-identical to v9-hybrid. Size is worse in backtest BY DESIGN:
the backtest is 10–60 min (anchor helps), the final is 7–13h (anchor
hurts). Cuts 3,2,1: order -19.82, size -15.21, log -35.00.

Long-horizon (7–13h) check: 100 rows/place (cap holds), named sums 0.509,
peak size bin p 0.066 → best-case size -13.57 if the centre is right.

## Run

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

Entry for `pumpfun-top5-forecast-01` (make.fun), candidate v10 — NOT
submitted, NOT pushed. See `main.ts` header and
`pumpfun-top5-v10-status.md` for the full diagnosis.
