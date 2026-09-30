import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
const script = html.slice(html.indexOf("<script>") + 8, html.indexOf("</script>"));
const searchStart = script.indexOf("async function search");
const searchEnd = script.indexOf("const jac=", searchStart);
const searchSource = script.slice(searchStart, searchEnd);
const rankStart = script.indexOf("function rank");
const rankEnd = script.indexOf("function card", rankStart);
const rankSource = script.slice(rankStart, rankEnd);
const jgetStart = script.indexOf("async function jget");
const jgetEnd = script.indexOf("const hasRequiredTags", jgetStart);
const jgetSource = script.slice(jgetStart, jgetEnd);

test("HypnoHub searches obey the two-clause limit and require every included tag", async () => {
  const requested = [];
  const included = ["pikachu", "shiny_pokemon", "blue_eyes"];
  const posts = [
    { id: 1, tags: included.concat("solo").join(" "), rating: "safe", score: 10, preview_url: "https://img.test/1.jpg" },
    { id: 2, tags: "pikachu shiny_pokemon solo", rating: "safe", score: 10, preview_url: "https://img.test/2.jpg" },
  ];
  const context = {
    cfg: { src: "hypnohub", rating: "safe", minScore: 0, since: "" },
    customTags: included,
    excludedTags: ["gore"],
    BASE: { hypnohub: "https://hypnohub.net" },
    API_BASE: { hypnohub: "https://photo-finder.jojochess101.workers.dev/hypnohub" },
    POST_BASE: { hypnohub: "https://hypnohub.net" },
    hasRequiredTags: tags => included.every(tag => tags.includes(tag)),
    queryTags: () => "",
    jget: async url => {
      requested.push(new URL(url));
      return posts;
    },
  };
  vm.createContext(context);
  vm.runInContext(`${searchSource}; globalThis.searchPost = search;`, context);

  const results = [];
  for (const tag of included) results.push(...await context.searchPost(tag, 1, 100));

  assert.equal(requested.length, included.length);
  for (const url of requested) {
    const terms = url.searchParams.get("tags").split(/\s+/);
    assert.equal(terms.length, 2);
    assert.ok(terms.includes("rating:safe"));
    assert.ok(included.includes(terms.find(term => term != "rating:safe")));
    assert.ok(!terms.includes("-gore"));
  }
  assert.ok(results.length > 0);
  assert.ok(results.every(post => included.every(tag => post.tags.includes(tag))));
  assert.ok(results.every(post => post.id == "h1"));
});

test("topic tags replace Pokémon across sources and blank topic searches broadly", async () => {
  for (const source of ["danbooru", "safebooru", "hypnohub", "rule34", "realbooru"]) {
    for (const topic of ["league_of_legends", ""]) {
      const requested = [];
      const context = {
        cfg: { src: source, topic, rating: source === "danbooru" ? "g" : "safe", minScore: 0, since: "" },
        customTags: [],
        excludedTags: [],
        API_BASE: {
          danbooru: "https://photo-finder.jojochess101.workers.dev/danbooru",
          safebooru: "https://safebooru.org",
          hypnohub: "https://photo-finder.jojochess101.workers.dev/hypnohub",
          rule34: "https://photo-finder.jojochess101.workers.dev/rule34",
          realbooru: "https://photo-finder.jojochess101.workers.dev/realbooru",
        },
        BASE: {
          danbooru: "https://danbooru.donmai.us",
          safebooru: "https://safebooru.org",
          hypnohub: "https://hypnohub.net",
          rule34: "https://api.rule34.xxx",
          realbooru: "https://realbooru.com",
        },
        POST_BASE: {
          danbooru: "https://danbooru.donmai.us",
          safebooru: "https://safebooru.org",
          hypnohub: "https://hypnohub.net",
          rule34: "https://rule34.xxx",
          realbooru: "https://realbooru.com",
        },
        hasRequiredTags: () => true,
        queryTags: (seed, base) => [...new Set([base, seed && seed !== topic ? seed : ""].filter(Boolean))].join(" "),
        jget: async url => {
          requested.push(new URL(url));
          return [];
        },
      };
      vm.createContext(context);
      vm.runInContext(`${searchSource}; globalThis.searchPost = search;`, context);
      await context.searchPost("", 1, 10);

      assert.equal(requested.length, 1, `${source}, topic "${topic}"`);
      const tags = requested[0].searchParams.get("tags").split(/\s+/).filter(Boolean);
      assert.equal(tags.includes("league_of_legends"), Boolean(topic), `${source}, topic "${topic}"`);
      assert.ok(!tags.includes("pokemon"), `${source}, topic "${topic}"`);
      const expectedOrigin = source === "safebooru"
        ? "https://safebooru.org"
        : "https://photo-finder.jojochess101.workers.dev";
      assert.equal(requested[0].origin, expectedOrigin, `${source}, API route`);
    }
  }
});

