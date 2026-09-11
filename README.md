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

### Chopping automation and low-overhead runtime

The automation targets **Chopping** specifically. A local countdown never authorizes input by itself: only a fresh Chopping `Ready` observation can start the E sequence. The primary activation is E ×5, followed by a fast verification. If `Ready` is observed again, one rapid confirmation is required before the single backup E ×3 burst. Unclear or surprising observations fail closed and send no key.

Numeric cooldown observations are anchored to screenshot capture time, not OCR completion time. During a known cooldown the Chopping watcher enters an explicit sleep state between scheduled tiny synchronization reads. Dumb mode uses a nominal 15-second sync interval, tightened only near Ready or when prediction uncertainty is high. Near the predicted transition the counter is paused and the watcher uses a learned Ready/Active micro-state matcher first; uncertain boundary reads fall back to constrained Tesseract. Full-sidebar OCR is not run periodically while mining.

Expensive capture/OCR work uses a single-concurrency priority queue: critical Chopping reads outrank cooldown sync, live counter analytics and full-panel reads. Old connection/generation/capture results are rejected, decreasing Blocks-mined readings are rejected on the same connected island, and a timeout watchdog can recreate a stuck OCR worker.

### Counter, sessions and Dumb mode

Live Blocks mined uses a small crop at the configured counter interval (20 seconds by default) while a run is active. It is scheduled independently of the UI, so closing the side panel does not stop an active run or Chopping automation. Counter work is deferred during the precision Ready window. Rolling blocks/second uses screenshot capture timestamps and is displayed to 6 significant figures.

Dumb mode forces Auto connection, Auto Chopping, the nominal 15-second Chopping synchronization and live counter. Before the run starts, a tiny counter check runs about every two seconds. The first observed increase starts an AFK run from the previous counter sample; stopping remains manual so the user controls the final boundary. Complete right-sidebar OCR snapshots are still captured at run start/end and raw recognized text remains local.

### Optional Live Monitor

The Live Monitor is **never opened automatically**. Press **Open Live Monitor** in the side panel to create the compact popup. Closing the side panel or monitor does not stop the automation. The monitor consumes cached/event-driven runtime state and a low-frequency recovery status check; opening it does not create its own Chopping or counter OCR schedule.

Mini mode shows Chopping state, Blocks mined, rolling speed, run progress and health. Monitor mode adds timer drift/uncertainty, last authoritative sync, recognition method, OCR/queue/capture timing, activation statistics and Ready→E1 latency. Diagnostic mode adds local structured logs. Logs are bounded in memory and no screenshots/video are retained.

### Performance behavior

- full sidebar OCR: connect/calibration, explicit refresh/recalibration, run start and run end only
- Chopping cooldown: sleep between scheduled tiny reads; nominal 15-second sync in Dumb mode
- precision window: counter paused; learned state matching preferred; Tesseract is a guarded fallback rather than a constant sub-second loop
- live counter: small crop, default 20 seconds while a run is active
- UI: side panel and optional monitor display cached/event-driven state; `GET_STATUS` does not itself trigger OCR
- OCR worker: kept loaded but idle during sleep periods to avoid repeated initialization spikes

The Diagnostics surfaces report structured state-machine, timer, OCR, input, counter and session events. Measured live Chromebook performance and real Ready→E latency still require an actual Bloxd browser run; CI cannot prove those runtime quantities.

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

### v0.3.5 reliability / performance release

v0.3.5 combines the existing Dumb AFK workflow with priority/deadline OCR scheduling, stale-result rejection, self-calibrating micro-crops, conservative learned Ready/Active recognition, adaptive cooldown synchronization, offscreen wake scheduling, explicit sleep states, passive manual Live Monitor support and structured diagnostics. The release is only considered complete after the source/build audit, CI, merged-main package build and real-browser acceptance testing described above.
