const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_REQUEST_BYTES = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 2048;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const TUMBLR_TAGS_PER_IMAGE = 5;
const MAX_TUMBLR_POSTS = 8;

function json(body, status, origin, allowedOrigin) {
  const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
  if (origin && origin === allowedOrigin) {
    headers["Access-Control-Allow-Origin"] = allowedOrigin;
    headers["Vary"] = "Origin";
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function decodeImage(image, mimeType) {
  if (!ALLOWED_TYPES.has(mimeType) || typeof image !== "string") throw new Error("Choose a supported JPEG, PNG, GIF, or WebP image.");
  const maxEncodedLength = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;
  if (!image.length || image.length > maxEncodedLength || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image)) {
    throw new Error("Image must be non-empty and no larger than 8 MiB.");
  }
  let binary;
  try { binary = atob(image); } catch { throw new Error("Image data is invalid."); }
  if (!binary.length || binary.length > MAX_IMAGE_BYTES) throw new Error("Image must be non-empty and no larger than 8 MiB.");
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  const ascii = (start, end) => String.fromCharCode(...bytes.slice(start, end));
  const valid = mimeType === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 :
    mimeType === "image/png" ? ascii(0, 4) === "\x89PNG" && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10 :
    mimeType === "image/gif" ? ["GIF87a", "GIF89a"].includes(ascii(0, 6)) :
    ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
  if (!valid) throw new Error("Image contents do not match the declared image type.");
  return image;
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : "";
  } catch { return ""; }
}

function safeDimension(value) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function mediaFromPost(post) {
  const media = [];
  for (const photo of Array.isArray(post.photos) ? post.photos : []) {
    const original = photo.original_size || {};
    const url = safeHttpsUrl(original.url);
    if (url) media.push({
      url,
      width: safeDimension(original.width),
      height: safeDimension(original.height),
      caption: typeof photo.caption === "string" ? photo.caption.slice(0, 300) : ""
    });
  }
  for (const block of Array.isArray(post.content) ? post.content : []) {
    if (block.type !== "image" || !Array.isArray(block.media)) continue;
    for (const item of block.media) {
      const url = safeHttpsUrl(item.url);
      if (url) media.push({
        url,
        width: safeDimension(item.width),
        height: safeDimension(item.height),
        caption: typeof block.alt_text === "string" ? block.alt_text.slice(0, 300) : ""
      });
    }
  }
  return media.slice(0, 4);
}

async function searchTumblr(keywords, apiKey, fetcher) {
  if (!apiKey) return { status: "not-configured", posts: [] };
  if (!keywords.length) return { status: "configured", posts: [] };
  const results = new Map();
  let failures = 0;
  for (const keyword of keywords.slice(0, TUMBLR_TAGS_PER_IMAGE)) {
    const url = new URL("https://api.tumblr.com/v2/tagged");
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("tag", keyword);
    try {
      const response = await fetcher(url, { headers: { Accept: "application/json" } });
      if (!response.ok) { failures++; continue; }
      const payload = await response.json();
      const posts = Array.isArray(payload.response) ? payload.response : [];
      for (const post of posts) {
        const postUrl = safeHttpsUrl(post.post_url);
        if (!postUrl || !post.blog_name) continue;
        const current = results.get(postUrl) || {
          blogName: String(post.blog_name).slice(0, 120),
          blogUrl: `https://www.tumblr.com/${encodeURIComponent(String(post.blog_name))}`,
          postUrl,
          summary: typeof post.summary === "string" ? post.summary.slice(0, 500) : "",
          matchedKeywords: [],
          media: mediaFromPost(post)
        };
        if (!current.matchedKeywords.includes(keyword)) current.matchedKeywords.push(keyword);
        results.set(postUrl, current);
      }
    } catch { failures++; }
  }
  return {
    status: failures === keywords.length ? "error" : failures ? "partial" : "configured",
    message: failures ? "Some Tumblr keyword searches could not be completed." : "",
    posts: [...results.values()].slice(0, MAX_TUMBLR_POSTS)
  };
}

async function annotateWithVision(image, apiKey, fetcher) {
  const url = new URL("https://vision.googleapis.com/v1/images:annotate");
  url.searchParams.set("key", apiKey);
  const response = await fetcher(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [{
        image: { content: image },
        features: [{ type: "LABEL_DETECTION", maxResults: 8 }]
      }]
    })
  });
  if (!response.ok) throw new Error(`Image annotation provider returned HTTP ${response.status}.`);
  const payload = await response.json();
  if (payload.responses?.[0]?.error) throw new Error("Image annotation provider could not process this image.");
  const labels = payload.responses?.[0]?.labelAnnotations;
  const keywords = Array.isArray(labels) ? labels
    .map(label => typeof label.description === "string" ? label.description.trim() : "")
    .filter(Boolean).slice(0, TUMBLR_TAGS_PER_IMAGE) : [];
  const description = keywords.length
    ? `Likely visible content: ${keywords.join(", ")}. These are automated labels, not a verified identity.`
    : "The image service returned no useful labels.";
  return { description, keywords };
}

async function readJson(request) {
  if (!request.body) throw new Error("Request must contain valid JSON.");
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_REQUEST_BYTES) {
      await reader.cancel().catch(() => {});
      const error = new Error("Image must be no larger than 8 MiB.");
      error.status = 413;
      throw error;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new Error("Request must contain valid JSON."); }
}

export async function handleRequest(request, env, fetcher = fetch) {
  const origin = request.headers.get("Origin");
  const allowedOrigin = env.APP_ORIGIN;
  if (!allowedOrigin) return json({ error: "Annotation Worker setup is incomplete: set APP_ORIGIN." }, 503, origin, allowedOrigin);
  if (origin !== allowedOrigin) return json({ error: "This origin is not allowed." }, 403, origin, allowedOrigin);
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": allowedOrigin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin"
      }
    });
  }
  const url = new URL(request.url);
  if (url.pathname !== "/annotate" || request.method !== "POST") return json({ error: "Not found." }, 404, origin, allowedOrigin);
  if (!env.GOOGLE_CLOUD_VISION_API_KEY) {
    return json({ error: "Image annotation is not configured. Add GOOGLE_CLOUD_VISION_API_KEY to the Worker secrets." }, 503, origin, allowedOrigin);
  }
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > MAX_REQUEST_BYTES) return json({ error: "Image must be no larger than 8 MiB." }, 413, origin, allowedOrigin);
  let input;
  try { input = await readJson(request); }
  catch (error) { return json({ error: error.message }, error.status || 400, origin, allowedOrigin); }
  let image;
  try { image = decodeImage(input?.image, input?.mimeType); }
  catch (error) { return json({ error: error.message }, 400, origin, allowedOrigin); }
  try {
    const annotation = await annotateWithVision(image, env.GOOGLE_CLOUD_VISION_API_KEY, fetcher);
    const tumblr = await searchTumblr(annotation.keywords, env.TUMBLR_API_KEY, fetcher);
    return json({ ...annotation, tumblr }, 200, origin, allowedOrigin);
  } catch (error) {
    return json({ error: error.message || "Image annotation provider failed." }, 502, origin, allowedOrigin);
  }
}

export default { fetch: handleRequest };
