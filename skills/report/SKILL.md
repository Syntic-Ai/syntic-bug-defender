---
name: report
description: Render the security report from the ledger — a self-contained house-style HTML with a left sidebar, plus SARIF. Reads ledger.json; writes report.html + findings.sarif.
allowed-tools: [Read, Glob, Write, Bash(ls:*)]
---

# /report

Render a portable, single-file HTML security report and a SARIF 2.1.0 machine-readable
file from the findings ledger. Both are written to `docs/security-audit.nosync/`.

**This skill is read-only with respect to target source.** It only reads
`docs/security-audit.nosync/ledger.json` and the plugin's own template/asset files.

---

## Step 1 — Resolve paths

1. Resolve project root: use `${CLAUDE_PROJECT_DIR}` if set; otherwise use cwd.
2. Set `OUTPUT_DIR = <project_root>/docs/security-audit.nosync/`.
3. Confirm `OUTPUT_DIR/ledger.json` exists. If not, tell the user to run
   `/syntic-bug-defender:vuln-scan` (and optionally `/syntic-bug-defender:triage`)
   first, then stop.
4. Set `PLUGIN_ROOT = ${CLAUDE_PLUGIN_ROOT}` (the installed root of this plugin).

---

## Step 2 — Read inputs

### 2a. Load the ledger

Read `OUTPUT_DIR/ledger.json` and parse it. You will use:
- `ledger.project` — project name (string).
- `ledger.last_scan` — ISO date of the last scan, formatted as `YYYY-MM-DD` for display.
- `ledger.findings` — array of finding objects.

Partition findings into two lists:
- **Open / active findings:** `status` is `open` or `confirmed`.
- **Fixed / resolved findings:** `status` is `fixed` or `false_positive`.

Sort open findings by severity weight descending, then by `id` ascending.
Severity weights: `critical=5`, `high=4`, `medium=3`, `low=2`, `info=1`.

### 2b. Load the HTML skeleton

Read `PLUGIN_ROOT/templates/report-skeleton.html` in full.

### 2c. Load and inline the CSS

Read `PLUGIN_ROOT/assets/report.css` in full.

Replace the literal token `/* {{INLINE assets/report.css HERE}} */` inside the
skeleton's `<style>` block with the full CSS text. The result must contain no
external stylesheet references — the file must be self-contained.

---

## Step 3 — Build template variables

Use the following severity → color mapping (must match `assets/report.css`):

| Severity | Color hex |
|----------|-----------|
| critical | `#ff3366` |
| high     | `#b8860b` |
| medium   | `#ca8a04` |
| low      | `#1a7a3a` |
| info     | `#0891b2` |

### 3a. `{{PROJECT}}`

`ledger.project` (the project name string).

Replace both occurrences of `{{PROJECT}}` in the skeleton (title element and sidebar).

### 3b. `{{DATE}}`

`ledger.last_scan` formatted as `YYYY-MM-DD`.

Replace both occurrences of `{{DATE}}` in the skeleton (sidebar and footer).

### 3c. Counts

Compute:
- `total` — total findings in the ledger (all statuses).
- `confirmed_count` — findings with `status == "confirmed"`.
- `open_count` — findings with `status == "open"`.
- `fixed_count` — findings with `status == "fixed"`.
- `fp_count` — findings with `status == "false_positive"`.
- Counts by severity (critical, high, medium, low, info) across **open + confirmed** findings only.

### 3d. `{{COVER}}`

Build the cover page and executive summary as an HTML fragment. Replace the
`{{COVER}}` token in the skeleton with this fragment:

