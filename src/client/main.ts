import { creatureShadow } from "./art/painted-creatures";
import { unitGlyphScale } from "./glyphs";
import {soundSettingsMarkup,bindSoundSettings,openMatchSettings} from './sound-settings';
import { menuPageMarkup } from "./menu-page";
import { commandIconMarkup } from "./command-icons";
import { WorldPresentation } from './world-presentation';
import { resources,resourceText } from './resources';
import { resourcePanel,disposeResourcePanel } from './resource-panel';
import { paintPortrait } from './portrait-cache';
import { SHIP_WEAPONS } from "../shared/ship-equipment";
import { EquipmentPanel } from "./equipment-panel";
import { cabinAction, cabinCommand, cabinStatus, type CabinAction } from './cabin-controls';
import { isInCabin } from '../shared/ship-cabin';
import { formatMass } from "./format-mass";
import { canEquip, ITEM_DEFS } from "../shared/equipment";
import { shipPassengers, shipProfile, localToWorld } from "../shared/ship-geometry";
import { DEFAULT_WIND, windAt, WIND_CHANGE_INTERVAL_TICKS } from '../shared/wind-field';
import { SIM_TICKS_PER_SECOND } from '../shared/time';
import { deckLoad } from "../shared/decks";
import { purchasePlacement, findPurchaseRecipient, purchaseRecipientInRange, type PurchaseSeller } from "../shared/purchase";
import "./styles.css";
import { aimingProfile } from "../shared/aiming";
import "./battle-hud.css";
import "./game-chrome.css";
import "./game-ui.css";
import { BattleHudSelection, type HudIdentity } from "./battle-hud";
import { drawAtlasBuilding, drawAtlasBuildingPortrait, drawAtlasUnitPortrait } from "./atlas-art";
import { buildPlacementCommand, type BuildPlacement, type PlacementRefusal } from "./build-placement-controls";
import { blockedFootprintCells, drawFootprint, footprintSquare } from "./footprint-view";
import { chatKeyIntent, normalizeChatText } from "./chat-controller";
import { chargeRiderFor, chargeWindow, type ChargeWindow } from "./charge-targeting";
import { abilityUnitTargetMatches, castCommandForSelection, preferredAbilityCaster, readyAbilityCasters } from "./ability-targeting";
import { abilityCommandState, autocastToggle, booleanCommandState, ENABLED_COMMAND_STATE, HIDDEN_COMMAND_STATE, mercenaryHireCommandState, sharedStance, stanceCommandState, stanceFighters, stanceMenuCommandState, trainCommandState, type CommandButtonState } from "./command-button-state";
import { BRACE_DAMAGE_SHARE, KNOCKBACK, LUNGE_PACE, MAX_SHOVE, SHOCK_DAMAGE_TAKEN } from "../shared/push";
import {
  controlGroupCenter,
  controlGroupRecallTap,
  recallControlGroup,
  replaceControlGroup,
  type ControlGroupRecallTap,
  type ControlGroups,
} from "./control-groups";
import { deploymentModeFromEnv } from "./deployment/mode";
import { createDeploymentRuntime, type MatchChat } from "./deployment/runtime";
import { createSketchRtsDebugView, type SketchRtsDebugView } from "./debug-view";
import { edgeScrollDelta } from "./edge-scroll";
import { liveSelectionIds, syncFrontendWorldView } from "./frontend-world-view";
import type { GameAdapter } from "./game-adapter";
import { gameShellMarkup } from "./game-shell";
import { buildSelectionGroups, cycleFocusedSelectionId, focusedSelectionEntities, inventoryUnitsForCommandCard, isUnitCommandPage, resolveFocusedSelectionId, selectedCargoTransports, type SelectionGroup } from "./hud-model";
import { createBrowserI18n, type LabelKey } from "./i18n";
import { carriedItemsForSelection, dropItemCommand, itemHotkeys, pickupItemCommand, useItemCommand } from "./item-controls";
import { gameplayKeyIntent } from "./keybindings";
import { isInsideRect, minimapPointToWorld, minimapViewportRectFor, shouldDragMinimap, windProbePoint } from "./minimap";
import { WindMapDisplay, projectWindDirection } from './minimap-wind';
import { drawMapPreview, mapPreview, type PreviewSeat } from "./map-preview";
import { drawMinimapMap } from "./minimap-art";
import { MENU_SCENES, MenuBackdrop } from "./menu-scenes";
import { Soundboard } from "./sound";
import { soundCues, type SoundCue } from "./sound-cues";
import { servedSoundPacks, SOUND_PACKS } from "./sound-packs";
import {
  isMicrosoftEdgeUserAgent,
  moveVirtualPointer,
  shouldBlockBattlefieldForPointerLock,
  shouldSuppressCanvasMouseDefault,
  shouldSuppressCanvasPointerGesture,
  shouldSuppressPointerLockMouseDefault,
  virtualPointerTransform,
} from "./pointer-lock";
import { RESEARCH_COMMANDS, researchCommandButtonsForSelection, researchProgressButtonsForSelection, type ResearchProgressButton } from "./research-controls";
import { buildingAt, deckMovePoint, hasAlly, pointerTarget, relationTo, targetCommand, unitAt,unitPointerPosition, type PointerTarget } from "./relations";
import { defaultRoomConfiguration, formatRoomRoute, parseRoomRoute, type RoomRoute } from "./room-route";
import { roomBrowserEntries } from "./room-browser-model";
import { roomSetupViewAction } from "./room-view-state";
import { UnitFacingTracker } from "./unit-facing";
import { UnitMotionSmoother } from "./unit-motion";
import { UnitAnimationTracker } from "./unit-animation";
import { abilityTooltip, buildingTooltip, formatTooltipDataset, itemTooltip, unitSelectionTooltip, unitTooltip, upgradeTooltip, veteranSkillTooltip, withTooltipRequirement, type GameplayTooltip } from "./tooltips";
import { canLearnVeteranSkill, learnVeteranSkillCommand, nextVeteranStudent, veteranPeers, veteranStudent } from "./veteran-controls";
import { VETERAN_SKILLS } from "../shared/veteran-skills";
import { trainingProgressButtonsForSelection, type TrainingProgressButton } from "./training-queue";
import { newUserId } from "./user-profile";
import { playerDisplayName } from "./player-name";
import { applySelectionPick, selectInScreenBox, selectNearbySameKindUnits, type ScreenRect as SelectionScreenRect } from "./selection-controls";
import { buildingGlyphSize, drawPaperMap, drawWorld, ownerInk, worldLabelsFor } from "./world-renderer";
import { virtualClickableTargetFromElement, virtualContextTargetFromElement, virtualTooltipTargetFromElement } from "./virtual-ui";
import { canAutocast } from "../shared/autocast";
import { ABILITY_DEFS, ABILITY_KINDS, BUILDABLE_BUILDING_KINDS, BUILDING_DEFS, RACE_DEFS, RACE_IDS, TRAINABLE_UNIT_KINDS, UNIT_DEFS, unitRules } from "../shared/catalog";
import { carries, passengerLandingSpot } from "../shared/naval";
import { SHOP_GOODS } from "../shared/shop";
import { drawPaintedItem } from "./art/items";
import { ABILITY_CARDS } from "./content/abilities";
import { BUILDING_CARDS } from "./content/buildings";
import { TRAINED_UNIT_CARDS } from "./content/units";
import { LADDER_MAP_ID } from "../shared/map-ids";
import { MAP_POOL, poolMap, poolSeatsFit, type PoolMapId } from "../shared/map-pool";
import { createMapPresentation, type MapPresentationMark } from "../shared/presentation";
import { canStartRoom, createRoom, DEFAULT_INTERNAL_AI_VERSION, ROOM_AI_RACES, ROOM_TEAMS, roomAiVersionsFor, roomTeam, seatTeam, winningResultSlots, type SlotPatch, type CreateRoomInput } from "../shared/rooms";
import { snapToFootprint } from "../shared/terrain";
import type { AbilityKind, Building, BuildingKind, GameCommand, GameSnapshot, LocalUserProfile, MeleeStance, PlayerId, RoomState, TrainableUnitKind, Unit, UpgradeKind, WorldItem } from "../shared/types";
import type { MapId, RaceChoice, RoomAiChoice } from "../shared/types";

type Point = { x: number; y: number };
type CommandPortrait = { type: "unit"; kind: Unit["kind"] } | { type: "building"; kind: BuildingKind } | { type: "item"; kind: WorldItem["kind"] };
type ScreenRect = { x: number; y: number; width: number; height: number };
type SpellTargeting = { casterId: string; ability: AbilityKind };
type ItemTargeting = { unitId: string; itemId: string; kind: WorldItem["kind"] };
type CommandMode = { type: "attackMove" } | { type: "aim" } | { type: "unload" } | { type:"purchaseRecipient";sellerId:string } | { type: "build"; placement: BuildPlacement } | { type: "spell"; targeting: SpellTargeting } | { type: "item"; targeting: ItemTargeting };
type MenuView = "maps" | "home" | "profile" | "rooms" | "create" | "setup" | "results";

declare global {
  interface Window {
    __sketchRtsView?: SketchRtsDebugView;
  }
}

const POINTER_LOCK_GUIDE_STORAGE_KEY = "sketch-rts-pointer-lock-guide-v1";

const app = requireElement<HTMLDivElement>("#app");

type CommandButton = {
  element: HTMLButtonElement;
  hotkey: string;
  tooltip: () => GameplayTooltip;
  state: () => CommandButtonState;
  run: () => void;
  // Right-click on the button (a spell's autocast switch).
  contextAction?: () => void;
  portrait?: CommandPortrait;
};

// The command card's build and train buttons come from the building and unit cards, in catalog order.
const BUILD_COMMANDS = BUILDABLE_BUILDING_KINDS.map((kind) => ({ kind, ...BUILDING_CARDS[kind].command }));

const TRAIN_COMMANDS = TRAINABLE_UNIT_KINDS.map((kind) => ({ kind, ...TRAINED_UNIT_CARDS[kind].command }));

const SPELL_COMMANDS = ABILITY_KINDS.map((ability) => ({ ability, ...ABILITY_CARDS[ability].command }));
const HIRE_COMMAND = { icon: "⚔", hotkey: "m" } as const;
// A shop's goods, in SHOP_GOODS order: a shop selected shows no other button.
const SHOP_HOTKEYS = ["q", "w", "e", "r", "t", "y", "u", "i", "o"];
// Pinyin initials: Z 姿态 opens the stances, then Z 追击 (pursue), J 坚阵 (brace), X 陷阵 (shock); the open stance card
// hides every other button, so X does not meet a hexer's curse.
const STANCE_MENU_COMMAND = { icon: "⇄", hotkey: "z" } as const;
const STANCE_COMMANDS = [
  { stance: "pursue", icon: "»", hotkey: "z", title: "command.stance.pursue.title", body: "command.stance.pursue.body", stats: "command.stance.pursue.stats" },
  { stance: "brace", icon: "▥", hotkey: "j", title: "command.stance.brace.title", body: "command.stance.brace.body", stats: "command.stance.brace.stats" },
  { stance: "shock", icon: "⇥", hotkey: "x", title: "command.stance.shock.title", body: "command.stance.shock.body", stats: "command.stance.shock.stats" },
] as const;
const DOUBLE_CLICK_SAME_KIND_RADIUS = 900;

const i18n = createBrowserI18n();
const t = i18n.t;
const tl = i18n.label;
const worldLabels = worldLabelsFor(i18n);
document.documentElement.lang = i18n.locale;
app.innerHTML = gameShellMarkup(i18n);

const canvas = requireElement<HTMLCanvasElement>(".game-canvas");
const shell = requireElement<HTMLDivElement>(".game-shell");
const mainMenu = requireElement<HTMLDivElement>("[data-main-menu]");
const menuWindow = requireElement<HTMLDivElement>(".menu-window");
const menuTitle = requireElement<HTMLHeadingElement>("[data-menu-title]");
const menuStatus = requireElement<HTMLDivElement>("[data-menu-status]");
const mapList = requireElement<HTMLDivElement>("[data-map-list]");
const goldLabel = requireElement<HTMLSpanElement>("[data-gold]");
const supplyLabel = requireElement<HTMLSpanElement>("[data-supply]");
const statusLabel = requireElement<HTMLDivElement>("[data-status]");
const chatMessages = requireElement<HTMLDivElement>("[data-chat-messages]");
const chatForm = requireElement<HTMLFormElement>("[data-chat-form]");
const chatInput = requireElement<HTMLInputElement>("[data-chat-input]");
const controlDeck = requireElement<HTMLDivElement>(".control-deck");
const selectionLabel = requireElement<HTMLDivElement>("[data-selection]");
const mapReadout = requireElement<HTMLDivElement>("[data-map-readout]");
const forfeitButton = requireElement<HTMLButtonElement>("[data-forfeit-match]");
const hudActions = requireElement<HTMLDivElement>(".hud-actions");
const commandDock = requireElement<HTMLDivElement>("[data-command-dock]");
const itemDock = requireElement<HTMLDivElement>("[data-item-dock]");
const equipmentPanel=new EquipmentPanel(()=>i18n,sendCommand,(item,carrier)=>{if(isInCabin(carrier)){showInvalidCommand(i18n.locale==='zh'?'返回甲板后再使用物品':'Return to deck before using items');return;}if(item.cooldownRemaining>0){showInvalidCommand(t("status.itemRecharging",{item:labelKind(item.kind)}));return;}if(["lightningRod","stormStaff","breachCharge","ivoryTower"].includes(item.kind)){equipmentPanel.close();beginItemTargeting({item,carrier});}else sendCommand({type:"useItem",unitId:carrier.id,itemId:item.id});});
const tooltipLayer = requireElement<HTMLDivElement>("[data-tooltip-layer]");
const virtualPointerElement = requireElement<HTMLDivElement>("[data-virtual-pointer]");
const pointerLockGate = requireElement<HTMLDivElement>("[data-pointer-lock-gate]");
const pointerLockGateTitle = requireElement<HTMLHeadingElement>("[data-pointer-lock-gate-title]");
const pointerLockGateBody = requireElement<HTMLParagraphElement>("[data-pointer-lock-gate-body]");
const pointerLockGateAction = requireElement<HTMLButtonElement>("[data-pointer-lock-gate-action]");
const sceneSwitch = requireElement<HTMLButtonElement>("[data-scene-switch]");
const minimapFrame = requireElement<HTMLDivElement>("[data-minimap-frame]");
const minimapTab = requireElement<HTMLDivElement>("[data-minimap-tab]");
const matchMenuButton = requireElement<HTMLButtonElement>("[data-match-menu-button]");
const minimapRelationsButton = requireElement<HTMLButtonElement>("[data-minimap-relations]");
const minimapWindButton = requireElement<HTMLButtonElement>('[data-minimap-wind]');
const minimapWindArrow = requireElement<SVGElement>('[data-minimap-wind-arrow]');
const matchMenu = requireElement<HTMLDivElement>("[data-match-menu]");
const matchMenuClose = requireElement<HTMLButtonElement>("[data-match-menu-close]");
const ctx = requireCanvasContext(canvas);
const worldPresentation=new WorldPresentation(canvas);
let applicationClosed=false;
let animationFrame=0;
let visualsReady=false;
let matchAssets:Promise<void>|undefined;
const hudSelection = new BattleHudSelection(selectionLabel, t("hud.selectionTypes"));
// The home screen's scene (see @@@menu-scenes): the one the player last picked, or one drawn at random for this visit.
const MENU_SCENE_STORAGE_KEY = "sketch-rts-menu-scene";
const menuBackdrop = new MenuBackdrop(worldLabels, initialMenuScene());
// The game's sounds (see @@@sound): the packs found with the game (see @@@sound-packs) and those the server offers (see
// @@@served-sound-packs); until the player chooses one, the one a build names in VITE_SOUND_PACK, else the server's, else none.
const soundboard = new Soundboard(SOUND_PACKS, import.meta.env.VITE_SOUND_PACK);
const soundPacksLoaded=servedSoundPacks(import.meta.env.BASE_URL,async(input)=>{
  if(applicationClosed)throw new DOMException('Application was closed','AbortError');
  const url=String(input),request=resources.bytes(url,`audio-packs/${url.split('audio-packs/').at(-1)}`,'home');
  try{return new Response(await request);}finally{resources.releaseBytes(url,request);}
}).then(({ packs, fallback }) => soundboard.addPacks(packs, fallback));

let snapshot: GameSnapshot | undefined;
let currentRoom: RoomState | undefined;
let currentRoomId: string | undefined;
let localPlayerId: PlayerId = "player";
let spectatingRoom = false;
// The minimap in friend-or-foe colours (see @@@minimap-relations): as the player sets it this match, or, until they do,
// on when they have an ally.
let minimapRelations: boolean | undefined;
let minimapWind = false;
let windProbe: Point | undefined;
let windTooltipKey = '';
const windMapDisplay = new WindMapDisplay();
let activeGameAdapter: GameAdapter;
let activeChat: MatchChat | undefined;
let activeChatUnsubscribe: (() => void) | undefined;
let activeRoomUnwatch: (() => void) | undefined;
let activeRoomWatchId: string | undefined;
let localUser = loadLocalUserProfile();
let selectedIds = new Set<string>();
const unitFacing = new UnitFacingTracker();
const unitMotion = new UnitMotionSmoother();
const unitAnimation = new UnitAnimationTracker();
const reducedUnitMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let focusedSelectionId: string | undefined;
let selectedCampId: string | undefined;
let inspectedShopItem: WorldItem["kind"] | undefined;
const purchaseRecipients=new Map<string,string>();
let purchaseRecipientFlash:{id:string;until:number}|undefined;
const controlGroups: ControlGroups = {};
let lastControlGroupRecall: ControlGroupRecallTap | undefined;
let camera = { x: 560, y: 560 };
let worldZoom = 1;
let virtualMouse: Point | undefined;
let virtualTooltipTarget: HTMLElement | undefined;
let shownTooltipTarget: HTMLElement | undefined;
let virtualUiMouseDownTarget: HTMLElement | undefined;
let pointerLockArmed = false;
let pointerLockFieldClickOnError = false;
let pointerLockUnavailable = false;
let selectionStart: Point | undefined;
let selectionEnd: Point | undefined;
let lastMouse: Point | undefined;
let draggingMinimapViewport = false;
let rightPointerGestureActive = false;
let ignoreNextRightMouseUp = false;
let menuOpen = true;
let menuView: MenuView = "home";
// @@@map-chooser - The create screen is Warcraft III's custom game screen: the pool's maps listed on the left (see
// @@@map-pool), the chosen one's picture and facts on the right (see @@@map-preview).
let chosenMapId: PoolMapId = MAP_POOL[0].id;
let pendingRoomConfiguration = defaultRoomConfiguration(chosenMapId);
let routeRequest = 0;
let commandMode: CommandMode | undefined;
// The sub-card open in place of the command card: the worker's buildings, or the melee stances (see stance-buttons).
let openPalette: "build" | "stance" | "veteran" | undefined;
// Hide a submitted choice until its command frame lands; do not offer the same soldier twice in a group.
const pendingVeteranChoices = new Map<string, number>();
let pointerLockGateKind: "guide" | "required" = "guide";
const keys = new Set<string>();
const deploymentRuntime = createDeploymentRuntime(deploymentModeFromEnv(import.meta.env), {
  onRuntimeReady() {
    menuStatus.textContent = t("app.serverOnline");
    statusLabel.textContent = t("app.connectedGuide");
    renderMainMenu();
  },
  onRuntimeError(message) {
    statusLabel.innerHTML = `<span class="error">${escapeHtml(message)}</span>`;
  },
});
const baseGameAdapter = deploymentRuntime.initialAdapter();
activeGameAdapter = baseGameAdapter;
const commandButtons: CommandButton[] = [
  createVeteranLearnButton(),
  ...[0, 1, 2].map(createVeteranChoiceButton),
  createVeteranPassiveButton(),
  createCommandButton(i18n.locale === "zh" ? "下位老兵" : "Next veteran", "⇄", "n",
    () => booleanCommandState(!commandMode && (openPalette === "veteran" || !openPalette && !selectedCampId) && Boolean(nextVeteranStudent(selectedPlayerUnits().filter(unit=>!isInCabin(unit)), focusedSelectionId, pendingVeteranIds()))),
    focusNextVeteranStudent, () => ({ title: i18n.locale === "zh" ? "下位待学习老兵" : "Next veteran awaiting a skill", body: i18n.locale === "zh" ? "在当前选中的同兵种单位中，切换到下一名尚未学习技能的三星老兵。" : "Focus the next selected soldier of this type who has reached three stars and has not learned a skill.", stats: [], requirements: [], hotkey: "N" })),
  createCommandButton(i18n.locale==="zh"?"装备":"Equipment","▣","i",()=>booleanCommandState(isUnitCommandPage(commandCardContext()) && focusedPlayerUnits().some(canEquip)),openSelectedEquipment,()=>({title:i18n.locale==="zh"?"人物装备":"Character equipment",body:i18n.locale==="zh"?"查看当前单位的装备、携行物品与双手配置":"Inspect this character’s outfit, carried items and hands",stats:[],requirements:[]})),
  createCommandButton(i18n.locale==="zh"?"船舱 / 配置":"Hold / Fittings","▣","i",()=>booleanCommandState(isUnitCommandPage(commandCardContext()) && focusedPlayerUnits().some(unit=>Boolean(shipProfile(unit)))),openSelectedEquipment,()=>({title:i18n.locale==="zh"?"船舱与炮位":"Hold and fittings",body:i18n.locale==="zh"?"配置这艘船的货物、炮位和船员装备":"Configure this ship’s cargo, gun mounts and crew equipment",stats:[],requirements:[]})),
  ...(['enterCabin','leaveCabin'] as const).map(type=>createCommandButton(type==='enterCabin'?(i18n.locale==='zh'?'撤入舱内':'Take shelter'):(i18n.locale==='zh'?'返回甲板':'Return to deck'),type==='enterCabin'?'↘':'↗','',()=>cabinButtonState(type),issueCabinAction,()=>({title:type==='enterCabin'?(i18n.locale==='zh'?'撤入舱内':'Take shelter'):(i18n.locale==='zh'?'返回甲板':'Return to deck'),body:type==='enterCabin'?(i18n.locale==='zh'?'走到舱门后避险，舱内无法攻击或施法。':'Walk to the cabin door for shelter. Crew inside cannot attack or cast.'):(i18n.locale==='zh'?'从舱门返回有空位的甲板。':'Return through the cabin door to clear deck space.'),stats:[],requirements:[]}))),
  createCommandButton(t("command.aim.title"), "⌖", "j", () => booleanCommandState(!commandMode && !openPalette && focusedPlayerUnits().some(unit => !isInCabin(unit) && aimingProfile(UNIT_DEFS[unit.kind]))), beginAimMode, () => ({
    title: t("command.aim.title"), body: t("command.aim.body"), stats: [], requirements: [t("command.aim.requirements")], hotkey: "J",
  })),
  createCommandButton(t("command.attackMove.title"), "⌁", "a", () => booleanCommandState(canAttackMove()), beginAttackMoveMode, () => ({
    title: t("command.attackMove.title"),
    body: t("command.attackMove.body"),
    stats: [t("command.attackMove.stats")],
    requirements: [t("command.attackMove.requirements")],
    hotkey: "A",
  })),
  createCommandButton(t("command.unload.title"), "⤓", "d", unloadButtonState, beginUnloadMode, () => ({
    title: t("command.unload.title"),
    body: t("command.unload.body"),
    stats: [t("command.unload.stats")],
    requirements: [t("command.unload.requirements")],
    hotkey: "D",
  })),
  createCommandButton(t("command.build.title"), "⌘", "b", () => booleanCommandState(canOpenBuildPalette()), openBuildPalette, () => ({
    title: t("command.build.title"),
    body: t("command.build.body"),
    stats: [t("command.build.stats")],
    requirements: [t("command.build.requirements")],
    hotkey: "B",
  })),
  ...BUILD_COMMANDS.map((command) =>
    createCommandButton(t("command.buildSpecific", { building: labelKind(command.kind) }), command.icon, command.hotkey, () => booleanCommandState(canBuild(command.kind)), () => beginBuildPlacement(command.kind), () => buildingTooltip(command.kind, command.hotkey, i18n, snapshot?.players[localPlayerId]?.race), { type: "building", kind: command.kind }),
  ),
  ...TRAIN_COMMANDS.map((command) =>
    createCommandButton(t("command.trainSpecific", { unit: labelKind(command.kind) }), command.icon, command.hotkey, () => trainCommandState(command.kind, currentPlayerState(), canTrain(command.kind)), () => train(command.kind), () => unitTooltip(command.kind, command.hotkey, i18n), { type: "unit", kind: command.kind }),
  ),
  ...RESEARCH_COMMANDS.map((command) =>
    createCommandButton(t("command.researchSpecific", { upgrade: labelKind(command.upgradeKind) }), command.icon, command.hotkey, () => booleanCommandState(canResearch(command.upgradeKind)), () => research(command.upgradeKind), () => upgradeTooltip(command.upgradeKind, command.hotkey, currentPlayerState()?.upgrades[command.upgradeKind] ?? 0, i18n)),
  ),
  ...SPELL_COMMANDS.map((command) =>
    withAutocastRing(createCommandButton(
      t("command.castSpecific", { ability: labelKind(command.ability) }),
      command.icon,
      command.hotkey,
      () => abilityButtonState(command.ability),
      () => beginSpellTargeting(command.ability),
      () => abilityTooltip(command.ability, command.hotkey, i18n, abilityButtonState(command.ability).autocast),
      undefined,
      () => toggleAutocast(command.ability),
    ), command.ability),
  ),
  withRing(createCommandButton(t("command.stance.menu.title"), STANCE_MENU_COMMAND.icon, STANCE_MENU_COMMAND.hotkey, stanceMenuButtonState, openStancePalette, () => ({
    title: t("command.stance.menu.title"),
    body: t("command.stance.menu.body", { stance: currentStanceLabel() }),
    stats: [],
    requirements: [t("command.stance.requirements")],
    hotkey: STANCE_MENU_COMMAND.hotkey.toUpperCase(),
  }))),
  ...STANCE_COMMANDS.map((command) =>
    withRing(createCommandButton(t(command.title), command.icon, command.hotkey, () => stanceButtonState(command.stance), () => setStance(command.stance), () => ({
      title: t(command.title),
      body: t(command.body),
      stats: [t(command.stats, { share: BRACE_DAMAGE_SHARE, knockback: KNOCKBACK, most: MAX_SHOVE, taken: SHOCK_DAMAGE_TAKEN, pace: LUNGE_PACE })],
      requirements: [t("command.stance.requirements")],
      hotkey: command.hotkey.toUpperCase(),
    }))),
  ),
  (()=>{const button=createCommandButton(i18n.locale==="zh"?"指定接收者":"Choose recipient","◎","o",()=>purchaseSeller()&&!commandMode&&!openPalette ? ENABLED_COMMAND_STATE : HIDDEN_COMMAND_STATE,startPurchaseRecipient,()=>({title:i18n.locale==="zh"?"指定购买接收者":"Choose purchase recipient",body:i18n.locale==="zh"?"点击附近的己方人物或船。商品直接进入其装备位或船舱；位置、空位或载重不足时不扣钱。":"Choose a nearby friendly character or ship. Purchases go directly into its equipment or hold; failed delivery costs nothing.",stats:[purchaseRecipientCaption()],requirements:[],hotkey:"O"}));button.element.dataset.purchaseRecipient="true";return button;})(),
  ...(["shipCannon","shipMortar","flameProjector"] as const).map((kind,index)=>createCommandButton(i18n.locale==="zh"?`购买${labelKind(kind)}`:`Buy ${labelKind(kind)}`,"●",["c","v","b"][index]!,()=>dockGoodButtonState(kind),()=>buyDockGood(kind),()=>({...itemTooltip(kind,undefined,i18n),stats:[...itemTooltip(kind,undefined,i18n).stats,`${SHIP_WEAPONS[kind].cost} G`,purchaseRecipientCaption()],requirements:[purchaseProblem(kind)??(i18n.locale==="zh"?"直接送入接收者；船炮随后安装到炮位。":"Delivered to the recipient; install guns from the hold afterwards.")]}),{type:"item",kind})),
  ...SHOP_GOODS.map((good, index) =>
    createCommandButton(t("command.buy.title", { item: labelKind(good.kind) }), itemIcon(good.kind), SHOP_HOTKEYS[index]!, () => shopGoodButtonState(good.kind), () => buyGood(good.kind), () => {
      const tooltip = itemTooltip(good.kind, SHOP_HOTKEYS[index], i18n);
      return {
        ...tooltip,
        title: t("command.buy.title", { item: tooltip.title }),
        stats: [t("command.buy.cost", { cost: good.cost }), t("command.buy.stock", { stock: good.maxStock, seconds: good.restock / 20 }), ...tooltip.stats],
        requirements: [purchaseProblem(good.kind)??purchaseRecipientCaption()],
      };
    }, { type: "item", kind: good.kind }),
  ),
  createCommandButton(t("command.hire.title"), HIRE_COMMAND.icon, HIRE_COMMAND.hotkey, hireMercenaryButtonState, hireMercenary, () => ({
    title: t("command.hire.title"),
    body: t("command.hire.body"),
    stats: [t("command.hire.stock"), t("command.hire.instant")],
    requirements: [t("command.hire.requirements")],
    hotkey: HIRE_COMMAND.hotkey.toUpperCase(),
  })),
  createCommandButton(t("common.back"), "←", "escape", () => booleanCommandState(!commandMode && Boolean(openPalette)), closeCommandPalette, () => ({
    title: t("common.back"), body: t("command.back.body"), stats: [], requirements: [], hotkey: "Esc",
  })),
];

