# Token Radar

A dashboard that ranks protocols by what their token might be worth if one ever appears.

It reads a frozen DefiLlama snapshot from 14 November 2026 and turns it into three things:
a ranked board, an interactive page, and a dossier the judge reads. Nothing here calls
the network at run time: the snapshot is sealed, the page is static, and every number on
the board can be traced back to the snapshot's own columns.

## What the board ranks

The snapshot lists 758 protocols with at least five million dollars of total value locked.
Forty of them sit on the house watchlist: at least fifty million dollars of TVL and no
token on record. The board carries all forty, then adds the 160 strongest pre-token
protocols below that floor, so the finished ranking holds 200 rows. Protocols whose token
already trades are kept out of the ranking and shown separately at their market value.

## How an implied value is worked out

Every row is scored by one formula applied to the snapshot's own figures, never by a
hand-picked list of names:

- A category price, learned from live markets: for each category, the median ratio of
  market cap to TVL across its protocols that already trade, pulled toward the overall
  median with a prior of five protocols, and clamped between 0.05 and 1.5.
- A growth factor from the protocol's seven-day TVL change, clamped between minus sixty
  and plus one hundred twenty percent, weighted at one half.
- A maturity factor from how long the protocol has run with no token on record, rising
  from 0.6 for a brand-new listing to 1.0 after three years; an unknown listing date
  counts as one year.
- A reach factor from the number of chains the protocol runs on, three percent per extra
  chain up to five.

The four factors multiply the protocol's TVL and round to whole dollars, with a floor of
one dollar. The calibration is printed on the page itself, including the global median
(0.246 on this snapshot) and the ten strongest category prices, so a reader can check
the arithmetic instead of taking it on trust.

The ranking is concentrated and the page says so: seven of the top ten rows are risk
curators, because their calibrated price is 0.701, the highest among the large categories.
That follows from the calibration; the price is not lowered to spread the top ten out.

## Farm plans

Each row carries seven concrete steps: a fresh wallet, the main position, a weekly
qualifying action, a holding period, how to claim, how to exit, and a farm log. Every
step names its cost in dollars or gas and the time it takes, derived from the protocol's
category, chains, TVL and age. Nothing in a plan mentions a protocol by special favour:
the same rules write every plan.

## The page

The dashboard is a single static page with no network calls. It shows the ranked board
with a top-ten strip, a sortable and filterable table, a detail view for every protocol
with the model's own inputs and its farm plan, a side-by-side comparison of two
protocols, and the calibration table. The live-token protocols sit on their own tab at
market value. Keyboard users can move between rows with the arrow keys, open a detail
with Enter, mark two rows for comparison with the C key, and clear the comparison with
Escape.

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
- lib/model.ts — the model, the calibration, the farm plans and the board checks.
- dashboard/ — the static page: index.html, app.css and app.js.
- screenshots/ — the board, a detail view and a filtered view, all 1440 by 900.
- vendor/makefun-board.ts — the vendored dossier library, unchanged from the kit.
- tools/shots.mjs — the screenshot helper used during development.

## The competition

Built for the make.fun token launch radar bounty. The entry is the repository at one
commit plus the transcripts of the agent sessions that built it; the program runs twice
in a sandbox and the dossier goes before an AI judge. First place pays $1,000 of a
$1,325 pool, with $50 for places two to five and $25 for places six to ten.
