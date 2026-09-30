import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./worker.js", import.meta.url), "utf8");
const { default: worker } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);
const allowedOrigin = "https://jonahbode.github.io";
const request = (path, options = {}) => new Request(`https://worker.test${path}`, options);

test("proxies validated Danbooru API requests to its fixed origin", async () => {
  const originalFetch = globalThis.fetch;
  let upstream;
  globalThis.fetch = async url => {
    upstream = new URL(url);
    return new Response('[{"id":123}]', {
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const result = await worker.fetch(request(
      "/danbooru/posts.json?limit=50&page=2&tags=league_of_legends+rating%3Ag",
      { headers: { Origin: allowedOrigin } },
    ), {});
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("Access-Control-Allow-Origin"), allowedOrigin);
    assert.equal(upstream.origin, "https://danbooru.donmai.us");
    assert.equal(upstream.pathname, "/posts.json");
    assert.equal(upstream.searchParams.get("limit"), "50");
    assert.equal(upstream.searchParams.get("page"), "2");
    assert.equal(upstream.searchParams.get("tags"), "league_of_legends rating:g");
    assert.deepEqual(await result.json(), [{ id: 123 }]);

    const invalidPage = await worker.fetch(request(
      "/danbooru/posts.json?limit=101&page=0&tags=pokemon",
      { headers: { Origin: allowedOrigin } },
    ), {});
    assert.equal(invalidPage.status, 400);
    assert.equal((await worker.fetch(request(
      "/danbooru/other.json",
      { headers: { Origin: allowedOrigin } },
    ), {})).status, 404);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("proxies a HypnoHub request, preserving CORS and enforcing its two-clause cap", async () => {
  const originalFetch = globalThis.fetch;
  let upstream;
  globalThis.fetch = async (url) => {
    upstream = new URL(url);
    return new Response('[{"id":"123"}]', {
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const result = await worker.fetch(request(
      "/hypnohub/index.php?page=dapi&s=post&q=index&limit=100&pid=0&tags=pikachu+rating%3Asafe",
      { headers: { Origin: allowedOrigin } },
    ), {});
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("Access-Control-Allow-Origin"), allowedOrigin);
    assert.equal(upstream.origin, "https://hypnohub.net");
    assert.equal(upstream.searchParams.get("tags"), "pikachu rating:safe");
    assert.deepEqual(await result.json(), [{ id: "123" }]);

    const tooMany = await worker.fetch(request(
      "/hypnohub/index.php?page=dapi&s=post&q=index&tags=pikachu+pokemon+rating%3Asafe",
      { headers: { Origin: allowedOrigin } },
    ), {});
    assert.equal(tooMany.status, 400);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("forwards optional Rule34 credentials only to its fixed upstream", async () => {
  const originalFetch = globalThis.fetch;
  let upstream;
  globalThis.fetch = async (url) => {
    upstream = new URL(url);
    return new Response("[]");
  };
  try {
    const result = await worker.fetch(request(
      "/rule34/index.php?page=dapi&s=post&q=index&limit=5&tags=pikachu",
      { headers: { Origin: allowedOrigin } },
    ), { RULE34_USER_ID: "test-user", RULE34_API_KEY: "placeholder-key" });
    assert.equal(result.status, 200);
    assert.equal(upstream.origin, "https://api.rule34.xxx");
    assert.equal(upstream.searchParams.get("user_id"), "test-user");
    assert.equal(upstream.searchParams.get("api_key"), "placeholder-key");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("proxies Realbooru DAPI requests to its fixed origin", async () => {
  const originalFetch = globalThis.fetch;
  let upstream;
  globalThis.fetch = async url => {
    upstream = new URL(url);
    return new Response('[{"id":123}]', {
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const result = await worker.fetch(request(
      "/realbooru/index.php?page=dapi&s=post&q=index&json=1&limit=20&pid=3&tags=pikachu+cid%3A%3E%3D1785542400",
      { headers: { Origin: allowedOrigin } },
    ), {});
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("Access-Control-Allow-Origin"), allowedOrigin);
    assert.equal(upstream.origin, "https://realbooru.com");
    assert.equal(upstream.pathname, "/index.php");
    assert.equal(upstream.searchParams.get("limit"), "20");
    assert.equal(upstream.searchParams.get("pid"), "3");
    assert.equal(upstream.searchParams.get("tags"), "pikachu cid:>=1785542400");
    assert.deepEqual(await result.json(), [{ id: 123 }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("handles preflight and rejects disallowed origins, methods, and routes", async () => {
  const preflight = await worker.fetch(request("/hypnohub/index.php", {
    method: "OPTIONS",
    headers: { Origin: allowedOrigin },
  }), {});
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), allowedOrigin);

  assert.equal((await worker.fetch(request("/rule34/index.php?page=dapi&s=post&q=index", {
    headers: { Origin: "https://untrusted.example" },
  }), {})).status, 403);
  assert.equal((await worker.fetch(request("/unknown", {
    headers: { Origin: allowedOrigin },
  }), {})).status, 404);
  assert.equal((await worker.fetch(request("/rule34/index.php?page=dapi&s=post&q=index", {
    method: "POST",
    headers: { Origin: allowedOrigin },
  }), {})).status, 405);
});

test("validates API limits and reports upstream errors", async () => {
  const invalidLimit = await worker.fetch(request(
    "/rule34/index.php?page=dapi&s=post&q=index&limit=1001",
    { headers: { Origin: allowedOrigin } },
  ), {});
  assert.equal(invalidLimit.status, 400);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{"error":"upstream"}', { status: 503 });
  try {
    const upstreamError = await worker.fetch(request(
      "/rule34/index.php?page=dapi&s=post&q=index&limit=10",
      { headers: { Origin: allowedOrigin } },
    ), {});
    assert.equal(upstreamError.status, 503);
    assert.deepEqual(await upstreamError.json(), { error: "upstream" });

    globalThis.fetch = async () => { throw new Error("network unavailable"); };
    const networkError = await worker.fetch(request(
      "/hypnohub/index.php?page=dapi&s=post&q=index&tags=pokemon",
      { headers: { Origin: allowedOrigin } },
    ), {});
    assert.equal(networkError.status, 502);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
