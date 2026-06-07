---
name: init
description: >-
  Set up Syntic Bug Defender in the current repo — create the non-destructive
  output folder docs/security-audit.nosync/, gitignore it, detect the stack, and
  drop an authorization template. Use before the first scan, or run automatically by /scan.
disable-model-invocation: false
allowed-tools: [Read, Glob, Grep, Write, Bash(git:*), Bash(ls:*), Bash(test:*), Bash(mkdir:*)]
---

# init

This skill sets up Syntic Bug Defender in the current project repo. It is **non-destructive**: it
never overwrites or modifies existing files. Re-running it is safe — every step is idempotent.

**Safety preamble:** This skill performs read and folder-creation operations only. It does not build,
run, fuzz, or modify any source files in the project. It does not open the output folder contents in
any tool after writing them. It does not follow symlinks out of the project root.

---

## Step 1 — Resolve project root

Determine the project root as follows:

1. If the environment variable `CLAUDE_PROJECT_DIR` is set and points to an existing directory, use
   that path as `PROJECT_ROOT`.
2. Otherwise fall back to the current working directory (`cwd`) as `PROJECT_ROOT`.

Print: `Project root: <PROJECT_ROOT>`

---

## Step 2 — Create the non-destructive output folder

The output folder is always `<PROJECT_ROOT>/docs/security-audit.nosync/`. This path uses the
`.nosync` suffix so that iCloud Drive skips it, and it is kept inside `docs/` to co-locate audit
artifacts with other project documentation.

**Non-destructive rules (strictly observed):**

- If `<PROJECT_ROOT>/docs/` already exists: do NOT modify, move, or delete anything inside it.
  Only create the `security-audit.nosync/` subdirectory if it is missing.
- If `<PROJECT_ROOT>/docs/` does not exist: create `docs/` first, then `docs/security-audit.nosync/`.
- In both cases use `mkdir -p` so that the command is safe even if the directory already exists.

Run:
```
Bash: mkdir -p <PROJECT_ROOT>/docs/security-audit.nosync/
```

After the command, confirm the directory exists:
```
Bash: test -d <PROJECT_ROOT>/docs/security-audit.nosync/ && echo "OK" || echo "FAILED"
```

If the test prints `FAILED`, stop and report the error to the user.

---

## Step 3 — Ensure `.gitignore` lists the output folder

The output folder must never be committed to version control. Check whether the project has a
`.gitignore` file, and whether it already contains `docs/security-audit.nosync/`:

1. Bash: `test -f <PROJECT_ROOT>/.gitignore && echo exists || echo missing`
2. If the file exists, Grep it for the string `docs/security-audit.nosync/`.
   - If the string is already present: skip — do NOT append again.
   - If the string is absent: append exactly one line to the file using the Write tool (append mode
     is not directly available; instead Read the current `.gitignore`, and Write it back with the
     single new line added at the end, preserving all existing content verbatim).
3. If `.gitignore` does not exist: Write a new `.gitignore` containing only `docs/security-audit.nosync/`.

**Never rewrite or re-order the existing `.gitignore`; only append the missing line.**

---

## Step 4 — Detect stack and write `stack.md`

Read project manifests and source extensions to infer the tech stack and produce focus areas for
later scanning. Do this with read-only tools (Read, Glob, Grep, Bash ls).

### 4a. Detect languages and frameworks

Look for the following manifest files in `PROJECT_ROOT` (and one level deep for nested projects):

| File / pattern | Indicates |
|---|---|
| `package.json` | Node.js / JavaScript / TypeScript |
| `deno.json` | Deno / TypeScript |
| `tsconfig.json` | TypeScript |
| `requirements.txt`, `setup.py`, `setup.cfg`, `pyproject.toml` | Python |
| `go.mod` | Go |
| `Cargo.toml` | Rust |
| `pom.xml`, `build.gradle`, `build.gradle.kts` | Java / Kotlin / JVM |
| `composer.json` | PHP |
| `*.csproj`, `*.fsproj`, `*.sln` | .NET / C# / F# |
| `Gemfile` | Ruby / Rails |
| `CMakeLists.txt`, `Makefile` (with `.c`/`.cpp` in tree) | C / C++ |
| `*.swift` in tree | Swift |
| `*.kt` in tree | Kotlin |

Also sample file extensions in `src/`, `lib/`, `app/`, and the root to catch polyglot repos:
`.js`, `.ts`, `.tsx`, `.jsx`, `.py`, `.go`, `.rs`, `.java`, `.kt`, `.rb`, `.php`, `.cs`, `.cpp`, `.c`.

Read the content of any manifests found (just enough to identify the framework — first 60 lines):
- `package.json` → check `dependencies`/`devDependencies` for React, Next.js, Express, Fastify,
  NestJS, Vue, Angular, Svelte, etc.
- `pyproject.toml` / `setup.py` → check for Django, Flask, FastAPI, SQLAlchemy, Celery.
- `pom.xml` → check for Spring Boot, Spring Security, Hibernate.
- `Cargo.toml` → check for actix-web, axum, tokio, serde.
- `go.mod` → check for gin, echo, chi, gorm, grpc.

