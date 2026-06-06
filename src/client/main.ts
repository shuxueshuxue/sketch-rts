import "./styles.css";
import { buildPlacementCommand, type BuildPlacement } from "./build-placement-controls";
import { BUILDING_GLYPHS, type BuildingGlyph, type BuildingGlyphMark } from "./building-glyphs";
import { chatKeyIntent, normalizeChatText } from "./chat-controller";
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
import { createBrowserI18n } from "./i18n";
import { carriedItemsForSelection, dropItemCommand, itemHotkeys, itemLabel, pickupItemCommand, useItemCommand } from "./item-controls";
import { gameplayKeyIntent } from "./keybindings";
import { drawLevelStar } from "./level-star";
import { isInsideRect, minimapPointToWorld, minimapViewportRectFor, shouldDragMinimap } from "./minimap";
import {
  isMicrosoftEdgeUserAgent,
  moveVirtualPointer,
  pointerLockRequiredBody,
  pointerLockRequiredTitle,
  shouldBlockBattlefieldForPointerLock,
  shouldSuppressCanvasMouseDefault,
  shouldSuppressCanvasPointerGesture,
  shouldSuppressPointerLockMouseDefault,
  virtualPointerTransform,
} from "./pointer-lock";
import { RESEARCH_COMMANDS, researchCommandButtonsForSelection, researchProgressButtonsForSelection, type ResearchProgressButton } from "./research-controls";
import { roomBrowserEntries } from "./room-browser-model";
import { roomSetupViewAction } from "./room-view-state";
import { UNIT_GLYPHS, unitGlyphScale, type GlyphMark, type UnitGlyph } from "./glyphs";
import { generateTerrainLinework, type TextureStroke } from "./terrain-texture";
import { abilityTooltip, buildingTooltip, formatTooltipDataset, itemTooltip, unitTooltip, upgradeTooltip, type GameplayTooltip } from "./tooltips";
import { trainingProgressButtonsForSelection, trainingQueueCountText, type TrainingProgressButton } from "./training-queue";
import { newUserId } from "./user-profile";
import { applySelectionPick, selectInScreenBox, selectNearbySameKindUnits, type ScreenRect as SelectionScreenRect } from "./selection-controls";
import { renderWorldEffects } from "./effect-renderer";
import { virtualClickableTargetFromElement, virtualTooltipTargetFromElement } from "./virtual-ui";
import { BUILDABLE_BUILDING_KINDS, BUILDING_DEFS, RACE_IDS, UNIT_DEFS } from "../shared/catalog";
import { MAP_SCENARIOS } from "../shared/map";
import { createMapPresentation, projectWorldToRect, type MapPresentationMark } from "../shared/presentation";
import { canStartRoom, type SlotPatch } from "../shared/rooms";
import type { AbilityKind, Building, BuildingKind, GameCommand, GameSnapshot, LocalUserProfile, MercenaryCamp, Owner, PlayerId, ResourceNode, RoomState, TerrainLandmark, TrainableUnitKind, Unit, UpgradeKind, WorldItem } from "../shared/types";
import type { MapId } from "../shared/types";

type Point = { x: number; y: number };
type ScreenRect = { x: number; y: number; width: number; height: number };
type SpellTargeting = { casterId: string; ability: AbilityKind };
type ItemTargeting = { unitId: string; itemId: string; kind: WorldItem["kind"] };
type CommandMode = { type: "attackMove" } | { type: "build"; placement: BuildPlacement } | { type: "spell"; targeting: SpellTargeting } | { type: "item"; targeting: ItemTargeting };
type MenuView = "home" | "profile" | "rooms" | "create" | "setup" | "results";

declare global {
  interface Window {
    __sketchRtsView?: SketchRtsDebugView;
  }
}

const POINTER_LOCK_GUIDE_STORAGE_KEY = "sketch-rts-pointer-lock-guide-v1";
const MAX_ROOM_SLOTS = 30;

const app = requireElement<HTMLDivElement>("#app");

type CommandButton = {
  element: HTMLButtonElement;
  hotkey: string;
  tooltip: () => GameplayTooltip;
  isAvailable: () => boolean;
  run: () => void;
};

const BUILD_COMMANDS = [
  { kind: "townHall", icon: "⌂", hotkey: "h" },
  { kind: "barracks", icon: "▱", hotkey: "b" },
  { kind: "archeryRange", icon: "⌁", hotkey: "r" },
  { kind: "stables", icon: "⌂", hotkey: "s" },
  { kind: "sanctum", icon: "✣", hotkey: "c" },
  { kind: "workshop", icon: "⚙", hotkey: "o" },
  { kind: "defenseTower", icon: "⌖", hotkey: "t" },
  { kind: "moonWell", icon: "◐", hotkey: "m" },
  { kind: "farm", icon: "⌗", hotkey: "e" },
] satisfies { kind: BuildingKind; icon: string; hotkey: string }[];

const TRAIN_COMMANDS = [
  { kind: "worker", icon: "⌘", hotkey: "w" },
  { kind: "footman", icon: "△", hotkey: "f" },
  { kind: "archer", icon: "⋉", hotkey: "a" },
  { kind: "raider", icon: "◇", hotkey: "r" },
  { kind: "lancer", icon: "↗", hotkey: "l" },
  { kind: "knight", icon: "♜", hotkey: "k" },
  { kind: "priest", icon: "+", hotkey: "p" },
  { kind: "summoner", icon: "◎", hotkey: "u" },
  { kind: "witch", icon: "☾", hotkey: "c" },
  { kind: "golem", icon: "▣", hotkey: "g" },
] satisfies { kind: TrainableUnitKind; icon: string; hotkey: string }[];

const SPELL_COMMANDS = [
  { ability: "heal", icon: "+", hotkey: "h" },
  { ability: "summon", icon: "◎", hotkey: "u" },
  { ability: "curse", icon: "☾", hotkey: "c" },
] satisfies { ability: AbilityKind; icon: string; hotkey: string }[];
const HIRE_COMMAND = { icon: "⚔", hotkey: "m" } as const;
const DOUBLE_CLICK_SAME_KIND_RADIUS = 900;

app.innerHTML = gameShellMarkup;

const i18n = createBrowserI18n();
const t = i18n.t;
document.documentElement.lang = i18n.locale;

const canvas = requireElement<HTMLCanvasElement>(".game-canvas");
const shell = requireElement<HTMLDivElement>(".game-shell");
const mainMenu = requireElement<HTMLDivElement>("[data-main-menu]");
const menuTitle = requireElement<HTMLDivElement>("[data-menu-title]");
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
const ctx = requireCanvasContext(canvas);

let snapshot: GameSnapshot | undefined;
let currentRoom: RoomState | undefined;
let currentRoomId: string | undefined;
let pendingRoomMapScrollTop: number | undefined;
let localPlayerId: PlayerId = "player";
let spectatingRoom = false;
let activeGameAdapter: GameAdapter;
let activeChat: MatchChat | undefined;
let activeChatUnsubscribe: (() => void) | undefined;
let localUser = loadLocalUserProfile();
let selectedIds = new Set<string>();
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
let selectedMapId: MapId = "verdantCrossroads";
let commandMode: CommandMode | undefined;
let buildPaletteOpen = false;
let pointerLockGateKind: "guide" | "required" = "guide";
const keys = new Set<string>();
const deploymentRuntime = createDeploymentRuntime(deploymentModeFromEnv(import.meta.env), {
  onRuntimeReady() {
    menuStatus.textContent = "Server online.";
    statusLabel.textContent = "Connected. Drag-select workers, right-click gold mines, build a barracks, then train soldiers.";
    renderMainMenu();
  },
  onRuntimeError(message) {
    statusLabel.innerHTML = `<span class="error">${escapeHtml(message)}</span>`;
  },
});
const baseGameAdapter = deploymentRuntime.initialAdapter();
activeGameAdapter = baseGameAdapter;
const commandButtons: CommandButton[] = [
  createCommandButton("Attack Move", "⌁", "a", canAttackMove, beginAttackMoveMode, () => ({
    title: "Attack Move",
    body: "Selected units move toward a point and fight enemies they meet along the way.",
    stats: ["Uses all selected units"],
    requirements: ["Needs at least one selected unit."],
    hotkey: "A",
  })),
  createCommandButton("Build", "⌘", "b", canOpenBuildPalette, openBuildPalette, () => ({
    title: "Build",
    body: "Open the worker construction palette.",
    stats: ["Worker command"],
    requirements: ["Focus a worker."],
    hotkey: "B",
  })),
  ...BUILD_COMMANDS.map((command) =>
    createCommandButton(`Build ${labelKind(command.kind)}`, command.icon, command.hotkey, () => canBuild(command.kind), () => beginBuildPlacement(command.kind), () => buildingTooltip(command.kind, command.hotkey)),
  ),
  ...TRAIN_COMMANDS.map((command) =>
    createCommandButton(`Train ${labelKind(command.kind)}`, command.icon, command.hotkey, () => canTrain(command.kind), () => train(command.kind), () => unitTooltip(command.kind, command.hotkey)),
  ),
  ...RESEARCH_COMMANDS.map((command) =>
    createCommandButton(`Research ${command.label}`, command.icon, command.hotkey, () => canResearch(command.upgradeKind), () => research(command.upgradeKind), () => upgradeTooltip(command.upgradeKind, command.hotkey, currentPlayerState()?.upgrades[command.upgradeKind] ?? 0)),
  ),
  ...SPELL_COMMANDS.map((command) =>
    createCommandButton(`Cast ${labelKind(command.ability)}`, command.icon, command.hotkey, () => canCast(command.ability), () => beginSpellTargeting(command.ability), () => abilityTooltip(command.ability, command.hotkey)),
  ),
  createCommandButton("Hire Mercenary", HIRE_COMMAND.icon, HIRE_COMMAND.hotkey, canHireMercenary, hireMercenary, () => ({
    title: "Hire Mercenary",
    body: "Recruit the mercenary currently offered by the selected camp.",
    stats: ["Uses camp stock", "Instant recruit"],
    requirements: ["A friendly unit must stand near the camp."],
    hotkey: HIRE_COMMAND.hotkey.toUpperCase(),
  })),
];

window.addEventListener("resize", resizeCanvas);
window.addEventListener("keydown", onKeyDown);
window.addEventListener("keyup", (event) => keys.delete(event.key.toLowerCase()));
document.addEventListener("pointerover", showTooltipFromEvent, true);
document.addEventListener("pointermove", moveTooltipFromEvent, true);
document.addEventListener("pointerout", hideTooltipFromEvent, true);
document.addEventListener("focusin", showTooltipFromEvent, true);
document.addEventListener("focusout", hideTooltipFromEvent, true);
document.addEventListener("pointerlockchange", syncPointerLockState);
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
forfeitButton.addEventListener("click", () => void forfeitCurrentMatch());
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
canvas.addEventListener("mouseup", onMouseUp);

renderMainMenu();
resizeCanvas();
requestAnimationFrame(frame);

function createCommandButton(label: string, icon: string, hotkey: string, isAvailable: () => boolean, run: () => void, tooltip: () => GameplayTooltip): CommandButton {
  const element = document.createElement("button");
  element.className = "command-button";
  element.type = "button";
  element.dataset.commandLabel = label;
  element.dataset.hotkey = hotkey.toUpperCase();
  element.setAttribute("aria-label", `${label} (${hotkey.toUpperCase()})`);
  applyTooltip(element, tooltip());
  element.innerHTML = `<span class="command-icon">${escapeHtml(icon)}</span><span class="hotkey">${hotkey.toUpperCase()}</span>`;
  element.addEventListener("click", run);
  commandDock.append(element);
  return { element, hotkey, tooltip, isAvailable, run };
}

