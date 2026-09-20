import type { createI18n } from "./i18n";

type I18n = ReturnType<typeof createI18n>;

export function gameShellMarkup(i18n: I18n) {
  const t = i18n.t;
  return `
  <div class="game-shell menu-open">
    <canvas class="game-canvas"></canvas>
    <div class="main-menu" data-main-menu>
      <div class="menu-eyebrow"><svg viewBox="0 0 32 40" aria-hidden="true"><path d="M16 2 29 12v15L16 38 3 27V12Z"/><path d="M16 9v22M9 23h14M12 15l4-6 4 6"/></svg><span>${escapeHtml(t("art.edition"))}</span></div>
      <h1 class="menu-title" data-menu-title>Sketch RTS</h1>
      <p class="menu-intro">${escapeHtml(t("art.intro"))}</p>
      <div class="menu-status" data-menu-status>${escapeHtml(t("shell.connectingServer"))}</div>
      <div class="map-list" data-map-list></div>
      <div class="menu-footer"><span>SKETCH RTS</span><span>${escapeHtml(t("art.footer"))}</span></div>
    </div>
    <div class="atlas-caption" aria-hidden="true"><span class="atlas-caption-index">FIELD ATLAS / 01</span><span>${escapeHtml(t("art.caption"))}</span><small>${escapeHtml(t("art.captionNote"))}</small></div>
    <div class="top-strip">
      <div class="brand">Sketch RTS</div>
      <div class="resource-readout">${escapeHtml(t("shell.gold"))}: <span data-gold>?</span></div>
      <div class="supply-readout">${escapeHtml(t("shell.supply"))}: <span data-supply>?</span></div>
      <div data-map-readout>${escapeHtml(t("hud.mapReadout", { width: 4096, height: 4096 }))}</div>
      <button type="button" class="match-action hidden" data-forfeit-match>${escapeHtml(t("shell.concede"))}</button>
    </div>
    <div class="status-line" data-status>${escapeHtml(t("shell.connectingMatch"))}</div>
    <div class="chat-overlay" data-chat-overlay>
      <div class="chat-messages" data-chat-messages></div>
      <form class="chat-input-row hidden" data-chat-form>
        <input data-chat-input autocomplete="off" maxlength="180" aria-label="${escapeHtml(t("shell.chat.aria"))}" />
      </form>
    </div>
    <div class="selection-chip" data-selection>${escapeHtml(t("hud.nothingSelected"))}</div>
    <div class="command-dock hidden" data-command-dock></div>
    <div class="item-dock hidden" data-item-dock></div>
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
