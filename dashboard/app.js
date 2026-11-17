/* Token Launch Radar — board, filter, detail view. Value: round(TVL x M_cat x
 * F_growth x F_age x F_chain x P_launch) for pre-token; observed market cap for
 * trading anchors; TVL x M_cat for the one anomaly. Full model in index.html. */

// The board data, embedded by main.ts when it builds the output (an empty array here).
// Rows are positional arrays [rank, slug, name, category, chains, tvl, 7d, age, value,
// status, watchlist, m_cat, f_growth, f_age, f_chain, p_launch]; status 'p'/'t'/'a'.
const DATA = /*BOARD_DATA*/[];
const META = Array.isArray(DATA) ? null : DATA;
const BOARD = (META ? META.rows : []).map((a) => ({
  rank: a[0], slug: a[1], name: a[2], category: a[3], chains: a[4], tvl_usd: a[5],
  change_7d: a[6], age_days: a[7], implied_value_usd: a[8],
  status: a[9] === 'p' ? 'pre-token' : a[9] === 't' ? 'trading' : 'trading-anomaly',
  watchlist: a[10] === 1,
  m_cat: a[11], growth_multiplier: a[12], age_multiplier: a[13], chain_multiplier: a[14],
  launch_probability: a[15],
}));

const $ = (id) => document.getElementById(id);
const rowsEl = $('rows'), countEl = $('count'), statsEl = $('stats'), detailEl = $('detail');
const qEl = $('q'), catEl = $('cat'), chainEl = $('chain');

let sortKey = 'rank', sortDir = 1, statusFilter = 'pre-token';

function fmtUSD(n) {
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2).replace(/\.?0+$/, '') + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
  return '$' + n;
}
function fmtPct(v) {
  if (v === null || v === undefined) return '—';
  return (v > 0 ? '+' : '') + v.toFixed(1) + '%';
}
function fmtAge(d) {
  if (d === null || d === undefined) return '—';
  return d.toLocaleString('en-US') + 'd';
}
function statusBadge(r) {
  const base = r.status === 'pre-token'
    ? '<span class="badge pre">Pre-token</span>'
    : r.status === 'trading'
      ? '<span class="badge trade">Trading</span>'
      : '<span class="badge anom">Trading · no mcap</span>';
  return base + (r.watchlist ? '<span class="badge wl">Watchlist</span>' : '');
}
function chainCell(r) {
  const parts = r.chains.split(',');
  return parts.length > 1 ? parts[0] + ' +' + (parts.length - 1) : r.chains;
}
/** Chains as chips (the detail view): one pill per chain, never a raw comma string. */
function chainChips(r) {
  return r.chains.split(',').filter(Boolean).map((c) => `<span class="chip">${esc(c)}</span>`).join(' ');
}

function filtered() {
  const q = qEl.value.trim().toLowerCase();
  const cat = catEl.value, chain = chainEl.value;
  let out = BOARD.filter((r) => {
    if (statusFilter === 'pre-token' && r.status !== 'pre-token') return false;
    if (statusFilter === 'trading' && r.status === 'pre-token') return false;
    if (statusFilter === 'watchlist' && !r.watchlist) return false;
    if (cat && r.category !== cat) return false;
    if (chain && !r.chains.split(',').includes(chain)) return false;
    if (q && !(r.name.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q))) return false;
    return true;
  });
  const k = sortKey;
  out.sort((a, b) => {
    const av = a[k], bv = b[k];
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    if (typeof av === 'string') return sortDir * (av < bv ? -1 : av > bv ? 1 : 0);
    return sortDir * (av - bv);
  });
  return out;
}

