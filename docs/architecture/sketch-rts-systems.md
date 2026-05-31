# Sketch RTS Systems: Small Primitives, Large Game

This codebase is trying to be the opposite of a feature pile.

The boring version of an RTS prototype is a hundred branches:

```ts
if (unit.kind === "archer") ...
if (unit.kind === "priest") ...
if (building.kind === "tower") ...
if (mapThing.kind === "mercenaryCamp") ...
```

That looks fast for one evening and then becomes a tax on every idea. Sketch RTS takes the more interesting route: a tiny set of game primitives that are strong enough to host a lot of design.

## The Kernel

The current kernel has five primitives.

1. Catalog rows describe actors.

`UNIT_DEFS` and `BUILDING_DEFS` are the first layer of truth. HP, radius, attack timing, cost, train sources, and abilities live there. A unit is not born special because a renderer or AI branch loves it. It is born as data, and the systems ask what it can do.

2. The map authors the world.

`map.ts` creates initial resources, buildings, units, landmarks, and mercenary camps. Hand-authored ids stay readable. Runtime ids start in a separate band, which prevents generated entities from shadowing authored entities.

The background texture is generated separately from gameplay truth. `terrain-texture.ts` produces deterministic sparse linework from a map scene recipe: contour bands, short hatches, and a few large silhouettes. It is intentionally low-density. Terrain should make motion legible, not compete with units, halos, projectiles, or command feedback.

Main-map and minimap drawing should not drift apart. The right abstraction is a small presentation model over world truth: object category, owner/team, position, radius/power band, and render priority. The battlefield renderer can draw detailed paper-sketch glyphs; the minimap renderer compresses those same semantic marks. Gold mines, wildling camp strength, mercenary camps, landmarks, armies, structures, and viewport all need one coordinate transform story, not duplicated guesses.

3. Commands are intent, not implementation.

The browser sends commands like `move`, `attack`, `build`, `train`, `cast`, and `hire`. The server validates the shape. The simulation owns the result. This keeps the client honest: canvas can draw beautifully, but it cannot decide combat truth.

4. Combat is a transaction.

Damage, cooldown, kill credit, projectile effects, melee thrust effects, and hit shake come from the same resolver. A tower shot and a mercenary strike are different catalog values, not different metaphysics.

5. Neutral map features are first-class.

A mercenary camp is not a disguised building and not an AI cheat. It is a world object with position, stock, cooldown, cost, and a `hireKind`. AI and player commands can both go through the same hire primitive.

6. Races are strategy overlays, not parallel games.

`RACE_DEFS` changes composition and production intent while leaving combat, training, construction, economy, and snapshots on the same rails. A race can prefer witches before priests or build stables before archery, but it does not get a private damage resolver or a hidden economy. That is the important line: faction flavor belongs in typed intent data; shared RTS law stays shared.

7. Rooms are the product shell around matches.

Solo and LAN play must converge on one room model: user identity, slots, controller type, teams, races, map, readiness, match lifecycle, and results. A "single-player" match is not a separate code path; it is a room whose extra slots are AI. This matters because the next hard gate is a 30-slot stress match: 15 human/player slots driven by external SDK agents against 15 internal AI slots on a super-large map. The current three-owner kernel is not enough for that gate. The direction is data-driven players, slot-to-player bindings, and command routing by bound slot, so human agents and internal AI can share the same world without special doors.

AI belongs in reusable policies, not in owner names, and not inside the simulation tick. The shape is `snapshot + slot context -> ordinary commands`. A room adapter attaches the preset script stack to AI slots at match start. A human slot starts with no automatic script, but an SDK adapter can import that exact same stack and drive the slot externally through the player-command path. The preset is intentionally exported as local scripts plus an ordered stack, so a developer can replace only expansion, wrap spell casting, or reorder defense without forking the simulation. This keeps "who is playing" separate from "which policy is helping decide commands."

That is the taste target: fewer privileged concepts, more composition.

## Prose Contracts

The project should grow like a set of small modules explaining themselves, not like a stress test teaching the codebase bad habits. The 15v15 case is only a brutal reader of the system. It should not be the author.

Room owns seats. It knows users, slot controllers, teams, races, readiness, lifecycle, and results. It does not know how a footman attacks, how a browser paints a button, or whether a human slot is moved by fingers or by an SDK agent.

Match host owns runtime. It creates a simulation from a room, routes commands by player id, advances only live matches, records results, and releases ended games. It does not invent room legality and does not contain strategy.

