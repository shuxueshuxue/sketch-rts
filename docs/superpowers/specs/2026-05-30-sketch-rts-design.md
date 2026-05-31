# Sketch RTS Design

## Goal

Build a playable browser RTS vertical slice in pure TypeScript: War3-style hierarchical menu, user identity, shared room/lobby flow for solo and LAN play, large map, drag selection, gold mining, building construction, unit production, combat, neutral camps, enemy AI, minimap, match results, and API/SDK-driven automation.

## Product Shape

The game must be shaped like an RTS product, not a direct map picker. The first screen is a War3-like main menu with hierarchy: player profile, single/local play entry, LAN rooms, options/info, and exit/back navigation. Map choice lives inside room setup, not as the first thing shown on app load.

Single-player and LAN play must use the same room/match logic. A solo game is just a local room whose open slots are filled by AI controllers. A LAN game is the same room object with one or more slots claimed by human clients on the network. No duplicated "solo-only" match path is allowed for start, map selection, player slots, AI slots, teams, race choice, match start, match end, or cleanup.

The first networked slice may map room slots onto the simulation's currently supported player ids, but the room model must be slot-based and n-vs-n-shaped. A room slot has stable id, display name, controller type (`human`, `ai`, `closed`, or `open`), team, race, ready state, and an optional bound user id. The UI must support creating a room, joining a room, leaving a room, choosing map, configuring human/AI/open/closed slots, setting teams, setting races, and starting matches. The implementation should not bake "1v1 only" into UI or server contracts.

Hard scale requirement: the architecture must ultimately support a super-large map with 30 active slots arranged as 15 vs 15. In this stress match, 15 slots are human/player slots and 15 slots are internal AI slots. For automation, the human/player slots may be played by external AI agents, but they must still be represented and controlled as human slots: the agents read snapshots and submit ordinary player commands through the public room/SDK/player-command path. They must not be registered as internal simulation AI controllers. This requirement exists to force the player model, teams, command routing, map spawning, AI orchestration, UI slot list, results screen, SDK, and tests to become genuinely data-driven rather than hardcoded around `player/enemy/enemy2`.

The same scale gate must also prove intuitive numerical advantage. After the 15 human-agent slots vs 15 internal-AI slots case is competitively even, the identical stress machinery must run 20 vs 10 and 10 vs 20 variants. In both uneven variants, the larger side should reliably crush the smaller side under the same command-path rules, without the smaller side winning through adapter quirks, base-rush pathology, idle-army bugs, or map-spawn bias. This is a required sanity check: equal scripts should look close when force counts are equal, and lopsided when force counts are lopsided.

User identity is lightweight and LAN-friendly. The browser stores a generated user id and editable player name in `localStorage`, reuses them across reloads, and sends them to the server when creating or joining rooms. There is no account/password system in this slice.

When a match ends, the client shows a results screen instead of silently freezing on the battlefield. Results include winner, duration/ticks, each player/slot, team, race, controller type, gold spent, units killed/lost, buildings destroyed, neutral kills, mercenary kills, and a return-to-room/main-menu action. Ending a match must release room/match resources cleanly: old intervals, stale sockets, selected state, command modes, and match-owned simulation references must not leak into the next room or match.

## Game Contract

The game is a deterministic simulation. The server owns the world, advances fixed ticks, accepts player commands, and broadcasts snapshots. The browser renders snapshots and sends commands. The client may smooth motion visually, but it does not decide economy, combat, production, construction, or AI truth.

The formal victory condition is building elimination: a side loses when it has no buildings left. Remaining army is deliberately not part of the rule-level victory condition, because a player-facing RTS should not keep a dead base alive forever because a few units escaped. However, tests must inspect defeated-side remaining army as a strategic quality signal. If the losing side still has a substantial unused army when its buildings are destroyed, the match may be legally over but the AI behavior is not acceptable; it likely failed to defend, regroup, or trade armies before base destruction.

The simulation must be structured as game systems, not a pile of page-specific branches. Adding a unit, skill, neutral map feature, or map layout should mostly mean extending typed data plus one narrow system hook when the mechanic is genuinely new. The acceptance artifact for this architecture is a technical document with a Hacker News flavor: concrete, opinionated, and example-driven. It must explain why the system is extensible and show how to add a new unit, a new skill, and a new map object without weakening the existing RTS specs.

The game must expose a REST API and a TypeScript SDK for external programmatic control. The target user is an API agent that can create/reset matches, choose maps, read snapshots, send commands, inspect catalogs/scenarios, control simulation speed/ticks, and eventually provide custom game/scenario extensions. The SDK should wrap REST calls with typed helpers instead of leaking raw fetch calls into tests or tools. Package boundaries matter: shared simulation/catalog/types stay independent, server owns HTTP/WebSocket/session hosting, client owns browser rendering/input, and SDK owns external automation/control. SDK-based tests are allowed and encouraged for part of the automation surface, but they do not replace real frontend E2E for player controls and rendering. The project must dogfood its own SDK: agent-facing automation, API smoke tests, and non-UI programmatic control tests should use SDK helpers rather than one-off raw `fetch`, unless the test is specifically about transport failure behavior.

