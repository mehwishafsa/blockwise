---
title: I Gave My Code Reviewer Hindsight Memory. It Stopped Nagging.
published: false
description: An AI code reviewer that remembers team conventions, rejected suggestions and who makes which mistakes, built on Hindsight agent memory.
tags: ai, agents, python, codereview
cover_image:
---

The third time our AI reviewer told us to convert `logger.info("Order %s placed", order_id)` into an f-string, I stopped reading its comments altogether.

That's the real failure of most AI code review tools. They aren't wrong about Python. They're wrong about *us*. They don't know we log with `%s` on purpose, that we keep money in integer paise because floats once cost us a reconciliation mismatch, or that one of us keeps forgetting to check `None` after a repository lookup. Every pull request, they meet the team for the first time.

So I built Blockwise, a code reviewer that remembers. It uses [Hindsight, an open-source agent memory system](https://github.com/vectorize-io/hindsight), to learn a team's conventions from past reviews and, more importantly, to learn from every comment a human accepts or rejects.

<!-- SCREENSHOT: Blockwise side-by-side view on PR #112 -->

## What Blockwise does

Blockwise is a static web app. You pick a pull request, it shows the diff, and you ask for a review. There is a side-by-side mode that runs the same review twice: once as a generic reviewer, once with memory. That view is the whole argument for the project in one screen.

The loop has three steps:

1. **Recall** what memory knows that's relevant to this pull request and its author.
2. **Review** the diff with an LLM (I use `openai/gpt-oss-120b` on Groq), grounded in those memories.
3. **Retain** the human's verdict on each comment, including the reason for a rejection.

To make it concrete, I seeded it with eight review threads from a sample food-delivery backend team, Tiffin. They contain rules like "no database calls inside route handlers" (PR #97), "money is integer paise, use `apply_percent`" (PR #99), and two suggestions the team explicitly rejected: f-strings in logging calls (PR #100) and docstrings on test functions (PR #105).

<!-- IMAGE: docs/architecture.png -->

## Why memory, and why not just a bigger prompt

My first instinct was to paste a `CONVENTIONS.md` into the system prompt. That works for rules someone bothered to write down. It fails for everything that actually matters in code review: the decision made in a PR thread three weeks ago, the reason behind it, and the fact that Ravi has now skipped the same `None` check twice.

That knowledge is scattered across conversations and keeps changing. I didn't want to maintain a document; I wanted the reviewer to pick it up the way a new senior engineer does, by being in the reviews.

[Hindsight](https://hindsight.vectorize.io/) fits that shape. You `retain` raw content, and it extracts facts, links entities (people, files, helper functions), keeps timestamps, and consolidates repeated evidence into observations. You `recall` with a question and it fuses semantic, keyword, graph and temporal search. You `reflect` to have it reason over everything it knows.

## Teaching it: retain with a mission

The first thing Blockwise does is create a memory bank with a `retain_mission`. This steers what Hindsight extracts, and it made a bigger difference than any prompt tweak I tried later:

```js
const body = {
  retain_mission:
    "This bank belongs to a code review agent for one engineering team. Extract team coding conventions, " +
    "architectural rules, the reason behind each rule, suggestions the team rejected and why, and recurring " +
    "mistakes made by specific developers. Keep file paths, helper names and PR numbers. Ignore pleasantries.",
};
await this.request("PUT", this.bankPath, body, "bank");
```

Each past review is retained as one item: the whole thread, a real timestamp, a `document_id` so re-seeding doesn't create duplicates, and tags like `author:ravi-kumar` and `kind:rejected-suggestion`.

The part I care most about is what happens after a review. Every comment has **Accept** and **Reject** buttons, and rejecting asks for a one-line reason. That verdict goes straight back into memory:

```js
const content =
  verdict === "accepted"
    ? `... reviewer ${reviewer} ACCEPTED ${what}. This confirms the concern is a real team rule or recurring issue.`
    : `... reviewer ${reviewer} REJECTED ${what}. Reason: "${reason}". ` +
      `The team does not want this suggestion; do not repeat it in future reviews.`;
```

Seeding uses async retain because it's a batch. Feedback is retained synchronously, because a rejection that isn't visible to the very next review is worthless. That one-line decision fixed the most annoying bug I had.

## Remembering: three recalls per pull request

One recall with the PR title wasn't enough. "Apply coupon discounts at checkout" doesn't sound anything like "money is integer paise", even though that's the rule the PR breaks. So Blockwise runs three recalls in parallel:

```js
const queries = [
  { q: `Team conventions and past review decisions relevant to a PR titled "${pr.title}" ` +
       `touching ${files.join(", ")}. Code uses: ${signals.join(", ")}.` },
  { q: `Recurring mistakes and review history for developer ${pr.author}`,
    tags: [authorTag(pr.author)] },
  { q: "Suggestions the team rejected in past code reviews and the reasons given" },
];
```

The `signals` come from a cheap pass over the added lines: `session.query` becomes "database session in code", `/ 100` becomes "arithmetic on amounts", `requests.` becomes "outbound HTTP call". Those phrases give recall something concrete to match, and Hindsight's keyword and graph retrieval pick up exact helper names like `apply_percent` that pure embeddings tend to blur.

Results are merged, deduplicated and numbered `M1…Mn`. The review prompt requires the model to cite the refs it relied on, and I filter out any ref that doesn't exist, so the UI never shows a made-up citation.

## Before and after

Here's PR #112, a coupon endpoint that queries the database inside the route handler, computes the discount in floats, and logs with `%s`.

**Without memory**, the review looked like a lint report from a stranger: a missing `None` check, "add a docstring", and "use f-strings in your logging call". One real issue, two things the team had already rejected.

**With memory**, the same model on the same diff flagged the database query as a blocker and cited PR #97. It flagged the float math as a blocker, cited PR #99, and mentioned the July reconciliation mismatch that caused the rule. And it said nothing about the logging call.

<!-- SCREENSHOT: the two review columns for PR #112 -->

PR #113 is Ravi's refund webhook. It reads a secret with `os.getenv`, calls `requests.post` without a timeout, skips signature verification, and uses `order.id` without checking the lookup. With memory, Blockwise flagged all four, and on the `None` check it noted, politely, that the same thing came up in PR #102 and PR #107.

PR #114 is the one I like most: a clean service with two tests and no docstrings. The generic reviewer asked for docstrings. With memory, Blockwise approved it with zero style comments, because the team had rejected that suggestion in PR #105.

Then I tested the learning loop directly. On a fresh review I rejected a comment with "Route handlers are documented in the OpenAPI schema, not docstrings". The next review didn't make that suggestion again. That's the moment it stopped feeling like a tool and started feeling like a colleague.

The Playbook tab calls Hindsight's `reflect` and writes the team's review playbook from memory: conventions with reasons and PR numbers, rejected suggestions, and per-person patterns. Nobody wrote that document. It came out of the reviews.

## Lessons learned

**1. The retain mission matters more than the review prompt.** Once Hindsight extracted "rule + reason + PR number" instead of generic summaries, the review prompt got shorter and the comments got better.

**2. Negative memory is the killer feature.** Remembering what to flag is nice. Remembering what *not* to say is what earns back a developer's attention. If I built only one thing again, it would be the Reject-with-reason button.

**3. Recall from several angles.** Titles don't describe the rules a change breaks. Splitting recall into "what this code touches", "who wrote it" and "what we've rejected" was the biggest quality jump.

**4. Make grounding checkable.** Forcing the model to cite memory refs, and dropping refs that don't exist, made it easy to trust the gold-highlighted comments and easy to spot when the model was guessing.

**5. Be careful with per-person memory.** "Ravi skips None checks" is useful, but it has to be phrased as help, not blame. I ask the model to mention history briefly and kindly, and I'd want a team's consent before turning it on for real.

## What's next

Blockwise runs entirely in the browser today, which keeps it easy to try but means keys live in localStorage. The obvious next step is a small backend with a GitHub webhook, so every PR gets a review and every resolved review thread becomes memory automatically.

If you're building agents that interact with the same people repeatedly, it's worth reading up on [how agent memory differs from RAG](https://vectorize.io/what-is-agent-memory). The difference I felt wasn't that the model got smarter. It's that it finally knew who it was talking to.

The code is on GitHub: [Blockwise repository](https://github.com/YOUR-USERNAME/blockwise), and it's built on [Hindsight](https://github.com/vectorize-io/hindsight).
