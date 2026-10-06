import { mkdirSync,writeFileSync } from "node:fs";
import { BUILDING_DEFS } from "../../src/shared/catalog";
import { buildingGeometry,type SiteModelKind } from "../../src/client/art/building-models";
import type { BuildingKind } from "../../src/shared/types";

// Architecture stays editable as authored primitives; Blender reconstructs all
// sides, assigns physical materials and produces the final art.
const sites:SiteModelKind[]=["citadel","shop","camp","well","statue","beacon","fort-lance","fort-flame","fort-mortar","fort-ward","fort-wall"];
const kinds=[...Object.keys(BUILDING_DEFS) as BuildingKind[],...sites];
mkdirSync(".art-build/buildings",{recursive:true});
writeFileSync(".art-build/buildings/geometry.json",JSON.stringify(Object.fromEntries(kinds.map(kind=>[kind,buildingGeometry(kind)]))));
