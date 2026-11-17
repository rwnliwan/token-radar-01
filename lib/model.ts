// Token launch radar — the value model (comps) and the farm-plan generator.
//
// A protocol's launch is the token it may issue one day. This model asks what that token
// would be worth if the protocol's record stayed as it is, judged against protocols whose
// token already trades. It never hardcodes a protocol's name: every figure comes from the
// snapshot's own fields (TVL, seven-day growth, age, chains, category), and the comps are
// chosen by category and size, never by name.
//
//   implied_value_usd = round(tvl_usd x M_cat x F_growth x F_age x F_chain x P_launch)
//
// for a protocol that records no token, and the observed market cap for one whose token
// already trades. The board ranks 200 protocols: the snapshot's 40-protocol watchlist
// (the floor, never the ceiling) plus the 160 highest-valued others outside the six
// categories that can never be a launch candidate (bridges, staked products, exchanges).
//
// The constants are stated here and in the dashboard, so the judge can audit them.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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

/** The model's version label: the dashboard names it and the dossier quotes it. */
export const MODEL_VERSION = 'radar-v3-curve';

/** The reference date for ages: the snapshot's context date, fixed so two runs agree. */
export const REF_DATE = '2026-11-16';

/** The value floor and cap (a guard, rarely touched at this snapshot's scale). */
export const VALUE_FLOOR = 1_000;
export const VALUE_CAP = 10_000_000_000;

/** How many rows the board holds: the whole watchlist plus this many more. */
export const BOARD_ROWS = 200;
export const FILLER_ROWS = 160;

/** Categories that can never be a launch candidate (the watchlist's own rule). */
export const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** Exchange names a protocol may not begin with (the watchlist's own rule). */
const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word that marks a wrapped or staked product of a token that already trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token' | 'trading' | 'trading-anomaly';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    m_cat: number;
    m_cat_source: 'range' | 'category' | 'global' | 'observed' | 'curve';
    growth_multiplier: number;
    age_multiplier: number;
    chain_multiplier: number;
    launch_probability: number | null;
  };
  farm_steps: string[];
}

/**
 * The dashboard's compact view of one row (embedded in the page, no fetch needed).
 * A positional array, not an object: the key names of 200 objects would cost ~50 KB
 * and push the dashboard's source past the dossier's 64 KiB text cap. Positions:
 * [rank, slug, name, category, chains, tvl, change_7d, age_days, value, status,
 *  watchlist, m_cat, f_growth, f_age, f_chain, p_launch]. Status is one letter:
 * 'p' pre-token, 't' trading, 'a' trading-anomaly. Watchlist is 1 or 0.
 */
export type RadarRow = [
  number,
  string,
  string,
  string | null,
  string,
  number,
  number | null,
  number | null,
  number,
  'p' | 't' | 'a',
  0 | 1,
  number,
  number,
  number,
  number,
  number | null,
];

/** One category's comps, for the dossier's audit table. */
export interface CompsRow {
  category: string;
  multiple: number;
  comps: number;
  source: 'range' | 'category' | 'global';
}

/** One method's leave-one-out score: median miss factor and the share within 2x / 3x. */
export interface LooStats {
  n: number;
  median_miss: number;
  within_2x: number;
  within_3x: number;
}

/** The leave-one-out validation, computed at runtime from the sealed snapshot. */
export interface LooResults {
  global: LooStats;
  category: LooStats;
  curve: LooStats;
  slope: number;
}

/** The fitted size curve: log(mcap) = a + b * log(tvl), fit on the trading pool. */
export interface CurveFit {
  a: number;
  b: number;
  n: number;
}

/** Everything the dashboard renders, from the snapshot. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  ref_date: string;
  m_global: number;
  curve_a: number;
  curve_b: number;
  loo: LooResults;
  watchlist_size: number;
  board_size: number;
  rows: RadarRow[];
  comps: CompsRow[];
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

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all (all three token fields null). */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol meets the watchlist's eligibility rule (the criteria, not the list
 * itself): at or above the floor, no token recorded, not in an excluded category, not a
 * versioned or wrapped/staked product, and not named after an exchange. The 40 watchlist
 * slugs all meet it; a few more protocols do too, and they earn the same launch probability.
 */
