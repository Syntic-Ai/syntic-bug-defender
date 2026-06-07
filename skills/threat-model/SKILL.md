---
name: threat-model
description: Build a threat model for the current repo from code + git history (language-agnostic). Writes THREAT_MODEL.md. Use before scanning or when asked to map the attack surface.
allowed-tools: [Read, Glob, Grep, Write, Bash(git:*), Bash(ls:*), Task]
---

# threat-model

A threat model answers **"what could go wrong with this system, who would do it, and what
should we do about it?"** independently of whether any specific bug has been found yet. It is
the map; vulnerability discovery is the metal detector. A good threat model tells the pipeline
where to look and tells triage which findings matter.

**Litmus test:** If patching one line of code makes an entry disappear, it was a vulnerability,
not a threat. A threat ("attacker achieves auth bypass via forged session token") still stands
after every known bug is fixed; a vulnerability ("`session.py:87` does not verify the signature")
does not. This skill produces threats. Vulnerabilities appear only as **evidence** that raises a
threat's likelihood score.

**Output:** `<PROJECT_ROOT>/docs/security-audit.nosync/THREAT_MODEL.md` — conforming to the
section schema in `schema.md` in this directory.

---

## Step 0 — Safety preamble (always runs first)

This skill performs **static analysis only**. It reads source, git history, and any supporting
files the user supplies, and writes a single output file. It does not build, execute, fuzz, or
modify the target, and does not make network requests against the target's live deployment.

Before proceeding, confirm and state:

1. The target directory exists and is a local checkout that can be read.
2. No code from the target directory will be executed.
3. Git commands are used only for history mining (`git log`, `git show`) — never for branching,
   committing, or modifying the repo.
4. The output folder `docs/security-audit.nosync/` will not be opened or re-read with
   Read/Glob after writing. Write-then-done.

If the user asks you to validate a threat by running an exploit, decline and suggest
`/syntic-bug-defender:scan` for static discovery.

---

## Step 0b — Resolve project root and output path

Determine `PROJECT_ROOT`:
- Use `${CLAUDE_PROJECT_DIR}` if set, otherwise use the current working directory.

Output file: `<PROJECT_ROOT>/docs/security-audit.nosync/THREAT_MODEL.md`

Ensure the output folder exists before writing (run `mkdir -p` if needed; the `init` skill
normally does this, but threat-model must be robust to being run first).

Read `schema.md` from this skill directory now, so the exact section headings and enum values
are in context before Stage 5. If the Read tool returns "file unchanged" (evicted), note the
path and re-read it just before emitting the file.

---

## Stage 1 — Research swarm

Goal: gather everything needed to fill sections 1-3 and the vulnerability working table, in
parallel. Spawn the agents below **in a single batch** with the Task tool so they run
concurrently. Each agent gets a narrow brief, the absolute `PROJECT_ROOT` path, and the
read-only restriction verbatim.

**Skip the swarm and run the briefs yourself sequentially** if the project has fewer than 50
source files (the parallelism overhead is not worth it for small targets).

**Read-only restriction for all subagents (include this verbatim in every Task prompt):**
> You are a read-only research agent. You may use Read, Glob, Grep, and Bash(git:*) and
> Bash(ls:*) only. Do NOT build, run, write, or modify any file. Do NOT open or read any
> path containing `.nosync`. Return only your structured text block — no tool calls that
> write files.