window.addEventListener("resize", resizeCanvas);
window.addEventListener("popstate", () => void openRouteFromUrl());
window.addEventListener("keydown", onKeyDown);
window.addEventListener("keyup", (event) => keys.delete(event.key.toLowerCase()));
document.addEventListener("pointerover", showTooltipFromEvent, true);
document.addEventListener("pointermove", moveTooltipFromEvent, true);
document.addEventListener("pointerout", hideTooltipFromEvent, true);
document.addEventListener("focusin", showTooltipFromEvent, true);
document.addEventListener("focusout", hideTooltipFromEvent, true);
document.addEventListener("pointerlockchange", syncPointerLockState);
document.addEventListener("click", onInterfaceClick, true);
document.addEventListener("keydown", () => soundboard.unlock(), true);
document.addEventListener("change", (event) => {
  if (event.target instanceof HTMLSelectElement) soundboard.play("click");
}, true);
document.addEventListener("pointerlockerror", () => {
  if (pointerLockArmed && !pointerLockFieldClickOnError) return;
  const fieldClickOnError = pointerLockFieldClickOnError;
  pointerLockFieldClickOnError = false;
  handlePointerLockError(fieldClickOnError);
});
document.addEventListener("pointerdown", suppressPointerLockDocumentMouseDefault, { capture: true });
document.addEventListener("pointerup", suppressPointerLockDocumentMouseDefault, { capture: true });
document.addEventListener("pointermove", suppressPointerLockDocumentMouseDefault, { capture: true });
document.addEventListener("mousedown", suppressPointerLockDocumentMouseDefault, { capture: true });
chatForm.addEventListener("submit", submitChatForm);
document.addEventListener("mouseup", suppressPointerLockDocumentMouseDefault, { capture: true });
document.addEventListener("mousemove", suppressPointerLockDocumentMouseDefault, { capture: true });
document.addEventListener("contextmenu", suppressPointerLockDocumentMouseDefault, { capture: true });
pointerLockGateAction.addEventListener("click", () => void requestRequiredPointerLock());
sceneSwitch.addEventListener("click", () => {
  const scene = menuBackdrop.next();
  try {
    localStorage.setItem(MENU_SCENE_STORAGE_KEY, scene.id);
  } catch {
    // Without storage the pick lasts this visit.
  }
  labelSceneSwitch();
  void prepareHome().catch(console.error);
});
labelSceneSwitch();
// The match's menu (≡ in the top right): the map being played, concede, and back to the game.
matchMenuButton.addEventListener("click", () => matchMenu.classList.toggle("hidden"));
minimapRelationsButton.addEventListener("click", toggleMinimapRelations);
minimapWindButton.addEventListener('click', toggleMinimapWind);
matchMenuClose.addEventListener("click", () => matchMenu.classList.add("hidden"));
const settingsAction=document.createElement('button');settingsAction.className='match-action';settingsAction.textContent=t('home.settings');settingsAction.onclick=()=>{matchMenu.classList.add('hidden');pointerLockArmed=true;hidePointerLockGate();if(document.pointerLockElement===canvas)document.exitPointerLock();openMatchSettings(soundboard,i18n);};matchMenu.append(settingsAction);
forfeitButton.addEventListener("click", () => {
  matchMenu.classList.add("hidden");
  void forfeitCurrentMatch();
});
// @@@status-flash - The status line speaks when something happens, near the top of the screen, and fades a few
// seconds later (see .status-line), so no box stands over the battlefield between messages.
const STATUS_SHOWN_MS = 3500;
let statusFade: number | undefined;
new MutationObserver(() => {
  window.clearTimeout(statusFade);
  const shown = (statusLabel.textContent ?? "").trim() !== "";
  statusLabel.classList.toggle("shown", shown);
  if (shown) statusFade = window.setTimeout(() => statusLabel.classList.remove("shown"), STATUS_SHOWN_MS);
}).observe(statusLabel, { childList: true, characterData: true, subtree: true });
canvas.addEventListener("contextmenu", suppressCanvasMouseDefault);
canvas.addEventListener("auxclick", suppressCanvasMouseDefault);
canvas.addEventListener("dragstart", suppressCanvasMouseDefault);
canvas.addEventListener("selectstart", suppressCanvasMouseDefault);
canvas.addEventListener("pointermove", suppressCanvasMouseDefault);
canvas.addEventListener("pointercancel", suppressCanvasMouseDefault);
canvas.addEventListener("pointerdown", suppressCanvasPointerGestureDefault);
canvas.addEventListener("pointerup", suppressCanvasPointerGestureDefault);
canvas.addEventListener("mousedown", onMouseDown);
canvas.addEventListener("mousemove", onMouseMove);
// Off pointer lock the canvas hears no move over the interface, so the cursor is followed across the whole page too,
// after the canvas's own handler (which reads the point before), for edge scrolling over the top bar and the docks.
document.addEventListener("mousemove", (event) => {
  if (document.pointerLockElement !== canvas) lastMouse = mousePoint(event);
});
canvas.addEventListener("mouseup", onMouseUp);

renderMainMenu();
resizeCanvas();
animationFrame=requestAnimationFrame(frame);
window.addEventListener('pagehide',event=>{
  // A cached page resumes with its existing scene and connections on Back.
  if(event.persisted||applicationClosed)return;
  applicationClosed=true;routeRequest++;cancelAnimationFrame(animationFrame);clearRoomWatch();disconnectActiveMatch();deploymentRuntime.close();
  worldPresentation.dispose();soundboard.dispose();disposeResourcePanel();
  const usedModels=[...resources.entries.keys()].some(url=>url.includes('/art/world3d/'));
  resources.dispose();snapshot=undefined;keys.clear();
  // These modules are already loaded when models were used. Startup teardown
  // does not download a renderer merely to release an empty cache.
  if(usedModels)void Promise.all([import('./world3d/model-library'),import('./world3d/model-portraits')]).then(([models,portraits])=>{portraits.clearModelPortraits();models.worldModels.dispose();});
});

async function prepareHome(){
  visualsReady=false;const scene=menuBackdrop.prepare(performance.now());
  await resourcePanel().run('home',resourceText('读取当前首页场景','Loading the current home scene'),async()=>{await soundPacksLoaded;await worldPresentation.prepare(scene,'home',menuBackdrop.architectureKinds);});
  visualsReady=true;
}
export async function initializeVisuals(){if(applicationClosed)return;await prepareHome();if(!applicationClosed)await openRouteFromUrl();}
async function ensureMatchResources(){
  if(!matchAssets){visualsReady=false;matchAssets=resourcePanel().run('match',resourceText('读取遭遇战模型与作战资源','Loading skirmish models and combat resources'),async()=>{await worldPresentation.prepare(menuBackdrop.prepare(performance.now()),'match');await soundboard.prepareMatch();}).catch(error=>{matchAssets=undefined;throw error;}).finally(()=>{visualsReady=true;});}
  await matchAssets;
}

function pendingVeteranIds() {
  return new Set(pendingVeteranChoices.keys());
}

function focusedVeteranStudent() {
  const unit = focusedPlayerUnits()[0];
  return unit && !isInCabin(unit) && canLearnVeteranSkill(unit) && !pendingVeteranChoices.has(unit.id) ? unit : undefined;
}

function veteranUnitCaption(unit: Unit) {
  const peers = veteranPeers(selectedPlayerUnits(), unit.id);
  const ordinal = peers.length > 1 ? ` ${peers.findIndex(peer => peer.id === unit.id) + 1}/${peers.length}` : "";
  return `${labelKind(unit.kind)}${ordinal} · ${"★".repeat(Math.min(3, unit.level))}`;
}

function createVeteranLearnButton() {
  const button = createCommandButton(i18n.locale === "zh" ? "学习技能" : "Learn skill", "+", "p",
    () => booleanCommandState(isUnitCommandPage(commandCardContext()) && Boolean(veteranStudent(selectedPlayerUnits().filter(unit=>!isInCabin(unit)), focusedSelectionId, pendingVeteranIds()))),
    openVeteranPalette, () => {
      const student = veteranStudent(selectedPlayerUnits().filter(unit=>!isInCabin(unit)), focusedSelectionId, pendingVeteranIds());
      return { title: i18n.locale === "zh" ? "学习技能" : "Learn a skill",
        body: i18n.locale === "zh" ? "为这名老兵选择一个技能，学习后不能更换。" : "Choose one permanent skill for this soldier.",
        stats: student ? [veteranUnitCaption(student)] : [], requirements: [], hotkey: "P" };
    });
  button.element.dataset.veteranLearn = "true";
  return button;
}

function veteranChoiceTooltip(index: number): GameplayTooltip {
  const unit = focusedVeteranStudent();
  const skill = unit?.veteranSkillChoices?.[index];
  if (!skill || !unit) return { title: i18n.locale === "zh" ? "候选技能" : "Skill choice", body: "", stats: [], requirements: [] };
  const tooltip = veteranSkillTooltip(skill, i18n, ["q", "w", "e"][index]);
  return { ...tooltip, stats: [veteranUnitCaption(unit), ...tooltip.stats],
    requirements: [i18n.locale === "zh" ? "只为这名老兵学习；选择后不能更换。" : "Learn for this soldier only. This choice is permanent."] };
}

function createVeteranChoiceButton(index: number) {
  const button = createCommandButton(i18n.locale === "zh" ? "候选技能" : "Skill choice", "★", ["q", "w", "e"][index]!,
    () => booleanCommandState(!commandMode && openPalette === "veteran" && Boolean(focusedVeteranStudent()?.veteranSkillChoices?.[index])),
    () => learnVeteranChoice(index), () => veteranChoiceTooltip(index));
  button.element.dataset.veteranChoice = String(index);
  return button;
}

function createVeteranPassiveButton() {
  const button = createCommandButton(i18n.locale === "zh" ? "老兵技能" : "Veteran skill", "★", "",
    () => {
      const skill = focusedPlayerUnits()[0]?.veteranSkill;
      return booleanCommandState(isUnitCommandPage(commandCardContext()) && Boolean(skill && VETERAN_SKILLS[skill].effect.type !== "active"));
    }, () => {
      const skill = focusedPlayerUnits()[0]?.veteranSkill;
      if (skill) statusLabel.textContent = VETERAN_SKILLS[skill].description[i18n.locale];
    }, () => {
      const skill = focusedPlayerUnits()[0]?.veteranSkill;
      return skill ? veteranSkillTooltip(skill, i18n) : { title: "", body: "", stats: [], requirements: [] };
    });
  button.element.dataset.veteranPassive = "true";
  return button;
}

function openVeteranPalette() {
  if (!syncBeforeCommandProjection()) return;
  const unit = veteranStudent(selectedPlayerUnits().filter(unit=>!isInCabin(unit)), focusedSelectionId, pendingVeteranIds());
  if (!unit) return;
  focusedSelectionId = unit.id;
  openPalette = "veteran";
  statusLabel.textContent = `${veteranUnitCaption(unit)} · ${i18n.locale === "zh" ? "选择一个技能（Q / W / E）；Esc 返回" : "Choose one skill (Q / W / E); Esc to return"}`;
  updateHud();
}

function focusNextVeteranStudent() {
  if (!syncBeforeCommandProjection()) return;
  const next = nextVeteranStudent(selectedPlayerUnits().filter(unit=>!isInCabin(unit)), focusedSelectionId, pendingVeteranIds());
  if (!next) return;
  focusedSelectionId = next.id;
  statusLabel.textContent = veteranUnitCaption(next);
  updateHud();
}

function learnVeteranChoice(index: number) {
  // Capture what the player clicked before an input-time snapshot refresh can change the focus.
  const before = focusedVeteranStudent();
  const skill = before?.veteranSkillChoices?.[index];
  if (!before || !skill || !syncBeforeCommandProjection()) return;
  const unit = selectedPlayerUnits().find(candidate => candidate.id === before.id);
  const command = learnVeteranSkillCommand(unit, skill);
  if (!command || !sendCommand(command)) return;
  pendingVeteranChoices.set(before.id, snapshot!.tick);
  const next = nextVeteranStudent(selectedPlayerUnits().filter(unit=>!isInCabin(unit)), before.id, pendingVeteranIds());
  focusedSelectionId = next?.id ?? before.id;
  openPalette = next ? "veteran" : undefined;
  statusLabel.textContent = `${veteranUnitCaption(before)} · ${VETERAN_SKILLS[skill].name[i18n.locale]}${next ? ` · ${i18n.locale === "zh" ? "下一位：" : "Next: "}${veteranUnitCaption(next)}` : ""}`;
  updateHud();
}

function renderVeteranCommand(button: CommandButton) {
  const index = button.element.dataset.veteranChoice;
  const skill = index !== undefined ? focusedVeteranStudent()?.veteranSkillChoices?.[Number(index)]
    : button.element.dataset.veteranPassive ? focusedPlayerUnits()[0]?.veteranSkill : undefined;
  if (!skill) return;
  const definition = VETERAN_SKILLS[skill];
  const label = definition.name[i18n.locale];
  button.element.querySelector(".command-label")!.textContent = label;
  button.element.dataset.commandLabel = label;
  button.element.setAttribute("aria-label", `${label}${button.hotkey ? ` (${button.hotkey.toUpperCase()})` : ""}`);
  if (button.element.dataset.veteranSkill !== skill) {
    button.element.dataset.veteranSkill = skill;
    const icon = button.element.querySelector(".command-icon")!;
    const markup = commandIconMarkup(definition.icon);
    if (markup) icon.innerHTML = markup;
    else icon.textContent = definition.icon;
  }
}

function createCommandButton(label: string, icon: string, hotkey: string, state: () => CommandButtonState, run: () => void, tooltip: () => GameplayTooltip, portrait?: CommandPortrait, contextAction?: () => void): CommandButton {
  const element = document.createElement("button");
  element.className = "command-button";
  element.type = "button";
  element.dataset.commandLabel = label;
  const hotkeyLabel = hotkey === "escape" ? "Esc" : hotkey.toUpperCase();
  element.dataset.hotkey = hotkeyLabel;
  element.setAttribute("aria-label", `${label} (${hotkeyLabel})`);
  applyTooltip(element, tooltip());
  element.innerHTML = `<span class="command-icon">${escapeHtml(icon)}</span><span class="command-label">${escapeHtml(portrait ? portrait.type === "item" ? labelKind(portrait.kind) : labelAnyKind(portrait.kind) : label)}</span><span class="hotkey">${hotkeyLabel}</span>`;
  // Hidden match commands must not fetch their portraits during startup.
  // updateHud paints a portrait when its command actually becomes visible.
  if (!portrait) {
    const markup = commandIconMarkup(icon);
    if (markup) element.querySelector(".command-icon")!.innerHTML = markup;
  }
  const guardedRun = () => { const current = state(); if (!current.visible) return; if (!current.enabled) { showCommandUnavailable(current, label); return; } run(); };
  element.addEventListener("click", guardedRun);
  // A right-click on the command card never reaches the battlefield or opens the browser menu; a spell switches autocast.
  element.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    contextAction?.();
  });
  commandDock.append(element);
  return { element, hotkey, tooltip, state, run: guardedRun, ...(contextAction ? { contextAction } : {}), ...(portrait ? {portrait} : {}) };
}

// @@@autocast-ring - The border of light a spell button wears while its autocast is on (see styles.css); a spell the
// player cannot switch gets none.
function withAutocastRing(button: CommandButton, ability: AbilityKind) {
  return canAutocast(ability) ? withRing(button) : button;
}

// The ring itself, lit by the button's state: a spell's autocast, or a stance the selected fighters are in.
function withRing(button: CommandButton) {
  const ring = document.createElement("span");
  ring.className = "autocast-ring";
  ring.setAttribute("aria-hidden", "true");
  button.element.append(ring);
  return button;
}

function drawCommandPortrait(element: HTMLElement, portrait: CommandPortrait) {
  const icon = element.querySelector<HTMLCanvasElement>('canvas.command-portrait') ?? document.createElement("canvas");
  if(!icon.classList.contains('command-portrait')){
    icon.width = icon.height = 96;
    icon.className = "command-portrait";
    icon.setAttribute("aria-hidden", "true");
    element.querySelector(".command-icon, .item-icon")?.replaceChildren(icon);
  }
  const color=ownerInk(localPlayerId);
  paintPortrait(icon,`${portrait.type}:${portrait.kind}:${color}`,()=>{
    const brush = requireCanvasContext(icon);
    const size=icon.clientWidth||icon.width;
    const center = { x: size/2, y: size/2 };
    if (portrait.type === "unit") drawAtlasUnitPortrait(brush, portrait.kind, 0, 0, size, color);
    else if (portrait.type === "item") drawPaintedItem(brush, portrait.kind, center, size*.8);
    else drawAtlasBuildingPortrait(brush, portrait.kind, size, color);
  });
}

function applyTooltip(element: HTMLElement, tooltip: GameplayTooltip) {
  const dataset = formatTooltipDataset(tooltip);
  element.dataset.tooltipTitle = dataset.title;
  element.dataset.tooltipBody = dataset.body;
  element.dataset.tooltipStats = dataset.stats;
  element.dataset.tooltipRequirements = dataset.requirements;
  element.dataset.tooltipNotes = dataset.notes;
  element.dataset.tooltipHotkey = dataset.hotkey;
}

function renderCommandButtonState(element: HTMLButtonElement, state: CommandButtonState) {
  if (state.cooldownTicks !== undefined) element.dataset.cooldownTicks = String(state.cooldownTicks);
  else delete element.dataset.cooldownTicks;
  const label = commandButtonStateLabel(state);
  if (label) element.dataset.disabledLabel = label;
  else delete element.dataset.disabledLabel;
  if (state.reason) element.dataset.disabledReason = state.reason;
  else delete element.dataset.disabledReason;
  if (state.autocast) element.dataset.autocast = state.autocast;
  else delete element.dataset.autocast;
  if (state.pressed) element.dataset.pressed = state.pressed;
  else delete element.dataset.pressed;
}

function commandButtonTooltip(tooltip: GameplayTooltip, state: CommandButtonState): GameplayTooltip {
  return withTooltipRequirement(tooltip, commandButtonStateRequirement(state));
}

function commandButtonStateLabel(state: CommandButtonState) {
  if (state.cooldownTicks !== undefined) return `${Math.ceil(state.cooldownTicks / 20)}s`;
  if (state.reason === "stock") return t("hud.commandNoStockShort");
  if (state.reason === "gold") return t("hud.commandNoGoldShort");
  if (state.reason === "supply") return t("hud.commandNoSupplyShort");
  if (state.reason === "tier") return t("hud.commandTierShort", { cap: state.supplyCap ?? 0 });
  if (state.reason === "position") return t("hud.commandNeedUnitShort");
  return undefined;
}

