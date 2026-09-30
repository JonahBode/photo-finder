const ALLOWED_ORIGIN = "https://jonahbode.github.io";
const UPSTREAMS = {
  danbooru: "https://danbooru.donmai.us",
  hypnohub: "https://hypnohub.net",
  rule34: "https://api.rule34.xxx",
  realbooru: "https://realbooru.com",
  tumblr: "https://api.tumblr.com",
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

function decodeEntities(value) {
  return value.replace(/&(?:amp|quot|#39|apos|lt|gt|#\d+|#x[0-9a-f]+);/gi, entity => {
    const named = { "&amp;": "&", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&lt;": "<", "&gt;": ">" };
    if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
    const code = entity[2].toLowerCase() === "x"
      ? parseInt(entity.slice(3, -1), 16)
      : Number(entity.slice(2, -1));
    return code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
      ? String.fromCodePoint(code)
      : entity;
  });
}

function attributes(markup) {
  const result = {};
  for (const match of markup.matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    result[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return result;
}

function decodeText(value) {
  return decodeEntities(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function listingPosts(html, limit) {
  const posts = [];
  for (const thumb of html.matchAll(/<(div|span)\b([^>]*\bclass\s*=\s*(?:"[^"]*\bthumb\b[^"]*"|'[^']*\bthumb\b[^']*')[^>]*)>([\s\S]*?)<\/\1\s*>/gi)) {
    const content = thumb[3];
    const anchor = content.match(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/i);
    if (!anchor) continue;
    const href = attributes(anchor[1]).href || "";
    const id = new URLSearchParams(href.split("?")[1] || "").get("id");
    if (!/^\d+$/.test(id || "")) continue;
    const image = anchor[2].match(/<img\b([^>]*)>/i);
    const thumbUrl = image && attributes(image[1]).src;
    if (!thumbUrl) continue;
    posts.push({ id, thumb: new URL(thumbUrl, UPSTREAMS.realbooru).href });
    if (posts.length >= limit) break;
  }
  return posts;
}

function detailPost(html, listingPost, rating) {
  const image = html.match(/<img\b([^>]*\bid\s*=\s*(?:"image"|'image')[^>]*)>/i);
  const video = html.match(/<video\b[^>]*>[\s\S]*?<source\b([^>]*)>/i);
  const fileUrl = (video && attributes(video[1]).src) || (image && attributes(image[1]).src);
  if (!fileUrl) return null;
  const tags = [];
  for (const anchor of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const classes = (attributes(anchor[1]).class || "").split(/\s+/);
    if (classes.some(name => name.startsWith("tag"))) {
      const tag = decodeText(anchor[2]);
      if (tag && !tags.includes(tag)) tags.push(tag);
    }
  }
  if (!tags.length) return null;
  return {
    id: listingPost.id,
    tags: tags.join(" "),
    rating,
    preview_url: listingPost.thumb,
    sample_url: new URL(fileUrl, UPSTREAMS.realbooru).href,
    file_url: new URL(fileUrl, UPSTREAMS.realbooru).href,
    thumb_url: listingPost.thumb,
  };
}

function tumblrPosts(payload) {
  const posts = Array.isArray(payload?.response) ? payload.response : [];
  return posts.flatMap(post => {
    const images = [];
    for (const photo of Array.isArray(post.photos) ? post.photos : []) {
      const sizes = Array.isArray(photo.alt_sizes) ? photo.alt_sizes : [];
      const preview = sizes.filter(size => size.width <= 640).sort((a, b) => b.width - a.width)[0];
      const original = photo.original_size?.url;
      if (original) images.push({ thumb: preview?.url || original, file: original });
    }
    for (const block of Array.isArray(post.content) ? post.content : []) {
      if (block.type !== "image") continue;
      for (const media of Array.isArray(block.media) ? block.media : []) {
        if (media.url) images.push({ thumb: media.url, file: media.url });
      }
    }
    const uniqueImages = [...new Map(images.map(image => [image.file, image])).values()];
    const id = String(post.id_string || post.id || "");
    if (!/^\d+$/.test(id)) return [];
    return uniqueImages.map((image, index) => ({
      id: `${id}-${index + 1}`,
      tags: (Array.isArray(post.tags) ? post.tags : []).filter(tag => typeof tag === "string").join(" "),
      score: Number.isFinite(Number(post.note_count)) ? Number(post.note_count) : 0,
      timestamp: Number.isFinite(Number(post.timestamp)) ? Number(post.timestamp) : 0,
      preview_url: image.thumb,
      file_url: image.file,
      post_url: typeof post.post_url === "string" ? post.post_url : "",
    }));
  });
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
    let scrape;
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
    } else if (url.pathname === "/tumblr/search") {
      const tag = (params.get("tag") || "").trim();
      const before = params.get("before") || "";
      const limit = Number(params.get("limit") || 20);
      if (!tag || tag.length > 80 || /[\u0000-\u001f]/.test(tag) ||
          !Number.isInteger(limit) || limit < 1 || limit > 20 ||
          (before && (!/^\d+$/.test(before) || Number(before) < 1))) {
        return response('{"error":"Invalid Tumblr tag, cursor, or limit"}', 400, origin);
      }
      if (!env?.TUMBLR_API_KEY) {
        return response('{"error":"Tumblr is not configured: set the TUMBLR_API_KEY Worker secret"}', 503, origin);
      }
      upstream = new URL("/v2/tagged", UPSTREAMS.tumblr);
      upstream.searchParams.set("tag", tag);
      upstream.searchParams.set("limit", String(limit));
      upstream.searchParams.set("api_key", env.TUMBLR_API_KEY);
      if (before) upstream.searchParams.set("before", before);
    } else if (url.pathname === "/realbooru/search") {
      const limit = Number(params.get("limit") || 8);
      const page = Number(params.get("page") || 1);
      const tags = params.get("tags") || "";
      const rating = tags.match(/(?:^|\s)rating:(safe|questionable|explicit)(?:\s|$)/)?.[1];
      if (!Number.isInteger(limit) || limit < 1 || limit > 8 ||
          !Number.isInteger(page) || page < 1 || page > 100000) {
        return response('{"error":"Realbooru scraping is limited to 8 posts per request"}', 400, origin);
      }
      if (!rating || tags.length > 2000 || /[\u0000-\u001f]/.test(tags)) {
        return response('{"error":"A valid rating and search tags are required"}', 400, origin);
      }
      const listing = new URL("/index.php", UPSTREAMS.realbooru);
      listing.searchParams.set("page", "post");
      listing.searchParams.set("s", "list");
      listing.searchParams.set("pid", String((page - 1) * 42));
      listing.searchParams.set("tags", tags);
      scrape = { listing, limit, rating };
    } else {
      const match = url.pathname.match(/^\/(hypnohub|rule34|realbooru)\/index\.php$/);
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
      if (scrape) {
        const headers = {
          Accept: "text/html",
          "User-Agent": "PhotoFinder/1.0 (GitHub Pages static app)",
        };
        const listingResponse = await fetch(scrape.listing, {
          headers,
          signal: AbortSignal.timeout(15000),
          cf: { cacheEverything: true, cacheTtl: 30 },
        });
        if (!listingResponse.ok) {
          return response(JSON.stringify({ error: `Realbooru listing returned HTTP ${listingResponse.status}` }), 502, origin);
        }
        const candidates = listingPosts(await listingResponse.text(), scrape.limit);
        const posts = [];
        for (let i = 0; i < candidates.length; i++) {
          const candidate = candidates[i];
          try {
            const postUrl = new URL("/index.php", UPSTREAMS.realbooru);
            postUrl.searchParams.set("page", "post");
            postUrl.searchParams.set("s", "view");
            postUrl.searchParams.set("id", candidate.id);
            const postResponse = await fetch(postUrl, {
              headers,
              signal: AbortSignal.timeout(15000),
              cf: { cacheEverything: true, cacheTtl: 3600 },
            });
            if (postResponse.ok) {
              const post = detailPost(await postResponse.text(), candidate, scrape.rating);
              if (post) posts.push(post);
            }
          } catch {
            // Skip an individual post if it disappears or cannot be fetched.
          }
          if (i < candidates.length - 1) await new Promise(resolve => setTimeout(resolve, 500));
        }
        const result = response(JSON.stringify(posts), 200, origin);
        result.headers.set("Cache-Control", "public, max-age=30");
        return result;
      }
      const upstreamResponse = await fetch(upstream, {
        headers: {
          Accept: "application/json",
          "User-Agent": "PhotoFinder/1.0 (GitHub Pages static app)",
        },
        signal: AbortSignal.timeout(15000),
        ...(url.pathname === "/tumblr/search" ? { cf: { cacheEverything: true, cacheTtl: 60 } } : {}),
      });
      const body = await upstreamResponse.text();
      let resultBody = body;
      let status = upstreamResponse.status;
      if (url.pathname === "/tumblr/search") {
        if (!upstreamResponse.ok) {
          resultBody = JSON.stringify({ error: `Tumblr API returned HTTP ${upstreamResponse.status}` });
          status = upstreamResponse.status === 429 ? 429 : 502;
        } else {
          try {
            const payload = JSON.parse(body);
            if (payload?.meta?.status >= 400) {
              resultBody = JSON.stringify({ error: `Tumblr API returned HTTP ${payload.meta.status}` });
              status = payload.meta.status === 429 ? 429 : 502;
            } else {
              resultBody = JSON.stringify(tumblrPosts(payload));
            }
          } catch {
            resultBody = '{"error":"Tumblr API returned invalid JSON"}';
            status = 502;
          }
        }
      }
      const result = response(resultBody, status, origin);
      result.headers.set(
        "Content-Type",
        upstreamResponse.headers.get("Content-Type") || "application/json; charset=utf-8",
      );
      result.headers.set("Cache-Control", url.pathname === "/tumblr/search" && status === 200
        ? "public, max-age=60"
        : "no-store");
      return result;
    } catch {
      return response('{"error":"Upstream request failed"}', 502, origin);
    }
  },
};
