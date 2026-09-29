const ALLOWED_ORIGIN = "https://jonahbode.github.io";
const UPSTREAMS = {
  danbooru: "https://danbooru.donmai.us",
  hypnohub: "https://hypnohub.net",
  rule34: "https://api.rule34.xxx",
};

function response(body, status, origin) {
  const headers = new Headers({
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  });
  if (origin === ALLOWED_ORIGIN) headers.set("Access-Control-Allow-Origin", origin);
  if (body) headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(body || null, { status, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    if (origin && origin !== ALLOWED_ORIGIN) {
      return new Response("Origin not allowed", { status: 403 });
    }
    if (request.method === "OPTIONS") return response("", 204, origin);
    if (request.method !== "GET") return response('{"error":"Method not allowed"}', 405, origin);

    const params = new URLSearchParams(url.search);
    let upstream;
    if (url.pathname === "/danbooru/posts.json") {
      const limit = Number(params.get("limit") || 100);
      const page = Number(params.get("page") || 1);
      const tags = params.get("tags") || "";
      if (!Number.isInteger(limit) || limit < 1 || limit > 100 ||
          !Number.isInteger(page) || page < 1 || page > 100000) {
        return response('{"error":"Invalid limit or page"}', 400, origin);
      }
      if (tags.length > 2000 || /[\u0000-\u001f]/.test(tags)) {
        return response('{"error":"Invalid tags"}', 400, origin);
      }
      upstream = new URL("/posts.json", UPSTREAMS.danbooru);
      upstream.searchParams.set("limit", String(limit));
      upstream.searchParams.set("page", String(page));
      upstream.searchParams.set("tags", tags);
    } else {
      const match = url.pathname.match(/^\/(hypnohub|rule34)\/index\.php$/);
      if (!match) return response('{"error":"Route not found"}', 404, origin);

      const source = match[1];
      if (params.get("page") !== "dapi" || params.get("s") !== "post" || params.get("q") !== "index") {
        return response('{"error":"Only DAPI post searches are allowed"}', 400, origin);
      }
      const limit = Number(params.get("limit") || 100);
      const page = Number(params.get("pid") || 0);
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000 ||
          !Number.isInteger(page) || page < 0 || page > 100000) {
        return response('{"error":"Invalid limit or page"}', 400, origin);
      }
      const tags = params.get("tags") || "";
      if (tags.length > 2000 || /[\u0000-\u001f]/.test(tags)) {
        return response('{"error":"Invalid tags"}', 400, origin);
      }
      if (source === "hypnohub" && tags.split(/\s+/).filter(Boolean).length > 2) {
        return response('{"error":"HypnoHub allows at most two search clauses"}', 400, origin);
      }

      upstream = new URL("/index.php", UPSTREAMS[source]);
      upstream.searchParams.set("page", "dapi");
      upstream.searchParams.set("s", "post");
      upstream.searchParams.set("q", "index");
      upstream.searchParams.set("json", "1");
      upstream.searchParams.set("limit", String(limit));
      upstream.searchParams.set("pid", String(page));
      upstream.searchParams.set("tags", tags);
      if (source === "rule34" && env.RULE34_USER_ID && env.RULE34_API_KEY) {
        upstream.searchParams.set("user_id", env.RULE34_USER_ID);
        upstream.searchParams.set("api_key", env.RULE34_API_KEY);
      }
    }

    try {
      const upstreamResponse = await fetch(upstream, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(15000),
      });
      const body = await upstreamResponse.text();
      const result = response(body, upstreamResponse.status, origin);
      result.headers.set(
        "Content-Type",
        upstreamResponse.headers.get("Content-Type") || "application/json; charset=utf-8",
      );
      result.headers.set("Cache-Control", "no-store");
      return result;
    } catch {
      return response('{"error":"Upstream request failed"}', 502, origin);
    }
  },
};
