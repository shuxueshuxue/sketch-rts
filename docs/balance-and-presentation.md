# Balance and presentation rules

An ordinary owned unit gains one third of its unstarred attack and maximum health per star: 4/3, 5/3 and 2 times its trained/researched stats. Campaign heroes retain their campaign growth. Cumulative star thresholds are rounded 0.6, 1.3 and 2.6 times replacement cost; kill XP is rounded replacement cost / 3, increased by the victim's stars. Summoned spirits grant no XP. Neutral replacement value is food power × 36 × threat, with campaign overrides preserved.

Neutral gold is rounded to the nearest five from `(20 × food + 1.25 × food²) × threat`, with a minimum of 20. Examples: moss gnawer 20, ancient stag 130, red dragon 310. The player responsible for the final hit receives one payout and a 1.2-second coin burst showing the actual amount, including tower final hits. Defense towers deal 50% damage to neutral units before armor; shots retain this adjustment if their tower is destroyed in flight.

Production lists come from the catalog and the building owner's faction. Unit, ability and item numerical text uses shared simulation rules, including aiming rates per second, cost-dependent experience, armor, timed effects, support healing and dock repair. Selected units show current health and derived combat stats; heroes and neutral creatures do not display ordinary star progression.

World health bars appear for any injury, selection, hover, nearby combat or construction, using the same rules for all owners, ships, soldiers and structures. Healthy idle objects hide them. Green means above 50%, amber above 25%, red at or below 25%; the HUD uses the same thresholds. Unit bars sit above the rendered body. Still title-screen scenes omit world bars.

Buildings use lighter stone, wood and metal palettes, front-facing daylight with ambient light on their sides, lighter contact/cast shadows and softer outlines. The ground and water palettes support this brighter matte style. Geometry, texture density and animation counts are unchanged. `npx tsx scripts/render-presentation-review.ts /tmp/presentation-review` renders the actual world, all buildable building portraits and the bounty effect for visual review.

Ships keep a steady hull while sailing instead of inheriting the land-unit walking bounce. Movement and facing still follow the simulation; land siege wheels retain their animation.
