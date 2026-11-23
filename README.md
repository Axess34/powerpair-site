# PowerPair site: deploy and lead emails

## What's in here
- `public/`: the website (home, 8 state pages, Bill Audit form, thanks, privacy).
- `netlify/functions/submission-created.js`: emails each Bill Audit to you.
- `netlify.toml`: tells Netlify where both live.

## Deploy on Netlify (recommended)
Functions don't deploy by drag-and-drop, so use either:
- **GitHub:** push this folder to a repo, then in Netlify choose Add new site > Import from Git. Every push redeploys.
- **Netlify CLI:** `npm i -g netlify-cli`, then `netlify login`, then `netlify deploy --prod` from this folder.

Then:
1. **Domain:** Netlify > Domain management > add `powerpair.io`. Point DNS at Netlify (or use Cloudflare DNS with the records Netlify gives you).
2. **Forms:** Netlify > Forms > enable form detection, then redeploy. The `bill-audit` form appears after the first deploy.
3. **Resend:** create a free account at resend.com and add `powerpair.io` as a sending domain. Add the DNS records it shows (SPF, DKIM), then create an API key.
4. **Environment variables** (Netlify > Site configuration > Environment variables):
   - `RESEND_API_KEY` = your key
   - `LEAD_TO` = the inbox you want leads in
   - `LEAD_FROM` = `PowerPair Leads <leads@powerpair.io>`
   - `SEND_CONFIRMATION` = `true` (optional; emails the customer a thank-you)
5. **Redeploy**, then submit a test from `/audit.html` with a sample bill.

## What arrives
- **Every submission:** "[A] Bill Audit · Business · NSW 2148". This is the full lead with grade, estimate and ad source, plus the bill attached. Reply goes straight to the customer. Keep this one; don't forward it.
- **When they ask for a quote:** "Customer introduction: Business, NSW 2148 (PowerPair)". This has customer, site and bill only, with no internal data. Forward it to the installer as is.
- Every submission is also kept in Netlify > Forms, so nothing is lost if an email fails.

## Hosting on 20i instead
Upload the contents of `public/` to `public_html`. 20i doesn't run Netlify Functions or Forms, so set `WEBHOOK_URL` at the top of `public/site.js` to a form service (Formspree, Make, Zapier) and build the email there. Alternatively, ask for a PHP handler that sends the same emails.
