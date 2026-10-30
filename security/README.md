# Security audit — October 2026

Reports from the multi-agent security audit and remediation of the self-hosted WhatsApp CRM (`Whatsapp-CRM/`). Code state: branch `security/audit-2026-10`, final commit `f9b10c4`. Baseline tag: `pre-security-audit`. Nothing has been pushed or deployed; both wait for the owner's approval.

## Start here

| File | What it is for |
|---|---|
| [SECURITY_AUDIT_REPORT.md](SECURITY_AUDIT_REPORT.md) | Executive summary, attack surface, method, counts, workstreams A–F, remaining risks, before/after |
| [VULNERABILITY_REGISTER.md](VULNERABILITY_REGISTER.md) | One row per unique finding (119): severity, CVSS, status, files, root cause, fix, tests, review verdict |
| [SECURITY_FIXES.md](SECURITY_FIXES.md) | Each fix in detail, and the **behaviour changes users will notice** |
| [DEPENDENCY_AUDIT.md](DEPENDENCY_AUDIT.md) | Package upgrades with advisory IDs, remaining advisories, CI and supply-chain findings |
| [INFRASTRUCTURE_SECURITY.md](INFRASTRUCTURE_SECURITY.md) | Nginx, TLS, PM2, secrets, UFW, SSH, PostgreSQL, backups, monitoring, logging (all manual) |
| [API_SECURITY_MATRIX.md](API_SECURITY_MATRIX.md) | Per-route auth, minimum role, tenant scoping and rate limits, with changed rows marked |
| [AUTHORIZATION_MATRIX.md](AUTHORIZATION_MATRIX.md) | Roles × capabilities as enforced now; the admin-over-admin policy; API key rules |
| [SECURITY_TEST_RESULTS.md](SECURITY_TEST_RESULTS.md) | Every check with its numbers, the regression and exploit tests, Playwright before/after, what was **not** tested |
| [PRODUCTION_SECURITY_CHECKLIST.md](PRODUCTION_SECURITY_CHECKLIST.md) | Ordered pre-deploy, deploy, post-deploy and rollback steps for each VPS |

## Headline numbers

| | Before | After |
|---|---|---|
| Unique findings | 119 (1 critical, 18 high, 37 medium, 46 low, 17 info) from 155 reported IDs | 81 FIXED (42 V2, 39 V1) · 15 PARTIALLY FIXED · 21 UNRESOLVED · 2 NOT APPLICABLE; **no critical or high open** |
| `npm audit` | 24 advisories (3 critical, 12 high, 8 moderate, 1 low) | 3 low (dev CLI only); `--omit=dev --audit-level=high` exit 0 |
| Tests (`npm test`) | 213 files / 1,980 | 320 files / 2,985, exit 0, 0 `it.fails` |
| ESLint | 1 error / 66 warnings | 0 errors / 62 warnings |
| Playwright E2E | 50/54 | 54/54 (production build of `fa7fc4a`) |

## Status words

- **FIXED** is used only when the fix was independently verified by the reviewer, who wrote none of the fixes.
- **PARTIALLY FIXED** means part of the problem remains.
- **UNRESOLVED** means not fixed in code (a recommendation or manual action).
- **NOT APPLICABLE** means accepted by design or not reachable.
- **V2 / V1** (on FIXED rows): V2 = named in a reviewer verdict or covered by a reviewer exploit test; V1 = verified by the reviewer's round-1 code read of every claim plus the implementer's red→green test.
- All six workstreams (A–F) are FIXED.

## Before deploying

Make the repository private, then follow [PRODUCTION_SECURITY_CHECKLIST.md](PRODUCTION_SECURITY_CHECKLIST.md). It includes the `crm_prod_copy` migration dry-runs, the secret checks, `NODE_ENV=production`, re-minting API keys, and the browser click-throughs that have not been done yet.

No secret values appear in these reports; environment variable names only.
