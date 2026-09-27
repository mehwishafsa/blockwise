import { Hindsight } from "./hindsight.js";
import { recallForPR, reviewPR, feedbackItem } from "./agent.js";
import { DEMO_PRS, SEED_REVIEWS, TEAM, seedToRetainItem } from "./data.js";

// ---------- Settings ----------
const DEFAULTS = {
  hsUrl: "https://api.hindsight.vectorize.io",
  hsBank: "blockwise-tiffin",
  hsKey: "",
  llmUrl: "https://api.groq.com/openai/v1",
  llmModel: "openai/gpt-oss-120b",
  llmKey: "",
  reviewer: "Priya Raman",
};
const store = {
  get(k, fallback) {
    try { const v = localStorage.getItem("blockwise:" + k); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(k, v) {
    try { localStorage.setItem("blockwise:" + k, JSON.stringify(v)); } catch { /* storage unavailable */ }
  },
};
let settings = { ...DEFAULTS, ...store.get("settings", {}) };

// ---------- State ----------
const state = {
  prs: [...DEMO_PRS, ...store.get("customPrs", [])],
  current: null,
  mode: "memory",
  results: {}, // pr number -> { memory?: {...}, generic?: {...} }
  verdicts: store.get("verdicts", {}), // comment id -> {verdict, reason}
  memoryTotal: null,
  quest: store.get("quest", {}),
  busy: false,
};

const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ---------- Hindsight client ----------
function hindsight() {
  return new Hindsight({ baseUrl: settings.hsUrl, apiKey: settings.hsKey, bankId: settings.hsBank, onLog: addLog });
}
function llmConfig() {
  return { baseUrl: settings.llmUrl, apiKey: settings.llmKey, model: settings.llmModel };
}
function haveKeys({ needLLM = true } = {}) {
  const ok = !!settings.hsUrl && !!settings.hsBank && (!needLLM || !!settings.llmKey);
  if (!ok) {
    toast(needLLM ? "Add your LLM key and Hindsight details in Settings first." : "Add your Hindsight details in Settings first.");
    openSettings();
  }
  return ok;
}

// ---------- Pixel art ----------
function pixelSVG(rows, palette, size) {
  const h = rows.length, w = rows[0].length;
  let rects = "";
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (palette[ch]) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${palette[ch]}"/>`;
    })
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${size}" height="${size}" shape-rendering="crispEdges">${rects}</svg>`;
}
const LOGO = pixelSVG(
  [
    "KKKKKKKKKK",
    "KsssssssSK",
    "KsSSSSSSDK",
    "KsSGGGGSDK",
    "KsSGWKGSDK",
    "KsSGKKGSDK",
    "KsSGGGGSDK",
    "KsSSSSSSDK",
    "KSDDDDDDDK",
    "KKKKKKKKKK",
  ],
  { K: "#1e1e1e", s: "#ffffff", S: "#b4b4b4", D: "#6d6d6d", G: "#7ef52a", W: "#ffffff" },
  44
);

function makeTexture(colors, cells, px, seed) {
  const c = document.createElement("canvas");
  c.width = c.height = cells * px;
  const g = c.getContext("2d");
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let y = 0; y < cells; y++)
    for (let x = 0; x < cells; x++) {
      const r = rand();
      g.fillStyle = r < 0.62 ? colors[0] : r < 0.86 ? colors[1] : colors[2];
      g.fillRect(x * px, y * px, px, px);
    }
  return c.toDataURL();
}
function applyTextures() {
  try {
    const root = document.documentElement.style;
    root.setProperty("--tex-deep", `url(${makeTexture(["#2b2b33", "#303039", "#25252c"], 16, 4, 7)})`);
    root.setProperty("--tex-stone", `url(${makeTexture(["#c6c6c6", "#cbcbcb", "#bdbdbd"], 16, 3, 11)})`);
  } catch { /* canvas unavailable, solid colors remain */ }
}

// ---------- Rendering: PR list and diff ----------
function renderSlots() {
  const el = $("#slots");
  el.innerHTML =
    state.prs
      .map(
        (p) => `<button class="slot" type="button" data-pr="${p.pr}" aria-current="${state.current?.pr === p.pr}">
          <span class="num">#${p.pr}</span>
          <span><span class="t">${esc(p.title)}</span><br><span class="a">${esc(p.author)}</span></span>
        </button>`
      )
      .join("") +
    `<button class="btn small" type="button" id="addCustom">Review your own diff</button>`;
  el.querySelectorAll(".slot").forEach((b) => b.addEventListener("click", () => selectPr(Number(b.dataset.pr))));
  $("#addCustom").addEventListener("click", () => $("#customDlg").showModal());
}

