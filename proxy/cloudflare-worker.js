// Optional CORS proxy for Hindsight Cloud.
// Use this only if the browser blocks direct calls to api.hindsight.vectorize.io
// (you will see "Could not reach Hindsight" in Blockwise).
//
// Deploy (free): dash.cloudflare.com > Workers & Pages > Create > "Hello World" worker,
// paste this file, Deploy, then put the worker URL in Blockwise Settings > Hindsight API URL.
// Optional: set a variable ALLOWED_ORIGIN = https://<your-user>.github.io to lock it down.

const UPSTREAM = "https://api.hindsight.vectorize.io";

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "*";
    const allowed = env.ALLOWED_ORIGIN || "*";
    const cors = {
      "Access-Control-Allow-Origin": allowed === "*" ? "*" : allowed,
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Max-Age": "86400",
    };
    if (allowed !== "*" && origin !== allowed) {
      return new Response("Origin not allowed", { status: 403, headers: cors });
    }
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    if (!url.pathname.startsWith("/v1/")) return new Response("Not found", { status: 404, headers: cors });

    const upstream = await fetch(UPSTREAM + url.pathname + url.search, {
      method: request.method,
      headers: {
        "Content-Type": "application/json",
        ...(request.headers.get("Authorization") ? { Authorization: request.headers.get("Authorization") } : {}),
      },
      body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.text(),
    });
    const headers = new Headers(upstream.headers);
    Object.entries(cors).forEach(([k, v]) => headers.set(k, v));
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
