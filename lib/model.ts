// The token radar's model, version radar-5: one sealed snapshot in, one ranked board out.
//
// The board ranks every protocol the snapshot's own rules leave rankable: all 40 watchlist
// slugs, plus every other pre-token protocol that is not a wrapped, staked or bridged product,
// not an exchange, and not a versioned pool. On this snapshot that is 198 rows. Protocols
// whose token already trades are kept apart and shown at the market's own values, never mixed
// into the ranked board.
//
// Implied value comes from the market's own surface, fitted at runtime from the snapshot's
// priced protocols — never from a hardcoded list of names and never from a hardcoded fitted
// constant. The fit runs in three steps:
//
//   1. The surface. A multiple regression of log10(market cap) on four of the snapshot's
//      own figures — log10(TVL), log10(age in days + 1), log(1 + the seven-day TVL
//      change), and log10(the chains the protocol names) — over the snapshot's priced
//      protocols, with two exclusions: exchange tokens (an exchange's token is not a
//      protocol's) and outliers whose market cap sits more than 7x above TVL or below 3%
//      of it. Every coefficient is computed from the snapshot on every run, so age,
//      growth and chain breadth are fitted effects now, not stated factors: the
//      snapshot's own data says how much each is worth. TVL, age and chain breadth enter
//      centred at their comparables means, so each factor reads 1.0 for a typical
//      protocol and the intercept is the value of a protocol at mean TVL, mean age, mean
//      chain breadth and zero growth. Growth enters as log(1 + growth) because growth is
//      multiplicative — and because the priced protocols span only -40% to +3% in a week,
//      a raw growth term would extrapolate wildly on a protocol that doubled its TVL;
//      the log form keeps one hot week from multiplying a protocol tenfold. The growth
//      clamp is symmetric at plus or minus 60%: the fit has never seen a priced week
//      above +3%, so a protocol whose TVL jumped fortyfold in a week — a feed
//      reclassification, not momentum — must not buy a top-ten rank on the strength of
//      one number. A protocol with no listing date takes the median known age of the
//      comparables, computed from the fit's own set on every run: a fixed one-year guess
//      would sit three times too young on this snapshot, and a fold's imputation must
//      never leak the held-out fold's ages.
//   2. The category factor. Each category's mean log residual from the surface, shrunk
//      toward zero (a multiplier of 1) with a prior of five protocols, then clamped to
//      [0.25, 4]. A category with no priced protocol at all takes a multiplier of 1.
//   3. The range. Every row carries an uncertainty band: the 25th and 75th percentiles of
//      the ratio of actual market cap to the model's prediction across the priced protocols,
//      so half of the priced tokens land inside the band.
//
//   implied = 10^(intercept + tvl x log10(TVL) + age x log10(age+1) + growth x ln(1+change_7d)
//             + chains x log10(chains)) x category, rounded to whole dollars, with a floor
//             of one dollar.
//
// The page also carries a five-fold cross-check: the surface is refitted on four fifths of
// the priced protocols and tested on the fifth, five times, and the median absolute error
// and the share of predictions within 2x are reported as the model's own report card. The
// cross-check is out-of-sample, so it is the honest number; the in-sample fit would flatter
// the model. The cross-check tests on the model's own comparables, as radar-4's did; the
// README states the same comparison on a fixed test set too, so the two models are judged
// on identical protocols.
//
// Measured on this snapshot (2026-11-14): 96 comparables after the outlier trim; the
// surface is log10(mcap) = 2.73 + 0.61 x log10(TVL) - 0.04 x log10(age+1) + 0.86 x
// ln(1+change_7d) - 0.11 x log10(chains), R2 0.358, with unknown ages imputed at the
// comparables' median of 1,018.5 days. Age enters near zero now — the one-year guess it
// replaced had been inflating the age effect — growth enters positive, and chain breadth
// enters negative: TVL spread thin across many chains prices lower per dollar than TVL
// concentrated on one. The five-fold report card is a median error of 72.1% with 40.6%
// within 2x; on the same 98 protocols radar-4 was tested on, the figures are 74.0% and
// 39.8% against radar-4's 78.2% and 34.7%. The fit is still a rough guide, which is why
// every row shows its range, not just its centre. Five of the top ten are risk curators,
// as they were under radar-4: the five largest pre-token treasuries are risk curators,
// and the category's factor is only 1.36x from a single priced protocol — the ranking
// follows the TVL, not the factor, and no honest shrinkage moves it.

/** One protocol entry: exactly the ten fields the sealed snapshot carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the page recomputes them. */
export interface ModelConstants {
  trim_lo: number;
  trim_hi: number;
  shrink_prior: number;
  multiple_min: number;
  multiple_max: number;
  unknown_age_days: number;
  growth_floor: number;
  growth_cap: number;
  band_quantile: number;
  backtest_folds: number;
}

