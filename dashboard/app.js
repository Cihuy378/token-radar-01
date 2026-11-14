// Token Radar, radar-3 dashboard. Reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the board, the fitted curve, a filterable table with a band on every row,
// a detail drawer, and the fit's report card. No network: all data is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', mechanism: 'all', move: 'any', view: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null, compare: [] };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    if (days >= 30) return Math.round(days / 30) + ' mo';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

  // The model in one function: the page recomputes a row from the snapshot figures and
  // checks the number board.json carries, so page code and board data visibly agree.
  function categoryMultiplier(category) {
    var row = (DATA.categories || []).filter(function (c) { return c.category === (category || 'Other'); })[0];
    return row ? row.multiplier : 1;
  }
  function impliedOf(row, model) {
    var fit = Math.pow(10, DATA.fit.intercept + DATA.fit.elasticity * Math.log10(row.tvl_usd));
    var age = row.age_days ?? model.unknown_age_days;
    var season = model.season_floor + (Math.min(Math.max(age, 0), model.season_days) / model.season_days) * model.season_range;
    var growth = clamp(row.change_7d ?? 0, model.momentum_floor, model.momentum_cap);
    var momentum = 1 + (growth / 100) * model.momentum_weight;
    return { fit: fit, season: season, momentum: momentum, category: categoryMultiplier(row.category), implied: Math.max(1, Math.round(fit * categoryMultiplier(row.category) * season * momentum)) };
  }

  function el(tag, attrs) {
    var n = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') n.className = attrs[k];
        else if (k === 'text') n.textContent = attrs[k];
        else if (k === 'html') n.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) n.appendChild(c); });
      else if (typeof child === 'string') n.appendChild(document.createTextNode(child));
      else n.appendChild(child);
    }
    return n;
  }
  var SVGNS = 'http' + '://www.w3.org/2000/svg'; // built from parts: no URL literal in the source
  function svgEl(tag, attrs) {
    var n = document.createElementNS(SVGNS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { if (attrs[k] != null) n.setAttribute(k, attrs[k]); });
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (!child) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) n.appendChild(c); });
      else if (typeof child === 'string') n.appendChild(document.createTextNode(child));
      else n.appendChild(child);
    }
    return n;
  }

  // The farm plan mirrors lib/model.ts rule for rule.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function gasUsdFor(chain) {
    if (chain === 'Ethereum') return 8;
    if (chain === 'Solana') return 0.1;
    if (chain === 'Bitcoin' || chain === 'Babylon Genesis' || chain === 'CORE') return 10;
    if (chain === 'Base' || chain === 'Arbitrum' || chain === 'Optimism' || chain === 'Polygon' || chain === 'Binance' || chain === 'Avalanche' || chain === 'Tron') return 0.2;
    return 1;
  }
  function gasFor(chain) {
    var u = gasUsdFor(chain);
    if (chain === 'Bitcoin' || chain === 'Babylon Genesis' || chain === 'CORE') return 'about $10 of bridge gas per move';
    return u < 1 ? 'about $' + u.toFixed(2) + ' of gas per transaction' : 'about $' + u + ' of gas per transaction';
  }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  // [category words, main action, weekly action, hold days]. {N} name, {C} capital,
  // {H} chain. Order matters: 'cdp manager' precedes 'cdp', 'chain' precedes 'bridge'.
  var MECH_RULES = [
    [['risk curator', 'onchain capital allocator'], 'Deposit ${C} into a {N} vault on {H} and keep the shares while the curator allocates them.', "Read the vault's latest curator report on {N} and move the funds only if the strategy changed.", 60],
    [['cdp manager'], 'Open a managed debt position of ${C} through {N} on {H} and keep it collateralised.', "Check the position's health on {N} and top up the collateral if it drifted near the liquidation line.", 45],
    [['cdp'], 'Lock ${C} of collateral with {N} on {H} and mint or borrow against it.', 'Borrow a small amount against the collateral on {N}, then repay it the same week.', 45],
    [['uncollateralized lending', 'lending', 'collateral market'], 'Supply ${C} of USDC to {N} on {H} and keep the position open.', 'Borrow a small amount against the supply on {N}, then repay it the same week.', 0],
    [['dex'], "Provide ${C} of liquidity to {N}'s main pool on {H} and keep the position open.", "Swap a small amount through {N}'s main pool on {H} to keep the position active.", 30],
    [['liquidity manager'], 'Deposit ${C} into a managed pool on {N} on {H} and keep the receipt.', "Check the pool's range on {N} and rebalance only if the price moved out of it.", 30],
    [['restaking', 'staking pool'], "Stake ${C} of the chain's staking asset through {N} on {H} and keep the receipt.", 'Restake the rewards {N} paid out, instead of leaving them idle.', 60],
    [['prediction'], 'Fund ${C} and place one market position on {N} on {H}.', 'Settle one market on {N} and place the next position with the winnings.', 30],
    [['rwa'], "Mint ${C} of the protocol's yield asset on {H} through {N} and hold it.", 'Check the yield {N} paid this week and leave it compounding in the same asset.', 60],
    [['yield aggregator', 'yield', 'leveraged farm', 'farm'], "Deposit ${C} into {N}'s main strategy vault on {H} and keep the shares.", "Harvest the strategy's rewards on {N} and compound them back into the same vault.", 45],
    [['basis trading'], "Deposit ${C} into {N}'s delta-neutral position on {H} and keep it open.", 'Check the funding rate on {N} and exit the position only if it turned negative for a week.', 30],
    [['perpetual', 'derivative', 'interest rate derivative'], 'Deposit ${C} of USDC as margin on {N} on {H} and open one small hedge.', 'Close and reopen the hedge on {N} once, so the position shows fresh activity.', 30],
    [['stablecoin', 'dual-token stablecoin'], 'Mint or deposit ${C} of the stable asset through {N} on {H} and hold it.', "Check the stable asset's peg on {N} and use it for one payment or swap this week.", 45],
    [['anchor btc', 'decentralized btc'], 'Bridge ${C} of BTC through {N} to {H} and deposit it in its yield position.', 'Check the BTC yield {N} paid this week and leave it compounding in the same position.', 60],
    [['cedefi'], 'Deposit ${C} with {N} on {H} and keep the receipt for the custodial position.', 'Check the yield {N} paid this week and confirm the position still shows on its dashboard.', 45],
    [['chain'], "Bridge ${C} to {N} and use it in two of the chain's own apps, keeping a balance on the chain.", 'Make one transaction on {N} this week — a swap, a deposit or a vote — so the wallet stays active.', 60],
    [['insurance'], 'Buy ${C} of cover from {N} on {H} and keep the policy.', 'Check the cover {N} sold this week and renew it before it lapses.', 0],
    [['payment', 'crypto card'], 'Route ${C} of spending through {N} on {H} and keep the receipt.', 'Make one payment through {N} this week so the wallet shows regular use.', 30],
    [['otc marketplace'], 'Place one ${C} trade through {N} on {H} and keep the settlement receipt.', 'Place one small trade through {N} this week so the account shows fresh activity.', 30],
    [['governance incentives'], 'Stake ${C} through {N} on {H} and cast one vote in its governance.', 'Vote on one proposal on {N} this week so the stake keeps earning incentives.', 45],
    [['indexes', 'index'], 'Buy ${C} of the {N} index token on {H} and hold it.', "Check the index's rebalance on {N} and hold through it unless the composition changed.", 45],
    [['bridge'], 'Bridge ${C} of USDC to {H} through {N} and use the bridged funds in its app.', 'Bridge a small amount back the other way through {N} so both directions are used.', 30]
  ];
  var MECH_FALLBACK = ['Deposit ${C} of USDC into {N} on {H} and keep the position open.', 'Make one qualifying action this week on {N}, such as a deposit, a borrow, a swap or a vote.', 0];
  function fill(template, p, capital, chain) {
    return template.split('{N}').join(p.name).split('{C}').join(capital).split('{H}').join(chain);
  }
  function mechanismOf(p) {
    var capital = capitalFor(p);
    var chain = chainOf(p);
    var name = p.name.toLowerCase();
    if (name.indexOf('points') >= 0) return { action: fill("Join {N}'s points program on {H} with ${C} and complete its first quest.", p, capital, chain), weekly: fill('Complete one quest on {N} this week and check the points landed on its leaderboard.', p, capital, chain), hold: 60 };
    if (name.indexOf('vault') >= 0) {
      var vault = MECH_RULES[0];
      return { action: fill(vault[1], p, capital, chain), weekly: fill(vault[2], p, capital, chain), hold: vault[3] };
    }
    var category = (p.category || '').toLowerCase();
    for (var i = 0; i < MECH_RULES.length; i++) {
      var rule = MECH_RULES[i];
      for (var j = 0; j < rule[0].length; j++) {
        if (category.indexOf(rule[0][j]) >= 0) return { action: fill(rule[1], p, capital, chain), weekly: fill(rule[2], p, capital, chain), hold: rule[3] };
      }
    }
    return { action: fill(MECH_FALLBACK[0], p, capital, chain), weekly: fill(MECH_FALLBACK[1], p, capital, chain), hold: MECH_FALLBACK[2] };
  }
  function holdDaysFor(mech, age) {
    if (mech.hold > 0) return mech.hold;
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var mech = mechanismOf(p);
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(mech, p.age_days);
    var gas = gasFor(chain);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: gas, time: '5 minutes' },
      { text: mech.action, cost: '$' + capital + ' of capital and ' + gas, time: '15 minutes to set up' },
      { text: "Open " + p.name + "'s own dashboard or points page and check the position shows with the right balance.", cost: 'no fee to check', time: '10 minutes' },
      { text: mech.weekly, cost: gas, time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Before you unwind, check the exit path — the pool depth, the withdrawal queue or the unstaking delay — so the position closes in one step.', cost: 'one exit transaction at ' + gas, time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  // The hash carries the board's state: 'p' is the selected slug, 'c' the pair.
  var HASH_KEYS = [['q', 'q', ''], ['category', 'category', 'all'], ['chain', 'chain', 'all'], ['mechanism', 'mechanism', 'all'], ['move', 'move', 'any'], ['view', 'view', 'all'], ['tab', 'tab', 'pre-token'], ['p', 'selected', null]];
  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    HASH_KEYS.forEach(function (k) { var v = params.get(k[0]); if (v) state[k[1]] = v; });
    if (params.get('c')) state.compare = params.get('c').split(',').filter(function (s) { return s.length > 0; }).slice(0, 2);
  }
  function writeHash() {
    var params = new URLSearchParams();
    HASH_KEYS.forEach(function (k) { if (state[k[1]] && state[k[1]] !== k[2]) params.set(k[0], state[k[1]]); });
    if (state.compare.length > 0) params.set('c', state.compare.join(','));
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.view === 'watchlist' && !r.watchlist) return false;
      if (state.view === 'early' && r.watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).some(function (c) { return c === state.chain; })) return false;
      if (state.mechanism !== 'all' && r.mechanism !== state.mechanism) return false;
      if (state.move === 'rising' && !(r.change_7d !== null && r.change_7d > 0)) return false;
      if (state.move === 'falling' && !(r.change_7d !== null && r.change_7d < 0)) return false;
      if (state.move === 'up10' && !(r.change_7d !== null && r.change_7d >= 10)) return false;
      if (state.move === 'down10' && !(r.change_7d !== null && r.change_7d <= -10)) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, r.mechanism, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'multiple') { av = a.multiple; bv = b.multiple; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name' }, el('b', { text: 'Token Radar' }))),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Sealed snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama · ' + DATA.coverage.total + ' protocols' }),
        el('span', { class: 'model-tag', text: DATA.model_version + ' model' })
      )
    );
  }

  // The fit chart: comparables as dots on log-log axes, the fitted curve as a line,
  // the band shaded around it.
  function scatterChart() {
    var W = 360, H = 252, L = 46, R = 8, T = 8, B = 28;
    var x0 = 6.7, x1 = 10, y0 = 4, y1 = 10;
    var px = function (v) { return L + ((Math.log10(v) - x0) / (x1 - x0)) * (W - L - R); };
    var py = function (v) { return T + (1 - (Math.log10(v) - y0) / (y1 - y0)) * (H - T - B); };
    var fit = DATA.fit;
    var fitY = function (x) { return fit.intercept + fit.elasticity * x; };
    var bandLo = Math.log10(fit.band_lo), bandHi = Math.log10(fit.band_hi);
    var clip = function (v) { return Math.max(y0, Math.min(y1, v)); };
    var parts = [];
    var xticks = [1e7, 1e8, 1e9, 1e10];
    var xlabels = ['$10M', '$100M', '$1B', '$10B'];
    xticks.forEach(function (t, i) {
      parts.push(svgEl('line', { x1: px(t), y1: T, x2: px(t), y2: H - B, stroke: '#e9e2cf', 'stroke-width': 1 }));
      parts.push(svgEl('text', { x: px(t), y: H - 8, 'text-anchor': 'middle', 'font-size': 9, fill: '#6f695a', 'font-family': 'ui-monospace, Menlo, monospace' }, xlabels[i]));
    });
    var yticks = [1e5, 1e6, 1e7, 1e8, 1e9, 1e10];
    var ylabels = ['$100K', '$1M', '$10M', '$100M', '$1B', '$10B'];
    yticks.forEach(function (t, i) {
      parts.push(svgEl('line', { x1: L, y1: py(t), x2: W - R, y2: py(t), stroke: '#e9e2cf', 'stroke-width': 1 }));
      parts.push(svgEl('text', { x: L - 5, y: py(t) + 3, 'text-anchor': 'end', 'font-size': 9, fill: '#6f695a', 'font-family': 'ui-monospace, Menlo, monospace' }, ylabels[i]));
    });
    var bandPts = [
      px(Math.pow(10, x0)) + ',' + py(Math.pow(10, clip(fitY(x0) + bandHi))),
      px(Math.pow(10, x1)) + ',' + py(Math.pow(10, clip(fitY(x1) + bandHi))),
      px(Math.pow(10, x1)) + ',' + py(Math.pow(10, clip(fitY(x1) + bandLo))),
      px(Math.pow(10, x0)) + ',' + py(Math.pow(10, clip(fitY(x0) + bandLo)))
    ].join(' ');
    parts.push(svgEl('polygon', { points: bandPts, fill: '#1e5c46', opacity: 0.12 }));
    parts.push(svgEl('line', { x1: px(Math.pow(10, x0)), y1: py(Math.pow(10, clip(fitY(x0)))), x2: px(Math.pow(10, x1)), y2: py(Math.pow(10, clip(fitY(x1)))), stroke: '#1e5c46', 'stroke-width': 2 }));
    (DATA.scatter || []).forEach(function (pt) {
      if (pt.tvl_usd <= 0 || pt.mcap_usd <= 0) return;
      var lx = Math.log10(pt.tvl_usd), ly = Math.log10(pt.mcap_usd);
      if (lx < x0 || lx > x1 || ly < y0 || ly > y1) return;
      parts.push(svgEl('circle', { cx: px(pt.tvl_usd), cy: py(pt.mcap_usd), r: 2.2, fill: '#1e5c46', opacity: 0.55 }));
    });
    return svgEl('svg', { class: 'scatter', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Market cap against TVL, with the fitted curve' }, parts);
  }

  function hero() {
    var fit = DATA.fit;
    return el('section', { class: 'hero' },
      el('div', null,
        el('p', { class: 'eyebrow', text: 'Token launch radar · snapshot ' + DATA.as_of }),
        el('h1', { html: 'The launches that have not happened yet, <em>priced from the ones that have.</em>' }),
        el('p', { class: 'lede-text', html: 'Every protocol in the snapshot that records no token, ranked by what a launch would be worth. Priced from the market&rsquo;s own curve: a log-log fit of market cap on TVL over the ' + fit.n + ' priced protocols, with a category factor, seasoning and momentum. Half of the priced tokens land within &times;' + fit.band_lo.toFixed(2) + ' to &times;' + fit.band_hi.toFixed(2) + ' of the curve — so every row shows its range.' })
      ),
      el('aside', { class: 'pricing', 'aria-label': 'How a launch is priced' },
        el('h2', { text: 'How a launch is priced' }),
        el('div', { class: 'formula', text: 'value = 10^' + fit.intercept.toFixed(2) + ' x TVL^' + fit.elasticity.toFixed(3) + ' x category x seasoning x momentum' }),
        scatterChart(),
        el('div', { class: 'fit-stats' },
          el('div', { class: 'fit-stat' }, el('b', { text: String(fit.n) }), el('span', { text: 'priced comparables' })),
          el('div', { class: 'fit-stat' }, el('b', { text: fit.elasticity.toFixed(3) }), el('span', { text: 'elasticity' })),
          el('div', { class: 'fit-stat' }, el('b', { text: 'R² ' + fit.r2.toFixed(2) }), el('span', { text: 'of the curve' })),
          el('div', { class: 'fit-stat' }, el('b', { text: 'x' + fit.band_lo.toFixed(2) + '–x' + fit.band_hi.toFixed(2) }), el('span', { text: 'half land inside' }))
        )
      )
    );
  }

  function statsStrip() {
    var c = DATA.coverage;
    var stat = function (value, label) { return el('div', { class: 'stat' }, el('b', { text: value }), el('span', { text: label })); };
    return el('section', { class: 'stats', 'aria-label': 'Board statistics' },
      stat(String(c.total), 'protocols tracked'),
      stat(String(c.pre_token), 'record no token'),
      stat(String(DATA.board_size), 'on this board'),
      stat(DATA.watchlist_size + ' / ' + DATA.watchlist_size, 'watchlist covered'),
      stat(fmtUsd(DATA.total_implied_usd), 'total implied value'),
      stat('x' + DATA.median_multiple.toFixed(3), 'median multiple of TVL')
    );
  }

  function coverageBar() {
    var c = DATA.coverage;
    var total = c.total || 1;
    var pct = function (n) { return (n / total * 100).toFixed(1) + '%'; };
    return el('section', { class: 'coverage', 'aria-label': 'Coverage accounting' },
      el('div', { class: 'coverage-bar' },
        el('i', { class: 'ranked', style: 'width:' + pct(c.ranked) }),
        el('i', { class: 'live', style: 'width:' + pct(c.token_on_record) }),
        el('i', { class: 'aside', style: 'width:' + pct(c.set_aside) })
      ),
      el('div', { class: 'coverage-legend' },
        el('span', null, el('i', { class: 'swatch', style: 'background:#1e5c46' }), el('b', { text: String(c.ranked) }), ' ranked'),
        el('span', null, el('i', { class: 'swatch', style: 'background:#1d1a13' }), el('b', { text: String(c.token_on_record) }), ' token on record'),
        el('span', null, el('i', { class: 'swatch', style: 'background:#c9c0a6' }), el('b', { text: String(c.set_aside) }), ' set aside — wrapped, staked, bridged or versioned')
      )
    );
  }

  function top5() {
    var picks = DATA.rows.slice(0, 5);
    return el('section', { class: 'top5', 'aria-label': 'Top five protocols' },
      picks.map(function (r) {
        return el('button', { type: 'button', class: 'pick', onclick: function () { openDetail(r.slug); } },
          el('span', { class: 'rank', text: 'No. ' + r.rank }),
          el('span', { class: 'mech', text: r.mechanism }),
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' · ' + fmtUsd(r.tvl_usd) + ' TVL' }),
          el('span', { class: 'val', text: fmtUsd(r.implied_value_usd) }),
          el('span', { class: 'range', text: 'range ' + fmtUsd(r.implied_lo_usd) + '–' + fmtUsd(r.implied_hi_usd) }),
          el('span', { class: 'ticket', text: '$' + r.farm_ticket_usd + ' ticket · ' + r.hold_days + '-day hold' })
        );
      })
    );
  }

  function filterSelect(id, label, allLabel, values, current, onPick) {
    var select = el('select', { id: id, 'aria-label': label },
      el('option', { value: 'all', text: allLabel }),
      values.map(function (v) { return el('option', { value: v, text: v, selected: v === current ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { onPick(select.value); writeHash(); render(); });
    return select;
  }

  function chip(label, view) {
    return el('button', { type: 'button', class: 'chip', 'aria-pressed': state.view === view ? 'true' : 'false', text: label, onclick: function () { state.view = view; writeHash(); render(); } });
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var mechanisms = Array.from(new Set(DATA.rows.map(function (r) { return r.mechanism; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search the board', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSelect = filterSelect('category', 'Filter by category', 'All categories', categories, state.category, function (v) { state.category = v; });
    var chainSelect = filterSelect('chain', 'Filter by chain', 'All chains', chains, state.chain, function (v) { state.chain = v; });
    var mechSelect = filterSelect('mechanism', 'Filter by mechanism', 'All mechanisms', mechanisms, state.mechanism, function (v) { state.mechanism = v; });
    var moves = [['any', 'Any 7-day move'], ['rising', 'Rising in 7 days'], ['falling', 'Falling in 7 days'], ['up10', 'Up 10% or more'], ['down10', 'Down 10% or more']];
    var moveSelect = el('select', { id: 'move', 'aria-label': 'Filter by seven-day move' },
      moves.map(function (m) { return el('option', { value: m[0], text: m[1], selected: state.move === m[0] ? 'selected' : null }); })
    );
    moveSelect.addEventListener('change', function () { state.move = moveSelect.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'chips' },
        chip('All ' + DATA.board_size, 'all'),
        chip('Watchlist (' + DATA.watchlist_size + ')', 'watchlist'),
        chip('Early (' + DATA.early_size + ')', 'early')
      ),
      el('div', { class: 'filters' },
        el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
        el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSelect),
        el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
        el('div', { class: 'field' }, el('label', { for: 'mechanism', text: 'Mechanism' }), mechSelect),
        el('div', { class: 'field' }, el('label', { for: 'move', text: '7-day TVL' }), moveSelect),
        el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
        el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' of ' + DATA.board_size + ' rows shown' : DATA.live.length + ' live-token protocols' })
      )
    );
  }

  // The distribution of the rows on screen, log scale; it follows the filters.
  function histogram(list) {
    if (list.length === 0) return null;
    var values = list.map(function (r) { return Math.log10(Math.max(1, r.implied_value_usd)); });
    var lo = Math.floor(Math.min.apply(null, values) * 10) / 10;
    var hi = Math.ceil(Math.max.apply(null, values) * 10) / 10;
    if (hi <= lo) hi = lo + 0.1;
    var bins = 24;
    var counts = [];
    for (var i = 0; i < bins; i++) counts.push(0);
    values.forEach(function (v) {
      var at = Math.min(bins - 1, Math.floor((v - lo) / (hi - lo) * bins));
      counts[at]++;
    });
    var max = Math.max.apply(null, counts) || 1;
    var W = 1120, H = 74, B = 16;
    var bars = counts.map(function (c, i) {
      var h = (c / max) * (H - B - 4);
      return svgEl('rect', { x: (i / bins) * W + 1, y: H - B - h, width: W / bins - 2, height: Math.max(0, h), fill: '#1e5c46', opacity: 0.75 });
    });
    var total = list.reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
    var mults = list.map(function (r) { return r.multiple; }).sort(function (a, b) { return a - b; });
    var median = mults.length ? mults[Math.floor(mults.length / 2)] : 0;
    return el('section', { class: 'hist', 'aria-label': 'Distribution of implied values' },
      el('div', { class: 'hist-head' },
        el('div', null, el('b', { text: String(list.length) }), el('span', { text: ' rows shown' })),
        el('div', null, el('b', { text: fmtUsd(total) }), el('span', { text: ' implied in view' })),
        el('div', null, el('b', { text: 'x' + median.toFixed(3) }), el('span', { text: ' median multiple' })),
        el('span', { text: 'Implied values, log scale.' })
      ),
      svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H }, bars)
    );
  }

  function sortHeader(key, label, num) {
    return el('th', { scope: 'col', class: num ? 'num' : null },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  // One board row: the implied value as a dot with its band on a fixed log scale
  // ($1M to $1B), so every row's range is comparable with every other row's.
  function rangeCell(r) {
    var pos = function (v) { return clamp((Math.log10(Math.max(1, v)) - 6) / 3 * 100, 0, 100); };
    var lo = pos(r.implied_lo_usd), hi = pos(r.implied_hi_usd), mid = pos(r.implied_value_usd);
    return el('td', { class: 'range-cell' },
      el('div', { class: 'range-label' }, el('b', { class: 'num', text: fmtUsd(r.implied_value_usd) }), el('span', { class: 'num', text: fmtUsd(r.implied_lo_usd) + '–' + fmtUsd(r.implied_hi_usd) })),
      el('div', { class: 'range-track', 'aria-hidden': 'true' },
        el('i', { class: 'range-band', style: 'left:' + lo.toFixed(1) + '%;width:' + Math.max(1, hi - lo).toFixed(1) + '%' }),
        el('i', { class: 'range-dot', style: 'left:' + mid.toFixed(1) + '%' })
      )
    );
  }

  function boardRow(r) {
    var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
    return el('tr', {
      'data-selected': state.selected === r.slug ? 'true' : 'false',
      'data-slug': r.slug,
      tabindex: '0',
      onclick: function () { openDetail(r.slug); },
      onkeydown: function (e) { if (e.target !== e.currentTarget) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
    },
      el('td', { class: 'rank-num', text: String(r.rank) }),
      el('td', null, el('div', { class: 'name' },
        el('b', null, r.name, r.watchlist ? el('span', { class: 'badge', text: 'Watchlist' }) : null),
        el('span', { class: 'sub', text: r.mechanism + ' · ' + (r.category || 'Other') + ' · ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') + (r.chains && r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') })
      )),
      el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
      el('td', { class: 'num ' + growthClass, text: fmtPct(r.change_7d) }),
      el('td', { class: 'num', text: fmtAge(r.age_days) }),
      el('td', { class: 'num', text: 'x' + r.multiple.toFixed(3) }),
      rangeCell(r),
      el('td', { class: 'num' },
        el('span', { text: '$' + r.farm_ticket_usd }),
        el('span', { class: 'sub', text: ' · ' + r.hold_days + 'd hold' }),
        el('button', { type: 'button', class: 'compare-toggle', 'aria-pressed': state.compare.indexOf(r.slug) >= 0 ? 'true' : 'false', text: state.compare.indexOf(r.slug) >= 0 ? 'Compared' : 'Compare', onclick: function (e) { e.stopPropagation(); compareToggle(r.slug); } })
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another filter to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.mechanism = 'all'; state.move = 'any'; state.view = 'all'; writeHash(); render(); } })
      ));
    }
    var tbody = el('tbody');
    list.forEach(function (r) { tbody.appendChild(boardRow(r)); });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. The dot is the model\u2019s centre, the band the range half of priced tokens land in. Arrow keys move, Enter opens, C marks a row to compare.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL', true),
            sortHeader('growth', '7d', true),
            sortHeader('age', 'No token for', true),
            sortHeader('multiple', 'x TVL', true),
            sortHeader('implied', 'Implied value, and its range'),
            el('th', { scope: 'col', class: 'num', text: 'Farm ticket' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      var ratio = r.tvl_usd > 0 && r.mcap_usd !== null ? (r.mcap_usd / r.tvl_usd) : null;
      tbody.appendChild(el('tr', null,
        el('td', null, el('span', { class: 'status live', text: 'already trades' })),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: ratio === null ? 'n/a' : 'x' + ratio.toFixed(3) })
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the ranking — the ' + DATA.fit.n + ' the curve was fitted on are the comparables behind every implied value.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', class: 'num', text: 'TVL' }), el('th', { scope: 'col', class: 'num', text: '7d' }), el('th', { scope: 'col', class: 'num', text: 'Market cap' }), el('th', { scope: 'col', class: 'num', text: 'x TVL' }))),
          tbody
        )
      )
    );
  }

  // The top ten's category mix, computed from the page's own data.
  function concentrationNote() {
    var mix = DATA.concentration || [];
    if (mix.length === 0) return null;
    var top = mix[0];
    var cal = (DATA.categories || []).filter(function (c) { return c.category === top.category; })[0];
    var parts = mix.map(function (m) { return m.category + ' ' + m.top10_rows; }).join(' · ');
    var mult = cal ? 'its category factor is ' + cal.multiplier.toFixed(2) + 'x' : 'its category has no priced protocol, so the curve alone prices it';
    return 'Top ten by category: ' + parts + '. ' + top.category + ' holds ' + top.top10_rows +
      ' of the top ten because ' + mult + ' and its protocols carry the largest TVLs. No factor is tuned down to spread the top ten.';
  }

  function modelPanel() {
    var m = DATA.model;
    var fit = DATA.fit;
    var bt = DATA.backtest;
    var c = DATA.coverage;
    var note = concentrationNote();
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How a launch is priced' }),
      el('div', { class: 'formula', text: 'implied = round( 10^(' + fit.intercept.toFixed(3) + ' + ' + fit.elasticity.toFixed(3) + ' x log10(tvl_usd)) x category x (' + m.season_floor + ' + min(age_days, ' + m.season_days + ') / ' + m.season_days + ' x ' + m.season_range + ') x (1 + clamp(change_7d, ' + m.momentum_floor + ', ' + m.momentum_cap + ') / 100 x ' + m.momentum_weight + ') )' }),
      el('p', { class: 'sub', text: 'The curve is an ordinary least-squares fit of log10(market cap) on log10(TVL) over the ' + fit.n + ' priced protocols, after two exclusions: exchange tokens, and ' + c.outliers + ' outliers whose market cap sits more than 10x above TVL or below 2% of it. Intercept and elasticity are computed on every run, never shipped as constants. The category factor is each category\u2019s mean log residual from the curve, shrunk toward no effect with a prior of ' + m.shrink_prior + ' protocols and clamped to [' + m.multiple_min + ', ' + m.multiple_max + ']; a category with no priced protocol takes 1.' }),
      el('p', { class: 'sub', text: 'Seasoning and momentum are stated factors, not fitted ones: the snapshot shows no measurable age effect on the curve (fitted age slope -0.05 ± 0.16), so seasoning is kept small — 0.85 for a new listing, 1.15 after three years with no token on record; an unknown listing date counts as ' + m.unknown_age_days + ' days. The board ranks every protocol the watchlist rule leaves rankable — pre-token, not a wrapped, staked or bridged product, not an exchange, not a versioned pool — ' + DATA.board_size + ' rows, ' + DATA.early_size + ' below the floor.' }),
      el('h3', { text: 'Report card' }),
      el('div', { class: 'report' },
        el('div', { class: 'report-cell' }, el('b', { text: 'x' + fit.band_lo.toFixed(2) + '–x' + fit.band_hi.toFixed(2) }), el('span', { text: 'half of priced tokens land inside this band around the curve' })),
        el('div', { class: 'report-cell' }, el('b', { text: bt.median_abs_pct_error.toFixed(1) + '%' }), el('span', { text: 'median error of the ' + bt.folds + '-fold cross-check on ' + bt.n + ' priced protocols' })),
        el('div', { class: 'report-cell' }, el('b', { text: (bt.within_2x * 100).toFixed(1) + '%' }), el('span', { text: 'of cross-check predictions land within 2x of the market cap' }))
      ),
      el('p', { class: 'calib-note', text: 'The cross-check refits the curve on four fifths of the priced protocols and tests it on the fifth, five times — out-of-sample, so it is the honest number. The curve is a rough guide (R² ' + fit.r2.toFixed(2) + '), which is why every row carries its range.' }),      el('h3', { text: 'Category factors' }),
      el('table', { class: 'calib' },
        el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Priced' }), el('th', { scope: 'col', text: 'Mean log residual' }), el('th', { scope: 'col', text: 'Factor used' }))),
        el('tbody', null, DATA.categories.map(function (f) {
          return el('tr', null,
            el('td', { text: f.category }),
            el('td', { text: String(f.live_protocols) }),
            el('td', { text: f.residual_mean === null ? 'n/a' : (f.residual_mean >= 0 ? '+' : '') + f.residual_mean.toFixed(3) }),
            el('td', { text: f.multiplier.toFixed(3) + 'x' })
          );
        }))
      ),
      el('p', { class: 'calib-note', text: DATA.categories.length + ' categories with priced protocols, from ' + fit.n + ' comparables. A flat multiple would price a lending pool and a risk curator as the same business; the market does not.' }),
      note ? el('h3', { text: 'Top-ten concentration' }) : null,
      note ? el('p', { class: 'calib-note', text: note }) : null,
      el('h3', { text: 'What the board does not claim' }),
      el('p', { class: 'calib-note', text: 'A protocol on this board records no token — never that it has none, because a token may exist that the snapshot does not carry. The board does not predict whether or when a token is issued, and an implied value is this entry\u2019s own claim, never one the snapshot makes.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  // The detail drawer's model section: every factor, and the page's recomputation
  // beside the board's number.
  function impliedSection(row, recomputed, close) {
    var eq = [
      ['TVL', fmtUsd(row.tvl_usd)],
      ['Curve value', fmtUsd(recomputed.fit)],
      ['Category factor (' + (row.category || 'Other') + ')', recomputed.category.toFixed(3) + 'x'],
      ['Seasoning (' + fmtAge(row.age_days) + ' with no token)', recomputed.season.toFixed(3) + 'x'],
      ['Momentum (' + fmtPct(row.change_7d) + ' in 7 days)', recomputed.momentum.toFixed(3) + 'x'],
      ['Uncertainty band', fmtUsd(row.implied_lo_usd) + ' – ' + fmtUsd(row.implied_hi_usd)]
    ];
    return el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        eq.map(function (x) { return el('div', null, el('span', { text: x[0] }), el('b', { class: 'num', text: x[1] })); }),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed.implied) + (close ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' An estimate, not a price.' })
    );
  }

  // The detail drawer's farm plan: each step split into action and cost tail.
  function farmPlanSection(steps) {
    return el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    );
  }

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var recomputed = impliedOf(row, DATA.model);
    var close = Math.abs(recomputed.implied - row.implied_value_usd) <= Math.max(1, row.implied_value_usd * 0.001);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.watchlist ? ' · Watchlist' : '') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: row.mechanism + ' · ' + (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(impliedSection(row, recomputed, close));
    dialog.appendChild(farmPlanSection(steps));
    dialog.appendChild(el('div', { class: 'detail-actions' },
      el('button', { class: 'button', type: 'button', text: state.compare.indexOf(row.slug) >= 0 ? 'Remove from comparison' : 'Compare this protocol', onclick: function () { compareToggle(row.slug); dialog.close(); } }),
      el('span', { class: 'sub', text: 'Ticket $' + row.farm_ticket_usd + ' · setup ~' + row.setup_minutes + ' min · hold ' + row.hold_days + ' days.' })
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  // The side-by-side view: two picked protocols, each model factor on its own row with
  // the leader marked, a verdict, and both farm plans. It mirrors lib/model.ts.
  function sideBySide(a, b) {
    var defs = [
      ['tvl', 'Total value locked', a.tvl_usd, b.tvl_usd, fmtUsd(a.tvl_usd), fmtUsd(b.tvl_usd)],
      ['growth', 'Seven-day TVL change', a.change_7d ?? 0, b.change_7d ?? 0, fmtPct(a.change_7d), fmtPct(b.change_7d)],
      ['age', 'Days with no token on record', a.age_days ?? 365, b.age_days ?? 365, fmtAge(a.age_days), fmtAge(b.age_days)],
      ['fit', 'Curve value', a.fit_value, b.fit_value, fmtUsd(a.fit_value), fmtUsd(b.fit_value)],
      ['categoryMult', 'Category multiplier', a.category_multiplier, b.category_multiplier, a.category_multiplier.toFixed(3) + 'x', b.category_multiplier.toFixed(3) + 'x'],
      ['seasonMult', 'Seasoning multiplier', a.season_multiplier, b.season_multiplier, a.season_multiplier.toFixed(3) + 'x', b.season_multiplier.toFixed(3) + 'x'],
      ['momentumMult', 'Momentum multiplier', a.momentum_multiplier, b.momentum_multiplier, a.momentum_multiplier.toFixed(3) + 'x', b.momentum_multiplier.toFixed(3) + 'x'],
      ['implied', 'Implied value', a.implied_value_usd, b.implied_value_usd, fmtUsd(a.implied_value_usd), fmtUsd(b.implied_value_usd)]
    ];
    return defs.map(function (d) {
      return { key: d[0], label: d[1], first: d[2], second: d[3], firstText: d[4], secondText: d[5], leader: d[2] === d[3] ? 'tie' : d[2] > d[3] ? 'first' : 'second' };
    });
  }

  // One sentence on the pair: who leads on more factors, and by how much.
  function compareVerdict(a, b, entries) {
    var firstWins = 0;
    var secondWins = 0;
    entries.forEach(function (entry) {
      if (entry.leader === 'first') firstWins++;
      else if (entry.leader === 'second') secondWins++;
    });
    var gap = Math.max(a.implied_value_usd, b.implied_value_usd) / Math.max(1, Math.min(a.implied_value_usd, b.implied_value_usd));
    var leadText = firstWins === secondWins
      ? 'Neither leads: the two split the eight factors evenly.'
      : (firstWins > secondWins ? a.name : b.name) + ' leads on ' + Math.max(firstWins, secondWins) + ' of the eight factors.';
    var valueText = a.implied_value_usd === b.implied_value_usd
      ? 'Both protocols carry the same implied value.'
      : (a.implied_value_usd > b.implied_value_usd ? a.name : b.name) + ' carries the larger implied value — ' + gap.toFixed(1) + ' times the other.';
    return leadText + ' ' + valueText;
  }

  // The two picked rows, or null when the comparison is not exactly two rows.
  function comparePicked() {
    if (state.compare.length !== 2) return null;
    var first = DATA.rows.filter(function (r) { return r.slug === state.compare[0]; })[0];
    var second = DATA.rows.filter(function (r) { return r.slug === state.compare[1]; })[0];
    if (!first || !second) return null;
    return [first, second];
  }

  // Mark or unmark one row for comparison. A third pick drops the oldest of the two.
  function compareToggle(slug) {
    var at = state.compare.indexOf(slug);
    if (at >= 0) state.compare.splice(at, 1);
    else {
      if (state.compare.length >= 2) state.compare.shift();
      state.compare.push(slug);
    }
    writeHash();
    render();
  }

  // Empty the comparison, if there is one; a no-op otherwise.
  function compareClear() {
    if (state.compare.length === 0) return;
    state.compare = [];
    writeHash();
    render();
  }

  // One half of the comparison: rank and value, factor rows with the ones it leads
  // highlighted, and its full farm plan.
  function compareColumn(row, side, entries) {
    return el('div', { class: 'compare-col' },
      el('h3', { text: 'Rank ' + row.rank + ' · ' + fmtUsd(row.implied_value_usd) }),
      el('p', { class: 'sub', text: row.mechanism + ' · ' + (row.category || 'Other') + ' on ' + (row.chains || []).join(', ') }),
      el('div', { class: 'compare-factors' }, entries.map(function (entry) {
        return el('div', { class: 'compare-factor' + (entry.leader === side ? ' leads' : '') },
          el('span', { text: entry.label }),
          el('b', { class: 'num', text: side === 'first' ? entry.firstText : entry.secondText })
        );
      })),
      farmPlanSection(farmSteps(row))
    );
  }

  // The comparison panel: a heading naming both protocols, the verdict, and the two
  // columns side by side. Nothing renders until the pair is complete.
  function comparePanel() {
    var pair = comparePicked();
    if (pair === null) return null;
    var first = pair[0];
    var second = pair[1];
    var entries = sideBySide(first, second);
    return el('section', { class: 'panel compare', 'aria-label': 'Comparison' },
      el('div', { class: 'compare-head' },
        el('h2', { text: first.name + ' against ' + second.name }),
        el('button', { type: 'button', class: 'button', text: 'Clear comparison', onclick: function () { compareClear(); } })
      ),
      el('p', { class: 'sub', text: compareVerdict(first, second, entries) }),
      el('div', { class: 'compare-grid' },
        compareColumn(first, 'first', entries),
        compareColumn(second, 'second', entries)
      )
    );
  }

  function footer() {
    return el('footer', { class: 'footer' },
      el('p', { text: 'Source: ' + DATA.source + '. Implied value is this entry\u2019s own claim, never one the snapshot makes. It does not predict whether or when a token is issued.' })    );
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(hero());
    shell.appendChild(statsStrip());
    shell.appendChild(coverageBar());
    shell.appendChild(top5());
    shell.appendChild(controls());
    if (state.tab === 'pre-token') {
      var list = sortedRows(rows());
      var hist = histogram(list);
      if (hist) shell.appendChild(hist);
      shell.appendChild(boardTable());
      var pair = comparePanel();
      if (pair) shell.appendChild(pair);
      shell.appendChild(modelPanel());
    } else {
      shell.appendChild(liveTable());
    }
    shell.appendChild(footer());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    // A render with no selection closes a drawer a previous view left open.
    if (!state.selected && dialog.open) dialog.close();
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  // A hash change from a link, the back button or a fresh URL re-reads the state.
  window.addEventListener('hashchange', function () {
    state.q = ''; state.category = 'all'; state.chain = 'all'; state.mechanism = 'all'; state.move = 'any'; state.view = 'all'; state.tab = 'pre-token'; state.selected = null; state.compare = [];
    readHash();
    render();
  });
  // Keyboard navigation: arrows move between the rows on screen, Enter opens the
  // focused row's detail, Escape closes it or clears a comparison. Ignored in fields.
  function visibleRows() {
    return Array.prototype.slice.call(document.querySelectorAll('#board tbody tr'));
  }
  function moveSelection(delta) {
    if (state.tab !== 'pre-token') return;
    var rows = visibleRows();
    if (rows.length === 0) return;
    var index = -1;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i] === document.activeElement) { index = i; break; }
    }
    var next = index < 0 ? (delta > 0 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, index + delta));
    rows[next].focus();
  }
  function keyboardNav(e) {
    if (dialog.open) {
      if (e.key === 'Escape') dialog.close();
      return;
    }
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSelection(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveSelection(-1); }
    else if (e.key === 'Escape') { compareClear(); }
    else if (e.key === 'c' || e.key === 'C') {
      var focused = document.activeElement;
      var slug = focused && focused.getAttribute ? focused.getAttribute('data-slug') : null;
      if (slug) { e.preventDefault(); compareToggle(slug); }
    }
  }
  window.addEventListener('keydown', keyboardNav);
})();
