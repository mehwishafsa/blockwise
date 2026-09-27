# How Blockwise uses Hindsight memory

Blockwise is only useful because it remembers. Without memory it is a generic reviewer that repeats the same style nits forever. With [Hindsight](https://github.com/vectorize-io/hindsight) it behaves like a senior teammate who has read every past review. This document explains exactly where and how memory is used.

## The memory bank

Each team gets one bank (default `blockwise-tiffin`). When the bank is created, Blockwise sets a `retain_mission` so Hindsight's fact extraction focuses on what a reviewer needs:

> Extract team coding conventions, architectural rules, the reason behind each rule, suggestions the team rejected and why, and recurring mistakes made by specific developers. Keep file paths, helper names and PR numbers. Ignore pleasantries.

It also sets a `reflect_mission` so playbook answers cite real conventions and PR numbers. See `ensureBank()` in `js/hindsight.js`.

## What gets retained

**1. Past review threads (seeding).** Eight review conversations from the sample team are retained in one async batch. Each item has:

- `content`: the full thread, formatted as `Name: message` so Hindsight can attribute who said what
- `timestamp`: when the review happened, so recall can reason about time ("in August")
- `document_id`: `review-pr-<n>`, which makes re-seeding idempotent instead of duplicating memories
- `tags`: `team:tiffin`, `source:review`, `kind:<convention|rejected-suggestion|recurring-mistake>`, `author:<name>`
- `metadata`: PR number, author, reviewer, kind

**2. Reviewer verdicts (learning).** When a human accepts or rejects a Blockwise comment, the verdict is retained immediately:

```
Code review feedback on PR #112 "Apply coupon discounts at checkout" by Sana Sheikh:
reviewer Priya Raman REJECTED the review agent's comment "Add a docstring" (...).
Reason: "Route handlers are documented in the OpenAPI schema, not docstrings".
The team does not want this suggestion; do not repeat it in future reviews.
```

This retain is synchronous (`async: false`) so the next review can recall it straight away.

## What gets recalled

Before every review with memory on, `recallForPR()` in `js/agent.js` runs three recalls in parallel:

| Query | Why |
|---|---|
| Conventions relevant to the PR title, the files in the diff, and cheap code signals (e.g. "database session in code", "outbound HTTP call", "arithmetic on amounts") | Pulls the rules this specific change might break |
| Review history for the PR author, filtered with the `author:*` tag | Surfaces personal patterns ("skips None checks") |
| Suggestions the team rejected and why | Prevents the agent from nagging |

Results are deduplicated, capped at 24, and numbered `M1…Mn`. The LLM must put the refs it relied on in `memory_refs`; any ref that doesn't exist is dropped before display, so the UI never shows a made-up citation.

## Reflect

The Playbook tab calls `reflect` to produce a written review playbook: conventions with reasons and PR numbers, rejected suggestions, and recurring mistakes per developer. This is Hindsight reasoning over the whole bank rather than keyword search.

## Before and after

Typical behaviour on the sample PRs (exact wording varies by model and run):

| | Without memory | With Hindsight |
|---|---|---|
| PR #112 route handler with `session.query` | Maybe notes a missing None check | Blocker: "no DB access in routes", citing PR #97 |
| Price math with `/ 100` and floats | Often missed, or "consider Decimal" | Blocker: "money is integer paise, use `apply_percent`", citing PR #99 and the July mismatch |
| `logger.info("... %s", x)` | Suggests f-strings | Silent, because the team rejected that in PR #100 |
| PR #113 by Ravi, `order.id` without None check | Generic warning | Flags it and notes the same pattern in PR #102 and #107 |
| PR #114 clean tests without docstrings | Suggests docstrings | Silent, because the team rejected that in PR #105 |

## Why Hindsight rather than a vector store

A plain vector store would return the most similar chunks of old review text. Hindsight extracts facts, links entities (people, files, helpers), keeps timestamps, and consolidates repeated evidence into observations like "Ravi often uses Optional returns without None checks". That is the difference between "here are some old comments" and "here is what this team believes". Its recall also fuses semantic, keyword, graph and temporal retrieval, which matters when the useful memory shares a helper name (`apply_percent`) rather than wording.

More: [Hindsight docs](https://hindsight.vectorize.io/) · [What is agent memory?](https://vectorize.io/what-is-agent-memory)