function selectPr(num) {
  state.current = state.prs.find((p) => p.pr === num) || null;
  renderSlots();
  const p = state.current;
  $("#prTitle").textContent = p ? `#${p.pr} ${p.title}` : "Pick a pull request";
  $("#prMeta").textContent = p ? `${p.author} · opened ${p.date.slice(0, 10)}` : "";
  $("#prNote").textContent = p?.note || "";
  renderDiff();
  renderResults();
}

function renderDiff() {
  const p = state.current;
  const pre = $("#diff");
  if (!p) {
    pre.innerHTML = `<span class="meta">Select a pull request from the left.</span>`;
    return;
  }
  const flags = new Map();
  const r = state.results[p.pr];
  const active = r?.memory || r?.generic;
  for (const c of active?.comments || []) {
    const key = norm(c.line);
    if (key && !flags.has(key)) flags.set(key, c);
  }
  pre.innerHTML = p.diff
    .split("\n")
    .map((line) => {
      let cls = "";
      if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ")) cls = "meta";
      else if (line.startsWith("@@")) cls = "hunk";
      else if (line.startsWith("+")) cls = "add";
      else if (line.startsWith("-")) cls = "del";
      const hit = cls === "add" ? flags.get(norm(line.slice(1))) : null;
      if (hit) cls += ` flag-${hit.severity}`;
      return `<span class="${cls}"${hit ? ` title="${esc(hit.title)}"` : ""}>${esc(line) || " "}</span>`;
    })
    .join("");
}
const norm = (s) => String(s || "").replace(/^\+/, "").trim().replace(/\s+/g, " ");

// ---------- Rendering: results ----------
function renderResults() {
  const box = $("#results");
  const p = state.current;
  const r = p ? state.results[p.pr] : null;
  if (!p || !r) {
    box.className = "results";
    box.innerHTML = `<div class="empty"><strong>No review yet</strong>${
      p ? "Press Review PR. Try Side by side to see what memory changes." : "Pick a pull request to begin."
    }</div>`;
    return;
  }
  const cols = [];
  if (r.generic) cols.push(renderColumn(p, r.generic, false));
  if (r.memory) cols.push(renderColumn(p, r.memory, true));
  box.className = "results" + (cols.length === 2 ? " two" : "");
  box.innerHTML = cols.join("");
  wireFeedback(box, p);
}

function renderColumn(p, res, withMemory) {
  if (res.loading) {
    return `<div><div class="col-head ${withMemory ? "memory" : "generic"}">${
      withMemory ? "With Hindsight memory" : "Without memory"
    }</div><div class="empty"><strong>${esc(res.loading)}<span class="working"></span></strong></div></div>`;
  }
  if (res.error) {
    return `<div><div class="col-head ${withMemory ? "memory" : "generic"}">${
      withMemory ? "With Hindsight memory" : "Without memory"
    }</div><div class="empty"><strong>Review failed</strong>${esc(res.error)}</div></div>`;
  }
  const memById = Object.fromEntries((res.memories || []).map((m) => [m.ref, m]));
  const recalled = withMemory
    ? `<details class="recalled"><summary>Recalled ${res.memories.length} memories from Hindsight in ${res.recallMs} ms</summary><ul>${res.memories
        .map((m) => `<li><b>${m.ref}</b> ${esc(m.text)}</li>`)
        .join("")}</ul></details>`
    : "";
  const cards = res.comments.length
    ? res.comments.map((c) => renderCard(c, memById)).join("")
    : `<div class="clean">No issues worth raising. Approve.</div>`;
  return `<div>
    <div class="col-head ${withMemory ? "memory" : "generic"}">${withMemory ? "With Hindsight memory" : "Without memory"} · ${
      res.comments.length
    } comment${res.comments.length === 1 ? "" : "s"}</div>
    ${recalled}
    ${res.summary ? `<div class="summary">${esc(res.summary)}</div>` : ""}
    ${cards}
  </div>`;
}

