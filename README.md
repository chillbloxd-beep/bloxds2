# OneBlock Analytics

A local-first performance analytics application for Bloxd.io One Block.

## What is implemented

- Completed run logging from start/end counters + elapsed time
- Live run timer using absolute timestamps
- AFK/sleep run timer using absolute timestamps
- Exact blocks/sec, blocks/minute and blocks/hour
- IndexedDB local persistence
- Session history and filters
- Personal analytics: speed trend, duration vs speed, duration buckets, phase comparison, active vs AFK
- Calculator: blocks → time, counter target → time, time → blocks, AFK duration → blocks
- Prediction hierarchy based on the user's own recorded sessions
- Goals
- JSON backup export/import
- Light-first precision analytics UI + dark mode
- Anonymous community opt-in
- Cloudflare Worker + D1 community storage
- Community combined throughput, mean, median, percentiles and full-run statistics
- Dynamic robust outlier filtering for sufficiently large cohorts
- Anonymous community-record withdrawal from the originating browser identity
- Explicit disclosure when the live community cohort reaches its 10,000-run analysis cap
- Unit tests for core mining math

## Deliberately excluded

- Video upload / OCR / video analysis
- Cloud video storage
- Fake ping/FPS slowdown multipliers
- Universal hard-coded mining speed
- Public fastest-player leaderboard
- Candlestick charts

The `2.690` rate shown in the empty-state demo is an **example measured session**, not a universal Bloxd.io speed. Personal predictions will not silently use it.

## Development

Requires Node.js 22+.

```bash
npm install
npm test
npm run build
npm run dev -- --host 0.0.0.0
```

## GitHub Codespaces

Open the repo in Codespaces and run:

```bash
npm install
npm test
npm run dev -- --host 0.0.0.0
```

Open the forwarded Vite port when Codespaces prompts you.

## Cloudflare / D1 setup

The repository contains a Worker API, D1 migration and Wrangler configuration.

```bash
npx wrangler login
npx wrangler d1 create oneblock-analytics
```

Copy the returned D1 `database_id` into `wrangler.jsonc`, then apply the migration:

```bash
npm run db:migrate:remote
```

Generate the anonymous-contributor hashing secret and add it to Cloudflare:

```bash
openssl rand -hex 32
npx wrangler secret put ANON_HASH_SALT
```

Then deploy:

```bash
npm run cf:deploy
```

For local Worker testing, copy `.dev.vars.example` to `.dev.vars` and set a development `ANON_HASH_SALT`, then run:

```bash
npm run cf:dev
```

## Privacy and community statistics

- Runs stay local unless the user explicitly opts into community statistics.
- No video is uploaded.
- The browser sends raw counters, elapsed time and optional selected metadata.
- The Worker recalculates `blocks_mined` and `average_bps` server-side.
- A random local install ID is salted + SHA-256 hashed by the Worker before D1 storage.
- The hash is used to count anonymous contributors; the raw install ID is not stored in D1.
- `ANON_HASH_SALT` must be configured as a strong Worker secret before community writes or withdrawals are accepted.
- A synced community record can be withdrawn from Sessions; the Worker only deletes it when the run ID and salted anonymous browser identity both match.
- If remote withdrawal fails, the local record is retained so the user can retry.
- Short samples are retained but excluded from headline aggregates.
- Statistical outlier filtering protects aggregate views; it is not presented as cheat detection.
- Cross-origin API requests are denied unless they are same-origin or match the configured `ALLOWED_ORIGIN`.

## Statistical definitions

- Session rate = `(end counter - start counter) / elapsed seconds`
- Combined throughput = `sum(all blocks) / sum(all elapsed seconds)`
- Mean session rate = arithmetic mean of individual run rates
- Median session rate = median of individual run rates
- Percentile comparisons must be based on comparable cohorts, not silently mixed populations

## Community aggregation limit

The current live aggregate endpoint analyzes up to the latest 10,000 eligible runs for a selected cohort. If that cap is reached, the API returns `sampleCapped: true` and the UI discloses the limitation. Before cohorts routinely exceed this size, replace the live scan with precomputed aggregate tables so all-time statistics remain complete.

## Architecture

```text
Browser
 ├─ React + TypeScript
 ├─ IndexedDB
 ├─ local calculations / charts
 └─ optional anonymous community submission
          │
          ▼
Cloudflare Worker
 ├─ validation
 ├─ derived-value recalculation
 ├─ anonymous identifier hashing
 ├─ optional Turnstile verification
 └─ aggregate API
          │
          ▼
Cloudflare D1
```

## Design direction

The interface follows the project's precision-analytics direction: neutral light-first surfaces, restrained radii, minimal shadow, no glassmorphism or decorative gradients, tabular numerals, data-led layouts, functional motion only, and product-specific copy.

## Production hardening still requiring account-level Cloudflare setup

The repository is ready for D1/Worker deployment, but the following require your Cloudflare account rather than source-code changes:

- Create the D1 database and place its ID in `wrangler.jsonc`
- Set `ANON_HASH_SALT` as a Worker secret
- Optionally configure Turnstile and `TURNSTILE_SECRET_KEY`
- Set an explicit `ALLOWED_ORIGIN` if the frontend and API are hosted on different origins
- Add Cloudflare account/API secrets to GitHub Actions if you want GitHub-triggered deployment

For larger community datasets, replace the current on-request 10,000-row cohort calculation with precomputed aggregate tables.
