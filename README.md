<div align="center">

# 🛡️ Syntic Bug Defender

**An AI security-audit loop for any codebase — right inside Syntic Code and Claude Code.**

Threat-model → discover → adversarially verify → triage → fix → re-scan, with a navigable HTML report.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
![Claude Code Plugin](https://img.shields.io/badge/Claude%20Code-plugin-7c3aed)
![Stack-agnostic](https://img.shields.io/badge/stack-agnostic-1a7a3a)

**[syntic.ai/bug-defender](https://syntic.ai/bug-defender)** · by **Syntic AI**

</div>

---

## What it is

**Syntic Bug Defender** is a [Syntic Code](https://syntic.ai/bug-defender) and
[Claude Code](https://code.claude.com) plugin that runs a complete security audit on any repository you open. Install it once, then in any project run a single command and get a
ranked, **verified**, de-duplicated list of security findings — with candidate fixes and a polished,
shareable report. Run it again later and it only surfaces what's *new*.

It packages a battle-tested **recon → discover → verify → triage → fix → re-scan** workflow into one
portable, stack-agnostic plugin — with persistent findings tracking, diff-aware re-scans, secret scanning,
SARIF output, and a polished, navigable HTML report.

## Why it's different

- **Finds bugs scanners can't.** It *reasons* about your code like an attacker — surfacing logic flaws,
  broken authorization / IDOR, and business-logic bugs that pattern- and regex-based SAST tools structurally
  miss — not just known signatures.
- **Recall, then precision.** A discovery swarm casts a wide net; then an **adversarial verifier**
  (multi-vote, "assume it's a false positive and try to disprove it") cuts the noise — so you get
  confirmed issues, not a wall of maybes.
- **Remembers your project.** A per-project ledger means re-scans **dedupe against history**, mark fixes
  as resolved, and track findings over time.
- **Beautiful, portable reports.** A single self-contained `report.html` with a sticky navigation sidebar,
  severity filters, and print-to-PDF — no external files, works offline.
- **Safe by default.** Read-only review; patches are **inert diffs for you to review**, never auto-applied.
  Active-testing features (roadmap) refuse to run without a completed authorization file.
- **Non-destructive.** Output goes to `docs/security-audit.nosync/` — git-ignored and iCloud-excluded; your
  existing `docs/` is never touched.

## What it detects

It reasons about your code *and* its data/auth model, so it covers the high-impact vulnerability classes —
including the logic and access-control bugs that signature-based scanners miss:

- **Injection & RCE** — SQL/NoSQL injection, command injection, XSS (reflected / stored / DOM), SSRF,
  path traversal, template injection, unsafe deserialization, `eval`/dynamic-code execution.
- **Broken access control & auth** — missing or incorrect authorization, IDOR, privilege escalation,
  authentication / MFA / step-up bypass, JWT & session flaws, over-permissive database row-access (RLS) policies.
- **Secrets & credentials** — hardcoded secrets, committed `.env` and key files, API keys/tokens in code
  **or git history**, weak credential handling.
- **Crypto & data exposure** — weak or misused cryptography, predictable randomness, missing TLS/cert
  validation, PII or secrets leaked in logs and error responses.
- **Business logic & money flows** — logic flaws, race conditions / TOCTOU, value/amount manipulation,
  replay, webhook spoofing, missing server-side validation (the deep bugs regex tools can't see).
- **Configuration & supply chain** — insecure CORS and security headers, dangerous defaults, dependency
  and secret hygiene.

Every finding is **severity-ranked**, **adversarially verified** to cut false positives, and ships with a
**candidate fix** plus a **SARIF** export for CI / GitHub code scanning.

## Install

```text
/plugin marketplace add Syntic-Ai/syntic-bug-defender
/plugin install syntic-bug-defender@syntic-ai
/reload-plugins
```

Installs at **user scope**, so the commands are available in every repo you open.

## Usage

In any repository:

```text
/syntic-bug-defender:scan          # full audit: threat-model → scan → triage → report
```

Or run a stage on its own:

| Command | What it does |
|---|---|
| `/syntic-bug-defender:scan` | The whole loop in one go |
| `/syntic-bug-defender:init` | Set up the output folder, gitignore, stack detection, authorization template |
| `/syntic-bug-defender:threat-model` | Build a threat model from code + git history |
| `/syntic-bug-defender:vuln-scan` | Parallel discovery across focus areas |
| `/syntic-bug-defender:triage` | Adversarial multi-vote verification, dedupe, ranking |
| `/syntic-bug-defender:secret-scan` | Committed secrets, key material, `.env` hygiene |
| `/syntic-bug-defender:patch` | Generate **inert** candidate fix diffs for review |
| `/syntic-bug-defender:rescan` | Diff-aware re-run: verify prior fixes + find net-new |
| `/syntic-bug-defender:report` | Render the HTML report + SARIF from the ledger |

## What you get

Everything lands in `docs/security-audit.nosync/` in the scanned repo:

```text
docs/security-audit.nosync/
├── THREAT_MODEL.md      # system context, assets, entry points, ranked threats
├── findings.md          # human-readable findings
├── ledger.json          # machine-readable state (dedup + trend across runs)
├── report.html          # self-contained, navigable report (open in any browser)
├── findings.sarif       # SARIF 2.1.0 — plugs into GitHub code scanning & CI
├── patches/             # inert candidate fix diffs (review before applying)
├── stack.md             # detected languages/frameworks + focus areas
└── AUTHORIZATION.md     # engagement/authorization scope
```

## Supported stacks

**Any.** The plugin auto-detects your stack (JavaScript/TypeScript, Python, Go, Rust, Java, PHP, …) from
manifests and file types, and tailors its focus areas accordingly. No configuration required.

## ⚠️ Authorized use only

Static code review runs anywhere. Any active-testing capability (on the roadmap) **refuses to run** without
a completed `AUTHORIZATION.md`. Only run this against systems you own or are explicitly authorized to assess.

## Roadmap

- **Live verification** — run the app + read-only checks to turn "likely" findings into execution-confirmed.
- **Authorized active testing** — gated probes against a running, authorized instance.
- **CI GitHub Action** — scan changed files on every pull request.
- **Optional auto-fix-on-branch** and a **findings trend dashboard**.

## License

Apache-2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE) for the full license and third-party attributions.

<div align="center">

Made with 🛡️ by **[Syntic AI](https://syntic.ai)** · [**syntic.ai/bug-defender**](https://syntic.ai/bug-defender)

</div>