AI policy owns intention. Given a public snapshot and a slot context, it emits ordinary commands. It is allowed to be clever; it is not allowed to become an identity. A policy can drive an internal AI slot, an SDK-controlled human slot, or a player-assist script because those are adapters, not new games.

Policy scripts are snapshot readers, not clock readers. They decide from live facts: supply pressure, missing tech, army-vs-army balance, expansion blockers, damaged allies, nearby threats, and current queues. The runtime may throttle thinking for CPU, but it should not remember "I built a barracks" as strategy state. If the barracks is gone, the next snapshot says so, and the production-building script naturally asks for another one.

Simulation owns physics and consequences, not decisions. It applies commands, resolves construction/training/movement/combat/collision/death/victory, and exposes snapshots. It does not wake up and decide to train a footman. That is a policy runtime concern above it.

SDK owns remote hands. It wraps REST into typed operations: create a room, claim a slot, start, observe, command, tick, and inspect results. It should dogfood the same command path as a human player. If a test needs a private backdoor, the architecture is probably lying.

Presentation owns semantic projection. It turns snapshots into marks: terrain, mines, wildling camp bands, mercenary camps, units, buildings, ownership, priority, and coordinates. The main canvas and minimap render different levels of detail from the same marks. They must not separately rediscover what the world means.

Savegame owns replayable truth. It captures room control metadata plus deterministic simulation state so a backend process can continue a match later through the same room host. It does not capture camera, selected units, command panels, WebSocket clients, pointer lock, or any other browser-local accident. A saved opening is a lab bench for AI policy work: hold the world fixed, vary the policy, and compare continuation.

## Example: Add A New Unit

Say we want a `skirmisher`: cheap ranged harassment, weaker than an archer, faster than a footman.

Add the kind:

```ts
export type UnitKind =
  | "worker"
  | "footman"
  | "archer"
  | "skirmisher";
```

Add the catalog row:

```ts
skirmisher: {
  hp: 72,
  speed: 3.8,
  radius: 15,
  attackDamage: 9,
  attackRange: 155,
  attackCooldown: 24,
  cost: 105,
  trainTime: 145,
  abilities: [],
}
```

Put it in a producer:

```ts
archeryRange: {
  trains: ["archer", "skirmisher"],
}
```

What changes in combat? Nothing. Ranged attack feedback already follows `attackRange > 90`, so the unit gets projectiles automatically. What changes in training? Nothing. Production already consumes `trains`. What changes in AI? Possibly one line in its composition choice, because strategy is the only thing that should care about wanting the unit.

The point is not that no code ever changes. The point is that the change lands where the new meaning lives.

## Example: Add A New Skill

Say we want `haste`: a caster gives a nearby ally a temporary speed boost.

The clean shape is:

```ts
export type AbilityKind = "heal" | "summon" | "curse" | "haste";
```

Then add status vocabulary:

```ts
export type UnitStatusEffect =
  | { type: "curse"; remaining: number }
  | { type: "haste"; remaining: number; speedBonus: number };
```

The unit gets the ability by data:

```ts
bard: {
  hp: 88,
  speed: 3.2,
  radius: 16,
  attackDamage: 5,
  attackRange: 130,
  attackCooldown: 36,
  cost: 170,
  trainTime: 210,
  abilities: ["haste"],
}
```

The only new system logic is the actual rule: applying the effect and reading it in movement. That is correct. Haste is a new mechanic, so it deserves a narrow mechanic hook. It does not deserve new training code, new networking code, new snapshot code, or special renderer ownership.

## Example: Add A Map Object

Mercenary camp is the template.

It exists as a typed world object:

```ts
{
  id: "merc-camp-crossroad",
  x: 6400,
  y: 6020,
  radius: 54,
  hireKind: "mercenary",
  cost: 185,
  stock: 5,
  cooldown: 180,
  cooldownRemaining: 0,
}
```

That gives us several things for free:

- The simulation can tick cooldowns.
- The server can validate `hire`.
- The client can draw it on the map and minimap.
- AI can buy from it without fake resources.
- Tests can assert that a hired unit actually kills something.

A future `shrine`, `market`, or `watchPost` should follow the same shape: typed map object, one command if players interact with it, one tick system if it has time, and one renderer glyph if it must be visible.

## Example: Add An Agent Scenario

API agents do not need a private map compiler for small experiments. They can reset a known map and append scenario seeds:

