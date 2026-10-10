import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "./annotation-worker.mjs";

const origin = "https://photos.example";
const env = {
  APP_ORIGIN: origin,
  GOOGLE_CLOUD_VISION_API_KEY: "vision-test-key",
  TUMBLR_API_KEY: "tumblr-test-key"
};
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64");

function request(body, extra = {}) {
  return new Request("https://worker.example/annotate", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json", ...extra },
    body: JSON.stringify(body)
  });
}

test("labels an image and uses official Tumblr tagged search with source attribution", async () => {
  const requestedUrls = [];
  const fetcher = async (url, options) => {
    const parsed = new URL(url);
    requestedUrls.push(parsed);
    if (parsed.hostname === "vision.googleapis.com") {
      return Response.json({ responses: [{ labelAnnotations: [
        { description: "Sunset", score: 0.98 },
        { description: "Ocean", score: 0.92 }
      ] }] });
    }
    assert.equal(parsed.pathname, "/v2/tagged");
    assert.equal(parsed.searchParams.get("api_key"), env.TUMBLR_API_KEY);
    assert.equal(options.headers.Accept, "application/json");
    return Response.json({ response: [{
      blog_name: "sample-blog",
      post_url: "https://sample-blog.tumblr.com/post/123/photo",
      summary: "A sunset over the ocean",
      photos: [{ caption: "Evening light", original_size: { url: "https://64.media.tumblr.com/image.jpg", width: 1200, height: 800 } }]
    }] });
  };

  const response = await handleRequest(request({ mimeType: "image/jpeg", image: jpeg }), env, fetcher);
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.match(result.description, /automated labels, not a verified identity/);
  assert.deepEqual(result.keywords, ["Sunset", "Ocean"]);
  assert.equal(result.tumblr.posts[0].blogName, "sample-blog");
  assert.equal(result.tumblr.posts[0].blogUrl, "https://www.tumblr.com/sample-blog");
  assert.equal(result.tumblr.posts[0].postUrl, "https://sample-blog.tumblr.com/post/123/photo");
  assert.equal(result.tumblr.posts[0].matchedKeywords.length, 2);
  assert.deepEqual(result.tumblr.posts[0].media[0], {
    url: "https://64.media.tumblr.com/image.jpg",
    width: 1200,
    height: 800,
    caption: "Evening light"
  });
  assert.equal(requestedUrls.filter(url => url.hostname === "api.tumblr.com").length, 2);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
});

test("rejects mismatched origins before calling providers", async () => {
  let called = false;
  const response = await handleRequest(new Request("https://worker.example/annotate", {
    method: "POST", headers: { Origin: "https://attacker.example", "Content-Type": "application/json" }, body: "{}"
  }), env, async () => { called = true; });
  assert.equal(response.status, 403);
  assert.equal(called, false);
});

test("returns useful setup guidance when image credentials are absent", async () => {
  const response = await handleRequest(request({ mimeType: "image/jpeg", image: jpeg }), {
    APP_ORIGIN: origin
  });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /GOOGLE_CLOUD_VISION_API_KEY/);
});

test("rejects mismatched image signatures without calling providers", async () => {
  let called = false;
  const response = await handleRequest(request({
    mimeType: "image/png",
    image: jpeg
  }), env, async () => { called = true; });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /contents do not match/);
  assert.equal(called, false);
});

test("Tumblr is optional and does not invent posts when unconfigured", async () => {
  const fetcher = async () => Response.json({ responses: [{ labelAnnotations: [{ description: "Portrait" }] }] });
  const response = await handleRequest(request({ mimeType: "image/jpeg", image: jpeg }), {
    ...env,
    TUMBLR_API_KEY: undefined
  }, fetcher);
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.tumblr.status, "not-configured");
  assert.deepEqual(result.tumblr.posts, []);
});

test("does not search Tumblr when the label provider returns no keywords", async () => {
  let tumblrCalled = false;
  const fetcher = async url => {
    if (new URL(url).hostname === "api.tumblr.com") tumblrCalled = true;
    return Response.json({ responses: [{ labelAnnotations: [] }] });
  };
  const response = await handleRequest(request({ mimeType: "image/jpeg", image: jpeg }), env, fetcher);
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.tumblr.status, "configured");
  assert.deepEqual(result.tumblr.posts, []);
  assert.equal(tumblrCalled, false);
});

test("reports provider-level annotation errors instead of returning fabricated labels", async () => {
  const fetcher = async () => Response.json({ responses: [{ error: { message: "invalid image" } }] });
  const response = await handleRequest(request({ mimeType: "image/jpeg", image: jpeg }), env, fetcher);
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /could not process this image/);
});

test("reports Tumblr API errors instead of claiming there are no related posts", async () => {
  const fetcher = async url => {
    if (new URL(url).hostname === "vision.googleapis.com") {
      return Response.json({ responses: [{ labelAnnotations: [{ description: "Portrait" }] }] });
    }
    return Response.json({ meta: { status: 401 }, errors: ["Unauthorized"] });
  };
  const response = await handleRequest(request({ mimeType: "image/jpeg", image: jpeg }), env, fetcher);
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.tumblr.status, "error");
  assert.equal(result.tumblr.posts.length, 0);
  assert.match(result.tumblr.message, /Some Tumblr keyword searches/);
});
