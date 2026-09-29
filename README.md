# photo-finder
Find similar photos

## Search topic

In **Settings → Topic tag**, enter a booru tag such as `league_of_legends` to search a different series. The default is `pokemon`; leave the field blank to search without a required topic tag. Search tags and rating syntax vary by image source.

## API proxy

Danbooru, HypnoHub, and Rule34 requests use the Cloudflare Worker configured in the app. Safebooru requests remain direct. The Worker must be deployed with [`worker.js`](worker.js) at `photo-finder.jojochess101.workers.dev`; its CORS allowlist is restricted to `https://jonahbode.github.io`.

To change the Worker hostname, update the `WORKER` constant near the top of the inline script in `index.html`. The Worker accepts only post-search requests and forwards them to fixed upstream hosts.

Rule34 API credentials are optional. If you have a Rule34 API key, configure the Worker secrets `RULE34_USER_ID` and `RULE34_API_KEY` in Cloudflare; do not put the key in the page or a public repository. The proxy serves no ads or paywalls.