SDK tests may freely control simulation speed and fast-forward the game, including near-instant full-match loops. That power comes with a hard discipline: fast-forward endpoints/tests must track tick budgets, wall-clock budgets, and basic CPU/process observations so a bad loop cannot silently burn the machine. `/api/tick` must return elapsed time, CPU time, and memory observations for the tick batch. The SDK must expose a guarded chunked fast-forward helper that stops on a caller-provided condition or fails loudly when tick, wall-clock, or CPU budgets are exceeded. When an SDK test owns the clock, server background auto-tick must be disabled for that match/session; otherwise the test is lying about controlled time. This is also an architecture pressure test. If the simulation core is elegant and efficient, SDK-driven match tests should be able to run almost arbitrarily fast without leaks or runaway CPU; if they cannot, the loop design needs optimization rather than a slower timeout.

The REST API and SDK must grow from match control into lobby/room control. Required capabilities: get/set local user profile, list rooms, create room, join room, leave room, update slot controller/team/race/ready state, start match, observe room/match state, send player commands for the bound slot, fast-forward a specific room match under budget, and retrieve final results. Browser E2E may still use REST/SDK to seed or accelerate a scenario, but any claim about the visible room flow, user profile persistence, joining/creating rooms, slot editing, match start, gameplay surface, or results screen must be proven through the real browser UI.

API-agent control must support "AI as a human player's hands." That means an automation can go through the same end-to-end room flow as a real person, claim a human slot, start the match, read snapshots, decide commands with an AI policy, submit those commands through the player command path, optionally drive ticks quickly through the SDK, and still let the browser show the real match and results screen. This is different from simulation-owned AI controllers: some players are controlled by in-game AI scripts, while SDK/browser-driven players are human slots whose inputs are produced by an external AI agent. The architecture is considered successful only if this dogfooded flow can finish a match efficiently and surface the same visible settlement UI a human would see.

There is no fog of war in the current slice. AI and SDK agents operate on full public snapshots. If fog is added later, it must be a new visibility layer over the same player-command architecture, not an excuse to split AI into another hidden simulation path.

AI scripts must be reusable policies, not identities. The built-in game AI is a preset policy/controller stack that can be run against any commandable slot: an internal AI slot, a human/player slot controlled by an external agent, or a human slot where the player wants script assistance. The policy reads public snapshots plus its controlled slot metadata and emits ordinary game commands. It must not depend on being `enemy`, `player`, or an internal simulation AI owner. Developers should be able to run the preset policy for their own units, watch the game in the browser, and still add manual commands on top; manual player commands should coexist with or override script-issued orders through the same player-command path. Custom developer AI policies should be pluggable without changing simulation internals.

Computer players and human players differ only at the controller adapter layer. At match start, a room slot whose controller is `ai` gets the preset bot script attached by the game/room host. A room slot whose controller is `human` starts with no automatic in-game script; a real player can drive it through browser input, or an external SDK agent can import exactly the same preset script stack and submit commands for that human slot through the public player-command path. The preset must be exported as composable script modules, not only as one opaque black-box function, so developers can import, remove, reorder, wrap, or replace local scripts such as economy, defense, expansion, spell use, or attack-wave orchestration.

AI scripts are versioned product surface. The first stable version is `v1`: the current migrated preset, after small stability fixes needed for normal 1v1/1v2/FFA and room/SDK parity. New strategy work happens in named versions such as `v2`, not by silently mutating old behavior and making old test evidence impossible to interpret. A version is a composable script stack plus any version-specific local scripts/parameters; it is selected by id through the same room host and SDK policy entrypoints. Internal computer players and external human-slot agents must be able to import and run the same version id.

`v2` is not accepted merely because it is newer. Its acceptance gate is adversarial and intentionally pressures the whole game system, not just script tuning: one `v2` player must beat two `v1` players across ten distinct evaluation maps/scenarios, and the result must hold under internal-only, external-only, and mixed internal/external control adapters with at least 90% success in each class. Draws, stalemates, and timeouts count as failures. Each test match has a 40-minute human-time simulation budget used only for development verification and runaway-loop protection; it is not a formal player-facing match timer. Exceeding this budget means pacing, victory conditions, efficiency, or AI robustness is not good enough. If the existing roster and map content make this impossible without cheating, the game must grow real strategic depth instead of adding hidden bonuses: more unit diversity, mercenary diversity, wildling diversity, buildings, tech-tree choices, economy choices, map objectives, and unit-control skill ceilings are all valid ways to create room for a smarter script to win. The proof must report maps, controller adapters, AI versions, teams, races, ticks, kills/losses, gold spent, expansions, mercenary usage, timeout status, and winner.

The v2 gate must be fair. No AI version may receive hidden stats, extra starting workers, extra resources, free vision beyond the shared full-info snapshot, cheaper units, altered build times, privileged command APIs, or out-of-band simulation control. Initial resources, unit/building definitions, map objects, supply rules, command cooldowns, and tick cadence must be identical for v1 and v2 unless the game system itself has been openly expanded for everyone. If testing reveals a fatal v1 bug or an adapter bug that v2 can exploit, fix the bug first and rerun the gate; v2 must beat a strong healthy v1, not farm a broken opponent.

