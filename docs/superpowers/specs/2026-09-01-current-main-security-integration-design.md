# Current Main Security Integration Design

## Status and pinned identities

This design is the approved execution contract for integrating current `main` into the reviewed security architecture.

- Hardened base: `0153a8acb242d25ee259c2c626bb86c9899d6a95`
- Current `main` and `origin/main`: `69b4040a993689c63990f3064e58c321254836c5`
- Merge base: `72b9196f22812e5dc2452efe33f1fbbf23f3dd4c`
- Integration branch: `security/integrate-current-main`
- Integration worktree: `.worktrees/security-integrate-current-main`
- Rollback reference: `security/hardening-p0`, unchanged at the hardened base

The integration is local only. It must not merge to `main`, push, deploy, access Production, or touch the `shabbat-hosting` Supabase stack.

## Architectural decision

Current-main business behavior is authoritative. The hardened trust boundary is also authoritative and wins whenever an implementation mechanism conflicts with it.

The resulting data path remains:

```text
Browser
  -> same-origin BFF with opaque cookie and CSRF
  -> RequestContext / RBAC / AAL checks
  -> user-scoped PostgREST or approved SECURITY INVOKER RPC
  -> forced RLS and atomic audit
```

Business rules are ported into this path. Browser Supabase authority, browser bearer tokens, client-provided tenant/actor authority, service-role business CRUD, permissive RLS, raw error leakage, and sensitive local persistence remain forbidden.

## Canonical current-main business contract

The sources of truth are `lib/paymentCalc.js`, the two current-main feature specifications, and their verification scripts at `69b4040`.

### Finance rules

1. Rates are phone-friendly 0, phone-Torani 150, video-Torani 200, video-friendly 200, frontal-friendly 250, frontal-Torani 300, multi-participant 300, and Shabbat hosting 600.
2. Friendly activity is eligible only in the first three calendar months from `contact.joined_at`, falling back to the earliest same-activist interaction date.
3. A qualifying Torani interaction permanently ends later friendly eligibility. A Torani interaction qualifies for this transition only when it is a payable-project, non-derived interaction meeting the configured minimum duration.
4. At most two paid frontal-friendly interactions per activist/contact/month are allowed, in addition to the existing per-contact and monthly caps.
5. `קצרצר` is explicit non-payable activity, never consumes a cap, and never contributes to a bonus.
6. A one-time 1,000 ILS `בונוס-תורני` is earned in the third month of the first three-consecutive-calendar-month qualifying Torani streak per activist/contact.
7. Mitzvot bonuses are grouped once per activist/contact/mitzva/month, while the historical cancellation key format remains unchanged.
8. Only paid interactions consume caps. Allocation stays amount-descending, date-ascending, id-ascending.
9. Derived multi-participant rows remain non-payable and excluded from counters.
10. Torani bonus cancellation uses the existing key format and must be recomputed server-side before an atomic audited cancellation.

### Reports and exports

1. Payment totals, unpaid totals, activity counts, month report, payroll XLSX, and activity-by-type XLSX must derive from the same server-side Finance calculation.
2. The eight activity categories and their order remain: phone-friendly, phone-Torani, Zoom-friendly, Zoom-Torani, frontal-friendly, frontal-Torani, frontal-multi, Shabbat hosting.
3. Activity exports retain per-category paid counts/totals, bonus categories, expenses, guide pay, organizational totals, and unpaid reason counts.
4. The hardened projection deliberately replaces current-main contact-name/per-interaction detail with aggregate category rows and aggregate unpaid reasons. This preserves payroll/operational reporting while preventing Finance from receiving contact PII or per-contact religious history.
5. Spreadsheet cells remain formula-injection safe and workbooks remain RTL.

### Other current-main behavior

1. The four newly mapped activist names authenticate through the private server identity registry populated from profiles; no username/email map returns to the browser.
2. All-history interaction reads required for eligibility and streak calculations must be complete and explicitly paginated at the user-scoped BFF/repository boundary.
3. The `קצרצר` report mode is retained in the add-interaction UI and persists through the existing same-origin interaction endpoint.
4. A payable zero-amount phone-friendly interaction is displayed and notified as eligible at a zero rate, not as rejected.
5. Executive interaction-report analytics and the activity workbook generator remain available, but generated report binaries remain untracked artifacts.

## Conflict inventory and resolution strategy

