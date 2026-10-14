function renderTrainingProgressButton(progress: TrainingProgressButton, previous?: HTMLButtonElement) {
  const percent = Math.floor(progress.progress * 100);
  const { label, badge, hint } = trainingProgressText(progress, i18n);
  const button = previous ?? document.createElement("button");
  button.type = "button";
  button.tabIndex = -1;
  button.className = "command-button research-progress-button";
  button.classList.add("training-cancel-button");
  button.classList.toggle("training-launch-waiting", progress.status === "awaitingLaunch");
  button.disabled = !progress.jobId;
  if (!previous) button.addEventListener("click", () => {
    if (progress.jobId) sendCommand({ type: "cancelTraining", buildingId: progress.buildingId, jobId: progress.jobId });
  });
  if (progress.jobId) button.dataset.jobId = progress.jobId;
  button.dataset.trainingProgress = progress.unitKind;
  button.dataset.trainingState = progress.status;
  button.dataset.commandLabel = label;
  button.setAttribute("aria-label", `${label} - ${percent}%`);
  const tooltip = unitTooltip(progress.unitKind, undefined, i18n, currentPlayerState()?.race);
  applyTooltip(button, {
    ...tooltip,
    title: `${label} · ${t("hud.cancelTraining")}`,
    body: hint ?? tooltip.body,
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
  button.querySelector(".research-progress-text")!.textContent = badge;
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
  const color=ownerInk(localPlayerId,snapshot??undefined);
  const appearance=portrait.type === "unit" ? appearanceForKind(portrait.kind,currentPlayerState()?.race) : {};
  paintPortrait(icon,`${portrait.type}:${portrait.kind}:${portrait.type==='item'?portrait.weaponKind??'':''}:${color}:${appearanceKey(appearance)}`,()=>{
    const brush = requireCanvasContext(icon);
    const size=icon.clientWidth||icon.width;
    const center = { x: size/2, y: size/2 };
    if (portrait.type === "unit") drawAtlasUnitPortrait(brush, portrait.kind, 0, 0, size, color, appearance);
    else if (portrait.type === "item") drawPaintedItem(brush, portrait.kind, center, size*.8,false,portrait.weaponKind);
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
function trainIcon(kind: TrainableUnitKind) {
  return TRAIN_COMMANDS.find((command) => command.kind === kind)?.icon ?? "△";
}
function labelKind(kind: BuildingKind | TrainableUnitKind | AbilityKind | UpgradeKind | WorldItem["kind"] | string) {
  return tl(kind as LabelKey);
}
function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
function requireCanvasContext(target: HTMLCanvasElement) {
  const context = target.getContext("2d");
  if (!context) throw new Error("Canvas 2D context is unavailable");
  return context;
}