Before v2 strategy work continues, the grand stress gates must be stable: equal 15v15 must finish as a competitive fight, and asymmetric 20v10 / 10v20 must finish as decisive numerical-advantage wins. Only after those foundations are reliable should v2 add higher-level semantic tactics.

Required v2 semantic tactics:
- Early harassment: send small raiding groups; if the enemy camp has little army presence, target workers; if a larger defending force responds, retreat instead of donating the raid.
- Skirmish disengage and preservation: in open-field fights outside bases, detect disadvantage and retreat toward safety; wounded ranged units should kite/pull behind the line, while wounded melee units should retreat home for recovery or receive priority from healers.
- Expansion fallback: when fighting near owned mining locations and the main army becomes disadvantaged, retreat to a friendly expansion if one exists rather than collapsing all the way to the main base.
- Economic catch-up: if the opponent's economy is developing faster, prioritize multiple expansions with tower protection instead of matching the opponent's army plan blindly.

These behaviors must be explicit, named, and counted during matches. The gauntlet report must include harassment attempts, worker kills from harassment, successful raid retreats, disadvantaged-skirmish retreats, wounded-unit saves, expansion fallback retreats, economic catch-up expansion/tower decisions, and the resulting win/loss. Each behavior needs an A/B test: v2 with the behavior enabled versus v2 with that behavior disabled under identical fair starting conditions. A behavior is accepted only if the A/B result shows a real win-rate improvement; cosmetic command churn is not enough.

AI strategy must be condition-driven and mostly stateless. Scripts should branch on current snapshot facts: allied/enemy army size and composition, town halls and expansion mines, neutral camp blockers, current tech buildings, population cap/usage, training queues, gold reserves, damaged allies, enemy pressure near bases, and team ownership. They must not use "at tick/time X, do Y" build orders as the core logic. The runtime may keep tiny adapter state such as a think-throttle for CPU control, but strategic memory like "I already built a farm" is forbidden when the current world can answer the question better. If a farm, barracks, tower, expansion, or army is destroyed, the next policy pass must recover from the current snapshot rather than trusting stale memory.

The simulation layer is forbidden from owning AI behavior. `stepGame` may update rules, cooldowns, construction, training, movement, combat, collision, death, and victory; it may not decide that a player should mine, build, train, hire, cast, expand, defend, or attack. All such decisions must live above the simulation in policy runtime/adapters. A room adapter may run the preset policy for slots whose controller is `ai`; an SDK adapter may run the same preset policy for human/player slots; tests may compose the same modules directly. This explicitly rejects the old RTS split where internal AI scripts and external trigger/SDK scripts are separate systems. There is one AI language: policy modules that emit ordinary player commands.

This refactor must not reduce AI capability. The migrated preset policy must preserve or improve the existing AI behaviors: worker economy, construction recovery, supply buildings, production tech path, race-aware unit choices, expansion claiming and mining, tower defense, mercenary hiring and participation, ability use for heal/summon/curse, clustered attack-move pressure, non-base target preference, neutral camp clearing, 1v1/1v2/1v1v1 robustness, mixed race matrix behavior, and 15v15 stress behavior. Any migration that merely deletes a feature to simplify the boundary is invalid.

Matches must be serializable into savegames and resumable from the backend. This is not a frontend menu requirement for the current slice; the browser does not need a visible save/load entry yet. The API/SDK must be able to capture a live room match into a versioned savegame record, list/read saved games, restore one into a new or continued room runtime, and then continue ticking/commanding it through the same public room/player-command path. A savegame contains deterministic simulation truth plus room/slot metadata needed to resume control: map, tick, players, units, buildings, resources, mercenary camps, effects if still relevant, match stats, room slots, teams, races, controller bindings, and schema version. It must not contain client-only state such as camera, selection, command mode, DOM state, socket identity, or transient UI overlays.

Savegames are an AI testing primitive. A strong opening position can be saved once and reused as a controlled starting point for many policy experiments, so tests can vary AI scripts while holding the world state constant. Save/load must therefore be deterministic enough that loading a save and running N ticks gives the same result as continuing the original game for N ticks when the same commands are supplied. Fail loudly on incompatible save versions or malformed save data; do not silently fall back to a fresh match.

Debug replay is required infrastructure. When enabled, a match records its initial savegame plus the ordered command batches applied at each simulation tick/chunk, including which adapter produced them (`browser`, `sdk-agent`, `internal-ai`, or test harness). A debug replay can restore the initial save, replay commands deterministically, and seek or rebuild to any recorded tick for inspection. This powers AI debugging, future spectator/replay UX, and small-scene regression extraction: a failed 15v15 frame can become a save-backed micro-scenario instead of forcing every test to rerun the whole match from tick 0. Replay recording must remain optional so normal matches do not pay unnecessary memory cost.

