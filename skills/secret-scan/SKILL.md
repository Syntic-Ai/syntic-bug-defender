---
name: secret-scan
description: Scan the repo and git history for committed secrets, key material, and .env/.nosync hygiene issues. Adds high-priority findings to the ledger.
allowed-tools: [Read, Glob, Grep, Write, Bash(git:*), Bash(rg:*), Bash(ls:*)]
---

# /syntic-bug-defender:secret-scan

Scans the working tree and full git history for committed secrets, key material,
and file-hygiene problems. Findings are appended to the ledger at `high` or
`critical` severity.

**Read-only with respect to all source files.** This skill NEVER modifies
the target repository. It NEVER echoes secret VALUES into any artifact:
only the location (file path, line number, commit hash) and type of secret
are recorded. This is a hard constraint.

---

## Hard constraints

- **No secret values in output.** Record file path + line + pattern type only.
  Do NOT write the actual key, token, mnemonic, or password into
  `findings.md`, `ledger.json`, or any other artifact. A finding entry
  like `"evidence": "-----BEGIN RSA PRIVATE KEY----- (value redacted)"` is
  correct. A finding entry containing the full PEM block is NOT.
- **Read-only.** No builds, no execution, no file modification, no network.
- **Write only under `docs/security-audit.nosync/`.** Never touch source.
- **Do not open `.nosync` paths in source** — only the designated output folder.

---

## Step 1 — Resolve paths

1. Resolve project root (`${CLAUDE_PROJECT_DIR}` or cwd).
2. Set `OUTPUT_DIR = <project_root>/docs/security-audit.nosync/`.
3. Confirm `OUTPUT_DIR` exists. If not, tell the user to run
   `/syntic-bug-defender:init` first and stop.
4. Set `OUTPUT_DIR/ledger.json` as the ledger path. Read it if it exists;
   initialize an empty ledger structure if it does not (do not run vuln-scan;
   secret-scan can run independently).

Print: "Scanning {project_root} for committed secrets and hygiene issues."

---

## Step 2 — Working tree scan (current files)

Run the following grep passes against the working tree, **excluding**
`docs/security-audit.nosync/`, `.git/`, `node_modules/`, `vendor/`,
`target/`, `dist/`, `build/`:

For each pattern, record: matched file path (relative to project root),
line number, pattern class. **Do not record the matched value itself.**

### Pattern classes

#### 2a. PEM / Private key material
```
rg -rn "-----BEGIN (RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY" {PROJECT_ROOT} \
  --glob '!docs/security-audit.nosync/**' \
  --glob '!.git/**' \
  --glob '!node_modules/**' \
  --glob '!vendor/**'
```
Record type: `private-key-pem`. Severity: `critical`.

#### 2b. JWT tokens (base64url header eyJ)
```
rg -rn "eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\." {PROJECT_ROOT} \
  --glob '!docs/security-audit.nosync/**' \
  --glob '!.git/**' --glob '!node_modules/**'
```
Record type: `jwt-token`. Severity: `high`.
Exclude files under `test/`, `spec/`, `__tests__/`, `fixtures/` only if the
match is clearly a dummy token (e.g. `eyJhbGciOiJub25lIn0.` or
`eyJ0eXAiOiJKV1QiLCJhbGciOiJub25lIn0`). Flag ambiguous cases.

#### 2c. Stripe live/test keys
```
rg -rn "sk_(live|test)_[A-Za-z0-9]{24,}" {PROJECT_ROOT} \
  --glob '!docs/security-audit.nosync/**' --glob '!.git/**' --glob '!node_modules/**'
```
Record type: `stripe-secret-key`. Severity: `critical` for `sk_live`, `high` for `sk_test`.

#### 2d. AWS IAM access keys
```
rg -rn "AKIA[0-9A-Z]{16}" {PROJECT_ROOT} \
  --glob '!docs/security-audit.nosync/**' --glob '!.git/**' --glob '!node_modules/**'
```
Record type: `aws-access-key-id`. Severity: `critical`.
Note: also check for `ASIA` (session tokens) and `AROA` (role IDs):
```
rg -rn "(ASIA|AROA)[0-9A-Z]{16}" {PROJECT_ROOT} \
  --glob '!docs/security-audit.nosync/**' --glob '!.git/**' --glob '!node_modules/**'
```
Record type: `aws-iam-key`. Severity: `high`.

#### 2e. HD wallet mnemonics and HD_WALLET patterns
```
rg -rn "HD_WALLET|MNEMONIC|mnemonic" {PROJECT_ROOT} \
  --glob '!docs/security-audit.nosync/**' --glob '!.git/**' --glob '!node_modules/**'
```
Record type: `hd-wallet-mnemonic-ref`. Severity: `critical` if in a `.env`
or config file; `high` if in source.

