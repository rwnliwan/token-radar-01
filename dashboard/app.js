/* Board, filter, farm queue, detail. Factors and farm economics are recomputed in-page. */
const DATA = /*BOARD_DATA*/[];
const META = Array.isArray(DATA) ? null : DATA;
/* Embedded rows: [slug,name,catIdx,chainIdxs,tvl,change_7d,age,value,status,wl,score,lo_off,hi_off].
 * Rank = position + 1; grade from score (A>=80, B>=60); cat/chain indices into
 * META.cats / META.chainNames. lo_off / hi_off are the rank range under refits. */
const BOARD = (META ? META.rows : []).map((a, i) => ({
  rank: i + 1, slug: a[0], name: a[1], category: a[2] === null ? null : META.cats[a[2]], chains: a[3].map((j) => META.chainNames[j]).join(','), tvl_usd: a[4],
  change_7d: a[5], age_days: a[6], implied_value_usd: a[7],
  status: a[8] === 'p' ? 'pre-token' : a[8] === 't' ? 'trading' : 'trading-anomaly',
  watchlist: a[9] === 1, grade_score: a[10],
  grade: a[10] >= 80 ? 'A' : a[10] >= 60 ? 'B' : 'C',
  rank_lo: i + 1 - (a[11] || 0), rank_hi: i + 1 + (a[12] || 0),
}));
const $ = (id) => document.getElementById(id);
const rowsEl = $('rows'), countEl = $('count'), statsEl = $('stats'), detailEl = $('detail');
const qEl = $('q'), catEl = $('cat'), chainEl = $('chain');
let sortKey = 'rank', sortDir = 1, statusFilter = 'pre-token', deposit = 1000, openSlug = null, share = 0.10;
/* Farmer share (slider, default 10%): a modelled row's implied value scales pro-rata; a trading anchor's mcap does not. */
const scaledValue = (r) => r.status === 'trading' ? r.implied_value_usd : r.implied_value_usd * (share / 0.10);
function fmtUSD(n) {
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2).replace(/\.?0+$/, '') + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
  return '$' + n;
}
const fmtExact = (n) => '$' + Math.round(n).toLocaleString('en-US');
const fmtPct = (v) => v === null || v === undefined ? '—' : (v > 0 ? '+' : '') + v.toFixed(1) + '%';
const fmtAge = (d) => d === null || d === undefined ? '—' : d + 'd';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const SB = { 'pre-token': '<span class="badge pre">Pre-token</span>', 'trading': '<span class="badge trade">Trading</span>', 'trading-anomaly': '<span class="badge anom">Trading · no mcap</span>' };
const statusBadge = (r) => SB[r.status] + (r.watchlist ? '<span class="badge wl">Watchlist</span>' : '');
const chainCell = (r) => { const p = r.chains.split(','); return p.length > 1 ? p[0] + ' +' + (p.length - 1) : r.chains; };
const EXC = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXN = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VER = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAP = /\b(wrapped|staked|staking)\b/i;
const mCat = (tvl) => !META || tvl <= 0 ? 1 : Math.exp(META.curve_a + META.curve_b * Math.log(tvl)) / tvl;
const fGrowth = (c) => c === null || c === undefined ? 1 : 1 + (0.5 * Math.min(100, Math.max(-50, c))) / 100;
const fAge = (a) => a === null || a === undefined ? 0.9 : a < 90 ? 0.85 : a <= 720 ? 0.85 + (0.3 * (a - 90)) / 630 : a <= 1460 ? 1.15 - (0.2 * (a - 720)) / 740 : 0.95;
const fChain = (r) => { const n = r.chains ? r.chains.split(',').filter(Boolean).length : 0; return n <= 1 ? 1 : n <= 3 ? 1.05 : 1.1; };
function eligible(r) {
  if (r.tvl_usd < (META ? META.floor_usd : 5e7) || r.status !== 'pre-token') return false;
  if (r.category !== null && EXC.has(r.category)) return false;
  if (VER.test(r.name) || WRAP.test(r.name) || EXN.some((e) => r.name.startsWith(e))) return false;
  return true;
}
const pLaunch = (r) => eligible(r) ? 0.65 : 0.5;
const factors = (r) => ({ m: mCat(r.tvl_usd), g: fGrowth(r.change_7d), a: fAge(r.age_days), c: fChain(r), p: r.status === 'pre-token' ? pLaunch(r) : null });
const holdFor = (a) => a === null || a === undefined ? 30 : a < 180 ? 60 : a < 365 ? 45 : 30;
const weeksFor = (a) => Math.max(1, Math.round(holdFor(a) / 7));
const gasFor = (c) => c >= 250 ? 8 : c >= 100 ? 5 : 3;
const capFor = (t) => t >= 5e8 ? 250 : t >= 1e8 ? 100 : 50;
const firstChain = (r) => (r.chains ? r.chains.split(',')[0] : '') || '';
const costAt = (r, c) => gasFor(c) + 2 * weeksFor(r.age_days) + 11 + (firstChain(r) === 'Ethereum' ? 0 : 5) + 3;
const forgone = (c, h) => c * 0.04 * (h / 365);
const netAtV = (v, r, c) => v * (c / r.tvl_usd) * share - costAt(r, c) - forgone(c, holdFor(r.age_days));
const netAt = (r, c) => netAtV(r.implied_value_usd, r, c);
function paysAfterV(v, r, c) {
  if (v <= 0) return null;
  const rw = v * (c / r.tvl_usd) * share, hold = holdFor(r.age_days);
  const setup = gasFor(c) + 11 + (firstChain(r) === 'Ethereum' ? 0 : 5) + 3;
  for (let d = 1; d <= 365; d++) if (Math.min(rw, (rw * d) / hold) >= setup + 2 * Math.ceil(d / 7) + c * 0.04 * (d / 365)) return d;
  return null;
}
const paysAfter = (r, c) => paysAfterV(r.implied_value_usd, r, c);
function verdictAt(r, c) {
  const miss = META && META.loo ? META.loo.curve.median_miss : 1;
  if (netAtV(r.implied_value_usd / (miss > 0 ? miss : 1), r, c) > 0) return 'Robust';
  return netAt(r, c) > 0 ? 'Thin' : 'Skip';
}
const hoursFor = (r) => 0.25 + weeksFor(r.age_days) * (10 / 60) + 0.5;
const money = (x) => x >= 1000 ? '$' + Math.round(x).toLocaleString('en-US') : '$' + (Math.round(x * 100) / 100);
const signed = (x) => (x < 0 ? '−' : '') + money(Math.abs(x));
const paysText = (d) => d === null ? 'never within a year' : `after ${d} days`;
const isEarly = (r) => r.status === 'pre-token' && !r.watchlist &&
  ((r.age_days !== null && r.age_days !== undefined && r.age_days < 180) ||
    (r.change_7d !== null && r.change_7d !== undefined && r.change_7d > 20));