| Agent | Brief | Returns |
|---|---|---|
| **Docs reader** | Read `README*`, `SECURITY.md`, `CHANGELOG*`, top-level `docs/` (excluding `.nosync` paths), and the primary build manifest. Summarize what the project says it is, who uses it, and any security claims or fix entries it documents. | Prose system description; list of self-documented security notes. |
| **Surface mapper** | Grep the source tree for entry-point signatures: network route definitions (`@app.route`, `router.get`, `http.HandleFunc`, `#[get(`, etc.), file-open and parse calls, CLI/env parsers (`argparse`, `getenv`, `process.argv`), deserializers (`pickle`, `ObjectInputStream`, `yaml.load`), raw DB query construction, dynamic load (`dlopen`, `require`, `eval`, `exec`), subprocess spawn. Exclude `vendor/`, `node_modules/`, `third_party/`, generated code. Cap at ~5 representative hits per surface row. | Candidate section 3 rows: `{entry_point, description, trust_boundary, file_refs}`. |
| **Infra reader** | Read deploy-time config: `*.tf`/`*.tfvars`, Kubernetes manifests, `Dockerfile*`, CI workflow files (`.github/workflows/`, `.gitlab-ci.yml`), and any IAM/service-account files present. For each, identify (a) the identity it runs as and what that identity can reach, (b) any access grant not managed in this tree, (c) credentials or principals that could survive a teardown. | Candidate section 3 rows for infra surfaces + candidate section 4 threat rows where the config itself is the finding. |
| **Asset finder** | Identify what the code protects or produces: sensitive data it reads or writes (secrets, keys, user records, database contents), process integrity (for native code), service availability, and downstream embedder assets if it is a library or SDK. | Candidate section 2 rows: `{asset, description, sensitivity}`. |
| **History miner** | (a) Glance at the build manifest and file extensions to identify the language and domain, then derive 6-10 commit-message search keywords specific to that stack on top of the base set `CVE- security vuln fix exploit patch`. For a web service add `injection SSRF IDOR traversal xss`; for a native parser add `overflow OOB UAF integer`; for a crypto library add `timing constant-time nonce`. (b) Run: `git -C <PROJECT_ROOT> log --all -i --grep='<keywords \|-joined>' --oneline` then read the full message and diff of each hit (use `git -C <PROJECT_ROOT> show <hash>`). Also grep any `issues/` or `bugs/` export file found in the tree. | Vuln rows: `{id (commit hash), title, component, class, vector}`. |
| **Advisory fetcher** | Check if `git -C <PROJECT_ROOT> remote get-url origin` returns a GitHub URL and if `gh` is on PATH. If so, run `gh api /repos/{owner}/{repo}/security-advisories`. Otherwise return "no public advisory source available". | Vuln rows: `{id (CVE/GHSA), title, component, class, vector}`, or the no-source note. |

After all agents return, collect their outputs into working notes. Agents that were skipped
(no GitHub remote, no infra files, small target inline) get an empty result.

---

## Stage 2 — Synthesize

Goal: turn the swarm returns into sections 1-3 of the schema plus a vulnerability working table.
This stage runs in the orchestrating agent (you), not a subagent — it is the join.

**Section 1: System context.** From the Docs reader's summary plus your own glance at the tree
layout (`ls -la <PROJECT_ROOT>`), write 1-3 paragraphs: what it is, language(s), rough size
(source file count), who would embed or deploy it, where it would run.

**Section 2: Assets.** Take the Asset finder's rows. Dedupe, fill any obvious gaps (native code
without "host process integrity" → add it; web app without "user session data" → add it if
sessions exist), and assign `sensitivity`.

**Section 3: Entry points & trust boundaries.** Merge Surface mapper + Infra reader rows. Dedupe,
name the trust boundary for each ("untrusted HTTP body → application logic",
"unauth network → authenticated session", "supplied file → process memory"), and for each
list which section 2 assets are reachable. Supply-chain, build-time, and infra/IAM surfaces
**are** entry points. **Every row here must get at least one threat in Stage 3 or 4** — that
is the coverage invariant enforced at the start of Stage 5.

**Vulnerability working table.** Concatenate rows from History miner + Advisory fetcher. Dedupe
by `id`. For each row, decide which section 3 entry point it traversed. If a vuln's entry point
is not yet in section 3, the Surface mapper missed it; add it now. Hold this table in working
notes only — it does not go into `THREAT_MODEL.md` verbatim. It becomes the `evidence` column
in Stage 3.

