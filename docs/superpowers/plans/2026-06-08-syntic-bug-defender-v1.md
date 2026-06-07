# Syntic Bug Defender v1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public, Apache-2.0, generic Claude Code plugin ("Syntic Bug Defender") that runs a security-audit loop (init → threat-model → vuln-scan → triage → patch → rescan + secret-scan) in any repo and emits a house-style HTML report (with self-contained left sidebar) + a machine-readable `.md` ledger + SARIF, written non-destructively into `docs/security-audit.nosync/`.

**Architecture:** A plugin repo whose root holds `.claude-plugin/{plugin.json,marketplace.json}`, bundled `skills/` (markdown SKILL.md), `agents/` (read-only swarm workers), and `assets/report.css` + `templates/`. Skill bodies are PORTED from the local reference harness `~/Desktop/syntic-defending-code/.claude/skills/*` and adapted: generic/stack-agnostic, output to `docs/security-audit.nosync/`, dual `.md`+`.html`, persistent ledger. Installed at user scope; reports are standalone offline HTML.

**Tech Stack:** Claude Code plugin (markdown skills/agents, JSON manifests), HTML/CSS + vanilla JS (report), SARIF JSON. Reference source: Anthropic defending-code-reference-harness (Apache-2.0).

**Build location:** `~/Desktop/syntic-bug-defender/` (greenfield git repo; the spec already lives in `docs/superpowers/`). Reference (read-only): `~/Desktop/syntic-defending-code/`.

**Validation tooling:** `claude plugin validate ./` (and `--strict`). Functional acceptance = install locally + run skills against two fixture repos (TS and Python) and inspect `docs/security-audit.nosync/`.

---

## Task 1: Repo scaffold + Apache-2.0 licensing

**Files:**
- Create: `~/Desktop/syntic-bug-defender/.gitignore`
- Create: `LICENSE`, `NOTICE`, `README.md`
- Create empty dirs: `skills/`, `agents/`, `assets/`, `templates/`, `.claude-plugin/`

- [ ] **Step 1: git init + directories**

Run:
```bash
cd ~/Desktop/syntic-bug-defender
git init
mkdir -p .claude-plugin skills agents assets templates fixtures
```

- [ ] **Step 2: LICENSE** — copy the Apache-2.0 text verbatim, retaining Anthropic's original copyright line, and append Syntic's copyright.

```bash
cp ~/Desktop/syntic-defending-code/LICENSE ./LICENSE
```
Then ensure the copyright section keeps `Copyright ... Anthropic` and add a line `Copyright 2026 Syntic AI`. Do NOT remove Anthropic's notice.

- [ ] **Step 3: NOTICE** (Apache §4(b) — state changes)

```markdown
Syntic Bug Defender
Copyright 2026 Syntic AI

This product is derived from and includes portions of:
  defending-code-reference-harness
  Copyright Anthropic, PBC — licensed under Apache License 2.0

Significant modifications by Syntic AI:
- Repackaged as a Claude Code plugin (skills/agents/manifest).
- Made stack-agnostic (auto stack detection; removed C/C++/ASAN-only assumptions).
- Added dual HTML+Markdown reporting with a self-contained navigable report.
- Added persistent per-project findings ledger, diff-aware rescan, secret-scan, and SARIF output.
- Added an authorization gate for future active-testing features.
```

- [ ] **Step 4: .gitignore**

```
# never commit local audit output or OS cruft
docs/security-audit.nosync/
.DS_Store
node_modules/
*.log
```

- [ ] **Step 5: README.md** — origin credit (no endorsement implication), install, usage, authorized-use note.