```html
<div class="cover-page">
  <div class="cover-logo">Syntic<span></span></div>
  <div class="cover-subtitle">Bug Defender</div>
  <div class="cover-title">{project} — Security Audit</div>
  <div class="cover-date">{YYYY-MM-DD}</div>
  <div class="cover-confidential">Confidential</div>
  <div class="cover-version">Total findings: {total} &nbsp;|&nbsp; Confirmed: {confirmed_count} &nbsp;|&nbsp; Fixed: {fixed_count}</div>
</div>

<h1 id="exec">Executive Summary</h1>
<div class="exec-summary">
  <div class="es-label">Scan date</div>
  <p>{YYYY-MM-DD}</p>
  <div class="es-label">Findings</div>
  <p>{confirmed_count} confirmed active findings across {severity breakdown sentence}.
  {fixed_count} findings have been fixed or verified as false positives.
  {open_count} findings remain in open/unverified state.</p>
  <div class="es-label">Risk posture</div>
  <p>Derived from the confirmed finding counts:
  critical={critical_count}, high={high_count}, medium={medium_count},
  low={low_count}, info={info_count}.</p>
</div>

<h2 id="overview">Severity Overview</h2>
<div class="metrics-grid">
  <div class="metric-card">
    <div class="label">Critical</div>
    <div class="value pink">{critical_count}</div>
    <div class="desc">Immediate risk</div>
  </div>
  <div class="metric-card">
    <div class="label">High</div>
    <div class="value" style="color:#b8860b">{high_count}</div>
    <div class="desc">Serious risk</div>
  </div>
  <div class="metric-card">
    <div class="label">Medium</div>
    <div class="value" style="color:#ca8a04">{medium_count}</div>
    <div class="desc">Moderate risk</div>
  </div>
  <div class="metric-card">
    <div class="label">Low</div>
    <div class="value green">{low_count}</div>
    <div class="desc">Minor risk</div>
  </div>
</div>
```

Fill in actual counts. If a severity bucket is zero, still render its card
with a `0` value.

### 3e. `{{SEVERITY_FILTER_BUTTONS}}`

For each severity level that has **at least one open/confirmed finding**,
emit one button:

```html
<button data-sev="critical" style="color:#ff3366;border-color:#ff3366;">Critical</button>
<button data-sev="high" style="color:#b8860b;border-color:#b8860b;">High</button>
<button data-sev="medium" style="color:#ca8a04;border-color:#ca8a04;">Medium</button>
<button data-sev="low" style="color:#1a7a3a;border-color:#1a7a3a;">Low</button>
<button data-sev="info" style="color:#0891b2;border-color:#0891b2;">Info</button>
```

Omit any severity level with zero open/confirmed findings. Always preserve the
severity order: critical → high → medium → low → info.

Replace the `{{SEVERITY_FILTER_BUTTONS}}` token with this fragment.

### 3f. `{{FINDING_NAV}}`

For each **open or confirmed** finding (sorted as in §2a), emit one sidebar
nav link, grouped under a visual severity header. Emit a severity heading
`<div style="...">` only when the severity changes:

```html
<div style="color:#ff3366;font-size:7.5pt;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:10px 0 2px;padding:2px 6px;">Critical</div>
<a data-sev="critical" href="#SBD-001"><span class="sev-dot" style="background:#ff3366;"></span>SBD-001 — Title of finding</a>
```

Use the severity→color mapping from §3 to colour both the group heading and
the `sev-dot`. Truncate titles longer than 48 characters with `…`.

Replace the `{{FINDING_NAV}}` token with this fragment. If there are no
open/confirmed findings, replace with `<span style="color:#555;font-size:8pt;">None</span>`.

### 3g. `{{FIXED_NAV}}`

For each **fixed or false_positive** finding, emit one sidebar link:

```html
<a href="#SBD-NNN" style="color:#555;text-decoration:line-through;">SBD-NNN — Title</a>
```

Replace the `{{FIXED_NAV}}` token. If empty, replace with
`<span style="color:#555;font-size:8pt;">None</span>`.

### 3h. `{{BODY}}`

Emit one `.finding` card per finding (open/confirmed first in severity order,
then fixed/false_positive). Each card:

```html
<div class="finding" id="SBD-NNN" data-sev="{severity}">
  <div class="fhead">
    <span class="fid">SBD-NNN</span>
    <span class="sev-badge sev-{severity}">{SEVERITY}</span>
    <span class="ftitle">{title}</span>
    <span class="sev-badge status-{status}">{STATUS}</span>
  </div>
  <div class="fbody">
    <div class="k">Location</div>
    <p><code>{file}:{line}</code> &nbsp; Category: <code>{category}</code></p>
    <div class="k">Description</div>
    <p>{description or evidence — use evidence if description absent}</p>
    <div class="k">Exploit scenario</div>
    <p>{exploit_scenario — if absent, write "Not specified."}</p>
    <div class="k">Recommendation</div>
    <p>{recommendation — if absent, write "See category guidance."}</p>
    <div class="k">Confidence</div>
    <p>{confidence formatted as percentage, e.g. "87%"} — Verdict: {verdict.votes} votes &nbsp;|&nbsp; {verdict.reason}</p>
  </div>
</div>
```

