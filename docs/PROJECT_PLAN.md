# CapitalRift Calculator — Project Plan

## Goal

Deliver a reliable, accessible Capital Rift factory recipe calculator that searches the crafting catalogue and calculates batch quantities and ingredient requirements. The current source is the community-maintained `mrawsky/capitalrift-tools` dataset.

## Current implementation

- Nuxt 4 frontend with searchable recipe palette, snap-grid machine nodes, material links, and live network summaries.
- SQLite database with 346 items, 264 recipes, 768 ingredient lines, and 7 source changelog entries.
- Import metadata records source revision, retrieval timestamp, row counts, and a SHA-256 digest.
- Remaining early decisions: confirm data reuse rights before deployment, then validate production-chain and machine-time calculation behavior with the source methodology.

## Step by step

### 1. Agree the use case and success criteria
- Identify the audience and the decision the calculator should help them make.
- Choose the calculator type, inputs, outputs, supported currencies/regions, and units.
- Agree success measures (for example, completion rate, useful enquiries, or fewer manual calculations).
- Name a business owner and a person responsible for approving the calculation rules.
- **Done when:** the calculator specification is reviewed and signed off.

### 2. Collect and validate calculation rules
- Gather the authoritative formula, definitions, assumptions, rounding rules, limits, edge cases, and worked examples from the business owner or qualified subject-matter expert.
- Compare example calculations with independently checked results; document discrepancies and their resolution.
- Decide how the interface explains estimates, exclusions, and uncertainty.
- **Done when:** every output can be reproduced from approved rules and agreed test cases.

### 3. Inventory data and sources
- List each input or reference value, whether it is user-entered, fixed, or externally sourced, and whether it needs SQL storage at all.
- For external data, record its primary source, usage rights, attribution, update cadence, retrieval method, owner, and stale-data behavior in `templates/data-source-register.csv`.
- Confirm whether data is personal or sensitive; define collection, retention, deletion, and consent requirements before storing it.
- **Done when:** every value has an owner and provenance, and licensing/privacy questions are resolved.

### 4. Select architecture and security boundaries
- Choose frontend framework and hosting based on CapitalRift's current website stack and deployment process.
- Choose where calculations run. Prefer client-side computation when no private data or privileged service is needed; use a backend only for a clear need such as protected data, integrations, or persistence.
- Decide whether SQL is warranted. A stateless calculator may need no database; if data must be managed, define which records belong there and keep secrets server-side.
- Define API contracts, environment configuration, access controls, logging, backups, and failure behavior.
- **Done when:** a short architecture decision is agreed and reviewed with the site owner.

### 5. Design the experience
- Sketch the input flow, validation and helpful error states, results, explanations, and next action.
- Match CapitalRift's brand and responsive layout; plan for keyboard use, screen readers, contrast, and plain-language labels.
- Decide how the tool will be embedded or linked, and how it behaves on mobile.
- **Done when:** desktop and mobile designs cover normal, invalid, boundary, and unavailable-data states.

### 6. Build and verify the calculation engine
- Implement approved formulas in a small, independently callable module.
- Add automated checks for approved examples, boundaries, missing values, invalid input, rounding, and data refresh cases.
- Keep calculation rules separate from presentation and data retrieval.
- **Done when:** all agreed cases produce approved results and failures are clear and safe.

### 7. Build the frontend and any required backend
- Create the responsive interface and connect it to the calculation module/API.
- If SQL is approved, create reviewed migrations, seed only verified reference data, and define update and rollback procedures.
- Validate inputs on both sides where a backend exists; never trust browser input for privileged operations.
- Add privacy notice/consent where required, accessible feedback, loading states, and source/as-of labels for reference data.
- **Done when:** the complete user journey works with real approved data in a test environment.

### 8. Integrate with CapitalRift.com
- Confirm domain, content-management, analytics, consent, and deployment constraints with the website owner.
- Configure staging and production URLs, HTTPS, allowed origins, and any required content security policy.
- Verify branding, navigation, analytics events, privacy behavior, and mobile layout in the actual site context.
- **Done when:** the integrated staging version is approved by the site owner.

### 9. Review before launch
- Review calculation accuracy, accessibility, security, privacy, licensing, copy, and performance.
- Test key browsers and screen sizes, including API/database outage and stale data if applicable.
- Prepare release, rollback, support ownership, monitoring, and a process for updating formulas and reference data.
- **Done when:** named reviewers approve launch and a rollback path is ready.

### 10. Launch and maintain
- Release through the agreed deployment process and monitor errors, performance, and usage.
- Review feedback and calculation/data changes with the owner; version changes where prior results need auditability.
- Recheck external source availability and rights on the documented schedule.
- **Done when:** ownership, support, and scheduled review are active after launch.

## Decisions to resolve first

1. Who approves the calculator's interpretation of production rates and machine requirements?
2. Are multi-step production chains and combined shopping lists in the first release?
3. What data reuse terms apply to the source repository and game-related names/assets?
4. What hosting and deployment workflow will be used for the target website?
5. Are saved/shared factory plans in scope, and if so, should they remain browser-local?

## Definition of done

- Approved specification, formulas, examples, data provenance, and user-facing limitations.
- Tested, accessible, responsive calculator integrated with CapitalRift.com.
- Security, privacy, and licensing reviews completed for the chosen design.
- Documented deployment, rollback, monitoring, and ownership for future changes.