```ts
await sdk.reset("bareDuel", {
  scenario: {
    addResources: [{ id: "gold-agent-pocket", kind: "goldMine", x: 1500, y: 1380, amount: 1234 }],
    addMercenaryCamps: [{ id: "merc-agent-pocket", x: 1580, y: 1400, radius: 30, hireKind: "mercenary", cost: 185, stock: 2, cooldown: 90, cooldownRemaining: 0 }],
    addUnits: [{ id: "unit-agent-wildling", owner: "neutral", kind: "wildling", x: 1600, y: 1460 }],
    addBuildings: [{ id: "building-agent-farm", owner: "player", kind: "farm", x: 620, y: 640, complete: true }],
    addLandmarks: [{ id: "landmark-agent-banner", kind: "bannerStone", x: 1500, y: 1500, size: 96, rotation: 0.25 }],
  },
});
```

The important detail is what this does not do. It does not inject raw units with hand-written combat stats, hidden resources, or renderer-only props. Unit and building seeds still run through `createUnit` and `createBuilding`, so catalog stats, supply, collision, combat, selection, minimap, and SDK snapshots remain one world.

## Example: Add A Race

Say we want `moon`: cautious control, early archers, late summons.

Add the id:

```ts
export type RaceId = "grove" | "ember" | "moon";
```

Add the race row:

```ts
moon: {
  id: "moon",
  name: "Moon Cartographers",
  note: "Kites early, wins by vision and summons.",
  productionPlan: ["archeryRange", "barracks", "sanctum", "stables"],
  preferredUnits: ["archer", "summoner", "footman", "lancer", "priest"],
}
```

Then teach the local production script any genuinely new preference, such as summoner before priest. The API catalog exposes it, snapshots carry it in `players[owner].race`, and the SDK can reset a match with `{ races: { enemy: "moon" } }`.

What does not change? Commands, projectiles, XP, gold, population, pathing, minimap, construction, and victory. The race slot bends strategy; it does not fork the world.

## Why This Is Extensible

The extensibility does not come from inheritance, plugin registries, or ceremony. It comes from refusing to give random features private doors.

A thing that fights becomes a `Unit` with catalog combat values.
A thing that trains becomes a `Building` with a `trains` list.
A thing that appears on the map becomes authored map data.
A thing that changes the world becomes a command or a tick system.
A thing that hurts something goes through combat.
A thing that is visible becomes a snapshot field plus a renderer glyph.

That is the whole trick.

The result is pleasantly severe: when a new feature asks for a new branch, it has to answer a question first. Is this really a new rule, or is it just a new row of data? Most RTS content should be data. Only mechanics should be code.

## Current Proof Points

The tests now cover the kernel, not only the symptoms:

- Runtime entity ids cannot collide with authored map ids.
- SDK reset can dogfood API-agent scenario overrides for resources, mercenary camps, units, buildings, and landmarks; the simulation rejects duplicate ids and constructs units/buildings through normal catalog-backed constructors. Unit seeds also support bounded initial HP so browser and SDK proofs can stage wounded units without test-only mutation hooks.
- Ranged attacks and towers emit projectile feedback.
- Melee attacks emit lunge feedback.
- Hit targets emit hit feedback that the renderer can shake.
- AI hires mercenaries from a neutral camp using gold.
- A hired AI mercenary must participate in combat and score a kill.
- Autocast belongs to players registered as AI controllers; non-AI player casters keep their cooldowns for manual hotkeys.
- AI armies use clustered attack-move orders instead of one-unit trickle behavior.
- AI defense is a local script too: base pressure can make it place defensive towers through ordinary worker construction, and those towers use the same projectile combat resolver as player towers.
- AI objectives pressure non-base structures before core bases, then chase armies only after buildings are gone, which keeps attacks from becoming base-rush bypasses or endless staging loops.
- Race definitions are cataloged through REST/SDK, carried in snapshots, and exercised by mixed-race AI matrix runs.
- The player can select a neutral mercenary camp in the browser command surface and hire through the same `hire` command the SDK and AI use.
- The contextual command dock appears from selected game objects, not from a permanent page panel; browser YATU checks hidden/no-selection state plus worker, build-palette, production-building, caster, soldier, and mercenary-camp command sets with visible hotkey badges.
- Invalid player intents fail visibly at the input edge: browser YATU covers no-selection right-click, no-worker build hotkey, and no-unit attack-move hotkey before it proceeds into the successful command loop.
- Left-click command discipline is proven through browser YATU too: left-clicking empty ground clears selection without changing unit orders, and left-clicking a wildling creates no attack order or attack-target effect until the later right-click command.
- Right-click ground movement is separately proven as a valid player command: browser YATU checks the move status message, the unit's `move` order, the transient `move` effect record, and changed canvas pixels at the target marker.
- Right-click mining has its own gold-tinted order feedback too: the simulation emits a `mine` effect at the resource, and browser YATU checks both the effect record and changed gold pixels before waiting for the worker carried-gold mark.
- Construction and training both expose visible progress: incomplete buildings draw construction bars, queued unit production draws training bars on the producing building, and browser YATU samples both mid-state fills.
- Feedback polish is sampled as pixels, not just trusted by inspection: browser YATU checks selected-building ground halo pixels and mercenary-camp restock progress pixels after a real hire.
- Attack command feedback is differentiated on canvas: browser YATU samples red pixels for both attack-move ground markers and direct right-click target rings, then asserts the two patches are visually distinct.
- Level-up feedback is sampled in the browser too: YATU resets a tiny no-AI last-hit scenario, levels one footman through an actual attack command and tick loop, then samples the rendered gold star badge beside that unit.
- Unit symbol distinctness is proven in the real renderer, not only catalog data: browser YATU resets a no-AI glyph gallery containing every unit kind and samples each canvas patch for enough ink and a unique hash.
- Terrain linework is generated by deterministic sparse scene recipes, with tests for layer coverage, map variation, and low ink density, plus browser YATU sampling that proves the rendered canvas has visible but non-dominating texture.
- The AI-vs-AI matrix covers no-expansion, expansion, neutral, no-neutral, 1v1, 1v2, and 1v1v1 cases with CPU/memory observations; expansion maps now report and assert real expansion ownership/mining proof per active team, including the third faction in free-for-all.
- SDK fast-forward tests drive the server loop through guarded tick chunks instead of raw ad-hoc fetch loops; smoke proof reports ticks-per-wall-ms and ticks-per-CPU-ms for a full match and fails loudly if the agent-speed loop becomes too slow or too CPU-heavy.
- SDK-owned clock tests disable session/room auto-tick explicitly. A fast-forward proof is only meaningful when the SDK is the only clock advancing that runtime.
- SDK AI matrix proof dogfoods the public REST/SDK surface for external-agent match control: it resets the same no-expansion, expansion, neutral, no-neutral, 1v1, 1v2, and 1v1v1 layout classes, runs guarded fast-forward AI duels, and reports winner, spending, casualties, memory, expansion mining, neutral clearing, mercenary kills, and losing-army checks without importing the simulation directly.
- SDK-controlled player proof now has two scales: a 1v1 human-slot duel where both sides are external agents, and a 30-slot stress room where 15 human/player slots are driven by external SDK policies against 15 internal AI slots. The stress path uses batched room commands so many agents can submit ordinary player input without serializing a huge snapshot after every single command.
- Large-match performance is a simulation responsibility, not a timeout excuse: unit separation uses local buckets, and nearby target acquisition uses a per-tick unit spatial index instead of scanning the whole map for every unit.
- Browser YATU covers main menu map choice, animated menu backdrop sampling, build placement, training, attack-move, direct right-click attack, neutral camp fighting, manual summon/heal/curse hotkeys with visible effects, enemy AI autocast/attack feedback, minimap viewport dragging with rendered-view hash change, and mercenary hiring.
- Browser brutal E2E is a separate player-surface gate, not SDK evidence: it starts the real app, selects every catalog map through the main menu by click or number key, verifies the selected map in the live browser session, samples animated menu and terrain pixels, proves the canvas suppresses browser mouse defaults, proves the virtual cursor is a top-layer input-transparent overlay above HUD UI, activates Pointer Lock from the real UI with one-click capture or visible battlefield-click fallback, proves virtual-cursor edge scrolling when the browser grants capture, drag-selects workers, clicks the actual compact command-card buttons, checks icon and bottom-right hotkey badge geometry, previews/cancels building placement, places a farm by mouse, proves left-click empty ground clears selection without issuing orders, right-clicks an enemy unit and samples the direct-attack target ring, moves the mouse to the viewport edge to prove camera scrolling, and clicks the minimap to prove camera movement from rendered pixels.
- Browser YATU treats Playwright `### Error` output and missing proof objects as hard script failures, so a browser-side assertion cannot quietly produce a green shell exit.

This is still a vertical slice, but it is no longer a page demo. The game is becoming a small language for RTS rules: commands, catalogs, map objects, effects, and AI scripts compose into features instead of each feature getting a private tunnel through the code.
