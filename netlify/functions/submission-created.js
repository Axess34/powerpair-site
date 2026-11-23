/* PowerPair: turns each Bill Audit form submission into formatted emails.
   Netlify runs this automatically after every verified form submission (event: submission-created).

   Environment variables (Netlify > Site configuration > Environment variables):
     RESEND_API_KEY     your Resend API key (resend.com, free plan is enough to start)
     LEAD_TO            where leads go, e.g. james@powerpair.io (comma-separate for several)
     LEAD_FROM          verified sender, e.g. "PowerPair Leads <leads@powerpair.io>"
     SEND_CONFIRMATION  "true" to also email the customer a short confirmation (optional)

   Emails sent per submission:
     1. Lead email to you: everything, incl. lead grade, estimate and ad source. Reply goes to the customer.
     2. Installer hand-off to you (only when the customer asked for a quote): customer-facing details only,
        nothing internal, written to be forwarded to an installer as is.
     3. Optional confirmation to the customer. */

const BRAND = { navy: '#0F2A4A', teal: '#13A3A8', amber: '#F5A524', soft: '#4A5D70', line: '#DCE3E8', bg: '#F4F7F8' };
const STATES = { NSW: 'New South Wales', VIC: 'Victoria', QLD: 'Queensland', SA: 'South Australia', WA: 'Western Australia', TAS: 'Tasmania', ACT: 'Australian Capital Territory', NT: 'Northern Territory' };
const PREMISES = { own: 'Owned by the business', long: 'Leased, 5+ years left', short: 'Leased, under 5 years left (landlord sign-off needed)', unsure: 'Not sure' };
const ROLES = { owner: 'Owner', director: 'Director / CFO', manager: 'Operations or facilities manager', other: 'Other' };
const TIMES = { '0-3': 'Within 3 months', '3-6': '3 to 6 months', '6-12': '6 to 12 months', '12+': 'Over 12 months / researching' };
const GRADE = {
  A: ['Grade A: send now', '#0F7A52', 'All five checks pass: site control, decision-maker, covered area, bill evidence, acting within 12 months.'],
  B: ['Grade B: call first', '#9A5B00', 'Everything except timing. Call to confirm when they want to act.'],
  C: ['Grade C: nurture', '#8A2F2F', 'One or more checks missing. Send the audit and education emails before any installer intro.']
};

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = v => (v === '' || v == null || isNaN(+v)) ? '' : '$' + Math.round(+v).toLocaleString('en-AU');
const when = iso => new Date(iso || Date.now()).toLocaleString('en-AU', { timeZone: 'Australia/Sydney', dateStyle: 'medium', timeStyle: 'short' }) + ' Sydney time';

function billFile(d) {
  const f = d.bill_file;
  if (!f) return null;
  if (typeof f === 'string') return f.startsWith('http') ? { url: f, filename: 'power-bill' } : null;
  const url = f.url || f.path;
  return url ? { url, filename: f.filename || f.name || 'power-bill', size: f.size } : null;
}

const row = (k, v) => v ? `<tr><td style="padding:7px 0;color:${BRAND.soft};width:42%;vertical-align:top">${esc(k)}</td><td style="padding:7px 0;font-weight:600;vertical-align:top">${v}</td></tr>` : '';
const section = (title, rows) => {
  const body = rows.filter(Boolean).join('');
  return body ? `<h2 style="font-size:16px;margin:26px 0 6px;color:${BRAND.navy}">${esc(title)}</h2><table role="presentation" width="100%" style="border-collapse:collapse;border-top:1px solid ${BRAND.line};font-size:15px">${body}</table>` : '';
};
const shell = (inner, footer) => `<!doctype html><html><body style="margin:0;background:${BRAND.bg};font-family:Arial,Helvetica,sans-serif;color:${BRAND.navy}">
<table role="presentation" width="100%" style="background:${BRAND.bg}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="640" style="max-width:640px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden">
<tr><td style="background:${BRAND.navy};padding:18px 26px;font-size:22px;font-weight:800;color:#ffffff">Power<span style="color:#3FD0D4">Pair</span> <span style="font-size:13px;font-weight:400;color:#B9C7D6">Solar + storage, explained.</span></td></tr>
<tr><td style="padding:22px 26px 28px">${inner}</td></tr>
<tr><td style="padding:14px 26px;background:${BRAND.bg};font-size:12px;color:${BRAND.soft}">${footer}</td></tr>
</table></td></tr></table></body></html>`;

