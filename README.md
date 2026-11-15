# Token Radar

A dashboard that ranks protocols by what their token might be worth if one ever appears.

This is the radar-5 entry. It reads a frozen DefiLlama snapshot from 14 November 2026
and turns it into three things: a ranked board, an interactive page, and a dossier the
judge reads. Nothing here calls the network at run time: the snapshot is sealed, the
page is static, and every number on the board can be traced back to the snapshot's own
columns.

## What the board ranks

The snapshot lists 758 protocols with at least five million dollars of total value locked.
Forty of them sit on the house watchlist: at least fifty million dollars of TVL and no
token on record. The board carries all forty, then adds every remaining protocol the
watchlist rule leaves rankable — pre-token, not a wrapped, staked or bridged product,
not an exchange, not a versioned pool — so the finished ranking holds 198 rows. The page
states the accounting: 198 ranked, 416 with a token on record, 144 set aside. Protocols
whose token already trades are kept out of the ranking and shown separately at their
market value.

## How an implied value is worked out

Every row is scored by one formula applied to the snapshot's own figures, never by a
hand-picked list of names. The price comes from the market's own surface: a multiple
regression of log10(market cap) on log10(TVL), log10(age in days + 1), ln(1 + the
seven-day TVL change) and log10(the chains the protocol names), computed at run time
from the snapshot's priced protocols — every coefficient is fitted, never shipped as a
constant.

- The fit: log10(market cap) = 2.733 + 0.607 x log10(TVL) - 0.043 x log10(age+1) +
  0.862 x ln(1+change_7d) - 0.114 x log10(chains) on this snapshot, fitted on 96
  comparables after two exclusions — exchange tokens, and 23 outliers whose market cap
  sits more than 7x above TVL or below 3% of it. R² 0.358. Growth enters positive: a
  rising TVL is worth more than a flat one. Chain breadth enters negative: TVL spread
  thin across many chains prices lower per dollar than TVL concentrated on one. Age
  enters near zero: the one-year guess it replaced had been inflating the age effect.
- A category factor: each category's mean log residual from the surface, shrunk toward
  1 with a prior of five protocols and clamped between 0.25 and 4; a category with no
  priced protocol takes 1.
- Growth enters as ln(1 + growth) because growth is multiplicative — and because the
  priced protocols span only -40% to +3% in a week, a raw growth term would extrapolate
  wildly on a protocol that doubled its TVL; the log form keeps one hot week from
  multiplying a protocol tenfold. The change is clamped between minus sixty and plus
  sixty percent before the log: the fit has never seen a priced week above +3%, so a
  protocol whose TVL jumped fortyfold in a week — a feed reclassification, not
  momentum — must not buy a top-ten rank on one number.
- A protocol with no listing date takes the comparables' median known age, computed
  from the fit's own set on every run — 1,018.5 days on this snapshot. A fixed
  one-year guess would sit three times too young, and a fold's imputation must never
  leak the held-out fold's ages.

The terms multiply and round to whole dollars, with a floor of one dollar. Every row
also carries an uncertainty band — the 25th to 75th percentile of actual over predicted
across the comparables, x0.49 to x2.72 on this snapshot — so the page shows a range, not
just a centre.

## The model's own report card

The model is applied to the priced protocols themselves and its errors are printed on the
page, honestly. Five-fold cross-validation on the 96 comparables gives a median absolute
error of 72.1%, with 40.6% of predictions landing within 2x of the actual market cap. The
page says what that means: the surface is a starting price, not a promise, and the band
is the honest part. The scatter plot on the page shows the fit itself — every comparable
plotted as predicted against actual, the diagonal a perfect prediction, the band around
it — so a reader can see how wide the market really is.

Two comparisons, stated plainly so neither flatters the model. The 72.1% / 40.6% above
is the model's report card on its own 96 comparables, the same convention radar-4 used
for its 78.2% / 34.7% on 98. On the same 98 protocols, judged identically, radar-5
scores 74.0% / 39.8% against radar-4's 78.2% / 34.7% — the improvement survives when
the test set is held fixed. The median gain is the robust part: it wins four of five
folds, and it holds under a different fold assignment (76.6% against 82.9% when folds
are assigned by a hash of the slug instead of by slug order). The within-2x gain is
fold-sensitive — under that same re-folding it shrinks to 36.7% against 35.7% —
and the mean error is slightly worse (248% against 235%): the new model helps the
typical protocol but has fatter tails. All three numbers are in tools/model-lab/.

The ranking is concentrated and the page says so: five of the top ten rows are risk
curators. That is not a fit artifact. The risk-curator category factor is only 1.36x,
from a single priced protocol, and the top five are there on TVL alone — $2.76B,
$2.75B, $1.58B, $0.51B and $0.29B are the five largest pre-token treasuries in the
snapshot, and all five are risk curators. Stronger shrinkage (a prior of 10 or 20
instead of 5) moves the levels but not the top ten at all, and a diversity adjustment
would mean deliberately mispricing the biggest protocols to spread the ranking — so
none was applied. The concentration note on the page says exactly this.

## How the model was chosen

The model was selected by experiment, not by intuition, in tools/model-lab/ — a Python
prototype that replicates the TypeScript fit exactly (it reproduces radar-4's baseline
to the decimal: R² 0.356, median error 78.2%, 34.7% within 2x) and tests each change
against the same five-fold cross-check. Thirty variants were tried; four changes made
it in, and the rest were rejected on the evidence:

