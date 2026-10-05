/** Presentation only: the match controller supplies identity, artwork and commands.
 * Keep nodes alive across simulation frames so focus, scroll and pointer presses survive. */
export type HudArt = { key: string; paint: (canvas: HTMLCanvasElement) => void };
export type HudIdentity = {
  key: string; name: string; caption: string; detail: string; art: HudArt;
  health?: { current: number; max: number };
  inspection?: { name: string; detail: string; art: HudArt };
};
export type HudGroup = {
  key: string; name: string; count: number; focused: boolean; art: HudArt;
  activate: () => void; decorate: (button: HTMLButtonElement) => void;
};

function canvas(className: string) {
  const node = document.createElement("canvas");
  node.width = node.height = 192;
  node.className = className;
  node.setAttribute("aria-hidden", "true");
  return node;
}
function text(className: string) {
  const node = document.createElement("span"); node.className = className; return node;
}
function paint(node: HTMLCanvasElement, art: HudArt) {
  if (node.dataset.artKey === art.key) return;
  node.getContext("2d")!.clearRect(0, 0, node.width, node.height);
  art.paint(node); node.dataset.artKey = art.key;
}

export class BattleHudSelection {
  private readonly identity = document.createElement("div");
  private readonly portrait = canvas("hud-subject-art");
  private readonly caption = text("hud-subject-caption");
  private readonly name = text("hud-subject-name");
  private readonly detail = text("hud-subject-detail");
  private readonly health = document.createElement("div");
  private readonly healthFill = document.createElement("span");
  private readonly healthText = text("hud-health-text");
  private readonly grid = document.createElement("div");
  private readonly inspection = document.createElement("div");
  private readonly inspectionArt = canvas("hud-inspection-art");
  private readonly inspectionName = text("hud-inspection-name");
  private readonly inspectionDetail = text("hud-inspection-detail");
  private readonly empty = text("hud-empty");
  private groups = new Map<string, { button: HTMLButtonElement; group: HudGroup }>();
  private focusedKey: string | undefined;

  constructor(private readonly root: HTMLElement, groupLabel: string) {
    this.identity.className = "hud-subject";
    const copy = document.createElement("div"); copy.className = "hud-subject-copy";
    this.health.className = "hud-health";
    this.health.append(this.healthFill, this.healthText);
    copy.append(this.caption, this.name, this.health, this.detail);
    this.identity.append(this.portrait, copy);
    this.grid.className = "hud-roster"; this.grid.tabIndex = 0;
    this.grid.setAttribute("aria-label", groupLabel);
    this.inspection.className = "hud-inspection";
    const itemCopy = document.createElement("div");
    itemCopy.append(this.inspectionName, this.inspectionDetail);
    this.inspection.append(this.inspectionArt, itemCopy);
    root.replaceChildren(this.identity, this.grid, this.inspection, this.empty);
  }

  render(identity: HudIdentity | undefined, groups: HudGroup[], emptyLabel: string) {
    this.root.hidden = !identity;
    this.empty.hidden = Boolean(identity); this.empty.textContent = emptyLabel;
    this.identity.hidden = !identity;
    this.grid.hidden = groups.length < 2;
    this.inspection.hidden = !identity?.inspection;
    this.root.dataset.mode = groups.length > 1 ? "roster" : "subject";
    if (identity) {
      this.root.dataset.subject = identity.key;
      this.name.textContent = identity.name; this.caption.textContent = identity.caption;
      this.detail.textContent = identity.detail; paint(this.portrait, identity.art);
      this.health.hidden = !identity.health;
      if (!identity.health) this.healthText.textContent = "";
      if (identity.health) {
        const hp = identity.health;
        this.healthFill.style.width = `${Math.max(0, Math.min(100, hp.current / Math.max(1, hp.max) * 100))}%`;
        this.healthText.textContent = `${Math.ceil(hp.current)} / ${hp.max}`;
      }
      if (identity.inspection) {
        paint(this.inspectionArt, identity.inspection.art);
        this.inspectionName.textContent = identity.inspection.name;
        this.inspectionDetail.textContent = identity.inspection.detail;
      }
    }
    const previous = this.focusedKey;
    const live = new Set(groups.map(group => group.key));
    for (const [key, entry] of this.groups) if (!live.has(key)) { entry.button.remove(); this.groups.delete(key); }
    groups.forEach((group, index) => {
      let entry = this.groups.get(group.key);
      if (!entry) {
        const button = document.createElement("button"); button.type = "button";
        button.className = "hud-roster-unit";
        button.append(canvas("hud-roster-art"), text("hud-roster-name"), text("hud-roster-count"));
        entry = { button, group };
        const liveEntry = entry;
        button.addEventListener("click", () => liveEntry.group.activate());
        this.groups.set(group.key, entry);
      }
      entry.group = group;
      const button = entry.button;
      button.classList.toggle("focused", group.focused);
      button.setAttribute("aria-pressed", String(group.focused));
      button.setAttribute("aria-label", `${group.name} × ${group.count}`);
      button.dataset.selectionGroup = group.key;
      button.children[1]!.textContent = group.name;
      const count = button.children[2] as HTMLElement;
      count.textContent = String(group.count); count.hidden = group.count < 2;
      group.decorate(button); paint(button.children[0] as HTMLCanvasElement, group.art);
      if (this.grid.children[index] !== button) this.grid.insertBefore(button, this.grid.children[index] ?? null);
    });
    this.focusedKey = groups.find(group => group.focused)?.key;
    if (groups.length > 1 && previous && previous !== this.focusedKey) {
      const card = this.grid.querySelector<HTMLElement>(".focused");
      if (card && card.offsetTop < this.grid.scrollTop) this.grid.scrollTop = card.offsetTop;
      else if (card && card.offsetTop + card.offsetHeight > this.grid.scrollTop + this.grid.clientHeight)
        this.grid.scrollTop = card.offsetTop + card.offsetHeight - this.grid.clientHeight;
    }
  }
}
