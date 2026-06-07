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