Rules:
- `data-sev` attribute must be the lowercase severity string (matches the
  filter button's `data-sev`).
- Status badge: use `status-fixed` class for `fixed`, `status-open` for
  `open`, `status-confirmed` for `confirmed`. For `false_positive` use
  `status-open` class with text "False Positive".
- If `verdict` is null/absent (finding never triaged), omit the Confidence row.
- Sanitize any `<`, `>`, `&` in user-derived strings with HTML entities before
  inserting into the HTML.

Replace the `{{BODY}}` token with the concatenated cards.

---

## Step 4 — Write `report.html`

After performing all token replacements, write the final HTML string to
`OUTPUT_DIR/report.html`.

Verify before writing that the output contains **no remaining `{{...}}`
tokens** (scan for `{{` in the final string). If any remain, that is a bug —
stop and report which token was not replaced rather than writing a broken file.

The file must work when opened from a `file://` URL in a browser with no
network access: no `<link>`, no `<script src>`, no `<img src>` pointing
anywhere external.

---

## Step 5 — Write `findings.sarif`

Build a SARIF 2.1.0 JSON document and write it to `OUTPUT_DIR/findings.sarif`.

### SARIF structure

```json
{
  "$schema": "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
  "version": "2.1.0",
  "runs": [
    {
      "tool": {
        "driver": {
          "name": "SynticBugDefender",
          "version": "0.1.0",
          "informationUri": "https://github.com/Syntic-Ai/syntic-bug-defender",
          "rules": []
        }
      },
      "results": []
    }
  ]
}
```

### Severity → SARIF level mapping

| Severity | SARIF level |
|----------|-------------|
| critical | `error`     |
| high     | `error`     |
| medium   | `warning`   |
| low      | `note`      |
| info     | `none`      |

### Rules array

Collect the **unique** categories from all findings. For each unique category
emit one rule entry in `runs[0].tool.driver.rules`:

```json
{
  "id": "{category}",
  "name": "{PascalCase of category, e.g. SqlInjection}",
  "shortDescription": { "text": "{category} vulnerability" },
  "helpUri": "https://github.com/Syntic-Ai/syntic-bug-defender"
}
```

To convert a category slug to PascalCase: split on `-` and `_`, capitalise
each segment, join without separator (e.g. `sql-injection` → `SqlInjection`).

### Results array

For each finding in `ledger.findings` (all statuses), emit one result:

```json
{
  "ruleId": "{finding.category}",
  "level": "{mapped level per table above}",
  "message": {
    "text": "{finding.id}: {finding.title} — {finding.recommendation or 'See category guidance.'}"
  },
  "locations": [
    {
      "physicalLocation": {
        "artifactLocation": {
          "uri": "{finding.file}",
          "uriBaseId": "%SRCROOT%"
        },
        "region": {
          "startLine": {finding.line > 0 ? finding.line : 1}
        }
      }
    }
  ],
  "properties": {
    "severity": "{finding.severity}",
    "status": "{finding.status}",
    "confidence": {finding.confidence},
    "id": "{finding.id}"
  }
}
```

If `finding.file` is empty or null, use `"unknown"` as the URI.
If `finding.line` is 0 or null, use `1` as `startLine`.

---

## Step 6 — Confirm and report

Tell the user:

```
Report written:
  HTML  → docs/security-audit.nosync/report.html
  SARIF → docs/security-audit.nosync/findings.sarif

Summary:
  Total findings : {total}
  Confirmed      : {confirmed_count}
  Fixed          : {fixed_count}
  False positive : {fp_count}
  Open           : {open_count}

  Critical : {critical_count}
  High     : {high_count}
  Medium   : {medium_count}
  Low      : {low_count}
  Info     : {info_count}

Open report.html from file:// in any browser — no network required.
```

---

## Constraints

- **No external refs in output.** The HTML file must be fully self-contained.
- **Write only under `docs/security-audit.nosync/`.** Never modify source files.
- **Sanitize HTML.** Escape `<`, `>`, `&` in all ledger-derived strings before
  inserting into the HTML template.
- **No placeholder tokens in output.** Verify `{{` is absent in final HTML.
- **SARIF 2.1.0 schema.** Emit valid JSON only; do not include comments.
