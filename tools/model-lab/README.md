# Model lab

How radar-5's surface was chosen. `lab.py` replicates `lib/model.ts` exactly —
same calibration rule, same features, same five-fold split — and tests each
proposed change against the same cross-check, so a change has to earn its place.

Run it against the sealed snapshot (and, optionally, a fresh pull as a
robustness check):

    python3 lab.py --snapshot <sealed snapshot.json> [--fresh <newer snapshot.json]

Requires numpy only. No network: both snapshots are files.

## Headline results (sealed snapshot, 2026-11-14)

| Model | Comparables | R² | CV median error | Within 2x | Top 10 |
|---|---|---|---|---|---|
| radar-4 baseline | 98 | 0.356 | 78.2% | 34.7% | Risk Curators ×5 |
| radar-5, own test set | 96 | 0.358 | 72.1% | 40.6% | Risk Curators ×5 |
| radar-5, fixed test set (same 98) | 96 fit / 98 tested | — | 74.0% | 39.8% | Risk Curators ×5 |

The dashboard prints the middle row — the model's report card on its own
comparables, the same convention radar-4 used. The bottom row is the honest
comparison: both models judged on identical protocols. The median gain is the
robust part (it wins 4 of 5 folds, and holds under a hash-based fold
assignment, 76.6% against 82.9%); the within-2x gain is fold-sensitive (it
shrinks to 36.7% against 35.7% under that re-folding), and the mean error is
slightly worse (248% against 235%).

## What was tried

Four changes made it in: chain breadth (log10 of the chains named,
coefficient −0.114, negative in all five folds); median-age imputation
(1,018.5 days instead of a fixed 365); a tighter outlier trim ([0.03, 7],
dropping two collapsed-cap tokens); and a symmetric growth cap (±60%),
which changes no cross-check number but stops a 4,448% weekly jump — a feed
reclassification — from buying a top-ten rank.

Rejected on the evidence: a volatility feature (predictions in the
quintillions); L1 median regression, k-nearest neighbours and Huber robust
regression (all worse out of sample); category depth, category TVL, TVL per
chain, a quadratic TVL term and an age-by-TVL interaction (flat or worse);
stronger category shrinkage (no cross-check gain, no top-ten change); and a
tighter trim still ([0.05, 5]), which looked like a 6-point win until the
test set was held fixed — it had only removed the hard cases from the test.

## Fresh-snapshot validation

On a fresh DefiLlama pull from 15 November 2026 (744 protocols under the
same $5M universe rule), on the same 95 protocols: radar-5 scores 72.4% /
35.8% against radar-4's 76.5% / 37.9% — the median gain holds on new data,
the within-2x rate is slightly worse. The chain-breadth coefficient is
−0.125 against −0.114, and no value explodes. The fresh pull is validation
only — the graded run uses the house's sealed snapshot.