```markdown
# Syntic Bug Defender

A Claude Code plugin that runs an AI security-audit loop — threat model, vulnerability discovery,
adversarial verification, triage, and candidate fixes — in any repository, and produces a navigable
HTML report + machine-readable findings.

> Built on Anthropic's open-source [defending-code-reference-harness](https://github.com/anthropics/defending-code-reference-harness)
> (Apache-2.0), modified and extended by Syntic AI. Not affiliated with or endorsed by Anthropic.

## Install
```
/plugin marketplace add Syntic-Ai/syntic-bug-defender
/plugin install syntic-bug-defender@syntic-ai
/reload-plugins
```

## Use
```
/syntic-bug-defender:scan          # full loop in the current repo
/syntic-bug-defender:rescan        # diff-aware re-run; verifies prior fixes
```
Output is written non-destructively to `docs/security-audit.nosync/` (git- and iCloud-ignored).

## Authorized use only
Static code review runs anywhere. Active-testing features (roadmap) refuse to run without a completed
`AUTHORIZATION.md`. Only run this against systems you own or are explicitly authorized to assess.

## License
Apache-2.0. See LICENSE and NOTICE.
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore: scaffold plugin repo + Apache-2.0 license/NOTICE/README"
```

---

## Task 2: Plugin manifest

**Files:** Create `.claude-plugin/plugin.json`

- [ ] **Step 1: Write the manifest**

```json
{
  "name": "syntic-bug-defender",
  "displayName": "Syntic Bug Defender",
  "version": "0.1.0",
  "description": "AI security-audit loop (threat model, vuln scan, adversarial verify, triage, fixes) for any repo, with a navigable HTML report.",
  "author": { "name": "Syntic AI", "url": "https://github.com/Syntic-Ai" },
  "homepage": "https://github.com/Syntic-Ai/syntic-bug-defender",
  "repository": "https://github.com/Syntic-Ai/syntic-bug-defender",
  "license": "Apache-2.0",
  "keywords": ["security", "audit", "sast", "vulnerability", "code-review"]
}
```

- [ ] **Step 2: Validate**

Run: `cd ~/Desktop/syntic-bug-defender && claude plugin validate ./`
Expected: PASS (no errors). If `claude plugin` is unavailable, update Claude Code first.

- [ ] **Step 3: Commit**

```bash
git add .claude-plugin/plugin.json && git commit -m "feat: add plugin manifest"
```

---

## Task 3: Marketplace manifest

**Files:** Create `.claude-plugin/marketplace.json`

- [ ] **Step 1: Write it** (same-repo relative source)

```json
{
  "name": "syntic-ai",
  "owner": { "name": "Syntic AI", "url": "https://github.com/Syntic-Ai" },
  "plugins": [
    {
      "name": "syntic-bug-defender",
      "source": "./",
      "description": "AI security-audit loop for any repo, with a navigable HTML report."
    }
  ]
}
```

- [ ] **Step 2: Validate** — `claude plugin validate ./` → PASS.
- [ ] **Step 3: Commit** — `git add .claude-plugin/marketplace.json && git commit -m "feat: add marketplace manifest"`

---

## Task 4: Report stylesheet (Syntic house style)

**Files:** Create `assets/report.css`

- [ ] **Step 1: Create the house-style stylesheet + severity palette.** Put the editorial house style (cover page, exec-summary box, metric cards, bold black-header tables, highlight boxes, status badges) into `assets/report.css`, then APPEND severity + finding-card + sidebar rules:

