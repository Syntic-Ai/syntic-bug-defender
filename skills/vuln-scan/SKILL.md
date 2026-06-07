---
name: vuln-scan
description: Static vulnerability discovery for the current repo. Reads THREAT_MODEL.md/stack.md, fans out parallel sbd-discovery subagents per focus area, writes findings to the ledger. Read-only — no building/running.
allowed-tools: [Read, Glob, Grep, Write, Task, Bash(rg:*), Bash(grep:*), Bash(ls:*)]
---

# /vuln-scan

Static vulnerability discovery via a parallel swarm of read-only subagents.
Reads `docs/security-audit.nosync/THREAT_MODEL.md` (or `stack.md` if no
threat model exists) to derive focus areas, fans out one `sbd-discovery`
subagent per area (cap 10), collates `<finding>` blocks, and writes
`docs/security-audit.nosync/findings.md` + `docs/security-audit.nosync/ledger.json`.

**This skill does not execute code.** It reads source and reasons about it.
Every subagent is strictly read-only; no builds, no network, no writes.

---

## Step 1 — Resolve paths

1. Resolve the project root: use `${CLAUDE_PROJECT_DIR}` if set, otherwise
   the current working directory.
2. Set `OUTPUT_DIR = <project_root>/docs/security-audit.nosync/`.
3. Confirm `OUTPUT_DIR` exists. If not, tell the user to run
   `/syntic-bug-defender:init` first and stop.

---

## Step 2 — Derive focus areas

### 2a. Prefer THREAT_MODEL.md

Read `OUTPUT_DIR/THREAT_MODEL.md` if it exists. Parse:
- §3 "Entry points & trust boundaries" — each subsystem or entry point
  becomes a candidate focus area with its trust label.
- §4 "Threats" — each threat row adds a focus area if it maps to a distinct
  code region not already covered.

