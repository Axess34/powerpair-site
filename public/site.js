/* PowerPair site logic: calculator, rebate checker, lead form.
   All figures are indicative estimates. Scheme settings checked 23 Nov 2026; review every quarter. */
{
const CONFIG = {
  // Leave blank to use Netlify Forms. On 20i (or anywhere else), paste a form endpoint
  // (Formspree, Make/Zapier webhook, your CRM) and submissions are POSTed there as multipart form data.
  WEBHOOK_URL: '',
  STC_PRICE: 37,          // $ per STC, market estimate; installers quote the real value
  FEED_IN: 0.05,          // $/kWh typical business feed-in credit
  FIXED_SHARE: 0.15,      // share of a bill that is supply/fixed charges, not usage
  CYCLES: 300,            // battery cycles per year assumed
  APR: 8.0                // example business-loan rate, % p.a. Not an offer; lenders set the real rate
};

// zone = postcode zone rating (MWh per kW per year) for the capital; rate = typical small-business blended $/kWh
const STATES = {
  NSW:{name:'New South Wales',zone:1.382,rate:0.30},
  VIC:{name:'Victoria',zone:1.185,rate:0.28},
  QLD:{name:'Queensland',zone:1.382,rate:0.29},
  SA:{name:'South Australia',zone:1.382,rate:0.36},
  WA:{name:'Western Australia',zone:1.382,rate:0.30},
  TAS:{name:'Tasmania',zone:1.185,rate:0.27},
  ACT:{name:'Australian Capital Territory',zone:1.382,rate:0.26},
  NT:{name:'Northern Territory',zone:1.536,rate:0.28}
};
// federal battery STC factor by install window
const BATT_FACTOR = {'2026':6.8,'2027a':5.7,'2027b':5.2};
const WINDOW_LABEL = {'2026':'by 31 Dec 2026','2027a':'Jan to Jun 2027','2027b':'Jul to Dec 2027'};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const money = n => (n < 0 ? '-$' : '$') + Math.round(Math.abs(n)).toLocaleString('en-AU');
const r5 = n => Math.max(5, Math.round(n / 5) * 5);
const val = (form, name) => { const el = form.elements[name]; return el ? (el.value ?? '') : ''; };
const store = {
  get(k){ try { return JSON.parse(sessionStorage.getItem('pp_' + k)); } catch(e){ return null; } },
  set(k, v){ try { sessionStorage.setItem('pp_' + k, JSON.stringify(v)); } catch(e){} }
};

/* ---------- calculator ---------- */
function repayment(principal, apr, years){
  const n = years * 12, r = apr / 100 / 12;
  if (!principal || !n) return 0;
  return r ? principal * r / (1 - (1 + r) ** -n) : principal / n;
}
function finance(e, apr, years){
  const today = e.annualBill / 12;
  const after = Math.max(0, (e.annualBill - e.save) / 12);
  const pay = repayment(e.net, apr, years);
  const withLoan = after + pay;
  return {today, after, pay, withLoan, diff: today - withLoan, total: pay * years * 12, years, apr};
}
function batteryStcs(usable, factor){
  const t1 = Math.min(usable, 14), t2 = Math.min(Math.max(usable - 14, 0), 14), t3 = Math.min(Math.max(usable - 28, 0), 22);
  return Math.floor((t1 + t2 * 0.6 + t3 * 0.15) * factor);
}

function estimate(i){
  const st = STATES[i.state] || STATES.NSW;
  const rate = i.rate > 0 ? i.rate : st.rate;
  const annualBill = i.bill * (i.period === 'q' ? 4 : 12);
  const annualKWh = annualBill * (1 - CONFIG.FIXED_SHARE) / rate;
  const dayShare = {day:0.7, ext:0.55, all:0.4}[i.hours] || 0.6;
  const yieldPerKW = st.zone * 1000;
  const roofCap = {s:30, m:100, l:200, xl:400}[i.roof] || 100;
  const wantSolar = i.scope !== 'batt';
  const existingKW = Math.max(0, i.solar || 0);
  const notes = [];

  let solarKW = 0;
  if (wantSolar){ solarKW = Math.min(roofCap, r5(annualKWh * 0.6 / yieldPerKW)); }
  let battKWh = Math.min(200, r5(annualKWh / 365 * (1 - dayShare) * 0.7));
  if (battKWh < 10) battKWh = 10;
  const hasSolarAfter = existingKW + solarKW > 0;

  const solarCost = solarKW * (solarKW > 100 ? 1000 : 1100);
  const battCost = battKWh * 750;
  const gross = solarCost + battCost;

  // federal solar STCs (SRES): small-scale deeming 5 yrs to 31 Dec 2026, 4 yrs from 1 Jan 2027; 100 kW to 1 MW fixed 5 yrs
  let solarReb = 0;
  if (solarKW > 0){
    const deem = solarKW > 100 ? 5 : (i.when === '2026' ? 5 : 4);
    solarReb = Math.floor(solarKW * st.zone * deem) * CONFIG.STC_PRICE;
  }
  // federal battery STCs (Cheaper Home Batteries): needs solar, 5 to 100 kWh nominal
  let battReb = 0;
  const nominal = battKWh / 0.9;
  if (!hasSolarAfter) notes.push('The federal battery rebate needs solar on site (new or existing). Add solar to qualify.');
  else if (nominal > 100) notes.push('Batteries over 100 kWh nominal get no federal battery rebate. In NSW the state discount still applies.');
  else battReb = batteryStcs(battKWh, BATT_FACTOR[i.when] || 5.7) * CONFIG.STC_PRICE;

  // state schemes
  let stateReb = 0, stateName = '';
  if (i.state === 'NSW' && battKWh > 20){
    const withSolar = solarKW >= battKWh * 0.25;
    stateReb = battCost * (withSolar ? 0.30 : 0.20);
    stateReb = Math.min(stateReb, Math.max(0, battCost - battReb - 5000));
    stateName = 'NSW PDRS business battery discount';
    notes.push('NSW figure uses the low end of the published range (' + (withSolar ? '30 to 40% with new solar' : '20 to 30% battery only') + '). A $5,000 minimum customer payment applies.');
  }
  if (i.state === 'VIC' && solarKW >= 30 && solarKW <= 200){
    stateReb = solarKW * 91;
    stateName = 'VEU commercial solar discount';
    notes.push('VIC figure is a conservative $91/kW. The scheme goes up to $34,300 for a 200 kW system.');
  }
  const rebates = solarReb + battReb + stateReb;
  const net = Math.max(0, gross - rebates);

  // savings
  const dayLoad = annualKWh * dayShare;
  const gen = solarKW * yieldPerKW, oldGen = existingKW * yieldPerKW;
  const selfUse = Math.min(gen, Math.max(0, dayLoad - oldGen));
  const excess = Math.max(0, gen + oldGen - dayLoad);
  const battThroughput = battKWh * 0.9 * CONFIG.CYCLES;
  const fromSolar = Math.min(battThroughput, excess);
  const fromGrid = battThroughput - fromSolar;
  const solarSave = selfUse * rate + Math.max(0, gen - selfUse - fromSolar) * CONFIG.FEED_IN;
  const battSave = fromSolar * (rate - CONFIG.FEED_IN) + fromGrid * rate * 0.3;
  const save = solarSave + battSave;
  const payback = save > 0 ? net / save : 0;

  return {st, rate, annualBill, annualKWh, solarKW, battKWh, gross, solarReb, battReb, stateReb, stateName, rebates, net, save, payback, notes, dayShare, existingKW, window:WINDOW_LABEL[i.when]};
}

function renderCalc(form, out){
  const i = {
    state: val(form,'state'), bill: +val(form,'bill') || 0, period: val(form,'period'),
    hours: val(form,'hours'), solar: +val(form,'solar') || 0, roof: val(form,'roof'),
    scope: val(form,'scope'), when: val(form,'when'), rate: (+val(form,'rate') || 0) / 100,
    term: +val(form,'term') || 0, apr: val(form,'apr') === '' ? CONFIG.APR : +val(form,'apr')
  };
  if (!i.bill){ out.innerHTML = '<p class="sub">Enter your power bill to see an estimate.</p>'; return; }
  const e = estimate(i);
  let fin = null;
  const pct = x => Math.max(0, Math.min(100, x / e.gross * 100)).toFixed(1) + '%';
  out.innerHTML = `
    <p style="font-weight:600;color:var(--soft)">Estimated saving per year</p>
    <div class="big">${money(e.save)}</div>
    <p class="hint">Payback about ${e.payback ? e.payback.toFixed(1) : '–'} years on an indicative ${e.solarKW ? e.solarKW + ' kW solar + ' : ''}${e.battKWh} kWh battery, installed ${e.window}.</p>
    ${i.term ? (() => { const f = finance(e, i.apr, i.term); const mx = Math.max(f.today, f.withLoan, 1); const bar = (lbl, v, col, sub) => `<div class="mrow"><div class="mlbl"><span>${lbl}</span><b>${money(v)}<small>/mo</small></b></div><div class="mtrack"><div style="width:${(v/mx*100).toFixed(1)}%;background:${col}"></div></div>${sub ? `<p class="hint">${sub}</p>` : ''}</div>`;
      fin = f; return `<div class="fin">
      <h3>${f.diff >= 0 ? `Swap the bill, keep the asset: about ${money(f.diff)} a month less than today` : `Financed, it costs about ${money(-f.diff)} a month more than today, at first`}</h3>
      ${bar('Your bill today', f.today, '#8aa0b5')}
      ${bar(`With finance, years 1 to ${f.years}`, f.withLoan, f.diff >= 0 ? '#13a3a8' : '#f5a524', `New bill ${money(f.after)} + repayment ${money(f.pay)} on ${money(e.net)} over ${f.years} years at ${f.apr}% p.a.`)}
      ${bar(`After year ${f.years}: loan paid off, you own the system`, f.after, '#0f2a4a')}
      ${f.diff < 0 ? `<p class="hint">Try a longer term, or ask about demand charges in the Bill Audit; they often add savings this estimate leaves out.</p>` : ''}
      </div>`; })() : ''}
    <div class="strip" role="img" aria-label="Rebates ${money(e.rebates)} of a ${money(e.gross)} system">
      <div style="width:${pct(e.rebates)};background:#13a3a8"></div><div style="width:${pct(e.net)};background:#0f2a4a"></div></div>
    <div class="legend"><span><i style="background:#13a3a8"></i>Rebates ${money(e.rebates)}</span><span><i style="background:#0f2a4a"></i>You pay ${money(e.net)}</span></div>
    <div class="kv">
      <span>System price (indicative, ex GST)</span><span>${money(e.gross)}</span>
      ${e.solarReb ? `<span>Federal solar rebate (STCs)</span><span class="neg">-${money(e.solarReb)}</span>` : ''}
      ${e.battReb ? `<span>Federal battery rebate (STCs)</span><span class="neg">-${money(e.battReb)}</span>` : ''}
      ${e.stateReb ? `<span>${e.stateName}</span><span class="neg">-${money(e.stateReb)}</span>` : ''}
      <span class="tot">Indicative cost after rebates</span><span class="tot">${money(e.net)}</span>
    </div>
    ${e.notes.map(n => `<div class="warnbox">${n}</div>`).join('')}
    <details><summary>Show the workings</summary><ul>
      <li>Annual bill ${money(e.annualBill)}; ${Math.round(CONFIG.FIXED_SHARE*100)}% treated as fixed charges; usage ≈ ${Math.round(e.annualKWh).toLocaleString('en-AU')} kWh at ${(e.rate*100).toFixed(0)}c/kWh.</li>
      <li>${Math.round(e.dayShare*100)}% of use assumed in daylight for your operating hours.</li>
      <li>Solar sized to about 60% of annual use, capped by roof; ${e.st.zone} MWh per kW per year (capital-city zone rating).</li>
      <li>Prices assumed: solar $1,100/kW (≤100 kW) or $1,000/kW above; battery $750 per usable kWh. Real quotes vary ±15% or more.</li>
      <li>STCs valued at $${CONFIG.STC_PRICE} each. Battery STC factor ${BATT_FACTOR[val(form,'when')]} per usable kWh, tiered 100/60/15% at 14 and 28 kWh, first 50 kWh only.</li>
      <li>Battery does ${CONFIG.CYCLES} cycles a year at 90% efficiency, charged first from spare solar (worth your rate minus a ${CONFIG.FEED_IN*100}c feed-in), then off-peak grid (worth 30% of your rate).</li>
      <li>Finance: monthly repayment on the after-rebate price (ex GST) at the rate and term you choose, $0 upfront. The ${CONFIG.APR}% default is an example only; your lender sets the real rate, fees and approval. Not a credit offer. GST and tax treatment: ask your accountant.</li>
      <li>The new bill assumes today's prices stay the same. If prices rise, the gap in your favour gets bigger.</li>
      <li>Not included: demand-charge savings, loan fees, tariff changes, depreciation. The free Bill Audit checks these from your actual bill.</li>
    </ul></details>
    <a class="btn cta" style="width:100%;margin-top:18px" href="audit.html">Get my free Bill Audit</a>`;
  store.set('calc', {state:i.state, bill:i.bill, period:i.period, estSave:Math.round(e.save), estRebates:Math.round(e.rebates), system:`${e.solarKW}kW solar + ${e.battKWh}kWh battery`,
    monthToday: fin && Math.round(fin.today), monthFinanced: fin && Math.round(fin.withLoan), term: fin && fin.years, apr: fin && fin.apr});
}

const calcForm = $('#calc-form');
if (calcForm){
  const out = $('#calc-out');
  const run = () => renderCalc(calcForm, out);
  calcForm.addEventListener('input', run);
  calcForm.addEventListener('change', () => {
    const s = STATES[val(calcForm,'state')]; const r = calcForm.elements.rate;
    if (s && r && !r.dataset.touched) r.placeholder = Math.round(s.rate * 100);
    run();
  });
  calcForm.elements.rate?.addEventListener('input', e => e.target.dataset.touched = 1);
  calcForm.addEventListener('submit', e => e.preventDefault());
  calcForm.dispatchEvent(new Event('change'));
}

/* ---------- rebate checker ---------- */
function schemes(a){
  const out = [];
  const st = a.state, biz = a.site !== 'home', solarSoon = a.solar === 'yes' || a.plan !== 'batt';
  const batt = a.plan !== 'solar', size = a.size;
  // federal battery
  if (batt){
    if (!solarSoon) out.push(['Federal battery rebate (Cheaper Home Batteries)','m','Needs solar on site. Add solar with the battery, or it won\'t qualify.']);
    else if (size === 'xl') out.push(['Federal battery rebate (Cheaper Home Batteries)','n','Batteries over 100 kWh nominal get no federal battery rebate.']);
    else out.push(['Federal battery rebate (Cheaper Home Batteries)','y','Homes and small businesses with solar, batteries 5 to 100 kWh. Taken off your quote by the installer. Steps down on 1 Jan 2027 and again 1 Jul 2027.']);
  }
  if (a.plan !== 'batt') out.push(['Federal solar rebate (STCs)','y','Applies to new solar, now up to 1 MW. For systems up to 100 kW it drops from 5 to 4 years of certificates on 1 Jan 2027.']);
  if (st === 'NSW' && batt){
    if (!biz) out.push(['NSW PDRS business battery discount','n','For business premises. Homes use the federal rebate and NSW VPP incentive.']);
    else if (size === 's') out.push(['NSW PDRS business battery discount','m','Starts above 20 kWh. A slightly larger battery may unlock it.']);
    else out.push(['NSW PDRS business battery discount','y','About 20 to 30% off a battery, or 30 to 40% with new solar installed within 90 days. Stacks with the federal rebate up to 100 kWh. Minimum customer payment $5,000.']);
  }
  if (st === 'VIC'){
    if (a.plan === 'batt') out.push(['VEU commercial solar discount','n','Covers new solar of 30 to 200 kW, not batteries.']);
    else if (!biz) out.push(['VEU commercial solar discount','n','For commercial and industrial premises.']);
    else out.push(['VEU commercial solar discount','y','Up to $34,300 off new solar of 30 to 200 kW on commercial premises.']);
  }
  if (st === 'WA') out.push(['WA Residential Battery Scheme', a.site === 'business' ? 'n' : 'm', a.site === 'business' ? 'Households only, not business premises.' : 'Household rebate and no-interest loan. May apply if the battery is at your home.']);
  if (st === 'ACT') out.push(['ACT Sustainable Business Program','m','Free assessment plus rebates on some upgrades. Check what is covered before you quote.']);
  if (st === 'QLD') out.push(['QBEST business rebate','n','Closed to new applications. Federal rebates still apply.']);
  if (st === 'NT') out.push(['NT Home and Business Battery Scheme','n','Funding cap reached; closed to new grants. Federal rebates still apply.']);
  if (['SA','TAS'].includes(st)) out.push(['State rebate','n','No current state business solar or battery rebate. Federal rebates still apply.']);
  if (biz) out.push(['Instant asset write-off (tax)','m','Permanent from 1 Jul 2026 for turnover under $10M, per asset under $20,000. Most systems are depreciated instead. Ask your accountant.']);
  if (a.own === 'short') out.push(['Landlord sign-off','m','On a short lease you will need the owner\'s written OK before an installer can quote.']);
  return out;
}
const chkForm = $('#chk-form');
if (chkForm){
  const out = $('#chk-out');
  const label = {y:'Likely eligible', m:'Check', n:'Not for this setup'};
  const run = () => {
    const a = Object.fromEntries(['state','site','own','solar','plan','size'].map(k => [k, val(chkForm,k)]));
    const list = schemes(a);
    out.innerHTML = list.map(([n,t,p]) => `<div class="scheme"><div class="top"><h3>${n}</h3><span class="tag ${t}">${label[t]}</span></div><p>${p}</p></div>`).join('')
      + `<a class="btn cta" style="margin-top:6px" href="audit.html">Check these against my bill</a>`;
    store.set('chk', a);
  };
  chkForm.addEventListener('change', run);
  chkForm.addEventListener('submit', e => e.preventDefault());
  run();
}

/* ---------- lead form (Bill Audit) ---------- */
const lead = $('#audit-form');
if (lead){
  const panes = $$('.pane', lead), bars = $$('.prog div');
  let step = 0;
  const show = (n, scroll = true) => { step = n; panes.forEach((p,k) => p.hidden = k !== n); bars.forEach((b,k) => b.classList.toggle('on', k <= n)); if (scroll) lead.scrollIntoView({block:'start'}); };
  const valid = () => {
    const bad = $$('input,select', panes[step]).filter(el => !el.checkValidity());
    bad.forEach(el => el.classList.add('bad')); $$('.bad', panes[step]).filter(el => el.checkValidity()).forEach(el => el.classList.remove('bad'));
    $('.err', panes[step]).textContent = bad.length ? 'Please complete the highlighted fields.' : '';
    bad[0]?.focus();
    return !bad.length;
  };
  lead.addEventListener('click', e => {
    if (e.target.matches('[data-next]') && valid()) show(step + 1);
    if (e.target.matches('[data-back]')) show(step - 1);
  });

  // prefill from calculator, page state and UTM
  const calc = store.get('calc') || {}, q = new URLSearchParams(location.search);
  if (calc.state && lead.elements.state) lead.elements.state.value = calc.state;
  if (q.get('state') && lead.elements.state) lead.elements.state.value = q.get('state').toUpperCase();
  const set = (n, v) => { if (lead.elements[n] && v != null) lead.elements[n].value = v; };
  set('est_saving', calc.estSave); set('est_month_today', calc.monthToday); set('est_month_financed', calc.monthFinanced); set('est_finance', calc.term ? calc.term + ' yrs @ ' + calc.apr + '%' : ''); set('est_rebates', calc.estRebates); set('est_system', calc.system);
  ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','fbclid'].forEach(k => set(k, q.get(k) || ''));
  set('landing_page', document.referrer || '');
  if (calc.estSave) $('#prefill').innerHTML = `From your estimate: about <b>${money(calc.estSave)}</b> a year saved and <b>${money(calc.estRebates)}</b> in rebates on a ${calc.system}.${calc.monthFinanced ? ` Financed over ${calc.term} years: about <b>${money(calc.monthFinanced)}</b> a month against <b>${money(calc.monthToday)}</b> today.` : ''} The audit checks this against your actual bill.`;
  else $('#prefill').hidden = true;

  // lead grade from the five quality checks
  const grade = () => {
    const f = lead.elements;
    const site = ['own','long'].includes(f.premises.value);
    const dm = ['owner','director','manager'].includes(f.role.value);
    const bill = (f.bill_file.files && f.bill_file.files.length > 0) || !!f.nmi.value.trim();
    const soon = ['0-3','3-6','6-12'].includes(f.timeframe.value);
    const checks = [site, dm, true, bill, soon];
    if (checks.every(Boolean)) return 'A';
    if (site && dm && bill && !soon) return 'B';
    return 'C';
  };

  lead.addEventListener('submit', async e => {
    if (!valid()) { e.preventDefault(); return; }
    lead.elements.lead_grade.value = grade();
    const host = location.hostname;
    const onNetlify = /netlify\.app$|powerpair\.io$/.test(host) && !CONFIG.WEBHOOK_URL;
    if (onNetlify) return; // native POST to Netlify Forms, redirects to thanks.html
    e.preventDefault();
    const btn = $('[type=submit]', lead); btn.disabled = true; btn.textContent = 'Sending…';
    try {
      if (CONFIG.WEBHOOK_URL) {
        const r = await fetch(CONFIG.WEBHOOK_URL, {method:'POST', body:new FormData(lead), headers:{Accept:'application/json'}});
        if (!r.ok) throw new Error(r.status);
        location.href = 'thanks.html';
      } else {
        lead.innerHTML = '<div class="summary"><h3>Preview only</h3><p>This copy isn\'t connected to a form service, so nothing was sent. On Netlify (or with WEBHOOK_URL set in site.js) this goes through to your inbox and lands on the thank-you page.</p></div>';
      }
    } catch(err) {
      btn.disabled = false; btn.textContent = 'Send my Bill Audit request';
      $('.err', panes[step]).textContent = 'That didn\'t send. Please try again, or email hello@powerpair.io.';
    }
  });
  show(0, false);
}
}