function commandButtonStateRequirement(state: CommandButtonState) {
  if(state.detail)return state.detail;
  if (state.cooldownTicks !== undefined) return t("hud.commandCooldown", { ticks: state.cooldownTicks });
  if (state.reason === "stock") return t("hud.commandNoStock");
  if (state.reason === "gold") return t("hud.commandNoGold");
  if (state.reason === "supply") return t("hud.commandNoSupply");
  if (state.reason === "tier") return t("hud.commandTier", { cap: state.supplyCap ?? 0 });
  if (state.reason === "position") return t("hud.commandNeedUnit");
  return undefined;
}

function showCommandUnavailable(state: CommandButtonState, fallback: string) {
  showInvalidCommand(commandButtonStateRequirement(state) ?? fallback);
}

function showTooltipFromEvent(event: Event) {
  const target = tooltipTarget(event.target);
  if (!target) return;
  renderTooltip(target);
  positionTooltip(target, event);
}

function moveTooltipFromEvent(event: Event) {
  if (tooltipLayer.classList.contains("hidden")) return;
  const target = tooltipTarget(event.target);
  if (!target) return;
  positionTooltip(target, event);
}

function hideTooltipFromEvent(event: Event) {
  if (!tooltipTarget(event.target)) return;
  tooltipLayer.classList.add("hidden");
}

function tooltipTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return undefined;
  const element = target.closest<HTMLElement>("[data-tooltip-title]");
  return element?.dataset.tooltipTitle ? element : undefined;
}

function renderTooltip(target: HTMLElement) {
  shownTooltipTarget = target;
  const stats = splitTooltipList(target.dataset.tooltipStats);
  const requirements = splitTooltipList(target.dataset.tooltipRequirements);
  const notes = splitTooltipList(target.dataset.tooltipNotes);
  const hotkey = target.dataset.tooltipHotkey;
  tooltipLayer.innerHTML = `
    <div class="tooltip-title">${escapeHtml(target.dataset.tooltipTitle ?? "")}${hotkey ? `<span>${escapeHtml(hotkey)}</span>` : ""}</div>
    ${target.dataset.tooltipBody ? `<div class="tooltip-body">${escapeHtml(target.dataset.tooltipBody)}</div>` : ""}
    ${stats.length > 0 ? `<div class="tooltip-stats">${stats.map((item) => `<div>${escapeHtml(item)}</div>`).join("")}</div>` : ""}
    ${requirements.length > 0 ? `<div class="tooltip-requirements">${requirements.map((item) => `<div>${escapeHtml(item)}</div>`).join("")}</div>` : ""}
    ${notes.length > 0 ? `<div class="tooltip-notes">${notes.map((item) => `<div>${escapeHtml(item)}</div>`).join("")}</div>` : ""}
  `;
  tooltipLayer.classList.remove("hidden");
}

function positionTooltip(target: HTMLElement, event: Event) {
  const source = event instanceof PointerEvent || event instanceof MouseEvent
    ? { x: event.clientX + 14, y: event.clientY + 16 }
    : tooltipAnchor(target);
  positionTooltipAtSource(source);
}

function positionTooltipAtPoint(point: Point) {
  positionTooltipAtSource({ x: point.x + 14, y: point.y + 16 });
}

function positionTooltipAtSource(source: Point) {
  const rect = tooltipLayer.getBoundingClientRect();
  const x = Math.min(window.innerWidth - rect.width - 10, Math.max(10, source.x));
  const y = Math.min(window.innerHeight - rect.height - 10, Math.max(10, source.y));
  tooltipLayer.style.transform = `translate(${x}px, ${y}px)`;
}

function tooltipAnchor(target: HTMLElement) {
  const rect = target.getBoundingClientRect();
  return { x: rect.left + rect.width + 10, y: rect.top };
}

function splitTooltipList(value: string | undefined) {
  return value ? value.split("|").filter(Boolean) : [];
}

function openMenuRoute(route: Exclude<RoomRoute, { screen: "room" }>, replace = false) {
  routeRequest++;
  clearRoomWatch();
  disconnectActiveMatch();
  currentRoom = undefined;
  currentRoomId = undefined;
  spectatingRoom = false;
  selectedIds = new Set(); focusedSelectionId = undefined; selectedCampId = undefined;
  commandMode = undefined; openPalette = undefined;
  menuOpen = true;
  releasePointerLockForMenu();
  shell.classList.add("menu-open"); mainMenu.classList.remove("hidden");
  if (route.screen === "maps" || route.screen === "create") {
    pendingRoomConfiguration = route.configuration ?? pendingRoomConfiguration;
    chosenMapId = pendingRoomConfiguration.mapId as PoolMapId;
    route = { screen: route.screen, configuration: pendingRoomConfiguration };
  }
  menuView = route.screen;
  setRoomRoute(route, replace);
  syncMatchActions();
  renderMainMenu();
}

async function openRouteFromUrl() {
  const route = parseRoomRoute(window.location.search);
  if (route.screen === "room") {
    if (currentRoom?.id === route.roomId) return;
    await enterRoom(route.roomId, true);
    return;
  }
  openMenuRoute(route, true);
}

function openRoomSetup(room: RoomState) {
  currentRoom = room;
  currentRoomId = undefined;
  menuView = "setup";
  setRoomRoute({ screen: "room", roomId: room.id });
  watchRoomSetup(room.id);
}

function watchRoomSetup(roomId: string) {
  if (activeRoomWatchId === roomId) return;
  clearRoomWatch();
  activeRoomWatchId = roomId;
  activeRoomUnwatch = deploymentRuntime.watchRoom(roomId, handleRuntimeRoomUpdate);
}

function clearRoomWatch() {
  activeRoomUnwatch?.();
  activeRoomUnwatch = undefined;
  activeRoomWatchId = undefined;
}

function setRoomRoute(route: RoomRoute, replace = false) {
  const search = formatRoomRoute(route);
  if (window.location.search === search && !window.location.hash) return;
  window.history[replace ? "replaceState" : "pushState"](null, "", `${window.location.pathname}${search}`);
}

function renderMainMenu() {
  // Another screen opens at its top: a window that scrolls (a narrow, tall one) kept the last screen's place.
  if (mainMenu.dataset.menuView !== menuView) menuWindow.scrollTop = 0;
  mainMenu.dataset.menuView = menuView;
  menuTitle.textContent =
    menuView === "home"
      ? t("home.title")
      : menuView === "profile"
        ? t("home.profile.title")
        : menuView === "rooms"
          ? t("home.rooms.title")
          : menuView === "create"
            ? t("home.create.title")
            : menuView === "results"
              ? t("home.results.title")
              : t("home.roomSetup.title");
  if (menuView === "profile") {
    renderProfileMenu();
    return;
  }
  if (menuView === "results") {
    renderResultsMenu();
    return;
  }
  if (menuView === "rooms") {
    void renderRoomBrowser();
    return;
  }
  if (menuView === "maps") {
    renderMapSelectionMenu();
    return;
  }
  if (menuView === "create") {
    renderCreateGameMenu();
    return;
  }
  if (menuView === "setup") {
    renderRoomSetup();
    return;
  }
  menuStatus.textContent = "";
  mapList.replaceChildren(
    menuButton(t("home.play"), "", "data-open-create", () => {
      openMenuRoute({ screen: "maps" });
    }),
    menuButton(t("home.rooms.label"), "", "data-open-room-browser", () => {
      openMenuRoute({ screen: "rooms" });
    }),
    menuButton(t("home.settings"), "", "data-open-profile", () => {
      openMenuRoute({ screen: "profile" });
    }),
  );
}

// Map selection and match settings are separate screens, with independent URL/history states.
function renderMapSelectionMenu() {
  menuTitle.textContent = t("roomCreate.chooseMap");
  menuStatus.textContent = "";
  const panel = document.createElement("div");
  panel.className = "map-select menu-page";
  panel.innerHTML = menuPageMarkup(`
    <div class="map-chooser">
      <section class="map-browser" aria-label="${escapeHtml(t("roomCreate.map.label"))}">
        <div class="room-section-title">${escapeHtml(t("roomCreate.map.label"))}</div>
        <div class="map-entries" data-map-entries></div>
      </section>
      ${mapDetailMarkup()}
    </div>
`, `
      <button type="button" data-map-next>${escapeHtml(t("roomCreate.configure"))}</button>
      <button type="button" data-back-home>${escapeHtml(t("common.back"))}</button>
`);
  const renderMaps = () => {
    panel.querySelector("[data-map-entries]")!.replaceChildren(...MAP_POOL.map(map => {
      const entry = menuButton(mapEntryLabel(map.id), "", "data-map-id", () => {
        if (chosenMapId !== map.id) pendingRoomConfiguration = { ...defaultRoomConfiguration(map.id), name: pendingRoomConfiguration.name, visibility: pendingRoomConfiguration.visibility };
        chosenMapId = map.id;
        setRoomRoute({ screen: "maps", configuration: pendingRoomConfiguration }, true);
        renderMaps();
      }, map.id);
      entry.className = `map-entry ${map.id === chosenMapId ? "selected" : ""}`;
      entry.setAttribute("aria-pressed", String(map.id === chosenMapId));
      return entry;
    }));
    showMapDetail(panel, chosenMapId, previewSeatsForRoom(draftRoom()), pendingRoomConfiguration.layoutSeed);
  };
  renderMaps();
  panel.querySelector("[data-map-next]")!.addEventListener("click", () => openMenuRoute({ screen: "create", configuration: pendingRoomConfiguration }));
  panel.querySelector("[data-back-home]")!.addEventListener("click", () => openMenuRoute({ screen: "home" }));
  mapList.replaceChildren(panel);
}

function draftRoom() {
  const humanCount = pendingRoomConfiguration.seatSetup.filter(seat => seat.controller !== "ai").length;
  return createRoom({ id: "preview", host: localUser, ...pendingRoomConfiguration, humanCount, aiCount: pendingRoomConfiguration.seatSetup.length - humanCount });
}

function selectedMapMarkup() {
  return `<div class="selected-map-summary">
    <div class="selected-map-caption"><strong data-map-name></strong><div data-map-summary></div></div>
    <div class="map-preview-space"><div class="map-preview-frame"><canvas class="map-preview" data-map-preview width="256" height="256"></canvas></div></div>
  </div>`;
}

function previewSeatsForRoom(room: RoomState) {
  const seats = roomPreviewSeats(room), pool = poolMap(room.mapId);
  return !pool || poolSeatsFit(pool, seats.map(seat => seat.team)) ? seats : roomPreviewSeats(createRoom({ id: "preview", host: localUser, mapId: room.mapId, ...poolSeatCounts(room.mapId) }));
}

function renderCreateGameMenu() {
  menuTitle.textContent = t("roomCreate.configure");
  menuStatus.textContent = "";
  const form = document.createElement("form");
  form.className = "create-game-form menu-page";
  form.dataset.createGameForm = "true";
  form.innerHTML = menuPageMarkup(`
    <aside class="match-dossier">
    ${selectedMapMarkup()}
    <div class="create-options">
      <label>${escapeHtml(t("roomCreate.name.label"))}<input name="name" value="${escapeHtml(pendingRoomConfiguration.name)}" placeholder="${escapeHtml(t("roomCreate.defaultName", { name: localUser.name }))}" /></label>
      <fieldset class="game-mode-switch">
        <legend>${escapeHtml(t("roomCreate.mode.label"))}</legend>
        <label><input name="gameMode" type="radio" value="singlePlayer" ${pendingRoomConfiguration.visibility === "private" ? "checked" : ""} /><span>${escapeHtml(t("roomCreate.mode.singlePlayer"))}</span></label>
        <label><input name="gameMode" type="radio" value="multiplayer" ${pendingRoomConfiguration.visibility === "public" ? "checked" : ""} /><span>${escapeHtml(t("roomCreate.mode.multiplayer"))}</span></label>
      </fieldset>
    </div>
    </aside>
    <section class="room-slot-pane create-slot-pane">
      <div class="room-section-title">${escapeHtml(t("roomSetup.slots"))}</div>
      ${slotColumnsMarkup()}
      <div class="slot-list" data-draft-seats></div>
    </section>
`, `
      <button type="submit" data-submit-create-game>${escapeHtml(t("roomCreate.submit"))}</button>
      <button type="button" data-choose-map>${escapeHtml(t("roomCreate.backMaps"))}</button>
`);
  const syncDraft = () => {
    pendingRoomConfiguration.name = form.querySelector<HTMLInputElement>("[name=name]")!.value;
    pendingRoomConfiguration.visibility = form.querySelector<HTMLInputElement>("[name=gameMode]:checked")!.value === "singlePlayer" ? "private" : "public";
    setRoomRoute({ screen: "create", configuration: pendingRoomConfiguration }, true);
  };
  const renderSeats = () => {
    const preview = draftRoom();
    showMapDetail(form, chosenMapId, previewSeatsForRoom(preview), pendingRoomConfiguration.layoutSeed);
    form.querySelector("[data-draft-seats]")!.replaceChildren(...preview.slots.map((slot, index) => slotRow(slot, index, false, patch => {
      const seat = pendingRoomConfiguration.seatSetup[index]!;
      pendingRoomConfiguration.seatSetup[index] = { ...seat, ...patch } as typeof seat;
      syncDraft();
      renderSeats();
    })));
  };
  form.querySelector("[name=name]")!.addEventListener("input", syncDraft);
  form.querySelectorAll("[name=gameMode]").forEach(input => input.addEventListener("change", syncDraft));
  renderSeats();
  form.addEventListener("submit", event => {
    event.preventDefault();
    syncDraft();
    const humanCount = pendingRoomConfiguration.seatSetup.filter(seat => seat.controller !== "ai").length;
    void createConfiguredRoom({ ...pendingRoomConfiguration,
      name: pendingRoomConfiguration.name.trim() || t("roomCreate.defaultName", { name: localUser.name }),
      humanCount, aiCount: pendingRoomConfiguration.seatSetup.length - humanCount });
  });
  form.querySelector("[data-choose-map]")!.addEventListener("click", () => openMenuRoute({ screen: "maps", configuration: pendingRoomConfiguration }));
  mapList.replaceChildren(form);
}

// A new room on a map: its host and a computer in every other seat; the host opens seats to players in the lobby.
function poolSeatCounts(mapId: MapId) {
  return { humanCount: 1, aiCount: (poolMap(mapId)?.players ?? 2) - 1 };
}

function mapDetailMarkup() {
  return `
    <section class="map-detail">
      <div class="map-preview-space"><div class="map-preview-frame"><canvas class="map-preview" data-map-preview width="512" height="512"></canvas></div></div>
      <div class="map-info">
        <div class="map-info-name" data-map-name></div>
        <dl class="map-facts" data-map-facts></dl>
      </div>
    </section>`;
}

function showMapDetail(root: ParentNode, mapId: MapId, seats: PreviewSeat[], layoutSeed?: string) {
  const preview = mapPreview(mapId, seats, layoutSeed);
  drawMapPreview(root.querySelector<HTMLCanvasElement>("[data-map-preview]")!, preview);
  const { facts } = preview;
  const layout = poolMap(mapId)?.layout;
  root.querySelector("[data-map-name]")!.textContent = mapName(mapId);
  const summary = root.querySelector("[data-map-summary]");
  if (summary) summary.textContent = `${t("map.fact.playersValue", { players: facts.players })} · ${facts.size} × ${facts.size}`;
  const factList = root.querySelector("[data-map-facts]");
  if (factList) factList.innerHTML = [
    [t("map.fact.players"), t("map.fact.playersValue", { players: facts.players })],
    ...(layout?.idea ? [[t("map.fact.layout"), t(`map.idea.${layout.idea}`)]] : []),
    [t("map.fact.size"), `${facts.size} × ${facts.size}`],
    [t("map.fact.mines"), facts.mines],
    [t("map.fact.camps"), facts.camps],
    [t("map.fact.posts"), facts.posts],
    [t("map.fact.items"), facts.items],
  ].map(([term, value]) => `<dt>${escapeHtml(String(term))}</dt><dd>${escapeHtml(String(value))}</dd>`).join("");
}

// A pool map by its name in the reader's language; any other map by its id.
function mapName(mapId: MapId) {
  const map = poolMap(mapId);
  return map ? map.name[i18n.locale] : mapId;
}

function mapEntryLabel(mapId: MapId) {
  return t("map.entry", { players: poolMap(mapId)?.players ?? 2, name: mapName(mapId) });
}

// Every seat that will play, open ones included (a player takes each before the start); closed seats stay empty.
function roomPreviewSeats(room: RoomState): PreviewSeat[] {
  return room.slots.filter((slot) => slot.controller !== "closed").map((slot) => ({ playerId: slot.playerId, team: seatTeam(slot) }));
}

function renderProfileMenu() {
  menuStatus.textContent = "";
  const form = document.createElement("form");
  form.className = "profile-form menu-page";
  form.dataset.profileForm = "true";
  form.innerHTML = menuPageMarkup(`
    <label>${escapeHtml(t("profile.displayName"))}<input name="name" value="${escapeHtml(localUser.name)}" /></label>
    <div class="profile-id">${escapeHtml(t("profile.userId", { id: localUser.id }))}</div>
    ${soundSettingsMarkup(soundboard,i18n)}
`, `
      <button type="submit">${escapeHtml(t("common.save"))}</button>
      <button type="button" data-regenerate-user>${escapeHtml(t("profile.regenerate"))}</button>
      <button type="button" data-back-home>${escapeHtml(t("common.back"))}</button>
`);
  bindSoundSettings(form,soundboard);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    if (!name) {
      menuStatus.innerHTML = `<span class="error">${escapeHtml(t("profile.nameEmpty"))}</span>`;
      return;
    }
    localUser = { ...localUser, name };
    saveLocalUserProfile(localUser);
    openMenuRoute({ screen: "home" });
  });
  form.querySelector("[data-regenerate-user]")?.addEventListener("click", () => {
    localUser = { id: newUserId(), name: localUser.name };
    saveLocalUserProfile(localUser);
    renderMainMenu();
  });
  form.querySelector("[data-back-home]")?.addEventListener("click", () => {
    openMenuRoute({ screen: "home" });
  });
  mapList.replaceChildren(form);
}

// The footer stays mounted while only the room list changes between loading, empty and populated states.
async function renderRoomBrowser() {
  menuStatus.textContent = "";
  const browser = document.createElement("div");
  browser.className = "room-browser menu-page";
  browser.innerHTML = menuPageMarkup(`<div class="room-browser-list" data-room-browser-list></div>`, `
    <button type="button" data-create-room>${escapeHtml(t("roomBrowser.create.title"))}</button>
    <button type="button" data-back-home>${escapeHtml(t("common.back"))}</button>`);
  browser.querySelector("[data-create-room]")!.addEventListener("click", () => openMenuRoute({ screen: "maps" }));
  browser.querySelector("[data-back-home]")!.addEventListener("click", () => openMenuRoute({ screen: "home" }));
  const list = browser.querySelector<HTMLDivElement>("[data-room-browser-list]")!;
  list.replaceChildren(roomListNote(t("roomBrowser.loading"), "loading"));
  mapList.replaceChildren(browser);
  let rooms: RoomState[];
  try {
    rooms = await deploymentRuntime.listRooms(localUser.id);
  } catch {
    if (browser.isConnected) list.replaceChildren(roomListNote(t("roomBrowser.failed"), "error"));
    return;
  }
  // Left, or laid out again, while they loaded.
  if (!browser.isConnected) return;
  const visibleRooms = roomBrowserEntries(rooms, localUser.id);
  list.replaceChildren(
    ...(visibleRooms.length > 0
      ? visibleRooms.map((entry) =>
          menuButton(entry.room.name, roomBrowserNote(entry.room, entry.action), "data-room-id", () => void enterRoom(entry.room.id), entry.room.id),
        )
      : [roomListNote(t("roomBrowser.noVisible"), "empty")]),
  );
  // Marked once its rooms are in: what a script waits on.
  browser.dataset.roomBrowser = "true";
}

function renderRoomSetup() {
  const setupAction = roomSetupViewAction(currentRoom);
  if (setupAction === "empty") {
    menuStatus.textContent = t("roomSetup.empty");
    mapList.replaceChildren(menuButton(t("roomBrowser.create.title"), "", "data-create-room", () => {
      openMenuRoute({ screen: "maps" });
    }));
    return;
  }
  if (setupAction === "results") {
    openResults(currentRoom!);
    return;
  }
  if (setupAction === "enterMatch") {
    // @@@stale-setup-recovery - Room state can advance through start/websocket before the menu rerenders; follow server truth instead of showing editable setup for a live match.
    void enterRoom(currentRoom!.id);
    return;
  }
  const room = currentRoom!;
  menuStatus.textContent = t("roomSetup.status", { name: room.name, visibility: labelKind(room.visibility), status: labelKind(room.status) });
  const setup = document.createElement("div");
  setup.className = "room-setup menu-page";
  setup.dataset.roomSetup = room.id;
  setup.innerHTML = menuPageMarkup(`
    <aside class="match-dossier">${mapDetailMarkup()}</aside>
    <div class="room-setup-layout">
      <section class="room-slot-pane" aria-label="Player slots">
        <div class="slot-pane-head">
          <div>
            <div class="room-section-title">${escapeHtml(t("roomSetup.slots"))}</div>
          </div>
          <div class="slot-actions">
            <button type="button" class="danger-button" data-close-room ${room.hostUserId === localUser.id ? "" : "disabled"}>${escapeHtml(t("roomSetup.close"))}</button>
          </div>
        </div>
        ${slotColumnsMarkup(true)}
        <div class="slot-list"></div>
      </section>

    </div>
`, `
      <button type="button" data-start-room>${escapeHtml(t("roomSetup.start"))}</button>
      <button type="button" data-back-room-browser>${escapeHtml(t("roomSetup.backRooms"))}</button>
`);
  const startButton = setup.querySelector<HTMLButtonElement>("[data-start-room]")!;
  startButton.disabled = !canStartRoom(room);
  startButton.title = startButton.disabled ? t("roomSetup.startDisabled") : t("roomSetup.startTitle");
  showMapDetail(setup, room.mapId, previewSeatsForRoom(room), room.layoutSeed);
  const slotList = setup.querySelector<HTMLDivElement>(".slot-list")!;
  const local = deploymentRuntime.isLocalRoom(room.id);
  slotList.replaceChildren(...room.slots.map((slot, index) => slotRow(slot, index, local)));
  setup.querySelector("[data-close-room]")?.addEventListener("click", () => void closeCurrentRoom());
  setup.querySelector("[data-start-room]")?.addEventListener("click", () => void startCurrentRoom());
  setup.querySelector("[data-back-room-browser]")?.addEventListener("click", () => {
    openMenuRoute({ screen: "rooms" });
  });
  mapList.replaceChildren(setup);
}