function renderCard(c, memById) {
  const refs = c.memoryRefs.map((r) => memById[r]).filter(Boolean);
  const v = state.verdicts[c.id];
  const feedback = v
    ? `<div class="feedback"><span class="verdict ${v.verdict === "accepted" ? "ok" : "no"}">${
        v.verdict === "accepted" ? "Accepted · remembered" : "Rejected · remembered"
      }</span>${v.reason ? `<span class="muted">“${esc(v.reason)}”</span>` : ""}</div>`
    : `<div class="feedback" data-id="${c.id}">
        <button class="btn small primary" data-act="accept" type="button">Accept</button>
        <input type="text" aria-label="Reason for rejecting" placeholder="Why reject? Blockwise will remember" />
        <button class="btn small danger" data-act="reject" type="button">Reject</button>
      </div>`;
  return `<article class="card${refs.length ? " remembered" : ""}">
    <div class="card-top">
      <span class="sev ${c.severity}">${c.severity}</span>
      <span class="cat">${esc(c.category)}</span>
      ${refs.length ? `<span class="mem-chip">From memory · ${refs.map((m) => m.ref).join(", ")}</span>` : ""}
    </div>
    <h4>${esc(c.title)}</h4>
    ${c.file || c.line ? `<div class="where">${esc(c.file)}${c.line ? ` · <code>${esc(c.line)}</code>` : ""}</div>` : ""}
    <div class="body">${esc(c.body)}</div>
    ${
      refs.length
        ? `<details class="why"><summary>Why Blockwise raised this</summary><ul>${refs
            .map((m) => `<li>${esc(m.text)}</li>`)
            .join("")}</ul></details>`
        : ""
    }
    ${feedback}
  </article>`;
}

function wireFeedback(box, p) {
  box.querySelectorAll(".feedback[data-id]").forEach((row) => {
    const id = row.dataset.id;
    const input = row.querySelector("input");
    row.querySelector('[data-act="accept"]').addEventListener("click", (e) => sendFeedback(p, id, "accepted", "", e.currentTarget));
    row.querySelector('[data-act="reject"]').addEventListener("click", (e) => {
      const reason = input.value.trim();
      if (!reason) {
        input.focus();
        toast("Add a short reason so Blockwise learns why.");
        return;
      }
      sendFeedback(p, id, "rejected", reason, e.currentTarget);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") row.querySelector('[data-act="reject"]').click();
    });
  });
}

function findComment(p, id) {
  const r = state.results[p.pr] || {};
  return [...(r.memory?.comments || []), ...(r.generic?.comments || [])].find((c) => c.id === id);
}

async function sendFeedback(p, id, verdict, reason, btn) {
  if (!haveKeys({ needLLM: false })) return;
  const comment = findComment(p, id);
  if (!comment) return;
  const row = btn.closest(".feedback");
  row.querySelectorAll("button, input").forEach((el) => (el.disabled = true));
  btn.textContent = "Learning…";
  try {
    const hs = hindsight();
    await hs.retain([feedbackItem({ pr: p, comment, verdict, reason, reviewer: settings.reviewer || "Reviewer" })], { async: false });
    state.verdicts[id] = { verdict, reason };
    store.set("verdicts", state.verdicts);
    completeQuest("feedback");
    toast(verdict === "accepted" ? "Remembered: this concern is a real team rule." : "Remembered. Blockwise won't suggest this again.");
    renderResults();
    refreshMemories();
  } catch (err) {
    toast(err.message, true);
    row.querySelectorAll("button, input").forEach((el) => (el.disabled = false));
    btn.textContent = verdict === "accepted" ? "Accept" : "Reject";
  }
}

// ---------- Running a review ----------
async function runReview() {
  const p = state.current;
  if (!p) return toast("Pick a pull request first.");
  if (!haveKeys()) return;
  if (state.busy) return;
  state.busy = true;
  $("#runBtn").disabled = true;

  const modes = state.mode === "compare" ? ["generic", "memory"] : [state.mode];
  state.results[p.pr] = {};
  for (const m of modes) state.results[p.pr][m] = { loading: m === "memory" ? "Recalling team memory" : "Reviewing" };
  renderResults();

  await Promise.all(
    modes.map(async (m) => {
      try {
        let memories = [];
        let recallMs = 0;
        if (m === "memory") {
          const t0 = performance.now();
          memories = await recallForPR(hindsight(), p);
          recallMs = Math.round(performance.now() - t0);
          state.results[p.pr][m] = { loading: `Reviewing with ${memories.length} memories` };
          renderResults();
        }
        const out = await reviewPR({ llm: llmConfig(), pr: p, memories, useMemory: m === "memory" });
        state.results[p.pr][m] = { ...out, memories, recallMs };
      } catch (err) {
        state.results[p.pr][m] = { error: err.message };
      }
      renderResults();
    })
  );

  if (state.mode === "compare") completeQuest("compare");
  renderDiff();
  state.busy = false;
  $("#runBtn").disabled = false;
}

