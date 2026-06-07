# Syntic Bug Defender — Design Spec

- **Date:** 2026-06-08
- **Status:** Draft for review
- **Display name:** Syntic Bug Defender · **Plugin/namespace:** `syntic-bug-defender` (commands `/syntic-bug-defender:*`)
- **Home repo:** `github.com/Syntic-Ai/syntic-bug-defender` (public)
- **Derived from:** Anthropic `defending-code-reference-harness` (Apache-2.0) — modified & extended by Syntic AI.

---

## 1. Overview & goal
A Claude Code **plugin** that packages a security-audit workflow (threat-model → discover → adversarially verify → triage → inert patches → re-scan) so it can be installed once at **user scope** and run inside **any project**. Public, generic, stack-agnostic. Produces a polished **HTML** report (Syntic house design) plus a machine-readable **`.md`** working copy the workflow consumes, written non-destructively into the target project. Built to extend later with live verification and authorized active pentest.

Primary user story: *"In any repo, I run `/syntic-bug-defender:scan` and get a ranked, verified, de-duplicated security report (HTML + MD) in `docs/security-audit.nosync/`, with candidate fixes — and re-running later only surfaces what's new."*

## 2. Scope
- **v1 (this spec):** the static loop as a plugin + per-project state + dual-format reporting + auto stack-detect + diff-aware re-scan + secret scan + SARIF + authorization scaffold. Read-only; patches are inert diffs.
- **Roadmap (separate specs):** v2 live verification (run app, read-only DB/RLS checks); v3 authorization-gated active pentest; CI GitHub Action; optional auto-fix-on-branch; findings trend dashboard. Seams are designed in v1; features are not built in v1 (YAGNI).

## 3. Distribution, install & licensing
- **Marketplace:** the repo root carries `.claude-plugin/marketplace.json` (name `syntic-ai`, owner Syntic AI) listing the `syntic-bug-defender` plugin (same repo, relative source).
- **Install:** `/plugin marketplace add Syntic-Ai/syntic-bug-defender` → `/plugin install syntic-bug-defender@syntic-ai` at **user scope** (available in every repo; `/reload-plugins` to activate without restart).
- **Versioning:** set `version` in `plugin.json` and bump per release (so installs are deterministic; do not also set version in the marketplace entry).
- **Apache-2.0 compliance (public release):** ship `LICENSE` (Apache-2.0, retain Anthropic copyright), a `NOTICE` stating *"Derived from Anthropic's defending-code-reference-harness (Apache-2.0); modified and extended by Syntic AI"* and listing significant changes, and a README that credits the origin without implying Anthropic endorsement. No Anthropic trademarks used to suggest endorsement.