function renderResultsMenu() {
  const result = currentRoom?.result;
  if (!currentRoom || !result) {
    menuStatus.textContent = t("results.noCompleted");
    mapList.replaceChildren(menuButton(t("results.backHome"), "", "data-return-home", returnHome));
    return;
  }

  menuStatus.textContent = t("results.finished", { name: currentRoom.name, tick: result.endedAtTick ?? "?" });
  const winners = winningResultSlots(result);
  const rows = result.slots.map((slot) => {
    const kills = result.stats.unitsKilled[slot.playerId] ?? 0;
    const losses = result.stats.unitsLost[slot.playerId] ?? 0;
    const spent = result.stats.goldSpent[slot.playerId] ?? 0;
    const buildings = result.stats.buildingsDestroyed[slot.playerId] ?? 0;
    return `
      <div class="result-row" data-result-slot="${escapeHtml(slot.playerId)}">
        <span>${escapeHtml(slot.name)}</span>
        <span>${escapeHtml(slot.controller === "ai" && slot.aiVersion ? `${labelKind("ai")} · ${slot.aiVersion.toUpperCase().replace("_", " ")}` : labelKind(slot.controller))}</span>
        <span>${escapeHtml(labelKind(roomTeam(slot.team)))}</span>
        <span>${escapeHtml(labelKind(slot.race))}</span>
        <span>${kills}/${losses}</span>
        <span>${spent}</span>
        <span>${buildings}</span>
      </div>
    `;
  });
  const panel = document.createElement("div");
  panel.className = "results-panel menu-page";
  panel.dataset.resultsScreen = currentRoom.id;
  panel.innerHTML = menuPageMarkup(`
    <div class="result-winner" data-result-winner>${escapeHtml(t("results.winner", { winner: winners.map(slot => slot.name).join("、") || result.winner || t("results.draw") }))}</div>
    <div class="result-head">
      <span>${escapeHtml(t("results.player"))}</span><span>${escapeHtml(t("results.controller"))}</span><span>${escapeHtml(t("results.team"))}</span><span>${escapeHtml(t("results.race"))}</span><span>${escapeHtml(t("results.killsLosses"))}</span><span>${escapeHtml(t("results.gold"))}</span><span>${escapeHtml(t("results.buildings"))}</span>
    </div>
    <div class="result-list">${rows.join("")}</div>
`, `
      <button type="button" data-rematch>${escapeHtml(t("results.rematch"))}</button>
      <button type="button" data-return-home>${escapeHtml(t("common.home"))}</button>
`);
  const completedRoom = currentRoom;
  panel.querySelector("[data-rematch]")?.addEventListener("click", () => void createReplayRoom(completedRoom));
  panel.querySelector("[data-return-home]")?.addEventListener("click", returnHome);
  mapList.replaceChildren(panel);
}

async function createConfiguredRoom(input: Omit<CreateRoomInput, "id" | "host">) {
  currentRoom = await deploymentRuntime.createRoom({
    id: `room-${Date.now().toString(36)}`,
    host: localUser,
    ...input,
  });
  if(applicationClosed)return;
  localPlayerId = slotForUser(currentRoom, localUser.id)?.playerId ?? "player";
  openRoomSetup(currentRoom);
  renderMainMenu();
}

async function startCurrentRoom() {
  if (applicationClosed || !currentRoom) return;
  const roomId = currentRoom.id, request = routeRequest;
  const isCurrent = () => !applicationClosed && request === routeRequest && currentRoom?.id === roomId;
  try {
    await ensureMatchResources();
    if (!isCurrent()) return;
    clearRoomWatch();
    if (hasSeenPointerLockGuide() && hasMouse()) {
      const point = lastMouse ?? { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 };
      await requestPointerLock(point, { fieldClickOnError: true });
    }
    if (!isCurrent()) return;
    const started = await deploymentRuntime.startRoom(roomId, localUser, handleRuntimeRoomUpdate);
    if (!isCurrent()) { started.adapter.close(); return; }
    currentRoom = started.room;
    currentRoomId = started.room.id;
    localPlayerId = started.playerId;
    activateStartedMatch(started.adapter, started.snapshot, started.chat);
    syncDebugView();
    selectedIds = new Set();
    focusedSelectionId = undefined;
    selectedCampId = undefined;
    menuOpen = false;
    shell.classList.remove("menu-open");
    mainMenu.classList.add("hidden");
    syncMatchActions();
    syncPointerLockGate();
  } catch (error) {
    // A page exit or route change can cancel preparation or a pending start.
    // Its obsolete click handler must not resume the match or reject globally.
    if (isCurrent()) throw error;
  }
}

// A rematch: a private room on the same map, computers in the other seats.
async function createReplayRoom(room: RoomState) {
  await createConfiguredRoom({ name: t("roomCreate.defaultName", { name: localUser.name }), mapId: room.mapId, ...poolSeatCounts(room.mapId), visibility: "private" });
}

function menuButton(label: string, note: string, dataName: string, onClick: () => void, dataValue = "true") {
  const button = document.createElement("button");
  button.className = "map-button";
  button.type = "button";
  button.setAttribute(dataName, dataValue);
  button.innerHTML = `<span class="map-button-name">${escapeHtml(label)}</span>${note ? `<span class="map-button-note">${escapeHtml(note)}</span>` : ""}`;
  button.addEventListener("click", onClick);
  return button;
}

function slotColumnsMarkup(ready = false) {
  return `<div class="slot-columns" aria-hidden="true">
    <span></span><span>${escapeHtml(t("results.player"))}</span>
    <span>${escapeHtml(t("results.controller"))}</span><span>${escapeHtml(t("results.team"))}</span>
    <span>${escapeHtml(t("results.race"))}</span><span>AI</span>
    ${ready ? `<span>${escapeHtml(t("roomSetup.slotReady"))}</span>` : ""}
  </div>`;
}

function slotRow(slot: RoomState["slots"][number], index: number, local: boolean, onPatch?: (patch: Record<string, unknown>) => void) {
  const commitPatch = onPatch ?? ((patch: Record<string, unknown>) => void updateCurrentRoomSlot(slot.id, patch));
  const row = document.createElement("div");
  row.className = "slot-row";
  row.dataset.slotId = slot.id;
  // A seat is a computer's or open to a player; a pool map plays with every seat taken (see @@@map-pool). A room played
  // in this browser (see @@@private-rooms-local) has nobody else to come in, so its computers' seats stay theirs.
  const controllerOptions = ["ai", "open"]
    .map((controller) => `<option value="${controller}" ${slot.controller === controller ? "selected" : ""}>${escapeHtml(labelKind(controller))}</option>`)
    .join("");
  // @@@seat-race-first - A seat's race first, then its computer player among those that play that race (see
  // @@@room-ai-races), random by default; a seat on a random race has its computer player drawn too, so that one is locked.
  const aiChoice = slot.race === "random" ? "random" : (slot.aiVersion ?? DEFAULT_INTERNAL_AI_VERSION);
  const aiChoices: RoomAiChoice[] = slot.race === "random" ? ["random"] : ["random", ...roomAiVersionsFor(slot.race)];
  const aiOptions = aiChoices.map((choice) => `<option value="${choice}" ${aiChoice === choice ? "selected" : ""}>${choice === "random" ? escapeHtml(labelKind("random")) : choice.toUpperCase().replace("_", " ")}</option>`).join("");
  const raceOptions = [...RACE_IDS, "random" as const].map((race) => `<option value="${race}" ${slot.race === race ? "selected" : ""}>${escapeHtml(labelKind(race))}</option>`).join("");
  row.innerHTML = `
    <span class="slot-index">${index + 1}</span>
    <span class="slot-name">${escapeHtml(slot.name)}</span>
    ${
      slot.controller === "human" || local
        ? `<span class="slot-controller-badge" data-slot-controller-status>${escapeHtml(labelKind(slot.controller))}</span>`
        : `<select data-slot-controller aria-label="${escapeHtml(t("roomSetup.slotController"))}">${controllerOptions}</select>`
    }
    <select data-slot-team aria-label="${escapeHtml(t("roomSetup.slotTeam"))}">
      ${ROOM_TEAMS.map((team) => `<option value="${team}" ${slot.team === team ? "selected" : ""}>${escapeHtml(labelKind(team))}</option>`).join("")}
    </select>
    <select data-slot-race aria-label="${escapeHtml(t("roomSetup.slotRace"))}">${raceOptions}</select>
    ${slot.controller === "ai" ? `<select data-slot-ai aria-label="${escapeHtml(t("roomSetup.slotAi"))}" ${slot.race === "random" ? "disabled" : ""}>${aiOptions}</select>` : ""}
    ${onPatch ? "" : `<label class="slot-ready"><input data-slot-ready type="checkbox" ${slot.ready ? "checked" : ""} ${slot.controller !== "human" ? "disabled" : ""} /> ${escapeHtml(t("roomSetup.slotReady"))}</label>`}
  `;
  row.querySelector<HTMLSelectElement>("[data-slot-controller]")?.addEventListener("change", (event) => {
    const controller = (event.currentTarget as HTMLSelectElement).value;
    commitPatch({ controller });
  });
  row.querySelector<HTMLSelectElement>("[data-slot-team]")?.addEventListener("change", (event) => {
    commitPatch({ team: (event.currentTarget as HTMLSelectElement).value });
  });
  row.querySelector<HTMLSelectElement>("[data-slot-race]")?.addEventListener("change", (event) => {
    const race = (event.currentTarget as HTMLSelectElement).value as RaceChoice;
    // A computer player that does not play the new race gives way to a random one.
    const keeps = race !== "random" && slot.aiVersion !== undefined && slot.aiVersion !== "random" && ROOM_AI_RACES[slot.aiVersion].includes(race);
    commitPatch(slot.controller === "ai" && !keeps ? { race, aiVersion: "random" } : { race });
  });
  row.querySelector<HTMLSelectElement>("[data-slot-ai]")?.addEventListener("change", (event) => {
    commitPatch({ aiVersion: (event.currentTarget as HTMLSelectElement).value });
  });
  row.querySelector<HTMLInputElement>("[data-slot-ready]")?.addEventListener("change", (event) => {
    commitPatch({ ready: (event.currentTarget as HTMLInputElement).checked });
  });
  return row;
}

async function updateCurrentRoomSlot(slotId: string, patch: Record<string, unknown>) {
  if (!currentRoom) return;
  currentRoom = await deploymentRuntime.updateRoomSlot(currentRoom.id, slotId, patch as SlotPatch);
  renderMainMenu();
}

async function closeCurrentRoom() {
  if (!currentRoom) return;
  await deploymentRuntime.closeRoom(currentRoom.id, localUser.id);
  clearRoomWatch();
  disconnectActiveMatch();
  currentRoom = undefined;
  currentRoomId = undefined;
  syncDebugView();
  syncMatchActions();
  selectedIds = new Set();
  focusedSelectionId = undefined;
  selectedCampId = undefined;
  menuView = "rooms";
  setRoomRoute({ screen: "rooms" });
  renderMainMenu();
}

function activeSlotCount(room: RoomState) {
  return room.slots.filter((slot) => slot.controller === "human" || slot.controller === "ai").length;
}

function roomBrowserNote(room: RoomState, action: "join" | "rejoin" | "watch" = slotForUser(room, localUser.id) ? "rejoin" : "join") {
  const ownedSlot = slotForUser(room, localUser.id);
  const access = ownedSlot ? t("roomCard.access.youAre", { playerId: ownedSlot.playerId }) : action === "watch" ? t("roomCard.access.watch") : room.status === "open" ? t("roomCard.access.open") : t("roomCard.access.alreadyStarted");
  return `${mapName(room.mapId)} · ${labelKind(room.status)} · ${t("roomCard.activeSlots", { count: activeSlotCount(room) })} · ${access}`;
}

function roomListNote(text: string, state: "loading" | "empty" | "error") {
  const note = document.createElement("div");
  note.className = "room-list-note";
  note.dataset.roomList = state;
  note.textContent = text;
  return note;
}

function slotForUser(room: RoomState, userId: string) {
  return room.slots.find((slot) => slot.userId === userId);
}

function returnHome() {
  purchaseRecipients.clear(); purchaseRecipientFlash = undefined;
  openMenuRoute({ screen: "home" });
}

async function enterRoom(roomId: string, replace = false) {
  const request = ++routeRequest;
  try {
    const entered = await deploymentRuntime.enterRoom(roomId, localUser);
    if (request !== routeRequest) return;
    setRoomRoute({ screen: "room", roomId }, replace);
    const room = entered.room;
    currentRoom = room;
    spectatingRoom = entered.spectating;
    localPlayerId = entered.playerId;
    if (room.status === "ended" && room.result) {
      openResults(room);
      return;
    }
    if (room.status === "inMatch") {
      await ensureMatchResources();
      if (request !== routeRequest) return;
      clearRoomWatch();
      currentRoomId = room.id;
      const started = deploymentRuntime.connectRoom(room, localPlayerId, spectatingRoom, handleRuntimeRoomUpdate);
      activateStartedMatch(started.adapter, started.snapshot, started.chat);
      syncDebugView();
      menuOpen = false;
      shell.classList.remove("menu-open");
      mainMenu.classList.add("hidden");
      syncMatchActions();
      syncPointerLockGate();
      return;
    }
    openRoomSetup(room);
    renderMainMenu();
  } catch (error) {
    if (request !== routeRequest) return;
    openMenuRoute({ screen: "home" }, true);
    menuStatus.innerHTML = `<span class="error">${escapeHtml(t("status.enterRoomFailed", { message: error instanceof Error ? error.message : String(error) }))}</span>`;
  }
}

function activateStartedMatch(adapter: GameAdapter, nextSnapshot: GameSnapshot, chat: MatchChat) {
  worldPresentation.reset();
  disconnectActiveMatch();
  purchaseRecipients.clear();
  purchaseRecipientFlash=undefined;
  minimapRelations = undefined;
  minimapWind = false;
  windProbe = undefined;
  windTooltipKey = '';
  windMapDisplay.reset();
  minimapWindButton.setAttribute('aria-pressed', 'false');
  activeGameAdapter = adapter;
  activeChat = chat;
  activeChatUnsubscribe = chat.onMessage(renderChatMessage);
  resetChatOverlay();
  snapshot = nextSnapshot;
  // The match opens on the player's own base, wherever its seat put it; a spectator, with none, on the map's middle.
  const entities = [...nextSnapshot.buildings, ...nextSnapshot.units];
  const own = entities.filter((entity) => entity.owner === localPlayerId).map((entity) => entity.id);
  centerCameraOnWorld(controlGroupCenter(own, entities) ?? { x: nextSnapshot.map.width / 2, y: nextSnapshot.map.height / 2 });
  pruneSelection();
  updateHud();
  syncMatchActions();
}

function disconnectActiveMatch() {
  if (activeGameAdapter !== baseGameAdapter) activeGameAdapter.close();
  activeChatUnsubscribe?.();
  activeChatUnsubscribe = undefined;
  activeChat = undefined;
  closeChatInput();
  activeGameAdapter = baseGameAdapter;
}

function handleRuntimeRoomUpdate(room: RoomState) {
  if (currentRoom?.id !== room.id && currentRoomId !== room.id) return;
  currentRoom = room;
  if (room.status === "ended" && room.result) openResults(room);
  else if (menuOpen && menuView === "setup") renderMainMenu();
}

function syncActiveGameAdapterSnapshot() {
  if (menuOpen) return false;
  const view = syncFrontendWorldView(activeGameAdapter, { owner: localPlayerId, snapshot, selectedIds, focusedSelectionId, selectedCampId, controlGroups });
  if (!view.snapshot) return false;
  if (snapshot && view.snapshot !== snapshot) playCues(soundCues(snapshot, view.snapshot, localPlayerId));
  snapshot = view.snapshot;
  selectedIds = view.selectedIds;
  focusedSelectionId = view.focusedSelectionId;
  selectedCampId = view.selectedCampId;
  syncDebugView();
  pruneSelection();
  updateHud();
  return true;
}

function syncBeforeCommandProjection() {
  // @@@command-projection-truth - Input events can arrive between render frames; command construction must re-materialize adapter truth before reading selection ids.
  if (syncActiveGameAdapterSnapshot() && snapshot) return true;
  showInvalidCommand(t("status.noActiveMatch"));
  return false;
}

function openResults(room: RoomState) {
  clearRoomWatch();
  disconnectActiveMatch();
  releasePointerLockForMenu();
  currentRoom = room;
  currentRoomId = undefined;
  spectatingRoom = false;
  syncDebugView();
  selectedIds = new Set();
  focusedSelectionId = undefined;
  selectedCampId = undefined;
  commandMode = undefined;
  openPalette = undefined;
  menuOpen = true;
  shell.classList.add("menu-open");
  mainMenu.classList.remove("hidden");
  menuView = "results";
  setRoomRoute({ screen: "room", roomId: room.id });
  syncMatchActions();
  renderMainMenu();
  updateHud();
}

async function forfeitCurrentMatch() {
  if (!currentRoomId) return;
  try {
    const ended = await deploymentRuntime.forfeitMatch(currentRoomId, localUser);
    openResults(ended);
  } catch (error) {
    showInvalidCommand(error instanceof Error ? error.message : String(error));
  }
}

function syncMatchActions() {
  forfeitButton.classList.toggle("hidden", menuOpen || !currentRoomId || !deploymentRuntime.canForfeitMatch(currentRoomId));
  if (menuOpen) matchMenu.classList.add("hidden");
}

function releasePointerLockForMenu() {
  if (document.pointerLockElement === canvas) document.exitPointerLock();
  pointerLockArmed = false;
  pointerLockFieldClickOnError = false;
  pointerLockUnavailable = false;
  virtualMouse = undefined;
}

function frame() {
  if(applicationClosed)return;
  animationFrame=requestAnimationFrame(frame);
  syncActiveGameAdapterSnapshot();
  updateCamera();
  draw();
  syncVirtualPointerOverlay();
  syncPointerLockGate();
}

function openSelectedEquipment() {
  if(!syncBeforeCommandProjection())return;
  keys.clear();selectionStart=selectionEnd=undefined;draggingMinimapViewport=false;
  commandMode=undefined;openPalette=undefined;
  equipmentPanel.show(focusedPlayerUnits());
  if(equipmentPanel.isOpen())hidePointerLockGate();
}

function syncDebugView() {
  window.__sketchRtsView = createSketchRtsDebugView({ roomId: currentRoomId, localPlayerId, snapshot, selectedIds, focusedSelectionId });
}

function isEdgeBrowser() {
  const brands =
    "userAgentData" in navigator ? (navigator.userAgentData as { brands?: { brand: string }[] } | undefined)?.brands : undefined;
  return isMicrosoftEdgeUserAgent(navigator.userAgent, brands);
}

function hasSeenPointerLockGuide() {
  return localStorage.getItem(POINTER_LOCK_GUIDE_STORAGE_KEY) === "seen";
}

function shouldShowPointerLockGuide() {
  return !hasSeenPointerLockGuide();
}

function markPointerLockGuideSeen() {
  localStorage.setItem(POINTER_LOCK_GUIDE_STORAGE_KEY, "seen");
}

// Pointer lock is a mouse's: on a touch screen with no mouse there is none to lock, so no gate and no request.
function hasMouse() {
  return window.matchMedia("(any-pointer: fine)").matches;
}

function syncPointerLockGate() {
  if(equipmentPanel.isOpen()){hidePointerLockGate();return;}
  if (!shouldBlockBattlefieldForPointerLock({ menuOpen, hasSnapshot: Boolean(snapshot), isLocked: document.pointerLockElement === canvas, armed: pointerLockArmed, unavailable: pointerLockUnavailable || !hasMouse() })) {
    hidePointerLockGate();
    return;
  }
  showPointerLockGate(shouldShowPointerLockGuide() ? "guide" : "required");
}

function showPointerLockGate(kind: "guide" | "required") {
  pointerLockGateKind = kind;
  const edge = isEdgeBrowser();
  pointerLockGate.classList.remove("hidden");
  pointerLockGateTitle.textContent = kind === "guide" ? t("pointerLock.title.guide") : t("pointerLock.title.required");
  pointerLockGateBody.innerHTML =
    kind === "guide"
      ? [
          t("pointerLock.body.credit"),
          t("pointerLock.body.mouse"),
          edge ? t("pointerLock.body.edge") : "",
        ]
          .filter(Boolean)
          .join("<br>")
      : t("pointerLock.body.required");
  pointerLockGateAction.textContent = kind === "guide" ? (edge ? t("pointerLock.action.edge") : t("pointerLock.action.guide")) : t("common.continue");
}

function hidePointerLockGate() {
  pointerLockGate.classList.add("hidden");
}

async function requestRequiredPointerLock() {
  if (pointerLockGateKind === "guide") markPointerLockGuideSeen();
  const point = lastMouse ?? { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 };
  await requestPointerLock(point, { fieldClickOnError: true });
  syncPointerLockGate();
}

async function requestPointerLock(point: Point, options: { fieldClickOnError: boolean }) {
  pointerLockArmed = false;
  pointerLockFieldClickOnError = options.fieldClickOnError;
  lastMouse = point;
  virtualMouse = point;
  if (options.fieldClickOnError) {
    pointerLockArmed = true;
    hidePointerLockGate();
    statusLabel.textContent = t("status.pointerLockClick");
  }
  try {
    await canvas.requestPointerLock();
  } catch (error) {
    const fieldClickOnError = pointerLockFieldClickOnError;
    pointerLockFieldClickOnError = false;
    handlePointerLockError(fieldClickOnError, error);
  }
}

async function requestPointerLockFromEvent(event: MouseEvent) {
  if (document.pointerLockElement === canvas) return;
  const point = mousePoint(event);
  await requestPointerLock(point, { fieldClickOnError: false });
}

function syncPointerLockState() {
  const locked = document.pointerLockElement === canvas;
  shell.classList.toggle("pointer-locked", locked);
  if (locked) {
    pointerLockUnavailable = false;
    hidePointerLockGate();
    pointerLockArmed = false;
    pointerLockFieldClickOnError = false;
    statusLabel.textContent = t("status.pointerLockLocked");
    return;
  }
  virtualMouse = undefined;
  if(equipmentPanel.isOpen())pointerLockArmed=true;
  syncPointerLockGate();
}

function handlePointerLockError(fieldClickOnError: boolean, error?: unknown) {
  if (fieldClickOnError) {
    pointerLockArmed = true;
    hidePointerLockGate();
    statusLabel.textContent = t("status.pointerLockClick");
    return;
  }
  pointerLockArmed = false;
  pointerLockUnavailable = true;
  hidePointerLockGate();
  const message = error instanceof Error ? t("status.pointerLockUnavailableWithMessage", { message: error.message }) : t("status.pointerLockUnavailable");
  showInvalidCommand(message);
}

function suppressCanvasMouseDefault(event: Event) {
  if (shouldSuppressCanvasMouseDefault(event.type)) event.preventDefault();
}

function suppressCanvasPointerGestureDefault(event: PointerEvent) {
  if (!shouldSuppressCanvasPointerGesture(event.type, event.button, event.buttons)) return;
  event.preventDefault();
  if (event.type === "pointerdown") {
    rightPointerGestureActive = true;
    return;
  }
  if (!rightPointerGestureActive) return;
  rightPointerGestureActive = false;
  ignoreNextRightMouseUp = true;
  onMouseUp(event);
}

function suppressPointerLockDocumentMouseDefault(event: MouseEvent | PointerEvent) {
  if (document.pointerLockElement !== canvas) return;
  if (shouldSuppressPointerLockMouseDefault(event.type, event.button, event.buttons)) event.preventDefault();
}

function onKeyDown(event: KeyboardEvent) {
  if ((event.target === minimapWindButton || event.target === minimapRelationsButton) && ['Enter', ' ', 'Tab'].includes(event.key)) return;
  if(equipmentPanel.isOpen()){if(event.key==="Escape")equipmentPanel.close();event.preventDefault();return;}
  const key = event.key.toLowerCase();
  const chatIntent = chatKeyIntent(event, {
    hasActiveChat: Boolean(activeChat),
    inputFocused: document.activeElement === chatInput,
    inputVisible: isChatInputOpen(),
    menuOpen,
  });
  if (chatIntent !== "pass") {
    if (chatIntent === "capture") return;
    event.preventDefault();
    if (chatIntent === "open") openChatInput();
    if (chatIntent === "close") closeChatInput();
    if (chatIntent === "focus") chatInput.focus();
    if (chatIntent === "submit") submitChatText();
    return;
  }
  if (menuOpen) {
    return;
  }
  if (event.repeat) return;
  // Alt+A, as in Warcraft III: the minimap in friend-or-foe colours or the players' own. By its key, as Alt changes the
  // letter a Mac types.
  if (event.altKey && event.code === "KeyA") {
    event.preventDefault();
    toggleMinimapRelations();
    return;
  }
  if (event.altKey && event.code === 'KeyW') {
    event.preventDefault();
    toggleMinimapWind();
    return;
  }
  if (key === "escape" && commandMode) {
    event.preventDefault();
    cancelCommandMode();
    return;
  }
  if (key === "escape" && openPalette) {
    event.preventDefault();
    closeCommandPalette();
    return;
  }
  if (key === "tab") {
    event.preventDefault();
    cycleFocusedSelection(event.shiftKey ? -1 : 1);
    return;
  }
  if (handleGameplayKeyIntent(event)) {
    event.preventDefault();
    return;
  }

  if (key === "a") {
    event.preventDefault();
    showInvalidCommand(t("status.attackMoveNeedsUnits"));
    return;
  }
  if (key === "b") {
    event.preventDefault();
    showInvalidCommand(t("status.buildNeedsWorker"));
    return;
  }
  keys.add(key);
}