// ---------- Memory panel ----------
async function refreshMemories() {
  if (!settings.hsUrl || !settings.hsBank) return;
  try {
    const { items, total } = await hindsight().listMemories({ limit: 60 });
    const list = $("#memList");
    list.innerHTML = items.length
      ? items
          .map(
            (m) =>
              `<li><span class="type">${esc(m.fact_type || "fact")}${m.date ? " · " + esc(String(m.date).slice(0, 10)) : ""}</span>${esc(m.text)}</li>`
          )
          .join("")
      : `<li>Nothing yet. Press "Teach team history" to seed past reviews.</li>`;
    setXP(total);
  } catch (err) {
    if (err.status === 404) {
      $("#memList").innerHTML = `<li>This bank is empty. Press "Teach team history" to create it.</li>`;
      setXP(0);
    } else {
      $("#memList").innerHTML = `<li>${esc(err.message)}</li>`;
    }
  }
}

function setXP(total) {
  const prev = state.memoryTotal;
  state.memoryTotal = total;
  const level = Math.floor(total / 10);
  const within = total % 10;
  $("#xpLevel").textContent = `Lv ${level}`;
  $("#xpCount").textContent = `${total} memor${total === 1 ? "y" : "ies"}`;
  $("#xpFill").style.width = `${within * 10}%`;
  $("#xpBar").setAttribute("aria-valuenow", String(within));
  if (prev !== null && total > prev) {
    const pop = document.createElement("span");
    pop.className = "xp-pop";
    pop.textContent = `+${total - prev}`;
    $(".xp").appendChild(pop);
    setTimeout(() => pop.remove(), 1500);
  }
}

async function seed() {
  if (!haveKeys({ needLLM: false })) return;
  const btn = $("#seedBtn");
  btn.disabled = true;
  try {
    const hs = hindsight();
    btn.textContent = "Creating bank…";
    await hs.ensureBank();
    btn.textContent = "Sending reviews…";
    await hs.retain(SEED_REVIEWS.map(seedToRetainItem), { async: true });
    // Wait for Hindsight to finish extracting facts in the background.
    const started = Date.now();
    while (Date.now() - started < 240000) {
      await new Promise((r) => setTimeout(r, 3000));
      let pending = 0;
      try {
        const s = await hs.stats();
        pending = s?.pending_operations ?? 0;
      } catch { pending = 0; }
      btn.textContent = pending ? `Learning… ${pending} left` : "Almost done…";
      await refreshMemories();
      if (!pending) break;
    }
    completeQuest("seed");
    toast(`Learned ${SEED_REVIEWS.length} past reviews from the ${TEAM.name} team.`);
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = "Teach team history";
  }
}

async function resetMemory() {
  if (!haveKeys({ needLLM: false })) return;
  if (!confirm(`Delete every memory in bank "${settings.hsBank}"? This cannot be undone.`)) return;
  try {
    await hindsight().clearMemories();
    state.verdicts = {};
    store.set("verdicts", {});
    state.quest = { keys: state.quest.keys };
    store.set("quest", state.quest);
    renderQuest();
    state.results = {};
    renderResults();
    renderDiff();
    $("#playbook").hidden = true;
    await refreshMemories();
    toast("Memory cleared. Blockwise is a stranger to this team again.");
  } catch (err) {
    toast(err.message, true);
  }
}

async function reflect() {
  if (!haveKeys({ needLLM: false })) return;
  const btn = $("#reflectBtn");
  btn.disabled = true;
  btn.textContent = "Reflecting…";
  try {
    const text = await hindsight().reflect(
      "Write this team's code review playbook as short markdown sections: 1) conventions we enforce, with the reason and PR number; 2) suggestions we have rejected and why; 3) recurring mistakes by developer. Be concise.",
      { budget: "mid" }
    );
    const pb = $("#playbook");
    pb.innerHTML = miniMarkdown(text || "Hindsight has nothing to reflect on yet.");
    pb.hidden = false;
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = "Write playbook";
  }
}