- Chain breadth, log10 of the chains a protocol names, coefficient -0.114, negative
  in all five folds. TVL spread across many chains prices lower per dollar.
- Median-age imputation for the 24 comparables with no listing date: 1,018.5 days
  instead of a fixed 365. The old guess sat three times too young and had been
  inflating the age effect; with the median, the age coefficient falls to -0.043.
- A tighter outlier trim, market-cap / TVL inside [0.03, 7] instead of [0.02, 10],
  which drops two collapsed-cap tokens (kyros at 0.020, merlinswap at 0.022). A
  tighter trim still ([0.05, 5]) looked better at first — until the test set was held
  fixed, when it turned out worse: it had only removed the hard cases from the test.
- A symmetric growth cap of ±60% instead of -60% / +120%. It changes no cross-check
  number (no comparable moves more than 60% in a week), but it stops a data artifact
  from ranking: one board protocol's TVL jumped 4,448% in a week, a feed
  reclassification, and the old +120% cap still handed it a top-ten rank.

Rejected, with reasons: a volatility feature (|change|) produced predictions in the
quintillions; L1 median regression, k-nearest neighbours and Huber robust regression
all scored worse out of sample; category depth, category TVL, TVL per chain, a
quadratic TVL term and an age-by-TVL interaction were flat or worse; stronger
category shrinkage neither improved the cross-check nor moved the top ten.

Freshness was checked, not assumed. The graded run uses the house's sealed snapshot
(14 November 2026) — a newer pull cannot replace it. But the model was validated on
a fresh DefiLlama pull from 15 November 2026 (744 protocols under the same $5M
universe rule, all 40 watchlist slugs present): on the same 95 protocols, radar-5
scores 72.4% / 35.8% against radar-4's 76.5% / 37.9% — the median gain holds on new
data, while the within-2x rate is slightly worse, the same fold-sensitivity the
sealed snapshot shows. The chain-breadth coefficient is -0.125 against -0.114 on
the sealed snapshot, and no value explodes. The fresh pull is a validation artifact
only; the sealed snapshot is the one the board is graded on.

## Farm plans

Each row carries nine concrete steps, derived from the protocol's mechanism — vault
curation, collateralised debt, DEX liquidity, real-world yield, prediction market,
restaking, and fourteen more, all read from the snapshot's category, chain and name
fields. Every step names its cost in dollars or gas and the time it takes: a fresh
wallet, the main position, a check on the dashboard or points page, a weekly qualifying
action, a holding period, a sizing check against the row's own implied range, a claim
check, an exit path, and a farm log. Capital runs $50 to $250 by TVL; gas is chain-aware,
from $0.10 on Solana to about $10 of bridge gas on Bitcoin-family chains. Nothing in a
plan mentions a protocol by special favour: the same rules write every plan.

## The page

The dashboard is a single static page with no network calls, in a light editorial style:
serif headlines on warm paper, pine green and brass accents. It shows a research summary
with the fitted surface and its predicted-against-actual scatter, a stats strip, a
coverage bar, top-five cards with value ranges, a distribution histogram, and a sortable,
filterable table with an uncertainty band on every row — filterable by category, chain,
mechanism and seven-day move, with a watchlist-only view and search. A detail view for
every protocol shows the model's own inputs recomputed on the page, its farm plan, and
its ticket, setup time and hold. Two rows can be compared side by side across all ten
model factors. The live-token protocols sit on their own tab at market value. Keyboard
users can move between rows with the arrow keys, open a detail with Enter, mark two rows
for comparison with the C key, and clear the comparison with Escape.

## Running it

Node 22 or later is the only requirement. From the repository root:

    mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot>

That writes board.json, data.js, the dashboard, the screenshots and dossier.json into
the output directory. Run it twice into two directories and compare them: the two trees
must be byte for byte identical, because the program reads no clock and opens no network.

## Limits the gate enforces

- The board holds 100 to 4,000 rows and covers every watchlist slug.
- Ranks run exactly 1 to N, and implied values never rise as rank ascends.
- Every farm plan has 3 to 12 steps, each 20 to 600 characters.
- The dashboard source stays under 64 KB so the dossier can carry it whole.
- Each screenshot is a whole PNG or JPEG under 512 KiB, 1440 by 900 pixels.
- The dossier is at most 1.5 MB and must match what the vendored library rebuilds.

## Layout

- main.ts — the entrypoint: reads the snapshot, scores the board, writes the outputs.
- lib/model.ts — the model, the regression fit, the farm plans and the board checks.
- dashboard/ — the static page: index.html, app.css and app.js.
- screenshots/ — the board, a detail view and a filtered view, all 1440 by 900.
- vendor/makefun-board.ts — the vendored dossier library, unchanged from the kit.
- tools/shots.mjs — the screenshot helper used during development.
- tools/model-lab/ — the Python prototype the model was selected with: it replicates
  the TypeScript fit exactly and runs every variant against the same five-fold
  cross-check, on a fixed test set, so a change has to earn its place.

## The competition

Built for the make.fun token launch radar bounty. The entry is the repository at one
commit plus the transcripts of the agent sessions that built it; the program runs twice
in a sandbox and the dossier goes before an AI judge. First place pays $1,000 of a
$1,325 pool, with $50 for places two to five and $25 for places six to ten.
