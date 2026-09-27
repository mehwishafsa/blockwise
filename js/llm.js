// OpenAI-compatible chat client. Defaults to Groq, which is fast and has a free tier.
// Handles the two failure modes that bite most often: JSON mode not being
// supported by a model, and models wrapping JSON in prose or <think> tags.

export async function chatJSON({ baseUrl, apiKey, model, system, user, temperature = 0.2 }) {
  const url = (baseUrl || "https://api.groq.com/openai/v1").replace(/\/+$/, "") + "/chat/completions";
  const messages = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  const attempts = [
    { response_format: { type: "json_object" } }, // preferred
    {}, // fallback if the model rejects JSON mode
  ];

  let lastError;
  for (const extra of attempts) {
    for (let retry = 0; retry < 2; retry++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model, messages, temperature, ...extra }),
        });
        const body = await res.json().catch(() => ({}));
        if (res.status === 401) throw new Error("The LLM provider rejected the API key. Check it in Settings.");
        if (res.status === 429) {
          await sleep(2500);
          lastError = new Error("Rate limited by the LLM provider. Wait a moment and try again.");
          continue;
        }
        if (res.status === 400 && extra.response_format) {
          lastError = new Error(body?.error?.message || "JSON mode not supported");
          break; // try the next attempt shape
        }
        if (!res.ok) throw new Error(body?.error?.message || `LLM request failed (${res.status})`);
        const text = body?.choices?.[0]?.message?.content ?? "";
        return parseJSONLoose(text);
      } catch (err) {
        lastError = err;
        if (/API key/.test(err.message)) throw err;
      }
    }
  }
  throw lastError || new Error("The LLM did not return valid JSON.");
}

export function parseJSONLoose(text) {
  const cleaned = String(text)
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/```(?:json)?/g, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("The LLM reply was not valid JSON.");
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