function applyTooltip(element: HTMLElement, tooltip: GameplayTooltip) {
  const dataset = formatTooltipDataset(tooltip);
  element.dataset.tooltipTitle = dataset.title;
  element.dataset.tooltipBody = dataset.body;
  element.dataset.tooltipStats = dataset.stats;
  element.dataset.tooltipRequirements = dataset.requirements;
  element.dataset.tooltipHotkey = dataset.hotkey;
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
  const hotkey = target.dataset.tooltipHotkey;
  tooltipLayer.innerHTML = `
    <div class="tooltip-title">${escapeHtml(target.dataset.tooltipTitle ?? "")}${hotkey ? `<span>${escapeHtml(hotkey)}</span>` : ""}</div>
    ${target.dataset.tooltipBody ? `<div class="tooltip-body">${escapeHtml(target.dataset.tooltipBody)}</div>` : ""}
    ${stats.length > 0 ? `<div class="tooltip-stats">${stats.map((item) => `<div>${escapeHtml(item)}</div>`).join("")}</div>` : ""}
    ${requirements.length > 0 ? `<div class="tooltip-requirements">${requirements.map((item) => `<div>${escapeHtml(item)}</div>`).join("")}</div>` : ""}
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
  menuStatus.textContent = t("home.signedIn", { name: localUser.name });
  mapList.replaceChildren(
    menuButton(t("home.rooms.label"), t("home.rooms.note"), "data-open-room-browser", () => {
      menuView = "rooms";
      renderMainMenu();
    }),
    menuButton(t("profile.open.label"), t("profile.open.note", { id: localUser.id.slice(0, 8) }), "data-open-profile", () => {
      menuView = "profile";
      renderMainMenu();
    }),
  );
}

function renderCreateGameMenu() {
  menuStatus.textContent = t("roomCreate.status");
  const form = document.createElement("form");
  form.className = "create-game-form";
  form.dataset.createGameForm = "true";
  form.innerHTML = `
    <div class="create-game-grid">
      <label>${escapeHtml(t("roomCreate.name.label"))}<input name="name" value="${escapeHtml(t("roomCreate.defaultName", { name: localUser.name }))}" /></label>
      <label>${escapeHtml(t("roomCreate.map.label"))}
        <select name="mapId">
          ${MAP_SCENARIOS.map((scenario) => `<option value="${escapeHtml(scenario.id)}" ${scenario.id === selectedMapId ? "selected" : ""}>${escapeHtml(scenario.name)} - ${escapeHtml(mapCapacityLabel(scenario.id))}</option>`).join("")}
        </select>
      </label>
      <div class="create-count-grid">
        <label>${escapeHtml(t("roomCreate.humanPlayers.label"))}<input name="humanCount" type="number" min="1" max="30" value="1" /></label>
        <label>${escapeHtml(t("roomCreate.aiPlayers.label"))}<input name="aiCount" type="number" min="0" max="29" value="1" /></label>
      </div>
      <div class="create-slot-total" data-create-slot-total>${escapeHtml(t("roomCreate.slotCountLabel", { count: 2 }))}</div>
    </div>
    <label class="checkbox-row"><input name="privateRoom" type="checkbox" checked /> ${escapeHtml(t("roomCreate.private.label"))}</label>
    <div class="menu-actions">
      <button type="submit" data-submit-create-game>${escapeHtml(t("roomCreate.submit"))}</button>
      <button type="button" data-back-home>${escapeHtml(t("common.back"))}</button>
    </div>
  `;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const mapId = String(data.get("mapId"));
    const humanCount = Number(data.get("humanCount"));
    const aiCount = Number(data.get("aiCount"));
    const name = String(data.get("name") ?? "").trim() || t("roomCreate.defaultName", { name: localUser.name });
    if (!Number.isInteger(humanCount) || !Number.isInteger(aiCount) || humanCount < 1 || aiCount < 0 || humanCount + aiCount < 2 || humanCount + aiCount > 30) {
      menuStatus.innerHTML = `<span class="error">${escapeHtml(t("roomCreate.slotCountRangeError"))}</span>`;
      return;
    }
    if (!MAP_SCENARIOS.some((scenario) => scenario.id === mapId)) {
      menuStatus.innerHTML = `<span class="error">${escapeHtml(t("roomCreate.knownMapError"))}</span>`;
      return;
    }
    void createConfiguredRoom({
      name,
      mapId: mapId as MapId,
      humanCount,
      aiCount,
      visibility: data.get("privateRoom") === "on" ? "private" : "public",
    });
  });
  const refreshSlotTotal = () => {
    const humanCount = Number((form.elements.namedItem("humanCount") as HTMLInputElement).value);
    const aiCount = Number((form.elements.namedItem("aiCount") as HTMLInputElement).value);
    const total = humanCount + aiCount;
    const totalLabel = form.querySelector<HTMLElement>("[data-create-slot-total]")!;
    totalLabel.textContent = Number.isInteger(total) ? t("roomCreate.slotCountLabel", { count: total }) : t("roomCreate.slotCountFallback");
    totalLabel.classList.toggle("error", !Number.isInteger(humanCount) || !Number.isInteger(aiCount) || total < 2 || total > MAX_ROOM_SLOTS || humanCount < 1 || aiCount < 0);
  };
  form.querySelectorAll<HTMLInputElement>("input[name='humanCount'], input[name='aiCount']").forEach((input) => input.addEventListener("input", refreshSlotTotal));
  form.querySelector("[data-back-home]")?.addEventListener("click", () => {
    menuView = "home";
    renderMainMenu();
  });
  mapList.replaceChildren(form);
}

function renderProfileMenu() {
  menuStatus.textContent = "Local browser identity for LAN rooms.";
  const form = document.createElement("form");
  form.className = "profile-form";
  form.dataset.profileForm = "true";
  form.innerHTML = `
    <label>Display name<input name="name" value="${escapeHtml(localUser.name)}" /></label>
    <div class="profile-id">User id ${escapeHtml(localUser.id)}</div>
    <div class="menu-actions">
      <button type="submit">Save</button>
      <button type="button" data-regenerate-user>Regenerate id</button>
      <button type="button" data-back-home>Back</button>
    </div>
  `;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    if (!name) {
      menuStatus.innerHTML = `<span class="error">Name cannot be empty.</span>`;
      return;
    }
    localUser = { ...localUser, name };
    saveLocalUserProfile(localUser);
    menuView = "home";
    renderMainMenu();
  });
  form.querySelector("[data-regenerate-user]")?.addEventListener("click", () => {
    localUser = { id: newUserId(), name: localUser.name };
    saveLocalUserProfile(localUser);
    renderMainMenu();
  });
  form.querySelector("[data-back-home]")?.addEventListener("click", () => {
    menuView = "home";
    renderMainMenu();
  });
  mapList.replaceChildren(form);
}

async function renderRoomBrowser() {
  menuStatus.textContent = "Rooms hosted by this server.";
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
    menuButton("Create Room", "Choose map, slots, and private/public visibility.", "data-create-room", () => {
      menuView = "create";
      renderMainMenu();
    }),
    menuButton("Back", "Return to the main menu.", "data-back-home", () => {
      menuView = "home";
      renderMainMenu();
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
    menuStatus.textContent = "No room selected.";
    mapList.replaceChildren(menuButton("Create Room", "Create a private or public game room.", "data-create-room", () => {
      menuView = "create";
      renderMainMenu();
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
  selectedMapId = room.mapId;
  menuStatus.textContent = `${room.name} - ${room.visibility} - ${room.status}`;
  const setup = document.createElement("div");
  setup.className = "room-setup";
  setup.dataset.roomSetup = room.id;
  setup.innerHTML = `
    <div class="room-setup-header">
      <div>
        <div class="room-section-title">Room</div>
        <div class="room-setup-name">${escapeHtml(room.name)}</div>
      </div>
    </div>
    <div class="room-setup-layout">
      <section class="room-map-pane" aria-label="Map list">
        <div class="room-section-title">Maps</div>
        <div class="room-map-grid"></div>
      </section>
      <section class="room-slot-pane" aria-label="Player slots">
        <div class="slot-pane-head">
          <div>
            <div class="room-section-title">Slots</div>
            <div class="room-slot-summary" data-slot-summary>${escapeHtml(slotSummaryText(room))}</div>
          </div>
          <div class="slot-actions">
            <button type="button" data-add-player-slot ${room.slots.length >= MAX_ROOM_SLOTS ? "disabled" : ""}>+ Player</button>
            <button type="button" data-add-ai-slot ${room.slots.length >= MAX_ROOM_SLOTS ? "disabled" : ""}>+ Computer</button>
            <button type="button" data-remove-slot ${canRemoveLastRoomSlot(room) ? "" : "disabled"}>Remove Slot</button>
            <button type="button" class="danger-button" data-close-room ${room.hostUserId === localUser.id ? "" : "disabled"}>Close Room</button>
          </div>
        </div>
        <div class="slot-list"></div>
      </section>
    </div>
    <div class="menu-actions">
      <button type="button" data-start-room>Start Match</button>
      <button type="button" data-back-room-browser>Back to Rooms</button>
    </div>
  `;
  const startButton = setup.querySelector<HTMLButtonElement>("[data-start-room]")!;
  startButton.disabled = !canStartRoom(room);
  startButton.title = startButton.disabled ? "Fill open slots, keep at least two active slots on two teams, and ready human players." : "Start match";
  const mapGrid = setup.querySelector<HTMLDivElement>(".room-map-grid")!;
  mapGrid.replaceChildren(...MAP_SCENARIOS.map((scenario) => mapChoiceButton(scenario.id)));
  const slotList = setup.querySelector<HTMLDivElement>(".slot-list")!;
  slotList.replaceChildren(...room.slots.map(slotRow));
  setup.querySelector("[data-add-player-slot]")?.addEventListener("click", () => void addPlayerRoomSlot());
  setup.querySelector("[data-add-ai-slot]")?.addEventListener("click", () => void addAiRoomSlot());
  setup.querySelector("[data-remove-slot]")?.addEventListener("click", () => void removeLastRoomSlot());
  setup.querySelector("[data-close-room]")?.addEventListener("click", () => void closeCurrentRoom());
  setup.querySelector("[data-start-room]")?.addEventListener("click", () => void startCurrentRoom());
  setup.querySelector("[data-back-room-browser]")?.addEventListener("click", () => {
    menuView = "rooms";
    renderMainMenu();
  });
  mapList.replaceChildren(setup);
  if (pendingRoomMapScrollTop !== undefined) {
    // @@@preserve-map-list-scroll - Map selection swaps this DOM subtree; keep the user's scroll position stable.
    mapGrid.scrollTop = pendingRoomMapScrollTop;
    pendingRoomMapScrollTop = undefined;
  }
}

function renderResultsMenu() {
  const result = currentRoom?.result;
  if (!currentRoom || !result) {
    menuStatus.textContent = "No completed match selected.";
    mapList.replaceChildren(menuButton("Back Home", "Return to the main menu.", "data-return-home", returnHome));
    return;
  }

  menuStatus.textContent = `${currentRoom.name} finished at tick ${result.endedAtTick ?? "?"}.`;
  const rows = result.slots.map((slot) => {
    const kills = result.stats.unitsKilled[slot.playerId] ?? 0;
    const losses = result.stats.unitsLost[slot.playerId] ?? 0;
    const spent = result.stats.goldSpent[slot.playerId] ?? 0;
    const buildings = result.stats.buildingsDestroyed[slot.playerId] ?? 0;
    return `
      <div class="result-row" data-result-slot="${escapeHtml(slot.playerId)}">
        <span>${escapeHtml(slot.name)}</span>
        <span>${escapeHtml(slot.controller)}</span>
        <span>${escapeHtml(slot.team)}</span>
        <span>${escapeHtml(slot.race)}</span>
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
    <div class="result-winner" data-result-winner>Winner: ${escapeHtml(result.winner ?? "Draw")}</div>
    <div class="result-head">
      <span>Player</span><span>Ctrl</span><span>Team</span><span>Race</span><span>K/L</span><span>Gold</span><span>Bldg</span>
    </div>
    <div class="result-list">${rows.join("")}</div>
    <div class="menu-actions">
      <button type="button" data-rematch>Rematch</button>
      <button type="button" data-return-home>Home</button>
    </div>
  `;
  const completedRoom = currentRoom;
  panel.querySelector("[data-rematch]")?.addEventListener("click", () => void createReplayRoom(completedRoom));
  panel.querySelector("[data-return-home]")?.addEventListener("click", returnHome);
  mapList.replaceChildren(panel);
}

async function createLocalRoom() {
  await createConfiguredRoom({ name: `${localUser.name}'s Room`, mapId: selectedMapId, humanCount: 1, aiCount: 1, visibility: "private" });
}

async function createConfiguredRoom(input: { name: string; mapId: MapId; humanCount: number; aiCount: number; visibility: "private" | "public" }) {
  currentRoom = await deploymentRuntime.createRoom({
    id: `room-${Date.now().toString(36)}`,
    host: localUser,
    ...input,
  });
  localPlayerId = slotForUser(currentRoom, localUser.id)?.playerId ?? "player";
  menuView = "setup";
  renderMainMenu();
}

async function selectRoomMap(mapId: MapId) {
  selectedMapId = mapId;
  pendingRoomMapScrollTop = document.querySelector<HTMLDivElement>(".room-map-grid")?.scrollTop;
  if (currentRoom) currentRoom = await deploymentRuntime.updateRoomMap(currentRoom.id, mapId);
  renderMainMenu();
}

