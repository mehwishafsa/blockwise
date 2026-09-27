// The review agent. Three steps per review:
//   1. RECALL what Hindsight knows that is relevant to this PR and its author
//   2. REVIEW the diff with an LLM, grounded in those memories
//   3. RETAIN the human's accept/reject feedback so the next review is better

import { chatJSON } from "./llm.js";
import { authorTag } from "./data.js";

const SEVERITIES = ["blocker", "major", "minor", "nit"];

// ---------- 1. Recall ----------

export async function recallForPR(hs, pr) {
  const files = [...pr.diff.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((m) => m[1]);
  const signals = extractSignals(pr.diff);

  const queries = [
    {
      q: `Team conventions and past review decisions relevant to a PR titled "${pr.title}" touching ${files.join(", ")}. Code uses: ${signals.join(", ")}.`,
    },
    { q: `Recurring mistakes and review history for developer ${pr.author}`, tags: [authorTag(pr.author)] },
    { q: "Suggestions the team rejected in past code reviews and the reasons given" },
  ];

  const settled = await Promise.allSettled(
    queries.map((x) => hs.recall(x.q, { tags: x.tags, tagsMatch: "any", budget: "mid", maxTokens: 2048 }))
  );

  const seen = new Set();
  const memories = [];
  for (const r of settled) {
    if (r.status !== "fulfilled") continue;
    for (const m of r.value) {
      const key = m.id || m.text;
      if (!m.text || seen.has(key)) continue;
      seen.add(key);
      memories.push({ id: m.id, text: m.text, type: m.type, date: m.occurred_start || m.mentioned_at || null });
    }
  }
  if (settled.every((r) => r.status === "rejected")) throw settled[0].reason;
  return memories.slice(0, 24).map((m, i) => ({ ...m, ref: `M${i + 1}` }));
}

// Pull a few cheap keywords out of the diff so recall has something concrete to match on.
function extractSignals(diff) {
  const added = diff
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .join("\n");
  const checks = [
    [/session\.query|Session\b/, "database session in code"],
    [/\/ ?100\b|float|round\(/, "arithmetic on amounts"],
    [/paise|price|discount|total|amount/i, "money"],
    [/os\.getenv|os\.environ/, "environment variables"],
    [/requests\.|httpx/, "outbound HTTP call"],
    [/webhook/i, "webhook"],
    [/logger\.|logging/, "logging"],
    [/def test_/, "tests"],
    [/Repository\(\)?\.get|\.get_by_id|\.first\(\)/, "repository lookup that may return None"],
  ];
  return checks.filter(([re]) => re.test(added)).map(([, label]) => label);
}

// ---------- 2. Review ----------

export async function reviewPR({ llm, pr, memories, useMemory }) {
  const system = useMemory ? SYSTEM_WITH_MEMORY : SYSTEM_NO_MEMORY;
  const memoryBlock = useMemory
    ? memories.length
      ? memories.map((m) => `[${m.ref}] ${m.text}${m.date ? ` (${m.date.slice(0, 10)})` : ""}`).join("\n")
      : "(Memory is empty. Review normally.)"
    : "";

  const user = [
    `Pull request #${pr.pr}: "${pr.title}"`,
    `Author: ${pr.author}`,
    useMemory ? `\nWhat you remember about this team (from Hindsight):\n${memoryBlock}` : "",
    `\nDiff:\n${pr.diff}`,
    `\nReturn JSON only, in this shape:
{"summary": "one or two sentences",
 "comments": [{"file": "path", "line": "the exact added code line or null",
   "severity": "blocker|major|minor|nit", "category": "architecture|correctness|security|reliability|style|testing",
   "title": "short title", "body": "what is wrong and what to do instead",
   "memory_refs": ["M1"]}]}`,
  ].join("\n");

  const out = await chatJSON({ ...llm, system, user });
  const valid = new Set(memories.map((m) => m.ref));
  const comments = (Array.isArray(out.comments) ? out.comments : [])
    .filter((c) => c && c.title)
    .map((c, i) => ({
      id: `${pr.pr}-${useMemory ? "m" : "g"}-${i}`,
      file: String(c.file || ""),
      line: c.line ? String(c.line) : "",
      severity: SEVERITIES.includes(c.severity) ? c.severity : "minor",
      category: String(c.category || "style"),
      title: String(c.title),
      body: String(c.body || ""),
      memoryRefs: useMemory ? (c.memory_refs || []).filter((r) => valid.has(r)) : [],
    }))
    .sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));

  return { summary: String(out.summary || ""), comments };
}

const SYSTEM_NO_MEMORY = `You are a code reviewer seeing this codebase for the first time.
You know nothing about the team's conventions or history. Review the diff using general best practices.
Be specific and concise. Return at most 7 comments. Return valid JSON only.`;

const SYSTEM_WITH_MEMORY = `You are a senior code reviewer who has reviewed this team's pull requests for months.
You are given memories recalled from Hindsight, your long-term memory of past reviews.

Rules:
1. Enforce the team's conventions from memory. When a comment is based on a memory, put its ref (e.g. "M3") in memory_refs and mention the original PR number or incident if the memory contains it.
2. Never make a suggestion that memory says the team rejected. If code follows a deliberate team choice, stay silent about it.
3. If memory shows this author has made the same mistake before, say so briefly and kindly, and name the earlier PR.
4. Only flag float usage as a problem when it involves money. Averages and ratings are fine as floats.
5. Do not invent conventions that are not in memory. General bugs you notice yourself are fine, with memory_refs empty.
6. A clean PR deserves few or zero comments. Do not pad the review.
Return at most 7 comments. Return valid JSON only.`;

// ---------- 3. Retain feedback ----------

export function feedbackItem({ pr, comment, verdict, reason, reviewer }) {
  const today = new Date().toISOString();
  const what = `the review agent's comment "${comment.title}" (${comment.body})`;
  const content =
    verdict === "accepted"
      ? `Code review feedback on PR #${pr.pr} "${pr.title}" by ${pr.author}: reviewer ${reviewer} ACCEPTED ${what}. This confirms the concern is a real team rule or recurring issue.`
      : `Code review feedback on PR #${pr.pr} "${pr.title}" by ${pr.author}: reviewer ${reviewer} REJECTED ${what}. Reason: "${reason}". The team does not want this suggestion; do not repeat it in future reviews.`;
  return {
    content,
    context: "reviewer feedback on an automated code review comment",
    timestamp: today,
    document_id: `feedback-pr-${pr.pr}-${slug(comment.title)}`,
    tags: [
      "team:tiffin",
      "source:feedback",
      verdict === "accepted" ? "kind:accepted-suggestion" : "kind:rejected-suggestion",
      authorTag(pr.author),
    ],
    metadata: { pr: String(pr.pr), verdict, reviewer },
  };
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
}
