# Sketch RTS

A hand-drawn real-time strategy game for the browser. Build a base, command armies across land and sea, and face friends or programmable opponents.

[Play online](https://lexicalmathical.com/sketch-rts/) · [中文](docs/README.zh.md) · [Developer guide](docs/development.md)

![Skirmish interface preview](docs/reviews/skirmish-live.jpg)

## The game

- **Two factions** with distinct units and technology, neutral camps, mercenaries and equipment.
- **Land and sea warfare:** spellcasters, cavalry, siege weapons, fleets and island landings.
- **Solo and multiplayer skirmishes** on handcrafted maps or seeded layouts.
- **Programmable opponents:** a TypeScript SDK, replays and benchmarks built on the same simulation as the game.

The project is in active development. The interface supports English and Simplified Chinese; play requires a desktop keyboard and mouse.

## Play

Open the [online game](https://lexicalmathical.com/sketch-rts/), choose a map and create a room. Pick a faction and computer opponent, or invite friends, then start the match.

Select a worker and right-click a gold mine. Press `B` to build, grow your economy, and train an army. Command buttons show their hotkeys.

| Control | Action |
| --- | --- |
| Left-click / drag | Select / select a group |
| Right-click | Move or interact with the target |
| `A`, then click | Attack-move |
| `Shift` + order | Queue an order |
| `Tab` | Switch the focused unit type |
| Arrow keys / screen edges / minimap | Move the camera |
| `Esc` | Cancel targeting or release the mouse |

## Run locally

Requires **Node.js 20.19+ or 22.12+** and npm.

```bash
git clone https://github.com/shuxueshuxue/sketch-rts.git
cd sketch-rts
npm ci
npm run dev
```

Open [localhost:5173](http://localhost:5173/).

| Command | Purpose |
| --- | --- |
| `npm run dev` | Game server with rooms and SDK endpoints |
| `npm run dev:static` | Local browser play without a backend |
| `npm test -- --run` | Run the test suite |
| `npm run build:production` | Build the client and server |

## Documentation

- [Developer guide](docs/development.md) — deployment, SDK, AI tools, sound packs and recording.
- [AI specification](docs/ai-spec.md) — policy architecture and behavior.
- [Skirmish review (Chinese)](docs/reviews/skirmish-naval-repair.zh.md) — screenshots, verification and known limitations.

## Credits

Inspired by Warcraft III. Developed and discussed with the [linux.do](https://linux.do/) community. See [asset credits](docs/credits.md) for sound sources, font licenses and attribution.
