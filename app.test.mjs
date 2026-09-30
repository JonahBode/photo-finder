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
  for (const source of ["danbooru", "safebooru", "hypnohub", "rule34"]) {
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

test("API proxy is configured in the app rather than exposed as a user override", () => {
  assert.doesNotMatch(html, /id="api"|API address override|QAPI/);
  assert.match(script, /const WORKER='https:\/\/photo-finder\.jojochess101\.workers\.dev'/);
  assert.match(script, /danbooru:`\$\{WORKER\}\/danbooru`/);
  assert.match(script, /hypnohub:`\$\{WORKER\}\/hypnohub`/);
  assert.match(script, /rule34:`\$\{WORKER\}\/rule34`/);
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
    context.pickSeeds({ most_liked: 100, allowed_tag: 90, another_allowed: 80 }),
    ["allowed_tag", "another_allowed"],
  );
});