## 4. Plugin repo layout
```
syntic-bug-defender/
├── .claude-plugin/
│   ├── plugin.json              # name: syntic-bug-defender, version, displayName "Syntic Bug Defender"
│   └── marketplace.json         # marketplace "syntic-ai" listing this plugin
├── skills/
│   ├── scan/SKILL.md            # orchestrator: runs the full loop (init→threat-model→vuln-scan→triage→report)
│   ├── init/SKILL.md            # set up output folder, gitignore/.nosync, AUTHORIZATION template, stack detect
│   ├── threat-model/SKILL.md
│   ├── vuln-scan/SKILL.md
│   ├── triage/SKILL.md          # adversarial multi-vote verify + dedupe + rank
│   ├── patch/SKILL.md           # inert candidate diffs
│   ├── rescan/SKILL.md          # diff-aware re-run + verify prior fixes + net-new
│   ├── secret-scan/SKILL.md     # committed secrets + .env/nosync hygiene
│   └── report/SKILL.md          # render HTML (house style) + SARIF from the working .md ledger
├── agents/                      # read-only swarm workers (discovery, verifier, etc.)
├── assets/report.css            # Syntic house-style stylesheet (severity palette)
├── templates/AUTHORIZATION.md   # blank engagement/authorization template
├── LICENSE  ├── NOTICE  ├── README.md
```
Reference bundled files via `${CLAUDE_PLUGIN_ROOT}`; never store state in the plugin dir (it's replaced on update).

## 5. Skills (v1)
Each skill is stack-agnostic, reads `AUTHORIZATION.md` + the project's threat model when present, and writes both a `.md` (working/state) and (via `report`) `.html`.

| Command | Purpose | Reads | Writes |
|---|---|---|---|
| `init` | Detect stack; create `docs/security-audit.nosync/`; append folder to `.gitignore` (if missing); drop `AUTHORIZATION.md` template + `stack.md` | repo tree, manifests | folder, gitignore line, AUTHORIZATION.md, stack.md |
| `threat-model` | Bootstrap a threat model from code + git history (language-agnostic) | repo, git log | `THREAT_MODEL.md` |
| `vuln-scan` | Parallel discovery subagents per focus area (recall-optimized) | threat model, source | `findings.md` (+ JSON ledger) |
| `triage` | Adversarial multi-vote verification (assume false → disprove), dedupe vs ledger, rank by derived exploitability | findings, source | updates ledger w/ verdicts |
| `patch` | Per-finding inert candidate diff + independent reviewer | triaged findings, source | `patches/*.diff` (+ notes) |
| `secret-scan` | Committed secrets, key material, `.env`/`.nosync` hygiene | repo + git history | findings (high priority) |
| `rescan` | Diff-aware: verify prior fixes are closed + scan changes since last run/ref + net-new | ledger, git diff | updated ledger + new report |
| `report` | Render the HTML house-style report + SARIF from the ledger | ledger, `assets/report.css` | `report.html`, `findings.sarif` |
| `scan` | Orchestrator that chains init→threat-model→vuln-scan→triage→report in one go | — | full set |

Subagents (in `agents/`, read-only `Read`/`Grep`/`Glob`/`Bash`-read): discovery workers, the adversarial verifier, and the patch reviewer. Skills spawn them via Task.

## 6. Per-project behavior, output & state
- **Output dir:** `docs/security-audit.nosync/` in the target repo (resolve root via `${CLAUDE_PROJECT_DIR}`). The `.nosync` suffix excludes it from iCloud Drive; `init` also appends the folder to `.gitignore` if not already ignored. **Non-destructive:** never modify or overwrite an existing `docs/`; only create the subfolder and append one gitignore line.
- **Dual artifacts per run:** `*.md` (working/state — diffable, consumed by the next stage and by `rescan` for dedup) and `report.html` (presentation). `findings.sarif` for tooling.
- **Per-project ledger:** `ledger.json` (or `findings.md` table) holds every finding with stable id, status (open/confirmed/fixed/false-positive), severity, evidence, and first/last-seen — so re-scans dedupe against history and can show a trend.
- **No cross-project bleed:** all state lives in the target repo's audit folder; nothing project-specific is stored in the plugin.

## 7. Reporting design system (Syntic house style)
Adapt the XCHATS `ARCHITECTURE.html`/`MARKETING_PLAN.html` CSS into `assets/report.css`: A4 print-ready, cover page (logo, "Confidential", version/date), black **exec-summary** box, **metric-card** grid for counts, bold black-header **tables**, **highlight-box** callouts, monospace `pre/code`, **status badges**. Severity → palette: **Critical** = pink `#ff3366`, **High** = amber `#b8860b`, **Medium** = `#ca8a04`, **Low** = green `#1a7a3a`; badges map to `confirmed/open/fixed`. Findings render as cards (id, severity, location, description, exploit, fix, status). Cover shows project name + scan date + counts.

**Left-side navigation sidebar (like the Syntic doc system).** The HTML report carries a sticky **left sidebar** mirroring `sidebar.js`/`shared-styles.css` from XCHATS, but **fully self-contained** (CSS + a tiny vanilla-JS scroll-spy inlined into the report, plus the stylesheet also shipped as `assets/report.css` for reference) so a single dropped-in `report.html` is portable with **zero external files**. The sidebar lists: Executive summary, Severity overview, and a grouped, jump-to **finding index** (grouped by severity, each item shows its id + a severity dot), plus a "Fixed / verified" section for re-scans. Behaviors: scroll-spy highlights the active section, **severity filter** toggles (show only Critical/High/…), collapsible groups, and it **collapses to a top bar on narrow screens / hides in print** (`@media print`) so the A4/PDF export stays clean. No network/CDN dependencies — works offline from `file://`.

## 8. Authorization & dual-use safety (required for public)
- `init` writes a **blank `AUTHORIZATION.md`** template (asset owner, in-scope paths, authorized-by, date). Static review (v1) runs regardless. Any future **active** capability (v3) **refuses to run** unless `AUTHORIZATION.md` is filled in.
- README states **authorized-targets-only** for active features; static code review is positioned like Anthropic's public `claude-code-security-review`.
- No active-exploitation tooling ships in v1.

## 9. Generic / stack-agnostic (required for public)
- **Zero company specifics** — no GX Bank/iwando data, no hardcoded emails, no Supabase-only defaults. `init` auto-detects stack from manifests/extensions and tailors focus areas (web/TS, Python, Go, Rust, Java, etc.). Supabase/web3 patterns are *one* detectable profile among many, not the default.

## 10. Advanced capabilities (beyond the reference harness)
**In v1:** auto stack-detect; diff-aware re-scan (scan since git ref); persistent findings ledger + dedupe + trend; adversarial multi-vote verification as standard; dedicated secret-scan; SARIF output; dual HTML+MD reporting.
**Roadmap (own specs, seams in v1):** v2 live verification (run app / read-only DB+RLS checks to confirm "static" findings); v3 authorization-gated active pentest (XSS/IDOR/injection probes against a running, authorized instance); CI GitHub Action (scan changed files on PR); optional auto-fix-on-branch; findings trend dashboard.

## 10a. Skill-authoring & patch-quality principles (adopted)
Inspired by the Karpathy-style guidelines (`multica-ai/andrej-karpathy-skills`, a behavioral CLAUDE.md — no code lifted, principles only). Encode these directly in the skills, especially `patch`/`triage`:
- **Surgical changes** — candidate diffs touch only the root-cause path; no refactor, reformat, or drive-by cleanup. The patch reviewer **rejects** out-of-scope hunks.
- **Simplicity / not over-restrictive** — the reviewer applies a litmus test: *"would a senior engineer call this overcomplicated, or would it break a legitimate dependency/flow?"* (Directly targets the real failure mode where a fix is so restrictive it breaks service connections.)
- **Think before coding (no silent assumptions)** — `threat-model` states trust boundaries/assumptions explicitly; the verifier never assumes exploitability, it must disprove.
- **Goal-driven / verifiable** — every finding carries testable success criteria; adversarial verdicts + per-finding acceptance criteria are the gate, not prose.
- **Authoring style for every SKILL.md** — problem (failure mode it prevents) → concrete rules → a one-line litmus test. Keeps each skill sharp and self-checking.

## 11. Acceptance criteria (v1)
- Installs from the public marketplace at user scope; commands appear as `/syntic-bug-defender:*` in a fresh repo after `/reload-plugins`.
- In any repo, `/syntic-bug-defender:scan` produces `docs/security-audit.nosync/{THREAT_MODEL.md, findings.md, report.html, findings.sarif}` without touching existing `docs/`; the folder is gitignored and `.nosync`.
- `report.html` matches the Syntic house style with severity-colored cards + metric counts, and includes a **self-contained sticky left sidebar** (scroll-spy + severity filter + jump-to finding index) that works offline from `file://` with no external files and is hidden in print/PDF.
- `rescan` re-verifies prior fixes (marks fixed) and only surfaces net-new since the last run.
- `secret-scan` flags a planted test secret. Runs on at least two different stacks (e.g. a TS repo and a Python repo) without code changes.
- Repo ships LICENSE + NOTICE + README with correct Apache-2.0 attribution; contains no GX Bank data.

## 12. Risks / open questions
- Passkey-style Beta/plugin API drift — pin to documented plugin manifest fields; validate with `claude plugin validate`.
- Command namespace `syntic-bug-defender:` is verbose — optionally shorten to `syntic-defender` (decision pending).
- Token cost of large swarms — make swarm width configurable; default modest.
- SARIF schema fidelity — validate against GitHub code-scanning ingest.

## 13. Provenance
Brainstormed via superpowers:brainstorming on 2026-06-08. Built on Anthropic's open-source defending-code-reference-harness (Apache-2.0). Next step after spec approval: superpowers:writing-plans → implementation plan.