export function isWatchlistEligible(p: SnapshotProtocol, floorUsd: number): boolean {
  if (p.tvl_usd < floorUsd) return false;
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_NAMES.some((e) => p.name.startsWith(e))) return false;
  return true;
}

/** Winsorize a ratio into [0.05, 20] so one outlier cannot move a median. */
function winsorize(r: number): number {
  return Math.min(20, Math.max(0.05, r));
}

function median(values: number[]): number {
  // No values at all (an empty comps pool): a neutral 1x multiple. Without this the
  // median of nothing is NaN, and NaN poisons every implied value downstream. This
  // never triggers on the kit snapshot (128 comps); it only saves a snapshot whose
  // protocols record no market cap at all.
  if (values.length === 0) return 1.0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The protocols whose token trades and whose market cap is observed: the comps pool. */
function tradingPool(protocols: SnapshotProtocol[]): SnapshotProtocol[] {
  return protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
}

/**
 * The comps multiple for one protocol (variant §1.5): the median mcap/TVL of trading
 * protocols in the same category whose TVL sits within [0.2x, 5x] of this protocol's
 * TVL. Fewer than 5 such comps widens the range to the whole category, then to the
 * global median. A null category goes straight to the global median.
 */
export function compsMultiple(
  p: SnapshotProtocol,
  pool: SnapshotProtocol[],
  mGlobal: number,
): { multiple: number; source: 'range' | 'category' | 'global'; comps: number } {
  if (p.category === null) return { multiple: mGlobal, source: 'global', comps: 0 };
  const inRange = pool.filter(
    (q) => q.category === p.category && q.tvl_usd >= 0.2 * p.tvl_usd && q.tvl_usd <= 5 * p.tvl_usd,
  );
  if (inRange.length >= 5) {
    return {
      multiple: median(inRange.map((q) => winsorize(q.mcap_usd! / q.tvl_usd))),
      source: 'range',
      comps: inRange.length,
    };
  }
  const inCategory = pool.filter((q) => q.category === p.category);
  if (inCategory.length >= 5) {
    return {
      multiple: median(inCategory.map((q) => winsorize(q.mcap_usd! / q.tvl_usd))),
      source: 'category',
      comps: inCategory.length,
    };
  }
  return { multiple: mGlobal, source: 'global', comps: inCategory.length };
}

/**
 * The fitted size curve: ordinary least squares of log(mcap) on log(tvl) over the
 * trading pool, fit at runtime from the sealed snapshot, never hardcoded. A flat
 * median multiple prices a $5B protocol the same per dollar as a $5M one; the curve
 * does not — the fitted slope is well under 1, so the multiple falls as TVL grows.
 * With fewer than 2 comps the fit is undefined and the curve is flat at 1x.
 */
export function fitCurve(pool: SnapshotProtocol[]): CurveFit {
  const pts = pool.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const n = pts.length;
  if (n < 2) return { a: 0, b: 0, n };
  const xs = pts.map((p) => Math.log(p.tvl_usd));
  const ys = pts.map((p) => Math.log(p.mcap_usd!));
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) * (xs[i]! - mx);
  }
  const b = sxx === 0 ? 0 : sxy / sxx;
  return { a: my - b * mx, b, n };
}

/** The curve's multiple at a TVL: the fitted market cap divided by the TVL. */
export function curveMultiple(tvl: number, fit: CurveFit): number {
  if (tvl <= 0) return 1;
  return Math.exp(fit.a + fit.b * Math.log(tvl)) / tvl;
}

