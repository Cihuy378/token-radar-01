#!/usr/bin/env python3
"""Token Radar model lab: how radar-5's surface was chosen.

Replicates lib/model.ts exactly (same calibration rule, same features, same
five-fold split: comparables sorted by slug, fold i % 5) and tests each proposed
change against the same cross-check, so a change has to earn its place.

Two rules keep the comparison honest, and both are enforced here rather than
left to discipline:

1. FIXED TEST SET. A variant that trims the calibration set is tested on the
   SAME protocols as the baseline — all 98 comparables, folds drawn from the
   full set, the trim applied to the TRAIN folds only. Trimming the test set
   is not an improvement: trim [0.05, 5] looked like a 6-point win until the
   test set was held fixed, when it turned out 2 points worse.
2. FOLD-LUCK CHECK. The winner is re-tested under a different fold assignment
   (md5 of slug) and per fold, so a win that lives in one fold is caught.

Usage:
    python3 lab.py --snapshot <snapshot.json> [--fresh <snapshot.json>]

--snapshot is the sealed snapshot the board is graded on; --fresh is an
optional newer DefiLlama pull under the same universe rule, used only as a
robustness check (the graded run always uses the sealed snapshot).

Requires numpy only. No network: both snapshots are files.
"""
import argparse
import hashlib
import json
import math
import re
import statistics
import sys
from collections import Counter, defaultdict

import numpy as np


# --------------------------------------------------------------------------
# Snapshot access
# --------------------------------------------------------------------------

def load_snapshot(path):
    with open(path) as f:
        return json.load(f)


def age_days(snap, p):
    """Whole days from listed_at to the snapshot date; None when unknown."""
    from datetime import date

    if p["listed_at"] is None:
        return None
    return max(0, (date.fromisoformat(snap["as_of"]) - date.fromisoformat(p["listed_at"])).days)


def clamp(n, lo, hi):
    return min(hi, max(lo, n))


def finite(v, fallback=0.0):
    return v if isinstance(v, (int, float)) and math.isfinite(v) else fallback


# --------------------------------------------------------------------------
# Features (mirror lib/model.ts: featuresOf / logAgeOf / growthOf / logChainsOf)
# --------------------------------------------------------------------------

def features(snap, p, spec, age_default, cap_hi):
    out = []
    for name in spec:
        if name == "logtvl":
            out.append(math.log10(p["tvl_usd"]))
        elif name == "logage":
            a = age_days(snap, p)
            out.append(math.log10((a if a is not None else age_default) + 1))
        elif name == "growth":
            out.append(math.log1p(clamp(finite(p["change_7d"]), -60, cap_hi) / 100.0))
        elif name == "chains":
            out.append(math.log10(max(1, len(p["chains"]))))
        elif name == "vol":
            # |change| capped like growth. REJECTED: it prices one board row
            # in the quintillions (see the battery below).
            out.append(abs(clamp(finite(p["change_7d"]), -120, 120)) / 100.0)
        elif name == "catdepth":
            out.append(math.log10(CAT_COUNT[snap["as_of"]][p["category"] or "Other"]))
        else:
            raise ValueError(name)
    return out


# Category sizes per snapshot, computed once (a feature input, not a fit).
CAT_COUNT = {}


def index_categories(snap):
    CAT_COUNT[snap["as_of"]] = Counter(p["category"] or "Other" for p in snap["protocols"])


# --------------------------------------------------------------------------
# Calibration set (mirror lib/model.ts: calibrationSet)
# --------------------------------------------------------------------------

def calibration_set(snap, trim_lo, trim_hi):
    return [p for p in snap["protocols"]
            if p["mcap_usd"] is not None and p["mcap_usd"] > 0 and p["tvl_usd"] > 0
            and p["category"] != "CEX"
            and trim_lo <= p["mcap_usd"] / p["tvl_usd"] <= trim_hi]


def median_known_age(snap, live, fallback=365):
    ages = sorted(a for a in (age_days(snap, p) for p in live) if a is not None)
    return statistics.median(ages) if ages else fallback


# --------------------------------------------------------------------------
# Fit (mirror lib/model.ts: fitCurve + residualsByCategory + shrunkMultiplier)
# --------------------------------------------------------------------------

