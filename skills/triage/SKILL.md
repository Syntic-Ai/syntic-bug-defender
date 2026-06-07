---
name: triage
description: Verify, dedupe and rank findings in the ledger. Multi-vote adversarial verification per finding, dedupe vs prior rounds, re-rank by derived exploitability. Updates ledger.json + findings.md.
allowed-tools: [Read, Glob, Grep, Write, Task, Bash(jq:*), Bash(git log:*)]
---

# /triage

Adversarial triage of findings in `docs/security-audit.nosync/ledger.json`.

For each `open` finding, spawns N=3 independent `sbd-verifier` subagents that
each start from the assumption the finding is a **FALSE POSITIVE** and try to
disprove it. A majority vote determines the outcome. Deduplication runs before
verification to avoid burning verifier budget on duplicates. Findings are
re-ranked by derived exploitability (severity × confidence) after triage.

**This skill is read-only with respect to the target source.** Only
`docs/security-audit.nosync/` is written to.

---

## Ledger JSON schema

The canonical schema for `docs/security-audit.nosync/ledger.json`:

```json
{
  "project": "string — basename of the project root",
  "first_scan": "ISO 8601 datetime — timestamp of the very first scan",
  "last_scan": "ISO 8601 datetime — timestamp of the most recent scan or triage run",
  "findings": [
    {
      "id": "SBD-001",
      "title": "string — one-line description of the vulnerability",
      "file": "string — path relative to project root",
      "line": 0,
      "category": "string — e.g. sql-injection, xss, command-injection, auth-bypass, hardcoded-secret, weak-crypto, path-traversal, deserialization, memory-corruption, ...",
      "severity": "critical | high | medium | low | info",
      "confidence": 0.0,
      "status": "open | confirmed | fixed | false_positive",
      "verdict": {
        "real": true,
        "votes": "2/3",
        "reason": "string — one-sentence explanation of the majority vote outcome"
      },
      "evidence": "string — exact quoted lines from source code supporting the verdict",
      "exploit_scenario": "string — concrete attack path",
      "recommendation": "string — specific fix guidance",
      "first_seen": "ISO 8601 datetime",
      "last_seen": "ISO 8601 datetime"
    }
  ]
}
```

**Field invariants:**
- `id` — stable, never reassigned. Format: `SBD-` + zero-padded integer
  (`SBD-001`, `SBD-002`, ...).
- `severity` — enum: `critical | high | medium | low | info`.
- `status` — enum: `open | confirmed | fixed | false_positive`.
  - `open` — discovered by vuln-scan, not yet triaged.
  - `confirmed` — majority-voted CONFIRMED by verifiers.
  - `false_positive` — majority-voted REFUTED by verifiers.
  - `fixed` — was confirmed; subsequent rescan shows the cited sink is gone.
- `verdict.real` — `true` if status is `confirmed`, `false` otherwise.
- `verdict.votes` — string `"{confirmed}/{total}"` (e.g. `"2/3"`).
- `confidence` — float 0.0–1.0, normalized from verifier CONFIDENCE scores
  (mean of votes on the winning side, divided by 10).
- `evidence` — populated by triage from verifier EVIDENCE fields.

---

## Step 1 — Resolve paths

1. Resolve project root (`${CLAUDE_PROJECT_DIR}` or cwd).
2. Set `OUTPUT_DIR = <project_root>/docs/security-audit.nosync/`.
3. Confirm `OUTPUT_DIR/ledger.json` exists. If not, tell the user to run
   `/syntic-bug-defender:vuln-scan` first and stop.

---

## Step 2 — Load and inspect the ledger

Read `OUTPUT_DIR/ledger.json`. Parse the `findings` array.

Identify the **triage candidates**: all findings with `status == "open"`.

If there are no `open` findings, tell the user (all findings are already
triaged or the ledger is empty) and stop.

Tell the user: "Triaging N open findings across K distinct categories."

---

## Step 3 — Deduplicate before verification

Collapse repeats to avoid burning N verifiers per duplicate.

### 3a. Deterministic pass (no subagent)

Cluster findings where ALL of:
- same `file` (case-insensitive, after stripping leading `./`), AND
- same `category` (lowercase, punctuation stripped), AND
- `line` values within 5 of each other.

Within each cluster: keep the finding with the lowest `SBD-NNN` id as
canonical. Mark the others `status: "false_positive"`, set
`verdict.reason: "duplicate of {canonical_id}"`. Remove duplicates from the
triage candidate list.

### 3b. Semantic pass (one subagent, only if >3 candidates survive)

Spawn ONE Task with the following prompt to check for semantic duplicates
(same root cause, different descriptions):

```
You are deduplicating security findings before expensive verification.
Two findings are DUPLICATES if fixing one would also fix the other.
Two findings are DISTINCT if they have independent root causes, even if they
share a category or file.

DUPLICATE examples: same root cause different wording; shared vulnerable
helper reported once per call site; same missing protection on each endpoint.

DISTINCT examples: different categories in the same file; same category but
different tainted variables reaching different sinks; two independent bugs
in the same helper.

Below are the candidate findings (one per line: id | file:line | category | title).
Group them. Respond with ONLY lines of the form:

  GROUP: <canonical_id> <- <dup_id>, <dup_id>, ...

One line per group that has duplicates. Omit singletons. Pick the most
specific / best-described finding as canonical. No prose.

CANDIDATES:
{one line per open finding: "SBD-003 | src/auth.py:112 | sql_injection | User lookup concatenates input into query"}
```

