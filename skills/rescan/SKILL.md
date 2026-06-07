---
name: rescan
description: Re-run the audit incrementally — verify prior findings are fixed, and scan only what changed since the last run (or a git ref) for net-new issues. Updates the ledger + report.
allowed-tools: [Read, Glob, Grep, Write, Task, Bash(git:*), Bash(jq:*), Bash(rg:*)]
---

# /syntic-bug-defender:rescan

Diff-aware re-audit. Re-verifies all non-`fixed` findings against the current
code, marks resolved issues as `fixed`, then scans only files that changed
since the last scan for net-new vulnerabilities. Avoids re-running the full
scan on an already-audited codebase.

**Read-only with respect to all target source files.** Only
`docs/security-audit.nosync/` is written to.

---

## Step 1 — Resolve paths and load ledger

1. Resolve project root (`${CLAUDE_PROJECT_DIR}` or cwd).
2. Set `OUTPUT_DIR = <project_root>/docs/security-audit.nosync/`.
3. Confirm `OUTPUT_DIR/ledger.json` exists. If not, tell the user to run
   `/syntic-bug-defender:scan` first and stop.
4. Read and parse `OUTPUT_DIR/ledger.json`.

Extract:
- All findings with `status != "fixed"` → **re-verify candidates**
- `last_scan_ref` from the ledger root (set in the previous rescan; may be
  absent on the first rescan run — fall back to `HEAD~1` or the initial
  commit if the repo has only one commit).
- `last_scan` timestamp.

Print:
```
Rescan starting.
  Prior scan ref: {last_scan_ref | "HEAD~1 (first rescan)"}
  Re-verify candidates: {N non-fixed findings}
  Changed files since ref: computing...
```

---

## Step 2 — Re-verify non-fixed findings

### 2a. Spawn sbd-verifier subagents

For each re-verify candidate, spawn **3 independent `sbd-verifier` Tasks
in a single parallel message**. Each verifier receives:

```
You are adversarially verifying ONE security finding to determine whether
it still exists in the CURRENT code. Read agents/sbd-verifier.md for your
full instructions. Your default assumption is that this finding is a FALSE
POSITIVE (or has been fixed). Try to disprove it.

PROJECT_ROOT: {absolute path}
TRUST_BOUNDARY: {from ledger metadata or THREAT_MODEL.md §3, or "untrusted HTTP input → application process"}
VOTE_N: {1|2|3}
VOTE_TOTAL: 3

FINDING:
  id:               {id}
  file:             {file}
  line:             {line}
  category:         {category}
  severity:         {severity}
  title:            {title}
  description:      {description}
  exploit_scenario: {exploit_scenario}
  recommendation:   {recommendation}
  original_verdict: {verdict.reason}

Work independently. Focus on whether the cited code path STILL EXISTS and
is STILL VULNERABLE. If the file no longer exists, or the vulnerable
function has been removed/refactored, return VERDICT: REFUTED with
REASON: "Code path no longer present at {file}:{line}."
```

Set `description: "re-verify {id}"` on each Task call.

If `len(candidates) * 3` exceeds 30, shard into sequential batches of 30
(each batch a single message).

### 2b. Tally votes and update status

For each finding, parse the trailing `VERDICT / CONFIDENCE / EVIDENCE / REASON`
block from each of its 3 verifier responses (same logic as the `triage`
skill Step 5).

| Outcome | New status | Action |
|---------|-----------|--------|
| ≥ 2 REFUTED (code gone or protected) | `fixed` | set `last_seen` to now |
| ≥ 2 CONFIRMED (still vulnerable) | keep existing `status` | update `last_seen`, update `evidence` |
| No majority (split) | keep existing `status` | no change |

For findings set to `fixed`:
- Set `status: "fixed"`.
- Set `last_seen` to now.
- Preserve all other fields.

For findings that remain open/confirmed:
- Update `last_seen` to now.
- Update `evidence` from the highest-confidence CONFIRMED verifier (if
  more evidence was gathered than the original).

---

## Step 3 — Compute changed files

Determine which files changed since the last scan ref:

```bash
git -C {PROJECT_ROOT} diff --name-only {last_scan_ref} HEAD
```

If `last_scan_ref` is absent or the command fails (e.g. shallow clone,
detached HEAD), fall back to:

```bash
git -C {PROJECT_ROOT} diff --name-only HEAD~1 HEAD
```

If the repository has only one commit (no `HEAD~1`), run a full discovery
instead of a diff-aware one (all source files are "changed").

Filter the changed file list: exclude `docs/security-audit.nosync/**`,
`.git/**`, `node_modules/**`, `vendor/**`, `dist/**`, `build/**`.

Print: "Changed files since {ref}: {N} files — {file1}, {file2}, ..."
(truncate list display at 10 files; show count for the rest).

If there are NO changed source files, skip Steps 4–6 and go directly to
Step 7 (re-running report with updated fix statuses is still valuable).

---

## Step 4 — Discovery on changed files only

