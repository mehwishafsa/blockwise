# Video script (about 3 minutes)

Record in 1080p. Increase browser zoom to 125% so the pixel font reads well on YouTube.
Before recording: seed memory, keep the Activity tab visible, and close other tabs and notifications.
Use this as a guide, not a script to read word for word.

## 1. Intro (0:00 to 0:30)

**On screen:** your face (optional), then the Blockwise home screen with PR #112 selected.

"Hi, I'm [YOUR NAME]. This is Blockwise, a code reviewer that remembers your team.
Most AI reviewers are smart strangers: they know Python, but not your team's rules. Blockwise uses Hindsight agent memory to learn those rules from past reviews and from your feedback."

## 2. The problem (0:30 to 1:00)

**On screen:** select **Without**, click **Review PR** on PR #112. Point at the comments.

"Here's a generic review of a coupon endpoint. It tells us to use f-strings in logging. Our team rejected that weeks ago because we log with %s on purpose. And it misses the real problems: a database query inside a route handler, and money calculated in floats. It's not wrong about Python. It's wrong about us."

## 3. Live demo (1:00 to 2:30)

**On screen:** open **Memory → Learned**. Scroll a little.

"I seeded Blockwise with eight past review threads. Hindsight extracted facts like 'money is integer paise' and 'no DB calls in routes', with the PR numbers."

**On screen:** choose **Side by side**, click **Review PR**. Switch to the **Activity** tab while it runs.

"Watch the Activity tab: three recalls, one for the files and code patterns, one for the author, one for rejected suggestions."

**On screen:** point at the gold cards on the right. Expand **Why Blockwise raised this**.

"Now it flags the database query and cites PR 97. It flags the float math and cites PR 99. And it says nothing about the logging, because it remembers we rejected that."

**On screen:** type a reason on one comment, for example "Route handlers are documented in the OpenAPI schema, not docstrings", and click **Reject**. Show the XP bar grow and the retain entry in Activity.

"When I reject a comment with a reason, it's retained immediately."

**On screen:** open PR #114, **With memory**, **Review PR**.

"Here's a clean PR. A generic reviewer would ask for docstrings on the tests. Blockwise approves it, because the team said no to that in PR 105."

**On screen:** **Memory → Playbook → Write playbook**.

"Finally, Hindsight's reflect writes the team's review playbook from everything it has learned. Nobody wrote this document."

## 4. Takeaway (2:30 to 3:00)

**On screen:** back to the side-by-side view, or your face.

"What surprised me: remembering what NOT to say mattered more than remembering what to flag. That's what makes developers keep reading the comments. The code is on GitHub, link below, and it's built on Hindsight."

---

## YouTube titles (pick one)

1. My AI Code Reviewer Finally Remembers What We Told It
2. I Gave an AI Code Reviewer Memory. It Stopped Nagging.
3. The AI Reviewer That Learns Your Team's Rules (Hindsight Memory Demo)
4. Why Your AI Code Reviewer Keeps Repeating Itself, and the Fix
5. Same PR, Same Model: With vs Without Agent Memory

## YouTube description

Blockwise is an AI code reviewer that remembers your team's conventions, rejected suggestions and recurring mistakes using Hindsight agent memory.
Code: https://github.com/YOUR-USERNAME/blockwise
Article: <YOUR DEV.TO URL>
Hindsight: https://github.com/vectorize-io/hindsight

## Thumbnail prompt (Google Nano Banana, attach your photo)

Generate a viral YouTube thumbnail, 16:9. On the left, the person from the attached photo with a surprised, delighted expression, pointing right. On the right, a chunky pixel-art, voxel-style code review window: one side labelled "BEFORE" in red with a pile of nagging comments, the other labelled "AFTER" glowing gold with a single sharp comment and a green experience bar filling up. Big bold pixel-font text across the top: "IT REMEMBERED". Dark stone-textured background, high contrast, bright green and gold accents, clean and uncluttered. No logos of any existing game or brand.
