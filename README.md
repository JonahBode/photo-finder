# Photo Finder

The existing `pokemon-picks.html` page discovers tagged Pokémon artwork. The **Annotate photos** link opens `annotate.html`, an optional batch-photo annotation MVP.

## Batch annotation setup

The annotation page is static and does not contain provider credentials. It sends one selected image at a time to a separately deployed Cloudflare Worker (`annotation-worker.mjs`), which calls Google Cloud Vision label detection and optionally searches public Tumblr posts by the resulting keywords. The separate `annotateWithVision` and `searchTumblr` provider functions can be replaced or extended independently.

1. Create a Google Cloud project, enable the Cloud Vision API, and create an API key restricted to that API. Configure the required billing/quota limits for the project.
2. Register a Tumblr application at [Tumblr Developers](https://www.tumblr.com/oauth/apps) and obtain its consumer/API key. Public tagged-post search uses the official `GET /v2/tagged` endpoint with an API key; it does not require user OAuth. Tumblr offers keyword/tag search here, **not reverse-image search**.
3. Install/use Cloudflare Wrangler, set `APP_ORIGIN` in `wrangler.toml` to the exact origin serving this site (for GitHub Pages, the origin has no repository path), then configure secrets and deploy:

   ```sh
   npx wrangler secret put GOOGLE_CLOUD_VISION_API_KEY
   npx wrangler secret put TUMBLR_API_KEY
   npx wrangler deploy
   ```

   Tumblr is optional: omit its secret to keep image labels available without Tumblr results. The Worker returns a clear configuration status rather than inventing results.
4. Open `annotate.html`, paste the deployed Worker URL ending in `/annotate`, and choose up to 20 images. The URL is held only in the page and is not saved.

The page accepts JPEG, PNG, GIF, and WebP files up to 8 MiB each, checks the file signature, and reports a separate loading/result/error state for each image. Images are sent to Google Cloud Vision through the Worker and are not stored by this project; generated keywords, not the images, are sent to Tumblr. The Worker keeps both API keys server-side and makes no Tumblr web-page requests or scraping calls. Configure Cloudflare rate limits and provider quotas for a public deployment; CORS only restricts browser origins and is not authentication.

Descriptions are automated visual labels and are not guaranteed identities. Tumblr results are public posts returned by matching tags, not confirmed matches for the uploaded image. The UI links to the original post and shows available blog, caption, and media dimensions; it does not assert original photographer or definitive title. The first five returned image labels are searched, with no more than five Tumblr tag requests per image. Google Cloud Vision processes the uploaded image; review that provider's terms/privacy policy before use.

## Tests

Run the built-in Node.js tests for Worker validation and provider behavior:

```sh
node --test annotation-worker.test.mjs
```