Replay mode records commands, not rendered pixels. It must capture every player-visible command through the ordinary player command path, plus internal preset-AI commands after they have been emitted by the same policy modules used by SDK agents. A replay trace is a deterministic program: initial save, tick/chunk boundaries, ordered command batches, adapter/source metadata, and optional checkpoints for fast seek. Seeking to an arbitrary frame may rebuild from the nearest checkpoint, but the observed game state at that frame must match a straight replay from tick 0. This is also the contract for future录像功能: the browser may later render a replay timeline, but the authoritative artifact is the command log plus save checkpoints.

The SDK must include a small-theater scene API for AI and combat debugging. A test author should be able to describe a scene as a few fluent, readable statements: map, players/teams/races, AI slots, town halls, towers, gold mines, wildling or mercenary camps, units with optional HP, and landmarks. The scene builder must emit the same `GameSetupOptions`/scenario override used by the server, create an in-process game for fast unit tests, create a savegame for backend continuation, and create an initial debug replay trace. This is not a separate toy simulator; it is a pleasant frontend to the real simulation inputs. Replay extraction and scene builder together should let a failed 15v15 frame become a named save-backed micro-scene that can be replayed and mutated quickly.

## Lobby, Rooms, And Match Lifecycle

The main menu has layers:

- Home: shows the saved player profile, primary play entry, LAN room browser entry, and compact status for server/LAN availability.
- Profile: edit display name and regenerate local user id only through an explicit action.
- Room browser: list LAN-visible rooms with room name, map, slots, status, and join action.
- Room setup: configure map, slots, teams, races, human/AI/open/closed controllers, ready/start actions, and room chat/status messages if useful.
- In match: battlefield UI.
- Results: post-match settlement and actions to return to room, replay with same setup, or go back to home.

Room state is server-owned. The browser may cache the local user's identity and last chosen preferences, but it does not authoritatively decide who is in a room, whether a slot is legal, or when a match has started. WebSocket snapshots must include enough room/match state for all connected clients to render the same lobby and results.

Rooms have explicit lifecycle states: `open`, `starting`, `inMatch`, `ended`, and `closed`. Starting a match freezes the room setup, creates one simulation instance for that room, binds slots to simulation player ids/controllers, and moves clients to the battlefield. Ending a match records immutable results, releases match-owned runtime state, and returns the room to an inspectable ended state. Leaving/closing a room must cleanly detach clients and stop unused match ticking.

Savegame lifecycle is backend-owned and parallel to room lifecycle. Saving a match records a durable, versioned save object without pausing or mutating the live match. Continuing a save creates a new live room runtime or explicitly replaces a target room runtime; either way the resumed match must be visible to SDK/API control as a normal room match. Save ids and metadata should include map, tick, created time, room name, slot summary, and optional test label so AI experiments can find stable baselines.

Slot legality must be data-driven. A match can start when every enabled slot is either human-ready or AI, teams are valid, at least two opposing teams are active, and the chosen map supports the active slot count. Closed slots do not participate. Open slots are joinable before start and invalid at start unless the host closes or fills them.

The server may run multiple rooms, but only active matches should tick. Idle/open/ended rooms must not burn CPU. Match tick loops should be per-room and disposable, or driven from one scheduler that only advances active matches. Memory and listener cleanup are part of acceptance, not polish.

For iterative playtesting, the project supports a sidecar LAN build workflow. Before asking the user to try a branch, build the app, then start an isolated LAN listener on a sidecar port rather than disturbing the main development port. The port must leave room for the Vite HMR companion port (`port + 20000`), so a safe default is `34573`; very high ports such as `59600` are invalid because the HMR offset exceeds the socket range. The agent should report both the local URL and the Wi-Fi/LAN URL, keep the sidecar server running while the user is actively playing, and only kill it when asked or when the playtest window is over.

## Map

The standard sample map is about one quarter of the original large prototype size: `4096 x 4096` world units unless a specific stress map says otherwise. It contains two starting bases, multiple gold mines, several neutral monster camps, at least one neutral mercenary camp, light doodle terrain marks, and enough distance that the minimap matters without making every match a marathon. The player camera starts near the friendly base. The game starts at a main menu with map selection inside room setup; choosing a map must reset the server-owned simulation to that real scenario. The menu background must be dynamic and artistic in the game's grass-paper sketch language, not a generic static panel.

A required stress scenario is a super-large 15v15 battlefield. It must have enough start locations, gold economy, expansion space, lanes, neutral camps, mercenary camps, terrain landmarks, and minimap legibility for 30 active slots. The map must not simply multiply empty distance; it needs strategic structure so group AI and external-agent human slots can expand, collide, reinforce, and eventually produce a result without degenerating into idle wandering or one-base rushes.

Main-map and minimap rendering must share a presentation model. Map authors and systems should describe world objects once, with semantic categories such as terrain contour, road, grove, ridge, ruin, ditch, mine scar, gold mine, green/orange/red wildling camp, mercenary camp, player building, player army, enemy building, enemy army, neutral unit, and viewport. The main renderer can draw expressive sketch glyphs; the minimap renderer draws compressed marks. Both must derive from the same coordinates, ownership/team colors, and object categories so a camp, expansion, lane, or landmark visible on the battlefield has a faithful minimap counterpart.