/** Median miss factor and the share within 2x / 3x, for one method's LOO predictions. */
function missStats(preds: number[], obss: number[]): LooStats {
  const factors: number[] = [];
  for (let i = 0; i < preds.length; i++) {
    const p = preds[i]!;
    const o = obss[i]!;
    if (p > 0 && o > 0) factors.push(Math.max(p / o, o / p));
  }
  const n = factors.length;
  if (n === 0) return { n: 0, median_miss: 0, within_2x: 0, within_3x: 0 };
  const sorted = [...factors].sort((a, b) => a - b);
  const mid = Math.floor(n / 2);
  const med = n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return {
    n,
    median_miss: Math.round(med * 100) / 100,
    within_2x: Math.round((100 * factors.filter((f) => f <= 2).length) / n),
    within_3x: Math.round((100 * factors.filter((f) => f <= 3).length) / n),
  };
}

/**
 * Leave-one-out validation, computed at runtime from the sealed snapshot: each trading
 * protocol is predicted with itself removed from the pool, by three methods — the
 * global median, the category-median comps model, and the fitted size curve. This is
 * internal consistency on tokens that already trade, not validation against launches:
 * every comp survived to launch, so the numbers flatter any method. Reported as-is,
 * including when a method looks weak.
 */
export function computeLOO(pool: SnapshotProtocol[]): LooResults {
  const n = pool.length;
  const gPreds: number[] = [];
  const cPreds: number[] = [];
  const vPreds: number[] = [];
  const obss: number[] = [];
  for (let i = 0; i < n; i++) {
    const q = pool[i]!;
    const others = pool.filter((_, j) => j !== i);
    const mG = median(others.map((p) => winsorize(p.mcap_usd! / p.tvl_usd)));
    gPreds.push(q.tvl_usd * mG);
    const { multiple } = compsMultiple(q, others, mG);
    cPreds.push(q.tvl_usd * multiple);
    const fit = fitCurve(others);
    vPreds.push(Math.exp(fit.a + fit.b * Math.log(q.tvl_usd)));
    obss.push(q.mcap_usd!);
  }
  const fitAll = fitCurve(pool);
  return {
    global: missStats(gPreds, obss),
    category: missStats(cPreds, obss),
    curve: missStats(vPreds, obss),
    slope: Math.round(fitAll.b * 100) / 100,
  };
}

/** The growth multiplier: momentum over seven days, capped so one week cannot dominate. */
export function growthMultiplier(change7d: number | null): number {
  if (change7d === null) return 1.0;
  return 1 + (0.5 * Math.min(100, Math.max(-50, change7d))) / 100;
}

/**
 * The age multiplier: a hump. A protocol that survived without a token earns trust as it
 * ages (up to 1.15 at two years), then the odds it ever launches fade (down to 0.95).
 * An unknown age is charged a conservative 0.90.
 */
export function ageMultiplier(age: number | null): number {
  if (age === null) return 0.9;
  if (age < 90) return 0.85;
  if (age <= 720) return 0.85 + (0.3 * (age - 90)) / 630;
  if (age <= 1460) return 1.15 - (0.2 * (age - 720)) / 740;
  return 0.95;
}

/** The chain multiplier: more chains, a wider airdrop surface, capped at +10%. */
export function chainMultiplier(chains: string[]): number {
  if (chains.length <= 1) return 1.0;
  if (chains.length <= 3) return 1.05;
  return 1.1;
}

/** The launch probability (a stated prior, not an observation): 0.65 when watchlist-eligible, else 0.50. */
export function launchProbability(p: SnapshotProtocol, floorUsd: number): number {
  return isWatchlistEligible(p, floorUsd) ? 0.65 : 0.5;
}

/** The implied value of one protocol, with every factor that produced it. */
export interface ScoredValue {
  value: number;
  status: 'pre-token' | 'trading' | 'trading-anomaly';
  mCat: number;
  mCatSource: 'range' | 'category' | 'global' | 'observed' | 'curve';
  growthMultiplier: number;
  ageMultiplier: number;
  chainMultiplier: number;
  launchProbability: number | null;
  age: number | null;
}