### 4b. Derive focus areas

Based on the detected stack, derive 4-10 focus areas for vulnerability scanning. Use this mapping
as a starting point — extend or trim based on what the project actually has:

**Web / API (any stack):**
- Authentication and session management (login, token issuance, session invalidation)
- Authorization and access control (permission checks, RBAC/ABAC enforcement)
- Injection vulnerabilities (SQL, NoSQL, LDAP, command, template — wherever user input reaches a query or shell)
- Cross-site scripting (XSS) — raw HTML rendering, innerHTML, dangerouslySetInnerHTML, v-html
- Cross-site request forgery (CSRF) — state-changing endpoints without CSRF token
- Input validation and path traversal (file uploads, path construction from user input)
- Sensitive data exposure (secrets in responses, logs, error messages, URLs)
- Security headers and CORS configuration

**Native / systems (C, C++, Rust unsafe, FFI):**
- Memory safety — buffer overflows, use-after-free, integer overflow feeding allocations
- Format string and unbounded recursion vulnerabilities
- Unsafe blocks and FFI boundary correctness

**Cryptography and secrets (any stack):**
- Hardcoded credentials, API keys, tokens in source or config
- Weak or broken cryptography (MD5/SHA1 for password hashing, ECB mode, static nonces)
- Insecure random number generation for security-sensitive values

**Supply chain and build:**
- Dependency lockfile hygiene and unpinned versions
- Build scripts that download and execute remote content (`curl | sh`)

**Infrastructure (if Terraform, Kubernetes, Docker, CI present):**
- Over-privileged IAM roles or service accounts
- Secrets exposed in environment variables, Dockerfiles, or CI logs
- Missing network policies or overly broad CORS / firewall rules

**Deserialization:**
- Unsafe deserialization of untrusted data (Python pickle, PHP unserialize, Java ObjectInputStream,
  YAML with arbitrary constructors)

Only include a focus area if there is evidence the stack actually has that surface
(e.g., include XSS only if the project renders HTML; include memory-safety only if C/C++ or
Rust `unsafe` is present). Note which areas apply and briefly why.

### 4c. Write `stack.md`

Write `<PROJECT_ROOT>/docs/security-audit.nosync/stack.md` with the following structure:

```markdown
# Stack Detection — <project name from manifest or directory name>

Generated: <today's date>

## Detected languages and frameworks

<bullet list: language/framework — detected via <manifest file>>

## Detected manifests

<bullet list of manifest paths found>

## Suggested scan focus areas

<numbered list: focus area name — one-line rationale>

## Notes

<any ambiguity, polyglot concerns, or areas the agent could not determine from static manifests>
```

**Do not overwrite an existing `stack.md`** — if it already exists, print
`stack.md already present — skipping (delete it to regenerate)` and move on.

---

## Step 5 — Copy the AUTHORIZATION template

The authorization template lives at `${CLAUDE_PLUGIN_ROOT}/templates/AUTHORIZATION.md`.

If `<PROJECT_ROOT>/docs/security-audit.nosync/AUTHORIZATION.md` does not exist:
1. Read `${CLAUDE_PLUGIN_ROOT}/templates/AUTHORIZATION.md`.
2. Write its contents to `<PROJECT_ROOT>/docs/security-audit.nosync/AUTHORIZATION.md`.

If the file already exists, skip — do NOT overwrite it (it may have been partially filled in).

Print: `AUTHORIZATION.md copied — fill it in before running active-testing features.`
or: `AUTHORIZATION.md already present — skipping.`

---

## Step 6 — Summary

Print a concise summary of what was created or skipped:

```
Syntic Bug Defender — init complete
=====================================
Project root : <PROJECT_ROOT>
Output folder: docs/security-audit.nosync/  [created | already existed]
.gitignore   : docs/security-audit.nosync/ entry [appended | already present]
stack.md     : [created | already existed — skipped]
AUTHORIZATION: [created | already existed — skipped]

Detected stack: <comma-separated list of detected languages/frameworks>
Focus areas  : <count> suggested (see stack.md)

Next step: run /syntic-bug-defender:scan  (or /syntic-bug-defender:threat-model first)
```

This skill is idempotent. Re-running it after the output folder and files are present produces
the same output and makes no changes.

---

## Constraints

- **Never open the output folder** (`docs/security-audit.nosync/`) or any `.nosync` path with
  any Read or Glob tool call after writing to it. Write-then-done, no readback loops.
- **Never modify any existing source file** in the project. This skill only creates new directories
  and files inside `docs/security-audit.nosync/`, and optionally appends one line to `.gitignore`.
- **Never execute project code.** No `npm install`, `pip install`, `cargo build`, or similar.
  Only `ls`, `test`, and `mkdir` Bash commands are permitted.
- If any step fails (directory creation, write), stop and report the error clearly without
  attempting silent recovery.