---

## Stage 3 — Generalize: vulnerabilities → threats

Goal: cluster the Stage-2 vuln table into threat rows at the correct abstraction level.

### 3a. Cluster

Group the vuln table by `(entry point, bug class, asset reached)`. Each cluster becomes
**one** candidate threat. Examples:

- 2 SQL injections in different endpoints → **one** threat: "Data exfiltration / tampering via
  SQL injection in the HTTP API". Evidence: both commit hashes / CVE IDs.
- 3 memory-corruption findings in a parser, all reaching process memory → **one** threat:
  "Remote code execution via memory corruption in the file parser". Evidence: all 3 IDs.

Apply the litmus test to each cluster's threat statement: would it still be true after every
listed evidence item is patched? If not, you are still at vulnerability level — zoom out.

### 3b. Variant scan

For each cluster, search for **siblings**: code paths with the same shape not already in the
vuln list. Grep for the same pattern (other endpoints calling the same unsafe helper, other
size fields multiplied without overflow checks, other query-construction sites). You are not
trying to prove these are exploitable; you are estimating how much of the surface shares the
pattern. More siblings → higher likelihood score. Keep sibling file locations in working notes;
do NOT put `file:line` references in the section 4 `evidence` cell.

### 3c. Score

For each cluster, assign:

- `actor`: from the entry point (file parsing by an unauthenticated uploader → `remote_unauth`;
  API endpoint behind login → `remote_auth`; insider admin → `local_admin`; etc.).
- `impact`: from the asset and bug class (auth bypass on a user-data store → `critical`; info
  leak of non-sensitive metadata → `low`).
- `likelihood`: start from the evidence. One or more confirmed past vulns in the exact surface
  → at least `likely`. Public exploit or active exploitation → `almost_certain`. No evidence
  but siblings found and the technique is well-known → `possible`. Adjust down for controls.
- `controls`: grep for mitigations relevant to the stack — parameterized queries / ORM,
  auth middleware / CSRF tokens / CSP, input validation / size caps, sandboxing, rate limits,
  constant-time comparison, SecurityManager replacements, etc. Write `none` if none found.
- `status`: `unmitigated` unless a control fully closes the threat.
- `recommended_mitigation` (working notes only — becomes section 8 in Stage 5): name
  **one class-level control** that would close or materially shrink the whole threat cluster
  regardless of which instance is found next (e.g., "parameterized queries everywhere",
  "sandbox the parser process", "drop pickle for json", "enable CSP default-src 'self'").
  Prefer a control that survives the next bug over a patch for the last one.

Write each cluster as a section 4 row.

---

## Stage 4 — STRIDE gap-fill

Past vulnerabilities are biased toward what has already been found. A threat model must also
cover what has not been found yet. For **every section 3 entry point that has no section 4 row
yet**, walk STRIDE and add at least the plausible ones:

| | For this entry point, could an attacker… |
|---|---|
| Spoofing | …pretend to be a trusted source (forged identity, spoofed origin)? |
| Tampering | …modify data in transit or at rest (MITM, DB write without authz)? |
| Repudiation | …act without leaving attributable logs (no audit trail, log injection)? |
| Info disclosure | …read data they should not (IDOR, mass assignment, overly verbose errors)? |
| DoS | …exhaust a resource (CPU, memory, disk, DB connections, algorithmic complexity)? |
| Elevation | …end up with more privilege than they started with (priv-esc, SSRF to internal)? |

Also walk entry points that **do** have rows: is the existing row the only plausible threat,
or are other STRIDE categories also live? (A file parser with an RCE threat probably also has
a DoS threat.)

**For infra/IAM entry points**, walk these instead of STRIDE:
- **Over-grant**: does the identity reach more than the application needs?
- **Lateral identity**: can a co-located workload assume this identity?
- **Drift**: is any grant managed outside this tree (click-ops IAM, ad-hoc ACL)?
- **Residual access**: do credentials from a predecessor system survive migration?
- **Scope enforcement**: where an automated write or approval path exists, what bounds it?

