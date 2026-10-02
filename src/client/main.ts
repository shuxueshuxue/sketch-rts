import "./styles.css";
import { drawAtlasBuilding, drawAtlasUnit } from "./atlas-art";
import { buildPlacementCommand, type BuildPlacement } from "./build-placement-controls";
import { chatKeyIntent, normalizeChatText } from "./chat-controller";
import { chargeRiderFor, chargeWindow, readyChargers, type ChargeWindow } from "./charge-targeting";
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
import { buildSelectionGroups, cycleFocusedSelectionId, focusedSelectionEntities, resolveFocusedSelectionId, type SelectionGroup } from "./hud-model";
import { createBrowserI18n, type LabelKey } from "./i18n";
import { carriedItemsForSelection, dropItemCommand, itemHotkeys, pickupItemCommand, useItemCommand } from "./item-controls";
import { gameplayKeyIntent } from "./keybindings";
import { isInsideRect, minimapPointToWorld, minimapViewportRectFor, shouldDragMinimap } from "./minimap";
import { drawMapPreview, mapPreview, type PreviewSeat } from "./map-preview";
import { drawMinimapMap } from "./minimap-art";
import { MENU_SCENES, MenuBackdrop } from "./menu-scenes";
import { NO_SOUND_PACK, Soundboard } from "./sound";
import { soundCues, type SoundCue } from "./sound-cues";
import { SOUND_PACKS } from "./sound-packs";
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
import { formatRoomRouteHash, parseRoomRouteHash, type RoomRoute } from "./room-route";
import { roomBrowserEntries } from "./room-browser-model";
import { roomSetupViewAction } from "./room-view-state";
import { UnitFacingTracker } from "./unit-facing";
import { UnitMotionSmoother } from "./unit-motion";
import { abilityTooltip, buildingTooltip, formatTooltipDataset, itemTooltip, unitSelectionTooltip, unitTooltip, upgradeTooltip, type GameplayTooltip } from "./tooltips";
import { trainingProgressButtonsForSelection, type TrainingProgressButton } from "./training-queue";
import { newUserId } from "./user-profile";
import { applySelectionPick, selectInScreenBox, selectNearbySameKindUnits, type ScreenRect as SelectionScreenRect } from "./selection-controls";
import { buildingGlyphSize, drawPaperMap, drawWorld, worldLabelsFor } from "./world-renderer";
import { virtualClickableTargetFromElement, virtualContextTargetFromElement, virtualTooltipTargetFromElement } from "./virtual-ui";
import { abilityCooldown } from "../shared/ability-cooldowns";
import { canAutocast } from "../shared/autocast";
import { ABILITY_DEFS, ABILITY_KINDS, BUILDABLE_BUILDING_KINDS, BUILDING_DEFS, RACE_DEFS, RACE_IDS, TRAINABLE_UNIT_KINDS, UNIT_DEFS } from "../shared/catalog";
import { SHOP_GOODS, standsAtShop } from "../shared/shop";
import { ABILITY_CARDS } from "./content/abilities";
import { BUILDING_CARDS } from "./content/buildings";
import { TRAINED_UNIT_CARDS } from "./content/units";
import { LADDER_MAP_ID } from "../shared/map-ids";
import { MAP_POOL, poolMap, poolSeatsFit, type PoolMapId } from "../shared/map-pool";
import { createMapPresentation, type MapPresentationMark } from "../shared/presentation";
import { canStartRoom, createRoom, DEFAULT_INTERNAL_AI_VERSION, ROOM_AI_VERSIONS, type SlotPatch } from "../shared/rooms";
import type { AbilityKind, Building, BuildingKind, GameCommand, GameSnapshot, LocalUserProfile, MeleeStance, PlayerId, RoomState, TrainableUnitKind, Unit, UpgradeKind, WorldItem } from "../shared/types";
import type { MapId } from "../shared/types";

type Point = { x: number; y: number };
type CommandPortrait = { type: "unit"; kind: Unit["kind"] } | { type: "building"; kind: BuildingKind };
type ScreenRect = { x: number; y: number; width: number; height: number };
type SpellTargeting = { casterId: string; ability: AbilityKind };
type ItemTargeting = { unitId: string; itemId: string; kind: WorldItem["kind"] };
type CommandMode = { type: "attackMove" } | { type: "unload" } | { type: "build"; placement: BuildPlacement } | { type: "spell"; targeting: SpellTargeting } | { type: "item"; targeting: ItemTargeting };
type MenuView = "home" | "profile" | "rooms" | "create" | "setup" | "results";

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
};

// The command card's build and train buttons come from the building and unit cards, in catalog order.
const BUILD_COMMANDS = BUILDABLE_BUILDING_KINDS.map((kind) => ({ kind, ...BUILDING_CARDS[kind].command }));

const TRAIN_COMMANDS = TRAINABLE_UNIT_KINDS.map((kind) => ({ kind, ...TRAINED_UNIT_CARDS[kind].command }));

const SPELL_COMMANDS = ABILITY_KINDS.map((ability) => ({ ability, ...ABILITY_CARDS[ability].command }));
const HIRE_COMMAND = { icon: "⚔", hotkey: "m" } as const;
// A shop's goods, in SHOP_GOODS order: a shop selected shows no other button.
const SHOP_HOTKEYS = ["q", "w", "e", "r", "t"];
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
const menuTitle = requireElement<HTMLHeadingElement>("[data-menu-title]");
const menuStatus = requireElement<HTMLDivElement>("[data-menu-status]");
const mapList = requireElement<HTMLDivElement>("[data-map-list]");
const goldLabel = requireElement<HTMLSpanElement>("[data-gold]");
const supplyLabel = requireElement<HTMLSpanElement>("[data-supply]");
const statusLabel = requireElement<HTMLDivElement>("[data-status]");
const chatMessages = requireElement<HTMLDivElement>("[data-chat-messages]");
const chatForm = requireElement<HTMLFormElement>("[data-chat-form]");
const chatInput = requireElement<HTMLInputElement>("[data-chat-input]");
const selectionLabel = requireElement<HTMLDivElement>("[data-selection]");
const mapReadout = requireElement<HTMLDivElement>("[data-map-readout]");
const forfeitButton = requireElement<HTMLButtonElement>("[data-forfeit-match]");
const commandDock = requireElement<HTMLDivElement>("[data-command-dock]");
const itemDock = requireElement<HTMLDivElement>("[data-item-dock]");
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
const matchMenu = requireElement<HTMLDivElement>("[data-match-menu]");
const matchMenuClose = requireElement<HTMLButtonElement>("[data-match-menu-close]");
const ctx = requireCanvasContext(canvas);
// The home screen's scene (see @@@menu-scenes): the one the player last picked, or one drawn at random for this visit.
const MENU_SCENE_STORAGE_KEY = "sketch-rts-menu-scene";
const menuBackdrop = new MenuBackdrop(worldLabels, initialMenuScene());
// The game's sounds (see @@@sound): the packs found with the game (see @@@sound-packs); until the player chooses one, the
// one a server names in VITE_SOUND_PACK, else none.
const soundboard = new Soundboard(SOUND_PACKS, import.meta.env.VITE_SOUND_PACK);

