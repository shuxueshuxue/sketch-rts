# Improve unit silhouettes, portraits and command deck readability

## Why

Full-body unit drawings become difficult to distinguish inside the original 34–36 px HUD thumbnails. Small unlabeled buttons and heavy panel decoration also make commands harder to scan.

## Changes

- Strengthen shields, bows, headgear and specialist colors while preserving the hand-drawn style.
- Reuse the actual unit painters for close portraits; render icons at higher backing resolution.
- Show unit names, counts and command labels with more legible hotkeys.
- Use quieter dark-green HUD panels and stack the command, item and selection decks responsively.

The simulation, stats and AI are unchanged. No runtime dependencies were added.

## Validation

- `npm run build`
- `npm run build:static`
- `npx vitest --run src/client`: 50 files, 229 tests passed.
- Chromium: create/start a match, pointer lock, selection, construction and training; desktop and narrow Chinese/English layouts checked.
- Before/after renders and screenshots: `docs/visual-readability-review.zh.md`.

The existing Vite bundle-size warning remains. Full-match balance and multiplayer were not retested for this presentation-only change.
