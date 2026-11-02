# Personal website launch checklist

Reviewed 2 November 2026 for this free, UK-facing personal project. This is a practical checklist, not a legal opinion. Reassess if accounts, payments, advertising, analytics, or new jurisdictions are added.

## Implemented in the repository

- Privacy/storage and about/contact pages use the supplied support email and are linked from the planner.
- The planner's unnecessary external Google Fonts request was removed.
- Production database access fails closed without the Cloudflare D1 binding. Public data queries use bound SQL values; the only active write route requires a server-side token in production.
- Security response headers were added for app routes and static files. On 2 November 2026, Cloudflare's zone HSTS setting was changed to a one-month policy for the main domain, without subdomain coverage or preload. The live homepage, API and privacy page all returned `Strict-Transport-Security: max-age=2592000` and HTTP 200.
- Cloudflare's SSL mode was changed from Flexible to Full (strict), and the minimum TLS version from 1.0 to 1.2. The live homepage and API continued to return HTTP 200. Always Use HTTPS, automatic HTTPS rewrites and browser checks were already on; the security level was medium.
- The code has no user accounts, checkout, ads, or first-party analytics. Plans and preferences are saved in each visitor's browser, not the site database.
- Cloudflare D1 Time Travel returned a current recovery bookmark. A remote SQL export was restored into a separate local SQLite file on 2 November 2026; `PRAGMA integrity_check` returned `ok`, with 17 tables, 264 recipes and 445 item quotes. This verifies an export and local restore path without overwriting the production database.
- The Cloudflare account has one member with the Super Administrator role; the signed-in user's two-factor authentication is enabled. Ordinary requests to the homepage, privacy page and public metadata API returned no `Set-Cookie` header. A security challenge may behave differently.
- The planner's document language, graph keyboard focus, control labels and seven low-contrast text instances were fixed after an automated WCAG 2.1 A/AA scan. The Nuxt and Sharp dependency updates removed the high-severity npm audit findings; ten lower-severity transitive findings remain.

## Still requires account access, evidence, or a personal decision

- [x] Identify the individual operator in the privacy notice: Fin West, with the supplied contact email.
- [ ] Check Cloudflare security cookies under challenge conditions, access log retention, data-processing terms, and international transfer arrangements. The live HTML on 2 November did contain a Web Analytics beacon injected by the zone's automatic setup. The Pages analytics configuration and the zone Web Analytics ruleset were disabled; confirm the beacon disappears from live HTML after propagation. Obtain consent before enabling any non-exempt tracking. Assess persistent local storage against the ICO's storage-access rules.
- [ ] Run the ICO data-protection-fee self assessment and retain its result. The personal or hobby and not-for-profit exemptions may apply to the stated facts, but only the operator can confirm that no other processing purpose applies. Set a process to answer data requests and handle incidents.
- [ ] Confirm permission for public redistribution of game artwork and the copied catalogue. The upstream catalogue has no explicit licence in this repository. Remove or replace content if public reuse is not permitted. An unofficial disclaimer does not grant permission.
- [ ] Test the deployed site manually with keyboard, screen reader and 200% zoom. The deployed site passed automated WCAG 2.1 A/AA scans at 390px and 1280px without violations or horizontal overflow. The contact page provides a route for accessibility reports.
- [ ] Review Cloudflare access log retention and token storage. The newly created account API token grants hundreds of permission groups and should be revoked after this review; future tokens should be scoped to the smallest required permissions. The Pages project has a D1 `DB` binding and a secret `PRICE_SYNC_TOKEN`; HTTP redirects to HTTPS. The local export/restore drill succeeded, but a production Time Travel restore was intentionally not run because it overwrites live data.
- [ ] Recheck these pages when providers or site functions change. UK company website disclosures do not apply to the user's stated personal, non-company project.

## Sources

- ICO: privacy information, storage and access technology guidance, and fee checker.
- GOV.UK: copyright and image-use guidance.