test("API HTML responses produce a useful diagnostic instead of a JSON parse error", async () => {
  const context = {
    cfg: { src: "danbooru" },
    fetch: async () => new Response("<!doctype html><title>Service unavailable</title>", {
      headers: { "Content-Type": "text/html" },
    }),
  };
  vm.createContext(context);
  vm.runInContext(`${jgetSource}; globalThis.getJson = jget;`, context);
  await assert.rejects(
    context.getJson("https://worker.test/realbooru/index.php"),
    /HTML page instead of JSON.*Service unavailable.*unsupported response/,
  );
});

test("Realbooru XML DAPI responses are converted into post objects", async () => {
  const attrs = {
    id: "42",
    tags: "pokemon solo",
    rating: "s",
    score: "12",
    cid: "1785542400",
    preview_url: "https://img.test/42.jpg",
  };
  const context = {
    cfg: { src: "realbooru" },
    fetch: async () => new Response(
      '<?xml version="1.0" encoding="UTF-8"?><posts count="1"><post ' +
      Object.entries(attrs).map(([key, value]) => `${key}="${value}"`).join(" ") +
      "/></posts>",
    ),
    DOMParser: class {
      parseFromString() {
        return {
          documentElement: { tagName: "posts" },
          querySelector: () => null,
          getElementsByTagName: () => [{
            attributes: Object.entries(attrs).map(([name, value]) => ({ name, value })),
          }],
        };
      }
    },
  };
  vm.createContext(context);
  vm.runInContext(`${jgetSource}; globalThis.getJson = jget;`, context);
  assert.deepEqual([...(await context.getJson("https://worker.test/realbooru")).map(post => ({ ...post }))], [attrs]);
});

test("Realbooru searches use the bounded HTML-scrape route and accept unavailable scores", async () => {
  let requested;
  const context = {
    cfg: { src: "realbooru", topic: "pokemon", rating: "safe", minScore: 50, since: "", until: "" },
    customTags: [],
    excludedTags: [],
    API_BASE: { realbooru: "https://photo-finder.jojochess101.workers.dev/realbooru" },
    BASE: { realbooru: "https://realbooru.com" },
    POST_BASE: { realbooru: "https://realbooru.com" },
    hasRequiredTags: () => true,
    queryTags: (seed, base) => [base, seed].filter(Boolean).join(" "),
    jget: async url => {
      requested = new URL(url);
      return [{
        id: "42",
        tags: "pokemon solo",
        rating: "safe",
        preview_url: "https://realbooru.com/thumb/42.jpg",
        file_url: "https://realbooru.com/images/42.jpg",
      }];
    },
  };
  vm.createContext(context);
  vm.runInContext(`${searchSource}; globalThis.searchPost = search;`, context);

  const posts = await context.searchPost("", 1, 100);
  assert.equal(requested.pathname, "/realbooru/search");
  assert.equal(requested.searchParams.get("limit"), "8");
  assert.equal(requested.searchParams.get("page"), "1");
  assert.equal(requested.searchParams.get("tags"), "pokemon rating:safe score:>=50");
  assert.deepEqual([...posts.map(post => ({ id: post.id, score: post.score, tags: [...post.tags] }))], [
    { id: "b42", score: 0, tags: ["pokemon", "solo"] },
  ]);
  assert.match(html, /Realbooru scraping fetches at most 8 post pages per search/);
  assert.match(script, /if\(cfg\.src=='realbooru'&&\(cfg\.since\|\|cfg\.until\)\)/);
});