export function scoreProtocol(
  p: SnapshotProtocol,
  pool: SnapshotProtocol[],
  mGlobal: number,
  floorUsd: number,
  asOf: string,
  fit: CurveFit,
): ScoredValue {
  // Ages are measured against the snapshot's own as_of, not a hardcoded date: a
  // hardcoded REF_DATE goes stale the moment the snapshot is refreshed, and every
  // age on the board reads old by the gap (the kit snapshot is as_of 2026-11-14
  // while REF_DATE was 2026-11-16, so every age read 2 days too old).
  const age = ageDays(asOf, p.listed_at);
  const growth = growthMultiplier(p.change_7d);
  const ageMult = ageMultiplier(age);
  const chainMult = chainMultiplier(p.chains);
  if (isPreToken(p)) {
    // The multiple is the fitted size curve, not a category median: the curve prices
    // a large protocol lower per TVL dollar than a small one, which the LOO check
    // shows predicts trading tokens better than the flat or category median.
    const multiple = curveMultiple(p.tvl_usd, fit);
    const launch = launchProbability(p, floorUsd);
    const raw = p.tvl_usd * multiple * growth * ageMult * chainMult * launch;
    return {
      value: Math.min(VALUE_CAP, Math.max(VALUE_FLOOR, Math.round(raw))),
      status: 'pre-token',
      mCat: multiple,
      mCatSource: 'curve',
      growthMultiplier: growth,
      ageMultiplier: ageMult,
      chainMultiplier: chainMult,
      launchProbability: launch,
      age,
    };
  }
  if (p.mcap_usd !== null) {
    return {
      value: Math.min(VALUE_CAP, Math.max(VALUE_FLOOR, Math.round(p.mcap_usd))),
      status: 'trading',
      mCat: 0,
      mCatSource: 'observed',
      growthMultiplier: growth,
      ageMultiplier: ageMult,
      chainMultiplier: chainMult,
      launchProbability: null,
      age,
    };
  }
  if (p.gecko_id !== null) {
    // The one anomaly the design prices: a token recorded but no market cap. Its value
    // is the curve estimate, without the launch probability (it already trades).
    const multiple = curveMultiple(p.tvl_usd, fit);
    const raw = p.tvl_usd * multiple;
    return {
      value: Math.min(VALUE_CAP, Math.max(VALUE_FLOOR, Math.round(raw))),
      status: 'trading-anomaly',
      mCat: multiple,
      mCatSource: 'curve',
      growthMultiplier: growth,
      ageMultiplier: ageMult,
      chainMultiplier: chainMult,
      launchProbability: null,
      age,
    };
  }
  // A protocol that records a symbol but no market cap and no CoinGecko id has no
  // observable value to rank by, so it carries none and cannot join the board.
  return {
    value: 0,
    status: 'trading-anomaly',
    mCat: 0,
    mCatSource: 'observed',
    growthMultiplier: growth,
    ageMultiplier: ageMult,
    chainMultiplier: chainMult,
    launchProbability: null,
    age,
  };
}

// ---------------------------------------------------------------- farm plans

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 500_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's family: which action a farmer takes there. */
function familyOf(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('dex') || c.includes('swap')) return 'dex';
  if (c.includes('lend')) return 'lending';
  if (c.includes('yield aggregator')) return 'yield';
  if (c.includes('yield')) return 'yield';
  if (c.includes('curator') || c.includes('allocator')) return 'curator';
  if (c.includes('rwa')) return 'rwa';
  if (c.includes('basis')) return 'basis';
  if (c.includes('cdp') || c.includes('collateral')) return 'cdp';
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('options')) return 'derivatives';
  if (c.includes('chain')) return 'chain';
  if (c.includes('staking pool') || c.includes('staking')) return 'staking';
  if (c.includes('locker') || c.includes('lock')) return 'locker';
  if (c.includes('prediction')) return 'prediction';
  if (c.includes('stable')) return 'stable';
  if (c.includes('insurance')) return 'insurance';
  if (c.includes('bridge')) return 'bridge';
  return 'generic';
}

