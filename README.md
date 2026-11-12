# Pump.fun Top-5 Forecaster

Monte Carlo log10-cap forecaster for `pumpfun-top5-forecast-01`: predicts the 5 largest pump.fun coins by market cap at each of the seven answer reads, with a probability for each coin at each place and each place's market-cap size in 82 bins.

## Model

Each coin's log10(market cap in SOL) is a random walk:
- **Drift**: OLS slope of log10 cap on time over the last 1 hour, shrunk by n/(n+2), scaled by 0.3, capped at ±0.03/hour. Hot coins mean-revert; the drift is deliberately weak.
- **Volatility**: 0.30/hour in log10, measured from the practice history (per-10-min log10-cap change sd 0.121).
- **Simulation**: 4,000 Monte Carlo paths, each coin stepped forward to every answer read (times read from task.json, so the same code runs the 10-minute practice reads and the hourly final reads). At each read the simulated caps are ranked.
- **Probabilities**: P(coin at place k) averaged over paths and reads, scaled by (1 − UNNAMED_SHARE).
- **Newcomers**: 60% of each place is left unnamed. In the practice, 3 of the 5 coins at the last answer read were launched after the history ended, and only 1 of the last mark's top 5 held a top-5 place there — so most of the top 5 is coins the history never saw.
- **Sizes**: the log10 cap at each place across paths and reads, histogrammed into the 82 bins (edges 2.00–6.00 at 0.05).
- **top5**: the coins with the lowest expected rank.

## Practice check

On the practice history the last-read order score is about −21.0 (house baseline's mean order score is −21.38; an even spread is −23.03 per read). The model names the two history coins that do reach the last read's top 5 (MIHAO VI, Google) with real probability and leaves room for the three newcomers.

## Run

```sh
mkdir -p out
MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

Node 22, standard library only, deterministic (seeded PRNG).