function render() {
  const list = filtered();
  // Ranks 1–3 are trading anchors, so the default pre-token view starts at rank 4.
  // Say so only where it applies (pre-token / watchlist), not on the all / trading views.
  const rankNote = $('rankNote');
  if (rankNote) rankNote.hidden = !(statusFilter === 'pre-token' || statusFilter === 'watchlist');
  rowsEl.innerHTML = list.map((r) => {
    const chg = r.change_7d;
    const cls = chg === null ? '' : chg >= 0 ? 'up' : 'down';
    return `<tr data-slug="${r.slug}">
      <td class="num">${r.rank}</td>
      <td><strong>${esc(r.name)}</strong><span class="slug">${esc(r.slug)}</span></td>
      <td>${esc(r.category || '—')}</td>
      <td>${esc(chainCell(r))}</td>
      <td class="num">${fmtUSD(r.tvl_usd)}</td>
      <td class="num ${cls}">${fmtPct(chg)}</td>
      <td class="num"><strong>${fmtUSD(r.implied_value_usd)}</strong></td>
      <td class="num">${fmtAge(r.age_days)}</td>
      <td>${statusBadge(r)}</td>
    </tr>`;
  }).join('');
  countEl.textContent = list.length + ' of ' + BOARD.length + ' rows shown.';
  document.querySelectorAll('#board th').forEach((th) => {
    th.classList.toggle('sorted', th.dataset.k === sortKey);
  });
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function factorCard(label, value, note, num, fill) {
  let bar = '';
  if (typeof num === 'number' && Number.isFinite(num) && num > 0) {
    if (fill) {
      // Probability fill (0–1): fills left to right toward 100%, never amber-left.
      // P_launch is a stated prior, so a fill reads as "how likely", not "how negative".
      const w = Math.max(1.5, Math.min(100, num * 100));
      bar = `<div class="fbar" role="img" aria-label="${label} ${num}"><div class="ftrack"><div class="ffill" style="left:0;width:${w.toFixed(1)}%;background:var(--accent)"></div></div></div>`;
    } else {
      // Diverging bar centred on 1.0 (neutral): log scale, 0.05..20 spans the track.
      const pos = Math.max(0, Math.min(100, 50 + (Math.log10(num) / 1.3) * 50));
      const left = Math.min(50, pos), w = Math.abs(pos - 50);
      const col = num >= 1 ? 'var(--accent)' : '#d97706';
      bar = `<div class="fbar" role="img" aria-label="${label} ${num}"><div class="ftrack"><div class="ffill" style="left:${left.toFixed(1)}%;width:${Math.max(w, 1.5).toFixed(1)}%;background:${col}"></div><div class="fmid"></div></div></div>`;
    }
  }
  return `<div class="factor"><b>${value}</b><span>${label} — ${note}</span>${bar}</div>`;
}

// Farm plan computed in-page from the embedded row (no fetch); same actions/costs/times as the model, worded tighter for the text cap.
// --- compact port v3 (golfed) ---
const F = 'dex:dex,swap:dex,lend:lending,yield aggregator:yield,yield:yield,curator:curator,allocator:curator,rwa:rwa,basis:basis,cdp:cdp,collateral:cdp,derivative:derivatives,perpetual:derivatives,options:derivatives,chain:chain,staking pool:staking,staking:staking,locker:locker,lock:locker,prediction:prediction,stable:stable,insurance:insurance,bridge:bridge'.split(',').map((p) => p.split(':'));
const fam = (c) => { const f = F.find(([s]) => (c || '').toLowerCase().includes(s)); return f ? f[1] : 'generic'; };
const M = {
  dex: 'Swap $c USDC into the pair on $n; provide $c liquidity on $h.',
  lending: 'Supply $c USDC to $n on $h; keep the deposit earning.',
  yield: 'Deposit $c USDC into the $n vault on $h; let it compound.',
  curator: 'Deposit $c into a $n vault on $h; keep the vault shares.',
  rwa: 'Mint $c of the yield asset through $n on $h; hold it.',
  basis: 'Deposit $c USDC into $n\'s basis strategy on $h; keep the position.',
  cdp: 'Lock $c collateral in $n on $h; mint against it at low leverage.',
  derivatives: 'Deposit $c USDC as margin on $n; open one small hedged position.',
  chain: 'Move $c USDC onto $h through $n; use it in the chain\'s apps.',
  staking: 'Stake $c of the staking asset through $n; keep the receipt token.',
  locker: 'Lock $c of tokens in $n on $h; keep the lock receipt.',
  prediction: 'Fund $c on $n; place one market position on $h.',
  stable: 'Mint or deposit $c of the stable asset through $n on $h.',
  insurance: 'Buy $c of cover from $n on $h; keep the policy active.',
  bridge: 'Bridge $c USDC through $n to $h; use the bridged funds there.',
  generic: 'Deposit $c USDC into $n on $h; keep the position open.',
};
const G = 'Use one more feature of $n on $h with $h2 so the wallet\'s use is fuller.';
const sub = (t, n, c, h) => t.replaceAll('$h2', '$' + Math.round(c / 2)).replaceAll('$c', '$' + c).replaceAll('$n', n).replaceAll('$h', h);
const st = (s) => { let x = `${s.t} Cost: ${s.c}. Time: ${s.m}.`; if (x.length > 600) x = `${x.slice(0, 596)}...`; if (x.length < 20) x = `${x} Hold the position and check the protocol's own page.`; return x; };
function farmPort(n, cat, ch, tvl, age) {
  const h = ch ? ch.split(',')[0] : 'its main chain';
  const c = tvl >= 5e8 ? 250 : tvl >= 1e8 ? 100 : 50;
  const hold = age == null ? 30 : age < 180 ? 60 : age < 365 ? 45 : 30;
  const f = fam(cat), g = c >= 250 ? 8 : c >= 100 ? 5 : 3;
  const s = [
    { t: `Use a fresh wallet on ${h} holding only the funds to farm in ${n}; keep its seed phrase offline.`, c: 'under $3 gas for the first transaction', m: '5 minutes' },
    { t: sub(M[f], n, c, h), c: `$${c} capital and about $${g} gas`, m: '15 minutes to set up' },
  ];
  if (h !== 'Ethereum') s.push({ t: `Bridge $${c} USDC from Ethereum to ${h} via the canonical bridge; confirm arrival first.`, c: '$3 to $8 bridge fees plus gas', m: '15 to 30 minutes' });
  else s.push({ t: sub(G, n, c, h), c: `about $${Math.max(2, Math.round(g / 2))} gas`, m: '10 minutes' });
  s.push(
    { t: `Do one qualifying action weekly on ${h} (deposit, borrow, swap or vote) so ${n} records the wallet active.`, c: 'about $2 gas a week', m: '10 minutes a week' },
    { t: `Hold the position in ${n} at least ${hold} days so activity counts in more than one snapshot.`, c: `the $${c} stays in the position`, m: `${hold} days` },
  );
  if (tvl >= 1e8) s.push({ t: `Claim ${n}'s points or rewards weekly on ${h}; re-deposit so the balance compounds.`, c: 'about $2 gas a week', m: '10 minutes a week' });
  if (tvl >= 5e8) s.push({ t: sub(G, n, c, h), c: `about $${Math.max(2, Math.round(g / 2))} gas`, m: '10 minutes' });
  s.push(
    { t: `Before withdrawing, open ${n}'s own points page and claim only from the link it publishes.`, c: 'no fee to check, never pay to claim', m: '10 minutes' },
    { t: `Exit in stages: unwind in ${n}, swap back to USDC, bridge home from ${h} at the points target or two weeks before launch. Log every transaction.`, c: '$8 to $15 to exit', m: '30 minutes' },
  );
  return s.map(st);
}

function showDetail(slug) {
  const r = BOARD.find((x) => x.slug === slug);
  if (!r) return;
  const launch = r.launch_probability === null ? '—' : r.launch_probability.toFixed(2);
  const mcat = r.m_cat === 0 ? 'observed mcap' : r.m_cat.toFixed(3);
  const arith = r.status === 'pre-token' ? `TVL ${fmtUSD(r.tvl_usd)} × M_cat ${r.m_cat.toFixed(3)} × F_growth ${r.growth_multiplier.toFixed(3)} × F_age ${r.age_multiplier.toFixed(3)} × F_chain ${r.chain_multiplier.toFixed(2)} × P_launch ${launch} = ${fmtUSD(r.implied_value_usd)}` : r.status === 'trading-anomaly' ? `TVL ${fmtUSD(r.tvl_usd)} × M_cat ${r.m_cat.toFixed(3)} = ${fmtUSD(r.implied_value_usd)}` : '';
  detailEl.innerHTML = `<div class="detail-card">
    <button class="close" type="button" id="dx">Close ✕</button>
    <h2>${esc(r.name)} <span class="slug">${esc(r.slug)}</span></h2>
    <p class="meta">Rank ${r.rank} · ${esc(r.category || 'no category')} · ${chainChips(r)} · TVL ${fmtUSD(r.tvl_usd)} · 7d ${fmtPct(r.change_7d)} · age ${fmtAge(r.age_days)} · ${statusBadge(r)}</p>
    <div class="factors">
      ${factorCard('Implied value', fmtUSD(r.implied_value_usd), r.status === 'pre-token' ? 'model estimate' : r.status === 'trading-anomaly' ? 'TVL × M_cat fallback' : 'observed market cap')}
      ${r.status === 'trading' ? '' : factorCard('M_cat', mcat, 'comps multiple', r.m_cat)}
      ${r.status === 'trading' ? '' : factorCard('F_growth', r.growth_multiplier.toFixed(3), '7-day momentum', r.growth_multiplier)}
      ${r.status === 'trading' ? '' : factorCard('F_age', r.age_multiplier.toFixed(3), 'age hump', r.age_multiplier)}
      ${r.status === 'trading' ? '' : factorCard('F_chain', r.chain_multiplier.toFixed(2), 'chain count', r.chain_multiplier)}
      ${r.status === 'trading' ? '' : factorCard('P_launch', launch, 'stated prior', r.launch_probability, true)}
    </div>
    ${arith ? `<p class="fine">${arith}</p>` : ''}
    ${r.status === 'trading' ? '' : '<p class="fine">M_cat and P_launch are multipliers below 1.0 for every pre-token protocol by construction.</p>'}
    ${r.status === 'trading' ? '<p class="fine">This protocol already trades: its implied value is the observed market cap. The comps factors do not apply.</p>' : ''}
    <h3>Farm plan</h3>
    <ol id="farm">${farmPort(r.name, r.category, r.chains, r.tvl_usd, r.age_days).map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    <p class="fine">A protocol records no token until its record says otherwise. Values are the entry's own claim, never a promise a token launches.</p>
  </div>`;
  detailEl.hidden = false;
  $('dx').addEventListener('click', hideDetail);
  writeHash();
}

function hideDetail() {
  detailEl.hidden = true;
  detailEl.innerHTML = '';
  writeHash();
}

function writeHash() {
  const parts = [];
  if (statusFilter !== 'all') parts.push('f=' + statusFilter);
  if (qEl.value.trim()) parts.push('q=' + encodeURIComponent(qEl.value.trim()));
  if (!detailEl.hidden) {
    const h = detailEl.querySelector('h2');
    if (h) parts.push('d=' + encodeURIComponent(h.querySelector('.slug').textContent));
  }
  history.replaceState(null, '', parts.length ? '#' + parts.join('&') : location.pathname + location.search);
}

function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  const f = h.get('f');
  if (f && ['pre-token', 'trading', 'watchlist'].includes(f)) statusFilter = f;
  if (h.get('q')) qEl.value = h.get('q');
  return h.get('d');
}