async function startCurrentRoom() {
  if (!currentRoom) return;
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

async function createReplayRoom(room: RoomState) {
  selectedMapId = room.mapId;
  await createLocalRoom();
}

function menuButton(label: string, note: string, dataName: string, onClick: () => void, dataValue = "true") {
  const button = document.createElement("button");
  button.className = "map-button";
  button.type = "button";
  button.setAttribute(dataName, dataValue);
  button.innerHTML = `
    <span class="map-button-name">${escapeHtml(label)}</span>
    <span class="map-button-note">${escapeHtml(note)}</span>
  `;
  button.addEventListener("click", onClick);
  return button;
}

function mapChoiceButton(mapId: MapId) {
  const scenario = MAP_SCENARIOS.find((candidate) => candidate.id === mapId)!;
  const button = document.createElement("button");
  button.className = `map-button ${selectedMapId === scenario.id ? "selected" : ""}`;
  button.type = "button";
  button.dataset.mapId = scenario.id;
  button.setAttribute("aria-label", `Choose ${scenario.name}`);
  button.innerHTML = `
    <span class="map-button-name">${escapeHtml(scenario.name)}</span>
    <span class="map-button-note">${escapeHtml(scenario.note)}</span>
    <span class="map-button-tags">${[mapCapacityLabel(scenario.id), ...scenario.tags].map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</span>
  `;
  button.addEventListener("click", () => void selectRoomMap(scenario.id));
  return button;
}

function slotRow(slot: RoomState["slots"][number], index: number) {
  const row = document.createElement("div");
  row.className = "slot-row";
  row.dataset.slotId = slot.id;
  const controllerOptions = ["ai", "open", "closed"]
    .map((controller) => `<option value="${controller}" ${slot.controller === controller ? "selected" : ""}>${controller}</option>`)
    .join("");
  const raceOptions = RACE_IDS.map((race) => `<option value="${race}" ${slot.race === race ? "selected" : ""}>${race}</option>`).join("");
  row.innerHTML = `
    <span class="slot-index">${index + 1}</span>
    <span class="slot-name">${escapeHtml(slot.name)}</span>
    ${
      slot.controller === "human"
        ? `<span class="slot-controller-badge" data-slot-controller-status>human</span>`
        : `<select data-slot-controller aria-label="Slot controller">${controllerOptions}</select>`
    }
    <select data-slot-team aria-label="Slot team">
      ${["north", "south", "east", "west"].map((team) => `<option value="${team}" ${slot.team === team ? "selected" : ""}>${team}</option>`).join("")}
    </select>
    <select data-slot-race aria-label="Slot race">${raceOptions}</select>
    <label class="slot-ready"><input data-slot-ready type="checkbox" ${slot.ready ? "checked" : ""} ${slot.controller !== "human" ? "disabled" : ""} /> ready</label>
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

async function updateCurrentRoomSlotCounts(humanCount: number, aiCount: number) {
  if (!currentRoom) return;
  if (!Number.isInteger(humanCount) || !Number.isInteger(aiCount) || humanCount < 1 || aiCount < 0 || humanCount + aiCount < 2 || humanCount + aiCount > MAX_ROOM_SLOTS) return;
  currentRoom = await deploymentRuntime.updateRoomSlotCounts(currentRoom.id, humanCount, aiCount);
  renderMainMenu();
}

async function addPlayerRoomSlot() {
  if (!currentRoom || currentRoom.slots.length >= MAX_ROOM_SLOTS) return;
  await updateCurrentRoomSlotCounts(humanSeatCount(currentRoom) + 1, aiSeatCount(currentRoom));
}

async function addAiRoomSlot() {
  if (!currentRoom || currentRoom.slots.length >= MAX_ROOM_SLOTS) return;
  await updateCurrentRoomSlotCounts(humanSeatCount(currentRoom), aiSeatCount(currentRoom) + 1);
}

async function removeLastRoomSlot() {
  if (!currentRoom || !canRemoveLastRoomSlot(currentRoom)) return;
  const last = currentRoom.slots.at(-1);
  if (!last) return;
  if (last.controller === "ai") {
    await updateCurrentRoomSlotCounts(humanSeatCount(currentRoom), aiSeatCount(currentRoom) - 1);
    return;
  }
  if (last.controller === "closed") {
    await updateCurrentRoomSlotCounts(humanSeatCount(currentRoom), aiSeatCount(currentRoom));
    return;
  }
  await updateCurrentRoomSlotCounts(humanSeatCount(currentRoom) - 1, aiSeatCount(currentRoom));
}

function canRemoveLastRoomSlot(room: RoomState) {
  const last = room.slots.at(-1);
  if (!last || room.slots.length <= 2 || last.controller === "human") return false;
  if (last.controller === "ai") return aiSeatCount(room) > 0;
  if (last.controller === "closed") return humanSeatCount(room) + aiSeatCount(room) >= 2;
  return humanSeatCount(room) > 1;
}

async function closeCurrentRoom() {
  if (!currentRoom) return;
  await deploymentRuntime.closeRoom(currentRoom.id, localUser.id);
  disconnectActiveMatch();
  currentRoom = undefined;
  currentRoomId = undefined;
  syncDebugView();
  syncMatchActions();
  selectedIds = new Set();
  focusedSelectionId = undefined;
  selectedCampId = undefined;
  menuView = "rooms";
  renderMainMenu();
}

function activeSlotCount(room: RoomState) {
  return room.slots.filter((slot) => slot.controller === "human" || slot.controller === "ai").length;
}

function humanSeatCount(room: RoomState) {
  return room.slots.filter((slot) => slot.controller === "human" || slot.controller === "open").length;
}

function aiSeatCount(room: RoomState) {
  return room.slots.filter((slot) => slot.controller === "ai").length;
}

function slotSummaryText(room: RoomState) {
  const tally = room.slots.reduce(
    (counts, slot) => ({ ...counts, [slot.controller]: counts[slot.controller] + 1 }),
    { human: 0, ai: 0, open: 0, closed: 0 },
  );
  const openText = tally.open > 0 ? ` · ${tally.open} open` : "";
  const closedText = tally.closed > 0 ? ` · ${tally.closed} closed` : "";
  return `${room.slots.length}/${MAX_ROOM_SLOTS} · ${tally.human} claimed · ${tally.ai} AI${openText}${closedText}`;
}

function roomBrowserNote(room: RoomState, action: "join" | "rejoin" | "watch" = slotForUser(room, localUser.id) ? "rejoin" : "join") {
  const ownedSlot = slotForUser(room, localUser.id);
  const access = ownedSlot ? `you are ${ownedSlot.playerId}` : action === "watch" ? "watch live" : room.status === "open" ? "open" : "already started";
  return `${room.mapId} · ${room.status} · ${activeSlotCount(room)} active · ${access}`;
}

function emptyRoomList() {
  const empty = document.createElement("div");
  empty.className = "empty-room-list";
  empty.textContent = "No visible rooms.";
  return empty;
}

function mapCapacityLabel(mapId: MapId) {
  return mapId === "grandThirty" ? "up to 30" : "2-30 configurable";
}

function slotForUser(room: RoomState, userId: string) {
  return room.slots.find((slot) => slot.userId === userId);
}

function returnHome() {
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
  buildPaletteOpen = false;
  menuView = "home";
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
    menuView = "setup";
    renderMainMenu();
  } catch (error) {
    menuStatus.innerHTML = `<span class="error">Could not enter room: ${escapeHtml(error instanceof Error ? error.message : String(error))}</span>`;
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
  currentRoom = room;
  if (room.status === "ended" && room.result) openResults(room);
}

function syncActiveGameAdapterSnapshot() {
  if (menuOpen) return;
  const view = syncFrontendWorldView(activeGameAdapter, { owner: localPlayerId, snapshot, selectedIds, focusedSelectionId, selectedCampId, controlGroups });
  if (!view.snapshot) return;
  snapshot = view.snapshot;
  selectedIds = view.selectedIds;
  focusedSelectionId = view.focusedSelectionId;
  selectedCampId = view.selectedCampId;
  syncDebugView();
  pruneSelection();
  updateHud();
}

function openResults(room: RoomState) {
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
  buildPaletteOpen = false;
  menuOpen = true;
  shell.classList.add("menu-open");
  mainMenu.classList.remove("hidden");
  menuView = "results";
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
  pointerLockGateTitle.textContent = kind === "guide" ? "Before you play" : pointerLockRequiredTitle();
  pointerLockGateBody.innerHTML =
    kind === "guide"
      ? [
          "Sketch RTS playtest build. Credit: shuxueshuxue.",
          "Mouse lock keeps camera movement and right-click commands inside the battlefield. Press Escape any time to release it.",
          edge ? "Microsoft Edge users: turn off <strong>Enable Mouse Gesture</strong> in <code>edge://settings/appearance</code> before playing." : "",
        ]
          .filter(Boolean)
          .join("<br>")
      : pointerLockRequiredBody();
  pointerLockGateAction.textContent = kind === "guide" ? (edge ? "I turned it off, lock mouse" : "Lock mouse to play") : "Continue";
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
    statusLabel.textContent = "Browser needs one battlefield click to capture the mouse.";
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
    statusLabel.textContent = "Mouse locked. Move normally; Escape releases the cursor.";
    return;
  }
  virtualMouse = undefined;
  syncPointerLockGate();
}

function handlePointerLockError(fieldClickOnError: boolean, error?: unknown) {
  if (fieldClickOnError) {
    pointerLockArmed = true;
    hidePointerLockGate();
    statusLabel.textContent = "Browser needs one battlefield click to capture the mouse.";
    return;
  }
  pointerLockArmed = false;
  pointerLockUnavailable = true;
  hidePointerLockGate();
  const message = error instanceof Error ? `Pointer lock unavailable: ${error.message}` : "Pointer lock unavailable. Battlefield clicks still work.";
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
    const mapIndex = Number(key) - 1;
    const scenario = MAP_SCENARIOS[mapIndex];
    if (scenario && menuView === "setup") {
      event.preventDefault();
      void selectRoomMap(scenario.id);
    }
    return;
  }
  if (event.repeat) return;
  if (key === "escape" && commandMode) {
    event.preventDefault();
    cancelCommandMode();
    return;
  }
  if (key === "escape" && buildPaletteOpen) {
    event.preventDefault();
    closeBuildPalette("Build menu closed.");
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
    showInvalidCommand("Attack-move needs selected units.");
    return;
  }
  if (key === "b") {
    event.preventDefault();
    showInvalidCommand("Build needs a selected worker.");
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
    else if (event.button === 0 && commandMode.type === "spell") issueSpellAt(point);
    else if (event.button === 0 && commandMode.type === "item") issueItemAt(point);
    else if (event.button === 2) cancelCommandMode();
    selectionStart = undefined;
    selectionEnd = undefined;
    return;
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
    showInvalidCommand("Select a unit before issuing orders.");
    return;
  }

  const resource = hitResource(world);
  const item = hitGroundItem(world);
  const target = hitAttackTarget(world);
  const repairTarget = hitBuilding(world, (building) => building.owner === localPlayerId && building.hp < building.maxHp);
  if (item) {
    const command = pickupItemCommand(focusedPlayerUnits(), item);
    if (!command) {
      showInvalidCommand("Focus a unit before picking up items.");
      return;
    }
    sendCommand({ type: "pickupItem", unitId: command.unitId, itemId: command.itemId, queued });
    statusLabel.textContent = `${itemLabel(item.kind)} pickup ordered.`;
    return;
  }
  if (resource && selectedUnits.some((unit) => unit.kind === "worker")) {
    sendCommand({ type: "mine", unitIds: selectedUnits.filter((unit) => unit.kind === "worker").map((unit) => unit.id), resourceId: resource.id, queued });
    statusLabel.textContent = "Workers ordered to mine gold.";
    return;
  }
  if (repairTarget && selectedUnits.some((unit) => unit.kind === "worker")) {
    sendCommand({ type: "repair", unitIds: selectedUnits.filter((unit) => unit.kind === "worker").map((unit) => unit.id), buildingId: repairTarget.id, queued });
    statusLabel.textContent = `${labelBuilding(repairTarget)} repair ordered.`;
    return;
  }
  if (target) {
    sendCommand({ type: "attack", unitIds, targetId: target.id, queued });
    statusLabel.textContent = target.owner === "neutral" ? "Attack order issued on wildlings." : "Attack order issued.";
    return;
  }
  sendCommand({ type: "move", unitIds, x: world.x, y: world.y, queued });
  statusLabel.textContent = "Move order issued.";
}

function issueRallyCommandAtWorld(world: Point, buildings: Building[]) {
  if (!snapshot) return;
  const friendlyUnit = hitUnit(world, (unit) => unit.owner === localPlayerId);
  if (friendlyUnit) {
    sendCommand({ type: "setRally", buildingIds: buildings.map((building) => building.id), x: friendlyUnit.x, y: friendlyUnit.y, target: { type: "unit", unitId: friendlyUnit.id } });
    statusLabel.textContent = `${buildings.length > 1 ? "Rally points" : "Rally point"} set to follow ${labelAnyKind(friendlyUnit.kind)}.`;
    return;
  }
  const resource = hitResource(world);
  if (resource) {
    sendCommand({ type: "setRally", buildingIds: buildings.map((building) => building.id), x: resource.x, y: resource.y, target: { type: "resource", resourceId: resource.id } });
    statusLabel.textContent = `${buildings.length > 1 ? "Rally points" : "Rally point"} set to gold mine.`;
    return;
  }
  sendCommand({ type: "setRally", buildingIds: buildings.map((building) => building.id), x: world.x, y: world.y, target: { type: "point" } });
  statusLabel.textContent = `${buildings.length > 1 ? "Rally points" : "Rally point"} set.`;
}

function canAttackMove() {
  return !commandMode && !buildPaletteOpen && selectedPlayerUnits().length > 0;
}

function canOpenBuildPalette() {
  return !commandMode && !buildPaletteOpen && focusedPlayerUnits().some((unit) => unit.kind === "worker");
}

function canBuild(kind: BuildingKind) {
  return !commandMode && buildPaletteOpen && BUILDABLE_BUILDING_KINDS.includes(kind) && focusedPlayerUnits().some((unit) => unit.kind === "worker");
}

function canTrain(unitKind: TrainableUnitKind) {
  return !commandMode && !buildPaletteOpen && focusedPlayerBuildings().some((building) => building.complete && BUILDING_DEFS[building.kind].trains.includes(unitKind));
}

function canResearch(upgradeKind: UpgradeKind) {
  return !commandMode && !buildPaletteOpen && researchCommandButtonsForSelection(focusedPlayerBuildings(), currentPlayerState()).some((command) => command.upgradeKind === upgradeKind);
}

function canCast(ability: AbilityKind) {
  return !commandMode && !buildPaletteOpen && focusedPlayerUnits().some((unit) => UNIT_DEFS[unit.kind].abilities.includes(ability) && unit.cooldown <= 0);
}

function canHireMercenary() {
  const camp = selectedMercenaryCamp();
  const player = currentPlayerState();
  return Boolean(
    !commandMode &&
      !buildPaletteOpen &&
      camp &&
      player &&
      camp.stock > 0 &&
      camp.cooldownRemaining === 0 &&
      player.gold >= camp.cost &&
      player.supplyUsed + UNIT_DEFS[camp.hireKind].supplyUsed <= player.supplyCap &&
      friendlyUnitAtMercenaryCamp(camp),
  );
}

function openBuildPalette() {
  if (!canOpenBuildPalette()) {
    showInvalidCommand("Build needs a selected worker.");
    return;
  }
  buildPaletteOpen = true;
  statusLabel.textContent = "Build menu opened. Choose a structure hotkey or command button.";
  updateHud();
}

function beginAttackMoveMode() {
  if (!canAttackMove()) {
    showInvalidCommand("Attack-move needs selected units.");
    return;
  }
  commandMode = { type: "attackMove" };
  shell.classList.add("targeting-active");
  shell.classList.remove("placement-active");
  statusLabel.textContent = "Attack-move mode. Left-click ground to advance and fight, right-click or Escape to cancel.";
  updateHud();
}

function beginBuildPlacement(buildingKind: BuildingKind) {
  if (!snapshot) return;
  const worker = focusedPlayerUnits().find((unit) => unit.kind === "worker");
  if (!worker) {
    showInvalidCommand("Build needs a selected worker.");
    return;
  }
  buildPaletteOpen = false;
  commandMode = { type: "build", placement: { workerId: worker.id, buildingKind } };
  shell.classList.add("placement-active");
  shell.classList.remove("targeting-active");
  statusLabel.textContent = `Choose a ${labelKind(buildingKind)} location. Left-click to place, right-click or Escape to cancel.`;
  updateHud();
}

function beginSpellTargeting(ability: AbilityKind) {
  const caster = focusedPlayerUnits().find((unit) => UNIT_DEFS[unit.kind].abilities.includes(ability) && unit.cooldown <= 0);
  if (!caster) {
    showInvalidCommand(`${labelKind(ability)} needs a ready caster.`);
    return;
  }
  commandMode = { type: "spell", targeting: { casterId: caster.id, ability } };
  shell.classList.add("targeting-active");
  shell.classList.remove("placement-active");
  statusLabel.textContent =
    ability === "summon"
      ? "Summon mode. Left-click nearby ground, right-click or Escape to cancel."
      : `${labelKind(ability)} mode. Left-click a valid unit target, right-click or Escape to cancel.`;
  updateHud();
}

function confirmBuildPlacement(point: Point) {
  if (!commandMode || commandMode.type !== "build" || !snapshot) return;
  const world = screenToWorld(point);
  const result = buildPlacementCommand(snapshot, commandMode.placement, world);
  if ("error" in result) {
    showInvalidCommand(result.error);
    return;
  }
  sendCommand(result.command);
  statusLabel.textContent = `${labelKind(commandMode.placement.buildingKind)} foundation placed.`;
  clearCommandModeClasses();
  commandMode = undefined;
  updateHud();
}

function issueAttackMoveAt(point: Point, queued = false) {
  if (!commandMode || commandMode.type !== "attackMove") return;
  const unitIds = selectedPlayerUnits().map((unit) => unit.id);
  if (unitIds.length === 0) {
    showInvalidCommand("Attack-move needs selected units.");
    clearCommandModeClasses();
    commandMode = undefined;
    updateHud();
    return;
  }
  const world = screenToWorld(point);
  sendCommand({ type: "attackMove", unitIds, x: world.x, y: world.y, queued });
  statusLabel.textContent = "Attack-move order issued.";
  clearCommandModeClasses();
  commandMode = undefined;
  updateHud();
}

function issueSpellAt(point: Point) {
  if (!commandMode || commandMode.type !== "spell") return;
  const { ability, casterId } = commandMode.targeting;
  const world = screenToWorld(point);
  if (ability === "summon") {
    sendCommand({ type: "cast", unitId: casterId, ability, x: world.x, y: world.y });
    statusLabel.textContent = "Summon order issued.";
    clearCommandModeClasses();
    commandMode = undefined;
    updateHud();
    return;
  }

  const target =
    ability === "heal"
      ? hitUnit(world, (unit) => unit.owner === localPlayerId)
      : hitUnit(world, (unit) => unit.owner !== localPlayerId);
  if (!target) {
    showInvalidCommand(`${labelKind(ability)} needs a valid unit target.`);
    return;
  }
  sendCommand({ type: "cast", unitId: casterId, ability, targetId: target.id });
  statusLabel.textContent = `${labelKind(ability)} order issued.`;
  clearCommandModeClasses();
  commandMode = undefined;
  updateHud();
}

function beginItemTargeting(entry: { item: WorldItem; carrier: Unit }) {
  commandMode = { type: "item", targeting: { unitId: entry.carrier.id, itemId: entry.item.id, kind: entry.item.kind } };
  shell.classList.add("targeting-active");
  shell.classList.remove("placement-active");
  statusLabel.textContent =
    entry.item.kind === "stormStaff"
      ? `${itemLabel(entry.item.kind)} mode. Left-click a target point or unit, right-click or Escape to cancel.`
      : `${itemLabel(entry.item.kind)} mode. Left-click a valid target, right-click or Escape to cancel.`;
  updateHud();
}

function issueItemAt(point: Point) {
  if (!commandMode || commandMode.type !== "item" || !snapshot) return;
  const { kind, itemId, unitId } = commandMode.targeting;
  const world = screenToWorld(point);
  if (kind === "stormStaff") {
    const target = hitUnit(world, (unit) => unit.owner !== localPlayerId);
    sendCommand(target ? { type: "useItem", unitId, itemId, x: target.x, y: target.y } : { type: "useItem", unitId, itemId, x: world.x, y: world.y });
    statusLabel.textContent = `${itemLabel(kind)} used.`;
    clearCommandModeClasses();
    commandMode = undefined;
    updateHud();
    return;
  }
  if (kind === "lightningRod") {
    const target = hitUnit(world, (unit) => unit.owner !== localPlayerId);
    if (!target) {
      showInvalidCommand(`${itemLabel(kind)} needs an enemy unit target.`);
      return;
    }
    sendCommand({ type: "useItem", unitId, itemId, targetId: target.id });
    statusLabel.textContent = `${itemLabel(kind)} used.`;
    clearCommandModeClasses();
    commandMode = undefined;
    updateHud();
    return;
  }
  if (kind === "breachCharge") {
    const target = hitBuilding(world, (building) => building.owner !== localPlayerId);
    if (!target) {
      showInvalidCommand(`${itemLabel(kind)} needs an enemy building target.`);
      return;
    }
    sendCommand({ type: "useItem", unitId, itemId, targetId: target.id });
    statusLabel.textContent = `${itemLabel(kind)} used.`;
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
      ? "Attack-move canceled."
      : canceled === "spell"
        ? "Spell targeting canceled."
        : canceled === "item"
          ? "Item targeting canceled."
          : "Build placement canceled.";
  updateHud();
}

function clearCommandModeClasses() {
  shell.classList.remove("placement-active", "targeting-active");
}

function closeBuildPalette(message?: string) {
  buildPaletteOpen = false;
  if (message) statusLabel.textContent = message;
  updateHud();
}

function train(unitKind: TrainableUnitKind) {
  const building = focusedPlayerBuildings().find((candidate) => candidate.complete && BUILDING_DEFS[candidate.kind].trains.includes(unitKind));
  if (!building) {
    showInvalidCommand(`${labelKind(unitKind)} needs a selected production building.`);
    return;
  }
  sendCommand({ type: "train", buildingId: building.id, unitKind });
  statusLabel.textContent = `${labelKind(unitKind)} queued.`;
}

function research(upgradeKind: UpgradeKind) {
  const command = researchCommandButtonsForSelection(focusedPlayerBuildings(), currentPlayerState()).find((candidate) => candidate.upgradeKind === upgradeKind);
  if (!command) {
    showInvalidCommand(`${labelKind(upgradeKind)} needs a selected research building.`);
    return;
  }
  sendCommand({ type: "research", buildingId: command.buildingId, upgradeKind });
  statusLabel.textContent = `${command.label} started.`;
}

function hireMercenary() {
  const camp = selectedMercenaryCamp();
  if (!camp) {
    showInvalidCommand("Hire needs a selected mercenary camp.");
    return;
  }
  if (!canHireMercenary()) {
    showInvalidCommand("Move a unit to the mercenary camp before hiring.");
    return;
  }
  sendCommand({ type: "hire", campId: camp.id });
  statusLabel.textContent = "Mercenary hired.";
}

function selectUnitsInBox(start: Point, end: Point, additive = false) {
  if (!snapshot) return;
  const result = selectInScreenBox(snapshot, localPlayerId, selectionRect(start, end), worldToScreen, { selectedIds, focusedSelectionId }, additive);
  selectedIds = result.selectedIds;
  focusedSelectionId = result.focusedSelectionId;
  if (selectedIds.size > 0 || !additive) selectedCampId = undefined;
  if (selectedIds.size > 0 || !additive) buildPaletteOpen = false;
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
    buildPaletteOpen = false;
    return;
  }
  const building = hitBuilding(world, (candidate) => candidate.owner === localPlayerId);
  if (building) {
    const result = applySelectionPick({ selectedIds, focusedSelectionId }, [building.id], additive);
    selectedIds = result.selectedIds;
    focusedSelectionId = result.focusedSelectionId;
    selectedCampId = undefined;
    buildPaletteOpen = false;
    return;
  }
  if (additive) return;
  const camp = hitMercenaryCamp(world);
  selectedIds = new Set();
  focusedSelectionId = undefined;
  selectedCampId = camp?.id;
  buildPaletteOpen = false;
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
  if (buildPaletteOpen && !focusedPlayerUnits().some((unit) => unit.kind === "worker")) buildPaletteOpen = false;
}

function handleGameplayKeyIntent(event: KeyboardEvent) {
  if (!snapshot) return false;
  const inventoryEntries = carriedItemsForSelection(snapshot, focusedPlayerUnits()).slice(0, 6);
  const reservedGroupDigits = new Set(Object.keys(controlGroups).map(Number));
  const intent = gameplayKeyIntent(event, {
    controlGroups: reservedGroupDigits,
    inventorySlots: inventoryEntries.length,
    inventoryHotkeys: itemHotkeys(inventoryEntries.length, reservedGroupDigits).map(Number),
    commandHotkeys: new Set(commandButtons.filter((button) => button.isAvailable()).map((button) => button.hotkey)),
  });
  if (intent.type === "none") return false;
  if (intent.type === "inventoryUse") return useInventoryItem(intent.index);
  if (intent.type === "commandHotkey") {
    const command = commandButtons.find((button) => button.hotkey === intent.hotkey && button.isAvailable());
    command?.run();
    return Boolean(command);
  }
  if (intent.type === "controlGroupReplace") {
    if (selectedIds.size === 0) {
      showInvalidCommand(`Group ${intent.slot} needs a selection.`);
      return true;
    }
    replaceControlGroup(controlGroups, intent.slot, selectedIds);
    lastControlGroupRecall = undefined;
    statusLabel.textContent = `Group ${intent.slot} set.`;
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
    showInvalidCommand(`Group ${slot} is empty.`);
    return;
  }
  const recallTap = controlGroupRecallTap(lastControlGroupRecall, slot, performance.now());
  lastControlGroupRecall = recallTap.nextTap;
  selectedIds = new Set(ids);
  focusedSelectionId = resolveFocusedSelectionId(snapshot, selectedIds, focusedSelectionId, localPlayerId);
  selectedCampId = undefined;
  buildPaletteOpen = false;
  statusLabel.textContent = `Group ${slot} selected.`;
  if (recallTap.shouldCenterCamera) centerCameraOnControlGroup(ids);
  updateHud();
}

function cycleFocusedSelection(direction: 1 | -1) {
  if (!snapshot || selectedIds.size === 0) return;
  const nextFocus = cycleFocusedSelectionId(snapshot, selectedIds, focusedSelectionId, localPlayerId, direction);
  if (!nextFocus || nextFocus === focusedSelectionId) return;
  focusedSelectionId = nextFocus;
  buildPaletteOpen = false;
  updateHud();
}

function updateHud() {
  if (!snapshot) return;
  const player = currentPlayerState();
  goldLabel.textContent = String(player?.gold ?? "?");
  supplyLabel.textContent = player ? `${player.supplyUsed}/${player.supplyCap}` : "?";
  mapReadout.textContent = `Map: ${snapshot.map.width} x ${snapshot.map.height}`;
  const focusedBuildings = focusedPlayerBuildings();
  const camp = selectedMercenaryCamp();
  const groups = buildSelectionGroups(snapshot, selectedIds, focusedSelectionId, localPlayerId);
  if (groups.length > 0) {
    renderSelectionGroups(groups);
  } else if (camp) {
    selectionLabel.textContent = `Mercenary Camp - ${camp.stock} stock${camp.cooldownRemaining > 0 ? " restocking" : ""}`;
  } else {
    selectionLabel.textContent = "Nothing selected";
  }
  let visibleCount = 0;
  for (const button of commandButtons) {
    const available = button.isAvailable();
    button.element.hidden = !available;
    button.element.disabled = !available;
    applyTooltip(button.element, button.tooltip());
    if (available) visibleCount += 1;
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
        buildPaletteOpen = false;
        updateHud();
      });
      drawSelectionModel(canvas, group);
      return button;
    }),
  );
}

function selectionGroupTitle(group: SelectionGroup) {
  const label = labelAnyKind(group.kind);
  return `${label} x${group.count}${group.focused ? " - current" : ""}`;
}

function drawSelectionModel(canvas: HTMLCanvasElement, group: SelectionGroup) {
  const mini = requireCanvasContext(canvas);
  mini.clearRect(0, 0, canvas.width, canvas.height);
  mini.save();
  mini.translate(canvas.width / 2, canvas.height / 2 + 1);
  mini.scale(group.entityType === "building" ? 0.42 : 0.54, group.entityType === "building" ? 0.42 : 0.54);
  mini.lineCap = "round";
  mini.lineJoin = "round";
  mini.strokeStyle = group.focused ? "#315f87" : "rgba(36, 49, 38, 0.62)";
  mini.fillStyle = group.focused ? "#fffbe7" : "rgba(255, 250, 226, 0.66)";
  mini.lineWidth = group.focused ? 3.4 : 2.4;
  if (group.entityType === "unit") drawMiniUnitModel(mini, UNIT_GLYPHS[group.kind]);
  else drawMiniBuildingModel(mini, BUILDING_GLYPHS[group.kind]);
  mini.restore();
}

function drawMiniUnitModel(mini: CanvasRenderingContext2D, glyph: UnitGlyph) {
  mini.beginPath();
  if (glyph.silhouette === "worker-apron") {
    mini.moveTo(-11, -15);
    mini.lineTo(9, -13);
    mini.lineTo(16, 14);
    mini.lineTo(-13, 16);
    mini.lineTo(-17, -5);
  } else if (glyph.silhouette === "shield-triangle") {
    mini.moveTo(0, -20);
    mini.lineTo(17, 15);
    mini.lineTo(-17, 15);
  } else if (glyph.silhouette === "bow-crest") {
    mini.moveTo(-14, -16);
    mini.quadraticCurveTo(18, -18, 14, 15);
    mini.quadraticCurveTo(-10, 20, -16, -4);
  } else if (glyph.silhouette === "raider-kite") {
    mini.moveTo(0, -20);
    mini.lineTo(18, -2);
    mini.lineTo(7, 19);
    mini.lineTo(-15, 10);
    mini.lineTo(-18, -7);
  } else if (glyph.silhouette === "lancer-pennant") {
    mini.moveTo(-15, -14);
    mini.lineTo(17, -9);
    mini.lineTo(8, 16);
    mini.lineTo(-18, 13);
  } else if (glyph.silhouette === "knight-helm") {
    mini.arc(0, -2, 17, Math.PI * 0.95, Math.PI * 2.05);
    mini.lineTo(15, 17);
    mini.lineTo(-15, 17);
  } else if (glyph.silhouette === "priest-medallion") {
    mini.arc(0, 0, 14, 0, Math.PI * 2);
  } else if (glyph.silhouette === "summoner-ring") {
    mini.ellipse(0, 0, 17, 13, 0.2, 0, Math.PI * 2);
  } else if (glyph.silhouette === "witch-crescent") {
    mini.arc(4, 0, 17, Math.PI * 0.52, Math.PI * 1.58);
    mini.quadraticCurveTo(-15, 0, 4, -17);
  } else if (glyph.silhouette === "golem-block") {
    mini.rect(-17, -17, 34, 34);
  } else if (glyph.silhouette === "spirit-wisp") {
    mini.moveTo(0, -18);
    mini.quadraticCurveTo(18, -4, 4, 18);
    mini.quadraticCurveTo(-18, 4, 0, -18);
  } else if (glyph.silhouette === "mercenary-badge") {
    mini.moveTo(0, -19);
    mini.lineTo(16, -3);
    mini.lineTo(8, 18);
    mini.lineTo(-12, 14);
    mini.lineTo(-16, -6);
  } else {
    mini.moveTo(-15, -15);
    mini.lineTo(15, 15);
    mini.moveTo(15, -15);
    mini.lineTo(-15, 15);
  }
  mini.closePath();
  mini.fill();
  mini.stroke();
}

function drawMiniBuildingModel(mini: CanvasRenderingContext2D, glyph: BuildingGlyph) {
  mini.beginPath();
  if (glyph.frame === "town-hall") {
    mini.moveTo(-26, -2);
    mini.lineTo(0, -24);
    mini.lineTo(26, -2);
    mini.lineTo(21, 24);
    mini.lineTo(-21, 24);
  } else if (glyph.frame === "tower-spire") {
    mini.moveTo(0, -27);
    mini.lineTo(16, -7);
    mini.lineTo(12, 25);
    mini.lineTo(-12, 25);
    mini.lineTo(-16, -7);
  } else if (glyph.frame === "moon-well") {
    mini.ellipse(0, 6, 22, 13, 0, 0, Math.PI * 2);
    mini.moveTo(-18, 2);
    mini.quadraticCurveTo(0, -24, 18, 2);
  } else if (glyph.frame === "workshop-gear") {
    for (let i = 0; i < 12; i += 1) {
      const angle = (i / 12) * Math.PI * 2;
      const radius = i % 2 === 0 ? 25 : 18;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (i === 0) mini.moveTo(x, y);
      else mini.lineTo(x, y);
    }
  } else {
    mini.rect(-24, -17, 48, 36);
    mini.moveTo(-20, 19);
    mini.lineTo(20, 19);
  }
  mini.closePath();
  mini.fill();
  mini.stroke();
}

function renderResearchProgressButton(progress: ResearchProgressButton) {
  const percent = Math.floor(progress.progress * 100);
  const label = `${progress.status === "researching" ? "Researching" : "Queued"} ${progress.label} ${romanLevel(progress.targetLevel)}`;
  const button = document.createElement("button");
  button.type = "button";
  button.tabIndex = -1;
  button.className = "command-button research-progress-button";
  button.setAttribute("aria-disabled", "true");
  button.dataset.researchProgress = progress.upgradeKind;
  button.dataset.commandLabel = label;
  button.setAttribute("aria-label", `${label} - ${percent}%`);
  const tooltip = upgradeTooltip(progress.upgradeKind, undefined, progress.targetLevel - 1);
  applyTooltip(button, {
    ...tooltip,
    title: label,
    stats: [`${percent}% complete`, ...tooltip.stats],
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
  const label = `${progress.status === "training" ? "Training" : "Queued"} ${labelKind(progress.unitKind)}`;
  const button = document.createElement("button");
  button.type = "button";
  button.tabIndex = -1;
  button.className = "command-button research-progress-button";
  button.setAttribute("aria-disabled", "true");
  button.dataset.trainingProgress = progress.unitKind;
  button.dataset.commandLabel = label;
  button.setAttribute("aria-label", `${label} - ${percent}%`);
  const tooltip = unitTooltip(progress.unitKind);
  applyTooltip(button, {
    ...tooltip,
    title: label,
    stats: [`${percent}% complete`, ...tooltip.stats],
  });
  button.style.setProperty("--research-progress", `${progress.status === "training" ? Math.max(6, percent) : percent}%`);
  button.innerHTML = `
    <span class="research-progress-fill"></span>
    <span class="command-icon">${escapeHtml(trainIcon(progress.unitKind))}</span>
    <span class="research-progress-text">${progress.status === "training" ? percent : "Q"}</span>
  `;
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
      const cooldownText = item.cooldownRemaining > 0 ? ` - recharging ${item.cooldownRemaining}` : "";
      button.setAttribute("aria-label", `${itemLabel(item.kind)} (${hotkey})${cooldownText}`);
      applyTooltip(button, itemTooltip(item.kind, hotkey));
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
  if (!snapshot) return false;
  const entry = carriedItemsForSelection(snapshot, focusedPlayerUnits())[index];
  if (!entry) return false;
  useCarriedItem(entry.item.id);
  return true;
}

function useCarriedItem(itemId: string) {
  if (!snapshot) return;
  const entry = carriedItemsForSelection(snapshot, focusedPlayerUnits()).find(({ item }) => item.id === itemId);
  if (!entry) return;
  if (entry.item.kind === "flameCloak") {
    showInvalidCommand("Flame Cloak is passive.");
    return;
  }
  if (entry.item.cooldownRemaining > 0) {
    showInvalidCommand(`${itemLabel(entry.item.kind)} is recharging.`);
    return;
  }
  if (entry.item.kind === "lightningRod" || entry.item.kind === "stormStaff" || entry.item.kind === "breachCharge") {
    beginItemTargeting(entry);
    return;
  }
  const command = useItemCommand(snapshot, localPlayerId, entry.item, entry.carrier);
  if (!command) {
    showInvalidCommand(`${itemLabel(entry.item.kind)} has no valid target.`);
    return;
  }
  sendCommand(command);
  statusLabel.textContent = `${itemLabel(entry.item.kind)} used.`;
}

function dropCarriedItem(itemId: string, carrierId: string) {
  if (!snapshot) return;
  const entry = carriedItemsForSelection(snapshot, focusedPlayerUnits()).find(({ item, carrier }) => item.id === itemId && carrier.id === carrierId);
  if (!entry) return;
  sendCommand(dropItemCommand(entry.item, entry.carrier));
  statusLabel.textContent = `${itemLabel(entry.item.kind)} dropped.`;
}

function itemIcon(kind: WorldItem["kind"]) {
  return kind === "lightningRod" ? "↯" : kind === "stormStaff" ? "☈" : kind === "flameCloak" ? "♨" : kind === "guardianScroll" ? "▤" : "✦";
}

function trainIcon(kind: TrainableUnitKind) {
  return TRAIN_COMMANDS.find((command) => command.kind === kind)?.icon ?? "△";
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (menuOpen) {
    drawMenuBackdrop(performance.now());
    return;
  }
  drawPaperMap();
  if (!snapshot) {
    ctx.fillStyle = "#243126";
    ctx.font = "24px ui-rounded, system-ui";
    ctx.fillText("Connecting to Sketch RTS...", 32, 48);
    return;
  }
  const presentationMarks = createMapPresentation(snapshot);
  drawLandmarks(snapshot.map.landmarks);
  drawResources(snapshot.resources);
  drawMercenaryCamps(snapshot.mercenaryCamps);
  drawItems(snapshot.items);
  drawBuildings(snapshot.buildings);
  drawUnits(snapshot.units);
  drawCarriedItems(snapshot.items);
  drawEffects(snapshot.effects);
  drawBuildPlacementPreview();
  drawAttackMovePreview();
  drawSpellPreview();
  drawSelectionBox();
  drawMinimap(presentationMarks);
}

function drawMenuBackdrop(now: number) {
  ctx.fillStyle = "#f6f1d8";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const t = now / 1000;
  const stride = 170;
  ctx.lineWidth = 1;
  for (let x = -80; x < canvas.width + stride; x += stride) {
    for (let y = -60; y < canvas.height + stride; y += stride) {
      const wave = Math.sin(t * 0.45 + x * 0.009 + y * 0.007);
      ctx.strokeStyle = `rgba(62, 91, 57, ${0.08 + Math.max(0, wave) * 0.06})`;
      ctx.beginPath();
      ctx.moveTo(x + 12, y + 72 + wave * 8);
      ctx.quadraticCurveTo(x + 58, y + 38, x + 112, y + 82 - wave * 7);
      ctx.stroke();
      ctx.strokeStyle = "rgba(123, 101, 66, 0.12)";
      ctx.beginPath();
      ctx.moveTo(x + 104, y + 112);
      ctx.lineTo(x + 134, y + 96 + wave * 6);
      ctx.lineTo(x + 158, y + 116);
      ctx.stroke();
    }
  }

  drawMenuRoute(t, canvas.width * 0.12, canvas.height * 0.72, canvas.width * 0.88, canvas.height * 0.28);
  drawMenuMine(canvas.width * 0.28, canvas.height * 0.28, t);
  drawMenuCamp(canvas.width * 0.72, canvas.height * 0.68, t);
  drawMenuSquad(canvas.width * 0.18 + ((t * 34) % (canvas.width * 0.64)), canvas.height * 0.7 - Math.sin(t * 1.3) * 18, "#315f87", t);
  drawMenuSquad(canvas.width * 0.82 - ((t * 28) % (canvas.width * 0.58)), canvas.height * 0.32 + Math.sin(t * 1.1) * 16, "#963c36", t + 1.7);

  ctx.strokeStyle = "rgba(36, 49, 38, 0.18)";
  ctx.lineWidth = 2;
  ctx.strokeRect(18, 18, canvas.width - 36, canvas.height - 36);
}

function drawMenuRoute(t: number, x1: number, y1: number, x2: number, y2: number) {
  ctx.save();
  ctx.strokeStyle = "rgba(78, 67, 48, 0.28)";
  ctx.lineWidth = 3;
  ctx.setLineDash([22, 16]);
  ctx.lineDashOffset = -t * 16;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.bezierCurveTo(canvas.width * 0.42, canvas.height * 0.58, canvas.width * 0.56, canvas.height * 0.42, x2, y2);
  ctx.stroke();
  ctx.restore();
}

function drawMenuMine(x: number, y: number, t: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.sin(t * 0.7) * 0.03);
  ctx.strokeStyle = "#8a6418";
  ctx.fillStyle = "rgba(242, 208, 92, 0.34)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-36, 26);
  ctx.lineTo(-18, -22);
  ctx.lineTo(8, 18);
  ctx.lineTo(30, -28);
  ctx.lineTo(44, 24);
  ctx.stroke();
  ctx.restore();
}

function drawMenuCamp(x: number, y: number, t: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = "#704a33";
  ctx.fillStyle = "rgba(255, 250, 226, 0.5)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(0, 6, 62 + Math.sin(t * 1.1) * 3, 28, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-34, 24);
  ctx.lineTo(0, -44);
  ctx.lineTo(34, 24);
  ctx.moveTo(-18, 24);
  ctx.lineTo(-18, -10);
  ctx.moveTo(18, 24);
  ctx.lineTo(18, -10);
  ctx.stroke();
  ctx.restore();
}

function drawMenuSquad(x: number, y: number, color: string, t: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color;
  ctx.fillStyle = "rgba(255, 250, 226, 0.68)";
  ctx.lineWidth = 2.5;
  for (let i = 0; i < 5; i += 1) {
    const ox = (i - 2) * 24;
    const oy = Math.sin(t * 4 + i) * 5;
    ctx.beginPath();
    ctx.ellipse(ox, oy + 16, 13, 6, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ox, oy - 16);
    ctx.lineTo(ox + 12, oy + 12);
    ctx.lineTo(ox - 12, oy + 12);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ox + 10, oy - 4);
    ctx.lineTo(ox + 24, oy - 14 + Math.sin(t * 5 + i) * 3);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPaperMap() {
  ctx.fillStyle = "#f6f1d8";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const stroke of generateTerrainLinework({ mapId: snapshot?.map.id ?? selectedMapId, camera, width: canvas.width, height: canvas.height })) {
    drawTextureStroke(stroke);
  }
}

function drawTextureStroke(stroke: TextureStroke) {
  if (stroke.points.length === 0) return;
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.width;
  ctx.beginPath();
  ctx.moveTo(stroke.points[0]!.x, stroke.points[0]!.y);
  for (const point of stroke.points.slice(1)) ctx.lineTo(point.x, point.y);
  ctx.stroke();
}

function drawLandmarks(landmarks: TerrainLandmark[]) {
  for (const landmark of landmarks) {
    const point = worldToScreen(landmark);
    if (!nearScreen(point, landmark.size + 80)) continue;
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.rotate(landmark.rotation);
    ctx.lineWidth = 2;
    if (landmark.kind === "road") {
      ctx.strokeStyle = "rgba(123, 101, 66, 0.28)";
      ctx.setLineDash([18, 14]);
      ctx.beginPath();
      ctx.moveTo(-landmark.size / 2, 0);
      ctx.quadraticCurveTo(0, -landmark.size / 8, landmark.size / 2, 0);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (landmark.kind === "grove") {
      ctx.strokeStyle = "rgba(64, 108, 66, 0.34)";
      for (let i = 0; i < 9; i += 1) {
        const angle = (i / 9) * Math.PI * 2;
        const x = Math.cos(angle) * landmark.size * 0.28;
        const y = Math.sin(angle) * landmark.size * 0.18;
        ctx.beginPath();
        ctx.arc(x, y, 16 + (i % 3) * 4, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (landmark.kind === "ridge") {
      ctx.strokeStyle = "rgba(84, 90, 68, 0.36)";
      for (let i = -2; i <= 2; i += 1) {
        ctx.beginPath();
        ctx.moveTo(-landmark.size / 2, i * 18);
        ctx.lineTo(-landmark.size / 4, i * 18 - 18);
        ctx.lineTo(0, i * 18 + 10);
        ctx.lineTo(landmark.size / 3, i * 18 - 14);
        ctx.lineTo(landmark.size / 2, i * 18 + 8);
        ctx.stroke();
      }
    } else if (landmark.kind === "ruin") {
      ctx.strokeStyle = "rgba(81, 73, 61, 0.42)";
      ctx.strokeRect(-landmark.size * 0.22, -landmark.size * 0.18, landmark.size * 0.28, landmark.size * 0.22);
      ctx.strokeRect(landmark.size * 0.02, landmark.size * 0.02, landmark.size * 0.22, landmark.size * 0.2);
      ctx.beginPath();
      ctx.moveTo(-landmark.size * 0.35, landmark.size * 0.22);
      ctx.lineTo(landmark.size * 0.38, -landmark.size * 0.25);
      ctx.stroke();
    } else if (landmark.kind === "ditch") {
      ctx.strokeStyle = "rgba(54, 100, 112, 0.28)";
      ctx.beginPath();
      ctx.moveTo(-landmark.size / 2, 0);
      ctx.bezierCurveTo(-landmark.size / 4, 42, landmark.size / 4, -42, landmark.size / 2, 0);
      ctx.stroke();
    } else if (landmark.kind === "campMark") {
      ctx.strokeStyle = "rgba(112, 74, 51, 0.34)";
      ctx.beginPath();
      ctx.arc(0, 0, landmark.size * 0.24, 0, Math.PI * 2);
      ctx.moveTo(-landmark.size * 0.2, -landmark.size * 0.2);
      ctx.lineTo(landmark.size * 0.2, landmark.size * 0.2);
      ctx.moveTo(landmark.size * 0.2, -landmark.size * 0.2);
      ctx.lineTo(-landmark.size * 0.2, landmark.size * 0.2);
      ctx.stroke();
    } else if (landmark.kind === "mineScar") {
      ctx.strokeStyle = "rgba(184, 133, 31, 0.3)";
      for (let i = 0; i < 4; i += 1) {
        ctx.beginPath();
        ctx.moveTo(-landmark.size * 0.3 + i * 26, landmark.size * 0.22);
        ctx.lineTo(-landmark.size * 0.18 + i * 26, -landmark.size * 0.2);
        ctx.stroke();
      }
    } else {
      ctx.strokeStyle = "rgba(46, 58, 47, 0.4)";
      ctx.strokeRect(-18, -18, 36, 36);
      ctx.beginPath();
      ctx.moveTo(0, -landmark.size * 0.32);
      ctx.lineTo(0, landmark.size * 0.32);
      ctx.moveTo(-landmark.size * 0.22, -landmark.size * 0.12);
      ctx.lineTo(landmark.size * 0.22, -landmark.size * 0.12);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawResources(resources: ResourceNode[]) {
  for (const resource of resources) {
    const point = worldToScreen(resource);
    if (!nearScreen(point, 80)) continue;
    ctx.strokeStyle = "#b9861b";
    ctx.fillStyle = "#dcae30";
    ctx.lineWidth = 3;
    for (let i = 0; i < 5; i += 1) {
      ctx.beginPath();
      ctx.moveTo(point.x - 26 + i * 12, point.y + 22);
      ctx.lineTo(point.x - 14 + i * 12, point.y - 20);
      ctx.stroke();
    }
    ctx.font = "12px ui-monospace, monospace";
    ctx.fillText(`${Math.ceil(resource.amount)}`, point.x - 22, point.y + 42);
  }
}

function drawMercenaryCamps(camps: MercenaryCamp[]) {
  for (const camp of camps) {
    const point = worldToScreen(camp);
    if (!nearScreen(point, 110)) continue;
    ctx.strokeStyle = "#704a33";
    ctx.fillStyle = "rgba(255, 250, 226, 0.62)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(point.x, point.y, camp.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (selectedCampId === camp.id) drawSelectionHalo(point.x, point.y + camp.radius * 0.56, camp.radius * 0.95, camp.radius * 0.3, "#704a33");
    ctx.beginPath();
    ctx.moveTo(point.x - 30, point.y + 24);
    ctx.lineTo(point.x, point.y - 34);
    ctx.lineTo(point.x + 30, point.y + 24);
    ctx.moveTo(point.x - 18, point.y + 24);
    ctx.lineTo(point.x - 18, point.y - 6);
    ctx.moveTo(point.x + 18, point.y + 24);
    ctx.lineTo(point.x + 18, point.y - 6);
    ctx.stroke();
    ctx.font = "11px ui-monospace, monospace";
    ctx.fillStyle = "#704a33";
    ctx.fillText(`merc ${camp.stock}`, point.x - 24, point.y + 48);
    if (camp.cooldownRemaining > 0) drawProgress(point.x, point.y + 60, 1 - camp.cooldownRemaining / camp.cooldown);
  }
}

function drawBuildings(buildings: Building[]) {
  for (const building of buildings) {
    const shake = hitFeedbackOffset(building, building.radius);
    const point = worldToScreen({ x: building.x + shake.x, y: building.y + shake.y });
    if (!nearScreen(point, 120)) continue;
    ctx.strokeStyle = ownerInk(building.owner);
    ctx.fillStyle = building.complete ? "rgba(255, 250, 226, 0.72)" : "rgba(255, 250, 226, 0.42)";
    ctx.lineWidth = selectedIds.has(building.id) ? 4 : 2;
    const size = building.kind === "townHall" ? 76 : 58;
    if (selectedIds.has(building.id)) drawSelectionHalo(point.x, point.y + size / 2 - 3, size * 0.66, size * 0.22, ownerInk(building.owner));
    drawBuildingGlyph(BUILDING_GLYPHS[building.kind], point, size);
    if (selectedIds.has(building.id) && BUILDING_DEFS[building.kind].trains.length > 0) drawBuildingRally(building, point);
    drawHp(point.x, point.y - size / 2 - 13, building.hp, building.maxHp);
    if (!building.complete) drawProgress(point.x, point.y + size / 2 + 10, building.buildProgress / building.buildTime);
    if (building.complete && building.queue[0]) {
      drawTrainingProgress(point.x, point.y + size / 2 + 10, building.queue[0].remaining, building.queue[0].unitKind, building.queue.length);
    }
  }
}

function drawBuildingRally(building: Building, from: Point) {
  const to = worldToScreen({ x: building.rallyX, y: building.rallyY });
  if (!nearScreen(from, 80) && !nearScreen(to, 80)) return;
  const ink = building.rallyTarget?.type === "resource" ? "#b9861b" : building.rallyTarget?.type === "unit" ? "#5d8b4c" : "#315f87";
  ctx.save();
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = 2;
  ctx.setLineDash([7, 5]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(to.x, to.y, 7, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(to.x, to.y - 16);
  ctx.lineTo(to.x, to.y + 8);
  ctx.lineTo(to.x + 15, to.y - 8);
  ctx.lineTo(to.x, to.y - 8);
  ctx.fill();
  ctx.restore();
}

function drawBuildingGlyph(glyph: BuildingGlyph, point: Point, size: number) {
  drawBuildingFrame(glyph, point, size);
  for (const mark of glyph.marks) drawBuildingMark(mark, point, size);
}

function drawBuildingFrame(glyph: BuildingGlyph, point: Point, size: number) {
  const half = size / 2;
  ctx.beginPath();
  if (glyph.frame === "town-hall") {
    ctx.moveTo(point.x - half, point.y - half * 0.1);
    ctx.lineTo(point.x, point.y - half);
    ctx.lineTo(point.x + half, point.y - half * 0.1);
    ctx.lineTo(point.x + half * 0.78, point.y + half);
    ctx.lineTo(point.x - half * 0.78, point.y + half);
  } else if (glyph.frame === "barracks-yard") {
    ctx.rect(point.x - half, point.y - half * 0.72, size, size * 0.92);
    ctx.moveTo(point.x - half * 0.82, point.y + half * 0.22);
    ctx.lineTo(point.x + half * 0.82, point.y + half * 0.22);
  } else if (glyph.frame === "archery-range") {
    ctx.moveTo(point.x - half, point.y + half * 0.58);
    ctx.lineTo(point.x - half * 0.65, point.y - half * 0.65);
    ctx.quadraticCurveTo(point.x, point.y - half, point.x + half * 0.65, point.y - half * 0.65);
    ctx.lineTo(point.x + half, point.y + half * 0.58);
  } else if (glyph.frame === "stables-gate") {
    ctx.rect(point.x - half, point.y - half * 0.5, size, size * 0.82);
    ctx.moveTo(point.x - half, point.y - half * 0.5);
    ctx.lineTo(point.x, point.y - half);
    ctx.lineTo(point.x + half, point.y - half * 0.5);
  } else if (glyph.frame === "sanctum-dome") {
    ctx.arc(point.x, point.y, half * 0.86, Math.PI, Math.PI * 2);
    ctx.lineTo(point.x + half * 0.86, point.y + half * 0.62);
    ctx.lineTo(point.x - half * 0.86, point.y + half * 0.62);
  } else if (glyph.frame === "workshop-gear") {
    for (let i = 0; i < 12; i += 1) {
      const angle = (i / 12) * Math.PI * 2;
      const radius = i % 2 === 0 ? half * 0.94 : half * 0.72;
      const x = point.x + Math.cos(angle) * radius;
      const y = point.y + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  } else if (glyph.frame === "tower-spire") {
    ctx.moveTo(point.x, point.y - half);
    ctx.lineTo(point.x + half * 0.5, point.y - half * 0.18);
    ctx.lineTo(point.x + half * 0.38, point.y + half);
    ctx.lineTo(point.x - half * 0.38, point.y + half);
    ctx.lineTo(point.x - half * 0.5, point.y - half * 0.18);
  } else if (glyph.frame === "moon-well") {
    ctx.ellipse(point.x, point.y + half * 0.13, half * 0.76, half * 0.43, 0, 0, Math.PI * 2);
    ctx.moveTo(point.x - half * 0.58, point.y + half * 0.02);
    ctx.quadraticCurveTo(point.x, point.y - half * 0.72, point.x + half * 0.58, point.y + half * 0.02);
    ctx.moveTo(point.x - half * 0.44, point.y + half * 0.22);
    ctx.lineTo(point.x + half * 0.44, point.y + half * 0.22);
  } else {
    ctx.rect(point.x - half * 0.9, point.y - half * 0.45, size * 0.9, size * 0.72);
    ctx.moveTo(point.x - half * 0.9, point.y - half * 0.1);
    ctx.lineTo(point.x + half * 0.9, point.y - half * 0.1);
    ctx.moveTo(point.x, point.y - half * 0.45);
    ctx.lineTo(point.x, point.y + half * 0.27);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawBuildingMark(mark: BuildingGlyphMark, point: Point, size: number) {
  const half = size / 2;
  ctx.beginPath();
  if (mark === "roof") {
    ctx.moveTo(point.x - half * 0.64, point.y - half * 0.05);
    ctx.lineTo(point.x, point.y - half * 0.44);
    ctx.lineTo(point.x + half * 0.64, point.y - half * 0.05);
  } else if (mark === "banner") {
    ctx.moveTo(point.x + half * 0.12, point.y - half * 0.62);
    ctx.lineTo(point.x + half * 0.12, point.y - half * 0.12);
    ctx.lineTo(point.x + half * 0.48, point.y - half * 0.36);
    ctx.lineTo(point.x + half * 0.12, point.y - half * 0.5);
  } else if (mark === "door") {
    ctx.rect(point.x - half * 0.18, point.y + half * 0.2, half * 0.36, half * 0.38);
  } else if (mark === "crossedBlades") {
    ctx.moveTo(point.x - half * 0.45, point.y + half * 0.22);
    ctx.lineTo(point.x + half * 0.42, point.y - half * 0.42);
    ctx.moveTo(point.x + half * 0.45, point.y + half * 0.22);
    ctx.lineTo(point.x - half * 0.42, point.y - half * 0.42);
  } else if (mark === "target") {
    ctx.arc(point.x, point.y - half * 0.08, half * 0.28, 0, Math.PI * 2);
    ctx.moveTo(point.x - half * 0.34, point.y - half * 0.08);
    ctx.lineTo(point.x + half * 0.34, point.y - half * 0.08);
    ctx.moveTo(point.x, point.y - half * 0.42);
    ctx.lineTo(point.x, point.y + half * 0.26);
  } else if (mark === "bowRack") {
    ctx.arc(point.x - half * 0.45, point.y, half * 0.28, -Math.PI / 2, Math.PI / 2);
    ctx.moveTo(point.x - half * 0.45, point.y - half * 0.28);
    ctx.lineTo(point.x - half * 0.45, point.y + half * 0.28);
  } else if (mark === "horseshoe") {
    ctx.arc(point.x, point.y, half * 0.28, Math.PI * 0.18, Math.PI * 0.82, true);
    ctx.moveTo(point.x - half * 0.27, point.y);
    ctx.lineTo(point.x - half * 0.27, point.y + half * 0.28);
    ctx.moveTo(point.x + half * 0.27, point.y);
    ctx.lineTo(point.x + half * 0.27, point.y + half * 0.28);
  } else if (mark === "rail") {
    ctx.moveTo(point.x - half * 0.6, point.y + half * 0.18);
    ctx.lineTo(point.x + half * 0.6, point.y + half * 0.18);
    ctx.moveTo(point.x - half * 0.5, point.y + half * 0.36);
    ctx.lineTo(point.x + half * 0.5, point.y + half * 0.36);
  } else if (mark === "moonRune") {
    ctx.arc(point.x - half * 0.05, point.y - half * 0.08, half * 0.24, Math.PI * 0.55, Math.PI * 1.55);
    ctx.arc(point.x + half * 0.08, point.y - half * 0.08, half * 0.18, Math.PI * 1.55, Math.PI * 0.55, true);
  } else if (mark === "sparkRune") {
    ctx.moveTo(point.x + half * 0.43, point.y - half * 0.4);
    ctx.lineTo(point.x + half * 0.43, point.y - half * 0.12);
    ctx.moveTo(point.x + half * 0.29, point.y - half * 0.26);
    ctx.lineTo(point.x + half * 0.57, point.y - half * 0.26);
  } else if (mark === "cog") {
    ctx.arc(point.x, point.y, half * 0.24, 0, Math.PI * 2);
    ctx.moveTo(point.x - half * 0.34, point.y);
    ctx.lineTo(point.x + half * 0.34, point.y);
    ctx.moveTo(point.x, point.y - half * 0.34);
    ctx.lineTo(point.x, point.y + half * 0.34);
  } else if (mark === "hammer") {
    ctx.moveTo(point.x - half * 0.5, point.y + half * 0.36);
    ctx.lineTo(point.x + half * 0.3, point.y - half * 0.34);
    ctx.moveTo(point.x + half * 0.12, point.y - half * 0.48);
    ctx.lineTo(point.x + half * 0.48, point.y - half * 0.16);
  } else if (mark === "arrowSlit") {
    ctx.rect(point.x - half * 0.08, point.y - half * 0.18, half * 0.16, half * 0.52);
  } else if (mark === "watchEye") {
    ctx.ellipse(point.x, point.y - half * 0.34, half * 0.24, half * 0.12, 0, 0, Math.PI * 2);
    ctx.moveTo(point.x, point.y - half * 0.46);
    ctx.lineTo(point.x, point.y - half * 0.22);
  } else if (mark === "furrows") {
    for (let i = -2; i <= 2; i += 1) {
      ctx.moveTo(point.x + i * half * 0.18, point.y - half * 0.38);
      ctx.lineTo(point.x + i * half * 0.18, point.y + half * 0.25);
    }
  } else {
    ctx.moveTo(point.x - half * 0.32, point.y - half * 0.42);
    ctx.lineTo(point.x, point.y - half * 0.16);
    ctx.lineTo(point.x + half * 0.32, point.y - half * 0.42);
    ctx.moveTo(point.x, point.y - half * 0.16);
    ctx.lineTo(point.x, point.y + half * 0.24);
  }
  ctx.stroke();
}

function drawUnits(units: Unit[]) {
  for (const unit of units) {
    const shake = hitFeedbackOffset(unit, unit.radius);
    const point = worldToScreen({ x: unit.x + shake.x, y: unit.y + shake.y });
    const scale = unitGlyphScale(unit.radius);
    if (!nearScreen(point, Math.max(60, unit.radius * 3))) continue;
    ctx.strokeStyle = ownerInk(unit.owner);
    ctx.fillStyle = unit.owner === "neutral" ? "#f0d9bd" : "#fffbe7";
    ctx.lineWidth = selectedIds.has(unit.id) ? 4 : 2;
    if (hasCarriedItem(unit, "flameCloak")) drawFlameCloakAura(point, performance.now(), unit.radius);
    if (selectedIds.has(unit.id)) {
      ctx.beginPath();
      ctx.ellipse(point.x, point.y + unit.radius * 0.72, unit.radius + 5, (unit.radius + 5) * 0.45, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    drawUnitGlyph(UNIT_GLYPHS[unit.kind], point, scale);
    if (unit.kind === "worker" && unit.carryingGold > 0) drawCarriedGold(point.x, point.y);
    if (unit.level > 0) drawLevelStar(ctx, point.x + unit.radius + 5, point.y - unit.radius - 5, unit.level);
    drawHp(point.x, point.y - unit.radius * 1.55, unit.hp, unit.maxHp);
  }
}

function hasCarriedItem(unit: Unit, kind: WorldItem["kind"]) {
  return snapshot?.items.some((item) => item.kind === kind && item.carrierId === unit.id) ?? false;
}

function drawFlameCloakAura(point: Point, now: number, radius: number) {
  const pulse = 0.55 + Math.sin(now / 140) * 0.14;
  ctx.save();
  ctx.strokeStyle = `rgba(150, 60, 54, ${pulse})`;
  ctx.fillStyle = "rgba(242, 137, 75, 0.12)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(point.x, point.y + 13, radius + 14, (radius + 14) * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = "rgba(242, 137, 75, 0.72)";
  for (let index = 0; index < 5; index += 1) {
    const angle = now / 260 + index * 1.26;
    const x = point.x + Math.cos(angle) * (radius + 8);
    const y = point.y + 13 + Math.sin(angle) * (radius * 0.34);
    ctx.beginPath();
    ctx.moveTo(x, y + 5);
    ctx.quadraticCurveTo(x - 5, y - 3, x + 1, y - 11);
    ctx.quadraticCurveTo(x + 6, y - 3, x + 3, y + 5);
    ctx.stroke();
  }
  ctx.restore();
}

function drawItems(items: WorldItem[]) {
  for (const item of items) {
    if (item.carrierId) continue;
    const point = worldToScreen(item);
    if (!nearScreen(point, 42)) continue;
    drawItemGlyph(item, point, performance.now(), false);
  }
}

function drawCarriedItems(items: WorldItem[]) {
  for (const item of items) {
    if (!item.carrierId) continue;
    const point = worldToScreen(item);
    if (!nearScreen(point, 60)) continue;
    drawItemGlyph(item, { x: point.x + 12, y: point.y - 34 }, performance.now(), true);
  }
}

function drawUnitGlyph(glyph: UnitGlyph, point: Point, scale = 1) {
  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.scale(scale, scale);
  const localPoint = { x: 0, y: 0 };
  drawGlyphSilhouette(glyph, localPoint);
  for (const mark of glyph.marks) drawGlyphMark(mark, localPoint);
  ctx.restore();
}

function drawGlyphSilhouette(glyph: UnitGlyph, point: Point) {
  ctx.beginPath();
  if (glyph.silhouette === "worker-apron") {
    ctx.moveTo(point.x - 11, point.y - 15);
    ctx.lineTo(point.x + 9, point.y - 13);
    ctx.lineTo(point.x + 16, point.y + 14);
    ctx.lineTo(point.x - 13, point.y + 16);
    ctx.lineTo(point.x - 17, point.y - 5);
  } else if (glyph.silhouette === "shield-triangle") {
    ctx.moveTo(point.x, point.y - 20);
    ctx.lineTo(point.x + 17, point.y + 15);
    ctx.lineTo(point.x - 17, point.y + 15);
  } else if (glyph.silhouette === "bow-crest") {
    ctx.moveTo(point.x - 14, point.y - 16);
    ctx.quadraticCurveTo(point.x + 18, point.y - 18, point.x + 14, point.y + 15);
    ctx.quadraticCurveTo(point.x - 10, point.y + 20, point.x - 16, point.y - 4);
  } else if (glyph.silhouette === "raider-kite") {
    ctx.moveTo(point.x, point.y - 20);
    ctx.lineTo(point.x + 18, point.y - 2);
    ctx.lineTo(point.x + 7, point.y + 19);
    ctx.lineTo(point.x - 15, point.y + 10);
    ctx.lineTo(point.x - 18, point.y - 7);
  } else if (glyph.silhouette === "lancer-pennant") {
    ctx.moveTo(point.x - 15, point.y - 14);
    ctx.lineTo(point.x + 17, point.y - 9);
    ctx.lineTo(point.x + 8, point.y + 16);
    ctx.lineTo(point.x - 18, point.y + 13);
  } else if (glyph.silhouette === "knight-helm") {
    ctx.arc(point.x, point.y - 2, 17, Math.PI * 0.95, Math.PI * 2.05);
    ctx.lineTo(point.x + 15, point.y + 17);
    ctx.lineTo(point.x - 15, point.y + 17);
  } else if (glyph.silhouette === "priest-medallion") {
    ctx.arc(point.x, point.y, 14, 0, Math.PI * 2);
  } else if (glyph.silhouette === "summoner-ring") {
    ctx.ellipse(point.x, point.y, 17, 13, 0.2, 0, Math.PI * 2);
  } else if (glyph.silhouette === "witch-crescent") {
    ctx.arc(point.x + 4, point.y, 17, Math.PI * 0.52, Math.PI * 1.58);
    ctx.quadraticCurveTo(point.x - 15, point.y, point.x + 4, point.y - 17);
  } else if (glyph.silhouette === "golem-block") {
    ctx.rect(point.x - 17, point.y - 17, 34, 34);
  } else if (glyph.silhouette === "spirit-wisp") {
    ctx.moveTo(point.x, point.y - 18);
    ctx.quadraticCurveTo(point.x + 18, point.y - 4, point.x + 4, point.y + 18);
    ctx.quadraticCurveTo(point.x - 18, point.y + 4, point.x, point.y - 18);
  } else if (glyph.silhouette === "mercenary-badge") {
    ctx.moveTo(point.x, point.y - 19);
    ctx.lineTo(point.x + 16, point.y - 3);
    ctx.lineTo(point.x + 8, point.y + 18);
    ctx.lineTo(point.x - 12, point.y + 14);
    ctx.lineTo(point.x - 16, point.y - 6);
  } else {
    ctx.moveTo(point.x - 15, point.y - 15);
    ctx.lineTo(point.x + 15, point.y + 15);
    ctx.moveTo(point.x + 15, point.y - 15);
    ctx.lineTo(point.x - 15, point.y + 15);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawGlyphMark(mark: GlyphMark, point: Point) {
  ctx.beginPath();
  if (mark === "pick") {
    ctx.moveTo(point.x - 18, point.y - 11);
    ctx.lineTo(point.x + 9, point.y + 15);
    ctx.moveTo(point.x - 20, point.y - 9);
    ctx.quadraticCurveTo(point.x - 8, point.y - 24, point.x + 4, point.y - 15);
  } else if (mark === "satchel") {
    ctx.rect(point.x - 19, point.y + 3, 10, 9);
    ctx.moveTo(point.x - 17, point.y + 3);
    ctx.quadraticCurveTo(point.x - 14, point.y - 4, point.x - 11, point.y + 3);
  } else if (mark === "shieldBar") {
    ctx.moveTo(point.x - 10, point.y + 2);
    ctx.lineTo(point.x + 10, point.y + 2);
    ctx.moveTo(point.x, point.y - 14);
    ctx.lineTo(point.x, point.y + 13);
  } else if (mark === "shortSword") {
    ctx.moveTo(point.x + 10, point.y - 15);
    ctx.lineTo(point.x + 22, point.y - 24);
    ctx.moveTo(point.x + 11, point.y - 14);
    ctx.lineTo(point.x + 17, point.y - 8);
  } else if (mark === "bow") {
    ctx.arc(point.x + 14, point.y, 16, -Math.PI / 2, Math.PI / 2);
    ctx.moveTo(point.x + 14, point.y - 16);
    ctx.lineTo(point.x + 14, point.y + 16);
  } else if (mark === "arrow") {
    ctx.moveTo(point.x - 18, point.y + 2);
    ctx.lineTo(point.x + 17, point.y - 8);
    ctx.moveTo(point.x + 17, point.y - 8);
    ctx.lineTo(point.x + 9, point.y - 11);
    ctx.moveTo(point.x + 17, point.y - 8);
    ctx.lineTo(point.x + 11, point.y - 2);
  } else if (mark === "reins") {
    ctx.moveTo(point.x - 13, point.y - 5);
    ctx.quadraticCurveTo(point.x + 2, point.y - 18, point.x + 16, point.y - 1);
  } else if (mark === "spur") {
    ctx.moveTo(point.x - 7, point.y + 18);
    ctx.lineTo(point.x - 16, point.y + 25);
    ctx.lineTo(point.x - 9, point.y + 23);
  } else if (mark === "longSpear") {
    ctx.moveTo(point.x - 20, point.y + 17);
    ctx.lineTo(point.x + 24, point.y - 22);
  } else if (mark === "flag") {
    ctx.moveTo(point.x + 7, point.y - 19);
    ctx.lineTo(point.x + 22, point.y - 16);
    ctx.lineTo(point.x + 10, point.y - 7);
  } else if (mark === "visor") {
    ctx.moveTo(point.x - 12, point.y - 5);
    ctx.lineTo(point.x + 12, point.y - 5);
    ctx.moveTo(point.x - 8, point.y);
    ctx.lineTo(point.x + 9, point.y);
  } else if (mark === "towerShield") {
    ctx.rect(point.x - 20, point.y - 4, 10, 18);
    ctx.moveTo(point.x - 20, point.y + 3);
    ctx.lineTo(point.x - 10, point.y + 3);
  } else if (mark === "halo") {
    ctx.ellipse(point.x, point.y - 19, 15, 5, 0, 0, Math.PI * 2);
  } else if (mark === "cross") {
    ctx.moveTo(point.x - 10, point.y);
    ctx.lineTo(point.x + 10, point.y);
    ctx.moveTo(point.x, point.y - 10);
    ctx.lineTo(point.x, point.y + 10);
  } else if (mark === "outerRing") {
    ctx.ellipse(point.x, point.y, 22, 17, -0.2, 0, Math.PI * 2);
  } else if (mark === "innerSigil") {
    ctx.moveTo(point.x, point.y - 9);
    ctx.lineTo(point.x + 8, point.y + 6);
    ctx.lineTo(point.x - 8, point.y + 6);
    ctx.closePath();
  } else if (mark === "crescent") {
    ctx.arc(point.x - 2, point.y - 1, 16, Math.PI * 0.65, Math.PI * 1.55);
    ctx.arc(point.x + 5, point.y - 1, 12, Math.PI * 1.55, Math.PI * 0.65, true);
  } else if (mark === "curseSlash") {
    ctx.moveTo(point.x - 15, point.y + 14);
    ctx.lineTo(point.x + 16, point.y - 15);
  } else if (mark === "rune") {
    ctx.moveTo(point.x - 6, point.y - 8);
    ctx.lineTo(point.x + 8, point.y - 8);
    ctx.lineTo(point.x - 2, point.y + 9);
    ctx.lineTo(point.x + 10, point.y + 9);
  } else if (mark === "blockSeams") {
    ctx.moveTo(point.x - 17, point.y - 2);
    ctx.lineTo(point.x + 17, point.y - 2);
    ctx.moveTo(point.x - 3, point.y - 17);
    ctx.lineTo(point.x - 3, point.y + 17);
  } else if (mark === "tail") {
    ctx.moveTo(point.x - 5, point.y + 13);
    ctx.quadraticCurveTo(point.x - 27, point.y + 24, point.x - 13, point.y + 34);
  } else if (mark === "spark") {
    ctx.moveTo(point.x + 18, point.y - 17);
    ctx.lineTo(point.x + 18, point.y - 5);
    ctx.moveTo(point.x + 12, point.y - 11);
    ctx.lineTo(point.x + 24, point.y - 11);
  } else if (mark === "coinSlash") {
    ctx.arc(point.x + 13, point.y + 11, 5, 0, Math.PI * 2);
    ctx.moveTo(point.x + 9, point.y + 15);
    ctx.lineTo(point.x + 17, point.y + 7);
  } else if (mark === "scar") {
    ctx.moveTo(point.x - 11, point.y - 8);
    ctx.lineTo(point.x + 10, point.y + 10);
  } else {
    ctx.moveTo(point.x - 18, point.y - 4);
    ctx.lineTo(point.x, point.y - 20);
    ctx.lineTo(point.x + 18, point.y - 4);
    ctx.moveTo(point.x, point.y - 20);
    ctx.lineTo(point.x, point.y + 16);
  }
  ctx.stroke();
}

function drawSelectionHalo(x: number, y: number, rx: number, ry: number, color: string) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255, 250, 226, 0.8)";
  ctx.beginPath();
  ctx.ellipse(x - 2, y - 3, rx * 0.82, ry * 0.7, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawCarriedGold(x: number, y: number) {
  ctx.save();
  ctx.strokeStyle = "#8a6418";
  ctx.fillStyle = "#f2d05c";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - 6, y - 24);
  ctx.lineTo(x + 2, y - 34);
  ctx.lineTo(x + 10, y - 23);
  ctx.lineTo(x + 1, y - 18);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawItemGlyph(item: WorldItem, point: Point, now: number, carried: boolean) {
  const bob = carried ? Math.sin(now / 180 + point.x * 0.03) * 2.5 : 0;
  const x = point.x;
  const y = point.y + bob;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (item.kind === "lightningRod") {
    ctx.strokeStyle = "#315f87";
    ctx.fillStyle = "#9ed8ff";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(x - 3, y + 9);
    ctx.lineTo(x + 6, y - 11);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + 3, y - 13);
    ctx.lineTo(x + 11, y - 6);
    ctx.lineTo(x + 6, y - 6);
    ctx.lineTo(x + 12, y + 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + 6, y - 11, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (item.kind === "stormStaff") {
    ctx.strokeStyle = "#596073";
    ctx.fillStyle = "#d6d4f2";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 7, y + 9);
    ctx.lineTo(x + 5, y - 10);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + 6, y - 11, 5, 0.15, Math.PI * 1.8);
    ctx.stroke();
  } else if (item.kind === "flameCloak") {
    ctx.strokeStyle = "#963c36";
    ctx.fillStyle = "rgba(242, 137, 75, 0.72)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 7, y + 8);
    ctx.quadraticCurveTo(x - 13, y - 4, x - 4, y - 12);
    ctx.quadraticCurveTo(x + 12, y - 4, x + 7, y + 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (item.kind === "guardianScroll") {
    ctx.strokeStyle = "#704a33";
    ctx.fillStyle = "#fff6d0";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(x - 8, y - 6, 16, 12);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 5, y - 2);
    ctx.lineTo(x + 5, y - 2);
    ctx.moveTo(x - 4, y + 3);
    ctx.lineTo(x + 4, y + 3);
    ctx.stroke();
  } else if (item.kind === "breachCharge") {
    ctx.strokeStyle = "#5f3a24";
    ctx.fillStyle = "#d28445";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y + 1, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 2, y - 7);
    ctx.quadraticCurveTo(x + 2, y - 13, x + 7, y - 9);
    ctx.stroke();
  } else {
    ctx.strokeStyle = "#8a6418";
    ctx.fillStyle = "#f2d05c";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y - 10);
    ctx.lineTo(x + 8, y);
    ctx.lineTo(x, y + 10);
    ctx.lineTo(x - 8, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  if (carried) {
    ctx.strokeStyle = "rgba(49, 95, 135, 0.36)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(x, y + 13, 10, 3.2, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawEffects(effects: GameSnapshot["effects"]) {
  renderWorldEffects({ ctx, effects, worldToScreen, nearScreen });
}

function drawBuildPlacementPreview() {
  if (!commandMode || commandMode.type !== "build" || !lastMouse) return;
  const def = BUILDING_DEFS[commandMode.placement.buildingKind];
  const point = lastMouse;
  const size = 58;
  const world = screenToWorld(point);
  const placement = snapshot ? buildPlacementCommand(snapshot, commandMode.placement, world) : undefined;
  const validPlacement = !placement || "command" in placement;
  ctx.save();
  ctx.strokeStyle = validPlacement ? "#315f87" : "#9f3a3a";
  ctx.fillStyle = validPlacement ? "rgba(49, 95, 135, 0.08)" : "rgba(159, 58, 58, 0.11)";
  ctx.lineWidth = 2;
  ctx.setLineDash([7, 5]);
  ctx.beginPath();
  ctx.ellipse(point.x, point.y + size / 2 - 3, def.radius, def.radius * 0.36, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillRect(point.x - size / 2, point.y - size / 2, size, size);
  ctx.strokeRect(point.x - size / 2, point.y - size / 2, size, size);
  ctx.beginPath();
  ctx.moveTo(point.x - size / 2, point.y - size / 2);
  ctx.lineTo(point.x + size / 2, point.y + size / 2);
  ctx.moveTo(point.x + size / 2, point.y - size / 2);
  ctx.lineTo(point.x - size / 2, point.y + size / 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = validPlacement ? "#315f87" : "#9f3a3a";
  ctx.font = "11px ui-monospace, monospace";
  ctx.fillText(`${commandMode.placement.buildingKind} ${def.cost}g`, point.x - 34, point.y + size / 2 + 22);
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
  ctx.fillText("A-move", point.x - 20, point.y + 44);
  ctx.restore();
}

function drawSpellPreview() {
  if (!commandMode || commandMode.type !== "spell" || !lastMouse) return;
  const point = lastMouse;
  const ability = commandMode.targeting.ability;
  ctx.save();
  ctx.strokeStyle = ability === "heal" ? "#5d8b4c" : ability === "summon" ? "#5f578f" : "#7f3a70";
  ctx.fillStyle = ability === "heal" ? "rgba(93, 139, 76, 0.08)" : ability === "summon" ? "rgba(95, 87, 143, 0.08)" : "rgba(127, 58, 112, 0.08)";
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.arc(point.x, point.y, ability === "summon" ? 28 : 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  if (ability === "heal") {
    ctx.moveTo(point.x - 16, point.y);
    ctx.lineTo(point.x + 16, point.y);
    ctx.moveTo(point.x, point.y - 16);
    ctx.lineTo(point.x, point.y + 16);
  } else if (ability === "summon") {
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
  ctx.fillStyle = ability === "heal" ? "#5d8b4c" : ability === "summon" ? "#5f578f" : "#7f3a70";
  ctx.fillText(labelKind(ability), point.x - 20, point.y + 44);
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
  ctx.fillStyle = "rgba(255, 250, 226, 0.9)";
  ctx.strokeStyle = "rgba(47, 61, 42, 0.44)";
  ctx.lineWidth = 2;
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  for (const mark of marks) {
    const point = projectWorldToRect(mark, snapshot.map, rect);
    if (mark.category === "terrain") {
      drawMiniTerrainMark(mark, point);
    } else if (mark.category === "goldMine") {
      ctx.fillStyle = "#c4921e";
      ctx.beginPath();
      ctx.moveTo(point.x, point.y - 3);
      ctx.lineTo(point.x + 3, point.y);
      ctx.lineTo(point.x, point.y + 3);
      ctx.lineTo(point.x - 3, point.y);
      ctx.closePath();
      ctx.fill();
    } else if (mark.category === "mercenaryCamp") {
      ctx.strokeStyle = "#704a33";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 3.5, 0, Math.PI * 2);
      ctx.stroke();
    } else if (mark.category === "wildlingCamp") {
      ctx.fillStyle = "#704a33";
      ctx.beginPath();
      ctx.arc(point.x, point.y, 2.6, 0, Math.PI * 2);
      ctx.fill();
    } else if (mark.category === "building") {
      ctx.fillStyle = ownerInk(mark.owner);
      ctx.fillRect(point.x - 3, point.y - 3, 6, 6);
    } else {
      ctx.fillStyle = ownerInk(mark.owner);
      const size = mark.owner === "neutral" ? 2.2 : 3;
      ctx.fillRect(point.x - size / 2, point.y - size / 2, size, size);
    }
  }
  for (const item of snapshot.items) {
    const point = projectWorldToRect(item, snapshot.map, rect);
    ctx.strokeStyle = item.kind === "lightningRod" || item.kind === "stormStaff" ? "#315f87" : item.kind === "flameCloak" ? "#963c36" : item.kind === "breachCharge" ? "#5f3a24" : "#8a6418";
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(point.x - 2.5, point.y + 2.5);
    ctx.lineTo(point.x + 2.5, point.y - 2.5);
    ctx.stroke();
  }
  ctx.strokeStyle = "#243126";
  ctx.lineWidth = 1;
  const viewport = minimapViewportRect(rect);
  ctx.strokeRect(viewport.x, viewport.y, viewport.width, viewport.height);
}

function drawMiniTerrainMark(mark: MapPresentationMark, point: Point) {
  ctx.save();
  ctx.lineWidth = 1;
  if (mark.kind === "road") {
    ctx.strokeStyle = "rgba(123, 101, 66, 0.62)";
    ctx.beginPath();
    ctx.moveTo(point.x - 4, point.y);
    ctx.lineTo(point.x + 4, point.y);
    ctx.stroke();
  } else if (mark.kind === "grove") {
    ctx.strokeStyle = "rgba(64, 108, 66, 0.62)";
    ctx.beginPath();
    ctx.arc(point.x, point.y, 2.3, 0, Math.PI * 2);
    ctx.stroke();
  } else if (mark.kind === "ridge") {
    ctx.strokeStyle = "rgba(84, 90, 68, 0.62)";
    ctx.beginPath();
    ctx.moveTo(point.x - 3, point.y + 2);
    ctx.lineTo(point.x, point.y - 2);
    ctx.lineTo(point.x + 3, point.y + 2);
    ctx.stroke();
  } else if (mark.kind === "ditch") {
    ctx.strokeStyle = "rgba(54, 100, 112, 0.62)";
    ctx.beginPath();
    ctx.moveTo(point.x - 3, point.y);
    ctx.quadraticCurveTo(point.x, point.y + 2, point.x + 3, point.y);
    ctx.stroke();
  } else if (mark.kind === "mineScar") {
    ctx.fillStyle = "rgba(184, 133, 31, 0.58)";
    ctx.fillRect(point.x - 1.5, point.y - 1.5, 3, 3);
  } else {
    ctx.fillStyle = "rgba(47, 61, 42, 0.48)";
    ctx.fillRect(point.x - 1.2, point.y - 1.2, 2.4, 2.4);
  }
  ctx.restore();
}

function drawHp(x: number, y: number, hp: number, maxHp: number) {
  const width = 34;
  ctx.fillStyle = "rgba(35, 49, 38, 0.18)";
  ctx.fillRect(x - width / 2, y, width, 4);
  ctx.fillStyle = hp / maxHp > 0.45 ? "#5d8b4c" : "#a23d34";
  ctx.fillRect(x - width / 2, y, width * Math.max(0, hp / maxHp), 4);
}

function drawProgress(x: number, y: number, ratio: number) {
  ctx.fillStyle = "rgba(35, 49, 38, 0.18)";
  ctx.fillRect(x - 28, y, 56, 5);
  ctx.fillStyle = "#315f87";
  ctx.fillRect(x - 28, y, 56 * Math.max(0, Math.min(1, ratio)), 5);
}

function drawTrainingProgress(x: number, y: number, remaining: number, unitKind: TrainableUnitKind, queueLength: number) {
  const total = UNIT_DEFS[unitKind].trainTime;
  drawProgress(x, y, 1 - remaining / total);
  ctx.fillStyle = "#315f87";
  ctx.font = "9px ui-monospace, monospace";
  const countText = trainingQueueCountText(queueLength);
  ctx.fillText(`${labelKind(unitKind)}${countText ? ` ${countText}` : ""}`, x - 27, y + 16);
}

function hitFeedbackOffset(entity: Unit | Building, scale: number): Point {
  if (!snapshot) return { x: 0, y: 0 };
  const hit = snapshot.effects.find((effect) => effect.type === "hit" && distance(effect, entity) <= scale + 8);
  if (!hit) return { x: 0, y: 0 };
  const pulse = Math.sin(hit.remaining * 1.7) * Math.max(2, scale * 0.18);
  return { x: pulse, y: -pulse * 0.35 };
}

function updateCamera() {
  if (menuOpen) return;
  const speed = keys.has("shift") ? 24 : 14;
  if (keys.has("arrowleft") || keys.has("a")) camera.x -= speed;
  if (keys.has("arrowright") || keys.has("d")) camera.x += speed;
  if (keys.has("arrowup") || keys.has("w")) camera.y -= speed;
  if (keys.has("arrowdown") || keys.has("s")) camera.y += speed;
  const edge = edgeScrollDelta(edgeScrollPoint(), { width: canvas.width, height: canvas.height });
  camera.x += edge.x;
  camera.y += edge.y;
  clampCamera();
}

function edgeScrollPoint() {
  if (!lastMouse || draggingMinimapViewport || isInsideRect(lastMouse, minimapRect())) return undefined;
  // @@@edge-scroll-ui - UI overlays near the viewport edge should not make the camera drift.
  return document.elementFromPoint(lastMouse.x, lastMouse.y) === canvas ? lastMouse : undefined;
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

function screenToWorld(point: Point): Point {
  return { x: point.x + camera.x, y: point.y + camera.y };
}

function worldToScreen(point: Point): Point {
  return { x: point.x - camera.x, y: point.y - camera.y };
}

function nearScreen(point: Point, pad: number) {
  return point.x >= -pad && point.y >= -pad && point.x <= canvas.width + pad && point.y <= canvas.height + pad;
}

function minimapRect(): ScreenRect {
  const size = Math.min(220, Math.max(150, Math.floor(Math.min(canvas.width, canvas.height) * 0.24)));
  return { x: canvas.width - size - 12, y: canvas.height - size - 12, width: size, height: size };
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

function hitMercenaryCamp(world: Point) {
  return snapshot?.mercenaryCamps.find((camp) => distance(camp, world) < camp.radius + 16);
}

function hitGroundItem(world: Point) {
  return snapshot?.items.find((item) => !item.carrierId && distance(item, world) < 34);
}

function hitAttackTarget(world: Point) {
  return hitUnit(world, (unit) => unit.owner !== localPlayerId) ?? hitBuilding(world, (building) => building.owner !== localPlayerId);
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

function labelKind(kind: BuildingKind | TrainableUnitKind | AbilityKind | UpgradeKind) {
  return kind.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());
}

function labelAnyKind(kind: string) {
  return kind.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());
}

function romanLevel(level: number) {
  return level === 1 ? "I" : level === 2 ? "II" : level === 3 ? "III" : String(level);
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function ownerInk(owner: Owner | undefined) {
  if (owner === "player") return "#315f87";
  if (owner === "enemy") return "#963c36";
  if (owner === "enemy2") return "#7f3a70";
  if (!owner || owner === "neutral") return "#704a33";
  const palette = ["#315f87", "#963c36", "#7f3a70", "#5d8b4c", "#b97927", "#596a8c", "#8d5a46", "#2f766f"];
  let hash = 0;
  for (const char of owner) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length]!;
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