function customerBlocks(d, bill) {
  const st = d.state ? `${STATES[d.state] || d.state} ${esc(d.postcode)}` : esc(d.postcode);
  return [
    section('Contact', [
      row('Name', esc(d.name)), row('Role', esc(ROLES[d.role] || d.role)), row('Business', esc(d.business)),
      row('ABN', esc(d.abn)), row('Email', `<a href="mailto:${esc(d.email)}" style="color:${BRAND.teal}">${esc(d.email)}</a>`),
      row('Mobile', `<a href="tel:${esc(String(d.phone || '').replace(/\s/g, ''))}" style="color:${BRAND.teal}">${esc(d.phone)}</a>`)
    ]),
    section('Site', [
      row('Location', st), row('Business type', esc(d.biz_type)), row('Premises', esc(PREMISES[d.premises] || d.premises)),
      row('Existing solar', esc(d.has_solar)), row('Typical power bill', esc(d.bill_band)),
      row('NMI', esc(d.nmi)), row('Power bill', bill ? 'Attached to this email' : 'Not uploaded')
    ]),
    section('What they want', [
      row('Interested in', esc(d.interest)), row('Install timing', esc(TIMES[d.timeframe] || d.timeframe)),
      row('How they would pay', esc(d.pay_pref))
    ]),
    section("Estimate they saw on powerpair.io (indicative, not a quote)", [
      row('Suggested system', esc(d.est_system)), row('Rebates estimated', money(d.est_rebates)),
      row('Saving per year', money(d.est_saving)), row('Monthly bill today', money(d.est_month_today)),
      row('Monthly with finance', d.est_month_financed ? `${money(d.est_month_financed)} (${esc(d.est_finance)}, example rate)` : '')
    ])
  ].join('');
}

function leadEmail(d, bill, created) {
  const g = GRADE[d.lead_grade] || GRADE.C;
  const quote = d.want_quote === 'yes';
  const inner = `
  <p style="margin:0 0 6px;font-size:13px;color:${BRAND.soft}">New Bill Audit request · ${esc(when(created))}</p>
  <h1 style="margin:0 0 14px;font-size:24px">${esc(d.business || d.name)}${d.state ? ' · ' + esc(d.state) : ''}</h1>
  <table role="presentation" width="100%" style="border-collapse:separate;border-spacing:0 8px"><tr>
    <td style="background:${g[1]};color:#fff;border-radius:10px;padding:12px 14px;font-weight:700;width:50%">${g[0]}<div style="font-weight:400;font-size:13px;margin-top:4px">${g[2]}</div></td>
    <td style="width:12px"></td>
    <td style="background:${quote ? BRAND.teal : BRAND.bg};color:${quote ? '#fff' : BRAND.navy};border-radius:10px;padding:12px 14px;font-weight:700">${quote ? 'Quote requested' : 'Audit only for now'}<div style="font-weight:400;font-size:13px;margin-top:4px">${quote ? 'A separate installer-ready email follows. Forward that one.' : 'Do not pass to an installer until they ask for a quote.'}</div></td>
  </tr></table>
  ${customerBlocks(d, bill)}
  ${section('Lead source (internal)', [
    row('Landing page', esc(d.landing_page)), row('Source / medium', esc([d.utm_source, d.utm_medium].filter(Boolean).join(' / '))),
    row('Campaign', esc(d.utm_campaign)), row('Ad / keyword', esc([d.utm_content, d.utm_term].filter(Boolean).join(' · '))),
    row('Click IDs', esc([d.gclid && 'Google', d.fbclid && 'Meta'].filter(Boolean).join(', ')))
  ])}
  <p style="margin:24px 0 0;font-size:14px;color:${BRAND.soft}">Hit reply to email ${esc(d.name || 'the customer')} directly.</p>`;
  return {
    subject: `[${d.lead_grade || 'C'}] Bill Audit · ${d.business || d.name} · ${[d.state, d.postcode].filter(Boolean).join(' ')}${quote ? ' · QUOTE REQUESTED' : ''}`,
    html: shell(inner, 'Internal lead notification from the powerpair.io Bill Audit form. Contains lead-source data; do not forward this version.'),
    reply_to: d.email || undefined
  };
}