```css
/* ---- Severity palette (Syntic Bug Defender) ---- */
:root{ --sev-critical:#ff3366; --sev-high:#b8860b; --sev-medium:#ca8a04; --sev-low:#1a7a3a; --sev-info:#0891b2; }
.sev-badge{display:inline-block;font-size:8pt;font-weight:700;padding:3px 10px;color:#fff;border-radius:2px;text-transform:uppercase;letter-spacing:.5px;}
.sev-critical{background:var(--sev-critical);} .sev-high{background:var(--sev-high);}
.sev-medium{background:var(--sev-medium);} .sev-low{background:var(--sev-low);} .sev-info{background:var(--sev-info);}
.sev-dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px;vertical-align:middle;}
.finding{border:2px solid #000;margin:14px 0;}
.finding .fhead{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:10px 14px;background:#f5f5f5;border-bottom:2px solid #000;}
.finding .fid{font-family:'SF Mono',monospace;font-weight:700;} .finding .ftitle{font-weight:700;flex:1;}
.finding .fbody{padding:12px 16px;} .finding .k{font-size:8.5pt;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#666;margin-top:8px;}
.status-fixed{background:#1a7a3a;} .status-open{background:#ca8a04;} .status-confirmed{background:#ff3366;}
/* ---- Self-contained left sidebar ---- */
:root{ --side-w:264px; }
body.has-side{ max-width:none;margin:0; }
.sd-side{position:fixed;top:0;left:0;width:var(--side-w);height:100vh;overflow-y:auto;background:#0f1115;color:#e6e9ef;padding:20px 14px;border-right:1px solid #2a2f3a;font-size:9.5pt;}
.sd-side h4{color:#9aa3b2;font-size:8pt;text-transform:uppercase;letter-spacing:1px;margin:16px 0 6px;}
.sd-side a{display:block;color:#cdd5e3;text-decoration:none;padding:3px 6px;border-radius:4px;}
.sd-side a:hover{background:#1d212b;} .sd-side a.active{background:#1d212b;color:#fff;}
.sd-main{margin-left:var(--side-w);} .sd-main .content{max-width:1000px;margin:0 auto;}
.sd-filter{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 10px;}
.sd-filter button{font-size:8pt;border:1px solid #2a2f3a;background:#11141a;color:#9aa3b2;border-radius:999px;padding:2px 8px;cursor:pointer;}
.sd-filter button.off{opacity:.4;text-decoration:line-through;}
@media (max-width:900px){ .sd-side{position:static;width:auto;height:auto;} .sd-main{margin-left:0;} }
@media print{ .sd-side{display:none;} .sd-main{margin-left:0;} body.has-side{max-width:1000px;margin:0 auto;} }
```

- [ ] **Step 2: Sanity check** — open a scratch HTML linking this CSS in a browser; confirm cover/tables/cards render and the sidebar is fixed-left. (Manual.)
- [ ] **Step 3: Commit** — `git add assets/report.css && git commit -m "feat: report stylesheet (house style + severity + sidebar)"`

---

## Task 5: Report HTML template + self-contained sidebar JS

**Files:** Create `templates/report-skeleton.html`

- [ ] **Step 1: Write the skeleton** the `report` skill fills in. CSS is INLINED at render time (copy `assets/report.css` contents into a `<style>`), so the output is a single portable file. Include the scroll-spy + severity-filter JS:

```html
<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{{PROJECT}} — Security Audit</title>
<style>/* {{INLINE assets/report.css HERE}} */</style></head>
<body class="has-side">
<nav class="sd-side">
  <div style="font-weight:800;font-size:13pt;color:#fff;">Syntic Bug Defender<span style="color:#ff3366;">.</span></div>
  <div style="color:#9aa3b2;font-size:8pt;margin-top:2px;">{{PROJECT}} · {{DATE}}</div>
  <div class="sd-filter">{{SEVERITY_FILTER_BUTTONS}}</div>
  <h4>Report</h4>
  <a href="#exec">Executive summary</a><a href="#overview">Severity overview</a>
  <h4>Findings</h4>{{FINDING_NAV}}
  <h4>Fixed / verified</h4>{{FIXED_NAV}}
</nav>
<div class="sd-main"><div class="content">{{COVER}}{{BODY}}</div>
<div class="page-footer">Generated by Syntic Bug Defender · {{DATE}}</div></div>
<script>
(function(){
  // scroll-spy
  var links=[].slice.call(document.querySelectorAll('.sd-side a[href^="#"]'));
  var map=links.map(function(a){var t=document.getElementById(a.getAttribute('href').slice(1));return{a:a,t:t};}).filter(function(x){return x.t;});
  function spy(){var y=window.scrollY+90,cur=null;map.forEach(function(x){if(x.t.offsetTop<=y)cur=x;});links.forEach(function(a){a.classList.remove('active');});if(cur)cur.a.classList.add('active');}
  window.addEventListener('scroll',spy,{passive:true});spy();
  // severity filter
  document.querySelectorAll('.sd-filter button').forEach(function(b){b.addEventListener('click',function(){
    b.classList.toggle('off');var sev=b.getAttribute('data-sev');var hide=b.classList.contains('off');
    document.querySelectorAll('.finding[data-sev="'+sev+'"]').forEach(function(f){f.style.display=hide?'none':'';});
    document.querySelectorAll('.sd-side a[data-sev="'+sev+'"]').forEach(function(a){a.style.display=hide?'none':'';});
  });});
})();
</script></body></html>
```

