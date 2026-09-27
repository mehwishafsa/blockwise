// Minimal Hindsight HTTP client for the browser.
// Docs: https://hindsight.vectorize.io/api-reference
// Every call is reported through onLog so the UI can show memory activity live.

export class HindsightError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export class Hindsight {
  constructor({ baseUrl, apiKey, bankId, onLog = () => {} }) {
    this.baseUrl = (baseUrl || "https://api.hindsight.vectorize.io").replace(/\/+$/, "");
    this.apiKey = apiKey;
    this.bankId = bankId;
    this.onLog = onLog;
  }

  get bankPath() {
    return `/v1/default/banks/${encodeURIComponent(this.bankId)}`;
  }

  async request(method, path, body, label) {
    const started = performance.now();
    let res;
    try {
      res = await fetch(this.baseUrl + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      this.onLog({ op: label, ok: false, detail: "Network or CORS error" });
      throw new HindsightError(
        "Could not reach Hindsight. Check the API URL, or deploy the CORS proxy in /proxy and use its URL.",
        0
      );
    }
    const ms = Math.round(performance.now() - started);
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      const detail = typeof data === "object" && data ? JSON.stringify(data.detail ?? data) : String(data);
      this.onLog({ op: label, ok: false, ms, detail: `HTTP ${res.status}` });
      if (res.status === 401 || res.status === 403) {
        throw new HindsightError("Hindsight rejected the API key. Paste a valid key in Settings.", res.status);
      }
      throw new HindsightError(`Hindsight returned ${res.status}: ${detail.slice(0, 200)}`, res.status);
    }
    return { data, ms };
  }

  // Create or update the bank and steer what Hindsight extracts from reviews.
  async ensureBank() {
    const body = {
      retain_mission:
        "This bank belongs to a code review agent for one engineering team. Extract team coding conventions, " +
        "architectural rules, the reason behind each rule, suggestions the team rejected and why, and recurring " +
        "mistakes made by specific developers. Keep file paths, helper names and PR numbers. Ignore pleasantries.",
      reflect_mission:
        "You are the long-term memory of a senior code reviewer. Answer with the team's actual conventions, " +
        "rejected suggestions and per-developer patterns, citing PR numbers when known.",
    };
    const { data, ms } = await this.request("PUT", this.bankPath, body, "bank");
    this.onLog({ op: "bank", ok: true, ms, detail: `Bank "${this.bankId}" ready` });
    return data;
  }

  // RETAIN: store raw content; Hindsight extracts facts, entities and links.
  async retain(items, { async = false } = {}) {
    const { data, ms } = await this.request("POST", `${this.bankPath}/memories`, { items, async }, "retain");
    this.onLog({
      op: "retain",
      ok: true,
      ms,
      detail: `${items.length} item${items.length === 1 ? "" : "s"}${async ? " queued" : " stored"}`,
    });
    return data;
  }

  // RECALL: semantic + keyword + graph + temporal retrieval, reranked.
  async recall(query, { tags, tagsMatch = "any", budget = "mid", maxTokens = 2048 } = {}) {
    const body = { query, budget, max_tokens: maxTokens };
    if (tags && tags.length) {
      body.tags = tags;
      body.tags_match = tagsMatch;
    }
    const { data, ms } = await this.request("POST", `${this.bankPath}/memories/recall`, body, "recall");
    const results = data?.results ?? [];
    this.onLog({ op: "recall", ok: true, ms, detail: `${results.length} memories for "${truncate(query, 60)}"` });
    return results;
  }

  // REFLECT: let Hindsight reason over everything it has learned.
  async reflect(query, { budget = "mid" } = {}) {
    const { data, ms } = await this.request("POST", `${this.bankPath}/reflect`, { query, budget }, "reflect");
    this.onLog({ op: "reflect", ok: true, ms, detail: "Synthesized team playbook" });
    return data?.text ?? "";
  }

  async listMemories({ limit = 60 } = {}) {
    const { data } = await this.request("GET", `${this.bankPath}/memories/list?limit=${limit}`, undefined, "list");
    return { items: data?.items ?? [], total: data?.total ?? 0 };
  }

  async stats() {
    const { data } = await this.request("GET", `${this.bankPath}/stats`, undefined, "stats");
    return data;
  }

  async clearMemories() {
    const { ms } = await this.request("DELETE", `${this.bankPath}/memories`, undefined, "clear");
    this.onLog({ op: "clear", ok: true, ms, detail: "All memories deleted" });
  }
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
