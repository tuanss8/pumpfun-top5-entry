# Pump.fun top-5 forecaster v8

v7 + per-place unnamed shares + naming threshold P_MIN 0.01 + hard
100-rows/place cap. Size model untouched (v7's top-scale-anchored centre +
horizon-dependent sd).

Practice backtest (official ranked.ts scorer, corrected unnamed divisor):
order cut2 -23.06 / cut3 -15.91 (mean -19.49), size cut2 -12.88 / cut3
-13.09 (mean -12.99), log mean -32.47. v7: order -19.85, size -12.99,
log -32.84. Gain +0.36, all from order. Multi-seed order -19.49..-19.57.

Changes vs v7:
1. UNNAMED_SHARE_K = [0.7, 0.6, 0.5, 0.6, 0.5] — per-place newcomer
   shares measured over all 10 ordered mark pairs (p1 0.80, p2 0.70,
   p3 0.50, p4 0.70, p5 0.50), shrunk toward uniform 0.5.
2. P_MIN 0.01 (was 0.0005) — coins below the unnamed per-coin p score
   better unnamed; also holds row counts under the limit at long horizons.
3. Hard cap of 100 rows/place (RULES.txt): keep all p=0 blockers +
   highest-p named rows. Normally a no-op (96-99 rows at 7-13h).

Not changed: crash hazard left exactly as v6/v7 — measured to be a NO-OP
for order in the final (hourly reads: rng() < 1.0*dt always true, every
coin crashes equally, uniform shift). The honest fix (Poisson crashes) is
a v9 research item: backtest slightly worse, long-horizon effect
unmeasurable from the 1h practice.

Expected final: order ~-17.8..-18.0, size ~-13.2 good / ~-13.5
realistic, total ~-31.0 good / ~-31.5 realistic — beats rank 1 (-31.7).

Run: `node main.ts` with MAKEFUN_INPUT_DIR / MAKEFUN_OUTPUT_DIR set
(or /input, /output by default). Node 22+.