function filtered() {
  const q = qEl.value.trim().toLowerCase(), cat = catEl.value, chain = chainEl.value;
  const out = BOARD.filter((r) => {
    if (statusFilter === 'pre-token' && r.status !== 'pre-token') return false;
    if (statusFilter === 'trading' && r.status === 'pre-token') return false;
    if (statusFilter === 'watchlist' && !r.watchlist) return false;
    if (statusFilter === 'early' && !isEarly(r)) return false;
    if (cat && r.category !== cat) return false;
    if (chain && !r.chains.split(',').includes(chain)) return false;
    if (q && !(r.name.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q))) return false;
    return true;
  });
  const k = sortKey;
  out.sort((a, b) => {
    const av = k === 'grade' ? a.grade_score : k === 'implied_value_usd' ? scaledValue(a) : a[k], bv = k === 'grade' ? b.grade_score : k === 'implied_value_usd' ? scaledValue(b) : b[k];
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    if (typeof av === 'string') return sortDir * (av < bv ? -1 : av > bv ? 1 : 0);
    return sortDir * (av - bv);
  });
  return out;
}
function render() {
  const list = filtered(), rn = $('rankNote');
  if (rn) rn.hidden = !(statusFilter === 'pre-token' || statusFilter === 'watchlist' || statusFilter === 'early');
  rowsEl.innerHTML = list.map((r) => {
    const chg = r.change_7d, cls = chg === null ? '' : chg >= 0 ? 'up' : 'down';
    const rr = r.rank_lo === r.rank && r.rank_hi === r.rank ? '' : `<span class="rrange">${r.rank_lo}–${r.rank_hi}</span>`;
    return `<tr data-slug="${r.slug}"><td class="num">${r.rank}${rr}</td><td><strong>${esc(r.name)}</strong><span class="slug">${esc(r.slug)}</span></td><td>${esc(r.category || '—')}</td><td>${esc(chainCell(r))}</td><td class="num">${fmtUSD(r.tvl_usd)}</td><td class="num ${cls}">${fmtPct(chg)}</td><td class="num"><strong>${fmtUSD(scaledValue(r))}</strong></td><td class="num">${fmtAge(r.age_days)}</td><td class="num"><span class="gbadge g${r.grade.toLowerCase()}">${r.grade}</span> ${r.grade_score}</td><td>${statusBadge(r)}</td></tr>`;
  }).join('');
  countEl.textContent = list.length + ' of ' + BOARD.length + ' rows shown.';
  document.querySelectorAll('#board th').forEach((th) => th.classList.toggle('sorted', th.dataset.k === sortKey));
}
function renderQueue() {
  const el = $('queueRows');
  if (!el) return;
  const top = BOARD.filter((r) => r.status === 'pre-token')
    .map((r) => { const n = netAt(r, deposit); return { r, net: n, per: n / hoursFor(r) }; })
    .sort((a, b) => b.per - a.per).slice(0, 10);
  el.innerHTML = top.map((x, i) => {
    const p = paysAfter(x.r, deposit), v = verdictAt(x.r, deposit);
    return `<tr data-slug="${x.r.slug}"><td class="num">${i + 1}</td><td><strong>${esc(x.r.name)}</strong><span class="slug">${esc(x.r.slug)}</span></td><td class="num">${fmtUSD(scaledValue(x.r))}</td><td class="num ${x.net < 0 ? 'down' : 'up'}">${signed(x.net)}</td><td class="num">${p === null ? 'never' : p + 'd'}</td><td class="num ${x.per < 0 ? 'down' : 'up'}">${signed(x.per)}/hr</td><td><span class="verdict v${v.toLowerCase()}">${v}</span></td></tr>`;
  }).join('');
}
function renderBook() {
  if (!META) return;
  let bCap = 0, bFees = 0, bRew = 0;
  BOARD.filter((r) => r.watchlist).forEach((r) => { const c = capFor(r.tvl_usd), hold = holdFor(r.age_days); bCap += c; bFees += costAt(r, c) + forgone(c, hold); bRew += r.implied_value_usd * (c / r.tvl_usd) * share; });
  const setB = (id, v) => { const e = $(id); if (e) e.textContent = v; };
  setB('bookCap', fmtExact(bCap)); setB('bookFees', fmtExact(bFees)); setB('bookReward', fmtExact(bRew)); setB('bookNet', fmtExact(Math.abs(bRew - bFees)));
}
function factorCard(label, value, note, num) {
  let bar = '';
  if (typeof num === 'number' && Number.isFinite(num) && num > 0) {
    const pos = Math.max(0, Math.min(100, 50 + (Math.log10(num) / 1.3) * 50));
    const left = Math.min(50, pos), w = Math.abs(pos - 50), col = num >= 1 ? 'var(--accent)' : '#d97706';
    bar = `<div class="fbar"><div class="ftrack"><div class="ffill" style="left:${left.toFixed(1)}%;width:${Math.max(w, 1.5).toFixed(1)}%;background:${col}"></div><div class="fmid"></div></div></div>`;
  }
  return `<div class="factor"><b>${value}</b><span>${label} — ${note}</span>${bar}</div>`;
}
/* Farm plan in-page; same actions/costs/times as the model. */
const F = 'dex:dex,swap:dex,lend:lending,yield aggregator:yield,yield:yield,curator:curator,allocator:curator,rwa:rwa,basis:basis,cdp:cdp,collateral:cdp,derivative:derivatives,perpetual:derivatives,options:derivatives,chain:chain,staking pool:staking,staking:staking,locker:locker,lock:locker,prediction:prediction,stable:stable,insurance:insurance,bridge:bridge'.split(',').map((p) => p.split(':'));
const fam = (c) => { const f = F.find(([s]) => (c || '').toLowerCase().includes(s)); return f ? f[1] : 'generic'; };
const M = {
  dex: 'Add $c liquidity to $n on $h; swap USDC into the pair first.',
  lending: 'Supply $c USDC to $n on $h.',
  yield: 'Deposit $c USDC into the $n vault on $h.',
  curator: 'Deposit $c into a $n vault on $h.',
  rwa: 'Mint $c of the yield asset via $n on $h.',
  basis: 'Deposit $c USDC into $n\'s basis strategy on $h.',
  cdp: 'Lock $c collateral in $n on $h; mint at low leverage.',
  derivatives: 'Deposit $c USDC as margin on $n; open a small hedge.',
  chain: 'Move $c USDC onto $h via $n; use it in apps.',
  staking: 'Stake $c via $n; keep the receipt.',
  locker: 'Lock $c of tokens in $n on $h; keep the receipt.',
  prediction: 'Fund $c on $n; place one market position on $h.',
  stable: 'Mint or deposit $c of the stable asset via $n on $h.',
  insurance: 'Buy $c of cover from $n on $h; keep it active.',
  bridge: 'Bridge $c USDC via $n to $h; use the funds there.',
  generic: 'Deposit $c USDC into $n on $h; keep it open.',
};
const G = 'Use one more feature of $n on $h with $h2.';
const sub = (t, n, c, h) => t.replaceAll('$h2', '$' + Math.round(c / 2)).replaceAll('$c', '$' + c).replaceAll('$n', n).replaceAll('$h', h);
const st = (s) => { let x = `${s[0]} Cost: ${s[1]}. Time: ${s[2]}.`; if (x.length > 600) x = `${x.slice(0, 596)}...`; if (x.length < 20) x = `${x} Hold and check the protocol's page.`; return x; };
function farmPort(n, cat, ch, tvl, age, val, status, miss) {
  const h = ch ? ch.split(',')[0] : 'its main chain', c = capFor(tvl), hold = holdFor(age);
  const f = fam(cat), g = gasFor(c), wk = weeksFor(age);
  const row = { tvl_usd: tvl, age_days: age, chains: ch, implied_value_usd: val || 0 };
  const tc = costAt(row, c), rw = (val || 0) * c / tvl * share, fy = forgone(c, hold), nt = rw - tc - fy;
  const mm = miss > 0 ? miss : 1, nA = (cap) => netAtV(val || 0, row, cap);
  let be = 0;
  if (val > 0) for (let cap = 50; cap <= 50000; cap += 5) if (nA(cap) > 0) { be = cap; break; }
  const nl = netAtV((val || 0) / mm, row, 10000);
  const p1 = paysAfterV(val || 0, row, 1000), p10 = paysAfterV(val || 0, row, 10000);
  const pct = Math.round(share * 100);
  const base = `Net: $${c} share of ${money(tvl)} TVL × ${pct}% of ${money(val || 0)} = ${money(rw)}, minus $${tc} fees + ${money(fy)} forgone yield (4%, ${hold}d) = ${signed(nt)}.`;
  const netT = status === 'trading'
    ? base + `${nt < 0 ? ' At this size it loses money unless the airdrop is large.' : ''} ${pct}% assumed; capital returns on exit.`
    : base + ` $1,000: net ${signed(nA(1000))} (pays ${paysText(p1)}); $10,000: net ${signed(nA(10000))} (pays ${paysText(p10)}).${be === 0 ? ' Never pays to $50,000.' : be <= c ? ' Already pays at this size.' : ` Pays from ${money(be)}.`} Low end (÷${mm.toFixed(2)}): $10,000 net ${signed(nl)}. Verdict: ${nl > 0 ? 'Robust' : nA(10000) > 0 ? 'Thin' : 'Skip'}. ${pct}% assumed; capital returns on exit.`;
  const s = [
    [`Use a fresh wallet on ${h} for ${n} only; keep its seed offline.`, 'under $3 gas', '5 minutes'],
    [sub(M[f], n, c, h), `$${c} capital, about $${g} gas`, '15 minutes'],
  ];
  if (h !== 'Ethereum') s.push([`Bridge $${c} USDC from Ethereum to ${h}; confirm it arrives.`, '$3 to $8 plus gas', '15 to 30 minutes']);
  else s.push([sub(G, n, c, h), `about $${Math.max(2, Math.round(g / 2))} gas`, '10 minutes']);
  s.push(
    [`One qualifying action weekly on ${h} (deposit, borrow, swap, vote).`, 'about $2 gas a week', '10 minutes a week'],
    [`Hold in ${n} at least ${hold} days.`, `the $${c} stays in the position`, `${hold} days`],
  );
  if (tvl >= 1e8) s.push([`Claim ${n} points weekly on ${h}; re-deposit to compound.`, 'about $2 gas a week', '10 minutes a week']);
  if (tvl >= 5e8) s.push([sub(G, n, c, h), `about $${Math.max(2, Math.round(g / 2))} gas`, '10 minutes']);
  s.push(
    [`Claim only from ${n}'s own points page; never pay to claim.`, 'no fee to check, never pay to claim', '10 minutes'],
    [netT, 'the gas and fees above', 'at launch'],
    [`Exit in stages: unwind in ${n}, swap to USDC, bridge home from ${h} before launch. Log every transaction.`, '$8 to $15 to exit', '30 minutes'],
  );
  return s.map(st);
}
function showDetail(slug) {
  const r = BOARD.find((x) => x.slug === slug);
  if (!r) return;
  openSlug = slug;
  const fc = factors(r), launch = fc.p === null ? '—' : fc.p.toFixed(2);
  const mcat = r.status === 'trading' ? 'observed mcap' : fc.m.toFixed(3);
  const shareNote = share === 0.10 || r.status === 'trading' ? '' : ` × ${Math.round(share * 100)}%/10% = ${fmtExact(scaledValue(r))}`;
  const arith = r.status === 'pre-token' ? `TVL ${fmtExact(r.tvl_usd)} × M_cat ${fc.m.toFixed(4)} × F_growth ${fc.g.toFixed(4)} × F_age ${fc.a.toFixed(4)} × F_chain ${fc.c.toFixed(2)} × P_launch ${launch} = ${fmtExact(r.implied_value_usd)}${shareNote}` : r.status === 'trading-anomaly' ? `TVL ${fmtExact(r.tvl_usd)} × M_cat ${fc.m.toFixed(4)} = ${fmtExact(r.implied_value_usd)}${shareNote}` : '';
  const cards = [['Implied value', fmtUSD(scaledValue(r)), r.status === 'pre-token' ? 'model estimate' : r.status === 'trading-anomaly' ? 'TVL × M_cat fallback' : 'observed market cap']];
  if (r.status !== 'trading') cards.push(['M_cat', mcat, 'curve multiple', fc.m], ['F_growth', fc.g.toFixed(3), '7-day momentum', fc.g], ['F_age', fc.a.toFixed(3), 'age hump', fc.a], ['F_chain', fc.c.toFixed(2), 'chain count', fc.c], ['P_launch', launch, 'prior', fc.p]);
  const depLine = r.status === 'trading' ? '' : `<p class="fine">At $${deposit.toLocaleString('en-US')}: net ${signed(netAt(r, deposit))}, pays ${paysText(paysAfter(r, deposit))}, verdict ${verdictAt(r, deposit)}. The Farm next toggle recomputes this; the printed verdict is at $10,000.</p>`;
  detailEl.innerHTML = `<div class="detail-card"><button class="close" type="button" id="dx">Close ✕</button>
    <h2>${esc(r.name)} <span class="slug">${esc(r.slug)}</span></h2>
    <p class="meta">Rank ${r.rank}${r.rank_lo === r.rank && r.rank_hi === r.rank ? '' : ` (${r.rank_lo}–${r.rank_hi})`} · ${esc(r.category || 'no category')} · ${esc(chainCell(r))} · TVL ${fmtUSD(r.tvl_usd)} · 7d ${fmtPct(r.change_7d)} · age ${fmtAge(r.age_days)} · grade ${r.grade} · ${r.grade_score}/100 · ${statusBadge(r)}</p>
    <div class="factors">${cards.map((a) => factorCard(a[0], a[1], a[2], a[3], a[4])).join('')}</div>
    ${arith ? `<p class="fine">${arith}</p>` : ''}
    ${r.status === 'trading' ? '<p class="fine">This protocol already trades: its implied value is the observed market cap. The comps factors do not apply.</p>' : ''}
    ${depLine}
    <h3>Farm plan</h3>
    <ol id="farm">${farmPort(r.name, r.category, r.chains, r.tvl_usd, r.age_days, r.implied_value_usd, r.status, META && META.loo ? META.loo.curve.median_miss : 3.4).map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    <p class="fine">Values are the entry's own claim, never a promise a token launches.</p>
  </div>`;
  detailEl.hidden = false;
  $('dx').addEventListener('click', hideDetail);
  writeHash();
}
function hideDetail() { openSlug = null; detailEl.hidden = true; detailEl.innerHTML = ''; writeHash(); }
function writeHash() {
  const parts = [];
  if (statusFilter !== 'all') parts.push('f=' + statusFilter);
  if (qEl.value.trim()) parts.push('q=' + encodeURIComponent(qEl.value.trim()));
  if (!detailEl.hidden) { const h = detailEl.querySelector('h2'); if (h) parts.push('d=' + encodeURIComponent(h.querySelector('.slug').textContent)); }
  history.replaceState(null, '', parts.length ? '#' + parts.join('&') : location.pathname + location.search);
}
function readHash() {
  const h = new URLSearchParams(location.hash.slice(1)), f = h.get('f');
  if (f && ['pre-token', 'trading', 'watchlist', 'early'].includes(f)) statusFilter = f;
  if (h.get('q')) qEl.value = h.get('q');
  return h.get('d');
}
function renderScatter() {
  const el = $('scatter');
  if (!el) return;
  const rows = BOARD.filter((r) => Number.isFinite(r.tvl_usd) && r.tvl_usd > 0 && Number.isFinite(scaledValue(r)) && scaledValue(r) > 0);
  if (!rows.length) { el.innerHTML = '<p class="fine">No scatter data.</p>'; return; }
  const W = 760, H = 420, ML = 70, MR = 48, MT = 14, MB = 44;
  const lx = rows.map((r) => Math.log10(r.tvl_usd)), ly = rows.map((r) => Math.log10(scaledValue(r)));
  const x0 = Math.floor(Math.min(...lx)), x1 = Math.ceil(Math.max(...lx)), y0 = Math.floor(Math.min(...ly)), y1 = Math.ceil(Math.max(...ly));
  const X = (v) => ML + ((v - x0) / (x1 - x0)) * (W - ML - MR);
  const Y = (v) => MT + (1 - (v - y0) / (y1 - y0)) * (H - MT - MB);
  const col = (r) => r.status === 'pre-token' ? '#2563eb' : r.status === 'trading' ? '#16a34a' : '#dc2626';
  const fmt = (v) => v >= 9 ? '$' + (Math.pow(10, v) / 1e9).toFixed(0) + 'B' : '$' + (Math.pow(10, v) / 1e6).toFixed(0) + 'M';
  let ax = '';
  for (let g = x0; g <= x1; g++) ax += `<text x="${X(g)}" y="${H - MB + 18}" class="saxis" text-anchor="middle">${fmt(g)}</text>`;
  for (let g = y0; g <= y1; g++) ax += `<text x="${ML - 8}" y="${Y(g) + 4}" class="saxis" text-anchor="end">${fmt(g)}</text>`;
  const dots = rows.map((r) => `<circle cx="${X(Math.log10(r.tvl_usd)).toFixed(1)}" cy="${Y(Math.log10(scaledValue(r))).toFixed(1)}" r="3.5" fill="${col(r)}" opacity="0.75"/>`).join('');
  el.innerHTML = `<h2>TVL versus implied value</h2><p class="fine">Each dot is one board row (log scales). Blue = pre-token, green = trading anchor, red = anomaly.</p><svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="TVL versus implied value scatter">${ax}${dots}<text x="${(ML + W - MR) / 2}" y="${H - 8}" class="saxis" text-anchor="middle">TVL (log)</text><text x="14" y="${(MT + H - MB) / 2}" class="saxis" text-anchor="middle" transform="rotate(-90 14 ${(MT + H - MB) / 2})">Implied value (log)</text></svg>`;
}
function init() {
  if (!BOARD.length) { statsEl.textContent = 'No board data embedded.'; return; }
  const set = (id, v) => { const e = $(id); if (e) e.textContent = v; };
  let pre = 0, tr = 0, an = 0, wl = 0; const gc = { A: 0, B: 0, C: 0 };
  BOARD.forEach((r) => { if (r.status === 'pre-token') pre++; else if (r.status === 'trading') tr++; else an++; if (r.watchlist) wl++; gc[r.grade]++; });
  const early = BOARD.filter(isEarly).length, firstPre = BOARD.find((r) => r.status === 'pre-token');
  renderBook();
  set('pillAll', 'All ' + BOARD.length);
  set('pillWl', 'Watchlist · ' + (META ? META.watchlist_size : 40));
  set('pillEarly', 'Early finds · ' + early);
  set('rankNote', 'Ranks are global board ranks; the first pre-token protocol is rank ' + (firstPre ? firstPre.rank : '—') + '.');
  set('gradeCounts', `${gc.A} A · ${gc.B} B · ${gc.C} C`);
  set('earlyCount', String(early));
  statsEl.textContent = `${BOARD.length} rows · ${pre} pre-token · ${tr} trading · ${an} no mcap · watchlist ${wl}/40`;
  renderScatter();
  renderQueue();
  [...new Set(BOARD.map((r) => r.category).filter(Boolean))].sort().forEach((c) => catEl.add(new Option(c, c)));
  [...new Set(BOARD.flatMap((r) => r.chains.split(',')))].sort().forEach((c) => chainEl.add(new Option(c, c)));
  const wire = (sel, fn) => document.querySelectorAll(sel).forEach((b) => {
    b.addEventListener('click', () => { document.querySelectorAll(sel).forEach((x) => x.classList.toggle('on', x === b)); fn(b); });
    b.classList.toggle('on', b.dataset.f === statusFilter || (b.dataset.dep && Number(b.dataset.dep) === deposit));
  });
  wire('.pills button', (b) => { statusFilter = b.dataset.f; render(); writeHash(); });
  wire('.dep button', (b) => { deposit = Number(b.dataset.dep); renderQueue(); if (openSlug) showDetail(openSlug); });
  const shareEl = $('share'), shareVal = $('shareVal');
  if (shareEl) shareEl.addEventListener('input', () => {
    share = Number(shareEl.value) / 100;
    if (shareVal) shareVal.textContent = shareEl.value + '%';
    render(); renderQueue(); renderBook(); renderScatter();
    if (openSlug) showDetail(openSlug);
  });
  document.querySelectorAll('#board th').forEach((th) => {
    th.addEventListener('click', () => { const k = th.dataset.k; if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = k === 'name' || k === 'category' || k === 'chains' || k === 'status' ? 1 : -1; } render(); });
  });
  [qEl, catEl, chainEl].forEach((el) => el.addEventListener('input', () => { render(); writeHash(); }));
  const open = (ev) => { const tr = ev.target.closest('tr[data-slug]'); if (tr) showDetail(tr.dataset.slug); };
  rowsEl.addEventListener('click', open);
  const qRows = $('queueRows');
  if (qRows) qRows.addEventListener('click', open);
  detailEl.addEventListener('click', (ev) => { if (ev.target === detailEl) hideDetail(); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !detailEl.hidden) hideDetail(); });
  render();
  const d = readHash();
  if (d) showDetail(d);
  else if (statusFilter !== 'all') { document.querySelectorAll('.pills button').forEach((x) => x.classList.toggle('on', x.dataset.f === statusFilter)); render(); }
}
init();
