# Dependency and supply-chain audit

Part of the 2026-10 security audit. Index: [README.md](README.md). Sources: A5 supply-chain findings, the lead's dependency commit `f6dc659`, round-6 commit `fa7fc4a`, and `npm audit` results the lead verified. Register rows: V-001 and V-071 to V-080 in [VULNERABILITY_REGISTER.md](VULNERABILITY_REGISTER.md).

## 1. Summary

| Check | Before (`pre-security-audit`) | After (`f9b10c4`) |
|---|---|---|
| `npm audit` | **24 advisories: 3 critical, 12 high, 8 moderate, 1 low** | **3 low** |
| `npm audit --omit=dev --audit-level=high` | — | exit 0 |
| `npm ls` | — | clean (exit 0, A5) |
| Lockfile | v3, 1009 entries | about 60 packages fewer (MCP SDK / express / hono / msw chain removed) |
| Node engines | `>=20.0.0` | `>=22` |

The 3 remaining low advisories are all one issue: `deepmerge` GHSA-gcqx-w48m-w2h4, which flags `deepmerge`, `@shadcn/registry` and `shadcn`. No upstream fix exists. `deepmerge` is reachable only through the `shadcn` **CLI**. App code never imports it; `grep deepmerge src server.ts` finds nothing.

## 2. Method

