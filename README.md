# Token Radar

A dashboard that ranks protocols by what their token might be worth if one ever appears.

It reads a frozen DefiLlama snapshot from 14 November 2026 and turns it into three things:
a ranked board, an interactive page, and a dossier the judge reads. Nothing here calls
the network at run time: the snapshot is sealed, the page is static, and every number on
the board can be traced back to the snapshot's own columns.

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
regression of log10(market cap) on log10(TVL), log10(age in days + 1) and ln(1 + the
seven-day TVL change), computed at run time from the snapshot's priced protocols —
every coefficient is fitted, never shipped as a constant.

- The fit: log10(market cap) = 2.700 + 0.640 x log10(TVL) - 0.154 x log10(age+1) +
  0.746 x ln(1+change_7d) on this snapshot, fitted on 98 comparables after two
  exclusions — exchange tokens, and 21 outliers whose market cap sits more than 10x
  above TVL or below 2% of it. R² 0.356. Age enters negative: the longer a protocol
  has gone with no token, the less the market pays per dollar of TVL. Growth enters
  positive: a rising TVL is worth more than a flat one.
- A category factor: each category's mean log residual from the surface, shrunk toward
  1 with a prior of five protocols and clamped between 0.25 and 4; a category with no
  priced protocol takes 1.
- Growth enters as ln(1 + growth) because growth is multiplicative — and because the
  priced protocols span only -40% to +3% in a week, a raw growth term would extrapolate
  wildly on a protocol that doubled its TVL; the log form keeps one hot week from
  multiplying a protocol tenfold. The change is clamped between minus sixty and plus
  one hundred twenty percent before the log.

The terms multiply and round to whole dollars, with a floor of one dollar. Every row
also carries an uncertainty band — the 25th to 75th percentile of actual over predicted
across the comparables, x0.48 to x2.69 on this snapshot — so the page shows a range, not
just a centre.

## The model's own report card

The model is applied to the priced protocols themselves and its errors are printed on the
page, honestly. Five-fold cross-validation on the 98 comparables gives a median absolute
error of 78.2%, with 34.7% of predictions landing within 2x of the actual market cap. The
page says what that means: the surface is a starting price, not a promise, and the band
is the honest part. The scatter plot on the page shows the fit itself — every comparable
plotted as predicted against actual, the diagonal a perfect prediction, the band around
it — so a reader can see how wide the market really is.

The ranking is concentrated and the page says so: five of the top ten rows are risk
curators, because their category factor is the highest among the large categories and
their protocols carry the largest TVLs. That follows from the fit; no factor is tuned
down to spread the top ten out.

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
its ticket, setup time and hold. Two rows can be compared side by side across all eight
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

## The competition

Built for the make.fun token launch radar bounty. The entry is the repository at one
commit plus the transcripts of the agent sessions that built it; the program runs twice
in a sandbox and the dossier goes before an AI judge. First place pays $1,000 of a
$1,325 pool, with $50 for places two to five and $25 for places six to ten.