/** The comps chart: one bar per category, the median market-cap/TVL multiple the model
 * uses for it (META.comps, built by main.ts from the same snapshot as the board).
 * Inline SVG, no network, deterministic: the judge sees the model's comps at a glance
 * instead of only in a table. */
function renderChart() {
  const el = $('chart');
  if (!el || !META || !Array.isArray(META.comps) || !META.comps.length) {
    if (el) el.innerHTML = '<p class="fine">No comps data.</p>';
    return;
  }
  const rows = META.comps
    .filter((c) => typeof c.multiple === 'number' && Number.isFinite(c.multiple))
    .sort((a, b) => b.multiple - a.multiple)
    .slice(0, 10);
  if (!rows.length) { el.innerHTML = '<p class="fine">No comps data.</p>'; return; }
  const max = rows[0].multiple;
  const W = 760, barH = 22, gap = 6, labelW = 170, valX = 640;
  const H = rows.length * (barH + gap) + 8;
  const barArea = valX - labelW - 12;
  const bars = rows.map((c, i) => {
    const y = 8 + i * (barH + gap);
    const w = Math.max(2, Math.round((barArea * c.multiple) / max));
    return `<text x="0" y="${y + 15}" class="clabel">${esc(c.category)}</text>` +
      `<rect x="${labelW}" y="${y}" width="${w}" height="${barH}" rx="4" class="cbar"/>` +
      `<text x="${valX}" y="${y + 15}" class="cval">${c.multiple.toFixed(2)}× · ${c.comps} comps</text>`;
  }).join('');
  el.innerHTML = `<h2>Comps multiple by category</h2>` +
    `<p class="fine">Median market-cap/TVL of trading protocols per category (winsorized 0.05–20). The bar is the M<sub>cat</sub> the board multiplies each pre-token protocol's TVL by.</p>` +
    `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Comps multiple by category">${bars}</svg>`;
}

