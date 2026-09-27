# Submission checklist

Deadline: **29 September**. Confirm the exact closing time with the organizers.
Never write the word "hackathon" in the article, post, video, hashtags or repo.

## 0. Right now (5 minutes)

- [ ] Every team member fills the **Profile Review Form** (without it the team is not reviewed).

## 1. Get the app live (about 1 hour)

- [ ] Create a free Groq key: https://console.groq.com/keys
- [ ] Create a Hindsight Cloud account: https://ui.hindsight.vectorize.io, add promo code **MEMHACK99** in Billing, then create an API key.
- [ ] Create a **public** GitHub repo named `blockwise`. Upload everything in this folder **except** the `submission/` folder (keep that for yourself), so `index.html` is at the root.

  ```bash
  cd blockwise
  git init && git add . && git reset submission && git commit -m "Blockwise: code reviewer with Hindsight memory"
  git branch -M main
  git remote add origin https://github.com/YOUR-USERNAME/blockwise.git
  git push -u origin main
  ```

- [ ] Repo **Settings → Pages → Deploy from a branch → main / (root) → Save**. Wait 1 to 2 minutes.
- [ ] Open `https://YOUR-USERNAME.github.io/blockwise/`, go to Settings, paste both keys, Save.
- [ ] Click **Teach team history** and wait until the XP bar stops growing (can take 1 to 3 minutes).
  - If you see "Could not reach Hindsight", deploy `proxy/cloudflare-worker.js` (steps inside the file) and paste the worker URL as the Hindsight API URL.
- [ ] Run PR #112 in **Side by side**, PR #113 and PR #114 **With memory**. Reject one comment with a reason. Write the playbook.
- [ ] Take screenshots: side-by-side on #112, a gold card with "Why Blockwise raised this" open, the Activity tab, the Playbook.

## 2. Make the article true (important)

The article describes the behaviour the app is designed to show. LLM output varies, so **edit any sentence that doesn't match what you actually saw**, for example the exact comments on PR #113 or PR #114. Honest beats impressive, and judges will try it.

- [ ] Replace `YOUR-USERNAME` in `article.md`, `linkedin_post.md`, `reddit_post.md`, `video_script.md` and `README.md`.
- [ ] Add your real screenshots where the `<!-- SCREENSHOT -->` comments are, and `docs/architecture.png` as the cover image.

## 3. Publish in this order

| # | Task | Where | Form field |
|---|---|---|---|
| 1 | Record and upload the video (public, with thumbnail) | YouTube | **Video Link** |
| 2 | Publish the article (paste `article.md`, set `published: true`) | dev.to/new | **Article link** |
| 3 | Link post with the article URL | r/LLMDevs | **Reddit Post Link** |
| 4 | Post `linkedin_post.md`, then add the two comments | LinkedIn | **Social Media Post on LinkedIn** |
| 5 | Repo link | GitHub | **GitHub Repository** |

Each team member publishes their **own** article and LinkedIn post (different angles are fine). The team shares one video.

## 4. Before you submit the form

- [ ] Open every link in a private/incognito window: all public?
- [ ] Article has the three Hindsight links and no "hackathon" anywhere, including tags.
- [ ] LinkedIn post has the GitHub link in the post, the article in the first comment, Hindsight repo in another comment.
- [ ] Team name spelled exactly as registered.
- [ ] Only **one** submission per team; everyone agrees before submitting.
- [ ] Submit early on the 29th, not at the last minute.
