# Pump.fun top-5 forecaster v7

**Target: rank 1 (now crave -31.7). Stretch: order -17.61, size -13.22, total -30.83.**

## What v7 is

v6 + a fixed **size centre** and a **horizon-dependent size sd**. The order
model is unchanged from v6.

- **Order: v6 unchanged** (Monte Carlo + crash hazard 1.0/hr x0.3 + 6-mark
  drift window + p=0 blockers). Backtest order mean -19.85, identical to v6.
- **Size centre: top-scale-anchored.** Measured (practice regression,
  R2=0.97): the true top-5 caps revert FULLY to the top scale (gap
  coefficient 1.11) — at any read the top-5 caps form a TIGHT band around
  the top scale, while v6's centre (`cutCap[k] + growth`) inherits the
  cut's spread and is badly wrong at the lower places when the cut is
  spread (cut2: v6 size -20.64). v7 centre:
  `0.2*cutCap[k] + 0.8*cutCap[0] + 0.30*sqrt(dt_hours)` — 75% anchored to
  the top scale (place-1 cap at the cut).
- **Size sd: horizon-dependent.** `sd(dt) = sqrt(0.22^2 +
  (0.065*sqrt(dt))^2)` — ~0.22 on the backtest (centre accurate) widening
  to ~0.30 at the final (centre error from top-scale growth-rate
  uncertainty ~0.065, from the v1/v4 final calibration: truth is cutCap +
  0.85..1.25 at 10h, i.e. growth rate in [0.27, 0.40]). A constant sharp
  sd would be punished at long horizons; a constant wide sd wastes the
  accurate short-horizon centre.

## Measured (practice backtest, OFFICIAL ranked.ts scorer)

| config | cut=3 order | cut=2 order | mean order | cut=3 size | cut=2 size | mean size | mean log |
|---|---|---|---|---|---|---|---|
| v5 | -16.06 | -25.16 | -20.61 | -14.08 | -20.64 | -17.36 | -37.97 |
| v6 | -15.79 | -23.92 | -19.85 | -14.08 | -20.64 | -17.36 | -37.21 |
| **v7** | **-15.79** | **-23.92** | **-19.85** | **-13.09** | **-12.88** | **-12.99** | **-32.84** |

v7 improves the backtest log by **+4.37 over v6, all from size**
(-17.36 -> -12.99). Both cuts agree (cut2 -12.88, cut3 -13.09).
Sweeps behind the choices: CENTRE_W 0.15-0.25 flat (0.2 chosen);
SIZE_GROWTH 0.3 is the peak (0: -15.08, 0.45: -14.47, 0.6: -14.89);
constant SD 0.22 gives -13.01 vs 0.32's -14.36, and the horizon-dependent
sd matches it on the backtest (-12.99) while widening to ~0.30 at the
final. TEMP flat (1.0 kept). Dead ends not retried: growth-shifted sizes,
wide newcomer mixture (sd 0.66), decoupled Normal size, TEMP/VOL
sharpening, mark-6 drift window (no measurable change).

## Expected final

Order ~-17.6 to -18.0 (as v6), size ~-12.2 good / ~-13.5 realistic (if
the centre-structure gain transfers even partially — the tight-cut gain
is ~+1.0) => total **~-29.8 good, ~-31.3 realistic — beats rank 1
(-31.7) in the good-to-realistic case**. Transfer risk (the v4 lesson):
backtest size does not predict final size; the centre is now calibrated
to the true structure (tight top-5, mean reversion) instead of the cut's
spread, which is the sounder basis, but the final's centre error
(top-scale growth over 7-13h) is unmeasurable from the 1h practice.

## Status

Built 2026-11-12. NOT pushed, NOT submitted. Deadline tonight 21:00 WIB.
4 slots left (6/10 used). v6 (round 6, ID 01a1cea1, commit 9a5f84d9) is
submitted and awaiting its official score; v5 (round 5) likewise.
