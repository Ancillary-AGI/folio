# Security Policy

## Supported versions

Only the `main` branch receives security fixes. There is no stable release line; the workbench is built from `main` and deployed from `main`.

## Reporting a vulnerability

Report privately via **GitHub private vulnerability reporting** on this repository (Security → Report a vulnerability). Do not open a public issue for an exploitable flaw, and do not test against deployments you do not own.

What to include: the affected surface (workbench, console, admin console, marketing site, build pipeline), reproduction steps, and the impact you observed. If you have a fix in mind, a sketch of it in the report is welcome.

What to expect: acknowledgement and an honest assessment. If the finding is reproducible and in scope, it is fixed on `main` and the advisory published; if it is not reproducible or not in scope, you will be told that plainly — no silent limbo.

## In scope

- The shipped documents (`index.html`, `admin.html`, `console.html`, `landing.html`, `pricing.html`) and the bundles they load.
- The CSP and hosting configuration (`vercel.json`, `public/_headers`, `public/_redirects`).
- Any path where user-controlled data reaches a device other than the one it is typed on: community payloads, publish imports, template files, the encrypted export.
- The local-first trust boundary: a project file, a `.folio.enc.json`, or a community payload must never execute code, leak `circuit-cad-app-store` beyond its intended scope, or overwrite an existing design silently.

## Out of scope

- Denial of service against the demo/marketing pages.
- Findings in accounts you do not own.
- Missing hardening headers on routes that serve no user data, beyond what is already configured — we do take those reports seriously when there is demonstrated impact.

## Design commitments the security review can rely on

- No third-party script is loaded from a CDN; everything is self-hosted under `/assets`.
- No credentials leave the browser in a "download my data" export — Folio session keys are excluded by construction and by test.
- Community payloads are validated item-by-item and refused whole on any malformation; imports never destroy an existing design.
- Production dependencies are audited (`npm audit --omit=dev` is clean on `main`); the CI gate runs lint, the accessibility contract, the type-checker, the full test suite and a production build.