Determine focus areas from `OUTPUT_DIR/THREAT_MODEL.md` (§3 entry points
and §4 threats) or `OUTPUT_DIR/stack.md`. Default to all standard focus
areas if neither is present.

For each focus area that intersects with the changed files, spawn one
**`sbd-discovery` Task** (same as in `vuln-scan`). Limit to 10 discovery
Tasks per rescan run.

Provide each `sbd-discovery` subagent with the **scoped file list** in its
prompt:

```
You are conducting authorized static security review of a DIFF-SCOPED subset
of source files. Read agents/sbd-discovery.md for your full instructions.

FOCUS_AREA:   {focus_area}
PROJECT_ROOT: {absolute path}
TRUST_BOUNDARY: {from THREAT_MODEL.md §3 or default}
STACK:        {from stack.md}

CHANGED_FILES (scan ONLY these files and their direct callers):
  {file1}
  {file2}
  ...

Ignore source files NOT in this list unless they are a direct caller of
a vulnerable function you find in a listed file.
```

Collate all `<finding>` blocks from all discovery Tasks.

---

## Step 5 — Deduplicate net-new findings against ledger

For each net-new `<finding>` block from Step 4:

1. **Deterministic dedupe:** if any existing ledger entry has the same
   (`file`, `category`) and `line` within 5 → it is a duplicate.
   - If the existing entry has `status: "fixed"`: the fix may be incomplete.
     Re-open it: set `status: "open"`, add a note `"re-opened by rescan —
     possible incomplete fix"`.
   - If the existing entry has any other status: skip the net-new finding
     (already tracked).

2. **Surviving net-new:** assign the next available `SBD-NNN` id. Set
   `status: "open"`. Append to the ledger findings array.

If there are no net-new findings after dedup, note it in the summary.

---

## Step 6 — Triage net-new findings

If any net-new findings were added (status `open`), triage them using the
same multi-vote adversarial verification logic as the `triage` skill (Steps
4–6 of the triage skill). Use N=3 `sbd-verifier` Tasks per net-new finding.
Update their `status`, `verdict`, `evidence`, and `confidence` in the ledger.

This avoids leaving net-new findings permanently `open` after a rescan.

---

## Step 7 — Store the scan ref in the ledger

Record the current HEAD commit hash as `last_scan_ref` in the ledger root:

```bash
git -C {PROJECT_ROOT} rev-parse HEAD
```

Update `last_scan` to the current ISO timestamp. Write the full updated
ledger back to `OUTPUT_DIR/ledger.json`.

The ledger root now carries:

```json
{
  "project": "...",
  "first_scan": "...",
  "last_scan": "{ISO now}",
  "last_scan_ref": "{full commit SHA}",
  "findings": [...]
}
```

---

## Step 8 — Call report

Invoke the `report` skill logic (read `ledger.json`, render HTML + SARIF) to
regenerate `OUTPUT_DIR/report.html` and `OUTPUT_DIR/findings.sarif` with the
updated finding statuses. Reference the `report` skill by name; do not
duplicate its logic.

---

## Step 9 — Append rescan summary to findings.md

Append to `OUTPUT_DIR/findings.md` (with `---` separator):

```markdown
## rescan — {ISO timestamp}

**Scan ref:** {last_scan_ref} → HEAD ({current_sha[:12]})  
**Changed files scanned:** {N}

### Prior findings — status update

| ID | Severity | Category | File:Line | Old status | New status |
|----|----------|----------|-----------|-----------|-----------|
| SBD-001 | high | sql-injection | src/db.js:42 | confirmed | fixed |
| SBD-003 | medium | xss | src/render.js:17 | confirmed | confirmed |
...

### Net-new findings ({N} after dedup)

| ID | Severity | Category | File:Line | Title | Post-triage |
|----|----------|----------|-----------|-------|------------|
| SBD-007 | high | command-injection | scripts/deploy.sh:31 | Shell injection in deploy | confirmed |
...

### Summary
- Fixed:    {n}
- Still open/confirmed: {n}
- Net-new added + triaged: {n}
```

---

## Step 10 — Hand back

Tell the user:

1. **Fixed:** list findings that flipped to `fixed` (id + title).
2. **Still open:** count of findings that remain open or confirmed.
3. **Net-new:** count of new findings added; list top-severity ones.
4. **Next step:**
   - If patches exist for confirmed findings: review `docs/security-audit.nosync/patches.md`.
   - `> /syntic-bug-defender:patch` to generate candidate fixes for newly confirmed findings.
   - Report available at `docs/security-audit.nosync/report.html`.

---

## Constraints

- **Read-only on all source.** No builds, no execution, no network.
- **Write only under `docs/security-audit.nosync/`.** Never modify source.
- **Never remove a ledger entry.** Only update fields. History is permanent.
- **Ref must be a reachable commit.** If `last_scan_ref` points to a commit
  not in the current history (e.g. after a rebase), warn the user and fall
  back to `HEAD~1`.
- **Reuses subagents by name:** `sbd-verifier` (Step 2), `sbd-discovery`
  (Step 4). Do not duplicate their logic inline.
