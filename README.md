# OneBlock Analytics

A local-first performance analytics application for Bloxd.io One Block, with an optional Chrome extension for live sidebar OCR and Chopping skill automation.

## Website

The website includes completed/live/AFK run logging, exact counter/time-derived rates, IndexedDB local persistence, calculators, session history, personal analytics, goals, JSON backup/import, anonymous community statistics, light/dark themes, and Cloudflare Worker + D1 support.

The example `2.690` value in the empty state is a measured demo session, not a universal Bloxd.io mining speed.

## Chrome extension

The Manifest V3 extension reuses the OneBlock Analytics application and adds a **Live** page. It activates only for the One Block path:

```text
https://bloxd.io/play/oneBlock
https://bloxd.io/play/oneBlock?lobby=1111
https://bloxd.io/play/oneBlock?lobby=<any lobby>
```

Lobby IDs are never hard-coded. URL detection is based on `/play/oneBlock`.

### Connection modes

- **Manual** — the extension performs no debugger attachment, OCR, or automated input until `Extension enabled` is switched on.
- **Auto** — the extension detects an open Bloxd One Block tab and connects automatically, regardless of lobby.
- **Emergency stop** — changes back to Manual/Off, disables auto boost and detaches from Bloxd.

### Local OCR

The extension uses Chrome DevTools Protocol screenshot clipping to capture only small regions of the right-hand One Block panel. The images are transient and processed locally with bundled Tesseract.js/WebAssembly assets. It does not upload screenshots or record video.

A full sidebar read is used at connection, manual refresh, run start and run end. The raw recognized text is retained locally for run snapshots, so information that is visible but not yet parsed is not silently discarded.

The parser currently extracts, when OCR can read them:

- One Block banner/title line
- Owner
- Phase
- Blocks mined
- Mining level, Lucky %, skill state
- Digging level, Lucky %, skill state
- Chopping level, Lucky %, skill state
- Farming level
- Gold %, Gold skill state
- Daily text

Unrecognized/missing fields remain missing; the extension does not invent values.

### Before/after run logging

Extension-recorded runs store:

- exact wall-clock start/end timestamps
- start/end `Blocks mined`
- calculated block delta and average blocks/sec
- complete raw OCR sidebar text before the run
- complete raw OCR sidebar text after the run
- parsed before/after sidebar fields
- lobby at run start
- Manual/Auto connection mode
- successful boost activations, activation retries, failed activations and observed cooldown values

The Sessions page exposes the raw before/after sidebar snapshots under **Details**. Raw sidebar snapshots are local-only and are not included in anonymous community submissions.

### Chopping boost state machine

The automation targets the **Chopping** skill specifically; it does not react to another `Ready` elsewhere on the sidebar.

```text
Chopping Skill: Ready
        ↓
E → short gap → E
        ↓
wait 3 seconds
        ↓
read Chopping status
```

After the check:

- `Active` = activation confirmed.
- A number such as `157s` = activation confirmed and cooldown already started.
- `Ready` = send **one** additional E ×2 retry, then verify again.
- unclear OCR = send no key and re-read later.
- still `Ready` after the single retry = pause auto boost with an input-not-confirmed fault instead of repeatedly pressing E.

When the first countdown value appears, for example `157s`, boost OCR stops for that cooldown. The next boost check is scheduled for `157 + 2` seconds by default. If it is not Ready then, the extension waits 3 seconds before another check. These timings are configurable.

The current packaged build declares Chrome 150+ so its debugger/service-worker and alarm behavior matches the APIs used by the extension as built and tested in CI.

### Performance behavior

- full sidebar OCR: startup, refresh, run start/end only
- counter OCR: small `Blocks mined` crop, default every 10 seconds while enabled
- boost OCR: only during state transitions and after scheduled cooldown wake-up
- known cooldown: no repeated boost OCR for every displayed second
- OCR worker is lazy-loaded on the first read
- capture is cropped before OCR rather than processing the full game viewport

The Diagnostics section reports the last OCR duration, OCR confidence, reads in the previous minute and recent state-machine events.

## Build

Requires Node.js 22+.

```bash
npm install
npm test
npm run build
npm run build:extension
```

The normal website build is written to `dist/`. The Chrome extension build is written to `dist-extension/`.

## Install the unpacked extension

Build it, then in Chrome:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select the `dist-extension` folder.
5. Open a Bloxd One Block tab and click the OneBlock Analytics extension icon to open its side panel.

The extension requests the `debugger` permission because it uses DevTools Protocol for cropped screen capture and E-key dispatch. Chrome may visibly indicate that the Bloxd tab is being debugged. Automated game input should only be used where permitted by the game's rules.

Every push to `main` also runs **Build Chrome extension** and uploads `oneblock-analytics-extension.zip` as a GitHub Actions artifact.

## GitHub Codespaces

```bash
npm install
npm test
npm run build
npm run build:extension
npm run dev -- --host 0.0.0.0
```

## Cloudflare / D1 setup

```bash
npx wrangler login
npx wrangler d1 create oneblock-analytics
```

Copy the returned D1 `database_id` into `wrangler.jsonc`, then:

```bash
npm run db:migrate:remote
openssl rand -hex 32
npx wrangler secret put ANON_HASH_SALT
npm run cf:deploy
```

For local Worker testing, copy `.dev.vars.example` to `.dev.vars`, set a development `ANON_HASH_SALT`, run `npm run db:migrate:local`, then `npm run cf:dev`.

Do not configure `TURNSTILE_SECRET_KEY` until a corresponding frontend Turnstile token flow is added.

## Privacy and community statistics

- Runs remain local unless the user explicitly opts into anonymous community statistics.
- The extension does not upload OCR images or video.
- Raw before/after sidebar OCR text remains local.
- Community submission sends structured run fields; the Worker recalculates blocks and blocks/sec server-side.
- A random local install ID is salted and SHA-256 hashed before D1 storage; the raw install ID is not stored.
- `ANON_HASH_SALT` must be configured before community writes or withdrawals are accepted.
- Synced anonymous runs can be withdrawn by the originating browser identity.
- Short samples are retained but excluded from headline aggregates.
- Larger cohorts use robust statistical outlier filtering; this is not presented as cheat detection.
- Cross-origin API requests are denied unless same-origin or explicitly allowed.

The extension and GitHub Pages website currently have separate browser-local IndexedDB stores. They expose the same analytics features, but local session history is not automatically synchronized between those two origins yet.

Community API calls from the extension require a deployed Cloudflare API base URL. Until that backend is provisioned and supplied to the extension build, local extension features work but shared community sync from the extension is not considered live.

## Statistical definitions

- Session rate = `(end counter - start counter) / elapsed seconds`
- Combined throughput = `sum(blocks) / sum(elapsed seconds)`
- Mean session rate = arithmetic mean of individual run rates
- Median session rate = median of individual run rates

The current community endpoint analyzes up to the latest 10,000 eligible runs for a selected cohort and discloses when that cap is reached. At larger scale, replace the live scan with precomputed aggregate tables.

## Runtime validation still required

CI validates source compilation, parser tests, both production builds and the packaged OCR assets. Two behaviors still require a real Bloxd browser test before they can be called proven: OCR accuracy against the live rendered sidebar at the user's display scale, and whether Bloxd accepts the debugger-dispatched E input exactly as intended.