export const MODEL: ModelConstants = {
  trim_lo: 0.03,
  trim_hi: 7,
  shrink_prior: 5,
  multiple_min: 0.25,
  multiple_max: 4,
  unknown_age_days: 365,
  growth_floor: -60,
  growth_cap: 60,
  band_quantile: 0.25,
  backtest_folds: 5,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-5';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** The fitted surface: log10(market cap) on log10(TVL), log10(age+1), 7-day change and chain breadth. */
export interface CurveFit {
  intercept: number;
  elasticity: number;
  age_coef: number;
  growth_coef: number;
  chains_coef: number;
  mean_log_tvl: number;
  mean_log_age: number;
  mean_log_chains: number;
  age_imputed_days: number;
  r2: number;
  n: number;
  residual_sd: number;
  band_lo: number;
  band_hi: number;
}

/** One category's factor: its mean log residual from the curve, shrunk toward no effect. */
export interface CategoryFactor {
  category: string;
  live_protocols: number;
  residual_mean: number | null;
  multiplier: number;
}

/** The five-fold cross-check: the model's out-of-sample report card. */
export interface Backtest {
  folds: number;
  n: number;
  median_abs_pct_error: number;
  within_2x: number;
}

/** The coverage accounting: every protocol in the snapshot lands in exactly one bucket. */
export interface Coverage {
  total: number;
  pre_token: number;
  ranked: number;
  token_on_record: number;
  set_aside: number;
  comparables: number;
  outliers: number;
}

/** One priced protocol plotted on the fit chart: its TVL, its market cap, and the model's prediction of it. */
export interface ScatterPoint {
  tvl_usd: number;
  mcap_usd: number;
  predicted_usd: number;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  mechanism: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  implied_lo_usd: number;
  implied_hi_usd: number;
  model: {
    fit_value: number;
    category_multiplier: number;
    age_multiplier: number;
    growth_multiplier: number;
    chains_multiplier: number;
    multiple: number;
    age_days: number | null;
  };
  farm: {
    ticket_usd: number;
    setup_minutes: number;
    hold_days: number;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with its farm plan derived in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  mechanism: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  implied_lo_usd: number;
  implied_hi_usd: number;
  multiple: number;
  fit_value: number;
  category_multiplier: number;
  age_multiplier: number;
  growth_multiplier: number;
  chains_multiplier: number;
  farm_ticket_usd: number;
  setup_minutes: number;
  hold_days: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One row of the top-ten category mix: how many of the top ten rows a category holds. */
export interface ConcentrationRow {
  category: string;
  top10_rows: number;
}

/** Everything the dashboard needs: the board, the live set, the fit, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  total_implied_usd: number;
  median_multiple: number;
  fit: CurveFit;
  categories: CategoryFactor[];
  backtest: Backtest;
  coverage: Coverage;
  scatter: ScatterPoint[];
  concentration: ConcentrationRow[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a sorted array, or null when it is empty. */
function medianOf(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The q-th quantile of a sorted array by linear interpolation, or null when it is empty. */
function quantileOf(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0]!;
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** Clamp `n` into [`lo`, `hi`]. */
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** A whole-day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** One ordinary least-squares fit of y on x, with its residuals and R squared. */
export function ols(xs: number[], ys: number[]): { intercept: number; slope: number; r2: number; residuals: number[] } {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) * (xs[i]! - mx);
    syy += (ys[i]! - my) * (ys[i]! - my);
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = sxx === 0 || syy === 0 ? 0 : (sxy * sxy) / (sxx * syy);
  const residuals = ys.map((y, i) => y - (intercept + slope * xs[i]!));
  return { intercept, slope, r2, residuals };
}

/** Solve a small square system by Gaussian elimination with partial pivoting. */
function solveLinear(matrix: number[][], vector: number[]): number[] {
  const n = vector.length;
  const a = matrix.map((row, i) => [...row, vector[i]!]);
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r]![c]!) > Math.abs(a[pivot]![c]!)) pivot = r;
    [a[c], a[pivot]] = [a[pivot]!, a[c]!];
    if (Math.abs(a[c]![c]!) < 1e-12) throw new SnapshotError('the fit is singular: the snapshot cannot price a surface');
    for (let r = c + 1; r < n; r++) {
      const f = a[r]![c]! / a[c]![c]!;
      for (let j = c; j <= n; j++) a[r]![j]! -= f * a[c]![j]!;
    }
  }
  const out = new Array<number>(n).fill(0);
  for (let c = n - 1; c >= 0; c--) {
    let s = a[c]![n]!;
    for (let j = c + 1; j < n; j++) s -= a[c]![j]! * out[j]!;
    out[c] = s / a[c]![c]!;
  }
  return out;
}

/** One multiple regression by the normal equations: beta solves (X'X) beta = X'y. */
export function olsMulti(rows: number[][], ys: number[]): number[] {
  const k = rows[0]!.length;
  const xtx: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const xty = new Array<number>(k).fill(0);
  for (let i = 0; i < rows.length; i++) {
    for (let a = 0; a < k; a++) {
      xty[a]! += rows[i]![a]! * ys[i]!;
      for (let b = 0; b < k; b++) xtx[a]![b]! += rows[i]![a]! * rows[i]![b]!;
    }
  }
  return solveLinear(xtx, xty);
}

/** A protocol's age feature: log10(age in days + 1), the fit's imputed age when the listing date is unknown. */
export function logAgeOf(age: number | null, imputedDays: number): number {
  return Math.log10((age ?? imputedDays) + 1);
}

/** A protocol's chain-breadth feature: log10 of the chains it names, at least one. */
export function logChainsOf(p: SnapshotProtocol): number {
  return Math.log10(Math.max(1, p.chains.length));
}

/**
 * The age to impute for a protocol with no listing date: the median known age among the
 * protocols the fit learns from. A fixed guess would sit far from the typical protocol —
 * on this snapshot the median known age is about three years, not one — and the median
 * is computed from the fit's own set on every run, so a fold's imputation never leaks
 * the held-out fold's ages. When no protocol in the set carries a date at all, the
 * model's fallback applies.
 */
export function medianKnownAge(live: SnapshotProtocol[], asOf: string, model: ModelConstants = MODEL): number {
  const known = live
    .map((p) => ageDays(asOf, p.listed_at))
    .filter((a): a is number => a !== null)
    .sort((a, b) => a - b);
  return medianOf(known) ?? model.unknown_age_days;
}

