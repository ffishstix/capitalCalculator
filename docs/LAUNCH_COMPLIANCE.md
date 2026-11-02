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
- [x] Review published Cloudflare privacy details. The Web Analytics beacon disappeared from live HTML after disabling Pages configuration and zone automatic injection. Cloudflare documents the challenge cookie `cf_clearance` (default 30 minutes), at least 31 days of HTTP request/security analytics availability, and UK transfer safeguards in its DPA. The privacy notice now reflects these facts. Its plan storage supports the visitor-requested planning function; reassess under ICO storage rules if new storage or tracking is added. Actual challenge-cookie behaviour and any account-specific log settings were not independently observed after API-token revocation.
- [x] ICO data-protection-fee self assessment completed by the operator, per their confirmation on 2 November 2026. The outcome was not provided; retain the result. Set a process to answer data requests and handle incidents.
- [x] Operator confirmed rights to use the game artwork and catalogue on 2 November 2026. Keep evidence of the permission and its scope. An unofficial disclaimer alone does not grant permission.
- [ ] Complete a live screen-reader walkthrough. In Opera GX on 2 November, keyboard Tab showed a visible focus indicator. At 200% browser zoom, the deployed layout now places the stats panel below the graph; its contents and footer were reached by scrolling. The deployed site previously passed automated WCAG 2.1 A/AA scans at 390px and 1280px without violations or horizontal overflow. The contact page provides a route for accessibility reports.
- [x] The operator confirmed revoking the broad account API token on 2 November 2026. Future tokens should be scoped to the smallest required permissions. The Pages project has a D1 `DB` binding and a secret `PRICE_SYNC_TOKEN`; HTTP redirects to HTTPS. The local export/restore drill succeeded, but a production Time Travel restore was intentionally not run because it overwrites live data.
- [ ] Recheck these pages when providers or site functions change. UK company website disclosures do not apply to the user's stated personal, non-company project.

## Sources

- ICO: [storage and access technology exceptions](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/what-are-the-exceptions/) and fee checker.
- Cloudflare: [challenge passage and `cf_clearance`](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/challenge-passage/), [analytics dataset retention](https://developers.cloudflare.com/observability/logs/datasets/), and [Customer Data Processing Addendum](https://www.cloudflare.com/cloudflare-customer-dpa/).
- GOV.UK: copyright and image-use guidance.
