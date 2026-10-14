import type { createI18n } from "./i18n";

type I18n = ReturnType<typeof createI18n>;

export function gameShellMarkup(i18n: I18n) {
  const t = i18n.t;
  return `
  <div class="game-shell menu-open">
    <canvas class="game-canvas"></canvas>
    <div class="main-menu" data-main-menu>
      <div class="menu-window">
        <h1 class="menu-title" data-menu-title>Sketch RTS</h1>
        <div class="menu-status" data-menu-status>${escapeHtml(t("shell.connectingServer"))}</div>
        <div class="map-list" data-map-list></div>
      </div>
      <button type="button" class="scene-switch" data-scene-switch></button>
    </div>
    <div class="minimap-tab" data-minimap-tab>
      <div class="resource-readout" title="${escapeHtml(t("shell.gold"))}"><span class="readout-icon" aria-hidden="true"></span><span data-gold>?</span></div>
      <div class="supply-readout" title="${escapeHtml(t("shell.supply"))}"><span class="readout-icon" aria-hidden="true"></span><span data-supply>?</span></div>
    </div>
    <button type="button" class="match-menu-button" data-match-menu-button aria-label="${escapeHtml(t("shell.menu"))}" title="${escapeHtml(t("shell.menu"))}"><span aria-hidden="true"></span></button>
    <div class="match-menu hidden" data-match-menu role="dialog" aria-label="${escapeHtml(t("shell.menu"))}">
      <div class="match-menu-map" data-map-readout></div>
      <button type="button" class="match-action" data-forfeit-match>${escapeHtml(t("shell.concede"))}</button>
      <button type="button" class="match-action" data-match-menu-close>${escapeHtml(t("shell.resume"))}</button>
    </div>
    <div class="status-line" data-status role="status" aria-live="polite">${escapeHtml(t("shell.connectingMatch"))}</div>
    <div class="chat-overlay" data-chat-overlay>
      <div class="chat-messages" data-chat-messages></div>
      <form class="chat-input-row hidden" data-chat-form>
        <input data-chat-input autocomplete="off" maxlength="180" aria-label="${escapeHtml(t("shell.chat.aria"))}" />
      </form>
    </div>
    <div class="minimap-frame" data-minimap-frame aria-hidden="true"></div>
    <button type="button" class="minimap-relations" data-minimap-relations aria-pressed="false" aria-label="${escapeHtml(t("hud.minimapRelations"))}" title="${escapeHtml(t("hud.minimapRelations"))}"><span aria-hidden="true"></span></button>
    <button type="button" class="minimap-wind" data-minimap-wind aria-pressed="false" aria-label="${escapeHtml(t("hud.minimapWind"))}"><svg class="minimap-wind-arrow" data-minimap-wind-arrow viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12H20M14 6L20 12L14 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
    <div class="control-deck" hidden>
      <div class="selection-chip" data-selection>${escapeHtml(t("hud.nothingSelected"))}</div>
      <div class="hud-actions">
        <div class="command-dock" data-command-dock hidden></div>
        <div class="item-dock" data-item-dock hidden></div>
      </div>
    </div>
    <div class="tooltip-layer hidden" data-tooltip-layer role="tooltip"></div>
    <div class="virtual-pointer hidden" data-virtual-pointer aria-hidden="true"></div>
    <div class="pointer-lock-gate hidden" data-pointer-lock-gate role="dialog" aria-modal="true" aria-labelledby="pointer-lock-gate-title">
      <div class="pointer-lock-panel">
        <h2 id="pointer-lock-gate-title" data-pointer-lock-gate-title>${escapeHtml(t("pointerLock.title.required"))}</h2>
        <p data-pointer-lock-gate-body>${escapeHtml(t("pointerLock.body.mouse"))}</p>
        <button type="button" data-pointer-lock-gate-action>${escapeHtml(t("pointerLock.action.guide"))}</button>
      </div>
    </div>
  </div>
`;
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