/** A protocol's growth feature: log(1 + growth), because growth is multiplicative. */
export function growthOf(change7d: number | null, model: ModelConstants = MODEL): number {
  return Math.log1p(clamp(finite(change7d, 0), model.growth_floor, model.growth_cap) / 100);
}

/** One protocol's four features, in the order the fit reads them. */
export function featuresOf(p: SnapshotProtocol, asOf: string, ageImputedDays: number, model: ModelConstants = MODEL): [number, number, number, number] {
  return [Math.log10(p.tvl_usd), logAgeOf(ageDays(asOf, p.listed_at), ageImputedDays), growthOf(p.change_7d, model), logChainsOf(p)];
}

/** One live protocol's market-cap / TVL ratio: what the market pays per dollar of TVL. */
function ratioOf(p: SnapshotProtocol): number {
  return (p.mcap_usd ?? 0) / p.tvl_usd;
}

/**
 * The protocols the curve learns from: live-token, positive TVL, not an exchange token, and
 * with a market-cap / TVL ratio inside the model's trim. A token the market values at more
 * than seven times its TVL, or at less than three per cent of it, is an outlier the curve
 * cannot price; it is set aside and counted on the page, never silently dropped. The trim
 * is set where the cross-check says it helps: wider, two collapsed-cap tokens drag the
 * surface; tighter, the fit loses the protocols it needs.
 */
export function calibrationSet(snapshot: Snapshot, model: ModelConstants = MODEL): SnapshotProtocol[] {
  return snapshot.protocols.filter(
    (p) =>
      p.mcap_usd !== null &&
      p.mcap_usd > 0 &&
      p.tvl_usd > 0 &&
      p.category !== 'CEX' &&
      ratioOf(p) >= model.trim_lo &&
      ratioOf(p) <= model.trim_hi,
  );
}

/** The priced protocols the trim sets aside: live, but too far from TVL for the curve. */
export function outlierSet(snapshot: Snapshot, model: ModelConstants = MODEL): SnapshotProtocol[] {
  return snapshot.protocols.filter(
    (p) =>
      p.mcap_usd !== null &&
      p.mcap_usd > 0 &&
      p.tvl_usd > 0 &&
      p.category !== 'CEX' &&
      (ratioOf(p) < model.trim_lo || ratioOf(p) > model.trim_hi),
  );
}

/** The surface fitted on a set of priced protocols: log10(market cap) on TVL, age, growth and chain breadth. */
export function fitCurve(
  live: SnapshotProtocol[],
  asOf: string,
  model: ModelConstants = MODEL,
): {
  intercept: number;
  elasticity: number;
  age_coef: number;
  growth_coef: number;
  chains_coef: number;
  mean_log_tvl: number;
  mean_log_age: number;
  mean_log_chains: number;
  age_imputed_days: number;
  r2: number;
  n: number;
  residual_sd: number;
  residuals: number[];
} {
  const ageImputedDays = medianKnownAge(live, asOf, model);
  const xs = live.map((p) => featuresOf(p, asOf, ageImputedDays, model));
  const ys = live.map((p) => Math.log10(p.mcap_usd!));
  const meanLogTvl = xs.reduce((s, x) => s + x[0], 0) / xs.length;
  const meanLogAge = xs.reduce((s, x) => s + x[1], 0) / xs.length;
  const meanLogChains = xs.reduce((s, x) => s + x[3], 0) / xs.length;
  const beta = olsMulti(
    xs.map((x) => [1, x[0], x[1], x[2], x[3]]),
    ys,
  );
  const n = live.length;
  const residuals = ys.map((y, i) => y - (beta[0]! + beta[1]! * xs[i]![0] + beta[2]! * xs[i]![1] + beta[3]! * xs[i]![2] + beta[4]! * xs[i]![3]));
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const ssTot = ys.reduce((s, y) => s + (y - my) * (y - my), 0);
  const ssRes = residuals.reduce((s, r) => s + r * r, 0);
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
  const residualSd = n > 5 ? Math.sqrt(ssRes / (n - 5)) : 0;
  return {
    intercept: beta[0]!,
    elasticity: beta[1]!,
    age_coef: beta[2]!,
    growth_coef: beta[3]!,
    chains_coef: beta[4]!,
    mean_log_tvl: meanLogTvl,
    mean_log_age: meanLogAge,
    mean_log_chains: meanLogChains,
    age_imputed_days: ageImputedDays,
    r2,
    n,
    residual_sd: residualSd,
    residuals,
  };
}

/** One category's mean log residual from the curve, with its protocol count. */
function residualsByCategory(live: SnapshotProtocol[], residuals: number[]): Map<string, { n: number; mean: number }> {
  const sums = new Map<string, { n: number; sum: number }>();
  live.forEach((p, i) => {
    const key = p.category ?? 'Other';
    const entry = sums.get(key);
    if (entry === undefined) sums.set(key, { n: 1, sum: residuals[i]! });
    else {
      entry.n += 1;
      entry.sum += residuals[i]!;
    }
  });
  const out = new Map<string, { n: number; mean: number }>();
  for (const [key, entry] of sums) out.set(key, { n: entry.n, mean: entry.sum / entry.n });
  return out;
}

/**
 * Shrink one category's mean log residual toward zero with a prior of `prior` protocols,
 * then read the multiplier off it and clamp it. A category with no priced protocol at all
 * takes a multiplier of 1: the curve alone prices it.
 */
function shrunkMultiplier(mean: number | null, n: number, model: ModelConstants): number {
  if (mean === null) return 1;
  const shrunk = (n * mean) / (n + model.shrink_prior);
  return clamp(Math.pow(10, shrunk), model.multiple_min, model.multiple_max);
}