- [ ] **Step 2: Commit** — `git add templates/report-skeleton.html && git commit -m "feat: portable report skeleton + sidebar JS"`

---

## Task 6: `init` skill (setup + non-destructive output + stack detect + authorization)

**Files:** Create `skills/init/SKILL.md`, `templates/AUTHORIZATION.md`

- [ ] **Step 1: AUTHORIZATION template**

```markdown
# Authorization / Engagement Scope
- Asset owner:
- Authorized by:
- Date:
- In-scope paths/components:
- Out-of-scope:
- Notes:

> Static code review runs without this. Active-testing features REQUIRE this file completed.
```

- [ ] **Step 2: Write `skills/init/SKILL.md`** with this frontmatter and behavior:

```markdown
---
name: init
description: >-
  Set up Syntic Bug Defender in the current repo — create the non-destructive
  output folder docs/security-audit.nosync/, gitignore it, detect the stack, and
  drop an authorization template. Use before the first scan, or run automatically by /scan.
disable-model-invocation: false
allowed-tools: [Read, Glob, Grep, Write, Bash(git:*), Bash(ls:*), Bash(test:*), Bash(mkdir:*)]
---
```
Body requirements (write as numbered procedure):
1. Resolve project root via `${CLAUDE_PROJECT_DIR}` (fallback: cwd).
2. **Non-destructive folder:** if `docs/` exists, do NOT modify it; create `docs/security-audit.nosync/` only if missing (`mkdir -p`). If `docs/` does not exist, create `docs/` then the subfolder.
3. **gitignore:** if `.gitignore` lacks `docs/security-audit.nosync/`, append that one line (never rewrite the file).
4. **Stack detect:** read manifests/extensions (package.json, deno.json, requirements.txt/pyproject, go.mod, Cargo.toml, pom.xml, composer.json, *.csproj) and write `docs/security-audit.nosync/stack.md` summarizing detected languages/frameworks + suggested focus areas. Pull the focus-area idea from `~/Desktop/syntic-defending-code/.claude/skills/vuln-scan/SKILL.md` recon section.
5. Copy `${CLAUDE_PLUGIN_ROOT}/templates/AUTHORIZATION.md` to the output folder if absent.
6. Print what was created. Idempotent: re-running changes nothing already present.

- [ ] **Step 3: Validate** — `claude plugin validate ./` → PASS (skill discovered).
- [ ] **Step 4: Functional test** — in `fixtures/ts-app` (Task 16) run `/syntic-bug-defender:init`; assert `docs/security-audit.nosync/` + `stack.md` + `AUTHORIZATION.md` created and `.gitignore` has the line; re-run and assert no changes.
- [ ] **Step 5: Commit** — `git add skills/init templates/AUTHORIZATION.md && git commit -m "feat: init skill (non-destructive setup + stack detect + authz)"`

---

## Task 7: `threat-model` skill (ported, generic)

**Files:** Create `skills/threat-model/SKILL.md` (+ `skills/threat-model/schema.md`)

- [ ] **Step 1: Port from harness.** Adapt `~/Desktop/syntic-defending-code/.claude/skills/threat-model/{SKILL.md,bootstrap.md,schema.md}` into one generic skill. Frontmatter:

```markdown
---
name: threat-model
description: Build a threat model for the current repo from code + git history (language-agnostic). Writes THREAT_MODEL.md. Use before scanning or when asked to map the attack surface.
allowed-tools: [Read, Glob, Grep, Write, Bash(git:*), Bash(ls:*), Task]
---
```
Changes vs source: (a) drop checkpoint.py machinery — use a single in-skill pass; (b) write output to `docs/security-audit.nosync/THREAT_MODEL.md`; (c) keep the bootstrap stages (research swarm via Task → synthesize → generalize → STRIDE gap-fill) but generic across stacks; (d) keep the section schema (context/assets/entry-points/threats/deprioritized/open-questions/provenance/mitigations).