function installerEmail(d, bill, created) {
  const inner = `
  <p style="margin:0 0 6px;font-size:13px;color:${BRAND.soft}">Customer introduction from PowerPair</p>
  <h1 style="margin:0 0 10px;font-size:24px">${esc(d.business || d.name)} · ${esc(STATES[d.state] || d.state)} ${esc(d.postcode)}</h1>
  <p style="margin:0 0 4px;font-size:15px;line-height:1.5">This business owner completed a PowerPair Bill Audit and asked to be introduced to one accredited installer for a firm quote. ${bill ? 'Their power bill is attached.' : ''}</p>
  <div style="background:${BRAND.bg};border-radius:10px;padding:12px 14px;margin:14px 0 0;font-size:14px;line-height:1.5">
    <b>Next step:</b> please contact ${esc(d.name)} within one business day and confirm to PowerPair once you have. Rebate figures below are PowerPair's indicative estimate; your site assessment and quote are the final word.
  </div>
  ${customerBlocks(d, bill)}
  <p style="margin:22px 0 0;font-size:13px;color:${BRAND.soft}">Consent: the customer agreed on ${esc(when(created))} to their details being shared with one installer for a quote. Please use them only for this enquiry.</p>`;
  return {
    subject: `Customer introduction: ${d.business || d.name}, ${[d.state, d.postcode].filter(Boolean).join(' ')} (PowerPair)`,
    html: shell(inner, 'Introduced by PowerPair · powerpair.io · One vetted installer, not four sales calls.')
  };
}

function confirmEmail(d) {
  const inner = `<h1 style="margin:0 0 12px;font-size:22px">Thanks ${esc((d.name || '').split(' ')[0])}, your Bill Audit is under way.</h1>
  <p style="font-size:15px;line-height:1.55;margin:0 0 12px">We'll read your bill and email your numbers within two business days: the rebates you're likely eligible for, a sensible system size, payback, and how a financed system compares with your bill today.</p>
  <p style="font-size:15px;line-height:1.55;margin:0">${d.want_quote === 'yes' ? 'You asked for a quote, so once your audit is ready we will introduce you to one vetted, accredited installer. Just one.' : 'Nothing goes to an installer unless you ask for a quote.'}</p>`;
  return { subject: 'Your PowerPair Bill Audit is under way', html: shell(inner, 'PowerPair · powerpair.io · Reply to this email with any questions.') };
}

async function send(msg) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(msg)
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
  return r.json();
}

async function handle(payload) {
  if (payload.form_name !== 'bill-audit') return { skipped: true };
  const d = payload.data || {};
  const bill = billFile(d);
  const to = (process.env.LEAD_TO || '').split(',').map(s => s.trim()).filter(Boolean);
  const from = process.env.LEAD_FROM || 'PowerPair Leads <leads@powerpair.io>';
  const attach = bill ? [{ path: bill.url, filename: /\.[a-z0-9]{2,4}$/i.test(bill.filename) ? bill.filename : bill.filename + '.pdf' }] : undefined;
  const created = payload.created_at;
  const out = [];

  const lead = leadEmail(d, bill, created);
  out.push(await send({ from, to, subject: lead.subject, html: lead.html, reply_to: lead.reply_to, attachments: attach }));
  if (d.want_quote === 'yes') {
    const inst = installerEmail(d, bill, created);
    out.push(await send({ from, to, subject: inst.subject, html: inst.html, attachments: attach }));
  }
  if (process.env.SEND_CONFIRMATION === 'true' && d.email) {
    const c = confirmEmail(d);
    out.push(await send({ from, to: [d.email], subject: c.subject, html: c.html, reply_to: to[0] }));
  }
  return { sent: out.length };
}

exports.handler = async event => {
  try {
    const { payload } = JSON.parse(event.body || '{}');
    const res = await handle(payload || {});
    return { statusCode: 200, body: JSON.stringify(res) };
  } catch (err) {
    console.error('Bill Audit email failed:', err);
    // The submission is still saved in Netlify > Forms, so nothing is lost if email fails.
    return { statusCode: 500, body: 'email failed' };
  }
};
exports._test = { leadEmail, installerEmail, confirmEmail, handle };
