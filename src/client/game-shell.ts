export const gameShellMarkup = `
  <div class="game-shell menu-open">
    <canvas class="game-canvas"></canvas>
    <div class="main-menu" data-main-menu>
      <div class="menu-title" data-menu-title>Sketch RTS</div>
      <div class="menu-status" data-menu-status>Connecting to match server...</div>
      <div class="map-list" data-map-list></div>
    </div>
    <div class="top-strip">
      <div class="brand">Sketch RTS</div>
      <div class="resource-readout">Gold: <span data-gold>?</span></div>
      <div class="supply-readout">Supply: <span data-supply>?</span></div>
      <div data-map-readout>Map: 4096 x 4096</div>
      <button type="button" class="match-action hidden" data-forfeit-match>Concede</button>
    </div>
    <div class="status-line" data-status>Connecting to match...</div>
    <div class="chat-overlay" data-chat-overlay>
      <div class="chat-messages" data-chat-messages></div>
      <form class="chat-input-row hidden" data-chat-form>
        <input data-chat-input autocomplete="off" maxlength="180" aria-label="Public chat message" />
      </form>
    </div>
    <div class="selection-chip" data-selection>Nothing selected</div>
    <div class="command-dock hidden" data-command-dock></div>
    <div class="item-dock hidden" data-item-dock></div>
    <div class="tooltip-layer hidden" data-tooltip-layer role="tooltip"></div>
    <div class="virtual-pointer hidden" data-virtual-pointer aria-hidden="true"></div>
    <div class="pointer-lock-gate hidden" data-pointer-lock-gate role="dialog" aria-modal="true" aria-labelledby="pointer-lock-gate-title">
      <div class="pointer-lock-panel">
        <h2 id="pointer-lock-gate-title" data-pointer-lock-gate-title>Lock mouse to keep playing</h2>
        <p data-pointer-lock-gate-body>This match uses mouse lock for camera movement and right-click commands.</p>
        <button type="button" data-pointer-lock-gate-action>Lock mouse to play</button>
      </div>
    </div>
  </div>
`;