let snapshot: GameSnapshot | undefined;
let currentRoom: RoomState | undefined;
let currentRoomId: string | undefined;
let localPlayerId: PlayerId = "player";
let spectatingRoom = false;
let activeGameAdapter: GameAdapter;
let activeChat: MatchChat | undefined;
let activeChatUnsubscribe: (() => void) | undefined;
let activeRoomUnwatch: (() => void) | undefined;
let activeRoomWatchId: string | undefined;
let localUser = loadLocalUserProfile();
let selectedIds = new Set<string>();
const unitFacing = new UnitFacingTracker();
const unitMotion = new UnitMotionSmoother();
let focusedSelectionId: string | undefined;
let selectedCampId: string | undefined;
const controlGroups: ControlGroups = {};
let lastControlGroupRecall: ControlGroupRecallTap | undefined;
let camera = { x: 560, y: 560 };
let virtualMouse: Point | undefined;
let virtualTooltipTarget: HTMLElement | undefined;
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
let commandMode: CommandMode | undefined;
// The sub-card open in place of the command card: the worker's buildings, or the melee stances (see stance-buttons).
let openPalette: "build" | "stance" | undefined;
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
    createCommandButton(t("command.buildSpecific", { building: labelKind(command.kind) }), command.icon, command.hotkey, () => booleanCommandState(canBuild(command.kind)), () => beginBuildPlacement(command.kind), () => buildingTooltip(command.kind, command.hotkey, i18n), { type: "building", kind: command.kind }),
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
  ...SHOP_GOODS.map((good, index) =>
    createCommandButton(t("command.buy.title", { item: labelKind(good.kind) }), itemIcon(good.kind), SHOP_HOTKEYS[index]!, () => shopGoodButtonState(good.kind), () => buyGood(good.kind), () => {
      const tooltip = itemTooltip(good.kind, SHOP_HOTKEYS[index], i18n);
      return {
        ...tooltip,
        title: t("command.buy.title", { item: tooltip.title }),
        stats: [t("command.buy.cost", { cost: good.cost }), t("command.buy.stock", { stock: good.maxStock, seconds: good.restock / 20 }), ...tooltip.stats],
        requirements: [t("command.buy.requirements")],
      };
    }),
  ),
  createCommandButton(t("command.hire.title"), HIRE_COMMAND.icon, HIRE_COMMAND.hotkey, hireMercenaryButtonState, hireMercenary, () => ({
    title: t("command.hire.title"),
    body: t("command.hire.body"),
    stats: [t("command.hire.stock"), t("command.hire.instant")],
    requirements: [t("command.hire.requirements")],
    hotkey: HIRE_COMMAND.hotkey.toUpperCase(),
  })),
];

window.addEventListener("resize", resizeCanvas);
window.addEventListener("hashchange", () => void openRouteFromHash());
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
});
labelSceneSwitch();
// The match's menu (≡ in the top right): the map being played, concede, and back to the game.
matchMenuButton.addEventListener("click", () => matchMenu.classList.toggle("hidden"));
matchMenuClose.addEventListener("click", () => matchMenu.classList.add("hidden"));
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
void openRouteFromHash();
resizeCanvas();
requestAnimationFrame(frame);

function createCommandButton(label: string, icon: string, hotkey: string, state: () => CommandButtonState, run: () => void, tooltip: () => GameplayTooltip, portrait?: CommandPortrait, contextAction?: () => void): CommandButton {
  const element = document.createElement("button");
  element.className = "command-button";
  element.type = "button";
  element.dataset.commandLabel = label;
  element.dataset.hotkey = hotkey.toUpperCase();
  element.setAttribute("aria-label", `${label} (${hotkey.toUpperCase()})`);
  applyTooltip(element, tooltip());
  element.innerHTML = `<span class="command-icon">${escapeHtml(icon)}</span><span class="hotkey">${hotkey.toUpperCase()}</span>`;
  if (portrait) drawCommandPortrait(element, portrait);
  element.addEventListener("click", run);
  // A right-click on the command card never reaches the battlefield or opens the browser menu; a spell switches autocast.
  element.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    contextAction?.();
  });
  commandDock.append(element);
  return { element, hotkey, tooltip, state, run, ...(contextAction ? { contextAction } : {}) };
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
  const icon = document.createElement("canvas");
  icon.width = icon.height = 68;
  icon.className = "command-portrait";
  icon.setAttribute("aria-hidden", "true");
  const brush = requireCanvasContext(icon);
  const center = { x: 34, y: 39 };
  if (portrait.type === "unit") drawAtlasUnit(brush, portrait.kind, center, 1.13, "#467d6c");
  else drawAtlasBuilding(brush, portrait.kind, center, 56, "#467d6c");
  element.querySelector(".command-icon")?.replaceChildren(icon);
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
  const reason = commandButtonStateRequirement(state);
  if (!reason) return tooltip;
  return { ...tooltip, requirements: [reason, ...tooltip.requirements] };
}

function commandButtonStateLabel(state: CommandButtonState) {
  if (state.cooldownTicks !== undefined) return t("hud.commandCooldownShort", { ticks: state.cooldownTicks });
  if (state.reason === "stock") return t("hud.commandNoStockShort");
  if (state.reason === "gold") return t("hud.commandNoGoldShort");
  if (state.reason === "supply") return t("hud.commandNoSupplyShort");
  if (state.reason === "tier") return t("hud.commandTierShort", { cap: state.supplyCap ?? 0 });
  if (state.reason === "position") return t("hud.commandNeedUnitShort");
  return undefined;
}

