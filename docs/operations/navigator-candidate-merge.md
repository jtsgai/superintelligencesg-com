# Navigator candidate merge

The Source Desk export is a review handoff. It does not publish a Navigator record.

1. In the private Source Desk queue, filter **Navigator draft → Ready for merge** and export the JSON.
2. Run the read-only validator from the `.com` repository:

   ```bash
   node scripts/validate-navigator-candidates.mjs /path/to/navigator-candidates-ready.json
   ```

3. Open every `source_url` and confirm the proposed name, description and category. Check `website_url` and `logo_url` separately when present.
4. Add only the reviewed records to `assets/product/organizations.json`. Use a stable `public-...` ID, an `updated` date, and the existing field order. Copy the same data to `dist/assets/product/organizations.json`.
5. Parse both JSON files, check for duplicate IDs, run `git diff --check`, and review the rendered Navigator before committing and deploying.

The validator is read-only. It checks required fields, supported categories, HTTP(S) URLs, duplicate submission IDs, duplicate candidate names and collisions with the existing public index.