function miniMarkdown(md) {
  const lines = esc(md).split("\n");
  let html = "";
  let inList = false;
  const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>");
  for (const raw of lines) {
    const line = raw.trimEnd();
    const li = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/);
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (li) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${inline(li[1])}</li>`;
      continue;
    }
    if (inList) { html += "</ul>"; inList = false; }
    if (h) html += `<h3>${inline(h[2])}</h3>`;
    else if (line.trim()) html += `<p>${inline(line)}</p>`;
  }
  if (inList) html += "</ul>";
  return html;
}

// ---------- Activity log ----------
function addLog({ op, ok, ms, detail }) {
  if (["list", "stats"].includes(op) && ok) return; // keep the log about memory work
  const li = document.createElement("li");
  const t = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  li.innerHTML = `<span class="op ${ok ? op : "err"}">${esc(op)}</span><span>${esc(detail || "")}${
    ms !== undefined ? ` · ${ms} ms` : ""
  }<br><time>${t}</time></span>`;
  $("#log").prepend(li);
}

// ---------- Quest ----------
function completeQuest(step) {
  state.quest[step] = true;
  store.set("quest", state.quest);
  renderQuest();
}
function renderQuest() {
  document.querySelectorAll("#quest li").forEach((li) => li.classList.toggle("done", !!state.quest[li.dataset.step]));
}

// ---------- Settings dialog ----------
function openSettings() {
  const f = $("#settingsForm");
  for (const k of Object.keys(DEFAULTS)) if (f[k]) f[k].value = settings[k] ?? "";
  $("#settings").showModal();
}
$("#settings").addEventListener("close", () => {
  if ($("#settings").returnValue !== "save") return;
  const f = $("#settingsForm");
  for (const k of Object.keys(DEFAULTS)) if (f[k]) settings[k] = f[k].value.trim() || DEFAULTS[k];
  store.set("settings", settings);
  if (settings.llmKey && settings.hsUrl) completeQuest("keys");
  toast("Settings saved.");
  refreshMemories();
});

// ---------- Custom PR dialog ----------
$("#customDlg").addEventListener("close", () => {
  if ($("#customDlg").returnValue !== "save") return;
  const pr = {
    pr: Math.max(...state.prs.map((p) => p.pr)) + 1,
    title: $("#cTitle").value.trim(),
    author: $("#cAuthor").value.trim(),
    date: new Date().toISOString(),
    note: "Your own diff.",
    diff: $("#cDiff").value.replace(/\r/g, ""),
  };
  if (!pr.title || !pr.diff) return;
  state.prs.push(pr);
  store.set("customPrs", state.prs.filter((p) => !DEMO_PRS.some((d) => d.pr === p.pr)));
  $("#customForm").reset();
  selectPr(pr.pr);
});

// ---------- Toast ----------
let toastTimer;
function toast(msg, isError = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast" + (isError ? " err" : "");
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), isError ? 7000 : 3500);
}

// ---------- Wiring ----------
function init() {
  applyTextures();
  $("#logo").innerHTML = LOGO;
  $("#authors").innerHTML = TEAM.developers.map((d) => `<option value="${esc(d)}"></option>`).join("");

  document.querySelectorAll("[data-mode]").forEach((b) =>
    b.addEventListener("click", () => {
      state.mode = b.dataset.mode;
      document.querySelectorAll("[data-mode]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    })
  );
  document.querySelectorAll("[data-tab]").forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelectorAll("[data-tab]").forEach((x) => {
        const on = x === b;
        x.setAttribute("aria-selected", String(on));
        x.setAttribute("aria-pressed", String(on));
      });
      document.querySelectorAll("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== b.dataset.tab));
    })
  );

  $("#openSettings").addEventListener("click", openSettings);
  $("#runBtn").addEventListener("click", runReview);
  $("#seedBtn").addEventListener("click", seed);
  $("#resetBtn").addEventListener("click", resetMemory);
  $("#refreshMem").addEventListener("click", refreshMemories);
  $("#reflectBtn").addEventListener("click", reflect);

  if (settings.llmKey && settings.hsUrl) state.quest.keys = true;
  renderQuest();
  selectPr(DEMO_PRS[0].pr);
  if (settings.hsKey || settings.hsUrl !== DEFAULTS.hsUrl) refreshMemories();
  else $("#memList").innerHTML = `<li>Add your Hindsight key in Settings to see what Blockwise remembers.</li>`;
}

init();