function commandButtonStateRequirement(state: CommandButtonState) {
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

function openMenuRoute(route: Exclude<RoomRoute, { screen: "room" }>) {
  clearRoomWatch();
  currentRoom = undefined;
  currentRoomId = undefined;
  spectatingRoom = false;
  menuView = route.screen;
  replaceRoomRouteHash(route);
  renderMainMenu();
}

async function openRouteFromHash() {
  const route = parseRoomRouteHash(window.location.hash);
  if (route.screen === "room") {
    await enterRoom(route.roomId);
    return;
  }
  if (!menuOpen) return;
  openMenuRoute(route);
}

function openRoomSetup(room: RoomState) {
  currentRoom = room;
  currentRoomId = undefined;
  menuView = "setup";
  replaceRoomRouteHash({ screen: "room", roomId: room.id });
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

function replaceRoomRouteHash(route: RoomRoute) {
  const hash = formatRoomRouteHash(route);
  if (window.location.hash === hash) return;
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${hash}`);
}

function renderMainMenu() {
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
      openMenuRoute({ screen: "create" });
    }),
    menuButton(t("home.rooms.label"), "", "data-open-room-browser", () => {
      openMenuRoute({ screen: "rooms" });
    }),
    menuButton(t("home.settings"), "", "data-open-profile", () => {
      openMenuRoute({ screen: "profile" });
    }),
  );
}

// The create screen (see @@@map-chooser).
function renderCreateGameMenu() {
  menuStatus.textContent = "";
  const form = document.createElement("form");
  form.className = "create-game-form";
  form.dataset.createGameForm = "true";
  form.innerHTML = `
    <div class="map-chooser">
      <section class="map-browser" aria-label="${escapeHtml(t("roomCreate.map.label"))}">
        <div class="room-section-title">${escapeHtml(t("roomCreate.map.label"))}</div>
        <div class="map-entries" data-map-entries></div>
      </section>
      ${mapDetailMarkup()}
    </div>
    <div class="create-options">
      <label class="create-name">${escapeHtml(t("roomCreate.name.label"))}<input name="name" value="${escapeHtml(t("roomCreate.defaultName", { name: localUser.name }))}" /></label>
      <label class="checkbox-row"><input name="privateRoom" type="checkbox" checked /> ${escapeHtml(t("roomCreate.private.label"))}</label>
    </div>
    <div class="menu-actions">
      <button type="submit" data-submit-create-game>${escapeHtml(t("roomCreate.submit"))}</button>
      <button type="button" data-back-home>${escapeHtml(t("common.back"))}</button>
    </div>
  `;
  const entries = form.querySelector<HTMLDivElement>("[data-map-entries]")!;
  const renderMaps = () => {
    entries.replaceChildren(
      ...MAP_POOL.map((map) => {
        const entry = document.createElement("button");
        entry.type = "button";
        entry.className = `map-entry ${map.id === chosenMapId ? "selected" : ""}`;
        entry.dataset.mapId = map.id;
        entry.textContent = mapEntryLabel(map.id);
        entry.addEventListener("click", () => {
          chosenMapId = map.id;
          renderMaps();
        });
        return entry;
      }),
    );
    showMapDetail(form, chosenMapId, roomPreviewSeats(createRoom({ id: "preview", host: localUser, mapId: chosenMapId, ...poolSeatCounts(chosenMapId) })));
  };
  renderMaps();
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim() || t("roomCreate.defaultName", { name: localUser.name });
    void createConfiguredRoom({ name, mapId: chosenMapId, ...poolSeatCounts(chosenMapId), visibility: data.get("privateRoom") === "on" ? "private" : "public" });
  });
  form.querySelector("[data-back-home]")?.addEventListener("click", () => {
    openMenuRoute({ screen: "home" });
  });
  mapList.replaceChildren(form);
}

// A new room on a map: its host and a computer in every other seat; the host opens seats to players in the lobby.
function poolSeatCounts(mapId: MapId) {
  return { humanCount: 1, aiCount: (poolMap(mapId)?.players ?? 2) - 1 };
}

function mapDetailMarkup() {
  return `
    <section class="map-detail">
      <div class="map-preview-frame"><canvas class="map-preview" data-map-preview width="512" height="512"></canvas></div>
      <div class="map-info">
        <div class="map-info-name" data-map-name></div>
        <dl class="map-facts" data-map-facts></dl>
      </div>
    </section>`;
}

function showMapDetail(root: ParentNode, mapId: MapId, seats: PreviewSeat[]) {
  const preview = mapPreview(mapId, seats);
  drawMapPreview(root.querySelector<HTMLCanvasElement>("[data-map-preview]")!, preview);
  const { facts } = preview;
  const layout = poolMap(mapId)?.layout;
  root.querySelector("[data-map-name]")!.textContent = mapName(mapId);
  root.querySelector("[data-map-facts]")!.innerHTML = [
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
  return room.slots.filter((slot) => slot.controller !== "closed").map((slot) => ({ playerId: slot.playerId, team: slot.team }));
}

function renderProfileMenu() {
  menuStatus.textContent = "";
  const form = document.createElement("form");
  form.className = "profile-form";
  form.dataset.profileForm = "true";
  form.innerHTML = `
    <label>${escapeHtml(t("profile.displayName"))}<input name="name" value="${escapeHtml(localUser.name)}" /></label>
    <div class="profile-id">${escapeHtml(t("profile.userId", { id: localUser.id }))}</div>
    <fieldset class="sound-settings" data-sound-settings>
      <legend>${escapeHtml(t("settings.sound"))}</legend>
      <label>${escapeHtml(t("settings.soundPack"))}<select data-sound-pack>${[{ id: NO_SOUND_PACK, name: t("settings.soundPackNone") }, ...soundboard.packs]
        .map((pack) => `<option value="${escapeHtml(pack.id)}" ${pack.id === (soundboard.pack?.id ?? NO_SOUND_PACK) ? "selected" : ""}>${escapeHtml(pack.name)}</option>`)
        .join("")}</select></label>
      <label>${escapeHtml(t("settings.effects"))}<input type="range" min="0" max="100" data-volume="effects" value="${Math.round(soundboard.settings.effects * 100)}" /></label>
      <label>${escapeHtml(t("settings.interface"))}<input type="range" min="0" max="100" data-volume="ui" value="${Math.round(soundboard.settings.ui * 100)}" /></label>
      <label class="checkbox-row"><input type="checkbox" data-mute ${soundboard.settings.muted ? "checked" : ""} /> ${escapeHtml(t("settings.mute"))}</label>
    </fieldset>
    <div class="menu-actions">
      <button type="submit">${escapeHtml(t("common.save"))}</button>
      <button type="button" data-regenerate-user>${escapeHtml(t("profile.regenerate"))}</button>
      <button type="button" data-back-home>${escapeHtml(t("common.back"))}</button>
    </div>
  `;
  // A volume takes effect as it moves, with a sound of its group to hear it by.
  form.querySelectorAll<HTMLInputElement>("[data-volume]").forEach((input) => {
    input.addEventListener("input", () => {
      const group = input.dataset.volume === "ui" ? "ui" : "effects";
      soundboard.update({ [group]: Number(input.value) / 100 });
      soundboard.play(group === "ui" ? "click" : "melee");
    });
  });
  form.querySelector<HTMLSelectElement>("[data-sound-pack]")?.addEventListener("change", (event) => {
    soundboard.update({ pack: (event.currentTarget as HTMLSelectElement).value });
  });
  form.querySelector<HTMLInputElement>("[data-mute]")?.addEventListener("change", (event) => {
    soundboard.update({ muted: (event.currentTarget as HTMLInputElement).checked });
  });
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

async function renderRoomBrowser() {
  menuStatus.textContent = "";
  const rooms = await deploymentRuntime.listRooms(localUser.id);
  const browser = document.createElement("div");
  browser.className = "room-browser";
  browser.dataset.roomBrowser = "true";
  browser.innerHTML = `
    <div class="room-browser-actions"></div>
    <div class="room-browser-list" data-room-browser-list></div>
  `;
  const actions = browser.querySelector<HTMLDivElement>(".room-browser-actions")!;
  actions.replaceChildren(
    menuButton(t("roomBrowser.create.title"), "", "data-create-room", () => {
      openMenuRoute({ screen: "create" });
    }),
    menuButton(t("common.back"), "", "data-back-home", () => {
      openMenuRoute({ screen: "home" });
    }),
  );
  const list = browser.querySelector<HTMLDivElement>("[data-room-browser-list]")!;
  const visibleRooms = roomBrowserEntries(rooms, localUser.id);
  list.replaceChildren(
    ...(visibleRooms.length > 0
      ? visibleRooms.map((entry) =>
          menuButton(entry.room.name, roomBrowserNote(entry.room, entry.action), "data-room-id", () => void enterRoom(entry.room.id), entry.room.id),
        )
      : [emptyRoomList()]),
  );
  mapList.replaceChildren(browser);
}

function renderRoomSetup() {
  const setupAction = roomSetupViewAction(currentRoom);
  if (setupAction === "empty") {
    menuStatus.textContent = t("roomSetup.empty");
    mapList.replaceChildren(menuButton(t("roomBrowser.create.title"), "", "data-create-room", () => {
      openMenuRoute({ screen: "create" });
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
  setup.className = "room-setup";
  setup.dataset.roomSetup = room.id;
  setup.innerHTML = `
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
        <div class="slot-list"></div>
      </section>
      <section class="room-map-pane" aria-label="${escapeHtml(t("roomSetup.maps"))}">
        <div class="room-section-title">${escapeHtml(t("roomSetup.maps"))}</div>
        ${mapDetailMarkup()}
      </section>
    </div>
    <div class="menu-actions">
      <button type="button" data-start-room>${escapeHtml(t("roomSetup.start"))}</button>
      <button type="button" data-back-room-browser>${escapeHtml(t("roomSetup.backRooms"))}</button>
    </div>
  `;
  const startButton = setup.querySelector<HTMLButtonElement>("[data-start-room]")!;
  startButton.disabled = !canStartRoom(room);
  startButton.title = startButton.disabled ? t("roomSetup.startDisabled") : t("roomSetup.startTitle");
  // Teams that split a sides map unevenly cannot start on it; meanwhile it shows with the seats a new room gets.
  const seats = roomPreviewSeats(room);
  const pool = poolMap(room.mapId);
  showMapDetail(setup, room.mapId, !pool || poolSeatsFit(pool, seats.map((seat) => seat.team)) ? seats : roomPreviewSeats(createRoom({ id: "preview", host: localUser, mapId: room.mapId, ...poolSeatCounts(room.mapId) })));
  const slotList = setup.querySelector<HTMLDivElement>(".slot-list")!;
  slotList.replaceChildren(...room.slots.map(slotRow));
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
  const rows = result.slots.map((slot) => {
    const kills = result.stats.unitsKilled[slot.playerId] ?? 0;
    const losses = result.stats.unitsLost[slot.playerId] ?? 0;
    const spent = result.stats.goldSpent[slot.playerId] ?? 0;
    const buildings = result.stats.buildingsDestroyed[slot.playerId] ?? 0;
    return `
      <div class="result-row" data-result-slot="${escapeHtml(slot.playerId)}">
        <span>${escapeHtml(slot.name)}</span>
        <span>${escapeHtml(labelKind(slot.controller))}</span>
        <span>${escapeHtml(labelKind(slot.team))}</span>
        <span>${escapeHtml(labelKind(slot.race))}</span>
        <span>${kills}/${losses}</span>
        <span>${spent}</span>
        <span>${buildings}</span>
      </div>
    `;
  });
  const panel = document.createElement("div");
  panel.className = "results-panel";
  panel.dataset.resultsScreen = currentRoom.id;
  panel.innerHTML = `
    <div class="result-winner" data-result-winner>${escapeHtml(t("results.winner", { winner: result.winner ?? t("results.draw") }))}</div>
    <div class="result-head">
      <span>${escapeHtml(t("results.player"))}</span><span>${escapeHtml(t("results.controller"))}</span><span>${escapeHtml(t("results.team"))}</span><span>${escapeHtml(t("results.race"))}</span><span>${escapeHtml(t("results.killsLosses"))}</span><span>${escapeHtml(t("results.gold"))}</span><span>${escapeHtml(t("results.buildings"))}</span>
    </div>
    <div class="result-list">${rows.join("")}</div>
    <div class="menu-actions">
      <button type="button" data-rematch>${escapeHtml(t("results.rematch"))}</button>
      <button type="button" data-return-home>${escapeHtml(t("common.home"))}</button>
    </div>
  `;
  const completedRoom = currentRoom;
  panel.querySelector("[data-rematch]")?.addEventListener("click", () => void createReplayRoom(completedRoom));
  panel.querySelector("[data-return-home]")?.addEventListener("click", returnHome);
  mapList.replaceChildren(panel);
}

async function createConfiguredRoom(input: { name: string; mapId: MapId; humanCount: number; aiCount: number; visibility: "private" | "public" }) {
  currentRoom = await deploymentRuntime.createRoom({
    id: `room-${Date.now().toString(36)}`,
    host: localUser,
    ...input,
  });
  localPlayerId = slotForUser(currentRoom, localUser.id)?.playerId ?? "player";
  openRoomSetup(currentRoom);
  renderMainMenu();
}

async function startCurrentRoom() {
  if (!currentRoom) return;
  clearRoomWatch();
  if (hasSeenPointerLockGuide()) {
    const point = lastMouse ?? { x: canvas.width / 2, y: canvas.height / 2 };
    await requestPointerLock(point, { fieldClickOnError: true });
  }
  const started = await deploymentRuntime.startRoom(currentRoom.id, localUser, handleRuntimeRoomUpdate);
  currentRoom = started.room;
  currentRoomId = started.room.id;
  localPlayerId = started.playerId;
  activateStartedMatch(started.adapter, started.snapshot, started.chat);
  syncDebugView();
  camera = { x: 0, y: 0 };
  selectedIds = new Set();
  focusedSelectionId = undefined;
  selectedCampId = undefined;
  menuOpen = false;
  shell.classList.remove("menu-open");
  mainMenu.classList.add("hidden");
  syncMatchActions();
  syncPointerLockGate();
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

function slotRow(slot: RoomState["slots"][number], index: number) {
  const row = document.createElement("div");
  row.className = "slot-row";
  row.dataset.slotId = slot.id;
  // A seat is a computer's or open to a player; a pool map plays with every seat taken (see @@@map-pool).
  const controllerOptions = ["ai", "open"]
    .map((controller) => `<option value="${controller}" ${slot.controller === controller ? "selected" : ""}>${escapeHtml(labelKind(controller))}</option>`)
    .join("");
  const aiOptions = ROOM_AI_VERSIONS.map((version) => `<option value="${version}" ${(slot.aiVersion ?? DEFAULT_INTERNAL_AI_VERSION) === version ? "selected" : ""}>${version.toUpperCase()}</option>`).join("");
  const raceOptions = RACE_IDS.map((race) => `<option value="${race}" ${slot.race === race ? "selected" : ""}>${escapeHtml(labelKind(race))}</option>`).join("");
  row.innerHTML = `
    <span class="slot-index">${index + 1}</span>
    <span class="slot-name">${escapeHtml(slot.name)}</span>
    ${
      slot.controller === "human"
        ? `<span class="slot-controller-badge" data-slot-controller-status>${escapeHtml(labelKind("human"))}</span>`
        : `<select data-slot-controller aria-label="${escapeHtml(t("roomSetup.slotController"))}">${controllerOptions}</select>`
    }
    <select data-slot-team aria-label="${escapeHtml(t("roomSetup.slotTeam"))}">
      ${["north", "south", "east", "west"].map((team) => `<option value="${team}" ${slot.team === team ? "selected" : ""}>${escapeHtml(labelKind(team))}</option>`).join("")}
    </select>
    <select data-slot-race aria-label="${escapeHtml(t("roomSetup.slotRace"))}">${raceOptions}</select>
    ${slot.controller === "ai" ? `<select data-slot-ai aria-label="${escapeHtml(t("roomSetup.slotAi"))}">${aiOptions}</select>` : ""}
    <label class="slot-ready"><input data-slot-ready type="checkbox" ${slot.ready ? "checked" : ""} ${slot.controller !== "human" ? "disabled" : ""} /> ${escapeHtml(t("roomSetup.slotReady"))}</label>
  `;
  row.querySelector<HTMLSelectElement>("[data-slot-controller]")?.addEventListener("change", (event) => {
    const controller = (event.currentTarget as HTMLSelectElement).value;
    void updateCurrentRoomSlot(slot.id, { controller });
  });
  row.querySelector<HTMLSelectElement>("[data-slot-team]")?.addEventListener("change", (event) => {
    void updateCurrentRoomSlot(slot.id, { team: (event.currentTarget as HTMLSelectElement).value });
  });
  row.querySelector<HTMLSelectElement>("[data-slot-race]")?.addEventListener("change", (event) => {
    void updateCurrentRoomSlot(slot.id, { race: (event.currentTarget as HTMLSelectElement).value });
  });
  row.querySelector<HTMLSelectElement>("[data-slot-ai]")?.addEventListener("change", (event) => {
    void updateCurrentRoomSlot(slot.id, { aiVersion: (event.currentTarget as HTMLSelectElement).value });
  });
  row.querySelector<HTMLInputElement>("[data-slot-ready]")?.addEventListener("change", (event) => {
    void updateCurrentRoomSlot(slot.id, { ready: (event.currentTarget as HTMLInputElement).checked });
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
  replaceRoomRouteHash({ screen: "rooms" });
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

function emptyRoomList() {
  const empty = document.createElement("div");
  empty.className = "empty-room-list";
  empty.textContent = t("roomBrowser.noVisible");
  return empty;
}

function slotForUser(room: RoomState, userId: string) {
  return room.slots.find((slot) => slot.userId === userId);
}

function returnHome() {
  clearRoomWatch();
  disconnectActiveMatch();
  currentRoom = undefined;
  currentRoomId = undefined;
  spectatingRoom = false;
  syncDebugView();
  syncMatchActions();
  selectedIds = new Set();
  focusedSelectionId = undefined;
  selectedCampId = undefined;
  commandMode = undefined;
  openPalette = undefined;
  menuView = "home";
  replaceRoomRouteHash({ screen: "home" });
  renderMainMenu();
}

async function enterRoom(roomId: string) {
  try {
    const entered = await deploymentRuntime.enterRoom(roomId, localUser);
    const room = entered.room;
    currentRoom = room;
    spectatingRoom = entered.spectating;
    localPlayerId = entered.playerId;
    if (room.status === "ended" && room.result) {
      openResults(room);
      return;
    }
    if (room.status === "inMatch") {
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
    menuStatus.innerHTML = `<span class="error">${escapeHtml(t("status.enterRoomFailed", { message: error instanceof Error ? error.message : String(error) }))}</span>`;
    renderMainMenu();
  }
}

function activateStartedMatch(adapter: GameAdapter, nextSnapshot: GameSnapshot, chat: MatchChat) {
  disconnectActiveMatch();
  activeGameAdapter = adapter;
  activeChat = chat;
  activeChatUnsubscribe = chat.onMessage(renderChatMessage);
  resetChatOverlay();
  snapshot = nextSnapshot;
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
  replaceRoomRouteHash({ screen: "room", roomId: room.id });
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
  forfeitButton.classList.toggle("hidden", menuOpen || !currentRoomId || !deploymentRuntime.canForfeitMatch());
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
  syncActiveGameAdapterSnapshot();
  updateCamera();
  draw();
  syncVirtualPointerOverlay();
  syncPointerLockGate();
  requestAnimationFrame(frame);
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

function syncPointerLockGate() {
  if (!shouldBlockBattlefieldForPointerLock({ menuOpen, hasSnapshot: Boolean(snapshot), isLocked: document.pointerLockElement === canvas, armed: pointerLockArmed, unavailable: pointerLockUnavailable })) {
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
  const point = lastMouse ?? { x: canvas.width / 2, y: canvas.height / 2 };
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
  if (key === "escape" && commandMode) {
    event.preventDefault();
    cancelCommandMode();
    return;
  }
  if (key === "escape" && openPalette) {
    event.preventDefault();
    closePalette(t(openPalette === "build" ? "status.buildMenuClosed" : "status.stanceMenuClosed"));
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
  } catch (error) {
    showInvalidCommand(error instanceof Error ? error.message : String(error));
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
function playCues(cues: SoundCue[]) {
  for (const cue of cues) {
    const at = worldToScreen(cue);
    const outside = Math.max(0, -at.x, at.x - canvas.width, -at.y, at.y - canvas.height);
    const gain = 1 - outside / (canvas.width / 2);
    if (gain <= 0) continue;
    soundboard.play(cue.id, { pan: ((at.x / canvas.width) * 2 - 1) * 0.7, gain }, cue.kind);
  }
}

// The interface has one sound: a click for a button, a map or a portrait chosen. Pointing at one is silent.
function onInterfaceClick(event: MouseEvent) {
  soundboard.unlock();
  if (event.target instanceof Element && event.target.closest("button, .map-entry, .selection-model")) soundboard.play("click");
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
    else if (event.button === 0 && commandMode.type === "unload") issueUnloadAt(point, event.shiftKey);
    else if (event.button === 0 && commandMode.type === "spell") issueSpellAt(point, event.shiftKey);
    else if (event.button === 0 && commandMode.type === "item") issueItemAt(point);
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
  const selectedUnits = selectedPlayerUnits();
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

  const resource = hitResource(world);
  const item = hitGroundItem(world);
  const target = hitAttackTarget(world);
  const repairTarget = hitBuilding(world, (building) => building.owner === localPlayerId && building.hp < building.maxHp);
  if (item) {
    const command = pickupItemCommand(focusedPlayerUnits(), item);
    if (!command) {
      showInvalidCommand(t("status.pickupNeedsFocus"));
      return;
    }
    sendCommand({ type: "pickupItem", unitId: command.unitId, itemId: command.itemId, queued });
    statusLabel.textContent = t("status.itemPickup", { item: labelKind(item.kind) });
    return;
  }
  if (resource && selectedUnits.some((unit) => unit.kind === "worker")) {
    sendCommand({ type: "mine", unitIds: selectedUnits.filter((unit) => unit.kind === "worker").map((unit) => unit.id), resourceId: resource.id, queued });
    statusLabel.textContent = t("status.mineOrdered");
    return;
  }
  if (repairTarget && selectedUnits.some((unit) => unit.kind === "worker")) {
    sendCommand({ type: "repair", unitIds: selectedUnits.filter((unit) => unit.kind === "worker").map((unit) => unit.id), buildingId: repairTarget.id, queued });
    statusLabel.textContent = t("status.repairOrdered", { building: labelBuilding(repairTarget) });
    return;
  }
  // Soldiers right-clicked onto an own transport board it (see @@@transport).
  const transport = hitUnit(world, (unit) => unit.owner === localPlayerId && Boolean(UNIT_DEFS[unit.kind].carries));
  const boarders = selectedUnits.filter((unit) => !UNIT_DEFS[unit.kind].naval);
  if (transport && boarders.length > 0) {
    sendCommand({ type: "board", unitIds: boarders.map((unit) => unit.id), transportId: transport.id, queued });
    statusLabel.textContent = t("status.boardOrdered");
    return;
  }
  if (target) {
    sendCommand({ type: "attack", unitIds, targetId: target.id, queued });
    statusLabel.textContent = "along" in target ? t("status.breakObstacleOrdered") : target.owner === "neutral" ? t("status.attackWildlingsOrdered") : t("status.attackOrdered");
    return;
  }
  sendCommand({ type: "move", unitIds, x: world.x, y: world.y, queued });
  statusLabel.textContent = t("status.moveOrdered");
}

function issueRallyCommandAtWorld(world: Point, buildings: Building[]) {
  if (!snapshot) return;
  const friendlyUnit = hitUnit(world, (unit) => unit.owner === localPlayerId);
  if (friendlyUnit) {
    sendCommand({ type: "setRally", buildingIds: buildings.map((building) => building.id), x: friendlyUnit.x, y: friendlyUnit.y, target: { type: "unit", unitId: friendlyUnit.id } });
    statusLabel.textContent = t("status.rallyFollow", { label: buildings.length > 1 ? t("hud.rallyPoints") : t("hud.rallyPoint"), target: labelAnyKind(friendlyUnit.kind) });
    return;
  }
  const resource = hitResource(world);
  if (resource) {
    sendCommand({ type: "setRally", buildingIds: buildings.map((building) => building.id), x: resource.x, y: resource.y, target: { type: "resource", resourceId: resource.id } });
    statusLabel.textContent = t("status.rallyGold", { label: buildings.length > 1 ? t("hud.rallyPoints") : t("hud.rallyPoint") });
    return;
  }
  sendCommand({ type: "setRally", buildingIds: buildings.map((building) => building.id), x: world.x, y: world.y, target: { type: "point" } });
  statusLabel.textContent = t("status.rallySet", { label: buildings.length > 1 ? t("hud.rallyPoints") : t("hud.rallyPoint") });
}

function loadedTransports() {
  return selectedPlayerUnits().filter((unit) => UNIT_DEFS[unit.kind].carries && (unit.cargo?.length ?? 0) > 0);
}

function unloadButtonState(): CommandButtonState {
  if (commandMode || openPalette || !selectedPlayerUnits().some((unit) => UNIT_DEFS[unit.kind].carries)) return HIDDEN_COMMAND_STATE;
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

function canAttackMove() {
  return !commandMode && !openPalette && selectedPlayerUnits().length > 0;
}

function canOpenBuildPalette() {
  return !commandMode && !openPalette && focusedPlayerUnits().some((unit) => unit.kind === "worker");
}

function canBuild(kind: BuildingKind) {
  const player = currentPlayerState();
  return !commandMode && openPalette === "build" && BUILDABLE_BUILDING_KINDS.includes(kind) && Boolean(player && RACE_DEFS[player.race].buildableBuildings.includes(kind)) && focusedPlayerUnits().some((unit) => unit.kind === "worker");
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
  return abilityCommandState(focusedPlayerUnits(), ability, selectedPlayerUnits());
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
  const state = abilityButtonState(ability);
  if (!state.enabled) {
    showCommandUnavailable(state, t("status.spellNeedsCaster", { ability: labelKind(ability) }));
    return;
  }
  const caster = focusedPlayerUnits().find((unit) => UNIT_DEFS[unit.kind].abilities.includes(ability) && abilityCooldown(unit, ability) <= 0);
  if (!caster) {
    showInvalidCommand(t("status.spellNeedsCaster", { ability: labelKind(ability) }));
    return;
  }
  commandMode = { type: "spell", targeting: { casterId: caster.id, ability } };
  shell.classList.add("targeting-active");
  shell.classList.remove("placement-active");
  const behavior = ABILITY_DEFS[ability].behavior;
  const reach = chargeWindow(ability);
  statusLabel.textContent =
    behavior === "summon"
      ? t("status.summonMode")
      : reach
        ? t("status.chargeMode", { ability: labelKind(ability), min: reach.minRange })
        : t("status.spellMode", { ability: labelKind(ability) });
  updateHud();
}

function confirmBuildPlacement(point: Point) {
  if (!syncBeforeCommandProjection()) return;
  if (!commandMode || commandMode.type !== "build" || !snapshot) return;
  const world = screenToWorld(point);
  const result = buildPlacementCommand(snapshot, commandMode.placement, world);
  if ("error" in result) {
    showInvalidCommand(result.error);
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
  const unitIds = selectedPlayerUnits().map((unit) => unit.id);
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
  if (!commandMode || commandMode.type !== "spell") return;
  const { ability, casterId } = commandMode.targeting;
  const world = screenToWorld(point);
  const behavior = ABILITY_DEFS[ability].behavior;
  if (behavior === "summon") {
    sendCommand({ type: "cast", unitId: casterId, ability, x: world.x, y: world.y, queued });
    statusLabel.textContent = t("status.summonOrdered");
    clearCommandModeClasses();
    commandMode = undefined;
    updateHud();
    return;
  }

  const target =
    behavior === "heal"
      ? hitUnit(world, (unit) => unit.owner === localPlayerId)
      : hitUnit(world, (unit) => unit.owner !== localPlayerId);
  if (!target) {
    showInvalidCommand(t("status.spellNeedsTarget", { ability: labelKind(ability) }));
    return;
  }
  const reach = chargeWindow(ability);
  const caster = reach ? chargeRiderFor(readyChargers(selectedPlayerUnits(), ability), target, reach, casterId) : { id: casterId };
  if (!caster) {
    showInvalidCommand(t("status.chargeTooClose", { ability: labelKind(ability), min: reach!.minRange }));
    return;
  }
  sendCommand({ type: "cast", unitId: caster.id, ability, targetId: target.id, queued });
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
    canceled === "attackMove"
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
  sendCommand({ type: "train", buildingId: building.id, unitKind });
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
  if (!snapshot?.units.some((unit) => unit.owner === localPlayerId && standsAtShop(unit, shop))) return { visible: true, enabled: false, reason: "position" };
  return ENABLED_COMMAND_STATE;
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
  sendCommand({ type: "buy", shopId: shop.id, item: kind });
  statusLabel.textContent = t("status.itemBought", { item: labelKind(kind) });
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
  const result = selectInScreenBox(snapshot, localPlayerId, selectionRect(start, end), worldToScreen, { selectedIds, focusedSelectionId }, additive);
  selectedIds = result.selectedIds;
  focusedSelectionId = result.focusedSelectionId;
  if (selectedIds.size > 0 || !additive) selectedCampId = undefined;
  if (selectedIds.size > 0 || !additive) openPalette = undefined;
}

function selectSingle(point: Point, additive = false, sameKind = false) {
  const world = screenToWorld(point);
  const unit = hitUnit(world, (candidate) => candidate.owner === localPlayerId);
  if (unit) {
    const result = sameKind
      ? selectNearbySameKindUnits(snapshot!, localPlayerId, unit.id, DOUBLE_CLICK_SAME_KIND_RADIUS, { selectedIds, focusedSelectionId }, additive)
      : applySelectionPick({ selectedIds, focusedSelectionId }, [unit.id], additive);
    selectedIds = result.selectedIds;
    focusedSelectionId = result.focusedSelectionId;
    selectedCampId = undefined;
    openPalette = undefined;
    return;
  }
  const building = hitBuilding(world, (candidate) => candidate.owner === localPlayerId);
  if (building) {
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
  const liveIds = liveSelectionIds(snapshot);
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
}

function handleGameplayKeyIntent(event: KeyboardEvent) {
  if (!snapshot) return false;
  const inventoryEntries = carriedItemsForSelection(snapshot, focusedPlayerUnits()).slice(0, 6);
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
    if (selectedIds.size === 0) {
      showInvalidCommand(t("status.groupNeedsSelection", { slot: intent.slot }));
      return true;
    }
    replaceControlGroup(controlGroups, intent.slot, selectedIds);
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
  const player = currentPlayerState();
  goldLabel.textContent = String(player?.gold ?? "?");
  supplyLabel.textContent = player ? `${player.supplyUsed}/${player.supplyCap}` : "?";
  mapReadout.textContent = poolMap(snapshot.map.id) ? mapName(snapshot.map.id) : snapshot.map.name;
  const focusedBuildings = focusedPlayerBuildings();
  const camp = selectedMercenaryCamp();
  const groups = buildSelectionGroups(snapshot, selectedIds, focusedSelectionId, localPlayerId);
  if (groups.length > 0) {
    renderSelectionGroups(groups);
  } else if (camp) {
    selectionLabel.textContent = t("hud.mercenaryCamp", { stock: camp.stock, restocking: camp.cooldownRemaining > 0 ? t("hud.restocking") : "" });
  } else if (selectedShop()) {
    selectionLabel.textContent = t("hud.shop");
  } else {
    selectionLabel.textContent = t("hud.nothingSelected");
  }
  let visibleCount = 0;
  for (const button of commandButtons) {
    const state = button.state();
    button.element.hidden = !state.visible;
    button.element.disabled = !state.enabled;
    button.element.classList.toggle("command-button-disabled", state.visible && !state.enabled);
    button.element.classList.toggle("command-button-cooldown", state.cooldownTicks !== undefined);
    renderCommandButtonState(button.element, state);
    applyTooltip(button.element, commandButtonTooltip(button.tooltip(), state));
    if (state.visible) visibleCount += 1;
  }
  commandDock.querySelectorAll("[data-research-progress], [data-training-progress]").forEach((element) => element.remove());
  for (const progress of trainingProgressButtonsForSelection(focusedBuildings)) {
    commandDock.append(renderTrainingProgressButton(progress));
    visibleCount += 1;
  }
  for (const progress of researchProgressButtonsForSelection(focusedBuildings, player)) {
    commandDock.append(renderResearchProgressButton(progress));
    visibleCount += 1;
  }
  commandDock.classList.toggle("hidden", visibleCount === 0);
  renderItemDock();
}

function renderSelectionGroups(groups: SelectionGroup[]) {
  selectionLabel.replaceChildren(
    ...groups.map((group) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `selection-model ${group.focused ? "focused" : "dimmed"}`;
      button.dataset.selectionGroup = group.id;
      button.setAttribute("aria-label", selectionGroupTitle(group));
      applyTooltip(button, selectionGroupTooltip(group));
      const canvas = document.createElement("canvas");
      canvas.width = 34;
      canvas.height = 34;
      canvas.className = "selection-model-canvas";
      const count = document.createElement("span");
      count.className = "selection-model-count";
      count.textContent = `x${group.count}`;
      button.append(canvas, count);
      button.addEventListener("click", () => {
        focusedSelectionId = group.ids[0];
        openPalette = undefined;
        updateHud();
      });
      drawSelectionModel(canvas, group);
      return button;
    }),
  );
}

function selectionGroupTitle(group: SelectionGroup) {
  const label = labelAnyKind(group.kind);
  return `${label} x${group.count}${group.focused ? t("hud.selectionCurrent") : ""}`;
}

function selectionGroupTooltip(group: SelectionGroup): GameplayTooltip {
  if (group.entityType === "unit") {
    const units = snapshot?.units.filter((unit) => group.ids.includes(unit.id)) ?? [];
    return unitSelectionTooltip(group.kind, units, snapshot!, i18n);
  }
  return buildingTooltip(group.kind, undefined, i18n);
}

function drawSelectionModel(canvas: HTMLCanvasElement, group: SelectionGroup) {
  const mini = requireCanvasContext(canvas);
  mini.clearRect(0, 0, canvas.width, canvas.height);
  const point = { x: canvas.width / 2, y: canvas.height / 2 + 4 };
  const color = group.focused ? "#42796e" : "#7c9078";
  if (group.entityType === "unit") drawAtlasUnit(mini, group.kind, point, 0.61, color);
  else drawAtlasBuilding(mini, group.kind, point, 30, color);
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
  button.style.setProperty("--research-progress", `${progress.status === "researching" ? Math.max(6, percent) : percent}%`);
  button.innerHTML = `
    <span class="research-progress-fill"></span>
    <span class="command-icon">${escapeHtml(progress.icon)}</span>
    <span class="research-progress-text">${progress.status === "researching" ? percent : "Q"}</span>
  `;
  return button;
}

function renderTrainingProgressButton(progress: TrainingProgressButton) {
  const percent = Math.floor(progress.progress * 100);
  const label = t(progress.status === "training" ? "hud.trainingTraining" : "hud.trainingQueued", { label: labelKind(progress.unitKind) });
  const button = document.createElement("button");
  button.type = "button";
  button.tabIndex = -1;
  button.className = "command-button research-progress-button";
  button.setAttribute("aria-disabled", "true");
  button.dataset.trainingProgress = progress.unitKind;
  button.dataset.commandLabel = label;
  button.setAttribute("aria-label", `${label} - ${percent}%`);
  const tooltip = unitTooltip(progress.unitKind, undefined, i18n);
  applyTooltip(button, {
    ...tooltip,
    title: label,
    stats: [t("hud.progressComplete", { percent }), ...tooltip.stats],
  });
  button.style.setProperty("--research-progress", `${progress.status === "training" ? Math.max(6, percent) : percent}%`);
  button.innerHTML = `
    <span class="research-progress-fill"></span>
    <span class="command-icon">${escapeHtml(trainIcon(progress.unitKind))}</span>
    <span class="research-progress-text">${progress.status === "training" ? percent : "Q"}</span>
  `;
  drawCommandPortrait(button, { type: "unit", kind: progress.unitKind });
  return button;
}

function renderItemDock() {
  if (!snapshot || menuOpen) {
    itemDock.classList.add("hidden");
    itemDock.replaceChildren();
    return;
  }
  const entries = carriedItemsForSelection(snapshot, focusedPlayerUnits()).slice(0, 6);
  const hotkeys = itemHotkeys(entries.length, new Set(Object.keys(controlGroups).map(Number)));
  itemDock.classList.toggle("hidden", entries.length === 0);
  itemDock.replaceChildren(
    ...entries.map(({ item, carrier }, index) => {
      const hotkey = hotkeys[index] ?? "";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "item-button";
      button.dataset.itemId = item.id;
      const itemName = labelKind(item.kind);
      const cooldownText = item.cooldownRemaining > 0 ? t("hud.itemRecharging", { ticks: item.cooldownRemaining }) : "";
      button.setAttribute("aria-label", `${itemName} (${hotkey})${cooldownText}`);
      applyTooltip(button, itemTooltip(item.kind, hotkey, i18n));
      button.classList.toggle("item-button-cooldown", item.cooldownRemaining > 0);
      button.innerHTML = `<span class="item-icon">${itemIcon(item.kind)}</span><span class="hotkey">${hotkey}</span>${item.cooldownRemaining > 0 ? `<span class="item-cooldown">${item.cooldownRemaining}</span>` : ""}`;
      button.addEventListener("click", () => useCarriedItem(item.id));
      button.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        dropCarriedItem(item.id, carrier.id);
      });
      return button;
    }),
  );
}

function useInventoryItem(index: number) {
  if (!syncBeforeCommandProjection()) return false;
  if (!snapshot) return false;
  const entry = carriedItemsForSelection(snapshot, focusedPlayerUnits())[index];
  if (!entry) return false;
  useCarriedItem(entry.item.id);
  return true;
}

function useCarriedItem(itemId: string) {
  if (!syncBeforeCommandProjection()) return;
  if (!snapshot) return;
  const entry = carriedItemsForSelection(snapshot, focusedPlayerUnits()).find(({ item }) => item.id === itemId);
  if (!entry) return;
  if (entry.item.kind === "flameCloak" || entry.item.kind === "speedBoots" || entry.item.kind === "regenRing") {
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
  const entry = carriedItemsForSelection(snapshot, focusedPlayerUnits()).find(({ item, carrier }) => item.id === itemId && carrier.id === carrierId);
  if (!entry) return;
  sendCommand(dropItemCommand(entry.item, entry.carrier));
  statusLabel.textContent = t("status.itemDropped", { item: labelKind(entry.item.kind) });
}

function itemIcon(kind: WorldItem["kind"]) {
  return kind === "lightningRod" ? "↯" : kind === "stormStaff" ? "☈" : kind === "flameCloak" ? "♨" : kind === "guardianScroll" ? "▤" : kind === "speedBoots" ? "»" : kind === "regenRing" ? "◯" : kind === "healingScroll" ? "✚" : kind === "ivoryTower" ? "♜" : "✦";
}

function trainIcon(kind: TrainableUnitKind) {
  return TRAIN_COMMANDS.find((command) => command.kind === kind)?.icon ?? "△";
}

function draw() {
  if (menuOpen) {
    // The scene paints at its own pace and keeps its last picture between (see @@@menu-scenes).
    menuBackdrop.draw(ctx, canvas.width, canvas.height, performance.now());
    return;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!snapshot) {
    drawPaperMap(ctx, currentRoom?.mapId ?? LADDER_MAP_ID, camera, canvas.width, canvas.height);
    ctx.fillStyle = "#243126";
    ctx.font = "24px ui-rounded, system-ui";
    ctx.fillText(t("canvas.connecting"), 32, 48);
    return;
  }
  drawWorld({
    ctx,
    snapshot,
    view: { x: camera.x, y: camera.y, width: canvas.width, height: canvas.height },
    now: performance.now(),
    facing: unitFacing,
    motion: unitMotion,
    labels: worldLabels,
    selectedIds,
    ...(selectedCampId ? { selectedCampId } : {}),
  });
  drawBuildPlacementPreview();
  drawAttackMovePreview();
  drawSpellPreview();
  drawSelectionBox();
  drawMinimap(createMapPresentation(snapshot));
}

function drawBuildPlacementPreview() {
  if (!commandMode || commandMode.type !== "build" || !lastMouse) return;
  const def = BUILDING_DEFS[commandMode.placement.buildingKind];
  const point = lastMouse;
  const size = buildingGlyphSize(commandMode.placement.buildingKind);
  const world = screenToWorld(point);
  const placement = snapshot ? buildPlacementCommand(snapshot, commandMode.placement, world) : undefined;
  const validPlacement = !placement || "command" in placement;
  ctx.save();
  ctx.strokeStyle = validPlacement ? "#387d72" : "#a85644";
  ctx.lineWidth = 2;
  ctx.setLineDash([7, 5]);
  ctx.beginPath();
  ctx.ellipse(point.x, point.y + size / 2 - 3, def.radius, def.radius * 0.36, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 0.62;
  drawAtlasBuilding(ctx, commandMode.placement.buildingKind, point, size, String(ctx.strokeStyle));
  ctx.globalAlpha = 1;
  ctx.fillStyle = validPlacement ? "#387d72" : "#a85644";
  ctx.font = "11px ui-monospace, monospace";
  ctx.fillText(t("canvas.buildPreview", { building: labelKind(commandMode.placement.buildingKind), cost: def.cost }), point.x - 34, point.y + size / 2 + 22);
  ctx.restore();
}

function drawAttackMovePreview() {
  if (!commandMode || commandMode.type !== "attackMove" || !lastMouse) return;
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
  ctx.fillText(t("canvas.attackMove"), point.x - 20, point.y + 44);
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
  const color = behavior === "heal" ? "#5d8b4c" : behavior === "summon" ? "#5f578f" : "#7f3a70";
  const fill = behavior === "heal" ? "rgba(93, 139, 76, 0.08)" : behavior === "summon" ? "rgba(95, 87, 143, 0.08)" : "rgba(127, 58, 112, 0.08)";
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = fill;
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.arc(point.x, point.y, behavior === "summon" ? 28 : 22, 0, Math.PI * 2);
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
  const riders = readyChargers(selectedPlayerUnits(), ability);
  const world = screenToWorld(point);
  const target = hitUnit(world, (unit) => unit.owner !== localPlayerId);
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
  drawMinimapMap(ctx, snapshot, rect, marks);
  ctx.strokeStyle = "#243126";
  ctx.lineWidth = 1;
  const viewport = minimapViewportRect(rect);
  ctx.strokeRect(viewport.x, viewport.y, viewport.width, viewport.height);
}

function updateCamera() {
  if (menuOpen) return;
  const speed = keys.has("shift") ? 24 : 14;
  if (keys.has("arrowleft") || keys.has("a")) camera.x -= speed;
  if (keys.has("arrowright") || keys.has("d")) camera.x += speed;
  if (keys.has("arrowup") || keys.has("w")) camera.y -= speed;
  if (keys.has("arrowdown") || keys.has("s")) camera.y += speed;
  const aim = edgeScrollAim();
  const edge = edgeScrollDelta(aim?.point, { width: canvas.width, height: canvas.height }, aim?.overInterface);
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
  camera.x = Math.max(0, Math.min(snapshot.map.width - canvas.width, camera.x));
  camera.y = Math.max(0, Math.min(snapshot.map.height - canvas.height, camera.y));
}

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  const mini = minimapRect();
  minimapFrame.style.transform = `translate(${mini.x}px, ${mini.y}px)`;
  minimapFrame.style.width = `${mini.width}px`;
  minimapFrame.style.height = `${mini.height}px`;
  // The treasury rides on the minimap's frame, just above it (see .minimap-tab).
  minimapTab.style.transform = `translate(${mini.x}px, ${mini.y}px) translateY(-100%)`;
  minimapTab.style.width = `${mini.width}px`;
}

function mousePoint(event: MouseEvent): Point {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function inputPoint(event: MouseEvent): Point {
  if (document.pointerLockElement !== canvas) return mousePoint(event);
  const movement = event.type === "mousemove" ? { x: event.movementX, y: event.movementY } : { x: 0, y: 0 };
  virtualMouse = moveVirtualPointer(virtualMouse, movement, { width: canvas.width, height: canvas.height });
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
  return { x: point.x + camera.x, y: point.y + camera.y };
}

function worldToScreen(point: Point): Point {
  return { x: point.x - camera.x, y: point.y - camera.y };
}

function nearScreen(point: Point, pad: number) {
  return point.x >= -pad && point.y >= -pad && point.x <= canvas.width + pad && point.y <= canvas.height + pad;
}

// The minimap keeps clear of the window's edge by its frame's width (see .minimap-frame).
function minimapRect(): ScreenRect {
  const size = Math.min(220, Math.max(150, Math.floor(Math.min(canvas.width, canvas.height) * 0.24)));
  return { x: canvas.width - size - 16, y: canvas.height - size - 16, width: size, height: size };
}

function minimapViewportRect(rect = minimapRect()): ScreenRect {
  if (!snapshot) return { x: rect.x, y: rect.y, width: 0, height: 0 };
  return minimapViewportRectFor(rect, camera, { width: canvas.width, height: canvas.height }, snapshot.map);
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
  camera.x = world.x - canvas.width / 2;
  camera.y = world.y - canvas.height / 2;
  clampCamera();
}

function hitResource(world: Point) {
  return snapshot?.resources.find((resource) => distance(resource, world) < 84);
}

function hitShop(world: Point) {
  return snapshot?.shops?.find((shop) => distance(shop, world) < shop.radius + 16);
}

function hitMercenaryCamp(world: Point) {
  return snapshot?.mercenaryCamps.find((camp) => distance(camp, world) < camp.radius + 16);
}

function hitGroundItem(world: Point) {
  return snapshot?.items.find((item) => !item.carrierId && distance(item, world) < 34);
}

function hitAttackTarget(world: Point) {
  return hitUnit(world, (unit) => unit.owner !== localPlayerId) ?? hitBuilding(world, (building) => building.owner !== localPlayerId) ?? hitObstacle(world);
}

// Rocks or a gate under the pointer (see @@@obstacle): anywhere on its body.
function hitObstacle(world: Point) {
  return snapshot?.obstacles?.find((obstacle) => distance(obstacle, world) < obstacle.radius + 8);
}

function hitUnit(world: Point, predicate: (unit: Unit) => boolean) {
  return snapshot?.units.find((unit) => predicate(unit) && distance(unit, world) < 34);
}

function hitBuilding(world: Point, predicate: (building: Building) => boolean) {
  return snapshot?.buildings.find((building) => predicate(building) && distance(building, world) < (building.kind === "townHall" ? 58 : 46));
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