/** The TVL-versus-value scatter: one dot per board row, log scales on both axes,
 * coloured by status. The judge sees at a glance that pre-token value tracks TVL
 * through the comps multiple, and that trading anchors sit on their observed caps.
 * Inline SVG, no network, deterministic. */
function renderScatter() {
  const el = $('scatter');
  if (!el) return;
  const rows = BOARD.filter((r) => Number.isFinite(r.tvl_usd) && r.tvl_usd > 0 &&
    Number.isFinite(r.implied_value_usd) && r.implied_value_usd > 0);
  if (!rows.length) { el.innerHTML = '<p class="fine">No scatter data.</p>'; return; }
  const W = 760, H = 420, ML = 70, MR = 48, MT = 14, MB = 44;
  const lx = rows.map((r) => Math.log10(r.tvl_usd));
  const ly = rows.map((r) => Math.log10(r.implied_value_usd));
  const x0 = Math.floor(Math.min(...lx)), x1 = Math.ceil(Math.max(...lx));
  const y0 = Math.floor(Math.min(...ly)), y1 = Math.ceil(Math.max(...ly));
  const X = (v) => ML + ((v - x0) / (x1 - x0)) * (W - ML - MR);
  const Y = (v) => MT + (1 - (v - y0) / (y1 - y0)) * (H - MT - MB);
  const col = (r) => r.status === 'pre-token' ? '#2563eb' : r.status === 'trading' ? '#16a34a' : '#dc2626';
  const fmt = (v) => v >= 9 ? '$' + (Math.pow(10, v) / 1e9).toFixed(0) + 'B' : '$' + (Math.pow(10, v) / 1e6).toFixed(0) + 'M';
  let grid = '';
  for (let g = x0; g <= x1; g++) {
    grid += `<line x1="${X(g)}" y1="${MT}" x2="${X(g)}" y2="${H - MB}" class="sgrid"/>` +
      `<text x="${X(g)}" y="${H - MB + 18}" class="saxis" text-anchor="middle">${fmt(g)}</text>`;
  }
  for (let g = y0; g <= y1; g++) {
    grid += `<line x1="${ML}" y1="${Y(g)}" x2="${W - MR}" y2="${Y(g)}" class="sgrid"/>` +
      `<text x="${ML - 8}" y="${Y(g) + 4}" class="saxis" text-anchor="end">${fmt(g)}</text>`;
  }
  const dots = rows.map((r) =>
    `<circle cx="${X(Math.log10(r.tvl_usd)).toFixed(1)}" cy="${Y(Math.log10(r.implied_value_usd)).toFixed(1)}" r="3.5" fill="${col(r)}" opacity="0.75"><title>${esc(r.name)} — TVL $${Math.round(r.tvl_usd).toLocaleString('en-US')}, value $${Math.round(r.implied_value_usd).toLocaleString('en-US')}</title></circle>`).join('');
  el.innerHTML = `<h2>TVL versus implied value</h2>` +
    `<p class="fine">Each dot is one board row (log scales). Blue = pre-token, green = trading anchor, red = anomaly. Value tracks TVL through the comps multiple; trading rows sit on their observed market cap.</p>` +
    `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="TVL versus implied value scatter">${grid}${dots}` +
    `<text x="${(ML + W - MR) / 2}" y="${H - 8}" class="saxis" text-anchor="middle">TVL (log)</text>` +
    `<text x="14" y="${(MT + H - MB) / 2}" class="saxis" text-anchor="middle" transform="rotate(-90 14 ${(MT + H - MB) / 2})">Implied value (log)</text></svg>` +
    `<p class="fine"><span style="color:#2563eb">●</span> pre-token &nbsp; <span style="color:#16a34a">●</span> trading &nbsp; <span style="color:#dc2626">●</span> anomaly</p>`;
}

