# OneBlock Analytics extension v0.3.0

This build incorporates the observed Chromebook AFK layout where Chrome's OneBlock Analytics side panel narrows the Bloxd game viewport.

## Changes

- Added a normalized `afk-sidepanel` OCR crop calibrated from the observed 1920×1200 layout.
- Added `standard` and `broad` fallback crops.
- Full-panel startup scans score candidate crops and remember the best profile.
- Two consecutive counter/boost misses trigger lightweight alternate-crop recovery before a full recalibration.
- Added a **Recalibrate OCR** control and current crop/viewport diagnostics.
- OCR jobs are serialized so counter OCR, boost OCR and manual refreshes cannot race the same Tesseract worker.
- Tesseract.js and `tesseract.js-core` remain aligned on v7 and all OCR assets stay local.
- A failed Tesseract recognition resets the worker so the next read can initialize cleanly.
- Debugger attachment is single-flight. Duplicate connect events no longer attempt simultaneous attaches.
- If a Manifest V3 worker restarts while its own debugger session remains attached, the extension attempts to recover that session. A genuinely external debugger conflict is reported explicitly.
- Chopping OCR now fails closed: Digging or Gold `Ready` text cannot be mistaken for Chopping `Ready`.
- The agreed boost flow remains: Chopping Ready → E ×2 → wait 3s → verify; one E ×2 retry only; read first cooldown seconds; sleep cooldown + 2s; if not Ready, recheck after 3s.
- Complete raw right-sidebar OCR text and parsed fields are still stored before and after extension-recorded runs.

## Validation boundary

CI verifies parser/crop tests, TypeScript, website build, extension build and packaged OCR assets. Live OCR accuracy and Bloxd acceptance of debugger-dispatched E still require testing in the actual Bloxd tab; the extension does not claim those runtime behaviors are proven by CI alone.
