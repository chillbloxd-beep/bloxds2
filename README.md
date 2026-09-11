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
- **Dumb** — Auto connection plus AFK run detection, live counter and Chopping automation.
- **Emergency stop** — changes back to Manual/Off, disables auto boost and detaches from Bloxd.

### Local OCR

The extension uses Chrome DevTools Protocol screenshot clipping to capture only small regions of the right-hand One Block panel. The images are transient and processed locally with bundled Tesseract.js/WebAssembly assets. It does not upload screenshots or record video.

A full sidebar read is used at connection, manual refresh, run start and run end. If the first connection snapshot misses Phase, v0.3.7 performs one connection-time metadata retry; it does not reintroduce periodic full-sidebar OCR. Raw recognized text is retained locally for run snapshots, so information that is visible but not yet parsed is not silently discarded.

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

Extension-recorded runs store exact start/end timestamps, start/end `Blocks mined`, calculated block delta and average blocks/sec, complete raw OCR sidebar text before/after the run, parsed before/after sidebar fields, lobby/mode information, and Chopping activation statistics.

The Sessions page exposes the raw before/after sidebar snapshots under **Details**. Raw sidebar snapshots are local-only and are not included in anonymous community submissions.

### Chopping automation and v0.3.7 reliability fixes

The automation targets **Chopping** specifically. v0.3.7 has two guarded activation paths. For a trusted cooldown, two final countdown reads must predict the same Ready boundary within the strict lock tolerance before scheduled input is armed; OCR and counter work are then blacked out while six E presses span ±1 second around that modeled boundary. If the strict timing lock cannot be established, the extension falls back to fresh actual-`Ready` confirmation and the existing E ×5 path. After either path, activation is verified and only one backup E ×3 burst is allowed. Unclear or untrusted timing never arms the scheduled boundary path.

v0.3.7 is a fix-only release based on failures seen in the v0.3.5 live browser recording. The first numeric cooldown after Active is now provisional and must agree with a second fresh sample before it becomes the trusted Ready prediction. If an established timer later disagrees by more than the normal drift tolerance, one outlier cannot move it, but two fresh outliers that agree with each other can replace the stale prediction. This prevents one bad first OCR value from locking the watcher onto the wrong countdown for an entire cycle.

An unexpectedly early real `Ready` still gets a rapid second confirmation and, once confirmed, bypasses the timer lock and activates immediately. On the normal trusted path, the final lock starts several seconds before predicted Ready, cancels ordinary cooldown/counter work, takes two authoritative countdown samples, and then sleeps through the transition except for the scheduled E events.

The learned Ready/Active matcher remains a guarded accelerator for state-confirmation fallback and verification; it is not required for the trusted scheduled boundary path. Chopping calibration is anchored to the stable `Skill:` label rather than the changing `149s` / `Ready` / `Active` token, so the recurring value crop does not move with text width.

To reduce the renderer disturbance seen in the v0.3.5 recording, one ordinary micro-crop miss no longer immediately launches broad multi-profile recovery. Recovery is staged, while timing-critical precision reads are bounded to the active profile. Full-sidebar OCR is never run periodically while mining.

E dispatch still uses Chrome DevTools Protocol, but v0.3.7 holds each E key-down for 25 ms before key-up rather than issuing an effectively immediate down/up pair. The existing E ×5 / one E ×3 backup safety limits remain unchanged.

### Counter, sessions and Dumb mode

Live Blocks mined uses a small crop at the configured counter interval (20 seconds by default) while a run is active. It is scheduled independently of the UI, so closing the side panel does not stop an active run or Chopping automation. Counter work is deferred when Chopping is near or inside the precision Ready window. Rolling blocks/second uses screenshot capture timestamps and is displayed to 6 significant figures.

Dumb mode forces Auto connection, Auto Chopping, the nominal 15-second Chopping synchronization and live counter. Before the run starts, a tiny counter check runs about every two seconds. The first observed increase starts an AFK run from the previous counter sample; stopping remains manual so the user controls the final boundary. Complete right-sidebar OCR snapshots are still captured at run start/end and raw recognized text remains local.

### Optional Live Monitor

The Live Monitor is **never opened automatically**. Press **Open Live Monitor** in the side panel to create the compact popup. Closing the side panel or monitor does not stop the automation. The monitor consumes cached/event-driven runtime state and a low-frequency recovery status check; opening it does not create its own Chopping or counter OCR schedule.

Mini mode shows Chopping state, Blocks mined, rolling speed, run progress and health. Monitor mode adds timer drift/uncertainty, last authoritative sync, recognition method, OCR/queue/capture timing, activation statistics and Ready-recognition→E1 latency. Diagnostic mode adds local structured logs. Logs are bounded in memory and no screenshots/video are retained.

### Performance behavior

- full sidebar OCR: connect/calibration, explicit refresh/recalibration, run start and run end only
- Chopping cooldown: sleep between scheduled tiny reads; the final trusted boundary uses a scheduled six-tap E window with OCR/counter blackout; nominal 15-second sync in Dumb mode
- first cooldown anchor: two fresh time-consistent samples before trust
- large timer disagreement: recovery quorum rather than permanent old-prediction lock-in
- final timing lock: begins several seconds before predicted Ready; two strict countdown reads must agree, then OCR/counter stays blacked out across the six-tap boundary window
- micro-crop recovery: one ordinary miss is deferred; broad profile recovery is staged rather than immediate
- live counter: small crop, default 20 seconds while a run is active
- UI: side panel and optional monitor display cached/event-driven state; `GET_STATUS` does not itself trigger OCR or connection recovery
- OCR worker: kept loaded but idle during sleep periods to avoid repeated initialization spikes

The Diagnostics surfaces report structured state-machine, timer, OCR, input, counter and session events. `Ready recognition → E1` measures extension-internal dispatch latency only; it is not the same as visual Bloxd Ready → E latency.

## Build

Requires Node.js 22+.

```bash
npm install
npm test
npm run build
npm run build:extension
npm run audit:extension
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

Every push to `main` also runs **Build Chrome extension** and uploads `oneblock-analytics-extension.zip` as a GitHub Actions artifact. Release ZIPs should be taken from the audited merged-`main` workflow, not from an intermediate feature-branch build.

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

CI validates source compilation, deterministic parser/reliability/calibration tests, production builds, the extension audit and packaged OCR assets. It cannot prove the exact rendered Ready→E delay, actual mining/FPS impact, or live OCR accuracy on a particular Chromebook/display scale.

### v0.3.7 fix release

v0.3.7 does not add a new user-facing feature set. It keeps the v0.3.6 cooldown-recovery safeguards and concentrates on the remaining live-test problems: delayed Ready→Active transition, OCR work at the exact boundary, unstable Chopping value crops, renderer disturbance from eager fallback, and input-scheduling headroom. The trusted path now uses a strict two-read final timer lock plus a six-tap scheduled boundary window; unsafe timing falls back to fresh Ready confirmation. These fixes must still pass a new real Bloxd/Chromebook acceptance recording before a ≤500 ms Ready→Active result or mining-performance impact can be called proven.