function sendCommand(command: GameCommand) {
  try {
    activeGameAdapter.sendCommand(command);
    return true;
  } catch (error) {
    showInvalidCommand(error instanceof Error ? error.message : String(error));
    return false;
  }
}

function openChatInput() {
  if (!activeChat || menuOpen) return;
  chatForm.classList.remove("hidden");
  chatInput.focus();
}

function closeChatInput() {
  chatInput.value = "";
  chatForm.classList.add("hidden");
  if (document.activeElement === chatInput) chatInput.blur();
}

function isChatInputOpen() {
  return !chatForm.classList.contains("hidden");
}

function submitChatForm(event: SubmitEvent) {
  event.preventDefault();
  submitChatText();
}

function submitChatText() {
  if (!activeChat) return;
  const text = normalizeChatText(chatInput.value);
  if (!text) {
    closeChatInput();
    return;
  }
  try {
    activeChat.send(text, localUser.name);
    closeChatInput();
  } catch (error) {
    showInvalidCommand(error instanceof Error ? error.message : String(error));
  }
}

function renderChatMessage(message: { senderName: string; text: string }) {
  const row = document.createElement("div");
  row.className = "chat-message";
  row.innerHTML = `<span class="chat-sender">${escapeHtml(message.senderName)}</span>: ${escapeHtml(message.text)}`;
  chatMessages.append(row);
  while (chatMessages.children.length > 8) chatMessages.firstElementChild?.remove();
  window.setTimeout(() => row.classList.add("fading"), 7_000);
  window.setTimeout(() => row.remove(), 9_000);
}

function resetChatOverlay() {
  chatMessages.replaceChildren();
  closeChatInput();
}

function showInvalidCommand(message: string) {
  statusLabel.innerHTML = `<span class="error">${escapeHtml(message)}</span>`;
}

// A battlefield sound is heard where it happens: panned across the view, full inside it and fading out within a screen's
// half-width beyond its edges.
let lastSoundCamera: Point | undefined;
function playCues(cues: SoundCue[]) {
  if (lastSoundCamera && Math.hypot(camera.x - lastSoundCamera.x, camera.y - lastSoundCamera.y) > Math.min(canvas.clientWidth, canvas.clientHeight) * .45) soundboard.stopEffects();
  lastSoundCamera = { x: camera.x, y: camera.y };
  // A frame's visible battle gets the voice budget before peripheral events.
  const distance = (cue: SoundCue) => { const at = worldToScreen(cue); return Math.max(0, -at.x, at.x - canvas.clientWidth, -at.y, at.y - canvas.clientHeight); };
  for (const cue of cues.sort((a, b) => distance(a) - distance(b))) {
    const at = worldToScreen(cue);
    const outside = Math.max(0, -at.x, at.x - canvas.clientWidth, -at.y, at.y - canvas.clientHeight);
    const gain = 1 - outside / (canvas.clientWidth / 2);
    if (gain <= 0) continue;
    soundboard.play(cue.id, { pan: ((at.x / canvas.clientWidth) * 2 - 1) * 0.7, gain }, cue.kind);
  }
}

// Menu navigation and action buttons have separate fixed, nonverbal cues.
function onInterfaceClick(event: MouseEvent) {
  soundboard.unlock();
  if (event.target instanceof Element && event.target.closest("button, .map-entry")) soundboard.play(mainMenu.contains(event.target) ? "menu" : "click");
}

function onMouseDown(event: MouseEvent) {
  suppressCanvasMouseDefault(event);
  if (pointerLockArmed && event.button === 0) {
    pointerLockArmed = false;
    pointerLockUnavailable = true;
    hidePointerLockGate();
    void requestPointerLockFromEvent(event);
  }
  const point = inputPoint(event);
  lastMouse = point;
  if(equipmentPanel.isOpen()){
    if(document.pointerLockElement===canvas && event.button===0){
      if(document.elementFromPoint(point.x,point.y)?.closest('select,input,textarea')){pointerLockArmed=true;document.exitPointerLock();}
      else equipmentPanel.virtualPointer('pointerdown',point,event.buttons,event);
    }
    return;
  }
  // @@@virtual-pointer-ui - Pointer-lock mouse events target the canvas; UI follows the drawn virtual cursor.
  if (event.button === 0 && document.pointerLockElement === canvas) {
    const target = virtualClickableTargetAt(point);
    if (target) {
      virtualUiMouseDownTarget = target;
      target.focus({ preventScroll: true });
      return;
    }
  }
  if (!snapshot) return;
  const mini = minimapRect();
  if (commandMode) return;
  if (shouldDragMinimap(event.button, point, mini)) {
    draggingMinimapViewport = true;
    centerCameraFromMinimap(point);
    return;
  }
  if (isInsideRect(point, mini)) {
    return;
  }
  if (event.button === 0) {
    selectionStart = point;
    selectionEnd = point;
  }
}

function onMouseMove(event: MouseEvent) {
  suppressCanvasMouseDefault(event);
  const previousMouse = lastMouse;
  const point = inputPoint(event);
  if(equipmentPanel.isOpen()){lastMouse=point;if(document.pointerLockElement===canvas)equipmentPanel.virtualPointer('pointermove',point,event.buttons,event);return;}
  if (event.buttons === 4 && previousMouse && document.pointerLockElement !== canvas) {
    camera.x -= point.x - previousMouse.x;
    camera.y -= point.y - previousMouse.y;
    clampCamera();
  }
  if (draggingMinimapViewport) {
    centerCameraFromMinimap(point);
  }
  lastMouse = point;
  if (selectionStart) selectionEnd = point;
}

function onMouseUp(event: MouseEvent) {
  suppressCanvasMouseDefault(event);
  if (event.button === 2 && ignoreNextRightMouseUp && event.type === "mouseup") {
    ignoreNextRightMouseUp = false;
    return;
  }
  const point = inputPoint(event);
  if(equipmentPanel.isOpen()){if(document.pointerLockElement===canvas && event.button===0)equipmentPanel.virtualPointer('pointerup',point,event.buttons,event);return;}
  draggingMinimapViewport = false;
  if (event.button === 0 && document.pointerLockElement === canvas) {
    const target = virtualClickableTargetAt(point);
    if (target) {
      if (target === virtualUiMouseDownTarget) target.click();
      virtualUiMouseDownTarget = undefined;
      return;
    }
    virtualUiMouseDownTarget = undefined;
  }
  if (!snapshot) return;
  if (commandMode) {
    if (event.button === 0 && commandMode.type === "build") confirmBuildPlacement(point);
    else if (event.button === 0 && commandMode.type === "attackMove") issueAttackMoveAt(point, event.shiftKey);
    else if (event.button === 0 && commandMode.type === "aim") issueAimAt(point, event.shiftKey);
    else if (event.button === 0 && commandMode.type === "unload") issueUnloadAt(point, event.shiftKey);
    else if (event.button === 0 && commandMode.type === "spell") issueSpellAt(point, event.shiftKey);
    else if (event.button === 0 && commandMode.type === "item") issueItemAt(point);
    else if (event.button === 0 && commandMode.type === "purchaseRecipient") choosePurchaseRecipientAt(point);
    else if (event.button === 2) cancelCommandMode();
    selectionStart = undefined;
    selectionEnd = undefined;
    return;
  }
  if (event.button === 2 && document.pointerLockElement === canvas) {
    const target = virtualContextTargetAt(point);
    if (target) {
      openVirtualContextMenu(target);
      return;
    }
  }
  if (event.button === 2) {
    issueContextCommand(point, event.shiftKey);
    return;
  }
  if (event.button !== 0 || !selectionStart) return;

  const dragDistance = Math.hypot(point.x - selectionStart.x, point.y - selectionStart.y);
  if (dragDistance > 8 && selectionEnd) {
    selectUnitsInBox(selectionStart, selectionEnd, event.shiftKey);
  } else {
    selectSingle(point, event.shiftKey, event.detail >= 2);
  }
  selectionStart = undefined;
  selectionEnd = undefined;
  updateHud();
}

function issueContextCommand(point: Point, queued = false) {
  if (!syncBeforeCommandProjection()) return;
  if (!snapshot) return;
  const mini = minimapRect();
  issueContextCommandAtWorld(isInsideRect(point, mini) ? minimapPointToWorld(point, mini, snapshot.map) : screenToWorld(point), queued);
}

function issueContextCommandAtWorld(world: Point, queued = false) {
  if (!snapshot) return;
  const selectedUnits = selectedPlayerUnits().filter(unit=>!isInCabin(unit));
  const rallyBuildings = selectedPlayerRallyBuildings();
  if (selectedUnits.length === 0 && rallyBuildings.length > 0) {
    issueRallyCommandAtWorld(world, rallyBuildings);
    return;
  }
  const unitIds = selectedUnits.map((unit) => unit.id);
  if (unitIds.length === 0) {
    showInvalidCommand(t("status.selectUnitBeforeOrders"));
    return;
  }

  // What the pointer is on decides (see @@@pointer-target): an item is picked up, anything else is ordered as
  // @@@context-target says, and nothing (or nothing the selection can act on) is a move there.
  const target = visualPointerTarget(world);
  if (target?.kind === "item") {
    const command = pickupItemCommand(focusedPlayerUnits().filter(unit=>!isInCabin(unit)), target.item);
    if (!command) {
      showInvalidCommand(t("status.pickupNeedsFocus"));
      return;
    }
    sendCommand({ type: "pickupItem", unitId: command.unitId, itemId: command.itemId, queued });
    statusLabel.textContent = t("status.itemPickup", { item: labelKind(target.item.kind) });
    return;
  }
  const command = target ? targetCommand(snapshot, localPlayerId, selectedUnits, target, queued) : undefined;
  if (target && command) {
    sendCommand(command);
    statusLabel.textContent = contextOrderStatus(command, target);
    return;
  }
  const deckShip=target?.kind==='unit'?(shipProfile(target.unit)?target.unit:target.unit.deck?snapshot.units.find(unit=>unit.id===target.unit.deck!.shipId):undefined):undefined;
  const projected=worldPresentation.is3D&&deckShip&&!selectedUnits.some(unit=>shipProfile(unit))?worldPresentation.plane(worldToScreen(world),shipProfile(deckShip)!.deckHeight):undefined;
  const destination = projected??deckMovePoint(snapshot.units, selectedUnits, world);
  sendCommand({ type: "move", unitIds, x: destination.x, y: destination.y, queued, avoidCombat:true });
  statusLabel.textContent = t("status.moveOrdered");
}

function contextOrderStatus(command: GameCommand, target: Exclude<PointerTarget, { kind: "item" }>) {
  if (command.type === "mine") return t("status.mineOrdered");
  if (command.type === "repair" && target.kind === "building") return t("status.repairOrdered", { building: labelBuilding(target.building) });
  if ((command.type === "repairUnit" || command.type === "repairShip") && target.kind === "unit") return t("status.repairOrdered", { building: labelKind(target.unit.kind) });
  if (command.type === "board") return t("status.boardOrdered");
  if (command.type === "follow" && target.kind === "unit") return t("status.followOrdered", { target: labelAnyKind(target.unit.kind) });
  if (target.kind === "obstacle") return t("status.breakObstacleOrdered");
  const owner = target.kind === "unit" ? target.unit.owner : target.kind === "building" ? target.building.owner : undefined;
  return owner === "neutral" ? t("status.attackWildlingsOrdered") : t("status.attackOrdered");
}

function issueRallyCommandAtWorld(world: Point, buildings: Building[]) {
  if (!snapshot) return;
  const target = visualPointerTarget(world);
  const friendlyUnit = target?.kind === "unit" && target.unit.owner === localPlayerId ? target.unit : undefined;
  if (friendlyUnit) {
    sendCommand({ type: "setRally", buildingIds: buildings.map((building) => building.id), x: friendlyUnit.x, y: friendlyUnit.y, target: { type: "unit", unitId: friendlyUnit.id } });
    statusLabel.textContent = t("status.rallyFollow", { label: buildings.length > 1 ? t("hud.rallyPoints") : t("hud.rallyPoint"), target: labelAnyKind(friendlyUnit.kind) });
    return;
  }
  const resource = target?.kind === "resource" ? target.resource : undefined;
  if (resource) {
    sendCommand({ type: "setRally", buildingIds: buildings.map((building) => building.id), x: resource.x, y: resource.y, target: { type: "resource", resourceId: resource.id } });
    statusLabel.textContent = t("status.rallyGold", { label: buildings.length > 1 ? t("hud.rallyPoints") : t("hud.rallyPoint") });
    return;
  }
  sendCommand({ type: "setRally", buildingIds: buildings.map((building) => building.id), x: world.x, y: world.y, target: { type: "point" } });
  statusLabel.textContent = t("status.rallySet", { label: buildings.length > 1 ? t("hud.rallyPoints") : t("hud.rallyPoint") });
}

function loadedTransports() {
  return selectedPlayerUnits().filter((unit) => carries(unit) > 0 && shipPassengers(snapshot?.units ?? [],unit).length > 0);
}

function unloadButtonState(): CommandButtonState {
  if (commandMode || openPalette || !selectedPlayerUnits().some((unit) => carries(unit) > 0)) return HIDDEN_COMMAND_STATE;
  return booleanCommandState(loadedTransports().length > 0);
}

function beginUnloadMode() {
  if (loadedTransports().length === 0) {
    showInvalidCommand(t("status.unloadNeedsTransport"));
    return;
  }
  commandMode = { type: "unload" };
  shell.classList.add("targeting-active");
  shell.classList.remove("placement-active");
  statusLabel.textContent = t("status.unloadMode");
  updateHud();
}

function issueUnloadAt(point: Point, queued = false) {
  if (!syncBeforeCommandProjection()) return;
  if (!commandMode || commandMode.type !== "unload") return;
  const unitIds = loadedTransports().map((unit) => unit.id);
  clearCommandModeClasses();
  commandMode = undefined;
  if (unitIds.length === 0) showInvalidCommand(t("status.unloadNeedsTransport"));
  else {
    const world = screenToWorld(point);
    sendCommand({ type: "unload", unitIds, x: world.x, y: world.y, queued });
    statusLabel.textContent = t("status.unloadOrdered");
  }
  updateHud();
}

function unloadPassenger(transportId: string, passengerId: string) {
  if (!syncBeforeCommandProjection() || !snapshot) return;
  const transport = selectedCargoTransports(snapshot, selectedIds, localPlayerId).find(unit => unit.id === transportId);
  const passenger = transport && shipPassengers(snapshot.units,transport).find(unit=>unit.id===passengerId);
  if (!transport || !passenger) return;
  if (!passengerLandingSpot(snapshot.map, transport, passengerId, snapshot.units)) {
    showInvalidCommand(t("status.unloadNoLand"));
    return;
  }
  if (sendCommand({ type: "unloadPassenger", transportId, passengerId })) statusLabel.textContent = t("status.passengerUnloaded", { name: labelKind(passenger.kind) });
}

function canAttackMove() {
  return !commandMode && !openPalette && selectedPlayerUnits().some(unit=>!isInCabin(unit));
}

function cabinProblem(action: CabinAction) {
  return action.problem==='full' ? i18n.locale==='zh'?'舱内已满':'The cabin is full'
    : action.problem==='blocked' ? i18n.locale==='zh'?'舱门被堵住':'Cabin door blocked'
    : action.problem==='unsupported' ? i18n.locale==='zh'?'舱室仅供步行船员进入':'Only foot crew can enter the cabin'
    : i18n.locale==='zh'?'舱室已失守或损坏':'The cabin is breached or damaged';
}

function cabinButtonState(type:'enterCabin'|'leaveCabin'): CommandButtonState {
  if(!snapshot||commandMode||openPalette||!isUnitCommandPage(commandCardContext()))return HIDDEN_COMMAND_STATE;
  const focused=cabinAction(snapshot,localPlayerId,focusedPlayerUnits());
  if(!focused)return HIDDEN_COMMAND_STATE;
  const action=cabinAction(snapshot,localPlayerId,selectedPlayerUnits())!;
  if(action.type!==type)return HIDDEN_COMMAND_STATE;
  return action.enabled?ENABLED_COMMAND_STATE:{visible:true,enabled:false,reason:'position',detail:cabinProblem(action)};
}

function issueCabinAction() {
  if(!syncBeforeCommandProjection()||!snapshot)return;
  const action=cabinAction(snapshot,localPlayerId,selectedPlayerUnits()),command=cabinCommand(action);
  if(!command){if(action)showInvalidCommand(cabinProblem(action));return;}
  if(sendCommand(command))statusLabel.textContent=command.type==='enterCabin'?(i18n.locale==='zh'?'船员正在前往舱门':'Crew are walking to the cabin door'):(i18n.locale==='zh'?'已请求返回甲板；舱门需留出空间':'Return requested; leave space at the cabin door');
}

function canOpenBuildPalette() {
  return !commandMode && !openPalette && focusedPlayerUnits().some((unit) => !isInCabin(unit) && unit.kind === "worker");
}

function canBuild(kind: BuildingKind) {
  const player = currentPlayerState();
  return !commandMode && openPalette === "build" && BUILDABLE_BUILDING_KINDS.includes(kind) && Boolean(player && RACE_DEFS[player.race].buildableBuildings.includes(kind)) && focusedPlayerUnits().some((unit) => !isInCabin(unit) && unit.kind === "worker");
}

function canTrain(unitKind: TrainableUnitKind) {
  const player = currentPlayerState();
  return !commandMode && !openPalette && Boolean(player && RACE_DEFS[player.race].trainableUnits.includes(unitKind)) && focusedPlayerBuildings().some((building) => building.complete && BUILDING_DEFS[building.kind].trains.includes(unitKind));
}

function canResearch(upgradeKind: UpgradeKind) {
  return !commandMode && !openPalette && researchCommandButtonsForSelection(focusedPlayerBuildings(), currentPlayerState()).some((command) => command.upgradeKind === upgradeKind);
}

function canCast(ability: AbilityKind) {
  return abilityButtonState(ability).enabled;
}

function canHireMercenary() {
  return hireMercenaryButtonState().enabled;
}

function abilityButtonState(ability: AbilityKind): CommandButtonState {
  if (commandMode || openPalette) return HIDDEN_COMMAND_STATE;
  return abilityCommandState(focusedPlayerUnits(), ability, selectedPlayerUnits(), activeGameAdapter.pendingCasts?.());
}

function stanceMenuButtonState(): CommandButtonState {
  if (commandMode || openPalette) return HIDDEN_COMMAND_STATE;
  return stanceMenuCommandState(focusedPlayerUnits(), selectedPlayerUnits());
}

function stanceButtonState(stance: MeleeStance): CommandButtonState {
  if (commandMode || openPalette !== "stance") return HIDDEN_COMMAND_STATE;
  return stanceCommandState(focusedPlayerUnits(), stance, selectedPlayerUnits());
}

function currentStanceLabel() {
  const stance = sharedStance(selectedPlayerUnits());
  const command = STANCE_COMMANDS.find((candidate) => candidate.stance === stance);
  return command ? t(command.title) : t("command.stance.mixed");
}

function openStancePalette() {
  if (!stanceMenuButtonState().visible) return;
  openPalette = "stance";
  statusLabel.textContent = t("status.stanceMenuOpened");
  updateHud();
}

function setStance(stance: MeleeStance) {
  if (!syncBeforeCommandProjection()) return;
  const unitIds = stanceFighters(selectedPlayerUnits()).map((unit) => unit.id);
  if (unitIds.length === 0) return;
  sendCommand({ type: "setStance", unitIds, stance });
  const command = STANCE_COMMANDS.find((candidate) => candidate.stance === stance)!;
  closePalette(t("status.stanceSet", { stance: t(command.title) }));
}

function toggleAutocast(ability: AbilityKind) {
  if (!syncBeforeCommandProjection()) return;
  if (!abilityButtonState(ability).visible) return;
  const toggle = autocastToggle(selectedPlayerUnits(), ability);
  if (!toggle) return;
  sendCommand({ type: "setAutocast", unitIds: toggle.unitIds, ability, enabled: toggle.enabled });
  statusLabel.textContent = t(toggle.enabled ? "status.autocastOn" : "status.autocastOff", { ability: labelKind(ability) });
}

function hireMercenaryButtonState(): CommandButtonState {
  const camp = selectedMercenaryCamp();
  if (commandMode || openPalette) return HIDDEN_COMMAND_STATE;
  return mercenaryHireCommandState({
    camp,
    player: currentPlayerState(),
    hasFriendlyUnitAtCamp: camp ? friendlyUnitAtMercenaryCamp(camp) : false,
  });
}

function openBuildPalette() {
  if (!canOpenBuildPalette()) {
    showInvalidCommand(t("status.buildNeedsWorker"));
    return;
  }
  openPalette = "build";
  statusLabel.textContent = t("status.buildMenuOpened");
  updateHud();
}

function beginAimMode() {
  commandMode = { type: "aim" };
  shell.classList.add("targeting-active");
  shell.classList.remove("placement-active");
  statusLabel.textContent = t("status.aimMode");
  updateHud();
}

function issueAimAt(point: Point, queued = false) {
  if (!syncBeforeCommandProjection() || commandMode?.type !== "aim") return;
  const unitIds = selectedPlayerUnits().filter(unit => !isInCabin(unit) && aimingProfile(UNIT_DEFS[unit.kind])).map(unit => unit.id);
  if (!unitIds.length) { showInvalidCommand(t("command.aim.requirements")); return; }
  sendCommand({ type: "aim", unitIds, ...screenToWorld(point), queued });
  commandMode = undefined;
  clearCommandModeClasses();
  statusLabel.textContent = t("status.aimOrdered");
  updateHud();
}

function beginAttackMoveMode() {
  if (!canAttackMove()) {
    showInvalidCommand(t("status.attackMoveNeedsUnits"));
    return;
  }
  commandMode = { type: "attackMove" };
  shell.classList.add("targeting-active");
  shell.classList.remove("placement-active");
  statusLabel.textContent = t("status.attackMoveMode");
  updateHud();
}

function beginBuildPlacement(buildingKind: BuildingKind) {
  if (!snapshot) return;
  const worker = focusedPlayerUnits().find((unit) => unit.kind === "worker");
  if (!worker) {
    showInvalidCommand(t("status.buildNeedsWorker"));
    return;
  }
  openPalette = undefined;
  commandMode = { type: "build", placement: { workerId: worker.id, buildingKind } };
  shell.classList.add("placement-active");
  shell.classList.remove("targeting-active");
  statusLabel.textContent = t("status.chooseBuildingLocation", { building: labelKind(buildingKind) });
  updateHud();
}

function beginSpellTargeting(ability: AbilityKind) {
  if (!syncBeforeCommandProjection()) return;
  const state = abilityButtonState(ability);
  if (!state.enabled) {
    showCommandUnavailable(state, t("status.spellNeedsCaster", { ability: labelKind(ability) }));
    return;
  }
  const caster = preferredAbilityCaster(selectedPlayerUnits(), ability, focusedSelectionId, activeGameAdapter.pendingCasts?.());
  if (!caster) {
    showInvalidCommand(t("status.spellNeedsCaster", { ability: labelKind(ability) }));
    return;
  }
  if (ABILITY_DEFS[ability].behavior === "veteran") {
    if (sendCommand({ type: "cast", unitId: caster.id, ability })) statusLabel.textContent = `${veteranUnitCaption(caster)} · ${labelKind(ability)}`;
    updateHud();
    return;
  }
  commandMode = { type: "spell", targeting: { casterId: caster.id, ability } };
  shell.classList.add("targeting-active");
  shell.classList.remove("placement-active");
  const abilityDef = ABILITY_DEFS[ability];
  const behavior = abilityDef.behavior;
  const reach = chargeWindow(ability);
  statusLabel.textContent =
    behavior === "summon"
      ? t("status.summonMode")
      : reach
        ? t("status.chargeMode", { ability: labelKind(ability), min: reach.minRange })
        : t(abilityDef.behavior === "weapon" && abilityDef.target === "point" ? "status.spellPointMode" : "status.spellMode", { ability: labelKind(ability) });
  updateHud();
}

