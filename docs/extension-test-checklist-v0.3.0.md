# v0.3.0 live test checklist

1. Remove the previous unpacked extension and load the v0.3.0 build.
2. Open `https://bloxd.io/play/oneBlock` or any lobby URL.
3. In Manual mode, turn **Extension enabled** ON and press **Scan now** once.
4. Confirm Diagnostics shows a crop profile (`afk-sidepanel` when the Chrome side panel narrows the game viewport) and a viewport size.
5. Confirm Current sidebar read contains the actual Blocks mined value and Chopping state.
6. If it does not, press **Recalibrate OCR** and inspect the exact diagnostic message.
7. Keep Auto-use Chopping skill OFF until OCR reliably distinguishes Chopping Ready / Active / countdown.
8. Then enable Auto-use Chopping skill and observe one complete cycle: Ready → E ×2 → 3 second verify → Active/countdown → cooldown sleep → Ready.
9. Confirm only one E ×2 retry occurs if the first activation is still Ready.
10. Start a short AFK test run, then finish it. Verify the saved session has both before and after sidebar snapshots and the correct counter delta.

Do not treat CI as proof of live OCR/input behavior; these checks are the runtime acceptance test.