Deduplicate and compress overlapping areas (e.g. "API auth" and "JWT
handling" may merge to "Authentication & authorization"). Target 3–10 areas.

### 2b. Fallback to stack.md

If `THREAT_MODEL.md` is absent, read `OUTPUT_DIR/stack.md`. Derive focus
areas from the detected stack using the following heuristics:

| Detected stack signal              | Suggested focus areas                                         |
|------------------------------------|---------------------------------------------------------------|
| Web framework (Express, FastAPI, Flask, Rails, Django, Spring, Laravel, ASP.NET) | Input handling & injection, Authentication & session mgmt, Output encoding & XSS |
| Database ORM / raw SQL             | SQL injection & query construction                            |
| File upload / static serving       | Path traversal & file access control                          |
| Auth library (JWT, OAuth, Passport, NextAuth) | Token validation, privilege escalation, TOCTOU         |
| Template engine                    | Server-side template injection, XSS escape hatches            |
| Subprocess / shell execution       | Command injection                                             |
| Serialization (pickle, yaml, JSON) | Unsafe deserialization                                        |
| Crypto primitives                  | Weak/broken cryptography, hardcoded secrets                   |
| Native/FFI code (C, C++, Rust unsafe) | Memory safety                                              |
| Any stack                          | Hardcoded secrets & credential hygiene                        |

Use a minimum of 3 and maximum of 10 focus areas.

### 2c. Single-file / tiny target override

If the project has fewer than 15 source files (count with
`rg --files <project_root> | wc -l`, excluding `docs/`, `node_modules/`,
`.git/`, `__pycache__/`, `dist/`, `build/`), collapse to a single focus
area covering the whole codebase and run in single-pass mode (one subagent).

Tell the user the focus areas and approximate file count before proceeding.

---

## Step 3 — Fan out discovery subagents

Spawn **one Task per focus area in parallel** (single message with all Task
calls), each with `subagent_type: sbd-discovery`. The agent body loads
automatically from the named subagent_type — do not instruct the subagent to
read its own agent file. Cap at 10 concurrent. Pass each subagent:

```
FOCUS_AREA: {focus_area_name}
FOCUS_IDX: {01-10}
PROJECT_ROOT: {absolute path to project root}
TRUST_BOUNDARY: {from THREAT_MODEL.md §3, or "untrusted HTTP input → application process" if absent}
STACK: {one-line summary from stack.md, or "unknown"}
Your focus area is: {focus_area_name}
{if THREAT_MODEL.md describes threats relevant to this area, quote the relevant rows here}
```

If the target has fewer than 15 source files (§2c), use a single Task with
`FOCUS_AREA: full codebase` and `FOCUS_IDX: 01`.

---

## Step 4 — Collate findings

1. Collect all `<finding>` blocks from every subagent response.
2. Drop blocks where `<category>none</category>` (these are "nothing found"
   placeholders).
3. **Light dedupe:** if two findings share the same `<file>` and
   `<category>` and their `<line>` values are within 5 of each other, keep
   the one with the longer `<description>` and note the dropped id.
4. Sort remaining findings by (severity desc, confidence desc, file, line)
   using this severity order: critical > high > medium > low > info.
5. Assign stable **ledger ids** `SBD-001`, `SBD-002`, ... in that sorted
   order.

---

## Step 5 — Load or initialize the ledger

Read `OUTPUT_DIR/ledger.json` if it exists; parse the `findings` array.

**Merge logic:**
- For each newly collated finding, check whether a ledger entry already
  exists with the same `file`, `category`, and overlapping `line` (within 5).
  - If a match exists: skip (do not overwrite a finding that is already
    being tracked). Note the skip.
  - If no match: assign a new id continuing from the highest existing
    `SBD-NNN` in the ledger (or from `SBD-001` if the ledger is empty),
    and add it with `status: "open"`.

If `ledger.json` does not exist, create a new ledger structure (see
§6 schema).

---

## Step 6 — Write outputs

### 6a. `docs/security-audit.nosync/findings.md`

Write (append if file exists; add a `---` separator + timestamp header if
appending) a human-readable markdown report:

```markdown
## vuln-scan run — {ISO timestamp}

Focus areas: {comma-separated list}
Files scanned: ~{N}
New findings: {count} ({critical}/{high}/{medium}/{low}/{info})

### Summary table

| ID | Sev | Category | File:Line | Title |
|----|-----|----------|-----------|-------|
| SBD-001 | high | sql-injection | src/db.js:42 | Raw query built from user input |
...

### Finding details

#### SBD-001 — {title}
**File:** `{file}:{line}`
**Category:** {category}  **Severity:** {severity}  **Confidence:** {confidence}

**Description:**
{description}

**Exploit scenario:**
{exploit_scenario}

**Recommendation:**
{recommendation}
```

### 6b. `docs/security-audit.nosync/ledger.json`

Write the full ledger JSON. Schema:

```json
{
  "project": "<project root basename>",
  "first_scan": "<ISO datetime of first ever scan>",
  "last_scan": "<ISO datetime of this run>",
  "findings": [
    {
      "id": "SBD-001",
      "title": "",
      "description": "",
      "file": "",
      "line": 0,
      "category": "",
      "severity": "critical|high|medium|low|info",
      "confidence": 0.0,
      "status": "open|confirmed|fixed|false_positive",
      "verdict": { "real": false, "votes": "0/0", "reason": "pending triage" },
      "evidence": "",
      "exploit_scenario": "",
      "recommendation": "",
      "first_seen": "<ISO>",
      "last_seen": "<ISO>"
    }
  ]
}
```

For new findings written by this skill:
- `status`: `"open"`
- `description`: populated from the discovery subagent's `<description>` tag in its `<finding>` block
- `verdict`: `{ "real": false, "votes": "0/0", "reason": "pending triage" }`
- `evidence`: `""` (filled by triage)
- `first_seen` and `last_seen`: this run's ISO timestamp

Preserve all existing ledger fields for pre-existing entries; only update
`last_seen` on entries whose file:line were re-observed.

---

## Step 7 — Hand back

Tell the user:

1. **Counts:** N new findings (critical/high/medium/low/info split), K focus
   areas, ~M source files. X findings already in ledger (skipped).
2. **Top 3** new findings by (severity, confidence), one line each:
   `SBD-NNN [severity] category — file:line — title`
3. **Next step:**
   `> /syntic-bug-defender:triage` to adversarially verify and rank findings.
4. Remind: these are **static candidates**, not verified. The triage step
   provides N-vote adversarial verification.

---

## Constraints

- **Never execute target code.** No Bash beyond the read-only enumeration
  commands listed in `allowed-tools`.
- **Stay in the project root.** Do not follow symlinks or `..` outside it.
- **Write only under `docs/security-audit.nosync/`.** Never modify source files.
- **Do not open `.nosync` paths inside source.** Only write to the one
  designated output folder.
- Findings are candidates for `/triage`, not final verdicts. This skill
  never drops a finding — triage does the rigorous N-vote verification.