## Entities

- At least 10 distinct unit kinds with readable battlefield roles and distinct sketch symbols. A bare triangle/circle is not enough.
- Multiple race slots exist as typed simulation state, not only team colors. Race definitions must be visible through catalog/API/SDK, carried in player snapshots, and able to influence condition-driven AI production preferences without bypassing common unit/building/combat systems.
- At least 5 distinct building kinds.
- `worker`: mines gold, constructs buildings, weak combat, does not auto-attack while idle.
- Core military units include melee, ranged, cavalry, siege/heavy, and caster roles.
- Casters include healing, summoning, and curse-style abilities.
- `townHall`: stores gold, trains workers.
- Production buildings train different unit families.
- Defensive tower exists as a buildable non-base building and automatically attacks enemies.
- Population/supply exists. Combat units and workers consume population. A population building raises the cap. Training must fail loudly when population is capped instead of silently queueing.
- `goldMine`: finite gold resource.
- `wildling`: neutral monster defending camps.
- Wildlings must have at least 5 distinct neutral unit kinds, not one generic creep reskin. Wildling balance uses food-equivalent combat value inspired by Warcraft 3 creep design: each wildling has a `creepFoodPower` roughly equal to the population value of a similarly threatening army unit, and a camp's danger is the sum of its members' `creepFoodPower`. Reference camp bands are green 1-9 total power, orange 10-19, and red 20+. The exact stats are ours, but the map/balance language should let designers say "this expansion is guarded by a 14-power orange camp" and have that mean something stable.
- Wildling camp strength must be visible on both the main map and minimap. Green/orange/red camp marks should communicate food-equivalent danger without requiring the player to click every monster. The minimap can use small ring/mark variants, but the colors/shapes must correspond to the same camp-power bands used by the main-map renderer and AI/map logic.
- Required wildling roster:
  - `mossGnawer`, power 1: small melee pack creature, fast, low HP, teaches early focus fire.
  - `thornSlinger`, power 2: light ranged pierce unit, punishes workers/casters if ignored.
  - `barkMender`, power 2: fragile support caster with a small heal or protective pulse, forces target priority.
  - `stonebackBrute`, power 3: slow tank with high HP and a short windup slam, anchors orange camps.
  - `gladeWitch`, power 3: curse/slow caster, medium HP, makes mixed camps tactically different from raw DPS checks.
  - `ancientStag`, power 5: red-camp leader with aura or charge behavior, not common near starting bases.
- `mercenaryCamp`: neutral hire point with finite stock/cooldown. Hiring costs gold, creates mercenary units at the camp, and must be visible on the map/minimap.
- `mercenary`: hired combat unit. It is not trained from a player production building.

Unit training and building construction must expose progress bars in the UI. A player needs to see that a building is constructing, a unit is being trained, and roughly how long remains.

Every non-neutral soldier tracks experience. Experience is awarded only to the unit that personally lands the killing blow on an enemy unit; nearby allies, issued-command owners, towers, and assists do not receive that XP. When enough XP is reached, the unit levels up, shows a small star beside the symbol, and gains limited stats for balance. Early tuning should keep level bonuses modest, e.g. small HP/damage improvements rather than snowballing hero growth.

## Commands

- Select by click or drag box.
- Left click only selects. It must not issue move/attack/mine orders.
- Right-click ground to move.
- Right-click enemy or wildling to attack.
- Right-click gold mine with workers to mine.
- Attack-move with `A` then ground click.
- Keyboard shortcuts for build mode, building placement, training, and spells.
- Build commands require selecting a worker, entering build placement, and choosing the location on the map. Buildings must not appear at a hidden automatic location.
- Train commands require selecting the relevant completed building.
- Ability commands require selecting a unit with that ability.
- Build hotkeys must work like RTS/War3-style command cards: select worker, press build hotkey, press building hotkey or command-card button, choose a map placement point.
- Click minimap to move camera.
- The minimap viewport rectangle must be draggable, not only click-to-jump.
- The minimap must be a coherent semantic projection of the main map, not a disconnected debug overlay. Terrain bands, decorative landmarks, roads/ridges/ruins/ditches, gold mines, neutral camps, wildling camp strength, mercenary camps, buildings, units, team ownership, and the camera viewport must line up with the main-world coordinates and use consistent visual categories. Scale may simplify shapes, but it must not invent or omit categories in a way that misleads the player.
- Moving the mouse to the viewport edge must scroll the camera continuously, RTS-style. This is a player camera control and must be verified in browser E2E.
- Pointer Lock mode must be available from an explicit player action. Clicking the lock button must immediately attempt browser pointer capture; if the browser requires a direct battlefield activation, the UI must visibly fall back to a single battlefield click. In this mode the browser cursor is locked, the game draws a virtual cursor above all HUD UI, and the same RTS inputs plus edge scrolling use that virtual cursor. Escape must release the browser pointer lock.
- The battlefield canvas must suppress browser default mouse gestures for RTS inputs, including right-click context menus, middle/right auxiliary clicks, drag gestures, and touch panning.
- A valid movement, attack, build placement, or spell command produces a visible sketch effect marker.
- Left click only selects or places an explicit pending build/spell target. It must not secretly issue ordinary move, mine, or attack orders.
- Right click is the contextual command surface for move, attack, and mine.
- The command UI must be compact and contextual. The old always-visible large bottom-left panel is forbidden. Command buttons appear only when a selected unit/building can use them, use small icon buttons, and show the hotkey in the bottom-right corner.
- Feedback polish is a gameplay requirement. Workers carrying gold need a carried-gold mark. Selected units keep the existing pseudo-3D halo. Selected buildings need their own pseudo-3D ground halo. Direct attack orders need a flashing target ring distinct from attack-move ground markers. Move, attack, attack-move, mine, build, train, spell, invalid command, minimap drag, construction, production, carried resources, cooldown/restock, and combat impact feedback must be audited before completion.