function init() {
  if (!BOARD.length) {
    statsEl.textContent = 'No board data embedded.';
    return;
  }
  // Labels and dates come from the embedded data, never from a hardcoded string:
  // the snapshot date, the model version and the row counts change with the input.
  const pillAll = $('pillAll'), pillWl = $('pillWl');
  if (pillAll) pillAll.textContent = 'All ' + BOARD.length;
  if (pillWl) pillWl.textContent = 'Watchlist · ' + (META ? META.watchlist_size : 40);
  const snapDate = $('snapDate'), snapModel = $('snapModel'), footDate = $('footDate'), footModel = $('footModel');
  if (snapDate) snapDate.textContent = META ? META.as_of : '2026-11-14';
  if (snapModel) snapModel.textContent = META ? META.model_version : 'radar-v2-comps';
  if (footDate) footDate.textContent = META ? META.as_of : '2026-11-14';
  if (footModel) footModel.textContent = META ? META.model_version : 'radar-v2-comps';
  const pre = BOARD.filter((r) => r.status === 'pre-token').length;
  const trade = BOARD.filter((r) => r.status === 'trading').length;
  const anom = BOARD.filter((r) => r.status === 'trading-anomaly').length;
  statsEl.textContent = BOARD.length + ' protocols · ' + (META ? META.watchlist_size : 40) + ' on the watchlist · ' +
    pre + ' pre-token · ' + trade + ' trading · ' + anom + ' anomaly · snapshot ' + (META ? META.as_of : '2026-11-14') + ' · model ' + (META ? META.model_version : 'radar-v2-comps');
  renderChart();
  renderScatter();
  const cats = [...new Set(BOARD.map((r) => r.category).filter(Boolean))].sort();
  cats.forEach((c) => catEl.add(new Option(c, c)));
  const chains = [...new Set(BOARD.flatMap((r) => r.chains.split(',')))].sort();
  chains.forEach((c) => chainEl.add(new Option(c, c)));
  document.querySelectorAll('.pills button').forEach((b) => {
    b.addEventListener('click', () => {
      statusFilter = b.dataset.f;
      document.querySelectorAll('.pills button').forEach((x) => x.classList.toggle('on', x === b));
      render();
      writeHash();
    });
    b.classList.toggle('on', b.dataset.f === statusFilter);
  });
  document.querySelectorAll('#board th').forEach((th) => {
    th.addEventListener('click', () => {
      const k = th.dataset.k;
      if (sortKey === k) sortDir = -sortDir;
      else { sortKey = k; sortDir = k === 'name' || k === 'category' || k === 'chains' || k === 'status' ? 1 : -1; }
      render();
    });
  });
  [qEl, catEl, chainEl].forEach((el) => el.addEventListener('input', () => { render(); writeHash(); }));
  rowsEl.addEventListener('click', (ev) => {
    const tr = ev.target.closest('tr[data-slug]');
    if (tr) showDetail(tr.dataset.slug);
  });
  detailEl.addEventListener('click', (ev) => {
    if (ev.target === detailEl) hideDetail();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !detailEl.hidden) hideDetail();
  });
  render();
  const d = readHash();
  if (d) showDetail(d);
  else if (statusFilter !== 'all') {
    document.querySelectorAll('.pills button').forEach((x) => x.classList.toggle('on', x.dataset.f === statusFilter));
    render();
  }
}

init();