function placementRefusalText(refusal: PlacementRefusal, kind: BuildingKind) {
  const building = labelKind(kind);
  if (refusal.reason === "worker") return t("status.buildNeedsWorker");
  if (refusal.reason === "tooClose") return t("status.placementTooClose", { building, blocker: labelKind(refusal.blocker) });
  if (refusal.reason === "ground") return t("status.placementGround", { building });
  if (refusal.reason === "shore") return t("status.placementShore", { building });
  if (refusal.reason === "gold") return t("status.placementGold", { building, cost: refusal.cost });
  return refusal.message;
}

function confirmBuildPlacement(point: Point) {
  if (!syncBeforeCommandProjection()) return;
  if (!commandMode || commandMode.type !== "build" || !snapshot) return;
  const world = screenToWorld(point);
  const result = buildPlacementCommand(snapshot, commandMode.placement, world, localPlayerId);
  if ("refusal" in result) {
    showInvalidCommand(placementRefusalText(result.refusal, commandMode.placement.buildingKind));
    return;
  }
  sendCommand(result.command);
  statusLabel.textContent = t("status.foundationPlaced", { building: labelKind(commandMode.placement.buildingKind) });
  clearCommandModeClasses();
  commandMode = undefined;
  updateHud();
}

function issueAttackMoveAt(point: Point, queued = false) {
  if (!syncBeforeCommandProjection()) return;
  if (!commandMode || commandMode.type !== "attackMove") return;
  const unitIds = selectedPlayerUnits().filter(unit=>!isInCabin(unit)).map((unit) => unit.id);
  if (unitIds.length === 0) {
    showInvalidCommand(t("status.attackMoveNeedsUnits"));
    clearCommandModeClasses();
    commandMode = undefined;
    updateHud();
    return;
  }
  const world = screenToWorld(point);
  sendCommand({ type: "attackMove", unitIds, x: world.x, y: world.y, queued });
  statusLabel.textContent = t("status.attackMoveOrdered");
  clearCommandModeClasses();
  commandMode = undefined;
  updateHud();
}

function issueSpellAt(point: Point, queued = false) {
  if (!syncBeforeCommandProjection()) return;
  if (!commandMode || commandMode.type !== "spell" || !snapshot) return;
  const { ability, casterId } = commandMode.targeting;
  const world = screenToWorld(point);
  const def = ABILITY_DEFS[ability];
  const pointTarget = def.behavior === "summon" || (def.behavior === "weapon" && def.target === "point");
  const target = pointTarget ? undefined : def.behavior === "weapon"
    ? (hitUnit(world, unit => abilityUnitTargetMatches(snapshot!, ability, unit) && ["enemy", "creep"].includes(relationTo(snapshot!, localPlayerId, unit.owner)))
      ?? buildingAt(snapshot.buildings, world, building => relationTo(snapshot!, localPlayerId, building.owner) === "enemy"))
    : hitUnit(world, unit => abilityUnitTargetMatches(snapshot!, ability, unit) && [def.behavior === "heal" ? "own" : "enemy", def.behavior === "heal" ? "ally" : "creep"].includes(relationTo(snapshot!, localPlayerId, unit.owner)));
  if (!pointTarget && !target) {
    showInvalidCommand(t("status.spellNeedsTarget", { ability: labelKind(ability) }));
    return;
  }
  const pending = activeGameAdapter.pendingCasts?.();
  const ready = readyAbilityCasters(selectedPlayerUnits(), ability, pending);
  if (!ready.length) {
    showInvalidCommand(t("status.spellNeedsCaster", { ability: labelKind(ability) }));
    return;
  }
  const reach = chargeWindow(ability);
  if (reach && target && !chargeRiderFor(ready, target, reach, casterId)) {
    showInvalidCommand(t("status.chargeTooClose", { ability: labelKind(ability), min: reach!.minRange }));
    return;
  }
  const command = castCommandForSelection(snapshot, localPlayerId, selectedPlayerUnits(), ability, target ? { targetId: target.id } : world, casterId, queued, pending);
  if (!command) { showInvalidCommand(t("status.spellNeedsTarget", { ability: labelKind(ability) })); return; }
  if (!sendCommand(command)) return;
  statusLabel.textContent = t("status.spellOrdered", { ability: labelKind(ability) });
  clearCommandModeClasses();
  commandMode = undefined;
  updateHud();
}

function beginItemTargeting(entry: { item: WorldItem; carrier: Unit }) {
  commandMode = { type: "item", targeting: { unitId: entry.carrier.id, itemId: entry.item.id, kind: entry.item.kind } };
  shell.classList.add("targeting-active");
  shell.classList.remove("placement-active");
  statusLabel.textContent =
    entry.item.kind === "stormStaff" || entry.item.kind === "ivoryTower"
      ? t("status.itemModePoint", { item: labelKind(entry.item.kind) })
      : t("status.itemModeTarget", { item: labelKind(entry.item.kind) });
  updateHud();
}

function issueItemAt(point: Point) {
  if (!syncBeforeCommandProjection()) return;
  if (!commandMode || commandMode.type !== "item" || !snapshot) return;
  const { kind, itemId, unitId } = commandMode.targeting;
  const world = screenToWorld(point);
  if (kind === "stormStaff") {
    const target = hitUnit(world, (unit) => unit.owner !== localPlayerId);
    sendCommand(target ? { type: "useItem", unitId, itemId, x: target.x, y: target.y } : { type: "useItem", unitId, itemId, x: world.x, y: world.y });
    statusLabel.textContent = t("status.itemUsed", { item: labelKind(kind) });
    clearCommandModeClasses();
    commandMode = undefined;
    updateHud();
    return;
  }
  if (kind === "ivoryTower") {
    sendCommand({ type: "useItem", unitId, itemId, x: world.x, y: world.y });
    statusLabel.textContent = t("status.itemUsed", { item: labelKind(kind) });
    clearCommandModeClasses();
    commandMode = undefined;
    updateHud();
    return;
  }
  if (kind === "lightningRod") {
    const target = hitUnit(world, (unit) => unit.owner !== localPlayerId);
    if (!target) {
      showInvalidCommand(t("status.itemEnemyUnitTarget", { item: labelKind(kind) }));
      return;
    }
    sendCommand({ type: "useItem", unitId, itemId, targetId: target.id });
    statusLabel.textContent = t("status.itemUsed", { item: labelKind(kind) });
    clearCommandModeClasses();
    commandMode = undefined;
    updateHud();
    return;
  }
  if (kind === "breachCharge") {
    const target = hitBuilding(world, (building) => building.owner !== localPlayerId);
    if (!target) {
      showInvalidCommand(t("status.itemEnemyBuildingTarget", { item: labelKind(kind) }));
      return;
    }
    sendCommand({ type: "useItem", unitId, itemId, targetId: target.id });
    statusLabel.textContent = t("status.itemUsed", { item: labelKind(kind) });
    clearCommandModeClasses();
    commandMode = undefined;
    updateHud();
  }
}

function cancelCommandMode() {
  const canceled = commandMode?.type;
  commandMode = undefined;
  clearCommandModeClasses();
  statusLabel.textContent =
    canceled === "aim" ? t("status.aimCanceled") : canceled === "attackMove"
      ? t("status.attackMoveCanceled")
      : canceled === "unload"
        ? t("status.unloadCanceled")
        : canceled === "spell"
          ? t("status.spellCanceled")
          : canceled === "item"
            ? t("status.itemCanceled")
            : t("status.buildCanceled");
  updateHud();
}

function clearCommandModeClasses() {
  shell.classList.remove("placement-active", "targeting-active");
}

function closePalette(message?: string) {
  openPalette = undefined;
  if (message) statusLabel.textContent = message;
  updateHud();
}

function closeCommandPalette() {
  closePalette(openPalette === "veteran"
    ? i18n.locale === "zh" ? "已返回单位指令；候选技能已保留。" : "Returned to unit commands; skill choices are kept."
    : t(openPalette === "build" ? "status.buildMenuClosed" : "status.stanceMenuClosed"));
}

function train(unitKind: TrainableUnitKind) {
  if (!syncBeforeCommandProjection()) return;
  const player = currentPlayerState();
  if (!player || !RACE_DEFS[player.race].trainableUnits.includes(unitKind)) {
    showInvalidCommand(t("status.trainNeedsBuilding", { unit: labelKind(unitKind) }));
    return;
  }
  const building = focusedPlayerBuildings().find((candidate) => candidate.complete && BUILDING_DEFS[candidate.kind].trains.includes(unitKind));
  if (!building) {
    showInvalidCommand(t("status.trainNeedsBuilding", { unit: labelKind(unitKind) }));
    return;
  }
  const state = trainCommandState(unitKind, player, true);
  if (!state.enabled) { showCommandUnavailable(state, labelKind(unitKind)); return; }
  if (!sendCommand({ type: "train", buildingId: building.id, unitKind })) return;
  statusLabel.textContent = t("status.trainQueued", { unit: labelKind(unitKind) });
}

function research(upgradeKind: UpgradeKind) {
  if (!syncBeforeCommandProjection()) return;
  const command = researchCommandButtonsForSelection(focusedPlayerBuildings(), currentPlayerState()).find((candidate) => candidate.upgradeKind === upgradeKind);
  if (!command) {
    showInvalidCommand(t("status.researchNeedsBuilding", { upgrade: labelKind(upgradeKind) }));
    return;
  }
  sendCommand({ type: "research", buildingId: command.buildingId, upgradeKind });
  statusLabel.textContent = t("status.researchStarted", { upgrade: labelKind(command.upgradeKind) });
}

function shopGoodButtonState(kind: WorldItem["kind"]): CommandButtonState {
  const shop = selectedShop();
  if (!shop || commandMode || openPalette) return HIDDEN_COMMAND_STATE;
  const good = shop.goods.find((candidate) => candidate.kind === kind);
  const player = currentPlayerState();
  if (!good) return HIDDEN_COMMAND_STATE;
  if (!player) return { visible: true, enabled: false, reason: "missing" };
  if (good.stock <= 0) return { visible: true, enabled: false, cooldownTicks: good.restockRemaining, reason: "cooldown" };
  if (player.gold < good.cost) return { visible: true, enabled: false, reason: "gold" };
  const problem=purchaseProblem(kind);
  if (problem) return { visible: true, enabled: false, reason: "position",detail:problem };
  return ENABLED_COMMAND_STATE;
}

function purchaseSeller(){return selectedShop() ?? focusedPlayerBuildings().find(building=>building.kind==="shipyard" && building.complete);}
function purchaseRecipient(seller:PurchaseSeller&{id:string}){
  if(!snapshot)return;
  const recipient=findPurchaseRecipient(snapshot,localPlayerId,seller,purchaseRecipients.get(seller.id),"kind" in seller && seller.kind==="shipyard");
  if(recipient)purchaseRecipients.set(seller.id,recipient.id);
  else purchaseRecipients.delete(seller.id);
  return recipient;
}
function purchaseRecipientCaption(){
  const seller=purchaseSeller(),recipient=seller&&purchaseRecipient(seller);
  return recipient ? `${i18n.locale==="zh"?"接收":"To"}：${labelKind(recipient.kind)}` : i18n.locale==="zh"?"指定接收者":"Choose recipient";
}
function purchaseFeedback(reason:string){
  if(i18n.locale!=="zh")return reason;
  const text:Record<string,string>={
    "Choose a living unit or ship of yours":"请指定己方的人物或船作为接收者。",
    "Move the recipient closer to the seller":"接收者距离过远，请先靠近商店或船坞。",
    "The ship cannot carry more weight":"船只载重不足，请先腾出载重。",
    "The hold needs four consecutive free positions":"船炮需要船舱中连续四个空位。",
    "The hold has no free position":"船舱已满，请先腾出空位。",
    "This unit cannot carry equipment":"该单位不能接收装备。",
    "The recipient has no compatible free position":"接收者没有兼容的空装备位。",
  };return text[reason]??reason;
}
function purchaseProblem(kind:WorldItem['kind']){
  const seller=purchaseSeller();if(!seller || !snapshot)return;
  const recipient=purchaseRecipient(seller);
  if(!recipient)return purchaseFeedback("Choose a living unit or ship of yours");
  const result=purchasePlacement(snapshot,localPlayerId,seller,kind,recipient.id);
  return "refusal" in result ? purchaseFeedback(result.refusal) : undefined;
}
function startPurchaseRecipient(){
  const seller=purchaseSeller();if(!seller)return;
  commandMode={type:"purchaseRecipient",sellerId:seller.id};
  statusLabel.textContent=i18n.locale==="zh"?"点击附近的己方人物或船，指定购买接收者。":"Click a nearby friendly character or ship to receive purchases.";
  updateHud();
}
function choosePurchaseRecipientAt(point:Point){
  if(!snapshot || commandMode?.type!=="purchaseRecipient")return;
  const sellerId=commandMode.sellerId;
  const seller=snapshot.shops?.find(s=>s.id===sellerId) ?? snapshot.buildings.find(s=>s.id===sellerId);
  const recipient=hitUnit(screenToWorld(point),unit=>unit.owner===localPlayerId && unit.hp>0 && Boolean(canEquip(unit)||shipProfile(unit)));
  if(!seller || !recipient){showInvalidCommand(purchaseFeedback("Choose a living unit or ship of yours"));return;}
  if(!purchaseRecipientInRange(recipient,seller)){showInvalidCommand(purchaseFeedback("Move the recipient closer to the seller"));return;}
  purchaseRecipients.set(seller.id,recipient.id);purchaseRecipientFlash={id:recipient.id,until:performance.now()+900};
  commandMode=undefined;statusLabel.textContent=purchaseRecipientCaption();updateHud();
}
function dockGoodButtonState(kind:keyof typeof SHIP_WEAPONS):CommandButtonState{
  const dock=focusedPlayerBuildings().find(building=>building.kind==="shipyard" && building.complete);
  if(!dock || commandMode || openPalette)return HIDDEN_COMMAND_STATE;
  if((currentPlayerState()?.gold??0)<SHIP_WEAPONS[kind].cost)return {visible:true,enabled:false,reason:"gold"};
  const problem=purchaseProblem(kind);
  return problem ? {visible:true,enabled:false,reason:"position",detail:problem} : ENABLED_COMMAND_STATE;
}
function buyDockGood(kind:keyof typeof SHIP_WEAPONS){
  if(!syncBeforeCommandProjection())return;
  const dock=focusedPlayerBuildings().find(building=>building.kind==="shipyard" && building.complete);
  if(!dock)return;
  const state=dockGoodButtonState(kind);if(!state.enabled){showCommandUnavailable(state,purchaseProblem(kind)??"");return;}
  const recipient=purchaseRecipient(dock);if(!recipient)return;
  sendCommand({type:"buyShipEquipment",buildingId:dock.id,item:kind,recipientId:recipient.id});
  statusLabel.textContent=t("status.itemBought",{item:labelKind(kind)});
}
function drawPurchaseRecipientFlash(){
  const seller=purchaseSeller(),unit=seller&&purchaseRecipient(seller);
  if(!unit || !snapshot)return;
  const at=worldPresentation.position(unit.id),profile=shipProfile(unit),point=worldToScreen(at ? {x:at.x,y:profile?at.y:at.bodyY+(creatureShadow(unit.kind)?.y??17)*unitGlyphScale(unit.radius)} : unitPointerPosition(snapshot.units,unit));
  const flash=purchaseRecipientFlash, pulse=flash?.id===unit.id ? Math.max(0,(flash.until-performance.now())/900) : 0;
  ctx.save();ctx.strokeStyle="#e5bc58";ctx.lineWidth=2+pulse;
  ctx.beginPath();
  if(profile){
    const hull={...unit,x:at?.x??unit.x,y:at?.y??unit.y,sailing:{heading:unitMotion.heading(unit,performance.now()),speed:0,load:0,balance:0}};
    profile.hull.forEach((vertex,index)=>{const p=worldToScreen(localToWorld(hull,vertex));if(index===0)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);});ctx.closePath();
  }else ctx.ellipse(point.x,point.y,(unit.radius+7)*worldZoom,(unit.radius+7)*worldZoom*.55,0,0,Math.PI*2);
  ctx.stroke();
  ctx.fillStyle="#e5bc58";ctx.strokeStyle="#443321";ctx.lineWidth=2;
  ctx.beginPath();ctx.arc(point.x,point.y-24*worldZoom,8,0,Math.PI*2);ctx.fill();ctx.stroke();
  ctx.fillStyle="#443321";ctx.font="bold 11px sans-serif";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText("↓",point.x,point.y-24*worldZoom);
  ctx.restore();
}

function buyGood(kind: WorldItem["kind"]) {
  if (!syncBeforeCommandProjection()) return;
  const shop = selectedShop();
  if (!shop) return;
  const state = shopGoodButtonState(kind);
  if (!state.enabled) {
    showCommandUnavailable(state, t("status.buyNeedsUnitAtShop"));
    return;
  }
  const recipient=purchaseRecipient(shop);if(!recipient)return;
  sendCommand({ type: "buy", shopId: shop.id, item: kind,recipientId:recipient.id });
  inspectedShopItem = kind;
  selectedIds = new Set();
  focusedSelectionId = undefined;
  selectedCampId = shop.id;
  statusLabel.textContent = t("status.itemBought", { item: labelKind(kind) });
  updateHud();
}

function hireMercenary() {
  if (!syncBeforeCommandProjection()) return;
  const camp = selectedMercenaryCamp();
  if (!camp) {
    showInvalidCommand(t("status.hireNeedsCamp"));
    return;
  }
  const state = hireMercenaryButtonState();
  if (!state.enabled) {
    showCommandUnavailable(state, t("status.hireNeedsUnitAtCamp"));
    return;
  }
  sendCommand({ type: "hire", campId: camp.id });
  statusLabel.textContent = t("status.mercenaryHired");
}

function selectUnitsInBox(start: Point, end: Point, additive = false) {
  if (!snapshot) return;
  const result = selectInScreenBox(snapshot, localPlayerId, selectionRect(start, end), worldToScreen, { selectedIds, focusedSelectionId }, additive,unit=>{const at=worldPresentation.position(unit.id);return at?{x:at.x,y:at.bodyY}:unitPointerPosition(snapshot!.units,unit);});
  selectedIds = result.selectedIds;
  focusedSelectionId = result.focusedSelectionId;
  if (selectedIds.size > 0 || !additive) selectedCampId = undefined;
  if (selectedIds.size > 0 || !additive) openPalette = undefined;
}

function selectSingle(point: Point, additive = false, sameKind = false) {
  const world = screenToWorld(point);
  if (selectedIds.size && !selectedPlayerUnits().length && !selectedPlayerBuildings().length) additive = false;
  const unit = hitUnit(world, () => true);
  if (unit) {
    if (unit.owner !== localPlayerId) additive = false;
    const result = sameKind && unit.owner === localPlayerId
      ? selectNearbySameKindUnits(snapshot!, localPlayerId, unit.id, DOUBLE_CLICK_SAME_KIND_RADIUS, { selectedIds, focusedSelectionId }, additive)
      : applySelectionPick({ selectedIds, focusedSelectionId }, [unit.id], additive);
    selectedIds = result.selectedIds;
    focusedSelectionId = result.focusedSelectionId;
    selectedCampId = undefined;
    openPalette = undefined;
    return;
  }
  const building = hitBuilding(world, () => true);
  if (building) {
    if (building.owner !== localPlayerId) additive = false;
    const result = applySelectionPick({ selectedIds, focusedSelectionId }, [building.id], additive);
    selectedIds = result.selectedIds;
    focusedSelectionId = result.focusedSelectionId;
    selectedCampId = undefined;
    openPalette = undefined;
    return;
  }
  if (additive) return;
  const camp = hitMercenaryCamp(world) ?? hitShop(world);
  selectedIds = new Set();
  focusedSelectionId = undefined;
  selectedCampId = camp?.id;
  inspectedShopItem = undefined;
  openPalette = undefined;
}

function selectedPlayerUnits() {
  return snapshot?.units.filter((unit) => unit.owner === localPlayerId && selectedIds.has(unit.id)) ?? [];
}

function selectedPlayerBuildings() {
  return snapshot?.buildings.filter((building) => building.owner === localPlayerId && selectedIds.has(building.id)) ?? [];
}

function selectedPlayerRallyBuildings() {
  return selectedPlayerBuildings().filter((building) => BUILDING_DEFS[building.kind].trains.length > 0);
}

function focusedPlayerUnits() {
  if (!snapshot) return [];
  return focusedSelectionEntities(snapshot, focusedSelectionId, localPlayerId).units;
}

function focusedPlayerBuildings() {
  if (!snapshot) return [];
  return focusedSelectionEntities(snapshot, focusedSelectionId, localPlayerId).buildings;
}

function selectedMercenaryCamp() {
  return snapshot?.mercenaryCamps.find((camp) => camp.id === selectedCampId);
}

function selectedShop() {
  return snapshot?.shops?.find((shop) => shop.id === selectedCampId);
}

function commandCardContext() {
  return { paletteOpen: Boolean(openPalette), targeting: Boolean(commandMode), siteSelected: Boolean(selectedCampId) };
}

function inventoryCarriers() {
  return snapshot ? inventoryUnitsForCommandCard(snapshot, focusedSelectionId, localPlayerId, commandCardContext()) : [];
}

function friendlyUnitAtMercenaryCamp(camp: NonNullable<ReturnType<typeof selectedMercenaryCamp>>) {
  return Boolean(snapshot?.units.some((unit) => unit.owner === localPlayerId && distance(unit, camp) <= camp.radius + unit.radius + 100));
}

function currentPlayerState() {
  return snapshot?.players[localPlayerId];
}

function selectionRect(start: Point, end: Point): SelectionScreenRect {
  return {
    left: Math.min(start.x, end.x),
    right: Math.max(start.x, end.x),
    top: Math.min(start.y, end.y),
    bottom: Math.max(start.y, end.y),
  };
}

function pruneSelection() {
  if (!snapshot) return;
  const liveIds = liveSelectionIds(snapshot, localPlayerId);
  if (commandMode?.type === "build" && !liveIds.has(commandMode.placement.workerId)) {
    commandMode = undefined;
    clearCommandModeClasses();
  }
  if (commandMode?.type === "item") {
    const targeting = commandMode.targeting;
    if (!liveIds.has(targeting.unitId) || !snapshot.items.some((item) => item.id === targeting.itemId && item.carrierId === targeting.unitId)) {
      commandMode = undefined;
      clearCommandModeClasses();
    }
  }
  if (openPalette === "build" && !focusedPlayerUnits().some((unit) => unit.kind === "worker")) openPalette = undefined;
  if (openPalette === "stance" && stanceFighters(focusedPlayerUnits()).length === 0) openPalette = undefined;
  if (openPalette === "veteran" && !focusedVeteranStudent()) openPalette = undefined;
}

function handleGameplayKeyIntent(event: KeyboardEvent) {
  if(equipmentPanel.isOpen())return true;
  if (!snapshot) return false;
  const inventoryEntries = carriedItemsForSelection(snapshot, inventoryCarriers()).slice(0, 6);
  const reservedGroupDigits = new Set(Object.keys(controlGroups).map(Number));
  const intent = gameplayKeyIntent(event, {
    controlGroups: reservedGroupDigits,
    inventorySlots: inventoryEntries.length,
    inventoryHotkeys: itemHotkeys(inventoryEntries.length, reservedGroupDigits).map(Number),
    commandHotkeys: new Set(commandButtons.filter((button) => button.state().visible).map((button) => button.hotkey)),
  });
  if (intent.type === "none") return false;
  if (intent.type === "inventoryUse") return useInventoryItem(intent.index);
  if (intent.type === "commandHotkey") {
    const command = commandButtons.find((button) => button.hotkey === intent.hotkey && button.state().visible);
    command?.run();
    return Boolean(command);
  }
  if (intent.type === "controlGroupReplace") {
    if (selectedPlayerUnits().length + selectedPlayerBuildings().length === 0) {
      showInvalidCommand(t("status.groupNeedsSelection", { slot: intent.slot }));
      return true;
    }
    replaceControlGroup(controlGroups, intent.slot, new Set([...selectedPlayerUnits(), ...selectedPlayerBuildings()].map(entity => entity.id)));
    lastControlGroupRecall = undefined;
    statusLabel.textContent = t("status.groupSet", { slot: intent.slot });
    return true;
  }
  selectControlGroup(intent.slot);
  return true;
}