- [ ] **Step 2: Validate** → PASS.
- [ ] **Step 3: Functional test** — run on `fixtures/ts-app`; assert `THREAT_MODEL.md` written with the schema's sections.
- [ ] **Step 4: Commit** — `git add skills/threat-model && git commit -m "feat: threat-model skill (generic, ported)"`

---

## Task 8: `vuln-scan` skill + discovery subagents

**Files:** Create `skills/vuln-scan/SKILL.md`, `agents/sbd-discovery.md`

- [ ] **Step 1: discovery subagent** `agents/sbd-discovery.md`:

```markdown
---
name: sbd-discovery
description: Read-only security discovery worker for one focus area. Reports candidate findings as structured blocks. Never builds/runs/modifies.
tools: [Read, Glob, Grep, Bash]
---
```
Body: the review brief from `~/Desktop/syntic-defending-code/.claude/skills/vuln-scan/SKILL.md` (the per-subagent brief), generalized to all stacks (keep the injection/authz/crypto/secret categories; drop the C/C++-only emphasis to a "if native code present" note); output one `<finding>` block per candidate (id,file,line,category,severity,confidence,title,description,exploit_scenario,recommendation); read-only restriction stated verbatim; "do not open the output folder or any .nosync path."

- [ ] **Step 2: `skills/vuln-scan/SKILL.md`** frontmatter:

```markdown
---
name: vuln-scan
description: Static vulnerability discovery for the current repo. Reads THREAT_MODEL.md/stack.md, fans out parallel sbd-discovery subagents per focus area, writes findings to the ledger. Read-only — no building/running.
allowed-tools: [Read, Glob, Grep, Write, Task, Bash(rg:*), Bash(grep:*), Bash(ls:*)]
---
```
Body: derive focus areas from `THREAT_MODEL.md` §3/§4 (or `stack.md` if no threat model), spawn one `sbd-discovery` Task per area (cap 10), collate `<finding>` blocks, write/append to `docs/security-audit.nosync/findings.md` AND the JSON ledger `docs/security-audit.nosync/ledger.json` (schema in Task 9), assigning stable ids `SBD-001…`.

- [ ] **Step 3: Validate** → PASS. **Step 4: Functional test** — run on `fixtures/ts-app` (which contains a planted SQLi + XSS); assert ≥1 finding lands in `findings.md`/`ledger.json`.
- [ ] **Step 5: Commit** — `git add skills/vuln-scan agents/sbd-discovery.md && git commit -m "feat: vuln-scan skill + discovery subagent"`

---

## Task 9: `triage` skill + verifier subagent + ledger schema

**Files:** Create `skills/triage/SKILL.md`, `agents/sbd-verifier.md`, document `ledger.json` schema in `skills/triage/SKILL.md`

- [ ] **Step 1: Ledger schema** (document in the skill body):

```json
{
  "project": "string", "first_scan": "ISO", "last_scan": "ISO",
  "findings": [{
    "id": "SBD-001", "title": "", "file": "", "line": 0, "category": "",
    "severity": "critical|high|medium|low|info", "confidence": 0.0,
    "status": "open|confirmed|fixed|false_positive",
    "verdict": { "real": true, "votes": "2/3", "reason": "" },
    "evidence": "", "exploit_scenario": "", "recommendation": "",
    "first_seen": "ISO", "last_seen": "ISO"
  }]
}
```

- [ ] **Step 2: verifier subagent** `agents/sbd-verifier.md` (adversarial):

```markdown
---
name: sbd-verifier
description: Adversarial security verifier. Assumes a finding is a FALSE POSITIVE and tries to disprove it by reading the code. Read-only. Returns VERDICT/CONFIDENCE/EVIDENCE/REASON.
tools: [Read, Glob, Grep, Bash]
---
```
Body: from the audit's adversarial-verify pattern — assume false, search for the mitigation, quote exact lines, output `VERDICT: CONFIRMED|REFUTED|UNCERTAIN`, `CONFIDENCE: 1-10`, `EVIDENCE`, `REASON`.

- [ ] **Step 3: `skills/triage/SKILL.md`** frontmatter:

```markdown
---
name: triage
description: Verify, dedupe and rank findings in the ledger. Multi-vote adversarial verification per finding, dedupe vs prior rounds, re-rank by derived exploitability. Updates ledger.json + findings.md.
allowed-tools: [Read, Glob, Grep, Write, Task, Bash(jq:*), Bash(git log:*)]
---
```
Body: for each `open` finding, spawn N `sbd-verifier` Tasks (default 3), majority vote → set `status` (`confirmed`/`false_positive`) + `verdict`; dedupe against existing ledger entries by (file, category, root-cause); re-rank by severity×confidence; write back.

- [ ] **Step 4: Validate** → PASS. **Step 5: Functional test** — on `fixtures/ts-app`, after vuln-scan, run triage; assert the planted real bug → `confirmed`, an obvious non-issue → `false_positive`.
- [ ] **Step 6: Commit** — `git add skills/triage agents/sbd-verifier.md && git commit -m "feat: triage skill + adversarial verifier + ledger schema"`

---

## Task 10: `report` skill (HTML + SARIF from ledger)

**Files:** Create `skills/report/SKILL.md`

- [ ] **Step 1: Frontmatter**

```markdown
---
name: report
description: Render the security report from the ledger — a self-contained house-style HTML with a left sidebar, plus SARIF. Reads ledger.json; writes report.html + findings.sarif.
allowed-tools: [Read, Glob, Write, Bash(ls:*)]
---
```
Body requirements:
1. Read `docs/security-audit.nosync/ledger.json`.
2. Load `${CLAUDE_PLUGIN_ROOT}/templates/report-skeleton.html` and inline `${CLAUDE_PLUGIN_ROOT}/assets/report.css` into its `<style>`.
3. Build: cover (project, date, "Confidential", counts), exec-summary box, severity metric-card grid (counts per severity), `{{SEVERITY_FILTER_BUTTONS}}` (one `<button data-sev=...>` per severity present), `{{FINDING_NAV}}` (grouped by severity, each `<a data-sev=.. href=#SBD-NNN><span class="sd-dot" style=..></span>id — title</a>`), `{{FIXED_NAV}}`, and `{{BODY}}` = one `.finding[data-sev]` card per finding (id, sev-badge, location, description, exploit, recommendation, status badge).
4. Write `docs/security-audit.nosync/report.html` (single file, no external refs).
5. Write `docs/security-audit.nosync/findings.sarif` (SARIF 2.1.0: one `result` per finding with `ruleId`=category, `level` mapped from severity, `locations` from file:line).

- [ ] **Step 2: Validate** → PASS. **Step 3: Functional test** — render from a sample ledger; open `report.html` from `file://` (no network), confirm sidebar scroll-spy + severity filter work and `@media print` hides the sidebar; validate `findings.sarif` against the SARIF schema (e.g. an online/CLI SARIF validator).
- [ ] **Step 4: Commit** — `git add skills/report && git commit -m "feat: report skill (portable HTML + SARIF)"`

---

## Task 11: `scan` orchestrator skill

**Files:** Create `skills/scan/SKILL.md`

- [ ] **Step 1: Frontmatter + body**

```markdown
---
name: scan
description: Run the full Syntic Bug Defender loop in the current repo — init, threat-model, vuln-scan, triage, report — in one command. Read-only; produces docs/security-audit.nosync/ artifacts.
allowed-tools: [Read, Glob, Grep, Write, Task, Bash(git:*), Bash(rg:*), Bash(jq:*), Bash(ls:*), Bash(mkdir:*), Bash(test:*)]
---
```
Body: invoke the stages in order (init → threat-model → vuln-scan → triage → report), each reading/writing the shared output folder; print a summary (counts by severity, path to report.html). Stages are the other skills' procedures (reference them by name; do not duplicate their full logic).

- [ ] **Step 2: Validate** → PASS. **Step 3: Functional test** — `/syntic-bug-defender:scan` on `fixtures/ts-app` produces `{THREAT_MODEL.md, findings.md, ledger.json, report.html, findings.sarif}`; existing `docs/` untouched.
- [ ] **Step 4: Commit** — `git add skills/scan && git commit -m "feat: scan orchestrator"`

---

## Task 12: `patch` skill + reviewer subagent (surgical/simplicity principles)

