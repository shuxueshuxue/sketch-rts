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

function syncDebugView() {
  window.__sketchRtsView = createSketchRtsDebugView({ roomId: currentRoomId, localPlayerId, snapshot, selectedIds, focusedSelectionId });
}

function pruneSelection() {
  if (!snapshot) return;
  const liveIds = liveSelectionIds(snapshot, localPlayerId);
  if (commandMode?.type === 'boardShip') {
    const sources = commandMode.sourceIds.filter(id => snapshot!.units.some(ship => ship.id === id && ship.owner === localPlayerId && ship.hp > 0 && shipProfile(ship)));
    if (sources.length) commandMode.sourceIds = sources;
    else { commandMode = undefined; clearCommandModeClasses(); }
  }
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
  minimapPresentation.reset();
  combatPresentation.reset();projectileOrigins.reset();
  focusedStatusProjection = undefined;
  if (activeGameAdapter !== baseGameAdapter) activeGameAdapter.close();
  activeChatUnsubscribe?.();
  activeChatUnsubscribe = undefined;
  activeChat = undefined;
  closeChatInput();
  activeGameAdapter = baseGameAdapter;
}

function focusedPlayerUnits() {
  if (!snapshot) return [];
  return focusedSelectionEntities(snapshot, focusedSelectionId, localPlayerId).units;
}

function focusedVeteranStudent() {
  const unit = focusedPlayerUnits()[0];
  return unit && !isInCabin(unit) && canLearnVeteranSkill(unit) && !pendingVeteranChoices.has(unit.id) ? unit : undefined;
}

function clearCommandModeClasses() {
  shell.classList.remove("placement-active", "targeting-active");
}