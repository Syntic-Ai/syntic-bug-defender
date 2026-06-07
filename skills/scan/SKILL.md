---
name: scan
description: Run the full Syntic Bug Defender loop in the current repo — init, threat-model, vuln-scan, triage, report — in one command. Read-only; produces docs/security-audit.nosync/ artifacts.
allowed-tools: [Read, Glob, Grep, Write, Task, Bash(git:*), Bash(rg:*), Bash(jq:*), Bash(ls:*), Bash(mkdir:*), Bash(test:*)]
---

# /scan

Full Syntic Bug Defender audit loop. Runs five stages in order, each writing
to `docs/security-audit.nosync/`. All stages are **read-only with respect to
target source**; only the output folder is written.

This orchestrator does **not** duplicate the logic of the individual skills.
It invokes each skill in sequence, passes context forward, and emits a final
summary. See each referenced skill for full procedural detail.

---

## Pre-flight

1. Resolve project root: `${CLAUDE_PROJECT_DIR}` if set; otherwise cwd.
2. Tell the user:
   ```
   Syntic Bug Defender — full scan
   Project : {project_root}
   Stages  : init → threat-model → vuln-scan → triage → report
   ```
3. Record start time (ISO 8601) for the summary.

---

## Stage 1 — init

**Invoke skill: `/syntic-bug-defender:init`**

This stage creates `docs/security-audit.nosync/` (if absent), appends the
gitignore entry, detects the stack, and drops the authorization template.

Wait for the stage to complete. If it reports a fatal error (e.g. unable to
create the output folder), stop and surface the error to the user.

Confirm that `docs/security-audit.nosync/stack.md` now exists before
proceeding to Stage 2.

---

## Stage 2 — threat-model

**Invoke skill: `/syntic-bug-defender:threat-model`**

This stage reads code + git history to build the attack surface, STRIDE
threat table, and focus areas; writes
`docs/security-audit.nosync/THREAT_MODEL.md`.

Wait for completion. Proceed even if the threat model is incomplete (the
vuln-scan can fall back to `stack.md` focus areas); but log a warning if
`THREAT_MODEL.md` was not produced.

---

## Stage 3 — vuln-scan

**Invoke skill: `/syntic-bug-defender:vuln-scan`**

This stage reads `THREAT_MODEL.md` (or `stack.md`), fans out parallel
`sbd-discovery` subagents per focus area, collates candidate findings, and
writes them to:
- `docs/security-audit.nosync/findings.md`
- `docs/security-audit.nosync/ledger.json`

Wait for completion. Capture the number of raw candidates logged (from the
skill's output or by reading `ledger.json` after the stage). Proceed to
triage only if the ledger exists and has at least one finding; otherwise skip
Stages 4–5 and emit the summary with zero findings.

---

## Stage 4 — triage

**Invoke skill: `/syntic-bug-defender:triage`**

This stage spawns adversarial `sbd-verifier` subagents for each `open`
finding (multi-vote, majority rule), deduplicates, re-ranks by exploitability,
and updates `ledger.json` and `findings.md` with confirmed/false-positive
verdicts.

Wait for completion. Capture the triage summary (confirmed, false_positive,
duplicate counts) from the skill's output or by reading the updated
`ledger.json`.

---

## Stage 5 — report

**Invoke skill: `/syntic-bug-defender:report`**

This stage reads the final `ledger.json`, builds the self-contained HTML
report (inlining CSS from `assets/report.css` into the skeleton from
`templates/report-skeleton.html`), and writes:
- `docs/security-audit.nosync/report.html`
- `docs/security-audit.nosync/findings.sarif`

Wait for completion.

---

## Final summary

After all stages complete, print:

```
╔══════════════════════════════════════════════════════════╗
║         Syntic Bug Defender — Scan Complete              ║
╚══════════════════════════════════════════════════════════╝

Project : {project_name}
Duration: {elapsed time, e.g. "4m 12s"}

Findings by severity (confirmed + open):
  Critical : {critical_count}
  High     : {high_count}
  Medium   : {medium_count}
  Low      : {low_count}
  Info     : {info_count}
  ─────────────────────────────
  Total confirmed : {confirmed_count}
  False positives : {fp_count}
  Fixed/resolved  : {fixed_count}

Artifacts:
  Threat model : docs/security-audit.nosync/THREAT_MODEL.md
  Findings log : docs/security-audit.nosync/findings.md
  Ledger       : docs/security-audit.nosync/ledger.json
  HTML report  : docs/security-audit.nosync/report.html  ← open from file://
  SARIF        : docs/security-audit.nosync/findings.sarif

Next steps:
  /syntic-bug-defender:patch   — generate candidate fixes for confirmed findings
  /syntic-bug-defender:rescan  — re-run incrementally after you make changes
```

Derive counts by reading `docs/security-audit.nosync/ledger.json` after
Stage 5 completes. If the ledger is absent or empty, report zero for all
counts and note that no findings were discovered.

---

## Error handling

- If any stage fails partway through, report which stage failed, include the
  error message, and list which artifacts were successfully written before the
  failure.
- Do not retry a failed stage automatically. Tell the user to resolve the
  issue and re-run the individual skill (e.g.
  `/syntic-bug-defender:vuln-scan`).
- A failed `threat-model` is non-fatal (vuln-scan can proceed with
  `stack.md`). All other stage failures are fatal — stop and report.

---

## Constraints

- **Read-only with respect to target source.** The only writes are to
  `docs/security-audit.nosync/` and (one line append) `.gitignore`.
- **Existing `docs/` content is never modified.** The init skill is
  non-destructive; this guarantee is inherited.
- **No internet access.** All analysis is local static code review.
- **No builds, no test execution.** Static analysis only.