Also scan for 12-or-24-word BIP-39 patterns (a sequence of 12 or more common
English words separated by spaces on a single line, inside a string literal or
env value):
```
rg -rn '"([a-z]+ ){11,}[a-z]+"' {PROJECT_ROOT} \
  --glob '!docs/security-audit.nosync/**' --glob '!.git/**' --glob '!node_modules/**'
```
Only flag if the line context (variable name or adjacent comment) suggests a
mnemonic (words like "seed", "mnemonic", "phrase", "wallet", "recovery").

#### 2f. Generic high-entropy assignments
Flag variable assignments where the right-hand side looks like a high-entropy
secret (long opaque string assigned to a variable with a security-suggestive name):
```
rg -rn "(SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|AUTH_TOKEN|ACCESS_TOKEN|CLIENT_SECRET)\s*[=:]\s*['\"]?[A-Za-z0-9+/=_\-]{20,}['\"]?" \
  {PROJECT_ROOT} \
  --glob '!docs/security-audit.nosync/**' --glob '!.git/**' --glob '!node_modules/**' \
  --glob '!*.md' --glob '!*.txt' --glob '!*.rst' --glob '!*.html'
```
Record type: `high-entropy-assignment`. Severity: `high`.
Skip matches whose value is a template placeholder (e.g. `your_key_here`,
`CHANGE_ME`, `<YOUR_`, `TODO`, all caps with underscores only, or fewer than
20 non-placeholder characters).

#### 2g. Committed `.env` files
```
rg --files {PROJECT_ROOT} --glob '**/.env' --glob '**/.env.*' \
  --glob '!docs/security-audit.nosync/**' --glob '!.git/**' --glob '!node_modules/**'
```
For each `.env` file found:
- If it is tracked by git (`git ls-files --error-unmatch <path>` exits 0),
  flag it as `committed-env-file`. Severity: `high`.
- If it is untracked, note it in the summary but do not create a ledger
  finding (untracked files are not a committed-secret issue; the user may
  be relying on `.gitignore`).

#### 2h. Secrets outside `.nosync` directories
Any file containing secrets (found in 2a–2f above) that is NOT under a
`.nosync/` directory and NOT listed in `.gitignore` is additionally flagged
with the tag `not-gitignored`. Severity bump: add one tier.

---

## Step 3 — Git history scan

Scan commits for secrets that may have been removed from the working tree
but still exist in history:

```bash
git -C {PROJECT_ROOT} log -p --all --no-merges \
  --diff-filter=A \
  --format="%H %s" \
  -- "*.env" "*.pem" "*.key" "*.p12" "*.pfx" "*.jks" "*.keystore"
```

This surfaces commits that ADDED files with those extensions.
Record: commit hash (first 12 chars only), file path, type. Severity: `high`.
Do NOT record the file contents.

Also run pattern grep on git history for the highest-risk patterns
(private keys, AWS AKIA, Stripe sk_live) — limit to avoid token exhaustion:

```bash
git -C {PROJECT_ROOT} log -p --all --no-merges -S "AKIA[0-9A-Z]{16}" \
  --format="%H %s" -- | head -200
```

```bash
git -C {PROJECT_ROOT} log -p --all --no-merges -S "-----BEGIN.*PRIVATE KEY" \
  --format="%H %s" -- | head -200
```

```bash
git -C {PROJECT_ROOT} log -p --all --no-merges -S "sk_live_" \
  --format="%H %s" -- | head -200
```

For each hit: record commit hash (12 chars), file path, pattern class.
**Do NOT record the matched line content.**

---

## Step 4 — File-hygiene checks

### 4a. `.nosync` directory check

List all files in `docs/security-audit.nosync/` (or any `.nosync` dir in
the project). Verify that this directory is in `.gitignore`. If not, flag:
type `nosync-not-gitignored`, severity: `medium`.

### 4b. `.env.*` files tracked by git

```bash
git -C {PROJECT_ROOT} ls-files | grep -E "^\.env|/\.env"
```

For each result: flag type `committed-env-file`, severity: `high`.

### 4c. Secret files tracked by git

```bash
git -C {PROJECT_ROOT} ls-files | grep -E "\.(pem|key|p12|pfx|jks|keystore|crt|cer|der)$"
```

For each result: flag type `committed-key-file`, severity: `critical`.

---

## Step 5 — Assemble findings

Deduplicate hits by (file, line, type) — the same position appearing in both
the working tree scan and the git history scan should be one finding, not two.

For each unique hit, create a finding record in the ledger schema:

```json
{
  "id": "SBD-NNN",
  "title": "{type} in {relative/file/path}",
  "file": "{relative file path}",
  "line": {line_number | 0 for git-history-only hits},
  "category": "committed-secret",
  "severity": "{critical | high | medium}",
  "confidence": 0.9,
  "status": "open",
  "verdict": {"real": null, "votes": "0/0", "reason": ""},
  "evidence": "{type} pattern matched at {file}:{line} (commit {hash if git-history}) — VALUE REDACTED",
  "exploit_scenario": "An attacker with repository read access (current or historical via git clone) can obtain the {type} and use it to authenticate to the associated service.",
  "recommendation": "{type-specific recommendation — see below}",
  "first_seen": "{ISO timestamp}",
  "last_seen": "{ISO timestamp}"
}
```

### Recommendations by type

| Type | Recommendation |
|------|---------------|
| `private-key-pem` | Immediately rotate the key. Remove from ALL git history using `git filter-repo --path <file> --invert-paths`. Add the file to `.gitignore`. |
| `jwt-token` | Rotate the signing secret or invalidate the token. Remove from history if a long-lived admin token. |
| `stripe-secret-key` | Immediately revoke in the Stripe dashboard. Rotate. Add to `.gitignore`. Remove from history. |
| `aws-access-key-id` | Immediately deactivate in IAM. Rotate. Add to `.gitignore`. Remove from history. |
| `hd-wallet-mnemonic-ref` | Treat as fully compromised — all derived keys must be considered exposed. Move funds immediately. Never commit mnemonics. |
| `high-entropy-assignment` | Move to an environment variable or secrets manager (Vault, AWS Secrets Manager, Doppler). Remove from history. |
| `committed-env-file` | Add `.env` to `.gitignore`. Remove from history with `git filter-repo`. Use `.env.example` with placeholder values only. |
| `committed-key-file` | Remove from history. Add extension to `.gitignore`. |
| `nosync-not-gitignored` | Add `docs/security-audit.nosync/` to `.gitignore`. |
| `not-gitignored` | Add the file or pattern to `.gitignore`. Consider adding to `.nosync` directories. |

---

## Step 6 — Write findings to the ledger

Read `OUTPUT_DIR/ledger.json` (or initialize if absent):

```json
{
  "project": "{basename of project root}",
  "first_scan": "{ISO — preserve if already set}",
  "last_scan": "{ISO — now}",
  "findings": []
}
```

Assign stable IDs: continue from the highest existing `SBD-NNN` in the
ledger, incrementing for each new finding. Never reuse an ID.

**Deduplicate against existing ledger entries** before writing: if a finding
with the same (file, category, line ± 5) already exists, update its
`last_seen` timestamp only — do not create a duplicate entry.

Write the updated ledger back to `OUTPUT_DIR/ledger.json`.

---

## Step 7 — Append to findings.md

Append to `OUTPUT_DIR/findings.md` (with `---` separator):

```markdown
## secret-scan — {ISO timestamp}

{N} secret or hygiene issues found.

### Committed secrets (CRITICAL / HIGH)

| ID | Severity | Type | File | Line | Commit |
|----|----------|------|------|------|--------|
| SBD-NNN | critical | private-key-pem | path/to/file | 12 | — |
| SBD-NNN | high | committed-env-file | .env | — | a1b2c3d4 |
...

### Hygiene issues (MEDIUM)

| ID | Severity | Type | File | Note |
|----|----------|------|------|------|
...

> **Note:** Secret VALUES are not recorded — only location and type.
> Rotate any flagged credentials immediately.
```

---

## Step 8 — Hand back

Tell the user:

1. **Summary:** "N secret/hygiene findings: C critical, H high, M medium."
2. **Immediate action required** if any `critical` findings: list the type
   and file (no values) and urge rotation before anything else.
3. **Next step:**
   - `> /syntic-bug-defender:triage` to verify the findings adversarially.
   - `> /syntic-bug-defender:report` to regenerate the HTML report.
   - Rotate any compromised credentials immediately — scanning does not stop exposure.

---

## Exclusions — do NOT flag

- Secret-looking strings in test fixtures, mocks, or example files when the
  value is an obvious placeholder (`your_key_here`, `EXAMPLE`, `CHANGE_ME`,
  `<YOUR_KEY>`, all-uppercase-underscores-only, fewer than 20 characters).
- Environment variable NAME references without a value (e.g. `process.env.API_KEY`
  or `os.getenv("SECRET")` with no assignment of an actual secret value).
- Strings in binary or compiled output files (`.wasm`, `.pyc`, `.class`,
  `.so`, `.dll`, `.exe`).
- `.nosync` paths other than the designated output folder (they are by
  definition excluded from sync/git already — still check if git-tracked).
- Documentation or changelog references to rotating/removing a key (these
  reference the event, not the secret itself).