| File | Current-main intent | Hardened intent | Resolution strategy |
|---|---|---|---|
| `lib/AuthStore.jsx` | Add four browser username-to-email mappings | Opaque BFF session; no browser identity authority | Keep the hardened client and prove the private profile-derived identity registry covers arbitrary Hebrew names. |
| `lib/CrmStore.jsx` | Derive Torani bonuses and paginate direct Supabase reads | Same-origin BFF adapters and user-scoped DTOs | Keep BFF access; add Torani derivation where needed and paginate inside the scoped server repository, never in browser Supabase. |
| `lib/notificationDemo.js` | Distinguish eligible zero-rate activity from rejected activity | Generic, non-PII notification cache and server-derived delivery | Port only the three-state amount semantics; keep generic payload and BFF notification boundary. |
| `lib/paymentConfig.js` | Load rates directly from Supabase with permissive fallback | Deleted legacy browser authority path; explicit `/api/payments/config` DTO | Keep deleted. Port rate changes into migration 0024 and the explicit server projection. |
| `pages/contact/add-interaction/[id].jsx` | Add `קצרצר` UI and full-history payment preview | Same-origin interaction writes and hardened validation | Port UI/state and JS preview rules while keeping BFF mutation and server-owned authority. |
| `pages/my-dashboard.jsx` | Pass Torani bonus inputs to the JS dashboard | BFF aggregate dashboard/payment projection | Use hardened payment data; expose only aggregate Torani bonus totals through approved DTOs. |
| `pages/payments.jsx` | Add combined activity XLSX from browser-loaded raw CRM data | Aggregate Finance BFF projection | Add export from safe aggregate payment DTOs; no raw contacts/interactions in Finance browser state. |
| `pages/payments/[id].jsx` | Add individual activity XLSX and Torani bonus display/cancellation | Aggregate detail plus server-recomputed cancellation candidates | Add safe aggregate export and Torani candidate support; retain server validation, AAL, scope, and atomic RPC cancellation. |
| `scripts/compare-payment-impact.cjs` | Include Torani bonuses in new-engine comparison | Guarded, bounded, audited operational reads | Port Torani derivation into the guarded script; retain exact target contract and no unguarded secrets. |
| `scripts/verify-month-report.cjs` | Include Torani bonuses in historical totals | Guarded aggregate-only verifier | Port Torani derivation while retaining bounded target and sanitized output. |
| `scripts/verify-payroll-xlsx.cjs` | Include Torani bonuses in payroll output | Guarded workbook verification | Port Torani derivation while retaining bounded reads, safe export path, and workbook checks. |
| `reports/דו״ח-קשרים-אחדות-יהודית.pdf` | Updated generated executive report | Deleted tracked PII artifact | Keep deleted. Generation code remains; evidence uses synthetic/local output outside tracked artifacts. |
| `reports/דו״ח-קשרים-אחדות-יהודית.xlsx` | Updated generated executive workbook | Deleted tracked PII artifact | Keep deleted for the same reason. |

## Auto-merged current-main paths requiring validation

- `data/config.js`: retain the `contactMethods` UI constant.
- `lib/paymentCalc.js`: retain all canonical rules, then prove SQL parity.
- `lib/activistStats.js`: retain payable-only/derived-safe counting.
- `lib/activityByTypeExcel.js`: retain workbook layout but adapt its input to safe aggregate DTOs.
- `lib/interactionReport*.js`: retain executive analytics while preserving CEO AAL2 server loading.
- `pages/contact/update-mitzvot/[id].jsx`: retain per-row bonus eligibility behavior through BFF writes.
- `scripts/verify-payment-order.cjs` and `scripts/verify-activity-report.cjs`: retain all current-main business assertions.
- `scripts/apply-new-payment-rates.cjs`: do not retain the unguarded production mutation path. Migration 0024 is the justified pre-cutover replacement.

## Finance server contract

`app_finance_summary` remains the only payment summary RPC invoked by ordinary Finance routes. Migration `0024_finance_security.sql` is already the unapplied Finance cutover migration, so the integration extends 0024 instead of creating an unexplained 0025.

The RPC must return only:

- user UUID and escaped display name;
- period and aggregate activity, bonus, tour, expense, and grand totals;
- ordered activity-category objects containing category, paid count, unit rate, and total;
- unpaid reason objects containing a stable reason code/label and count;
- bonus-category objects containing type, count, and total.

It must not return contact IDs, names, phones, notes, descriptions, mitzvot history, interaction IDs, actor/owner metadata, or raw rows.

The BFF maps this projection through an explicit DTO. `projectId` and `userId` request filters remain narrowing-only after RBAC/AAL scope derivation.

Bonus candidates add `בונוס-תורני` to the allowlist and recompute the first qualifying streak from scoped, complete history. The database cancellation RPC independently recomputes the exact candidate and amount before inserting the derived actor/project/beneficiary record and audit event.

## Migration and rollback

Extending migration 0024 is justified because it owns the pre-cutover Finance calculation and has not been promoted to staging/Production. It will:

1. update the single payment configuration row to current-main rates;
2. implement eligibility, friendly cap, short-contact exclusion, grouped mitzvot bonuses, and Torani bonuses in `app_finance_summary`;
3. return safe activity/bonus/unpaid aggregates;
4. extend `app_cancel_bonus` for a recomputed Torani candidate;
5. preserve forced RLS, invoker behavior, least privilege, and grants.

The pre-cutover rollback restores the prior three changed rates before removing the hardening functions. Static migration tests and fresh G5 apply/verify/rollback/reapply prove the chain.

## Test strategy

Every integration group follows RED -> minimum fix -> GREEN:

1. Auth/client boundary: current-main browser identity mapping fails the hardened client-boundary contract; the server identity registry and Hebrew-name login behavior pass.
2. Finance/payments: JS canonical fixtures first fail SQL/domain parity and Torani cancellation support; migration/domain changes make them pass.
3. Activities/interactions: short-contact form and complete-history paging tests first fail; BFF-compatible UI/repository changes make them pass.
4. Reports/exports: aggregate activity export fixtures and formula/RTL checks first fail; safe workbook input and UI wiring make them pass.
5. Remaining UI/compatibility: zero-rate notification and dashboard totals first fail; minimal semantic ports make them pass.

After group commits: full static/local gate, independent integration review of `0153a8a..HEAD`, deterministic finding fixes via RED/GREEN, fresh disposable G5, then fresh G6 from the integrated commit.

## Completion criteria

`READY TO ENTER STAGING` is allowed only when the merge has no unresolved conflicts, current-main business parity and hardened projection parity are proven, independent review has no unresolved Critical/Important deterministic finding, G5 and G6 pass, dependency audits are clean, cleanup is proven, and the integration worktree is clean.
