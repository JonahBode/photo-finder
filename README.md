# photo-finder
Find similar photos

## Search topic

In **Settings → Topic tag**, enter a booru tag such as `league_of_legends` to search a different series. The default is `pokemon`; leave the field blank to search without a required topic tag. Search tags and rating syntax vary by image source.

## API proxy

Danbooru, HypnoHub, Rule34, and Realbooru requests use the Cloudflare Worker configured in the app. Safebooru requests remain direct. The [`wrangler.toml`](wrangler.toml) config declares [`worker.js`](worker.js) as the Worker entrypoint and deploys it as `photo-finder` to `workers.dev`; its CORS allowlist is restricted to `https://jonahbode.github.io`.

In Cloudflare, connect this repository as a **Worker**, not a Pages static site, and use `npx wrangler deploy` as the deploy command from the repository root. Wrangler will read `wrangler.toml` and deploy `worker.js` instead of attempting to detect static files. The Worker accepts only post-search requests and forwards them to fixed upstream hosts. To change the Worker hostname, update its name in `wrangler.toml` and the `WORKER` constant near the top of the inline script in `index.html`.

Rule34 API credentials are optional. If you have a Rule34 API key, configure the Worker secrets `RULE34_USER_ID` and `RULE34_API_KEY` in Cloudflare; do not put the key in the page or a public repository. The proxy serves no ads or paywalls.

For Rule34, the app remembers the lowest post ID returned for each exact search query and uses `id:<ID` on later searches to continue with older posts. Use **Settings → Reset Rule34 search position** to start again from the newest matches.

Realbooru date bounds use its `cid` Unix-time meta-tag. CID is a post change timestamp and may differ from the original upload date.