Parse `GROUP:` lines. Mark semantic duplicates with `status: "false_positive"`,
`verdict.reason: "semantic duplicate of {canonical_id}"`. Remove them from
the triage candidate list.

---

## Step 4 — Spawn verifiers (N=3 per finding)

For each surviving triage candidate, spawn **3 independent `sbd-verifier`
Tasks in a single parallel message**. Each verifier receives:

```
You are adversarially verifying ONE security finding. Read agents/sbd-verifier.md
for your full instructions. Your default assumption is that this finding is a
FALSE POSITIVE. Try to disprove it by reading the code.

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

Work independently. Do not seek the other verifiers' reasoning.
```

If `len(candidates) * 3` exceeds 30, shard into sequential batches of 30,
but keep each batch a single message.

---

## Step 5 — Tally votes per finding

For each finding, parse the trailing `VERDICT / CONFIDENCE / EVIDENCE / REASON`
block from each of its 3 verifier responses. Tolerate code fences and whitespace.

If a verifier errored or produced no parseable VERDICT block, re-spawn it
once. If the retry also fails, count that vote as `UNCERTAIN` with
`CONFIDENCE: 0`.

Build:
- `confirmed_votes` — count of `VERDICT: CONFIRMED`
- `refuted_votes` — count of `VERDICT: REFUTED`
- `uncertain_votes` — count of `VERDICT: UNCERTAIN`
- `winning_side` — whichever of confirmed/refuted has the majority (≥ 2 of 3);
  if no majority, treat as UNCERTAIN.

**Majority rule → status:**

| Outcome | `status` | `verdict.real` |
|---------|----------|----------------|
| ≥2 CONFIRMED | `confirmed` | `true` |
| ≥2 REFUTED | `false_positive` | `false` |
| No majority (split or ≥2 UNCERTAIN) | `false_positive` | `false` (precision default) |

**Aggregate fields from verifier output:**
- `verdict.votes` — `"{confirmed_votes}/3"`
- `verdict.reason` — REASON from the highest-CONFIDENCE verifier on the
  winning side (verbatim, one sentence if longer).
- `evidence` — EVIDENCE from the highest-CONFIDENCE verifier on the winning side.
- `confidence` — mean CONFIDENCE (normalized to 0.0–1.0) across votes that
  agree with the winning side.

---

## Step 6 — Dedupe against existing ledger entries

Before writing, check newly-confirmed findings against all pre-existing
`confirmed` or `false_positive` entries in the ledger (from prior triage
rounds). A finding is a **cross-round duplicate** if it shares the same
(`file`, `category`) and `line` within 5 of an existing non-`open` entry.

If a cross-round duplicate is found: set the new entry's `status` to match
the existing entry's status (do not re-open a previously resolved finding);
set `verdict.reason: "deduplicated against {existing_id}"`.

---

## Step 7 — Re-rank by severity × confidence

Compute a sort key for all `confirmed` findings:

```
rank_score = severity_weight * confidence
```

Where `severity_weight`: `critical=5`, `high=4`, `medium=3`, `low=2`,
`info=1`.

Sort `confirmed` findings by `rank_score` descending, then by `id` ascending
(stable). This order determines how they appear in the updated `findings.md`
report section.

---

## Step 8 — Write back

### 8a. Update `ledger.json`

Merge all verdict results into the full ledger findings array. For each
triaged finding, update:
- `status` (as determined in §5)
- `verdict` (real, votes, reason)
- `evidence`
- `confidence`
- `last_seen` — this run's ISO timestamp

Update `last_scan` in the ledger root. Preserve all other existing fields
unchanged. Write the complete updated ledger back to `OUTPUT_DIR/ledger.json`.

### 8b. Append triage summary to `findings.md`

Append to `OUTPUT_DIR/findings.md` (with `---` separator):

```markdown
## triage run — {ISO timestamp}

{N_open} findings triaged → {confirmed} confirmed, {false_positive} false positives, {dup} duplicates.

### Confirmed findings (ranked by exploitability)

| ID | Sev | Confidence | Category | File:Line | Title |
|----|-----|-----------|----------|-----------|-------|
| SBD-001 | high | 0.87 | sql-injection | src/db.js:42 | Raw query from user input |
...

### Rejected findings

| ID | Category | File:Line | Reason |
|----|----------|-----------|--------|
| SBD-005 | xss | src/template.js:18 | REFUTED: framework auto-escapes output |
...
```

---

## Step 9 — Hand back

Tell the user:

1. **Summary:** "N findings triaged → C confirmed, F false positives, D duplicates."
2. **Top confirmed findings** (by rank_score), up to 5, one line each:
   `SBD-NNN [severity] category — file:line — title (confidence: 0.NN)`
3. **Next step:**
   `> /syntic-bug-defender:report` to render the HTML report from the ledger.
   `> /syntic-bug-defender:patch` to generate candidate fixes for confirmed findings.

---

## Constraints

- **Read-only with respect to target source.** No builds, no execution,
  no network. Every conclusion comes from reading source.
- **Write only under `docs/security-audit.nosync/`.** Never modify source files.
- **Do not open `.nosync` paths inside source** — only the designated output folder.
- **Do not drop findings silently.** Every finding that enters triage must
  appear in the ledger output with its status set.
- **Preserve ledger history.** Never remove an existing ledger entry; only
  update its fields.