test("Realbooru empty XML results produce an empty post list", async () => {
  const context = {
    cfg: { src: "realbooru" },
    fetch: async () => new Response('<?xml version="1.0"?><posts count="0"/>'),
    DOMParser: class {
      parseFromString() {
        return {
          documentElement: { tagName: "posts" },
          querySelector: () => null,
          getElementsByTagName: () => [],
        };
      }
    },
  };
  vm.createContext(context);
  vm.runInContext(`${jgetSource}; globalThis.getJson = jget;`, context);
  assert.deepEqual([...(await context.getJson("https://worker.test/realbooru"))], []);
});

test("malformed Realbooru XML remains a clear response-format diagnostic", async () => {
  const context = {
    cfg: { src: "realbooru" },
    fetch: async () => new Response('<?xml version="1.0"?><posts><post>'),
    DOMParser: class {
      parseFromString() {
        return {
          documentElement: { tagName: "posts" },
          querySelector: () => ({}),
          getElementsByTagName: () => [],
        };
      }
    },
  };
  vm.createContext(context);
  vm.runInContext(`${jgetSource}; globalThis.getJson = jget;`, context);
  await assert.rejects(
    context.getJson("https://worker.test/realbooru"),
    /unrecognized XML.*xml version.*unsupported response/,
  );
});

test("date range filters return only posts within both inclusive dates", async () => {
  for (const source of ["danbooru", "safebooru", "hypnohub", "rule34"]) {
    let requested;
    const cfg = {
      src: source,
      topic: "pokemon",
      rating: source === "danbooru" ? "g" : "safe",
      minScore: 0,
      since: "2026-08-01",
      until: "2026-08-31",
    };
    const boundaryDates = [
      ["1785542399", "2026-07-31"],
      ["1785542400", "2026-08-01"],
      ["1788220799", "2026-08-31"],
      ["1788220800", "2026-09-01"],
    ];
    const posts = boundaryDates.map(([timestamp, date], index) => ({
      id: index + 1,
      tags: "pokemon solo",
      tag_string: "pokemon solo",
      rating: source === "danbooru" ? "g" : "safe",
      score: 10,
      created_at: ["rule34", "hypnohub"].includes(source) ? timestamp : date,
      preview_url: `https://img.test/${index + 1}.jpg`,
      preview_file_url: `https://img.test/${index + 1}.jpg`,
      directory: String(index + 1),
      image: `${index + 1}.jpg`,
    }));
    const context = {
      cfg,
      customTags: [],
      excludedTags: [],
      API_BASE: {
        danbooru: "https://photo-finder.jojochess101.workers.dev/danbooru",
        safebooru: "https://safebooru.org",
        hypnohub: "https://photo-finder.jojochess101.workers.dev/hypnohub",
        rule34: "https://photo-finder.jojochess101.workers.dev/rule34",
      },
      BASE: {
        danbooru: "https://danbooru.donmai.us",
        safebooru: "https://safebooru.org",
        hypnohub: "https://hypnohub.net",
        rule34: "https://api.rule34.xxx",
      },
      POST_BASE: {
        danbooru: "https://danbooru.donmai.us",
        safebooru: "https://safebooru.org",
        hypnohub: "https://hypnohub.net",
        rule34: "https://rule34.xxx",
      },
      hasRequiredTags: () => true,
      queryTags: (seed, base) => [base, seed].filter(Boolean).join(" "),
      jget: async url => {
        requested = new URL(url);
        return source === "danbooru" ? posts.map(p => ({ ...p, tag_string_artist: "" }))
          : source === "safebooru" ? posts
            : posts.map(p => ({ ...p, id: p.id, tags: p.tags }));
      },
    };
    vm.createContext(context);
    vm.runInContext(`${searchSource}; globalThis.searchPost = search;`, context);

    const results = await context.searchPost("", 1, 10);
    const prefix = source === "danbooru" ? "d" : source === "safebooru" ? "s" : source === "rule34" ? "r" : "h";
    assert.deepEqual([...results.map(post => post.id)], [`${prefix}2`, `${prefix}3`], source);
    if (source === "danbooru" || source === "safebooru") {
      const terms = requested.searchParams.get("tags");
      assert.ok(terms.includes("date:>=2026-08-01"), source);
      assert.ok(terms.includes("date:<=2026-08-31"), source);
    }
    if (source === "rule34") {
      const terms = requested.searchParams.get("tags");
      assert.ok(terms.includes("date:>=2026-08-01"), source);
      assert.ok(terms.includes("date:<=2026-08-31"), source);
    }
  }
});