Threats added in this stage have empty `evidence`. That is expected; score `likelihood` from
technique prevalence and surface reachability alone. **The final section 4 table must contain
at least one row with empty evidence**, or this stage was skipped.

Populate `## 5. Deprioritized` with STRIDE categories you considered and ruled out, with the
reason (e.g., "Repudiation: no multi-user actions in scope").

---

## Stage 5 — Emit

**Coverage check (do this before writing the file).** For every section 3 entry point, confirm
at least one section 4 row names it in the `surface` column. Match on the entry-point name
string. Any section 3 row with zero section 4 coverage means Stage 4 was incomplete; go back
and add the missing threat now.

Sort section 4 by (impact desc, likelihood desc). Assign `id` = `T1`, `T2`, … in sorted order.

Populate `## 6. Open questions` with everything the code could not tell you:
- Deployment context ("Is this service exposed to the public internet or only internal?")
- Intended actors ("Who supplies input files in production?")
- Controls you could not verify statically ("Is there a WAF or upstream size limit?")
- Risk appetite ("Is brief unavailability acceptable for this use case?")

Populate `## 8. Recommended mitigations` from the Stage-3c working notes: one row per
class-level `mitigation`, listing `threat_ids` it covers, `closes_class`, and `effort`.
If two clusters are closed by the same control, emit one row listing both IDs. Gap-fill
threats from Stage 4 get rows here too where an obvious class-level control exists.

**Re-read `schema.md`** immediately before writing the file (to guard against context eviction).
Read `<SKILL_DIR>/schema.md` or — if Read reports "file unchanged" — use Bash:
`ls <SKILL_DIR>/schema.md` to confirm the path, then read it via a fresh Read call.

Write `<PROJECT_ROOT>/docs/security-audit.nosync/THREAT_MODEL.md` in a single Write tool call,
assembling all eight sections in order. The content must conform exactly to the section headings,
table columns, and enum values in `schema.md`.

Set `## 7. Provenance`:

```
- mode: bootstrap
- date: <today's date>
- target: <PROJECT_ROOT> @ <git -C <PROJECT_ROOT> rev-parse --short HEAD, or "not a git repo">
- inputs: git-log mined
- owner: unset
```

**Do NOT re-read the output file after writing it.** Do NOT open `docs/security-audit.nosync/`
with any tool.

---

## Stage 6 — Hand back to the user

After the file is written, print to the user:

1. Path to `THREAT_MODEL.md`.
2. Top 5 threats by (impact × likelihood), shown as: `Tid — threat statement — impact/likelihood`.
3. Count of threats with evidence vs without (shows gap-fill ran and both paths worked).
4. The Stage-3b sibling locations as candidate leads for `/syntic-bug-defender:vuln-scan`.
5. Top 3 recommended mitigations from section 8 (by closes_class yes-first, then effort asc).
6. Section 6 open questions, framed as "ask the owner to clarify".

---

## Constraints

- **Static analysis only.** Never execute code from the target directory; never make network
  requests to the target's live deployment.
- **Read-only for all subagents.** Pass the read-only restriction verbatim in every Task prompt.
  Subagents must not write files, call Write, or open `.nosync` paths.
- **Do not open `.nosync` paths** with Read, Glob, or Grep after writing. The output file is
  write-once in this skill run.
- **Language-agnostic.** Apply the same stages regardless of whether the project is TypeScript,
  Python, Go, Rust, Java, Ruby, PHP, C/C++, or a polyglot mix. Do not hard-code stack-specific
  heuristics — derive them from what the manifests and source extensions actually show.
- **Stay in `PROJECT_ROOT`.** Do not follow symlinks or `..` outside it.
- **Threats, not vulnerabilities.** A threat survives any individual patch. If a section 4
  statement would disappear after one code fix, zoom out before emitting it.