## AI

The enemy AI loops through strategic needs: mine gold, train workers, build production, build defensive towers, expand to gold mines, clear neutral camps, hire mercenaries from mercenary camps, train mixed armies, cast abilities, defend base, and attack. The AI uses the same simulation primitives as the player; no hidden combat or economy shortcuts. Gold mining rate and mine capacity must be bounded so the AI cannot hide bad spending behind runaway income.

AI scripts must be structured like a small War3-style AI scripting system, not one monolithic conditional function. The architecture has three explicit layers:

- Bottom primitives: issue mine, build, train, hire, defend, attack-move, cast, and scouting intents using normal simulation rules.
- Local scripts: focused economy, production, expansion, neutral-camp clearing, mercenary hiring, defense, and attack-wave scripts. Each local script owns a narrow concern and can be tested/read independently.
- Top orchestrator: periodically evaluates game state, picks which local scripts to run, and coordinates army groups so scripts do not fight each other.

This structure is required so future races/maps can swap local scripts or orchestrator weights without rewriting combat/economy primitives. AI scripts are condition-driven, not timeline scripts. Tick/time may throttle how often the orchestrator thinks, but strategy must come from state predicates such as low workers, low supply, missing production, army size, enemy pressure, available mercenary camp, exposed expansion, or nearby neutral camp. Hardcoded "at time 5 do X, at time 10 do Y" scripting is forbidden because it is brittle against map, economy, combat, and player variance.

Those AI layers must be available as reusable policy code. Internal simulation AI may use the same policy, but the policy itself belongs to a command-producing layer that can also run in the SDK. The clean mental model is: snapshot in, slot context in, commands out. Whether those commands are submitted by the server for an internal AI slot or by an SDK process for a human/player slot is an adapter decision, not a different strategy implementation.

AI army movement must be group-commanded. It should gather a force and issue wave/cluster orders to the group instead of sending one unit at a time as soon as that unit exists. Attacks should advance like attack-move along lanes or waypoints, fighting nearby units and structures on the way. AI should not issue a single straight-line order to suicide rush the enemy main base while ignoring enemies along the route.

Combat units, including AI units, must react to nearby enemies while idle or moving under attack-move style orders. Workers are excluded from idle auto-attack. Army units should not stand beside enemies doing nothing.

Attack target selection has explicit weighted priority, not a brittle absolute list. Ordinary combat and attack-move should generally prefer enemy soldiers first, then defensive towers, then workers, then non-base buildings, and only then main/base structures, but distance is part of the score so a far-away soldier does not always override a dangerous close target. The score may also include low-HP finishing value, threat level, fragile high-damage units, healers, control casters, and defensive-tower pressure. This prevents "mechanically A the base" behavior where attackers ignore the defending army. Early harassment is a named exception: harassment groups may prioritize workers when the enemy camp is lightly defended, but must retreat if a larger defending army responds.

The long-run quality gate is AI-vs-AI simulation. Two or more AIs must be able to run on changed map layouts: with expansions, without expansions, with neutral camps, without neutral camps, 1v1, 1v2, and 1v1v1. Expected proof signals: all sides spend gold, train armies, clear camps when camps exist, expand when expansions exist, fight, suffer large casualties, lose non-base buildings, and eventually produce a winner. After adding a new race slot, the same matrix must pass again as mixed-race cases, and the report must show which races each active player used.

Each AI test match has a hard development-time timeout budget. Exceeding that means the game pacing or AI design is wrong, not that the test should wait longer. This is not a formal limit shown to players during normal play. Test validation must also inspect remaining army state: if one side destroys the other while the defeated side still has substantial unused army strength, the AI is probably bypassing the army and rushing core structures, which is a strategic failure even though the formal building-elimination victory condition fired correctly.

Idle combat units automatically attack nearby enemy units/buildings when holding position. Workers are excluded from idle auto-attack.

Units have collision/separation. Mobile units must not be allowed to stack into one point.

## Visual Style