class Fit:
    def __init__(self, snap, live, spec, prior=5, age_mode="median", cap_hi=120,
                 estimator="ols"):
        self.snap = snap
        self.spec = spec
        self.prior = prior
        self.cap_hi = cap_hi
        self.age_default = (median_known_age(snap, live) if age_mode == "median"
                            else 365)
        X = np.array([[1.0] + features(snap, p, spec, self.age_default, cap_hi)
                      for p in live], dtype=float)
        y = np.array([math.log10(p["mcap_usd"]) for p in live])
        if estimator == "ols":
            beta, *_ = np.linalg.lstsq(X, y, rcond=None)
        elif estimator == "huber":
            beta = self._huber(X, y)
        elif estimator == "l1":
            beta = self._l1(X, y)
        else:
            raise ValueError(estimator)
        self.beta = beta
        self.n = len(live)
        resid = y - X @ beta
        ss_tot = float(((y - y.mean()) ** 2).sum())
        ss_res = float((resid ** 2).sum())
        self.r2 = 1 - ss_res / ss_tot if ss_tot else 0.0
        sums = defaultdict(lambda: [0, 0.0])
        for p, r in zip(live, resid):
            k = p["category"] or "Other"
            sums[k][0] += 1
            sums[k][1] += float(r)
        self.cat = {k: (n, s / n) for k, (n, s) in sums.items()}

    @staticmethod
    def _huber(X, y, iters=3, c=1.345):
        beta, *_ = np.linalg.lstsq(X, y, rcond=None)
        for _ in range(iters):
            r = y - X @ beta
            s = 1.4826 * np.median(np.abs(r - np.median(r))) or 1.0
            w = np.where(np.abs(r) <= c * s, 1.0, c * s / np.maximum(np.abs(r), 1e-12))
            XtW = X.T * w
            beta = np.linalg.solve(XtW @ X + 1e-9 * np.eye(X.shape[1]), XtW @ y)
        return beta

    @staticmethod
    def _l1(X, y, iters=25):
        beta, *_ = np.linalg.lstsq(X, y, rcond=None)
        for _ in range(iters):
            r = y - X @ beta
            w = 1.0 / np.maximum(np.abs(r), 1e-3)
            XtW = X.T * w
            new = np.linalg.solve(XtW @ X + 1e-9 * np.eye(X.shape[1]), XtW @ y)
            if np.max(np.abs(new - beta)) < 1e-6:
                return new
            beta = new
        return beta

    def cat_mult(self, category):
        e = self.cat.get(category or "Other")
        if e is None:
            return 1.0
        n, mean = e
        return clamp(10 ** ((n * mean) / (n + self.prior)), 0.25, 4.0)

    def predict(self, p):
        x = [1.0] + features(self.snap, p, self.spec, self.age_default, self.cap_hi)
        return max(1, round(10 ** float(np.dot(self.beta, x)) * self.cat_mult(p["category"])))


# --------------------------------------------------------------------------
# Board (mirror lib/model.ts: isRankable + buildBoard, top 10 only)
# --------------------------------------------------------------------------

VERSIONED = re.compile(r"\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$")
EXCLUDED = {"Bridge", "Canonical Bridge", "Liquid Staking", "Liquid Restaking",
            "Restaked BTC", "CEX"}
EXCHANGE_PREFIX = re.compile(r"^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b")
WRAPPED_WORD = re.compile(r"\b(wrapped|staked|staking)\b", re.I)


def is_rankable(p):
    if not (p["mcap_usd"] is None and p["gecko_id"] is None and p["symbol"] is None):
        return False
    if (p["category"] or "") in EXCLUDED:
        return False
    if VERSIONED.search(p["name"]) or WRAPPED_WORD.search(p["name"]) or EXCHANGE_PREFIX.search(p["name"]):
        return False
    return True


def board_top10(snap, fit):
    idx = {p["slug"]: p for p in snap["protocols"]}
    chosen = {}
    for slug in snap["watchlist"]:
        if slug in idx:
            chosen[slug] = idx[slug]
    for p in snap["protocols"]:
        if p["slug"] not in chosen and is_rankable(p):
            chosen[p["slug"]] = p
    preds = {slug: fit.predict(p) for slug, p in chosen.items()}
    scored = sorted(chosen.values(), key=lambda p: (-preds[p["slug"]], p["slug"]))
    return ([(p["slug"], p["category"] or "Other", preds[p["slug"]])
             for p in scored[:10]],
            max(preds.values()), sum(preds.values()))


# --------------------------------------------------------------------------
# Cross-check (mirror lib/model.ts: backtest)
# --------------------------------------------------------------------------