test("Realbooru date filtering is not offered for posts scraped from HTML", () => {
  assert.match(html, /Date filters are unavailable for Realbooru HTML scraping/);
  assert.match(script, /if\(cfg\.src=='realbooru'&&\(cfg\.since\|\|cfg\.until\)\)/);
});

test("API proxy is configured in the app rather than exposed as a user override", () => {
  assert.doesNotMatch(html, /id="api"|API address override|QAPI/);
  assert.match(script, /const WORKER='https:\/\/photo-finder\.jojochess101\.workers\.dev'/);
  assert.match(script, /danbooru:`\$\{WORKER\}\/danbooru`/);
  assert.match(script, /hypnohub:`\$\{WORKER\}\/hypnohub`/);
  assert.match(script, /rule34:`\$\{WORKER\}\/rule34`/);
  assert.match(script, /realbooru:`\$\{WORKER\}\/realbooru`/);
  assert.match(script, /`\$\{b\}\/search\?limit=\$\{Math\.min\(limit,8\)\}&page=\$\{page\}&tags=/);
});

test("Rule34 short rating codes are matched to the selected rating", async () => {
  let requested;
  const context = {
    cfg: { src: "rule34", topic: "pokemon", rating: "explicit", minScore: 0, since: "" },
    customTags: [],
    excludedTags: [],
    API_BASE: { rule34: "https://photo-finder.jojochess101.workers.dev/rule34" },
    BASE: { rule34: "https://api.rule34.xxx" },
    POST_BASE: { rule34: "https://rule34.xxx" },
    hasRequiredTags: () => true,
    queryTags: (seed, base) => [base, seed].filter(Boolean).join(" "),
    jget: async url => {
      requested = new URL(url);
      return [
        { id: 1, tags: "pokemon solo", rating: "e", score: 5, preview_url: "https://img.test/1.jpg" },
        { id: 2, tags: "pokemon solo", rating: "s", score: 5, preview_url: "https://img.test/2.jpg" },
      ];
    },
  };
  vm.createContext(context);
  vm.runInContext(`${searchSource}; globalThis.searchPost = search;`, context);

  const posts = await context.searchPost("", 1, 10);
  assert.equal(requested.searchParams.get("tags"), "pokemon rating:explicit");
  assert.deepEqual(posts.map(post => post.id), ["r1"]);
});

test("Rule34 applies higher minimum scores in the query and result filter", async () => {
  let requested;
  const context = {
    cfg: { src: "rule34", topic: "pokemon", rating: "safe", minScore: 250, since: "" },
    customTags: [],
    excludedTags: [],
    API_BASE: { rule34: "https://photo-finder.jojochess101.workers.dev/rule34" },
    BASE: { rule34: "https://api.rule34.xxx" },
    POST_BASE: { rule34: "https://rule34.xxx" },
    hasRequiredTags: () => true,
    queryTags: (seed, base) => [base, seed].filter(Boolean).join(" "),
    jget: async url => {
      requested = new URL(url);
      return [
        { id: 1, tags: "pokemon solo", rating: "s", score: 249, preview_url: "https://img.test/1.jpg" },
        { id: 2, tags: "pokemon solo", rating: "s", score: 250, preview_url: "https://img.test/2.jpg" },
      ];
    },
  };
  vm.createContext(context);
  vm.runInContext(`${searchSource}; globalThis.searchPost = search;`, context);

  const posts = await context.searchPost("", 1, 10);
  assert.ok(requested.searchParams.get("tags").includes("score:>=250"));
  assert.deepEqual(posts.map(post => post.id), ["r2"]);
  assert.match(html, /<option value="1000">1000\+<\/option>/);
});

test("Rule34 remembers the lowest fetched ID per query and searches below it next time", async () => {
  const requested = [];
  const responses = [
    [
      { id: "18900280", tags: "pokemon solo", rating: "s", score: 5, preview_url: "https://img.test/1.jpg" },
      { id: "18900274", tags: "pokemon solo", rating: "s", score: 5, preview_url: "https://img.test/2.jpg" },
    ],
    [
      { id: "18900250", tags: "pokemon solo", rating: "s", score: 5, preview_url: "https://img.test/3.jpg" },
    ],
  ];
  const context = {
    cfg: { src: "rule34", topic: "pokemon", rating: "safe", minScore: 0, since: "", until: "" },
    customTags: [],
    excludedTags: [],
    rule34IdCursors: {},
    API_BASE: { rule34: "https://photo-finder.jojochess101.workers.dev/rule34" },
    BASE: { rule34: "https://api.rule34.xxx" },
    POST_BASE: { rule34: "https://rule34.xxx" },
    hasRequiredTags: () => true,
    queryTags: (seed, base) => [base, seed].filter(Boolean).join(" "),
    jget: async url => {
      requested.push(new URL(url));
      return responses.shift();
    },
    SV: () => {},
  };
  vm.createContext(context);
  vm.runInContext(
    `${searchSource}; globalThis.searchPost = search; globalThis.persistCursors = saveRule34IdCursors; globalThis.readCursors = () => rule34IdCursors;`,
    context,
  );

  const queryKey = "pokemon rating:safe";
  const firstRunIds = Object.create(null);
  await context.searchPost("", 1, 10, {}, firstRunIds);
  assert.equal(requested[0].searchParams.get("tags"), queryKey);
  assert.equal(firstRunIds[queryKey], 18900274);

  const nextRunIds = Object.create(null);
  await context.searchPost("", 1, 10, { [queryKey]: firstRunIds[queryKey] }, nextRunIds);
  assert.equal(requested[1].searchParams.get("tags"), `${queryKey} id:<18900274`);
  assert.equal(nextRunIds[queryKey], 18900250);
  context.persistCursors(nextRunIds);
  assert.equal(context.readCursors()[queryKey], 18900250);
  assert.match(html, /id="resetRule34Ids">Reset Rule34 search position/);
  assert.match(script, /rule34IdBefore=cfg\.src=='rule34'\?\{\.\.\.rule34IdCursors\}:\{\}/);
  assert.match(script, /rule34IdCursors=\{\};SV\('rule34IdCursors',\{\}\)/);
});

test("default exclusions can be individually unlocked while custom exclusions stay", async () => {
  const match = script.match(/const ALWAYS_EXCLUDED=new Set\(`([^`]*)`\.split/);
  assert.ok(match, "expected the default exclusion set");
  const alwaysExcluded = match[1].split(/\s+/);
  assert.deepEqual(alwaysExcluded, [
    "3d", "3d_(artwork)", "ai_generated", "animal_penis", "anthro", "fart",
    "feral", "fur", "furry", "futa", "futanari", "gaping", "gore",
    "hyper_balls", "hyper_penis", "hyper_breasts", "inflation", "vore",
    "vomit", "scat",
  ]);
  assert.match(html, /Tap a default exclusion to unlock or relock it/);
  assert.match(script, /unlockedDefaultTags\.add\(tag\)/);
  assert.match(script, /unlockedDefaultTags\.delete\(tag\)/);

  const syncStart = script.indexOf("function syncExcludedTags");
  const syncEnd = script.indexOf("syncExcludedTags();", syncStart);
  const syncSource = script.slice(syncStart, syncEnd);
  const state = {
    ALWAYS_EXCLUDED: new Set(alwaysExcluded),
    userExcludedTags: ["custom_tag"],
    unlockedDefaultTags: new Set(["gore"]),
    excludedTags: [],
    SV: (key, value) => { state.saved = [key, [...value]]; },
  };
  vm.createContext(state);
  vm.runInContext(`${syncSource}; syncExcludedTags();`, state);
  assert.ok(!state.excludedTags.includes("gore"));
  assert.ok(state.excludedTags.includes("3d"));
  assert.ok(state.excludedTags.includes("custom_tag"));
  assert.deepEqual(state.saved, ["excludedTags", ["custom_tag"]]);
  state.unlockedDefaultTags.delete("gore");
  vm.runInContext("syncExcludedTags()", state);
  assert.ok(state.excludedTags.includes("gore"));

  let requested;
  const context = {
    cfg: { src: "rule34", topic: "pokemon", rating: "safe", minScore: 0, since: "" },
    customTags: [],
    excludedTags: alwaysExcluded,
    API_BASE: { rule34: "https://photo-finder.jojochess101.workers.dev/rule34" },
    BASE: { rule34: "https://api.rule34.xxx" },
    POST_BASE: { rule34: "https://rule34.xxx" },
    hasRequiredTags: () => true,
    queryTags: (seed, base) => [base, seed].filter(Boolean).join(" "),
    jget: async url => {
      requested = new URL(url);
      return [];
    },
  };
  vm.createContext(context);
  vm.runInContext(`${searchSource}; globalThis.searchPost = search;`, context);

  await context.searchPost("", 1, 10);
  const queryTags = requested.searchParams.get("tags").split(/\s+/);
  for (const tag of alwaysExcluded) assert.ok(queryTags.includes(`-${tag}`), tag);
});

test("higher-scored posts rank ahead when other tags are identical", () => {
  const context = {
    P: { tc: {}, n: 0, lk: [] },
    liked: [],
    seen: new Set(),
    seenHashes: new Set(),
    dismissed: [],
    excludedTags: [],
    STOP: new Set(),
    cfg: { display: 2, minScore: 0, since: "" },
    hasRequiredTags: () => true,
    isL: () => false,
    isD: () => false,
    jac: (a, b) => {
      let intersection = 0;
      for (const tag of a) if (b.has(tag)) intersection++;
      return intersection / (a.size + b.size - intersection || 1);
    },
  };
  const pool = new Map([
    ["low", { id: "low", hash: "", tags: ["shared_tag"], artist: [], score: 10, date: "" }],
    ["high", { id: "high", hash: "", tags: ["shared_tag"], artist: [], score: 100, date: "" }],
  ]);
  vm.createContext(context);
  vm.runInContext(`${rankSource}; globalThis.rankPosts = rank;`, context);

  const ranked = context.rankPosts(pool, new Map());
  assert.deepEqual(Array.from(ranked, post => post.id), ["high", "low"]);
  assert.ok(ranked[0].match > ranked[1].match);
});

test("toggled-off tags remain visible but are skipped as dynamic search seeds", () => {
  assert.match(script, /\[\.\.\.new Set\(\[\.\.\.P\.seeds,\.\.\.Object\.keys\(counts\)/);
  const source = script.match(/const dynamicSeeds=counts=>[^;]+;/)?.[0];
  assert.ok(source, "expected dynamic seed selection helper");
  const context = { off: new Set(["most_liked"]) };
  vm.createContext(context);
  vm.runInContext(`${source}; globalThis.pickSeeds = dynamicSeeds;`, context);
  assert.deepEqual(
    [...context.pickSeeds({ most_liked: 100, allowed_tag: 90, another_allowed: 80 })],
    ["allowed_tag", "another_allowed"],
  );
});
