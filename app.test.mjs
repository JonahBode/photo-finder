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
