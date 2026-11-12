# Pump.fun top-5 forecaster v4

Monte Carlo log10-cap forecaster with two measured improvements over v1:

## 1. p=0 blocker rows (order)

RULES.txt: a row with p=0 gives its coin 0 at that place and takes it out of
the unnamed share, so the share is split over fewer coins. The top-5 is
filled ONLY by incumbents (already top-5) and newborns (not in the history):
measured over the whole practice history, ZERO coins ranked 11-100 at any
mark ever reached the top-5 at a later mark. So v4 names ranks 11-100 at
p=0 (excluding the rare strong grower, growth > +0.3 over the history).
This shrinks the unnamed divisor from ~89 to ~9, raising the unnamed p for
newcomers from ~0.0067 to ~0.067.

Measured: last-read order -20.998 (v1) -> -9.435 (v4); backtest (2 reads)
order -17.12 (v1) -> -16.06 (v4).

## 2. Growth-shifted sizes (size)

v1's drift (capped 0.03/hr) cannot track the top-cap growth (~0.78/hr
early), so its size centre is too low. v3 proved a decoupled Normal is
wrong. v4 keeps v1's wide simulation shape and shifts it up per read by
`min(0.5, 0.30*sqrt(dt_hours))`. Calibrated on the backtest: shift +0.15
optimal at a 10-20 min horizon (size -15.15 -> -9.65).

Measured on the backtest (history to 20:30, answers 20:40+20:50):
v4 order -16.06, size -9.68, log -25.73 (v1: -17.12, -15.15, -32.27).

## Parameters

- DRIFT_SCALE 0.3, MAX_DRIFT 0.03, VOL_HOUR 0.30 (swept; 0.30 beats 0.15
  once p=0 is in, on both the last read and the backtest).
- UNNAMED_SHARE 0.5 (swept; with p=0 doing the newcomer work, a lower
  unnamed share leaves more named p for surviving known coins).
- SIZE_SHIFT_RATE 0.30, SIZE_SHIFT_CAP 0.5.
- P0_RANK_LO 11, P0_RANK_HI 100, P0_GROWTH_MAX 0.3.

## Scores (official)

- v1: -35.1 (order -19.48, size -15.63), rank 53.
- v2: -35.5 (order -19.77, size -15.75), rank 78.
- v3: -37.0 (order -19.64, size -17.33), rank 167.
- Rank 1: -31.8 (order -17.61, size -14.22).

## Practice check

Run with the kit's practice input; the forecast is deterministic (two runs
byte-identical) and valid (3 keys, top5 5 distinct, per-place named sums
0.5, sizes sum ~1.0).