**Files:** Create `skills/patch/SKILL.md`, `agents/sbd-patch-reviewer.md`

- [ ] **Step 1: reviewer subagent** `agents/sbd-patch-reviewer.md` — sees ONLY {file,line,category,diff} (not finding prose). Encodes §10a litmus: REJECT out-of-scope hunks; REJECT if over-restrictive / would break a legitimate dependency or flow; REJECT symptom-suppression. Output `REVIEW: ACCEPT|REJECT`, `STYLE_SCORE`, `OUT_OF_SCOPE_HUNKS`, `REASON`.

```markdown
---
name: sbd-patch-reviewer
description: Reviews a candidate security diff as a maintainer. Sees only location+category+diff. Enforces surgical, minimal, non-breaking fixes. Read-only.
tools: [Read, Glob, Grep]
---
```

- [ ] **Step 2: `skills/patch/SKILL.md`** — inert diffs only; never applies. Frontmatter:

```markdown
---
name: patch
description: Generate candidate fixes for confirmed findings as INERT diffs for human review. Per-finding author subagent + independent sbd-patch-reviewer. Writes patches/*.diff. Never applies changes.
allowed-tools: [Read, Glob, Grep, Write, Task]
---
```
Body: for each `confirmed` finding, spawn a patch author (root-cause, MINIMAL/surgical diff, variant hunt, adversarial self-check, regression-test note — per §10a) then the reviewer; write `docs/security-audit.nosync/patches/SBD-NNN.diff` + a `patches.md` index with review verdicts. Guardrail: Write only under the output folder; never `git apply`/Edit target source.

- [ ] **Step 3: Validate** → PASS. **Step 4: Functional test** — on `fixtures/ts-app` confirmed findings, assert `patches/*.diff` produced and the index shows reviewer verdicts; assert no target source file changed.
- [ ] **Step 5: Commit** — `git add skills/patch agents/sbd-patch-reviewer.md && git commit -m "feat: patch skill + reviewer (surgical/simplicity gate)"`

---

## Task 13: `secret-scan` skill

**Files:** Create `skills/secret-scan/SKILL.md`

- [ ] **Step 1: Frontmatter + body**

```markdown
---
name: secret-scan
description: Scan the repo and git history for committed secrets, key material, and .env/.nosync hygiene issues. Adds high-priority findings to the ledger.
allowed-tools: [Read, Glob, Grep, Write, Bash(git:*), Bash(rg:*), Bash(ls:*)]
---
```
Body: grep working tree + `git log -p`/`git ls-files` for secret patterns (private keys `-----BEGIN`, JWT `eyJ`, `sk_live`/`sk_test`, AWS `AKIA`, mnemonics/`HD_WALLET`, generic high-entropy assignments, committed `.env`); flag tracked `.env`, secrets outside `.nosync`. Write findings into the ledger at high severity. Read-only; do NOT echo secret VALUES into artifacts — record location + type only.

- [ ] **Step 2: Validate** → PASS. **Step 3: Functional test** — `fixtures/ts-app` has a planted fake `AKIA...` + committed `.env`; assert both flagged, and that the secret VALUE is not written into `findings.md`.
- [ ] **Step 4: Commit** — `git add skills/secret-scan && git commit -m "feat: secret-scan skill"`

---

## Task 14: `rescan` skill (diff-aware)

**Files:** Create `skills/rescan/SKILL.md`

- [ ] **Step 1: Frontmatter + body**

```markdown
---
name: rescan
description: Re-run the audit incrementally — verify prior findings are fixed, and scan only what changed since the last run (or a git ref) for net-new issues. Updates the ledger + report.
allowed-tools: [Read, Glob, Grep, Write, Task, Bash(git:*), Bash(jq:*), Bash(rg:*)]
---
```
Body: read `ledger.json`; (1) re-verify each non-`fixed` finding via `sbd-verifier` against current code — if the cited sink/issue is gone, set `status:fixed` + `last_seen`; (2) compute changed files via `git diff --name-only <last_scan_ref|HEAD~..HEAD>` and run `sbd-discovery` only on those; (3) dedupe net-new vs ledger; (4) re-run triage on net-new; (5) call `report`. Store the scan ref in the ledger for next time.

