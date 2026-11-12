# Pump.fun Top-5 Forecaster v9-hybrid

Hybrid of the two best approaches so far. (Named v9-hybrid because a
different v9 — v8 + higher unnamed shares — already exists in
`pumpfun-top5-entry-v9/`; this is a separate candidate.)

- **ORDER — v11 momentum method** (deterministic, no Monte Carlo): for each
  place, score the last mark's top 30 coins by
  `rank_w × momentum_w × place_w` (`1/rank`, `1 + 2·max(0, momentum)`,
  `1/(1+|rank−place|)`), take the top 10 and split 0.50 proportional to
  score; name 90 more coins at epsilon 0.0001 each (100 rows/place), leave
  0.50 unnamed for newcomers. `top5` = last mark's top 5.
- **SIZE — v8 analytic Normal** (exact): top-scale-anchored centre
  `0.2·cutCap[k] + 0.8·cutCap[0] + 0.30·√dt`, sd
  `√(0.22² + (0.065·√dt)²)`, averaged over the reads' horizons.

No Monte Carlo, no RNG — fully deterministic.

## Measured backtest (correct divisor, chart=100)

| version | cut2 order | cut3 order | mean order | mean size | mean log |
|---------|-----------|-----------|-----------|----------|---------|
| v8      | -23.06    | -15.91    | -19.49    | -12.99   | -32.47  |
| **v9-hybrid** | **-22.08** | **-15.08** | **-18.58** | -12.99 | **-31.57** |

v9-hybrid beats v8 by **+0.90** on the backtest mean, all from order;
size is identical to v8 (same method). LONG cut (train 0–1, predict
2–5): v9-hybrid log -39.40 vs v8 -40.11 (+0.71). A p=0 variant of the
90 epsilon rows scores mean log -31.52 (+0.05 over epsilon) — a wash.

Cuts: cut2 = train marks 0–2, predict 3–5; cut3 = train 0–3, predict
4–5 (SHORT); cut1 = train 0–1, predict 2–5 (LONG). Mean = cut2+cut3,
the same footing as v8's reported practice numbers (reproduced exactly
by the local scorer: v8 cut2 -23.06/-12.88, cut3 -15.91/-13.09).

Official rank 1 is -31.7; user target -30. v9-hybrid's backtest mean
(-31.57) is already better than rank 1, but the backtest is on 10–30
min horizons while the final reads are 7–13 h — transfer is the open
risk (the v4 lesson).

## Run

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

Entry for `pumpfun-top5-forecast-01` (make.fun), candidate v9-hybrid —
NOT submitted. See `main.ts` header for the full design notes.