The game looks like a fresh grass-paper tactical sketch. The map uses paper, leaf, pencil, and faint gold colors. Units and buildings are drawn as crisp hand-symbols, not sprite assets, but each symbol needs internal detail and readable silhouette differences: tools, banners, bows, staves, horns, shields, wheels, crystals, or glyph marks as appropriate. UI is restrained and readable: resource strip, command panel, minimap, selected unit chips, command mode feedback, and placement preview.

Abilities and orders need visible effects: heal pulses, summoned chalk rings, curse marks, right-click move pips, attack marks, and build placement outlines.

Attacks need animation/feedback, not only HP changes. Melee units should visibly lunge, poke, or deform toward the target. Hit targets should visibly shake or flash. Ranged attacks and towers need visible projectiles traveling from attacker to target. Every player operation should have corresponding feedback: selection, move, attack, attack-move, mine, build placement, train queue, spell target, spell cast, invalid command, and minimap drag.

Command UI must be contextual, not a permanent pile of buttons. Build commands appear only when workers are selected. Train commands appear only when the correct completed production building is selected. Spell commands appear only when a unit with that spell is selected.

The map must include enough terrain and decoration reference points to make camera/unit motion readable: paths, groves, ridges, ruins, water/ditch lines, camp markings, mine scars, and large asymmetrical landmarks. Units should never look like they are walking over an empty repeating void.

Map texture should be generated by an explicit sparse-line algorithm, not by noisy decorative tiling. The target is a restrained "Worms-like terrain silhouette turned into grass-paper linework": readable hills, cliffs, ruins, iconic scenic silhouettes, and foreground/background strokes, but reduced to sparse contours and pale earth/leaf/gold ink. It may derive inspiration from famous classical scenes or paintings, but the game should abstract them into original contour fields rather than copying a source image. The algorithm should support scene recipes: contour bands, landmark silhouettes, hatch density, color wash, line jitter, and negative space. Texture density must stay low enough that units, selection halos, projectiles, resources, camps, and minimap readability remain dominant.

## Multiplayer And Agent-Controlled E2E Testing

The room system must be tested as an end-to-end product flow, not only as HTTP handlers. Browser E2E must cover: first-load profile creation in `localStorage`, player name persistence after reload, creating a local/solo room, filling enemy slots with AI, choosing map, starting the match, reaching the battlefield, ending the match, seeing the results screen, and returning to room/home without stale match state.

LAN-style E2E must cover at least two browser contexts with different local users: one creates a room, the other joins, the host assigns teams/AI/closed slots, both clients observe synchronized room state, the match starts, both reach the battlefield, and the room reaches results. When headless browser constraints make real multi-device LAN unnecessary, two isolated browser contexts against the LAN-capable server count as the local proof; a manual LAN smoke URL may be reported separately.

Agent-player E2E must dogfood the SDK and room API. The test creates or joins a room through public APIs, claims one or more human slots for SDK-controlled agents, starts a match through the same room start path, uses an AI policy outside the simulation to read snapshots and issue ordinary player commands for those human slots, fast-forwards ticks under CPU/wall/memory budgets, and verifies the browser-visible results screen at the end. This proves that external agents can customize/control the game without bypassing the player surface.

AI-vs-AI simulation remains important, but it is not enough for the new flow. A green multiplayer/room claim requires both room API/SDK proof and browser proof. A green "agent controlled human" claim requires that the agent-controlled side is not registered as an internal simulation AI controller for that slot.

The 15v15 stress E2E is a hard gate for the scalable architecture. It creates a super-large map room with 30 active slots: 15 human/player slots on one team and 15 internal AI slots on the other. The 15 human slots are driven by external AI agents through the same SDK/player-command path a human client would use. The test must start from room setup, run the match under guarded fast-forward budgets, record CPU and memory observations, reach a valid winner/results state, and verify the visible browser settlement screen. Passing smaller AI-vs-AI matrices does not satisfy this requirement. After that equal-force case is demonstrably balanced, the same harness must run asymmetric 20v10 and 10v20 cases and prove the side with 20 active commandable slots wins decisively in each direction.

External SDK agents and internal room-host AI agents must be competitively equivalent when they import the same preset script at the same decision cadence. A single fixed-side result is not sufficient evidence because map geometry, starting resources, and spawn side can bias RTS outcomes. Fairness proof must include mirrored or repeated matches and should target roughly even results over a small sample, e.g. neither control path wins more than 7 of 10 mirror trials without an explained map/race imbalance. If one path consistently crushes the other while using the same script, treat it as an architecture bug in command timing, batching, setup parity, map layout, or adapter semantics.

## Testing

Simulation tests are the core safety net: roster/building minimums, mining, construction, production, tower attacks, unit collision, combat, abilities, AI autocast, AI spending, AI expansion, neutral camp clearing, AI mercenary hiring/participation, AI-vs-AI variants, and map scale. Browser YATU verifies the real player loop: load page, drag select workers, mine gold, enter build mode via hotkey, place a building, select the building, train via hotkey, right-click movement/attack, attack-move ground, cast skills via hotkeys, fight a neutral camp, observe AI attack/autocast, and use minimap navigation.

