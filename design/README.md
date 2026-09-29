# Design folder

Everything visual lives here so the look stays consistent. Phase 2, step 1 (2026-09-29).

- palette.html and palette.png: the palette sheet. Source of truth for colours until tokens land in code.
- fonts.html and fonts.png: the two font pairs shown to Saaqib. Pair 1 Barlow Condensed plus IBM Plex Sans. Pair 2 Zilla Slab plus Nunito Sans.
- fonts/: local copies of the Google Fonts latin subsets, only for rendering the sheets offline. The app loads fonts from Google Fonts.
- fonts.css: the local font face rules for the sheets.
- render.mjs: renders the sheets to PNG with the preinstalled Chromium (CHROMIUM_PATH points at the binary).
- concepts/: concept images generated with Higgsfield. pixel-gpt.png (chunky pixel, candidate A) and lowpoly-gpt.png (low poly, candidate B). The two recraft files failed the hard bans (purple, magenta, rainbow) and are kept only as rejected references. manifest.json lists the sources.

Rule: no purple to blue gradients, no glassmorphism, no glowing orbs, no floating chat bubbles, no emoji as icons, no stock illustration people. Generated assets are concept only. Sprites are authored by hand from the palette.

- game-desktop.png and game-phone.png: latest local renders of the running scene (mock state), regenerated with design/shot.mjs.
- Frame budget: anything ambient sits behind the Low Effects toggle in the game (top right of the stage).
