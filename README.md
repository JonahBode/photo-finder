# photo-finder
Find similar photos

## Search topic

In **Settings → Topic tag**, enter a booru tag such as `league_of_legends` to search a different series. The default is `pokemon`; leave the field blank to search without a required topic tag. Search tags and rating syntax vary by image source.

## API proxy

Danbooru, HypnoHub, Rule34, and Realbooru requests use the Cloudflare Worker configured in the app. Safebooru requests remain direct. The [`wrangler.toml`](wrangler.toml) config declares [`worker.js`](worker.js) as the Worker entrypoint and deploys it as `photo-finder` to `workers.dev`; its CORS allowlist is restricted to `https://jonahbode.github.io`.

In Cloudflare, connect this repository as a **Worker**, not a Pages static site, and use `npx wrangler deploy` as the deploy command from the repository root. Wrangler will read `wrangler.toml` and deploy `worker.js` instead of attempting to detect static files. The Worker accepts only post-search requests and forwards them to fixed upstream hosts. To change the Worker hostname, update its name in `wrangler.toml` and the `WORKER` constant near the top of the inline script in `index.html`.

Rule34 API credentials are optional. If you have a Rule34 API key, configure the Worker secrets `RULE34_USER_ID` and `RULE34_API_KEY` in Cloudflare; do not put the key in the page or a public repository. The proxy serves no ads or paywalls.

For Rule34, the app remembers the lowest post ID returned for each exact search query and uses `id:<ID` on later searches to continue with older posts. Use **Settings → Reset Rule34 search position** to start again from the newest matches.

## Tumblr source

Tumblr uses the official [`/v2/tagged` endpoint](https://github.com/tumblr/docs/blob/master/api.md#tagged-method). Create a Tumblr application to get an API key, then configure it as a Cloudflare Worker secret with `npx wrangler secret put TUMBLR_API_KEY`; the key is never sent to the browser. Redeploy the Worker after setting the secret. Tumblr returns public tagged posts, and the app keeps image media only, searches one tag at a time (Topic tag, or the first included tag), and uses note count as its score. Tumblr does not supply booru-style ratings. The app remembers a `before` timestamp per tag to continue into older posts; its minimum-score filter therefore means minimum notes for Tumblr.

## Realbooru scraping

The linked [`realbooru` package](https://onepub.dev/packages/realbooru) confirms that Realbooru's API is disabled and demonstrates scraping its HTML post listing (`.thumb > a`) and post pages (`.imageContainer`, `#image`, and `tag*` links). The Worker follows those selectors, but deliberately fetches only one listing and up to 8 post pages for each search, with a 500 ms pause between detail requests. It caches listing pages briefly and post pages for an hour.

This is a best-effort compatibility path, not an official API. Scraping may stop working if Realbooru changes its markup and may impose load the site does not intend. Realbooru date filters are unavailable through this path; scores may not be present in scraped pages. A search with a date filter is rejected rather than silently returning misleading results. Redeploy both the Cloudflare Worker and GitHub Pages app to use the change.