function selectControlGroup(slot: number) {
  if (!snapshot) return;
  const ids = recallControlGroup(controlGroups, slot, liveSelectionIds(snapshot));
  if (ids.length === 0) {
    delete controlGroups[slot];
    showInvalidCommand(t("status.groupEmpty", { slot }));
    return;
  }
  const recallTap = controlGroupRecallTap(lastControlGroupRecall, slot, performance.now());
  lastControlGroupRecall = recallTap.nextTap;
  selectedIds = new Set(ids);
  focusedSelectionId = resolveFocusedSelectionId(snapshot, selectedIds, focusedSelectionId, localPlayerId);
  selectedCampId = undefined;
  openPalette = undefined;
  statusLabel.textContent = t("status.groupSelected", { slot });
  if (recallTap.shouldCenterCamera) centerCameraOnControlGroup(ids);
  updateHud();
}

function cycleFocusedSelection(direction: 1 | -1) {
  if (!snapshot || selectedIds.size === 0) return;
  const nextFocus = cycleFocusedSelectionId(snapshot, selectedIds, focusedSelectionId, localPlayerId, direction);
  if (!nextFocus || nextFocus === focusedSelectionId) return;
  focusedSelectionId = nextFocus;
  openPalette = undefined;
  updateHud();
}

function updateHud() {
  if (!snapshot) return;
  for (const [id, tick] of pendingVeteranChoices) {
    const unit = snapshot.units.find(candidate => candidate.id === id);
    if (!unit || unit.veteranSkill || snapshot.tick < tick || snapshot.tick - tick > 100) pendingVeteranChoices.delete(id);
  }
  const player = currentPlayerState();
  goldLabel.textContent = String(player?.gold ?? "?");
  supplyLabel.textContent = player ? `${player.supplyUsed}/${player.supplyCap}` : "?";
  mapReadout.textContent = poolMap(snapshot.map.id) ? mapName(snapshot.map.id) : snapshot.map.name;
  const focusedBuildings = focusedPlayerBuildings();
  const camp = selectedMercenaryCamp();
  const groups = buildSelectionGroups(snapshot, selectedIds, focusedSelectionId, localPlayerId);
  if (!groups.length || selectedShop()) {
    const subject = selectionLabel.querySelector<HTMLElement>(".hud-subject");
    if (subject) delete subject.dataset.tooltipTitle;
  }
  if (selectedShop()) {
    const shop = selectedShop()!;
    const buyer = purchaseRecipient(shop);
    const identity: HudIdentity = {
      key: shop.id, name: t("hud.shop"), caption: t("hud.neutral"),
      detail: buyer ? t("hud.buyer", { name:labelKind(buyer.kind) }) : t("hud.shopApproach"),
      art: { key:"shop", paint: canvas => drawAtlasBuildingPortrait(requireCanvasContext(canvas), "shop", canvas.clientWidth, "#8b7355") },
    };
    if (inspectedShopItem) identity.inspection = {
      name:labelKind(inspectedShopItem), detail:t("hud.purchasedItem"),
      art:{ key:inspectedShopItem, paint: canvas => drawPaintedItem(requireCanvasContext(canvas), inspectedShopItem!, { x:canvas.clientWidth/2,y:canvas.clientHeight/2 }, canvas.clientWidth*.8) },
    };
    hudSelection.render(identity, [], t("hud.nothingSelected"));
  } else if (groups.length > 0) {
    renderSelectionGroups(groups);
  } else if (camp) {
    hudSelection.render({
      key:camp.id, name:t("hud.campName"), caption:t("hud.neutral"),
      detail:t("hud.campStock", { stock:camp.stock }) + (camp.cooldownRemaining > 0 ? t("hud.restocking") : ""),
      art:{ key:"camp", paint:canvas => drawAtlasBuildingPortrait(requireCanvasContext(canvas), "camp", canvas.clientWidth, "#8b7355") },
    }, [], t("hud.nothingSelected"));
  } else hudSelection.render(undefined, [], t("hud.nothingSelected"));
  let visibleCount = 0;
  for (const button of commandButtons) {
    const state = button.state();
    if (state.visible) renderVeteranCommand(button);
    if(state.visible && button.portrait)drawCommandPortrait(button.element,button.portrait);
    if(button.element.dataset.purchaseRecipient){const caption=purchaseRecipientCaption();button.element.querySelector(".command-label")!.textContent=caption;button.element.setAttribute("aria-label",`${i18n.locale==="zh"?"指定接收者":"Choose recipient"} · ${caption} (O)`);}
    button.element.hidden = !state.visible;
    button.element.disabled = false;
    button.element.setAttribute("aria-disabled", String(!state.enabled));
    button.element.classList.toggle("command-button-disabled", state.visible && !state.enabled);
    button.element.classList.toggle("command-button-cooldown", state.cooldownTicks !== undefined);
    renderCommandButtonState(button.element, state);
    applyTooltip(button.element, commandButtonTooltip(button.tooltip(), state));
    if (state.visible) visibleCount += 1;
  }
  commandDock.querySelectorAll("[data-research-progress]").forEach((element) => element.remove());
  const previousTraining = new Map(Array.from(commandDock.querySelectorAll<HTMLButtonElement>("[data-training-progress]"), button => [button.dataset.jobId, button]));
  for (const progress of trainingProgressButtonsForSelection(focusedBuildings)) {
    const previous = previousTraining.get(progress.jobId);
    const button = renderTrainingProgressButton(progress, previous);
    if (!previous) commandDock.append(button);
    previousTraining.delete(progress.jobId);
    visibleCount += 1;
  }
  for (const button of previousTraining.values()) button.remove();
  for (const progress of researchProgressButtonsForSelection(focusedBuildings, player)) {
    commandDock.append(renderResearchProgressButton(progress));
    visibleCount += 1;
  }
  commandDock.hidden = visibleCount === 0;
  renderItemDock();
  hudActions.hidden = commandDock.hidden && itemDock.hidden;
  controlDeck.hidden = selectionLabel.hidden && hudActions.hidden;
}

function renderSelectionGroups(groups: SelectionGroup[]) {
  const focused = groups.find(group => group.focused) ?? groups[0]!;
  const identityId = focused.ids.includes(focusedSelectionId ?? "") ? focusedSelectionId : focused.ids[0];
  const entity = snapshot && [...snapshot.units, ...snapshot.buildings].find(entity => entity.id === identityId);
  const total = groups.reduce((sum, group) => sum + group.count, 0);
  const owner = entity?.owner ?? localPlayerId;
  const identity: HudIdentity = {
    key:entity?.id ?? focused.id,
    name:labelAnyKind(focused.kind) + (focused.count > 1 ? ` ${focused.ids.indexOf(entity?.id ?? focused.ids[0]!) + 1}/${focused.count}` : ""),
    caption: total > 1 ? t("hud.selectedCount", { count:total }) : owner === localPlayerId ? "" : owner === "neutral" ? t("hud.neutral") : playerDisplayName(owner, currentRoom?.slots ?? [], t("hud.otherPlayer")),
    detail:entity && "order" in entity ? [entity.attackDamage > 0 ? t("hud.attackValue", { damage:entity.attackDamage }) : "",
      entity.level > 0 ? "★".repeat(Math.min(3, entity.level)) : "",
      owner === localPlayerId && !isInCabin(entity) && canLearnVeteranSkill(entity) ? i18n.locale === "zh" ? "可学习 +" : "Skill ready +" : "",
      sailingStatus(entity), cabinStatus(entity,i18n.locale==='zh'),
    ].filter(Boolean).join(" · ") : "",
    art:{ key:`${focused.kind}:${owner}`, paint:canvas => drawSelectionModel(canvas, focused) },
    ...(entity ? { health:{ current:entity.hp, max:entity.maxHp } } : {}),
  };
  hudSelection.render(identity, groups.map(group => {
    const owner = snapshot && [...snapshot.units, ...snapshot.buildings].find(entity => entity.id === group.ids[0])?.owner;
    return {
      key:group.id, name:labelAnyKind(group.kind), count:group.count, focused:group.focused,
      art:{ key:`${group.kind}:${owner}`, paint:(canvas:HTMLCanvasElement) => drawSelectionModel(canvas, group) },
      activate:() => { focusedSelectionId = group.ids[0]; openPalette = undefined; updateHud(); },
      decorate:(button:HTMLButtonElement) => applyTooltip(button, selectionGroupTooltip(group)),
    };
  }), t("hud.nothingSelected"), selectedCargoTransports(snapshot!, selectedIds, localPlayerId).map(transport => ({
    key: transport.id,
    ...(transport.id === entity?.id ? {} : { health: { current: transport.hp, max: transport.maxHp } }),
    label: t("hud.transportCargo", { name: labelKind(transport.kind), used: formatMass(deckLoad(snapshot!.units,transport)), capacity: formatMass(carries(transport)) }),
    passengers: shipPassengers(snapshot!.units,transport).filter(passenger=>!isInCabin(passenger)||passenger.owner===localPlayerId).map(passenger => ({
      canUnload: passenger.owner===localPlayerId,
      key: passenger.id, name: labelKind(passenger.kind)+(isInCabin(passenger)?i18n.locale==='zh'?' · 舱内':' · Cabin':''), actionLabel: isInCabin(passenger)?`${labelKind(passenger.kind)} · ${cabinStatus(passenger,i18n.locale==='zh')}`:t("hud.unloadPassenger", { name: labelKind(passenger.kind) }),
      health: { current: passenger.hp, max: passenger.maxHp },
      art: { key: `${passenger.kind}:${passenger.owner}`, paint: (canvas: HTMLCanvasElement) => drawAtlasUnitPortrait(requireCanvasContext(canvas), passenger.kind, 0, 0, canvas.clientWidth, ownerInk(passenger.owner)) },
      activate: () => {if(isInCabin(passenger)){selectedIds=new Set([passenger.id]);focusedSelectionId=passenger.id;openPalette=undefined;updateHud();}else unloadPassenger(transport.id, passenger.id);},
      decorate: (button: HTMLButtonElement) => {button.dataset.inCabin=String(isInCabin(passenger));applyTooltip(button, { ...unitSelectionTooltip(passenger.kind, [passenger], snapshot!, i18n), title: isInCabin(passenger)?`${labelKind(passenger.kind)} · ${cabinStatus(passenger,i18n.locale==='zh')}`:t("hud.unloadPassenger", { name: labelKind(passenger.kind) }), requirements: [isInCabin(passenger)?i18n.locale==='zh'?'点击选中船员，可返回甲板。':'Select this crew member to return to deck.':t("hud.unloadPassengerHint")] });},
    })),
  })));
  const subject = selectionLabel.querySelector<HTMLElement>(".hud-subject");
  if (subject && entity) applyTooltip(subject, "order" in entity
    ? unitSelectionTooltip(entity.kind, [entity], snapshot!, i18n)
    : buildingTooltip(entity.kind, undefined, i18n, snapshot?.players[entity.owner]?.race));
}

function sailingStatus(unit: Unit): string {
  const mode = unit.sailing?.sail?.mode;
  if (mode === 'tacking') return i18n.locale === 'zh' ? '迎风换舷' : 'Tacking';
  if (mode === 'maneuver' || mode === 'calm-assist') return i18n.locale === 'zh' ? '辅助操纵' : 'Maneuvering';
  return '';
}

function updateWindIndicator(rect: ScreenRect, now: number) {
  if (!snapshot || !windProbe) return;
  const wind = windAt(snapshot.map, windProbe), ratio = wind.speed / DEFAULT_WIND.speed;
  const display = windMapDisplay.sample(windProbe, now);
  minimapWindArrow.style.transform = `rotate(${projectWindDirection(display.direction, snapshot.map, rect)}rad)`;
  minimapWindButton.dataset.calm = String(display.speed <= 1e-7);
  const pulse = String(windMapDisplay.pulse(now));
  minimapWindButton.style.setProperty('--wind-pulse', pulse);
  minimapFrame.style.setProperty('--wind-pulse', pulse);
  const strength = ratio <= 1e-7 ? 0 : ratio < .75 ? 1 : ratio < 1.2 ? 2 : 3;
  const zh = i18n.locale === 'zh';
  const level = (zh ? ['无风', '微风', '中风', '强风'] : ['Calm', 'Light wind', 'Moderate wind', 'Strong wind'])[strength]!;
  const compass = (Math.round(wind.direction / (Math.PI / 4)) + 8) % 8;
  const direction = (zh ? ['东', '东南', '南', '西南', '西', '西北', '北', '东北'] : ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'])[compass]!;
  const label = strength === 0 ? level : `${level} · ${zh ? '吹向' : 'toward '}${direction}`;
  const remaining = Math.ceil((WIND_CHANGE_INTERVAL_TICKS - snapshot.tick % WIND_CHANGE_INTERVAL_TICKS) / SIM_TICKS_PER_SECOND);
  const countdown = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;
  const key = `${label}:${countdown}:${minimapWind}`;
  if (windTooltipKey === key) return;
  windTooltipKey = key;
  minimapWindButton.setAttribute('aria-label', `${t('hud.minimapWind')} · ${label}`);
  applyTooltip(minimapWindButton, {
    title: `${zh ? '光标处' : 'At cursor'}：${label}`,
    hotkey: 'Alt+W',
    body: zh ? `点击${minimapWind ? '收起' : '显示'}风向图。当前全图同风。` : `Click to ${minimapWind ? 'hide' : 'show'} the wind map. Wind is currently uniform across the map.`,
    stats: [zh ? `下次换风 ${countdown}` : `Wind changes in ${countdown}`], requirements: [],
  });
  if (!tooltipLayer.classList.contains('hidden') && shownTooltipTarget === minimapWindButton) renderTooltip(minimapWindButton);
}

function selectionGroupTooltip(group: SelectionGroup): GameplayTooltip {
  if (group.entityType === "unit") {
    const units = snapshot?.units.filter((unit) => group.ids.includes(unit.id)) ?? [];
    return unitSelectionTooltip(group.kind, units, snapshot!, i18n);
  }
  const building = snapshot?.buildings.find(building => building.id === group.ids[0]);
  return buildingTooltip(group.kind, undefined, i18n, building ? snapshot?.players[building.owner]?.race : undefined);
}

function drawSelectionModel(canvas: HTMLCanvasElement, group: SelectionGroup) {
  const mini = requireCanvasContext(canvas);
  mini.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  const owner = snapshot && [...snapshot.units, ...snapshot.buildings].find(entity => entity.id === group.ids[0])?.owner;
  const color = ownerInk(owner ?? localPlayerId);
  if (group.entityType === "unit") drawAtlasUnitPortrait(mini, group.kind, 0, 0, canvas.clientWidth, color);
  else drawAtlasBuildingPortrait(mini, group.kind, canvas.clientWidth, color);
}

function renderResearchProgressButton(progress: ResearchProgressButton) {
  const percent = Math.floor(progress.progress * 100);
  const label = t(progress.status === "researching" ? "hud.trainingResearching" : "hud.trainingQueued", { label: `${labelKind(progress.upgradeKind)} ${romanLevel(progress.targetLevel)}` });
  const button = document.createElement("button");
  button.type = "button";
  button.tabIndex = -1;
  button.className = "command-button research-progress-button";
  button.setAttribute("aria-disabled", "true");
  button.dataset.researchProgress = progress.upgradeKind;
  button.dataset.commandLabel = label;
  button.setAttribute("aria-label", `${label} - ${percent}%`);
  const tooltip = upgradeTooltip(progress.upgradeKind, undefined, progress.targetLevel - 1, i18n);
  applyTooltip(button, {
    ...tooltip,
    title: label,
    stats: [t("hud.progressComplete", { percent }), ...tooltip.stats],
  });
  button.style.setProperty("--research-progress", `${percent}%`);
  button.innerHTML = `
    <span class="research-progress-fill"></span>
    <span class="command-icon">${escapeHtml(progress.icon)}</span>
    <span class="command-label">${escapeHtml(labelKind(progress.upgradeKind))}</span>
    <span class="research-progress-text">${progress.status === "researching" ? `${percent}%` : escapeHtml(t("hud.productionQueueBadge"))}</span>
  `;
  return button;
}

function renderTrainingProgressButton(progress: TrainingProgressButton, previous?: HTMLButtonElement) {
  const percent = Math.floor(progress.progress * 100);
  const label = t(progress.status === "training" ? "hud.trainingTraining" : "hud.trainingQueued", { label: labelKind(progress.unitKind) });
  const button = previous ?? document.createElement("button");
  button.type = "button";
  button.tabIndex = -1;
  button.className = "command-button research-progress-button";
  button.classList.add("training-cancel-button");
  button.disabled = !progress.jobId;
  if (!previous) button.addEventListener("click", () => {
    if (progress.jobId) sendCommand({ type: "cancelTraining", buildingId: progress.buildingId, jobId: progress.jobId });
  });
  if (progress.jobId) button.dataset.jobId = progress.jobId;
  button.dataset.trainingProgress = progress.unitKind;
  button.dataset.commandLabel = label;
  button.setAttribute("aria-label", `${label} - ${percent}%`);
  const tooltip = unitTooltip(progress.unitKind, undefined, i18n);
  applyTooltip(button, {
    ...tooltip,
    title: `${label} · ${t("hud.cancelTraining")}`,
    stats: [t("hud.progressComplete", { percent }), ...tooltip.stats],
  });
  button.style.setProperty("--research-progress", `${percent}%`);
  if (!previous) button.innerHTML = `
    <span class="research-progress-fill"></span>
    <span class="command-icon">${escapeHtml(trainIcon(progress.unitKind))}</span>
    <span class="command-label">${escapeHtml(labelKind(progress.unitKind))}</span>
    <span class="research-progress-text"></span>
  `;
  drawCommandPortrait(button, { type: "unit", kind: progress.unitKind });
  button.querySelector(".research-progress-text")!.textContent = progress.status === "training" ? `${percent}%` : t("hud.productionQueueBadge");
  return button;
}

function renderItemDock() {
  equipmentPanel.update(menuOpen?undefined:snapshot,localPlayerId);

  if (!snapshot || menuOpen) {
    hudActions.removeAttribute("data-has-items");
    itemDock.hidden = true;
    itemDock.replaceChildren();
    return;
  }
  const inventory = carriedItemsForSelection(snapshot, focusedSelectionEntities(snapshot, focusedSelectionId, localPlayerId).units.filter(unit=>!isInCabin(unit))).slice(0, 6);
  hudActions.toggleAttribute("data-has-items", inventory.length > 0 && !selectedCampId);
  const entries = isUnitCommandPage(commandCardContext()) ? inventory : [];
  const hotkeys = itemHotkeys(entries.length, new Set(Object.keys(controlGroups).map(Number)));
  itemDock.hidden = entries.length === 0;
  const previous = new Map(Array.from(itemDock.querySelectorAll<HTMLButtonElement>("[data-item-id]"), button => [button.dataset.itemId, button]));
  entries.forEach(({ item, carrier }, index) => {
    const hotkey = hotkeys[index] ?? "";
    let button = previous.get(item.id);
    if (!button) {
      button = document.createElement("button");
      button.type = "button"; button.className = "item-button"; button.dataset.itemId = item.id;
      button.innerHTML = '<span class="item-icon"></span><span class="hotkey"></span><span class="item-cooldown" hidden></span>';
      const liveButton = button;
      button.addEventListener("click", () => useCarriedItem(liveButton.dataset.itemId!));
      button.addEventListener("contextmenu", event => { event.preventDefault(); dropCarriedItem(liveButton.dataset.itemId!, liveButton.dataset.carrierId!); });
      drawCommandPortrait(button, { type:"item", kind:item.kind });
    }
    button.dataset.carrierId = carrier.id;
    const cooldownText = item.cooldownRemaining > 0 ? t("hud.itemRecharging", { ticks:item.cooldownRemaining }) : "";
    button.setAttribute("aria-label", `${labelKind(item.kind)} (${hotkey})${cooldownText}`);
    applyTooltip(button, itemTooltip(item.kind, hotkey, i18n));
    button.querySelector(".hotkey")!.textContent = hotkey;
    const cooldown = button.querySelector<HTMLElement>(".item-cooldown")!;
    cooldown.hidden = item.cooldownRemaining <= 0;
    cooldown.textContent = `${Math.ceil(item.cooldownRemaining / 20)}s`;
    if (itemDock.children[index] !== button) itemDock.insertBefore(button, itemDock.children[index] ?? null);
    previous.delete(item.id);
  });
  for (const button of previous.values()) button.remove();
}

function useInventoryItem(index: number) {
  if (!syncBeforeCommandProjection()) return false;
  if (!snapshot) return false;
  const entry = carriedItemsForSelection(snapshot, inventoryCarriers())[index];
  if (!entry) return false;
  useCarriedItem(entry.item.id);
  return true;
}

function useCarriedItem(itemId: string) {
  if (!syncBeforeCommandProjection()) return;
  if (!snapshot) return;
  const entry = carriedItemsForSelection(snapshot, inventoryCarriers()).find(({ item }) => item.id === itemId);
  if (!entry) return;
  if(isInCabin(entry.carrier)){showInvalidCommand(i18n.locale==='zh'?'返回甲板后再使用物品':'Return to deck before using items');return;}
  if (ITEM_DEFS[entry.item.kind].passive) {
    showInvalidCommand(t("status.itemPassive", { item: labelKind(entry.item.kind) }));
    return;
  }
  if (entry.item.cooldownRemaining > 0) {
    showInvalidCommand(t("status.itemRecharging", { item: labelKind(entry.item.kind) }));
    return;
  }
  if (entry.item.kind === "lightningRod" || entry.item.kind === "stormStaff" || entry.item.kind === "breachCharge" || entry.item.kind === "ivoryTower") {
    beginItemTargeting(entry);
    return;
  }
  const command = useItemCommand(snapshot, localPlayerId, entry.item, entry.carrier);
  if (!command) {
    showInvalidCommand(t("status.itemNoTarget", { item: labelKind(entry.item.kind) }));
    return;
  }
  sendCommand(command);
  statusLabel.textContent = t("status.itemUsed", { item: labelKind(entry.item.kind) });
}

function dropCarriedItem(itemId: string, carrierId: string) {
  if (!syncBeforeCommandProjection()) return;
  if (!snapshot) return;
  const entry = carriedItemsForSelection(snapshot, inventoryCarriers()).find(({ item, carrier }) => item.id === itemId && carrier.id === carrierId);
  if (!entry) return;
  sendCommand(dropItemCommand(entry.item, entry.carrier,snapshot!.units));
  statusLabel.textContent = t("status.itemDropped", { item: labelKind(entry.item.kind) });
}

function itemIcon(kind: WorldItem["kind"]) {
  return kind === "lightningRod" ? "↯" : kind === "stormStaff" ? "☈" : kind === "flameCloak" ? "♨" : kind === "guardianScroll" ? "▤" : kind === "speedBoots" ? "»" : kind === "regenRing" ? "◯" : kind === "healingScroll" ? "✚" : kind === "ivoryTower" ? "♜" : "✦";
}

function trainIcon(kind: TrainableUnitKind) {
  return TRAIN_COMMANDS.find((command) => command.kind === kind)?.icon ?? "△";
}

function draw() {
  if(!visualsReady)return;
  if (menuOpen) {
    // The scene paints at its own pace and keeps its last picture between (see @@@menu-scenes).
    menuBackdrop.draw(ctx, canvas.clientWidth, canvas.clientHeight, performance.now(), reducedUnitMotion.matches,frame=>worldPresentation.draw(frame,'home'));
    return;
  }
  ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  if (!snapshot) {
    drawPaperMap(ctx, currentRoom?.mapId ?? LADDER_MAP_ID, camera, canvas.clientWidth, canvas.clientHeight);
    ctx.fillStyle = "#243126";
    ctx.font = "24px ui-rounded, system-ui";
    ctx.fillText(t("canvas.connecting"), 32, 48);
    return;
  }
  const viewer = matchViewer();
  const hovered = hoveredTarget();
  // Over an enemy's or the creeps', the cursor is the red one of an attack; over a friend's, it stays as it is.
  const hostile = viewer && hovered ? relationTo(snapshot, viewer, hovered.owner) : undefined;
  shell.classList.toggle("pointer-over-enemy", hostile === "enemy" || hostile === "creep");
  worldPresentation.draw({
    ctx,
    snapshot,
    view: { x: camera.x, y: camera.y, width: canvas.clientWidth, height: canvas.clientHeight, zoom:worldZoom },
    now: performance.now(),
    facing: unitFacing,
    motion: unitMotion,
    animation: unitAnimation,
    reducedMotion: reducedUnitMotion.matches,
    labels: worldLabels,
    selectedIds,
    controlGroups,
    ...(selectedCampId ? { selectedCampId } : {}),
    ...(viewer ? { viewer } : {}),
    ...(hovered ? { hoveredId: hovered.id } : {}),
  },'match');
  drawBuildPlacementPreview();
  drawPurchaseRecipientFlash();
  drawAttackMovePreview();
  drawSpellPreview();
  drawSelectionBox();
  drawMinimap(createMapPresentation(snapshot));
}

// The build mode's preview stands where the sim will lay the building (see snapToFootprint), on the cells it would take:
// green where it can go, its blocking cells red where it cannot (see @@@footprint-preview), every cell red when nothing
// on the ground is in the way (gold short, a shipyard off the shore).
const PLACEMENT_INK = { clear: "#4f9a52", blocked: "#b2483c" } as const;

function drawBuildPlacementPreview() {
  if (!commandMode || commandMode.type !== "build" || !lastMouse || !snapshot) return;
  const kind = commandMode.placement.buildingKind;
  const def = BUILDING_DEFS[kind];
  const size = buildingGlyphSize(kind)*worldZoom;
  const world = screenToWorld(lastMouse);
  const at = snapToFootprint(snapshot.map, def.radius, world);
  const point = worldToScreen(at);
  const validPlacement = "command" in buildPlacementCommand(snapshot, commandMode.placement, world, localPlayerId);
  const ink = validPlacement ? PLACEMENT_INK.clear : PLACEMENT_INK.blocked;
  const square = footprintSquare(snapshot, at, def.radius);
  if (square) {
    const blocked = validPlacement ? new Set<string>() : blockedFootprintCells(snapshot, kind, square);
    const everyCell = !validPlacement && blocked.size === 0;
    ctx.save();ctx.scale(worldZoom,worldZoom);
    drawFootprint(ctx, square, camera, (col, row) => (everyCell || blocked.has(`${col},${row}`) ? PLACEMENT_INK.blocked : PLACEMENT_INK.clear));ctx.restore();
  }
  ctx.save();
  ctx.globalAlpha = 0.62;
  drawAtlasBuilding(ctx, kind, point, size, ink);
  ctx.globalAlpha = 1;
  ctx.fillStyle = ink;
  ctx.font = "11px ui-monospace, monospace";
  ctx.fillText(t("canvas.buildPreview", { building: labelKind(kind), cost: def.cost }), point.x - 34, point.y + size / 2 + 22);
  ctx.restore();
}

function drawAttackMovePreview() {
  if (!commandMode || (commandMode.type !== "attackMove" && commandMode.type !== "aim") || !lastMouse) return;
  const point = lastMouse;
  ctx.save();
  ctx.strokeStyle = "rgba(155, 47, 47, 0.72)";
  ctx.fillStyle = "rgba(155, 47, 47, 0.08)";
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 6]);
  ctx.beginPath();
  ctx.arc(point.x, point.y, 24, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(point.x - 32, point.y);
  ctx.lineTo(point.x + 32, point.y);
  ctx.moveTo(point.x, point.y - 32);
  ctx.lineTo(point.x, point.y + 32);
  ctx.stroke();
  ctx.font = "11px ui-monospace, monospace";
  ctx.fillStyle = "#9b2f2f";
  ctx.fillText(t(commandMode.type === "aim" ? "command.aim.title" : "canvas.attackMove"), point.x - 20, point.y + 44);
  ctx.restore();
}