def slug_fold(sorted_slugs):
    order = {s: i for i, s in enumerate(sorted_slugs)}
    return lambda p: order[p["slug"]] % 5


def hash_fold(p):
    return int(hashlib.md5(p["slug"].encode()).hexdigest(), 16) % 5


def backtest(snap, full_live, train_filter, spec, prior=5, age_mode="median",
             cap_hi=120, estimator="ols", fold_key=None):
    """Five-fold CV. The TEST set is always the full comparables list; the
    train filter (e.g. a tighter trim) applies to the TRAIN folds only."""
    srt = sorted(full_live, key=lambda p: p["slug"])
    if fold_key is None:
        fold_key = slug_fold([p["slug"] for p in srt])
    errs, within, per_fold = [], [], []
    for fold in range(5):
        train = [p for p in srt if fold_key(p) != fold and train_filter(p)]
        test = [p for p in srt if fold_key(p) == fold]
        fit = Fit(snap, train, spec, prior, age_mode, cap_hi, estimator)
        ferrs, fwithin = [], []
        for p in test:
            pred, actual = fit.predict(p), p["mcap_usd"]
            ferrs.append(abs(pred - actual) / max(1, actual))
            fwithin.append(0.5 <= pred / max(1, actual) <= 2.0)
        errs.extend(ferrs)
        within.extend(fwithin)
        ferrs.sort()
        fmed = ferrs[len(ferrs) // 2] if len(ferrs) % 2 == 1 else (
            ferrs[len(ferrs) // 2 - 1] + ferrs[len(ferrs) // 2]) / 2
        per_fold.append((fmed * 100, sum(fwithin) / len(fwithin) * 100))
    errs.sort()
    med = errs[len(errs) // 2] if len(errs) % 2 == 1 else (
        errs[len(errs) // 2 - 1] + errs[len(errs) // 2]) / 2
    return med * 100, sum(within) / len(within) * 100, per_fold


def report(name, snap, full_live, train_filter, spec, **kw):
    med, w2x, _ = backtest(snap, full_live, train_filter, spec, **kw)
    live = [p for p in full_live if train_filter(p)]
    fit = Fit(snap, live, spec, kw.get("prior", 5), kw.get("age_mode", "median"),
              kw.get("cap_hi", 120), kw.get("estimator", "ols"))
    t10, mx, _ = board_top10(snap, fit)
    cats = Counter(c for _, c, _ in t10)
    tc, tn = cats.most_common(1)[0]
    flag = "  <-- ABSURD MAX" if mx > 10e9 else ""
    print(f"{name:38s} n={fit.n:2d} R2={fit.r2:.3f} CVmed={med:5.1f}% "
          f"within2x={w2x:4.1f}% top={tc} x{tn} max=${mx:,.0f}{flag}")
    return med, w2x


# --------------------------------------------------------------------------
# The battery
# --------------------------------------------------------------------------

BASE_SPEC = ("logtvl", "logage", "growth")
WIN_SPEC = ("logtvl", "logage", "growth", "chains")
KEEP_ALL = lambda p: True  # noqa: E731
TRIM_0307 = lambda p: 0.03 <= p["mcap_usd"] / p["tvl_usd"] <= 7  # noqa: E731
TRIM_0505 = lambda p: 0.05 <= p["mcap_usd"] / p["tvl_usd"] <= 5  # noqa: E731


def run_battery(snap):
    index_categories(snap)
    full98 = calibration_set(snap, 0.02, 10)
    print(f"snapshot {snap['as_of']}: {len(snap['protocols'])} protocols, "
          f"{len(full98)} comparables at the radar-4 trim")
    print("--- baseline replication (must match radar-4: R2 0.356, 78.2%, 34.7%) ---")
    report("radar-4 baseline", snap, full98, KEEP_ALL, BASE_SPEC,
           age_mode="fixed365", cap_hi=120)
    print("--- single feature additions ---")
    report("+ chains", snap, full98, KEEP_ALL, BASE_SPEC + ("chains",),
           age_mode="fixed365", cap_hi=120)
    report("+ vol (REJECTED: absurd tail)", snap, full98, KEEP_ALL,
           BASE_SPEC + ("vol",), age_mode="fixed365", cap_hi=120)
    report("+ category depth", snap, full98, KEEP_ALL, BASE_SPEC + ("catdepth",),
           age_mode="fixed365", cap_hi=120)
    print("--- estimators ---")
    report("Huber robust", snap, full98, KEEP_ALL, BASE_SPEC,
           age_mode="fixed365", cap_hi=120, estimator="huber")
    report("L1 median", snap, full98, KEEP_ALL, BASE_SPEC,
           age_mode="fixed365", cap_hi=120, estimator="l1")
    print("--- shrinkage (prior 5 -> 10 / 20) ---")
    report("prior 10", snap, full98, KEEP_ALL, BASE_SPEC,
           age_mode="fixed365", cap_hi=120, prior=10)
    report("prior 20", snap, full98, KEEP_ALL, BASE_SPEC,
           age_mode="fixed365", cap_hi=120, prior=20)
    print("--- trim hygiene, fixed test set ---")
    report("trim [0.05,5] (fake win: see README)", snap, full98, TRIM_0505,
           BASE_SPEC, age_mode="fixed365", cap_hi=120)
    report("trim [0.03,7]", snap, full98, TRIM_0307, BASE_SPEC,
           age_mode="fixed365", cap_hi=120)
    print("--- age imputation ---")
    report("median-age imputation", snap, full98, KEEP_ALL, BASE_SPEC,
           age_mode="median", cap_hi=120)
    print("--- the winner ---")
    report("RADAR-5 (median age + trim + chains)",
           snap, full98, TRIM_0307, WIN_SPEC, age_mode="median", cap_hi=60)
    print("--- winner stability ---")
    med_b, w_b, folds_b = backtest(snap, full98, KEEP_ALL, BASE_SPEC,
                                   age_mode="fixed365", cap_hi=120)
    med_w, w_w, folds_w = backtest(snap, full98, TRIM_0307, WIN_SPEC,
                                   age_mode="median", cap_hi=60)
    wins = sum(1 for f in range(5) if folds_w[f][0] < folds_b[f][0])
    print(f"per-fold median error: winner wins {wins}/5 folds "
          f"(baseline {['%.1f' % x[0] for x in folds_b]}, "
          f"winner {['%.1f' % x[0] for x in folds_w]})")
    med_b2, w_b2, _ = backtest(snap, full98, KEEP_ALL, BASE_SPEC,
                               age_mode="fixed365", cap_hi=120, fold_key=hash_fold)
    med_w2, w_w2, _ = backtest(snap, full98, TRIM_0307, WIN_SPEC,
                               age_mode="median", cap_hi=60, fold_key=hash_fold)
    print(f"hash folds: baseline med {med_b2:.1f}% / {w_b2:.1f}%  "
          f"winner med {med_w2:.1f}% / {w_w2:.1f}%")
    # Full-fit figures for the README / header comment.
    live = [p for p in full98 if TRIM_0307(p)]
    fit = Fit(snap, live, WIN_SPEC, age_mode="median", cap_hi=60)
    t10, mx, total = board_top10(snap, fit)
    print(f"winner full fit: beta={[round(float(b), 3) for b in fit.beta]}, "
          f"age imputed {fit.age_default:.1f} days, total implied ${total / 1e9:.2f}B")
    print("winner top 10: " + ", ".join(f"{s} (${v / 1e6:.0f}M)" for s, _, v in t10))
    print(f"winner risk-curator factor: "
          f"{fit.cat_mult('Risk Curators'):.3f}x from "
          f"{fit.cat.get('Risk Curators', (0, 0))[0]} priced protocol(s)")


def run_fresh(fresh):
    index_categories(fresh)
    full = calibration_set(fresh, 0.02, 10)
    print(f"--- fresh snapshot {fresh['as_of']}: {len(fresh['protocols'])} protocols, "
          f"{len(full)} comparables ---")
    report("radar-4 baseline (fresh)", fresh, full, KEEP_ALL, BASE_SPEC,
           age_mode="fixed365", cap_hi=120)
    report("radar-5 winner (fresh)", fresh, full, TRIM_0307, WIN_SPEC,
           age_mode="median", cap_hi=60)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--snapshot", required=True, help="sealed snapshot.json")
    ap.add_argument("--fresh", help="optional newer snapshot.json (validation only)")
    args = ap.parse_args(argv)
    run_battery(load_snapshot(args.snapshot))
    if args.fresh:
        run_fresh(load_snapshot(args.fresh))
    return 0


if __name__ == "__main__":
    sys.exit(main())
