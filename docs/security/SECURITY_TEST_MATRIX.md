# Security Test Matrix

| ID | Behavior | Planned evidence | Gate | Class |
| --- | --- | --- | --- | --- |
| SEC-001 | Anonymous cannot receive PII | `rls-live.test.mjs` | G5 | Negative |
| SEC-002 | Activist sees only allowed contacts | `contacts-interactions-api.test.mjs` | G3 | Positive/negative |
| SEC-003 | Activist cannot read another activist contact | `contacts-interactions-api.test.mjs` | G3 | Negative |
| SEC-004 | Project A cannot read Project B | `rls-live.test.mjs` | G5 | Negative |
| SEC-005 | Direct URL change cannot bypass authorization | `contacts-interactions-api.test.mjs` | G3 | Negative |
| SEC-006 | Resource ID change cannot bypass authorization | `contacts-interactions-api.test.mjs` | G3 | Negative |
| SEC-007 | Request body cannot escape tenant | `contacts-interactions-api.test.mjs` | G3 | Negative |
| SEC-008 | Insert with client `project_id` is rejected | `contacts-interactions-api.test.mjs` | G3 | Negative |
| SEC-009 | Cross-tenant update is rejected | `rls-live.test.mjs` | G5 | Negative |
| SEC-010 | Cross-tenant delete is rejected | `rls-live.test.mjs` | G5 | Negative |
| SEC-011 | Coordinator permissions are exact | `rbac-context-audit.test.mjs` | G2 | Positive/negative |
| SEC-012 | Project Head is limited to own project | `governance-api.test.mjs` | G3 | Negative |
| SEC-013 | CEO permissions are exact and require AAL2 | `rbac-context-audit.test.mjs` | G2 | Positive/negative |
| SEC-014 | Anonymous mutation is rejected | `http-validation.test.mjs` | G2 | Negative |
| SEC-015 | Expired or invalid session is rejected | `session-csrf-rate.test.mjs` | G2 | Negative |
| SEC-016 | Logout revokes access | `auth-service.test.mjs` | G2 | Negative |
| SEC-017 | Privilege escalation is rejected and sessions rotate | `governance-api.test.mjs` | G3 | Negative |
| SEC-018 | Mass assignment is rejected | `http-validation.test.mjs` | G2 | Negative |
| SEC-019 | Oversized or malformed input is rejected | `http-validation.test.mjs` | G2 | Negative |
| SEC-020 | XSS payload is not emitted as HTML | `contacts-interactions-api.test.mjs` | G3 | Negative |
| SEC-021 | Rate limiting blocks excess attempts | `session-csrf-rate.test.mjs` | G2 | Negative |
| SEC-022 | Required security headers are present | `headers-cors-cache.test.mjs` | G4 | Negative |
| SEC-023 | Every sensitive table has enforced RLS | `migration-rls.test.mjs` and G5 | G1/G5 | Static/live |
| SEC-024 | Service-role credential is absent from client bundle | `client-boundary.test.mjs` | G4 | Negative |
| SEC-025 | Unauthorized user cannot read audit log | `migration-rls.test.mjs` and G5 | G1/G5 | Static/live |
| SEC-026 | Foreign Origin and invalid CSRF token are rejected | `session-csrf-rate.test.mjs` | G2 | Negative |
| SEC-027 | AAL1 cannot access MFA-protected resources | `auth-service.test.mjs` | G2 | Negative |
| SEC-028 | Session fixation and replay after rotation are rejected | `session-csrf-rate.test.mjs` | G2 | Negative |
| SEC-029 | Disabled user and stale security version are rejected | `session-csrf-rate.test.mjs` | G2 | Negative |
| SEC-030 | Notification spoofing and unsafe links are rejected | `notifications-push-api.test.mjs` | G3 | Negative |
| SEC-031 | Spreadsheet formula injection is neutralized | `finance-reports-feedback.test.mjs` | G3 | Negative |
| SEC-032 | External integrations fail closed without private config | `external-integrations.test.mjs` | G3 | Negative |
| SEC-033 | Secret values are absent from scan output and bundle | `secret-hygiene.test.mjs` | G4 | Negative |
| SEC-034 | Finance projection excludes contact and religious PII | `finance-reports-feedback.test.mjs` | G3 | Negative |
| SEC-035 | Android blocks backup, cleartext, broad provider and debug release | `android-hardening.test.mjs` | G4 | Negative |
| SEC-036 | Every custom RPC dependency in migrations 0018–0024 resolves in chain order | `db-contract-reconciliation.test.mjs` | G3 | Static |
| SEC-037 | Direct JWT cannot cancel another recipient/project reminder | `db-contracts-live.test.mjs` | G5 | Direct JWT negative |
| SEC-038 | Direct JWT cannot submit a tour report outside assignment/project or forge reporter | `db-contracts-live.test.mjs` | G5 | Direct JWT negative |
| SEC-039 | Notification event derives project/recipients and enforces event capability | `db-contracts-live.test.mjs` | G5 | Direct JWT negative |
| SEC-040 | Finance filters cannot expand project/user scope and output is allowlisted | `db-contracts-live.test.mjs` | G5 | Direct JWT positive/negative |
| SEC-041 | Finance RPC resists search-path hijack and fails closed when audit append fails | `db-contract-reconciliation.test.mjs` and G5 PostgreSQL verification | G3/G5 | Static/live |

## G5 evidence mapping

The G5 gate is authorized only for the exact task-owned disposable local stack. The live files stay
explicitly skipped without `SECURITY_TEST_CONFIRM_ISOLATED=true`; execution additionally requires
the canonical root origin, captured API port, unique `mekarvim-security-g5-*` project id, and a
positive Docker inspection of the exact Supabase project labels/container names.

| IDs | Live evidence | Required blocking layer/result |
| --- | --- | --- |
| SEC-001, SEC-004, SEC-009, SEC-010, SEC-023, SEC-025 | `rls-live.test.mjs`, `verify-rls-live.mjs` | anonymous/cross-tenant CRUD denied by PostgREST/RLS; all classified tables forced; audit read denied |
| SEC-015..017, SEC-021, SEC-026..029 | `session-live.test.mjs` | actual local DB/BFF requests prove expiry/logout/replay/rotation/disable/stale-version/CSRF/rate/AAL/escalation denial |
| SEC-037 | `db-contracts-live.test.mjs` | other-recipient/project reminder cancel denied; exact own/manager path allowed |
| SEC-038 | `db-contracts-live.test.mjs` | unassigned/cross-project/reporter forgery denied; exact assigned report allowed |
| SEC-039 | `db-contracts-live.test.mjs` | event capability/project/recipient spoofing denied; recipients resource-derived |
| SEC-040 | `db-contracts-live.test.mjs` | CEO/Head/Finance/Activist scopes exact; Coordinator and forged narrowing filters denied; projection keys exact |
| SEC-041 | direct PostgreSQL queries in `db-contracts-live.test.mjs` | temporary-schema hijack denied; a synthetic local audit-trigger failure aborts projection before any result is assigned |

Every live evidence record is limited to case ID, actor class, resource class, blocking layer,
expected status and actual status. Tokens, credentials, names, notes, payloads and row contents are
forbidden. Until all live rows, finance parity and real AAL2 are proven, G5 remains `BLOCKED`.
