# Personal website launch checklist

Reviewed 30 October 2026 for this free, UK-facing personal project. This is a practical checklist, not a legal opinion. Reassess if accounts, payments, advertising, analytics, or new jurisdictions are added.

## Implemented in the repository

- Privacy/storage and about/contact pages use the supplied support email and are linked from the planner.
- The planner's unnecessary external Google Fonts request was removed.
- Production database access fails closed without the Cloudflare D1 binding. Public data queries use bound SQL values; the only active write route requires a server-side token in production.
- Security response headers were added for app routes and static files, including a cautious one-day HSTS trial. Confirm the live Cloudflare response after deployment because zone settings may override application headers.
- The code has no user accounts, checkout, ads, or first-party analytics. Plans and preferences are saved in each visitor's browser, not the site database.

## Still requires account access, evidence, or a personal decision

- [x] Identify the individual operator in the privacy notice: Fin West, with the supplied contact email.
- [ ] Check Cloudflare security cookies, access logs, log retention, data-processing terms, and international transfer arrangements. The Pages project has Web Analytics configured, but no beacon was present in the live HTML checked on 30 October 2026. Confirm whether it is collecting by another route. Then make the privacy notice precise. Obtain consent before enabling any non-exempt tracking. Assess persistent local storage against the ICO's storage-access rules.
- [ ] Run the ICO data-protection-fee self assessment and retain its result. Being a personal project does not, by itself, prove an exemption. Set a process to answer data requests and handle incidents.
- [ ] Confirm permission for public redistribution of game artwork and the copied catalogue. The upstream catalogue has no explicit licence in this repository. Remove or replace content if public reuse is not permitted. An unofficial disclaimer does not grant permission.
- [ ] Test the deployed site with keyboard, screen reader, 200% zoom and mobile layout; fix barriers. The contact page provides a route for accessibility reports.
- [ ] Review Cloudflare account MFA and access roles, token storage, and backups. Test a D1 restore. The Pages project has a D1 `DB` binding and a secret `PRICE_SYNC_TOKEN`; HTTP currently redirects to HTTPS. The live HTTPS response sends `Strict-Transport-Security: max-age=0`, so check the zone's HSTS setting before enabling it for all relevant hostnames. The available Wrangler token received 403 for zone settings, so those settings were not verified.
- [ ] Recheck these pages when providers or site functions change. UK company website disclosures do not apply to the user's stated personal, non-company project.

## Sources

- ICO: privacy information, storage and access technology guidance, and fee checker.
- GOV.UK: copyright and image-use guidance.