- **No `npm audit fix --force`.** Each fix stayed within its current major version. Where a fixed version could not be reached through the direct dependency, an `overrides` entry pinned a patched version inside the same major (`undici@7`, `brace-expansion@1` / `@5`, `axios`, `engine.io`, `follow-redirects`, `qs`, `source-map-js`, `vite`, `zod`, `dompurify`).
- **npm 11 was used only to resolve the lockfile.** npm 10.9's arborist has a bug that blocked a correct resolution. Installs and `npm ci` use the project's normal npm.
- **isomorphic-dompurify kept at 3.18.0**, now pinned exactly. DOMPurify itself is forced to 3.4.17 through `overrides`. The 3.23.0 line raises the Node floor to `^22.22.2 || ^24.15.0` (its publisher deprecated it for doing so without a major bump), so staying on 3.18.0 avoids raising the floor further than `>=22`. `unpdf` already required Node ≥ 22 before the audit.
- **jsdom 29.1.1 added as an explicit devDependency** (round 6, `fa7fc4a`). After the lockfile re-resolution, jsdom was nested under isomorphic-dompurify, so the two jsdom-environment test files could not start. Declaring it restores them (see [SECURITY_TEST_RESULTS.md](SECURITY_TEST_RESULTS.md#7-honest-notes)).
- After the upgrade A5 independently re-ran `npm audit` on both lockfiles (the "before" run used the lockfile alone, in a scratch directory). A5 also checked every lockfile entry's `resolved`/`integrity`/`hasInstallScript`, the publish date of all 130 versions the upgrade added, and `npm view` metadata for all 56 direct dependencies.

## 3. Before → after versions and advisories fixed

Severity: C critical, H high, M moderate, L low. Advisory IDs are as A5 recorded them from `npm audit`.

| Package | Before → after | Advisories fixed |
|---|---|---|
| next | 16.3.4 → **16.4.3** | GHSA-vcvr-r3jv-pc5j (C), GHSA-2464-fhr4-w9xw (C), GHSA-673q-mjm6-r5xr (C), GHSA-cjq9-62q9-8jv4 (H), GHSA-p3m5-59mp-jv5r (H), GHSA-3w37-wq28-93x7, GHSA-4jqv-mc3x-m676, GHSA-f87g-xv8r-7p7x, GHSA-mcj8-r9mp-w47p, GHSA-h694-7cp9-m8p3 (M), GHSA-39w2-rjm5-chcv (L) |
| dompurify (override) | 3.4.13 → **3.4.17** | GHSA-cg2g-xh64-v4q7 (C), GHSA-mrv2-3pqr-j5jr (H), GHSA-p98j-92pf-mc4p, GHSA-6688-9rhm-gjv2, GHSA-c6gr-qvv4-5v3f (L) |
| isomorphic-dompurify (direct) | ^3.18.0 → **3.18.0** (exact) | carries the dompurify fix through the override; jsdom stays 29.1.1 |
| jsdom (devDependency, new) | transitive 29.1.1 → **29.1.1 explicit** | none (test-environment fix, round 6) |
| proxy-addr | 2.0.7 → **removed** | GHSA-jqcg-44mw-7w3h (C); it came in through express via @modelcontextprotocol/sdk |
| axios (override) | 1.18.1 → **1.21.0** | GHSA-c29m-xwm3-cm6r, GHSA-mghh-pgcx-3jjj, GHSA-x97p-jq2g-jp4f, GHSA-3pq3-5fj3-cg6v, GHSA-542g-h47m-68v8, GHSA-m8m8-qj5v-23w3, GHSA-r4gj-5m52-g5wh (H); GHSA-vh66-26gq-q6x8, GHSA-9fr6-4gfg-395g, GHSA-j8rh-479h-cp32, GHSA-4hqw-qxg8-jxx2, GHSA-44g4-m2mj-wpvx (M) |
| undici (override `undici@7`) | 7.29.0 → **7.30.1** | GHSA-rfgv-xxqx-mfg5, GHSA-w293-vg96-wgc3, GHSA-xjj6-f33q-929c, GHSA-4w7w-5xrc-9h26, GHSA-2m5v-pch6-74hx, GHSA-qrxm-fqhp-jwvm (H); 9 moderate, 3 low |
| @modelcontextprotocol/sdk | 1.29.0 → **removed** (shadcn 4.23 uses @modelcontextprotocol/server) | GHSA-6qxp-vccf-f47h, GHSA-22jm-h49p-29qw, GHSA-46jr-4wx8-v453, GHSA-f897-62hf-6gxq (H); GHSA-6prh-2h8m-c8cw, GHSA-rvq5-wwqv-78pq (M) |
| body-parser | 2.3.0 → **removed** | GHSA-27r3-jxmh-p828 (H) |
| hono / @hono/node-server | 4.13.7 / 1.19.17 → **removed** | GHSA-5r4p-p66f-jhc7, GHSA-rmxm-3fg6-px4f (M) |
| fast-uri | 3.1.7 → **removed** | GHSA-hrr3-gc8f-f4qj, GHSA-w74x-v6f9-j3xg, GHSA-wjr9-j795-jxcr (M); 2 low |
| brace-expansion (override) | 1.1.18 / 5.0.9 → **1.1.21 / 5.0.12** | GHSA-qhr7-859c-m2p7, GHSA-6j4f-fj2g-mc7p (H); GHSA-q2hr-2g5m-vwhr (M) |
| engine.io (override) | 6.6.9 → **6.6.11** | GHSA-2gc4-cqfq-p2gv (H) |
| socket.io (direct) | 4.8.3 → **4.8.4** | pulls in the engine.io fix |
| follow-redirects (override) | 1.16.0 → **1.16.2** | GHSA-q3jh-wrc6-jgq8, GHSA-8r9p-f939-6h3c (H) |
| sharp | 0.35.4 → **0.35.5** | GHSA-wq5f-xc86-pv6w (H). The app never imports sharp, and the image optimiser is now off. |
| source-map-js (override) | 1.2.1 → **1.2.2** | GHSA-68fv-2mgg-jv7q (H) |
| vite (override) | 8.0.16 → **8.3.5** | GHSA-587h-7wmj-h5pm (H); GHSA-698v-4r3x-3vcv, GHSA-r825-w8mm-5pxw, GHSA-rq7h-c2jc-7f22 (M); GHSA-9jrq-w75r-8gcw (L) |
| zod (override) | 3.25.76 + 4.3.6 → **4.6.7** | GHSA-mrhx-c7xc-m3w5 (H) |
| ip-address | 10.5.0 → **10.7.5** | GHSA-rpw4-54j3-4h4q, GHSA-2vr4-cq9g-pvrc, GHSA-j6r3-76f7-8jcv, GHSA-h3mg-xc3c-68pw, GHSA-rxp7-6hxx-x8q5 (M) |
| qs (override) | 6.16.0 → **6.17.1** | GHSA-6pq8-jhm2-2vcw (M) |
| postcss-selector-parser | 7.1.5 → **7.1.7** | GHSA-rj75-hqrm-r3gf (M) |
| vitest / @vitest/* (dev) | 4.1.11 → **4.1.12** | GHSA-qxg6-89mg-rqv8, GHSA-xp26-3454-mjgp (M) |
| shadcn (direct) | 4.10.0 → **4.23.0** | the transitive highs (sdk/hono/express) are gone; only low (deepmerge) remains |
| msw, @inquirer/*, express and others | → **removed** | smaller tree; the `msw` install script is gone |

Unchanged and checked: react / react-dom 19.2.4 (one copy, inside Next's peer range, no open advisory, includes the Dec 2025 / Jan 2026 RSC fixes); next-auth 5.0.0-beta.32; exceljs 3.10.0; deepmerge 4.3.1.

## 4. Remaining advisories

| Advisory | Package path | Severity | Reachable from app code? | Action |
|---|---|---|---|---|
| GHSA-gcqx-w48m-w2h4 | `shadcn` → `@shadcn/registry` → `deepmerge` 4.3.1 | low (×3 entries) | No. Only through the `shadcn` CLI; the app imports only `shadcn/tailwind.css` at build time | Move `shadcn` to devDependencies (§6). There is no upstream fix. |

## 5. Supply-chain findings

| ID | Finding | Status |
|---|---|---|
| Lockfile integrity | 1003 of 1009 entries resolve from `https://registry.npmjs.org/` with a `sha512-` integrity. The other 6 are `inBundle` dependencies of the optional `@tailwindcss/oxide-wasm32-wasi`, covered by the parent tarball's hash. No git, http, tarball-URL, `file:` or `link:` sources. No dependency confusion: the root is `"private": true` and has no internal scopes. | Secure |
| Install scripts | 6 packages: `prisma`, `@prisma/client`, `@prisma/engines` (engine download and generate), `esbuild` (dev), `unrs-resolver` (dev), `fsevents` (optional, macOS). All expected. `--ignore-scripts` would break `prisma generate`. | Accepted |
| Typosquats | None. Every direct dependency has its canonical name and publisher. | Secure |
| V-071 (A5-01) **CI never ran** | `.github/` sat in `Whatsapp-CRM/`, where GitHub ignores it. The workflow triggered on `main`, but the default branch is `master`. Dependabot pointed at a root with no `package.json`. **Moved to the repo root** (`.github/workflows/ci.yml`, `.github/dependabot.yml`, with CODEOWNERS and other files renamed). Branches `[master, main]`, `working-directory: Whatsapp-CRM`, Dependabot `directory: /Whatsapp-CRM`. | PARTIALLY FIXED: it has still never run, because nothing has been pushed yet |
| V-072 (A5-02) Node 20 EOL | CI was on Node 20, which reached end of life on 2026-04-30. CI now uses `node-version: '22'`. `engines` is now `>=22`. | PARTIALLY FIXED: server Node version is a manual check |
| V-073 (A5-03) Action pinning and CI hardening | `actions/checkout@d23441a…` (v6.1.0) and `actions/setup-node@2499707…` (v6.5.0) are pinned by SHA. `permissions: contents: read`, `persist-credentials: false`, `timeout-minutes: 30`, `concurrency`. New steps: `npm audit signatures` (it could not run in the sandbox because the proxy blocks the sigstore TUF CDN; confirm on the first CI run) and `npm audit --omit=dev --audit-level=high`. Uses `pull_request`, not `pull_request_target`, and references no secrets. | PARTIALLY FIXED (not run yet) |
| V-076 (A5-06) Fresh releases | 26 of the versions the upgrade added were published within about 72 h of the audit. All come from the expected publishers. Dependabot now has a `cooldown` of 5 days (14 for majors) on npm and 5 days on actions; security updates are not delayed. | PARTIALLY FIXED (active once pushed) |
| Dependabot | Weekly npm (limit 5) and github-actions (limit 3) updates with labels. The retired `reviewers` key is removed; CODEOWNERS handles review requests. Alerts, security updates and private vulnerability reporting must be **enabled in the GitHub repo settings** (manual). | Manual action |
| V-080 (A5-10) `.npmrc` | `registry=https://registry.npmjs.org/` and `save-exact=true` added. No auth tokens. | FIXED |
| V-075 (A5-05) `wacrm-main.zip` | An 818 KB upstream snapshot (Next 16.2.6, i.e. the vulnerable versions) is **still tracked** at `f9b10c4`. gitleaks and the regex sweep found no secrets in it. | UNRESOLVED: `git rm --cached`; purging history is the owner's decision. **The repo is public.** |
| V-077 (A5-07) Overrides | `"esbuild": ">=0.25.0"` and `"postcss": ">=8.5.10"` have no upper bound. The global `zod ^4.6.7` override is fine today. | UNRESOLVED |
| V-079 (A5-09) `.claude` settings | The deny list covers only three `.env` names. The playwright skill pre-approves `npx playwright:*`. | UNRESOLVED (recommendation) |
| Secrets in the repo | gitleaks 8.21.2 over the git history (shallow: 2 commits), the working tree and the zip contents: 3 hits, all false positives (a placeholder PEM in `.env.local.example`, and runtime-generated test keys). The regex sweep for Meta, IG, Google, OpenAI, Stripe, Razorpay, GitHub, Slack, AWS, Telegram and JWT tokens found nothing. Screenshots show only empty forms. | Secure (older history not reachable in the shallow clone) |

## 6. Recommendations

1. **Move `shadcn` (and `tw-animate-css`, `@types/pg`) to devDependencies.** They are build-time CSS and CLI tooling. This clears the 3 low advisories from `npm audit --omit=dev` and removes an MCP server, a SOCKS client, dotenvx and babel from the production tree. Afterwards, verify that `next build` passes and that `.next/server` contains no `shadcn`.
2. **Remove the unused `pg` and `@prisma/adapter-pg`.** They have zero imports, and the adapter targets Prisma 7 while the app runs 5.22.
3. **Run production from compiled JS** (for example an esbuild bundle of `server.ts`) so that servers can use `npm ci --omit=dev`. Today `npm start` = `tsx server.ts`, which needs dev dependencies.
4. **Move to isomorphic-dompurify 4.x once the Node floor allows** (servers on Node ≥ 22.22.2 / 24.15). 3.x is deprecated by its publisher, and this is the server-side sanitiser.
5. **Upgrade exceljs 3.10.0 → 4.4.0.** It dates from 2020 and parses **user-uploaded** workbooks in `broadcasts/parse-excel` and `data-tables/[id]/import`. Keep the size caps; consider a parse timeout or a worker.
6. Cap the `esbuild` and `postcss` overrides (`^0.28.1`, `^8.5.10`).
7. Plan migrations off `@google/generative-ai` (legacy SDK) and Prisma 5. Track next-auth beta advisories. Pin `@breezystack/lamejs` exactly.
8. Before each production deploy, re-run `npm audit` and `npm audit --omit=dev --audit-level=high`. Consider npm's release-age setting once npm ≥ 11.10 is in use (check the npm docs).
9. Untrack `wacrm-main.zip`, make the repository private, and enable Dependabot alerts and private vulnerability reporting.