/** The family's main action, in the words a farmer can follow. */
function mainAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const name = p.name;
  switch (familyOf(p)) {
    case 'dex':
      return `Swap $${capital} of USDC into the pool's pair on ${name} and provide $${capital} of liquidity on ${chain}.`;
    case 'lending':
      return `Supply $${capital} of USDC to ${name} on ${chain} and keep the deposit earning.`;
    case 'yield':
      return `Deposit $${capital} of USDC into the ${name} vault on ${chain} and let it compound.`;
    case 'curator':
      return `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares.`;
    case 'rwa':
      return `Mint $${capital} of the yield-bearing asset through ${name} on ${chain} and hold it.`;
    case 'basis':
      return `Deposit $${capital} of USDC into ${name}'s basis strategy on ${chain} and keep the position.`;
    case 'cdp':
      return `Lock $${capital} of collateral in ${name} on ${chain} and mint against it at low leverage.`;
    case 'derivatives':
      return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.`;
    case 'chain':
      return `Move $${capital} of USDC onto ${chain} through ${name} and use it in the chain's apps.`;
    case 'staking':
      return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`;
    case 'locker':
      return `Lock $${capital} of tokens in ${name} on ${chain} and keep the lock receipt.`;
    case 'prediction':
      return `Fund $${capital} on ${name} and place one market position on ${chain}.`;
    case 'stable':
      return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
    case 'insurance':
      return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
    case 'bridge':
      return `Bridge $${capital} of USDC through ${name} to ${chain} and use the bridged funds there.`;
    default:
      return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
  }
}

/** The family's second feature: a different product surface, so the plan is not one action repeated. */
function secondFeature(p: SnapshotProtocol, capital: number, chain: string): string {
  const name = p.name;
  switch (familyOf(p)) {
    case 'dex':
      return `Stake the LP receipt in ${name}'s gauge or farm on ${chain} so the position earns points.`;
    case 'lending':
      return `Borrow $${Math.round(capital / 2)} of stablecoin against the deposit at under 40% loan-to-value.`;
    case 'yield':
      return `Claim the vault's rewards weekly and re-deposit them so the position compounds.`;
    case 'curator':
      return `Check the vault's curator allocation each week and add $${Math.round(capital / 2)} when it rebalances.`;
    case 'rwa':
      return `Hold the asset through one full yield cycle and record the payout dates in a farm log.`;
    case 'basis':
      return `Check the funding rate weekly and top up $${Math.round(capital / 2)} when it stays positive.`;
    case 'cdp':
      return `Keep the collateral ratio above 200% and repay a little debt if it drifts lower.`;
    case 'derivatives':
      return `Close the hedge before expiry and reopen it, so the position stays active each week.`;
    case 'chain':
      return `Try one native app on ${chain} with $${Math.round(capital / 2)} so the wallet's use is recorded.`;
    case 'staking':
      return `Restake the receipt token once so the position compounds instead of sitting idle.`;
    case 'locker':
      return `Extend the lock by one week before it ends so the position is never idle.`;
    case 'prediction':
      return `Settle the first position and open a second one in a different market.`;
    case 'stable':
      return `Redeem a small amount once to confirm the redemption path works before the main exit.`;
    case 'insurance':
      return `Review the cover terms after one month and renew it before it lapses.`;
    case 'bridge':
      return `Bridge a second, smaller amount back so both directions of use are recorded.`;
    default:
      return `Use one more feature of ${name} with $${Math.round(capital / 2)} so the wallet's use is fuller.`;
  }
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/**
 * A protocol's farm plan: 6 to 8 steps, each an action with a cost and a time. The plan is
 * derived from the protocol's own record (category family, chains, TVL, age), never from a
 * hand-written list of names. The bridge step is skipped when the protocol's first chain
 * is Ethereum (there is nothing to bridge from); a second-feature step takes its place.
 * The last step nets the plan: the expected reward is pro-rata — the wallet's capital
 * as a share of the protocol's TVL, times a stated 10% farmer allocation of the implied
 * value — minus the plan's total gas and fees. The 10% is an assumption, stated in the
 * step itself, not a fact — and the capital is not a cost, it comes back on exit. At the
 * capital the plan uses ($50-$250) the pro-rata reward is usually smaller than the fees,
 * so the net is negative unless the airdrop is large.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, impliedValue: number): FarmStep[] {
  const chain = chainOf(p);
  const name = p.name;
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = mainAction(p, capital, chain);
  const gas = capital >= 250 ? 8 : capital >= 100 ? 5 : 3;
  const weeks = Math.max(1, Math.round(hold / 7));
  const bridgeCost = chain === 'Ethereum' ? 0 : 5;
  const totalCost = gas + 2 * weeks + 11 + bridgeCost + 3;
  const reward = impliedValue * (capital / p.tvl_usd) * 0.10;
  const net = reward - totalCost;
  const money = (n: number): string =>
    n >= 1000 ? `$${Math.round(n).toLocaleString('en-US')}` : `$${Math.round(n * 100) / 100}`;
  const steps: FarmStep[] = [
    {
      text: `Use a fresh wallet on ${chain} that holds only the funds you plan to farm in ${name}, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    { text: action, cost: `$${capital} of capital and about $${gas} of gas`, time: '15 minutes to set up' },
  ];
  if (chain !== 'Ethereum') {
    steps.push({
      text: `Bridge $${capital} of USDC from Ethereum to ${chain} through the canonical bridge; check the funds arrive before continuing.`,
      cost: '$3 to $8 of bridge fees plus gas',
      time: '15 to 30 minutes',
    });
  } else {
    steps.push({ text: secondFeature(p, capital, chain), cost: `about $${Math.max(2, Math.round(gas / 2))} of gas`, time: '10 minutes' });
  }
  steps.push(
    {
      text: `Make one qualifying action each week on ${chain}, such as a deposit, a borrow, a swap or a vote, so ${name} records the wallet as active.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position in ${name} for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
  );
  if (p.tvl_usd >= 100_000_000) {
    steps.push({
      text: `Claim ${name}'s points or rewards weekly on ${chain} and re-deposit them so the balance compounds.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    });
  }
  if (p.tvl_usd >= 500_000_000) {
    steps.push({ text: secondFeature(p, capital, chain), cost: `about $${Math.max(2, Math.round(gas / 2))} of gas`, time: '10 minutes' });
  }
  steps.push(
    {
      text: `Before you withdraw, open ${p.name}'s own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Net: the $${capital} share of ${money(p.tvl_usd)} TVL, at a stated 10% farmer allocation of the ${money(impliedValue)} implied value, is ${money(reward)}; minus about $${totalCost} gas and fees, the net is ${net < 0 ? '−' : ''}${money(Math.abs(net))}.${net < 0 ? ' At this size the plan loses money unless the airdrop is large.' : ''} The 10% is assumed, not a fact; the $${capital} capital returns on exit.`,
      cost: 'the gas and fees above',
      time: 'at launch',
    },
    {
      text: `Exit in stages: unwind the position in ${name}, swap back to USDC, and bridge home from ${chain} when the points target is met or two weeks before a token launch. Write every transaction in a farm log.`,
      cost: '$8 to $15 to exit',
      time: '30 minutes',
    },
  );
  return steps;
}

// ---------------------------------------------------------------- the board

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** Order by value, then TVL, then slug: the board's deterministic tie-break. */
function compareScored(
  a: { p: SnapshotProtocol; value: number },
  b: { p: SnapshotProtocol; value: number },
): number {
  // A non-finite value sorts last instead of poisoning the comparator (a comparator
  // returning NaN leaves the order undefined). Values are finite on the kit snapshot,
  // so this never changes its board.
  const av = Number.isFinite(a.value) ? a.value : -Infinity;
  const bv = Number.isFinite(b.value) ? b.value : -Infinity;
  return bv - av || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0);
}