function drawSpellPreview() {
  if (!commandMode || commandMode.type !== "spell" || !lastMouse) return;
  const point = lastMouse;
  const ability = commandMode.targeting.ability;
  const reach = chargeWindow(ability);
  if (reach) {
    drawChargePreview(point, ability, reach, commandMode.targeting.casterId);
    return;
  }
  const behavior = ABILITY_DEFS[ability].behavior;
  const invalidHealTarget = behavior === "heal" && snapshot && !hitUnit(screenToWorld(point), unit => abilityUnitTargetMatches(snapshot!, ability, unit) && ["own", "ally"].includes(relationTo(snapshot!, localPlayerId, unit.owner)));
  const color = invalidHealTarget ? "#a85644" : behavior === "weapon" ? "#c6ae7b" : behavior === "heal" ? "#5d8b4c" : behavior === "summon" ? "#5f578f" : "#7f3a70";
  const fill = invalidHealTarget ? "rgba(168, 86, 68, 0.08)" : behavior === "weapon" ? "rgba(198,174,123,0.08)" : behavior === "heal" ? "rgba(93, 139, 76, 0.08)" : behavior === "summon" ? "rgba(95, 87, 143, 0.08)" : "rgba(127, 58, 112, 0.08)";
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = fill;
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.arc(point.x, point.y, behavior === "weapon" ? Math.min(90, (ABILITY_DEFS[ability] as Extract<typeof ABILITY_DEFS[AbilityKind],{behavior:"weapon"}>).weapon.radius ?? 20) * worldZoom : behavior === "summon" ? 28 : 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  if (behavior === "heal") {
    ctx.moveTo(point.x - 16, point.y);
    ctx.lineTo(point.x + 16, point.y);
    ctx.moveTo(point.x, point.y - 16);
    ctx.lineTo(point.x, point.y + 16);
  } else if (behavior === "summon") {
    ctx.arc(point.x, point.y, 10, 0, Math.PI * 2);
    ctx.moveTo(point.x - 23, point.y + 14);
    ctx.lineTo(point.x + 23, point.y + 14);
  } else {
    ctx.moveTo(point.x - 14, point.y - 14);
    ctx.lineTo(point.x + 14, point.y + 14);
    ctx.moveTo(point.x + 14, point.y - 14);
    ctx.lineTo(point.x - 14, point.y + 14);
  }
  ctx.stroke();
  ctx.font = "11px ui-monospace, monospace";
  ctx.fillStyle = color;
  ctx.fillText(labelKind(ability), point.x - 20, point.y + 44);
  ctx.restore();
}

// @@@charge-preview - While a charge is being aimed, every ready rider shows its window: the ring band between the
// shortest and longest charge. The rider that would take the hovered enemy (see chargeRiderFor) is drawn strong with a
// lane to it; a hovered enemy too near every rider is marked out of reach.
const CHARGE_PREVIEW_INK = { band: "rgba(212, 180, 119, 0.12)", ring: "#b9861b", reach: "#387d72", miss: "#a85644" } as const;

function drawChargePreview(point: Point, ability: AbilityKind, reach: ChargeWindow, preferredId: string) {
  const riders = readyAbilityCasters(selectedPlayerUnits(), ability, activeGameAdapter.pendingCasts?.());
  const world = screenToWorld(point);
  const target = hitUnit(world, (unit) => abilityUnitTargetMatches(snapshot!, ability, unit) && ["enemy", "creep"].includes(relationTo(snapshot!, localPlayerId, unit.owner)));
  const rider = target ? chargeRiderFor(riders, target, reach, preferredId) : undefined;
  const lead = rider ?? riders.reduce<Unit | undefined>((best, candidate) => (!best || distance(candidate, world) < distance(best, world) ? candidate : best), undefined);
  ctx.save();
  for (const candidate of riders) drawChargeWindow(worldToScreen(candidate), reach, candidate === lead);
  const ink = target ? (rider ? CHARGE_PREVIEW_INK.reach : CHARGE_PREVIEW_INK.miss) : CHARGE_PREVIEW_INK.ring;
  if (target && rider) {
    const from = worldToScreen(rider);
    const to = worldToScreen(target);
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 6]);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  const mark = target ? worldToScreen(target) : point;
  ctx.strokeStyle = ink;
  ctx.fillStyle = target ? `${ink}22` : "rgba(185, 134, 27, 0.08)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(mark.x, mark.y, target ? target.radius + 10 : 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Two chevrons pointing in: the rider's lunge.
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(mark.x + side * 30, mark.y - 9);
    ctx.lineTo(mark.x + side * 21, mark.y);
    ctx.lineTo(mark.x + side * 30, mark.y + 9);
    ctx.stroke();
  }
  if (target && !rider) {
    ctx.beginPath();
    ctx.moveTo(mark.x - 9, mark.y - 9);
    ctx.lineTo(mark.x + 9, mark.y + 9);
    ctx.moveTo(mark.x + 9, mark.y - 9);
    ctx.lineTo(mark.x - 9, mark.y + 9);
    ctx.stroke();
  }
  ctx.font = "11px ui-monospace, monospace";
  ctx.fillStyle = ink;
  ctx.fillText(labelKind(ability), point.x - 20, point.y + 44);
  ctx.restore();
}

function drawChargeWindow(center: Point, reach: ChargeWindow, lead: boolean) {
  if (!nearScreen(center, reach.range)) return;
  ctx.save();
  ctx.globalAlpha = lead ? 1 : 0.45;
  ctx.fillStyle = CHARGE_PREVIEW_INK.band;
  ctx.beginPath();
  ctx.arc(center.x, center.y, reach.range, 0, Math.PI * 2);
  ctx.arc(center.x, center.y, reach.minRange, 0, Math.PI * 2, true);
  ctx.fill();
  ctx.strokeStyle = CHARGE_PREVIEW_INK.ring;
  ctx.lineWidth = lead ? 2 : 1.5;
  ctx.beginPath();
  ctx.arc(center.x, center.y, reach.range, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.arc(center.x, center.y, reach.minRange, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  if (lead) {
    ctx.font = "10px ui-monospace, monospace";
    ctx.fillStyle = CHARGE_PREVIEW_INK.ring;
    ctx.textAlign = "center";
    ctx.fillText(String(reach.minRange), center.x, center.y - reach.minRange - 4);
    ctx.fillText(String(reach.range), center.x, center.y - reach.range - 4);
  }
  ctx.restore();
}

function drawSelectionBox() {
  if (!selectionStart || !selectionEnd) return;
  const left = Math.min(selectionStart.x, selectionEnd.x);
  const top = Math.min(selectionStart.y, selectionEnd.y);
  const width = Math.abs(selectionEnd.x - selectionStart.x);
  const height = Math.abs(selectionEnd.y - selectionStart.y);
  ctx.fillStyle = "rgba(49, 95, 135, 0.08)";
  ctx.strokeStyle = "#315f87";
  ctx.setLineDash([6, 5]);
  ctx.fillRect(left, top, width, height);
  ctx.strokeRect(left, top, width, height);
  ctx.setLineDash([]);
}

function drawMinimap(marks: MapPresentationMark[]) {
  if (!snapshot) return;
  const rect = minimapRect();
  const now = performance.now();
  windMapDisplay.setReducedMotion(reducedUnitMotion.matches);
  windMapDisplay.update(snapshot, now);
  const pointer = lastMouse && document.elementFromPoint(lastMouse.x, lastMouse.y) === canvas ? lastMouse : undefined;
  windProbe = windProbePoint(pointer, { minimap: rect, world: snapshot.map, camera,
    viewport: { width: canvas.clientWidth, height: canvas.clientHeight }, zoom: worldZoom }, windProbe);
  updateWindIndicator(rect, now);
  const relations = minimapRelationsOn();
  if (minimapRelationsButton.getAttribute("aria-pressed") !== String(relations)) minimapRelationsButton.setAttribute("aria-pressed", String(relations));
  const viewer = matchViewer();
  drawMinimapMap(ctx, snapshot, rect, marks, relations && viewer ? viewer : undefined,
    minimapWind ? () => windMapDisplay.draw(ctx, rect, now) : undefined);
  ctx.strokeStyle = "#243126";
  ctx.lineWidth = 1;
  const viewport = minimapViewportRect(rect);
  ctx.strokeRect(viewport.x, viewport.y, viewport.width, viewport.height);
}

// The player the match is seen as: none for a spectator.
function matchViewer() {
  return !spectatingRoom && snapshot?.players[localPlayerId] ? localPlayerId : undefined;
}

// The unit or building under the pointer on the battlefield, not over the interface or the minimap.
function hoveredTarget() {
  if (!lastMouse || isInsideRect(lastMouse, minimapRect()) || document.elementFromPoint(lastMouse.x, lastMouse.y) !== canvas) return undefined;
  const target = snapshot ? visualPointerTarget(screenToWorld(lastMouse)) : undefined;
  if(target?.kind === "unit")return target.unit;
  if(target?.kind === "building")return target.building;
  const world=screenToWorld(lastMouse),site=hitMercenaryCamp(world)??hitShop(world);
  return site ? {...site,owner:"neutral" as const} : undefined;
}

function minimapRelationsOn() {
  const viewer = matchViewer();
  return Boolean(snapshot && viewer && (minimapRelations ?? hasAlly(snapshot, viewer)));
}

function toggleMinimapRelations() {
  if (!matchViewer()) return;
  minimapRelations = !minimapRelationsOn();
  statusLabel.textContent = t(minimapRelations ? "status.minimapRelationsOn" : "status.minimapRelationsOff");
}

function toggleMinimapWind() {
  if (!snapshot || menuOpen) return;
  minimapWind = !minimapWind;
  minimapWindButton.setAttribute('aria-pressed', String(minimapWind));
}

function updateCamera() {
  if (menuOpen) return;
  const speed = keys.has("shift") ? 24 : 14;
  if(equipmentPanel.isOpen())return;
  if (keys.has("arrowleft") || keys.has("a")) camera.x -= speed;
  if (keys.has("arrowright") || keys.has("d")) camera.x += speed;
  if (keys.has("arrowup") || keys.has("w")) camera.y -= speed;
  if (keys.has("arrowdown") || keys.has("s")) camera.y += speed;
  const aim = edgeScrollAim();
  const edge = edgeScrollDelta(aim?.point, { width: canvas.clientWidth, height: canvas.clientHeight }, aim?.overInterface);
  camera.x += edge.x;
  camera.y += edge.y;
  clampCamera();
}

// @@@edge-scroll-ui - The window's edge scrolls the camera whatever covers it (the top bar runs along the whole top);
// over the interface only the last few pixels do (see edgeScrollDelta), so a panel near an edge can be read and used
// without the camera drifting.
function edgeScrollAim() {
  if (!lastMouse || draggingMinimapViewport || isInsideRect(lastMouse, minimapRect())) return undefined;
  return { point: lastMouse, overInterface: document.elementFromPoint(lastMouse.x, lastMouse.y) !== canvas };
}

function clampCamera() {
  if (!snapshot) return;
  camera.x = Math.max(0, Math.min(snapshot.map.width - canvas.clientWidth/worldZoom, camera.x));
  camera.y = Math.max(0, Math.min(snapshot.map.height - canvas.clientHeight/worldZoom, camera.y));
}

function resizeCanvas() {
  const density=Math.min(devicePixelRatio,2);
  canvas.width = Math.round(window.innerWidth*density);
  canvas.height = Math.round(window.innerHeight*density);
  ctx.setTransform(density,0,0,density,0,0);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  const mini = minimapRect();
  minimapFrame.style.transform = `translate(${mini.x}px, ${mini.y}px)`;
  minimapFrame.style.width = `${mini.width}px`;
  minimapFrame.style.height = `${mini.height}px`;
  // The treasury rides on the minimap's frame, just above it (see .minimap-tab).
  minimapTab.style.transform = `translate(${mini.x}px, ${mini.y}px) translateY(-100%)`;
  minimapTab.style.width = `${mini.width}px`;
  // The friend-or-foe button stands at the frame's top left, outside it (see .minimap-relations).
  minimapRelationsButton.style.transform = `translate(${mini.x}px, ${mini.y}px)`;
  minimapWindButton.style.transform = `translate(${mini.x}px, ${mini.y}px)`;
}

function mousePoint(event: MouseEvent): Point {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function inputPoint(event: MouseEvent): Point {
  if (document.pointerLockElement !== canvas) return mousePoint(event);
  const movement = event.type === "mousemove" ? { x: event.movementX, y: event.movementY } : { x: 0, y: 0 };
  virtualMouse = moveVirtualPointer(virtualMouse, movement, { width: canvas.clientWidth, height: canvas.clientHeight });
  return virtualMouse;
}

function syncVirtualPointerOverlay() {
  if (document.pointerLockElement !== canvas || !virtualMouse) {
    virtualPointerElement.classList.add("hidden");
    virtualTooltipTarget = undefined;
    return;
  }
  virtualPointerElement.classList.remove("hidden");
  virtualPointerElement.style.transform = virtualPointerTransform(virtualMouse, 18);
  syncVirtualTooltip(virtualMouse);
}

function syncVirtualTooltip(point: Point) {
  const target = virtualTooltipTargetAt(point);
  if (!target) {
    if (virtualTooltipTarget) tooltipLayer.classList.add("hidden");
    virtualTooltipTarget = undefined;
    return;
  }
  if (target !== virtualTooltipTarget || tooltipLayer.classList.contains("hidden")) {
    renderTooltip(target);
    virtualTooltipTarget = target;
  }
  positionTooltipAtPoint(point);
}

function virtualTooltipTargetAt(point: Point) {
  return virtualTooltipTargetFromElement(document.elementFromPoint(point.x, point.y)) as HTMLElement | undefined;
}

function virtualClickableTargetAt(point: Point) {
  return virtualClickableTargetFromElement(document.elementFromPoint(point.x, point.y)) as HTMLElement | undefined;
}

// A button under the pointer-lock cursor, disabled or not: a right-click on it is the button's, never a battlefield order.
function virtualContextTargetAt(point: Point) {
  return virtualContextTargetFromElement(document.elementFromPoint(point.x, point.y)) as HTMLElement | undefined;
}

function openVirtualContextMenu(target: HTMLElement) {
  const command = commandButtons.find((button) => button.element === target);
  if (command) {
    command.contextAction?.();
    return;
  }
  target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
}

function screenToWorld(point: Point): Point {
  return { x: point.x / worldZoom + camera.x, y: point.y / worldZoom + camera.y };
}

function worldToScreen(point: Point): Point {
  return { x: (point.x - camera.x)*worldZoom, y: (point.y - camera.y)*worldZoom };
}

function nearScreen(point: Point, pad: number) {
  return point.x >= -pad && point.y >= -pad && point.x <= canvas.clientWidth + pad && point.y <= canvas.clientHeight + pad;
}

// The minimap keeps clear of the window's edge by its frame's width (see .minimap-frame).
function minimapRect(): ScreenRect {
  const size = Math.min(184, Math.max(132, Math.floor(Math.min(canvas.clientWidth, canvas.clientHeight) * 0.2)));
  return { x: canvas.clientWidth - size - 16, y: canvas.clientHeight - size - 16, width: size, height: size };
}

function minimapViewportRect(rect = minimapRect()): ScreenRect {
  if (!snapshot) return { x: rect.x, y: rect.y, width: 0, height: 0 };
  return minimapViewportRectFor(rect, camera, { width: canvas.clientWidth/worldZoom, height: canvas.clientHeight/worldZoom }, snapshot.map);
}

function centerCameraFromMinimap(point: Point) {
  if (!snapshot) return;
  const rect = minimapRect();
  const world = minimapPointToWorld(point, rect, snapshot.map);
  centerCameraOnWorld(world);
}

function centerCameraOnControlGroup(ids: string[]) {
  if (!snapshot) return;
  const center = controlGroupCenter(ids, [...snapshot.units, ...snapshot.buildings]);
  if (center) centerCameraOnWorld(center);
}

function centerCameraOnWorld(world: Point) {
  if (!snapshot) return;
  camera.x = world.x - canvas.clientWidth / (2*worldZoom);
  camera.y = world.y - canvas.clientHeight / (2*worldZoom);
  clampCamera();
}

function hitShop(world: Point) {
  const hit=visualHit(world);if(hit)return snapshot?.shops?.find(shop=>shop.id===hit.id);
  return snapshot?.shops?.find((shop) => distance(shop, world) < shop.radius + 16);
}

function hitMercenaryCamp(world: Point) {
  const hit=visualHit(world);if(hit)return snapshot?.mercenaryCamps.find(camp=>camp.id===hit.id);
  return snapshot?.mercenaryCamps.find((camp) => distance(camp, world) < camp.radius + 16);
}

function hitUnit(world: Point, predicate: (unit: Unit) => boolean) {
  const hit=visualHit(world);if(hit)return snapshot?.units.find(unit=>unit.id===hit.id && !isInCabin(unit) && predicate(unit));
  return unitAt(snapshot?.units ?? [], world, predicate);
}

function hitBuilding(world: Point, predicate: (building: Building) => boolean) {
  const hit=visualHit(world);if(hit)return snapshot?.buildings.find(building=>building.id===hit.id && predicate(building));
  return buildingAt(snapshot?.buildings ?? [], world, predicate);
}

function visualHit(world:Point){const point=worldToScreen(world);return point.x<0||point.y<0||point.x>canvas.clientWidth||point.y>canvas.clientHeight?undefined:worldPresentation.pick(point);}
function visualPointerTarget(world:Point):PointerTarget|undefined{
  if(!snapshot)return undefined;const hit=visualHit(world);
  if(hit){const unit=snapshot.units.find(unit=>unit.id===hit.id && !isInCabin(unit));if(unit)return{kind:'unit',unit};const building=snapshot.buildings.find(building=>building.id===hit.id);if(building)return{kind:'building',building};}
  return pointerTarget(snapshot,world);
}

function labelBuilding(building: Building) {
  return labelKind(building.kind);
}

function labelKind(kind: BuildingKind | TrainableUnitKind | AbilityKind | UpgradeKind | WorldItem["kind"] | string) {
  return tl(kind as LabelKey);
}

function labelAnyKind(kind: string) {
  return tl(kind as LabelKey);
}

function romanLevel(level: number) {
  return level === 1 ? "I" : level === 2 ? "II" : level === 3 ? "III" : String(level);
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function initialMenuScene() {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(MENU_SCENE_STORAGE_KEY);
  } catch {
    // Storage blocked: a scene at random.
  }
  const index = MENU_SCENES.findIndex((scene) => scene.id === stored);
  return index >= 0 ? index : Math.floor(Math.random() * MENU_SCENES.length);
}

function labelSceneSwitch() {
  const name = menuBackdrop.scene.name[i18n.locale];
  sceneSwitch.innerHTML = `<span class="scene-switch-mark" aria-hidden="true">⟳</span>${escapeHtml(name)}`;
  sceneSwitch.setAttribute("aria-label", t("home.switchScene", { name }));
}

function loadLocalUserProfile(): LocalUserProfile {
  const stored = window.localStorage.getItem("sketch-rts-user");
  if (stored) {
    const parsed = JSON.parse(stored) as Partial<LocalUserProfile>;
    if (typeof parsed.id === "string" && typeof parsed.name === "string" && parsed.id && parsed.name) return { id: parsed.id, name: parsed.name };
  }
  const profile = { id: newUserId(), name: `Player ${Math.floor(1000 + Math.random() * 9000)}` };
  saveLocalUserProfile(profile);
  return profile;
}

function saveLocalUserProfile(profile: LocalUserProfile) {
  window.localStorage.setItem("sketch-rts-user", JSON.stringify(profile));
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element ${selector}`);
  return element;
}

function requireCanvasContext(target: HTMLCanvasElement) {
  const context = target.getContext("2d");
  if (!context) throw new Error("Canvas 2D context is unavailable");
  return context;
}
