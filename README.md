# photo-finder
Find similar photos

## Search topic

In **Settings → Topic tag**, enter a booru tag such as `league_of_legends` to search a different series. The default is `pokemon`; leave the field blank to search without a required topic tag. Search tags and rating syntax vary by image source.

## Optional API proxy

The static page makes API requests directly from the browser by default. If a source is blocked by CORS, deploy [`worker.js`](worker.js) as a Cloudflare Worker:

1. In Cloudflare, create a Worker and paste in the contents of `worker.js`.
2. Deploy it and copy its `workers.dev` URL.
3. In the app's **Settings → API address override**, enter the Worker URL with `/danbooru`, `/hypnohub`, or `/rule34` appended, according to the selected source. For example: `https://your-worker.workers.dev/danbooru`.
4. The Worker only accepts post-search requests and forwards them to fixed upstream hosts. It allows browser requests only from `https://jonahbode.github.io`.

Rule34 API credentials are optional. If you have a Rule34 API key, configure the Worker secrets `RULE34_USER_ID` and `RULE34_API_KEY` in Cloudflare; do not put the key in the page or a public repository. The proxy serves no ads or paywalls.