- [ ] **Step 2: Validate** → PASS. **Step 3: Functional test** — on `fixtures/ts-app`: scan, fix one planted bug in a commit, `rescan`; assert the fixed one flips to `fixed` and only changed files are re-scanned.
- [ ] **Step 4: Commit** — `git add skills/rescan && git commit -m "feat: diff-aware rescan"`

---

## Task 15: Fixtures for functional tests

**Files:** Create `fixtures/ts-app/` and `fixtures/py-app/` (tiny planted-bug repos, each its own git repo)

- [ ] **Step 1: ts-app** — minimal Node/TS repo with: a raw-SQL-string query (SQLi), a `dangerouslySetInnerHTML` with untrusted input (XSS), a committed `.env`, and a fake `AKIA0000000000000000` secret. `git init && git add -A && git commit`.
- [ ] **Step 2: py-app** — minimal Python repo with: an f-string SQL query (SQLi) and a `subprocess` call with user input (command injection). `git init && commit`.
- [ ] **Step 3: Commit fixtures** — `git add fixtures && git commit -m "test: planted-bug fixtures (ts, py)"`

---

## Task 16: End-to-end install + acceptance run

- [ ] **Step 1: Local install** — `/plugin marketplace add ~/Desktop/syntic-bug-defender` then `/plugin install syntic-bug-defender@syntic-ai` (user scope), `/reload-plugins`. Confirm `/syntic-bug-defender:*` commands exist in an unrelated repo.
- [ ] **Step 2: Acceptance — TS** — in `fixtures/ts-app` run `/syntic-bug-defender:scan`; verify all acceptance criteria from spec §11 (artifacts present, `docs/` untouched, folder gitignored+`.nosync`, report sidebar/filters work offline, SARIF valid, secret value not leaked).
- [ ] **Step 3: Acceptance — Python (no code changes)** — run `/syntic-bug-defender:scan` in `fixtures/py-app`; confirm stack auto-detected and the planted bugs found — proving stack-agnostic.
- [ ] **Step 4: Run patch + rescan** — produce `patches/`, then commit a fix and `rescan`; confirm fixed-status flip.
- [ ] **Step 5: `claude plugin validate --strict ./`** → PASS. Fix any warnings.
- [ ] **Step 6: Commit** — `git commit -am "test: end-to-end acceptance on ts + py fixtures"`

---

## Task 17: Publish

- [ ] **Step 1:** Create the public repo `github.com/Syntic-Ai/syntic-bug-defender` (gh: `gh repo create Syntic-Ai/syntic-bug-defender --public`).
- [ ] **Step 2:** `git remote add origin git@github.com:Syntic-Ai/syntic-bug-defender.git && git push -u origin main`.
- [ ] **Step 3:** From a clean machine/profile, test the public install flow in README (`/plugin marketplace add Syntic-Ai/syntic-bug-defender` → install) to confirm it works for others.
- [ ] **Step 4:** Tag `v0.1.0` (`git tag v0.1.0 && git push --tags`); confirm `version` in plugin.json matches.

---

## Self-review (completed by plan author)
- **Spec coverage:** plugin/marketplace (T2-3), Apache attribution (T1), init/non-destructive/.nosync/gitignore (T6), threat-model (T7), vuln-scan+swarm (T8), triage+adversarial verify+ledger (T9), report HTML house-style+sidebar+SARIF (T4-5,T10), scan orchestrator (T11), patch+surgical/simplicity gate §10a (T12), secret-scan (T13), diff-aware rescan (T14), generic/stack-agnostic proven via py fixture (T15-16), authorization template (T6), publish (T17). Roadmap B/C intentionally excluded (separate specs).
- **Placeholders:** none — each skill task gives full frontmatter, exact output paths, and a functional test; skill bodies are ported from named harness files (legitimate reference, not a TODO).
- **Naming consistency:** namespace `syntic-bug-defender`, subagents `sbd-discovery`/`sbd-verifier`/`sbd-patch-reviewer`, ids `SBD-NNN`, output `docs/security-audit.nosync/`, ledger `ledger.json` — used consistently across tasks.