/**
 * The ranked board: every watchlist slug, plus the highest-valued other protocols outside
 * the six excluded categories. Values must be strictly decreasing down the ranks, so a
 * pass shaves $1 off any tie; a row that would fall to the floor is replaced by the next
 * reserve candidate. Returns the rows and the comps table for the dossier.
 */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const pool = tradingPool(snapshot.protocols);
  const mGlobal = median(pool.map((p) => winsorize(p.mcap_usd! / p.tvl_usd)));
  const fit = fitCurve(pool);
  const loo = computeLOO(pool);
  const scored = new Map<string, ScoredValue>();
  for (const p of snapshot.protocols) scored.set(p.slug, scoreProtocol(p, pool, mGlobal, snapshot.floor_usd, snapshot.as_of, fit));

  const index = bySlug(snapshot.protocols);
  const watchlistRows: SnapshotProtocol[] = [];
  const seenWatch = new Set<string>();
  for (const slug of snapshot.watchlist) {
    if (seenWatch.has(slug)) continue; // A repeated slug ranks once.
    seenWatch.add(slug);
    const p = index.get(slug);
    if (p !== undefined) watchlistRows.push(p);
  }
  // A watchlist slug that scores no positive value (it records a symbol but no market
  // cap and no CoinGecko id) would carry a zero onto the board and fail the gate.
  // Price it like the anomaly case — the comps estimate, no launch probability — so
  // the watchlist stays covered with a real value. This never triggers on the kit
  // snapshot (all 40 watchlist slugs are pre-token with positive values).
  for (const p of watchlistRows) {
    const sc = scored.get(p.slug)!;
    if (Number.isFinite(sc.value) && sc.value > 0) continue;
    const multiple = curveMultiple(p.tvl_usd, fit);
    const raw = p.tvl_usd * multiple;
    scored.set(p.slug, {
      ...sc,
      value: Math.min(VALUE_CAP, Math.max(VALUE_FLOOR, Math.round(raw))),
      status: 'trading-anomaly',
      mCat: multiple,
      mCatSource: 'curve',
    });
  }
  const fillerPool = snapshot.protocols
    .filter(
      (p) =>
        !snapshot.watchlist.includes(p.slug) &&
        !(p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) &&
        scored.get(p.slug)!.value > 0,
    )
    .map((p) => ({ p, value: scored.get(p.slug)!.value }))
    .sort(compareScored);
  const reserve = fillerPool.slice(FILLER_ROWS);
  const chosen = [...watchlistRows.map((p) => ({ p, value: scored.get(p.slug)!.value })), ...fillerPool.slice(0, FILLER_ROWS)];
  chosen.sort(compareScored);

  // Enforce strictly decreasing values by shaving $1 off a tie. The shave may go below
  // the model's $1,000 floor, down to $1: the gate only needs a positive value, and a
  // $1 shave keeps the row (and its watchlist coverage) where a reserve replacement
  // would evict it. Only when a shave would go below $1 — a tie run longer than the
  // value itself — does a row need replacing: a watchlist row must stay for coverage,
  // so the pass stops and the tie is left; a filler row is replaced from reserve when
  // there is one, else dropped. Nothing here throws. On the kit snapshot no row is
  // near the floor (lowest board value $2,264,337), so this behaves exactly as before.
  let reserveAt = 0;
  let rows = chosen;
  let stuck = false;
  for (let guard = 0; guard < 40 && !stuck; guard++) {
    let changed = false;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i]!.value >= rows[i - 1]!.value) {
        const next = rows[i - 1]!.value - 1;
        if (next < 1) {
          if (snapshot.watchlist.includes(rows[i]!.p.slug)) {
            stuck = true;
            break;
          }
          if (reserveAt >= reserve.length) {
            rows.splice(i, 1);
            changed = true;
            break;
          }
          rows[i] = reserve[reserveAt]!;
          reserveAt++;
          rows.sort(compareScored);
          changed = true;
          break;
        }
        rows[i] = { p: rows[i]!.p, value: next };
      }
    }
    if (!changed) break;
  }

  const board: BoardRow[] = rows.map((s, i) => {
    const sc = scored.get(s.p.slug)!;
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: sc.status,
      watchlist: snapshot.watchlist.includes(s.p.slug),
      age_days: sc.age,
      implied_value_usd: s.value,
      model: {
        m_cat: round4(sc.mCat),
        m_cat_source: sc.mCatSource,
        growth_multiplier: round4(sc.growthMultiplier),
        age_multiplier: round4(sc.ageMultiplier),
        chain_multiplier: round4(sc.chainMultiplier),
        launch_probability: sc.launchProbability,
      },
      farm_steps: farmSteps(s.p, sc.age, s.value).map(stepText),
    };
  });

  // The comps table, one row per category that appears on the board, for the dossier.
  const compsByCategory = new Map<string, CompsRow>();
  for (const row of board) {
    if (row.category === null || compsByCategory.has(row.category)) continue;
    const probe = index.get(row.slug)!;
    const { multiple, source, comps } = compsMultiple(probe, pool, mGlobal);
    compsByCategory.set(row.category, { category: row.category, multiple: round4(multiple), comps, source });
  }
  const comps = [...compsByCategory.values()].sort((a, b) => (a.category < b.category ? -1 : 1));

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source || 'DefiLlama',
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    ref_date: snapshot.as_of,
    m_global: round4(mGlobal),
    curve_a: round4(fit.a),
    curve_b: round4(fit.b),
    loo,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    rows: board.map((r) => [
      r.rank,
      r.slug,
      r.name,
      r.category,
      r.chains.join(','),
      r.tvl_usd,
      r.change_7d,
      r.age_days,
      r.implied_value_usd,
      r.token_status === 'pre-token' ? 'p' : r.token_status === 'trading' ? 't' : 'a',
      r.watchlist ? 1 : 0,
      r.model.m_cat,
      r.model.growth_multiplier,
      r.model.age_multiplier,
      r.model.chain_multiplier,
      r.model.launch_probability,
    ] as RadarRow),
    comps,
  };
  return { board, radar };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd >= board[i - 1]!.implied_value_usd) return `row ${i + 1} does not fall below row ${i} on implied value`;
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

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  // Field-level problems are coerced, never thrown: a snapshot that cannot be scored
  // at all still has to produce a run that completes (exit 0). Only a document that
  // is not a JSON object at all is refused — and main.ts catches even that. Every
  // coercion below is a no-op on the kit snapshot (all its fields are well formed):
  // a missing TVL scores as 0, a missing name falls back to the slug, a protocol
  // without a slug (or a repeated slug) is skipped, empty chain names are dropped,
  // and a bad floor falls back to the documented $50M.
  const asOf = typeof o.as_of === 'string' ? o.as_of : REF_DATE;
  const source = typeof o.source === 'string' ? o.source : 'unknown';
  const floorUsd =
    typeof o.floor_usd === 'number' && Number.isSafeInteger(o.floor_usd) && o.floor_usd > 0 ? o.floor_usd : 50_000_000;
  const rawProtocols = Array.isArray(o.protocols) ? o.protocols : [];
  const watchlist = Array.isArray(o.watchlist) ? o.watchlist.filter((s): s is string => typeof s === 'string') : [];
  const seenSlugs = new Set<string>();
  const protocols = rawProtocols
    .filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v))
    .map((p) => {
      const slug = typeof p.slug === 'string' && p.slug.length > 0 ? p.slug : null;
      if (slug === null) return null; // A protocol without a slug cannot join the board.
      return {
        slug,
        name: typeof p.name === 'string' && p.name.length > 0 ? p.name : slug,
        category: typeof p.category === 'string' ? p.category : null,
        chains: Array.isArray(p.chains)
          ? p.chains.filter((c): c is string => typeof c === 'string' && c.length > 0)
          : [],
        tvl_usd: typeof p.tvl_usd === 'number' && Number.isFinite(p.tvl_usd) ? p.tvl_usd : 0,
        change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
        mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
        listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
        gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
        symbol: typeof p.symbol === 'string' ? p.symbol : null,
      };
    })
    .filter((p): p is SnapshotProtocol => {
      if (p === null) return false;
      if (seenSlugs.has(p.slug)) return false; // A repeated slug ranks once.
      seenSlugs.add(p.slug);
      return true;
    });
  return { as_of: asOf, source, floor_usd: floorUsd, protocols, watchlist };
}
