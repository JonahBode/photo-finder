import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
const script = html.slice(html.indexOf("<script>") + 8, html.indexOf("</script>"));
const searchStart = script.indexOf("async function search");
const searchEnd = script.indexOf("const jac=", searchStart);
const searchSource = script.slice(searchStart, searchEnd);

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
    QAPI: "",
    BASE: { hypnohub: "https://hypnohub.net" },
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
        QAPI: "",
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
    }
  }
});
