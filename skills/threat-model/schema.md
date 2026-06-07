# THREAT_MODEL.md schema

> **Re-read note:** If you need this file mid-session and the Read tool reports "file unchanged",
> the prior result was evicted from context; reload it via Bash: `ls` the path to confirm it
> exists, then Read it again with a fresh tool call.

`docs/security-audit.nosync/THREAT_MODEL.md` is written by the `threat-model` skill.
The format is markdown so humans can read and edit it, but the section headings, table columns,
and enum values below are a contract: keep them exactly as shown so downstream skills
(`vuln-scan`, `triage`, `report`) can parse them with regex.

---

## Required sections, in order

```markdown
# Threat Model: <system name>

## 1. System context

## 2. Assets

## 3. Entry points & trust boundaries

## 4. Threats

## 5. Deprioritized

## 6. Open questions

## 7. Provenance

## 8. Recommended mitigations
```

A consumer that only needs the threat table can regex for `^## 4\. Threats$` and read until the
next `^## `. Section 8 is optional and additive: older threat models may omit it, and consumers
must tolerate its absence.

---

## Section contents

### 1. System context

One to three paragraphs of prose: what the system is, what it does, who uses it, where it runs.
No table. This is the answer to "what are we working on?".

### 2. Assets

Markdown table. One row per thing worth protecting.

| asset | description | sensitivity |
|---|---|---|

`sensitivity` ∈ {`low`, `medium`, `high`, `critical`}.

### 3. Entry points & trust boundaries

Markdown table. One row per place untrusted input enters the system or privilege level changes.

| entry_point | description | trust_boundary | reachable_assets |
|---|---|---|---|

`trust_boundary` is free text naming the crossing (e.g., "untrusted file → process memory",
"unauth network → authenticated session").
`reachable_assets` is a comma-separated list of asset names from section 2.

### 4. Threats

Markdown table. **This is the threat model proper.** One row per actor-wants-outcome pair,
at the abstraction level where it survives a patch.

| id | threat | actor | surface | asset | impact | likelihood | status | controls | evidence |
|---|---|---|---|---|---|---|---|---|---|

- `id`: `T1`, `T2`, … Stable across edits; do not renumber when rows are removed.
- `threat`: One sentence, active voice, names the outcome. E.g. "Remote code execution via
  untrusted media parsing", not "buffer overflow in parser.c".
- `actor` ∈ {`remote_unauth`, `remote_auth`, `adjacent_network`, `local_user`, `local_admin`,
  `supply_chain`, `insider`}.
- `surface`: Which entry point(s) from section 3 this threat traverses.
- `asset`: Which asset(s) from section 2 this threat compromises.
- `impact` ∈ {`low`, `medium`, `high`, `critical`, `existential`}.
- `likelihood` ∈ {`very_rare`, `rare`, `possible`, `likely`, `almost_certain`}.
- `status` ∈ {`unmitigated`, `partially_mitigated`, `mitigated`, `risk_accepted`}.
- `controls`: Current mitigations, or `none`.
- `evidence`: CVE IDs, issue links, pentest finding IDs, or git commit hashes that
  **instantiate** this threat. May be empty. Evidence raises likelihood; it is not the threat.

Sort the table by (impact, likelihood) descending so the top rows are the priorities.

### 5. Deprioritized

Markdown table. Threats considered and explicitly parked.

| threat | reason |
|---|---|

Common reasons: out of scope, actor not in threat model, asset not present, risk accepted by owner.

### 6. Open questions

Bullet list. Things the skill could not determine from static analysis alone. These should be
framed as questions for a human owner or follow-up interview pass. Examples:
- Deployment context ("Is this service exposed to the public internet or only internal?")
- Intended actors ("Who supplies input files in production?")
- Controls that couldn't be verified statically ("Is there a WAF or upstream size limit?")
- Risk appetite ("Is brief unavailability acceptable for this use case?")

### 7. Provenance

```
- mode: bootstrap
- date: YYYY-MM-DD
- target: <PROJECT_ROOT> @ <git short hash or "not a git repo">
- inputs: <"git-log mined" | "git-log + provided vuln list">
- owner: unset
```

### 8. Recommended mitigations

Optional, additive. Each row is **one class-level control**, not a per-finding patch:
a mitigation that closes or materially shrinks an entire threat cluster regardless of which
instance is found next.

| mitigation | threat_ids | closes_class | effort |
|---|---|---|---|

- `mitigation`: imperative, one line. E.g. "parameterized queries everywhere",
  "sandbox the parser process", "enable CSP default-src 'self'", "drop pickle for json".
- `threat_ids`: comma-separated section 4 ids (e.g., `T1,T3`) this mitigation covers.
- `closes_class`: `yes` | `partial`.
- `effort`: `S` | `M` | `L`.

---

## Scoring guide

### Impact

| value | means |
|---|---|
| `low` | Nuisance; no data or availability loss. |
| `medium` | Limited data exposure or degraded availability for some users. |
| `high` | Significant data exposure, integrity loss, or full availability loss. |
| `critical` | Full compromise of a primary asset (RCE, auth bypass, data exfil at scale). |
| `existential` | Compromise threatens the organization's continued operation. |

### Likelihood

| value | means |
|---|---|
| `very_rare` | Requires nation-state resources or an unlikely chain of preconditions. |
| `rare` | Requires significant skill and a non-default configuration. |
| `possible` | A motivated attacker with public tooling could plausibly do this. |
| `likely` | The attack surface is reachable and the technique is well known; prior evidence exists in this or similar systems. |
| `almost_certain` | Actively exploited in the wild, or trivially automatable against the default configuration. |

Evidence (past CVEs in the same surface, pentest findings, public exploit code) moves likelihood
**up**. Existing controls move it **down**. Score the **residual** likelihood after current controls.