/** A category's factor row: its mean residual and the multiplier the model applies. */
export function categoryFactors(live: SnapshotProtocol[], fit: { residuals: number[] }, model: ModelConstants = MODEL): CategoryFactor[] {
  const byCategory = residualsByCategory(live, fit.residuals);
  return [...byCategory.entries()]
    .map(([category, entry]) => ({
      category,
      live_protocols: entry.n,
      residual_mean: entry.mean,
      multiplier: shrunkMultiplier(entry.mean, entry.n, model),
    }))
    .sort((a, b) => b.multiplier - a.multiplier || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
}

/** The fitted surface plus the category factors it was fitted with: everything predict needs. */
export interface ModelContext {
  fit: { intercept: number; elasticity: number; age_coef: number; growth_coef: number; chains_coef: number; mean_log_age: number; mean_log_chains: number; age_imputed_days: number };
  factors: Map<string, { n: number; mean: number }>;
  asOf: string;
}

/** The context a set of priced protocols yields: its surface and its category factors. */
export function buildContext(live: SnapshotProtocol[], asOf: string, model: ModelConstants = MODEL): ModelContext {
  const fit = fitCurve(live, asOf, model);
  return {
    fit: { intercept: fit.intercept, elasticity: fit.elasticity, age_coef: fit.age_coef, growth_coef: fit.growth_coef, chains_coef: fit.chains_coef, mean_log_age: fit.mean_log_age, mean_log_chains: fit.mean_log_chains, age_imputed_days: fit.age_imputed_days },
    factors: residualsByCategory(live, fit.residuals),
    asOf,
  };
}

/** A category's multiplier under a context, or 1 when the category has no priced protocol. */
function multiplierFor(category: string | null, ctx: ModelContext, model: ModelConstants): number {
  const entry = ctx.factors.get(category ?? 'Other');
  if (entry === undefined) return 1;
  return shrunkMultiplier(entry.mean, entry.n, model);
}

/** Every factor of one protocol's implied value under a context. */
export function impliedValue(
  protocol: SnapshotProtocol,
  ctx: ModelContext,
  model: ModelConstants = MODEL,
): { implied: number; fitValue: number; categoryMultiplier: number; ageMultiplier: number; growthMultiplier: number; chainsMultiplier: number; multiple: number; age: number | null } {
  const age = ageDays(ctx.asOf, protocol.listed_at);
  const logTvl = Math.log10(protocol.tvl_usd);
  const logAge = logAgeOf(age, ctx.fit.age_imputed_days);
  const growth = growthOf(protocol.change_7d, model);
  const logChains = logChainsOf(protocol);
  // The curve value is the surface at this TVL, at the comparables' mean age, mean chain
  // breadth and zero growth; the age, growth and chains factors are the fitted moves away
  // from that centre, so each reads 1.0 for a typical protocol and their product with the
  // curve value is exactly the fitted surface.
  const fitValue = Math.pow(10, ctx.fit.intercept + ctx.fit.elasticity * logTvl + ctx.fit.age_coef * ctx.fit.mean_log_age + ctx.fit.chains_coef * ctx.fit.mean_log_chains);
  const ageMultiplier = Math.pow(10, ctx.fit.age_coef * (logAge - ctx.fit.mean_log_age));
  const growthMultiplier = Math.pow(10, ctx.fit.growth_coef * growth);
  const chainsMultiplier = Math.pow(10, ctx.fit.chains_coef * (logChains - ctx.fit.mean_log_chains));
  const categoryMultiplier = multiplierFor(protocol.category, ctx, model);
  const implied = Math.max(1, Math.round(fitValue * ageMultiplier * growthMultiplier * chainsMultiplier * categoryMultiplier));
  return { implied, fitValue, categoryMultiplier, ageMultiplier, growthMultiplier, chainsMultiplier, multiple: implied / protocol.tvl_usd, age };
}

/**
 * The uncertainty band: the quartiles of actual market cap over the model's prediction across
 * the priced protocols, so half of them land inside [lo, hi]. The band is a property of the
 * model, not of any one row: every row's range is its centre times the same two factors.
 */
export function uncertaintyBand(live: SnapshotProtocol[], ctx: ModelContext, model: ModelConstants = MODEL): { lo: number; hi: number } {
  const ratios = live
    .map((p) => {
      const predicted = impliedValue(p, ctx, model).implied;
      return (p.mcap_usd ?? 0) / Math.max(1, predicted);
    })
    .sort((a, b) => a - b);
  const lo = quantileOf(ratios, model.band_quantile) ?? 0.5;
  const hi = quantileOf(ratios, 1 - model.band_quantile) ?? 2;
  return { lo, hi };
}

/**
 * The five-fold cross-check: the comparables, sorted by slug, split into five folds by
 * index; each fold's model is fitted on the other four and tested on the fold. The median
 * absolute percentage error and the share of predictions within 2x are the model's
 * out-of-sample report card — the number the page prints, because an in-sample error
 * would flatter a model fitted on the same protocols it is tested on.
 */
export function backtest(live: SnapshotProtocol[], asOf: string, model: ModelConstants = MODEL): Backtest {
  const folds = model.backtest_folds;
  const sorted = [...live].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const errors: number[] = [];
  const within: boolean[] = [];
  for (let fold = 0; fold < folds; fold++) {
    const train = sorted.filter((_, i) => i % folds !== fold);
    const test = sorted.filter((_, i) => i % folds === fold);
    const ctx = buildContext(train, asOf);
    for (const p of test) {
      const predicted = impliedValue(p, ctx, model).implied;
      const actual = p.mcap_usd ?? 0;
      errors.push(Math.abs(predicted - actual) / Math.max(1, actual));
      const ratio = predicted / Math.max(1, actual);
      within.push(ratio >= 0.5 && ratio <= 2);
    }
  }
  errors.sort((a, b) => a - b);
  const median = medianOf(errors) ?? 1;
  return {
    folds,
    n: sorted.length,
    median_abs_pct_error: median * 100,
    within_2x: within.length === 0 ? 0 : within.filter(Boolean).length / within.length,
  };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories the watchlist rule keeps out: wrapped, staked, bridged and exchange products. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** A name beginning with an exchange's name is that exchange's product, not a protocol. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** A whole word wrapped, staked or staking in the name marks a wrapped or staked product. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Why a protocol is not rankable, or null when it is: the watchlist rule's exclusions,
 * applied to every row of the board, not just to the watchlist. A wrapped or staked
 * product of a token that already trades is somebody else's product; the radar ranks
 * protocols, not wrappers.
 */
export function exclusionReason(p: SnapshotProtocol): string | null {
  if (!isPreToken(p)) return 'token on record';
  if (EXCLUDED_CATEGORIES.has(p.category ?? '')) return `category ${p.category}`;
  if (VERSIONED.test(p.name)) return 'versioned name';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped or staked product';
  if (EXCHANGE_PREFIX.test(p.name)) return 'exchange product';
  return null;
}

/** Whether a protocol is one the board may rank: pre-token and nobody else's product. */
export function isRankable(p: SnapshotProtocol): boolean {
  return exclusionReason(p) === null;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** One scored protocol: its value, its band, and the factors that produced it. */
type ScoredProtocol = ReturnType<typeof impliedValue> & { p: SnapshotProtocol; lo: number; hi: number };

/** Every chosen protocol scored and sorted strongest first, ties broken by slug. */
function scoreChosen(
  chosen: Map<string, SnapshotProtocol>,
  ctx: ModelContext,
  band: { lo: number; hi: number },
  model: ModelConstants,
): ScoredProtocol[] {
  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, ctx, model);
    return { p, ...v, lo: Math.max(1, Math.round(v.implied * band.lo)), hi: Math.max(v.implied, Math.round(v.implied * band.hi)) };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const live = calibrationSet(snapshot, model);
  const ctx = buildContext(live, snapshot.as_of);
  const band = uncertaintyBand(live, ctx, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot,
  // but the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable pre-token protocol, so the board is the whole field
  // the radar exists to find. Never a replacement for a watchlist row: a chosen protocol stays
  // chosen, and a protocol the exclusion rules set aside never enters.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  const scored = scoreChosen(chosen, ctx, band, model);
  return scored.map(toBoardRow);
}

/** One scored protocol as a board row: its rank, its figures, its band and its farm plan. */
function toBoardRow(s: ScoredProtocol, i: number): BoardRow {
  const mechanism = mechanismFor(s.p);
  const farm = farmSummary(s.p, mechanism, s.age);
  return {
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    mechanism: mechanism.label,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    implied_lo_usd: s.lo,
    implied_hi_usd: s.hi,
    model: {
      fit_value: Math.round(s.fitValue),
      category_multiplier: round4(s.categoryMultiplier),
      age_multiplier: round4(s.ageMultiplier),
      growth_multiplier: round4(s.growthMultiplier),
      chains_multiplier: round4(s.chainsMultiplier),
      multiple: round4(s.multiple),
      age_days: s.age,
    },
    farm,
    farm_steps: farmSteps(s.p, s.age, mechanism, { lo: s.lo, hi: s.hi }).map(stepText),
  };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The top-ten category mix: how many of the board's first ten rows each category holds. */
export function topConcentration(board: BoardRow[]): ConcentrationRow[] {
  const counts = new Map<string, number>();
  for (const r of board.slice(0, 10)) {
    const key = r.category ?? 'Other';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([category, top10_rows]) => ({ category, top10_rows }))
    .sort((a, b) => b.top10_rows - a.top10_rows || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
}

/** One line of a side-by-side comparison: the same factor measured for two protocols. */
export interface CompareEntry {
  key: string;
  label: string;
  first: number;
  second: number;
}

/** Which side of a compared factor leads, or a tie when the two numbers match. */
export type CompareLeader = 'first' | 'second' | 'tie';

/** The leading side of one compared factor: the larger number leads, ties stay tied. */
export function compareLeader(entry: CompareEntry): CompareLeader {
  if (entry.first === entry.second) return 'tie';
  return entry.first > entry.second ? 'first' : 'second';
}

/** How much larger the leading implied value is, as a share of the smaller one. */
export function compareGap(first: number, second: number): number {
  const smaller = Math.min(first, second);
  if (smaller <= 0) return 0;
  return (Math.max(first, second) - smaller) / smaller;
}

/**
 * Two board rows side by side: every factor the model scores, in the order the detail
 * drawer shows them, ending with the implied values themselves. A missing growth
 * reading counts as zero and a missing age counts as a year for display, the same
 * fallbacks the scorer uses for the comparison table; the fit itself imputes the
 * comparables' median age, which the detail view states. The dashboard mirrors this
 * list in its own code for the rows it renders.
 */
export function compareBoardRows(first: BoardRow, second: BoardRow): CompareEntry[] {
  return [
    { key: 'tvl', label: 'Total value locked', first: first.tvl_usd, second: second.tvl_usd },
    { key: 'growth', label: 'Seven-day TVL change', first: first.change_7d ?? 0, second: second.change_7d ?? 0 },
    { key: 'age', label: 'Days with no token on record', first: first.age_days ?? 365, second: second.age_days ?? 365 },
    { key: 'chains', label: 'Chains the protocol names', first: first.chains.length, second: second.chains.length },
    { key: 'fit', label: 'Curve value', first: first.model.fit_value, second: second.model.fit_value },
    { key: 'categoryMult', label: 'Category multiplier', first: first.model.category_multiplier, second: second.model.category_multiplier },
    { key: 'ageMult', label: 'Age multiplier', first: first.model.age_multiplier, second: second.model.age_multiplier },
    { key: 'growthMult', label: 'Growth multiplier', first: first.model.growth_multiplier, second: second.model.growth_multiplier },
    { key: 'chainsMult', label: 'Chain breadth multiplier', first: first.model.chains_multiplier, second: second.model.chains_multiplier },
    { key: 'implied', label: 'Implied value', first: first.implied_value_usd, second: second.implied_value_usd },
  ];
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** What a protocol does, in the farmer's words: the mechanism its farm plan follows. */
export interface Mechanism {
  label: string;
  action: string;
  weekly: string;
  hold_days: number;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What one transaction costs on a chain, in dollars, for the farm ticket. */
function gasUsdFor(chain: string): number {
  if (chain === 'Ethereum') return 8;
  if (chain === 'Solana') return 0.1;
  if (chain === 'Bitcoin' || chain === 'Babylon Genesis' || chain === 'CORE') return 10;
  if (chain === 'Base' || chain === 'Arbitrum' || chain === 'Optimism' || chain === 'Polygon' || chain === 'Binance' || chain === 'Avalanche' || chain === 'Tron') return 0.2;
  return 1;
}

/** What one transaction costs on a chain, in the words a farmer budgets by. */
function gasFor(chain: string): string {
  const usd = gasUsdFor(chain);
  if (chain === 'Bitcoin' || chain === 'Babylon Genesis' || chain === 'CORE') return 'about $10 of bridge gas per move';
  if (usd < 1) return `about $${usd.toFixed(2)} of gas per transaction`;
  return `about $${usd} of gas per transaction`;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the mechanism and the protocol's age. */
function holdDaysFor(mechanism: Mechanism, age: number | null): number {
  if (mechanism.hold_days > 0) return mechanism.hold_days;
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The farm ticket: the capital plus the setup gas, and the time the setup takes. */
export function farmSummary(p: SnapshotProtocol, mechanism: Mechanism, age: number | null): { ticket_usd: number; setup_minutes: number; hold_days: number } {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const gas = gasUsdFor(chain);
  const bridgeChain = chain === 'Bitcoin' || chain === 'Babylon Genesis' || chain === 'CORE';
  return {
    ticket_usd: Math.round((capital + gas * 2) * 100) / 100,
    setup_minutes: bridgeChain ? 60 : 45,
    hold_days: holdDaysFor(mechanism, age),
  };
}

/**
 * The mechanism taxonomy, derived from the snapshot's own fields: a name signal first
 * (a vault, a points program), then the category. Each mechanism names its main position
 * and its weekly action, and some name their own holding period; a hold of 0 means the
 * age rule decides. No protocol name is special-cased: the rules read the category and
 * the name's words, and the same words write every plan.
 */
interface MechanismRule {
  words: string[];
  make: (name: string, capital: number, chain: string) => Mechanism;
}

const MECHANISM_RULES: MechanismRule[] = [
  { words: ['risk curator', 'onchain capital allocator'], make: (name, capital, chain) => ({ label: 'Vault curation', action: `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares while the curator allocates them.`, weekly: `Read the vault's latest curator report on ${name} and move the funds only if the strategy changed.`, hold_days: 60 }) },
  { words: ['cdp manager'], make: (name, capital, chain) => ({ label: 'Debt management', action: `Open a managed debt position of $${capital} through ${name} on ${chain} and keep it collateralised.`, weekly: `Check the position's health on ${name} and top up the collateral if it drifted near the liquidation line.`, hold_days: 45 }) },
  { words: ['cdp'], make: (name, capital, chain) => ({ label: 'Collateralised debt', action: `Lock $${capital} of collateral with ${name} on ${chain} and mint or borrow against it.`, weekly: `Borrow a small amount against the collateral on ${name}, then repay it the same week.`, hold_days: 45 }) },
  { words: ['uncollateralized lending', 'lending', 'collateral market'], make: (name, capital, chain) => ({ label: 'Lending market', action: `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`, weekly: `Borrow a small amount against the supply on ${name}, then repay it the same week.`, hold_days: 0 }) },
  { words: ['dex'], make: (name, capital, chain) => ({ label: 'DEX liquidity', action: `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`, weekly: `Swap a small amount through ${name}'s main pool on ${chain} to keep the position active.`, hold_days: 30 }) },
  { words: ['liquidity manager'], make: (name, capital, chain) => ({ label: 'Managed liquidity', action: `Deposit $${capital} into a managed pool on ${name} on ${chain} and keep the receipt.`, weekly: `Check the pool's range on ${name} and rebalance only if the price moved out of it.`, hold_days: 30 }) },
  { words: ['restaking', 'staking pool'], make: (name, capital, chain) => ({ label: 'Restaking', action: `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt.`, weekly: `Restake the rewards ${name} paid out, instead of leaving them idle.`, hold_days: 60 }) },
  { words: ['prediction'], make: (name, capital, chain) => ({ label: 'Prediction market', action: `Fund $${capital} and place one market position on ${name} on ${chain}.`, weekly: `Settle one market on ${name} and place the next position with the winnings.`, hold_days: 30 }) },
  { words: ['rwa'], make: (name, capital, chain) => ({ label: 'Real-world yield', action: `Mint $${capital} of the protocol's yield asset on ${chain} through ${name} and hold it.`, weekly: `Check the yield ${name} paid this week and leave it compounding in the same asset.`, hold_days: 60 }) },
  { words: ['yield aggregator', 'yield', 'leveraged farm', 'farm'], make: (name, capital, chain) => ({ label: 'Yield strategy', action: `Deposit $${capital} into ${name}'s main strategy vault on ${chain} and keep the shares.`, weekly: `Harvest the strategy's rewards on ${name} and compound them back into the same vault.`, hold_days: 45 }) },
  { words: ['basis trading'], make: (name, capital, chain) => ({ label: 'Basis trading', action: `Deposit $${capital} into ${name}'s delta-neutral position on ${chain} and keep it open.`, weekly: `Check the funding rate on ${name} and exit the position only if it turned negative for a week.`, hold_days: 30 }) },
  { words: ['perpetual', 'derivative', 'interest rate derivative'], make: (name, capital, chain) => ({ label: 'Perpetuals & derivatives', action: `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small hedge.`, weekly: `Close and reopen the hedge on ${name} once, so the position shows fresh activity.`, hold_days: 30 }) },
  { words: ['stablecoin', 'dual-token stablecoin'], make: (name, capital, chain) => ({ label: 'Stablecoin minting', action: `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it.`, weekly: `Check the stable asset's peg on ${name} and use it for one payment or swap this week.`, hold_days: 45 }) },
  { words: ['anchor btc', 'decentralized btc'], make: (name, capital, chain) => ({ label: 'Bitcoin yield', action: `Bridge $${capital} of BTC through ${name} to ${chain} and deposit it in its yield position.`, weekly: `Check the BTC yield ${name} paid this week and leave it compounding in the same position.`, hold_days: 60 }) },
  { words: ['cedefi'], make: (name, capital, chain) => ({ label: 'CeDeFi yield', action: `Deposit $${capital} with ${name} on ${chain} and keep the receipt for the custodial position.`, weekly: `Check the yield ${name} paid this week and confirm the position still shows on its dashboard.`, hold_days: 45 }) },
  { words: ['chain'], make: (name, capital, chain) => ({ label: 'Chain activity', action: `Bridge $${capital} to ${name} and use it in two of the chain's own apps, keeping a balance on the chain.`, weekly: `Make one transaction on ${name} this week — a swap, a deposit or a vote — so the wallet stays active.`, hold_days: 60 }) },
  { words: ['insurance'], make: (name, capital, chain) => ({ label: 'Insurance cover', action: `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`, weekly: `Check the cover ${name} sold this week and renew it before it lapses.`, hold_days: 0 }) },
  { words: ['payment', 'crypto card'], make: (name, capital, chain) => ({ label: 'Payments', action: `Route $${capital} of spending through ${name} on ${chain} and keep the receipt.`, weekly: `Make one payment through ${name} this week so the wallet shows regular use.`, hold_days: 30 }) },
  { words: ['otc marketplace'], make: (name, capital, chain) => ({ label: 'OTC trading', action: `Place one $${capital} trade through ${name} on ${chain} and keep the settlement receipt.`, weekly: `Place one small trade through ${name} this week so the account shows fresh activity.`, hold_days: 30 }) },
  { words: ['governance incentives'], make: (name, capital, chain) => ({ label: 'Governance rewards', action: `Stake $${capital} through ${name} on ${chain} and cast one vote in its governance.`, weekly: `Vote on one proposal on ${name} this week so the stake keeps earning incentives.`, hold_days: 45 }) },
  { words: ['indexes', 'index'], make: (name, capital, chain) => ({ label: 'Index holding', action: `Buy $${capital} of the ${name} index token on ${chain} and hold it.`, weekly: `Check the index's rebalance on ${name} and hold through it unless the composition changed.`, hold_days: 45 }) },
  { words: ['bridge'], make: (name, capital, chain) => ({ label: 'Bridging', action: `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`, weekly: `Bridge a small amount back the other way through ${name} so both directions are used.`, hold_days: 30 }) },
];

/** The fallback mechanism, for a category no rule names. */
const MECHANISM_FALLBACK = (name: string, capital: number, chain: string): Mechanism => ({
  label: 'Protocol activity',
  action: `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`,
  weekly: `Make one qualifying action this week on ${name}, such as a deposit, a borrow, a swap or a vote.`,
  hold_days: 0,
});

/**
 * A protocol's mechanism: a name signal first, then the category. A name carrying the word
 * vault is a vault a curator runs; a name carrying the word points is a points program
 * farmed by quests. Everything else follows its category, first matching rule wins.
 */
export function mechanismFor(p: SnapshotProtocol): Mechanism {
  const capital = capitalFor(p);
  const chain = chainOf(p);
  const name = p.name.toLowerCase();
  if (name.includes('points')) {
    return { label: 'Points program', action: `Join ${p.name}'s points program on ${chain} with $${capital} and complete its first quest.`, weekly: `Complete one quest on ${p.name} this week and check the points landed on its leaderboard.`, hold_days: 60 };
  }
  if (name.includes('vault')) {
    return { label: 'Vault curation', action: `Deposit $${capital} into a ${p.name} vault on ${chain} and keep the shares while the curator allocates them.`, weekly: `Read the vault's latest curator report on ${p.name} and move the funds only if the strategy changed.`, hold_days: 60 };
  }
  const category = (p.category ?? '').toLowerCase();
  for (const rule of MECHANISM_RULES) {
    if (rule.words.some((w) => category.includes(w))) return rule.make(p.name, capital, chain);
  }
  return MECHANISM_FALLBACK(p.name, capital, chain);
}

/** A dollar figure in the short form a farm step budgets by. */
function fmtUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

/**
 * A protocol's farm plan: nine steps, each an action with a cost and a time. The plan is
 * derived from the protocol's own record (mechanism, chains, TVL, age, implied range),
 * never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, mechanism?: Mechanism, band?: { lo: number; hi: number }): FarmStep[] {
  const mech = mechanism ?? mechanismFor(p);
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(mech, age);
  const gas = gasFor(chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: gas,
      time: '5 minutes',
    },
    {
      text: mech.action,
      cost: `$${capital} of capital and ${gas}`,
      time: '15 minutes to set up',
    },
    {
      text: `Open ${p.name}'s own dashboard or points page and check the position shows with the right balance.`,
      cost: 'no fee to check',
      time: '10 minutes',
    },
    {
      text: mech.weekly,
      cost: gas,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text:
        band === undefined
          ? `Size the ticket against the protocol's implied range: a wide range means a wide outcome, so do not size up on the top of the range.`
          : `Size the ticket against the protocol's implied range of ${fmtUsd(band.lo)}–${fmtUsd(band.hi)}: a wide range means a wide outcome, so do not size up on the top of the range.`,
      cost: 'nothing to check',
      time: '5 minutes',
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Before you unwind, check the exit path — the pool depth, the withdrawal queue or the unstaking delay — so the position closes in one step.`,
      cost: `one exit transaction at ${gas}`,
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan derived in the page. */
export function radarRow(row: BoardRow, watchlist: Set<string>): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    mechanism: row.mechanism,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    watchlist: watchlist.has(row.slug),
    implied_value_usd: row.implied_value_usd,
    implied_lo_usd: row.implied_lo_usd,
    implied_hi_usd: row.implied_hi_usd,
    multiple: row.model.multiple,
    fit_value: row.model.fit_value,
    category_multiplier: row.model.category_multiplier,
    age_multiplier: row.model.age_multiplier,
    growth_multiplier: row.model.growth_multiplier,
    chains_multiplier: row.model.chains_multiplier,
    farm_ticket_usd: row.farm.ticket_usd,
    setup_minutes: row.farm.setup_minutes,
    hold_days: row.farm.hold_days,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = calibrationSet(snapshot, model);
  const outliers = outlierSet(snapshot, model);
  const fit = fitCurve(live, snapshot.as_of, model);
  const ctx = buildContext(live, snapshot.as_of, model);
  const band = uncertaintyBand(live, ctx, model);
  const factors = categoryFactors(live, fit, model);
  const test = backtest(live, snapshot.as_of, model);
  const liveView = liveRows(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watchlist.has(r.slug)).length;
  const totalImplied = board.reduce((s, r) => s + r.implied_value_usd, 0);
  const multiples = board.map((r) => r.model.multiple).sort((a, b) => a - b);
  const preToken = snapshot.protocols.filter(isPreToken).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: liveView.length,
    total_implied_usd: totalImplied,
    median_multiple: medianOf(multiples) ?? 0,
    fit: {
      intercept: fit.intercept,
      elasticity: fit.elasticity,
      age_coef: fit.age_coef,
      growth_coef: fit.growth_coef,
      chains_coef: fit.chains_coef,
      mean_log_tvl: fit.mean_log_tvl,
      mean_log_age: fit.mean_log_age,
      mean_log_chains: fit.mean_log_chains,
      age_imputed_days: fit.age_imputed_days,
      r2: fit.r2,
      n: fit.n,
      residual_sd: fit.residual_sd,
      band_lo: band.lo,
      band_hi: band.hi,
    },
    categories: factors,
    backtest: test,
    coverage: {
      total: snapshot.protocols.length,
      pre_token: preToken,
      ranked: board.length,
      token_on_record: snapshot.protocols.length - preToken,
      set_aside: preToken - board.length,
      comparables: live.length,
      outliers: outliers.length,
    },
    scatter: live.map((p) => ({ tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd ?? 0, predicted_usd: impliedValue(p, ctx, model).implied })),
    concentration: topConcentration(board),
    rows: board.map((r) => radarRow(r, watchlist)),
    live: liveView,
  };
  return { board, radar };
}

/** One JSON value as a string, or null when it is absent or not a string. */
function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** One JSON value as a finite number, or null when it is absent or not a finite number. */
function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** One JSON value as a list of strings, dropping anything that is not a string. */
function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((c): c is string => typeof c === 'string') : [];
}

/**
 * One protocol out of a JSON value, refused unless it carries the fields the model scores.
 * A missing or mistyped optional field reads as null (no record) rather than as zero: the
 * model must never invent a market cap, a listing date or a token symbol the snapshot
 * does not carry.
 */
function parseProtocol(v: unknown, i: number): SnapshotProtocol {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
  const p = v as Record<string, unknown>;
  if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
    throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
  }
  return {
    slug: p.slug,
    name: p.name,
    category: asString(p.category),
    chains: asStringList(p.chains),
    tvl_usd: p.tvl_usd,
    change_7d: asNumber(p.change_7d),
    mcap_usd: asNumber(p.mcap_usd),
    listed_at: asString(p.listed_at),
    gecko_id: asString(p.gecko_id),
    symbol: asString(p.symbol),
  };
}

/** The snapshot document's shape, refused unless it carries the fields the model scores. */
function checkSnapshotShape(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  if (new Set(o.watchlist as string[]).size !== (o.watchlist as string[]).length) throw new SnapshotError('snapshot.json lists a watchlist slug twice');
  return o;
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  const o = checkSnapshotShape(raw);
  const protocols = o.protocols.map(parseProtocol);
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const unknown = board.filter((r) => !known.has(r.slug)).map((r) => r.slug);
  if (unknown.length > 0) return `the board ranks ${unknown.length} slug${unknown.length === 1 ? '' : 's'} the snapshot does not carry: ${unknown.slice(0, 5).join(', ')}`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