End-to-end means the real browser player surface. It starts the app server, opens the page in a browser, uses actual DOM, mouse, keyboard, and canvas-rendered feedback, and proves the user-visible result. SDK calls, direct `/api/command`, simulation imports, or catalog assertions are not E2E. They may set up a scenario or provide supporting evidence, but any claim about player controls, UI, rendering, or feedback must be proven through browser interaction.

Test runs must clean up their background servers/browsers. Long-running verification should record basic CPU and memory observations so runaway loops and leaks are noticed early.

Before claiming completion, verification must include:

- Unit/building roster count checks.
- Population cap checks for supply use, population buildings, and capped training failure.
- XP checks proving only the last-hitting unit gains experience, levels up, shows a star, and receives only modest stat gains.
- Unit collision checks.
- Skill checks for heal, summon, curse, visible effects, and AI autocast.
- Tower auto-attack checks.
- Attack animation checks for melee lunge/hit feedback and ranged/tower projectile effects.
- AI mercenary checks proving an AI buys mercenaries from a mercenary camp and that at least one hired mercenary kills an enemy unit.
- Wildling roster and camp-power checks proving at least 5 neutral monster kinds exist, each has a food-equivalent `creepFoodPower`, and green/orange/red camp totals fit the documented bands.
- Main-map/minimap alignment checks proving terrain/decorations, gold mines, wildling camp strength, mercenary camps, units, buildings, ownership/team colors, and viewport all come from the same semantic world model and coordinate transform.
- Player-control E2E checks for left-click selection, right-click commands, browser-gesture suppression, attack-move, build placement hotkeys, train hotkeys, spell hotkeys, progress bars, minimap, edge-scroll camera movement, Pointer Lock one-click capture/fallback, Pointer Lock virtual cursor movement, and command effects.
- Main-menu E2E checks for animated background, real map selection, and starting a selected map.
- Feedback-audit checks for worker carried-gold marks, building selection halo, distinct direct-attack and attack-move markers, and command/state feedback coverage.
- Map-texture checks for sparse readable linework, scene-recipe variation, restrained colors, and no loss of unit/control readability.
- Main-menu/lobby checks proving the first screen is hierarchical, not direct map selection.
- User-profile checks proving localStorage creates, persists, edits, and reuses user id/display name.
- Room-flow E2E checks proving solo and LAN-style matches use the same create/join/configure/start room path.
- Slot-configuration checks proving human, AI, open, and closed slots; team/race selection; ready state; and start legality.
- Results-screen checks proving winner, player/slot stats, duration, teams, races, controller types, and return/replay actions are visible after match end.
- Match cleanup checks proving ended/closed rooms stop ticking, detach stale sockets/listeners, clear client selection/command state, and do not leak old simulation references into the next match.
- Agent-player E2E checks proving an external SDK-driven AI can occupy a human slot, issue ordinary player commands, drive ticks under budget, finish a match, and surface the browser results screen.
- SDK AI policy checks proving the shipped preset AI policy can command both internal AI slots and human/player slots through adapters, and that a browser-visible human slot can run the script while still accepting extra/manual player commands.
- 15v15 stress E2E checks proving a super-large map can host 15 SDK-agent-controlled human/player slots against 15 internal AI slots, run through the public room flow, finish under tick/wall/CPU/memory budgets, and show the real results screen.
- 20v10 and 10v20 stress checks proving the same scalable room/SDK/AI harness produces decisive wins for the numerically larger side in both directions after the equal 15v15 case has been made competitively even.
- AI-vs-AI matrix checks for maps with expansions, without expansions, with neutral camps, without neutral camps, 1v1, 1v2, and 1v1v1.
- AI-vs-AI match timeout checks: each simulated match must resolve within the configured development-time test budget, and victory must not occur while the defeated side still has a large idle army.
- Resource-use checks proving AI spends gold instead of floating excessive reserves.
- Cleanup checks proving test servers/browsers are closed after E2E.
- REST/SDK checks proving an external program can reset/select maps, inspect state/catalogs, issue commands, and drive part of the test suite through typed SDK calls.
- SDK fast-forward checks proving external automation can control simulation speed/tick loops with explicit tick, wall-clock, CPU, and memory safeguards, using SDK helpers rather than ad-hoc raw fetch loops.
- Savegame API/SDK checks proving a live room match can be saved, listed, loaded into a backend runtime, continued through ordinary room/player commands and guarded tick loops, and compared against direct continuation for deterministic controlled-AI testing.
- Debug replay checks proving an enabled match records the initial save plus every browser/SDK/internal-AI/test command batch, can rebuild to a requested tick/frame, can seek from checkpoints without changing simulation truth, and can extract a failed stress-test frame into a save-backed small-scene regression.
- SDK small-theater checks proving fluent scene setup creates real `GameSetupOptions`, in-process games, savegames, and initial debug replay traces without bypassing normal simulation/map/scenario structures.
- SDK AI behavior A/B checks proving the same small-theater or save-backed scene can be run with one named behavior enabled and disabled, then scored from telemetry, ordinary command counts, and final simulation state. This is the fast inner loop before expensive full-match win-rate gauntlets.
