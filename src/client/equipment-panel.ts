import { bakedAssetsVersion } from "./art/baked-assets";
import { formatMass } from "./format-mass";
import { SHIP_WEAPONS, isShipEquipment, shipMounts, shipPartMax } from "../shared/ship-equipment";
import { ARMOR_SLOTS, CARRY_SLOTS, ITEM_DEFS, canEquip, canExchange, exchangeRecipient, equipmentProtection, freeItemSlot, itemHands, itemSlot, itemsFor, shipHoldSlots, shipItemMass, transferRefusal, wieldRefusal, type ItemDestination } from '../shared/equipment';
import { localToWorld, shipPassengers, shipProfile } from '../shared/ship-geometry';
import { dropItemCommand } from './item-controls';
import { projectDeckPoint } from '../shared/decks';
import type { EquipmentSlot, GameCommand, GameSnapshot, PlayerId, Unit, WorldItem } from '../shared/types';
import { createI18n } from './i18n';
import { drawPaintedItem } from './art/items';
import { drawAtlasUnit, drawAtlasUnitPortrait } from './atlas-art';
import './equipment-panel.css';
type I18n = ReturnType<typeof createI18n>;
const labelKind = (kind: Parameters<I18n['label']>[0], i18n: I18n) => i18n.label(kind);
const SLOT_LABELS: Record<EquipmentSlot, [
    string,
    string
]> = { head: ['头部', 'Head'], body: ['身体', 'Body'], feet: ['脚部', 'Feet'], carry0: ['携行 1', 'Carry 1'], carry1: ['携行 2', 'Carry 2'], carry2: ['携行 3', 'Carry 3'], carry3: ['携行 4', 'Carry 4'] };
const SLOT_SHAPES: Record<string, string> = {
    head: 'M15 27V19a9 9 0 0 1 18 0v8M13 27h22M18 19h12M21 19v8',
    body: 'M16 11l8 4 8-4 8 9-7 5v13H15V25l-7-5z',
    feet: 'M15 10h10v16l9 5v7H12v-7l3-5z',
    hand: 'M16 32l17-20 3 3-18 20M12 31l9 8M12 39l5-5',
    carry: 'M14 14h20v22H14zM14 20h20M21 14v22M27 14v22',
    mount: 'M9 22h27v8H9zM31 22l6-3v14l-6-3M15 30v5M30 30v5M12 38h22',
};
function slotIcon(shape: string) { return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path d="${SLOT_SHAPES[shape] ?? SLOT_SHAPES.carry}" fill="none" stroke="white" stroke-width="2" stroke-linejoin="round"/></svg>`)}")`; }
const FEEDBACK: Record<string, [
    string,
    string
]> = {
    'A heavy weapon needs all four carrying positions': ['搬运火炮需要先腾空四个携行位', 'Clear all four carrying positions to haul this weapon'],
    'This weapon does not fit this ship position': ['这类武器不能安装在这个炮位', 'This weapon is incompatible with this fitting'],
    'This fitting is occupied': ['炮位已占用，请先拆下原武器', 'Fitting occupied; remove its weapon first'],
    'Clear the deck around this fitting first': ['这个炮位被士兵挡住，请先让开甲板空间', 'Soldiers are blocking the fitting; clear the deck first'],
    'Move closer before exchanging items': ['距离不足，请让人物靠近船只或登船', 'Move closer to the ship or board it first'],
    'Ship weapons can only fire from a ship fitting': ['船用武器只能安装在船只炮位上使用，人物只能搬运', 'Ship weapons need a ship fitting; characters can only haul them'],
    'This item does not fit that equipment position': ['物品不能穿在这个位置', 'This item does not fit that position'],
    'That position is occupied; move its item first': ['位置已被占用，请先收起原物品', 'Position occupied; stow its item first'],
    'That hold position is occupied': ['这个船舱格已经有物品', 'Hold position occupied'],
    'No room in the hold': ['船舱没有空位', 'The hold is full'],
    'The ship cannot carry more weight': ['超过船只载重', 'The ship cannot carry more weight'],
    'Move the item to a carrying position first': ['先将物品收进携行位，再拿到手上', 'Stow the item in a carrying position first'],
    'A two-handed weapon goes in the main hand': ['双手武器需要放到主手', 'Place a two-handed weapon in the main hand'],
    'Stow the two-handed weapon first': ['请先收起双手武器', 'Stow the two-handed weapon first'],
};
/** A persistent dialog: simulation frames update values without replacing a drag source. */
export class EquipmentPanel {
    readonly root = document.createElement('section');
    private snapshot: GameSnapshot | undefined;
    private owner: PlayerId = 'player';
    private unitId: string | undefined;
    private shipId: string | undefined;
    private contextIds: string[] = [];
    private shipContext = false;
    private fingerprint = '';
    private dragging: string | undefined;
    private crewDrag: string | undefined;
    private pointerDrag: { id: string; x: number; y: number; active: boolean; ghost?: HTMLElement; target?: HTMLElement | undefined } | undefined;
    private dropTargets = new WeakMap<HTMLElement, { destination: ItemDestination | undefined; hand: 'right' | 'left' | undefined }>();
    private suppressClickUntil = 0;
    private selectedItem: string | undefined;
    private holdPage = 0;
    private activePane: 'character' | 'hold' | 'ship' = 'hold';
    private open = false;
    constructor(private i18n: () => I18n, private send: (command: GameCommand) => void, private use?: (item: WorldItem, unit: Unit) => void) {
        this.root.className = 'equipment-panel';
        this.root.hidden = true;
        this.root.setAttribute('role', 'dialog');
        this.root.setAttribute('aria-label', 'Equipment and ship hold');
        this.root.addEventListener('keydown', event => { event.stopPropagation(); if (event.key === 'Escape')
            this.close(); });
        this.root.addEventListener('pointerdown', event => event.stopPropagation());
        this.root.addEventListener('dragend', () => { this.dragging = undefined; this.render(); });
        document.body.append(this.root);
        new ResizeObserver(() => { if (this.open) this.render(); }).observe(this.root);
    }
    isOpen() { return this.open; }
    close() { this.open = false; this.root.hidden = true; this.clearPointerDrag(); this.crewDrag=undefined; }
    update(snapshot: GameSnapshot | undefined, owner: PlayerId) { this.snapshot = snapshot; this.owner = owner; if (!snapshot) {
        this.close();
        return;
    } if (this.open)
        this.render(); }
    show(selected: Unit[]) {
        if (!this.snapshot)
            return;
        const own = selected.filter(unit => unit.owner === this.owner), ship = own.find(unit => shipProfile(unit));
        const unit = own.find(canEquip) ?? (ship && shipPassengers(this.snapshot.units, ship).find(unit => unit.owner === this.owner && canEquip(unit)));
        this.contextIds = own.filter(canEquip).map(unit => unit.id);
        this.shipContext = !!ship;
        this.unitId = unit?.id;
        this.shipId = ship?.id ?? unit?.deck?.shipId ?? this.snapshot.units.find(candidate => candidate.owner === this.owner && shipProfile(candidate) && unit && canExchange(this.snapshot!, unit, candidate))?.id;
        this.open = true;
        this.activePane = ship ? 'hold' : 'character';
        this.selectedItem = undefined;
        this.holdPage = 0;
        this.root.hidden = false;
        this.fingerprint = '';
        this.render();
        this.root.querySelector<HTMLButtonElement>('.equipment-close')?.focus();
    }
    private text(zh: string, en: string) { return this.i18n().locale === 'zh' ? zh : en; }
    private name(item: WorldItem) { return item.kind === 'issuedWeapon' && item.weaponKind ? `${labelKind(item.weaponKind, this.i18n())} · ${this.text('制式武器', 'Service weapon')}` : labelKind(item.kind, this.i18n()); }
    private feedback(message: string) { const node = this.root.querySelector<HTMLElement>('[data-equipment-feedback]'); if (node) {
        const translated = FEEDBACK[message];
        node.textContent = translated ? this.text(...translated) : message;
        node.classList.add('invalid');
    } }
    private command(command: GameCommand) { this.send(command); const node = this.root.querySelector<HTMLElement>('[data-equipment-feedback]'); if (node) {
        node.textContent = command.type==='move' ? this.text('已更新船员布阵', 'Crew position ordered') : this.text('已发出物品操作', 'Item action sent');
        node.classList.remove('invalid');
    } }
    private transfer(item: WorldItem, destination: ItemDestination) {
        const refusal = transferRefusal(this.snapshot!, this.owner, item.id, destination);
        if (refusal) {
            this.feedback(refusal);
            return;
        }
        this.command({ type: 'transferItem', itemId: item.id, destination });
    }
    private wield(itemId: string | undefined, hand: 'right' | 'left') {
        if (!this.unitId)
            return;
        const refusal = wieldRefusal(this.snapshot!, this.owner, this.unitId, itemId, hand);
        if (refusal) {
            this.feedback(refusal);
            return;
        }
        this.command({ type: 'wieldItem', unitId: this.unitId, ...(itemId ? { itemId } : {}), hand });
    }
    private quickTransfer(item: WorldItem) {
        const ship = this.snapshot!.units.find(unit => unit.id === this.shipId);
        const unit = item.shipId && ship ? exchangeRecipient(this.snapshot!,this.owner,ship,item.kind,this.unitId) : this.snapshot!.units.find(unit => unit.id === this.unitId);
        if (item.shipId && unit) {
            this.unitId=unit.id;
            const slot = freeItemSlot(this.snapshot!, unit, item.kind);
            if (!slot) {
                this.feedback(this.text('人物没有兼容的空位', 'No compatible equipment position is free'));
                return;
            }
            this.transfer(item, { unitId: unit.id, slot });
        }
        else if (ship) {
            if(item.shipId===ship.id){this.feedback(this.text('附近没有能接收该物品的人物空位','No nearby character has room for this item'));return;}
            const slot = Array.from({ length: shipHoldSlots(ship) }, (_, i) => i).find(slot => !transferRefusal(this.snapshot!, this.owner, item.id, { shipId: ship.id, slot }));
            if (slot === undefined) {
                this.feedback('No room in the hold');
                return;
            }
            this.transfer(item, { shipId: ship.id, slot });
        }
        else
            this.feedback(this.text('选择一艘己方船只以交换物品', 'Choose your ship to exchange items'));
    }
    private itemButton(item: WorldItem) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'equipment-item';
        button.dataset.itemId = item.id;
        // Pointer capture keeps the drag intact while the match continues to run,
        // and also supports touch/pen without relying on browser HTML drag timing.
        button.draggable = false;
        button.title = this.name(item);
        button.setAttribute('aria-label', this.name(item));
        const art = document.createElement('canvas');
        art.width = art.height = 80;
        const ctx = art.getContext('2d')!;
        drawPaintedItem(ctx, item.kind, { x: 40, y: 40 }, 58);
        button.append(art);
        const name = document.createElement('span');
        name.textContent = this.name(item);
        button.append(name);
        button.addEventListener('pointerdown', event => {
            if (event.button !== 0) return;
            button.setPointerCapture(event.pointerId);
            this.dragging = item.id;
            this.pointerDrag = { id: item.id, x: event.clientX, y: event.clientY, active: false };
        });
        button.addEventListener('pointermove', event => {
            const drag = this.pointerDrag;
            if (!drag || drag.id !== item.id) return;
            if (!drag.active && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
            if (!drag.active) {
                drag.active = true;
                const ghost = document.createElement('div');
                ghost.className = 'equipment-drag-ghost';
                const canvas = document.createElement('canvas');
                canvas.width = canvas.height = 80;
                drawPaintedItem(canvas.getContext('2d')!, item.kind, { x: 40, y: 40 }, 58);
                ghost.append(canvas);
                document.body.append(ghost);
                drag.ghost = ghost;
            }
            drag.ghost!.style.left = `${event.clientX + 12}px`;
            drag.ghost!.style.top = `${event.clientY + 12}px`;
            drag.target?.classList.remove('drop-ready');
            const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('.equipment-cell');
            drag.target = target && this.root.contains(target) ? target : undefined;
            drag.target?.classList.add('drop-ready');
        });
        button.addEventListener('pointerup', event => {
            const drag = this.pointerDrag;
            if (!drag || drag.id !== item.id) return;
            const destination = drag.active && drag.target ? this.dropTargets.get(drag.target) : undefined;
            if (drag.active) {
                this.suppressClickUntil = performance.now() + 150;
                event.preventDefault();
            }
            this.clearPointerDrag();
            if (destination?.hand) this.wield(item.id, destination.hand);
            else if (destination?.destination) this.transfer(item, destination.destination);
            this.render();
        });
        button.addEventListener('pointercancel', () => { this.clearPointerDrag(); this.render(); });
        button.addEventListener('dblclick', () => this.quickTransfer(item));
        button.addEventListener('click', event => { if (performance.now() < this.suppressClickUntil) return; if (event.ctrlKey) { this.quickTransfer(item); return; } this.selectedItem = item.id; this.selectItem(item); });
        return button;
    }
    private selectItem(item: WorldItem) {
        this.root.dataset.itemSelected='true';
        for (const button of this.root.querySelectorAll<HTMLElement>('.equipment-item'))
            button.classList.toggle('chosen', button.dataset.itemId === item.id);
        const actions = this.root.querySelector<HTMLElement>('[data-equipment-actions]')!; actions.replaceChildren(); const description = document.createElement('p'); const def = ITEM_DEFS[item.kind]; description.textContent = `${this.name(item)} · ${formatMass(def.mass)} kg${isShipEquipment(item.kind) ? this.text(' · 搬运占四格 · 安装后使用', ' · Four carrying slots · Fire from a fitting') : itemHands(item) === 2 ? this.text(' · 双手', ' · Two-handed') : ''}`; actions.append(description); this.action(actions, this.text('转移 ⇄', 'Transfer ⇄'), () => this.quickTransfer(item)); if (isShipEquipment(item.kind) && this.shipId) {
            const ship = this.snapshot!.units.find(unit => unit.id === this.shipId)!;
            if (item.mountId)
                this.action(actions, this.text('拆到船舱', 'Stow in hold'), () => this.stowFitting(item));
            const mounts = shipMounts(ship).filter(mount => mount.accepts.includes(item.kind as never) && !this.snapshot!.items.some(other => other.shipId === ship.id && other.mountId === mount.id));
            if (mounts.length) {
                const select = document.createElement('select');
                select.className = 'equipment-install-select';
                select.setAttribute('aria-label', this.text('安装炮位', 'Install fitting'));
                for (const mount of mounts) {
                    const option = document.createElement('option');
                    option.value = mount.id;
                    option.textContent = this.mountLabel(mount.id);
                    select.append(option);
                }
                actions.append(select);
                this.action(actions, this.text('安装', 'Install'), () => this.transfer(item, { shipId: ship.id, mountId: select.value }));
            }
        } if (item.carrierId === this.unitId) {
            if (!def.slot && !isShipEquipment(item.kind)) {
                this.action(actions, this.text('拿到主手', 'Main hand'), () => this.wield(item.id, 'right'));
                if (itemHands(item) === 1)
                    this.action(actions, this.text('拿到副手', 'Off hand'), () => this.wield(item.id, 'left'));
            }
            else if (def.slot) {
                const unit = this.snapshot!.units.find(unit => unit.id === this.unitId)!;
                this.action(actions, this.text('穿戴', 'Wear'), () => this.transfer(item, { unitId: unit.id, slot: def.slot! }));
            }
            if (!def.passive)
                this.action(actions, this.text('使用', 'Use'), () => { const unit = this.snapshot!.units.find(unit => unit.id === item.carrierId)!; if (this.use)
                    this.use(item, unit);
                else
                    this.command({ type: 'useItem', unitId: unit.id, itemId: item.id }); });
        }
        const carrier = this.snapshot!.units.find(unit => unit.id === (item.carrierId ?? item.shipId));
        if (carrier && (item.carrierId === carrier.id || item.shipId === this.shipId))
            this.action(actions, this.text('丢弃', 'Drop'), () => {
                this.command(dropItemCommand(item,carrier,this.snapshot!.units));
                this.selectedItem = undefined;
            });
    }
    private clearPointerDrag() {
        this.pointerDrag?.ghost?.remove();
        this.pointerDrag?.target?.classList.remove('drop-ready');
        this.pointerDrag = undefined;
        this.dragging = undefined;
    }
    private stowFitting(item: WorldItem) {
        const snapshot = this.snapshot!, ship = snapshot.units.find(unit => unit.id === item.shipId);
        if(!ship)return;
        const slot = Array.from({ length: shipHoldSlots(ship) }, (_, i) => i).find(slot => !transferRefusal(snapshot, this.owner, item.id, { shipId: ship.id, slot }));
        if (slot === undefined) {
            this.feedback('No room in the hold');
            return;
        }
        this.transfer(item, { shipId: ship.id, slot });
    }
    private action(parent: HTMLElement, label: string, run: () => void) { const button = document.createElement('button'); button.type = 'button'; button.className = 'equipment-action'; button.textContent = label; button.addEventListener('click', run); parent.append(button); }
    private cell(label: string, item: WorldItem | undefined, destination?: ItemDestination, hand?: 'right' | 'left') {
        const cell = document.createElement('div');
        cell.className = 'equipment-cell';
        this.dropTargets.set(cell, { destination, hand });
        cell.tabIndex = 0;
        cell.setAttribute('aria-label', label);
        cell.classList.toggle('empty', !item);
        const shape = hand ? 'hand' : destination && 'mountId' in destination ? 'mount' : destination && 'slot' in destination && typeof destination.slot === 'string' ? destination.slot : 'carry';
        cell.style.setProperty('--equipment-slot-icon', slotIcon(shape));
        const title = document.createElement('small');
        title.textContent = label;
        cell.append(title);
        if (hand) {
            cell.classList.add('equipment-hand');
            const name = document.createElement('span');
            name.className = 'equipment-hand-name';
            name.textContent = item ? this.name(item) : this.text('空手', 'Empty');
            name.title = name.textContent;
            cell.append(name);
        }
        else if (item)
            cell.append(this.itemButton(item));
        const drop = (event: DragEvent) => { event.preventDefault(); cell.classList.remove('drop-ready'); const id = event.dataTransfer?.getData('application/x-sketch-item') || this.dragging; const held = this.snapshot!.items.find(item => item.id === id); if (held) {
            if (hand)
                this.wield(held.id, hand);
            else if (destination)
                this.transfer(held, destination);
        } };
        cell.addEventListener('dragover', event => { event.preventDefault(); cell.classList.add('drop-ready'); });
        cell.addEventListener('dragleave', () => cell.classList.remove('drop-ready'));
        cell.addEventListener('drop', drop);
        return cell;
    }
    private render() {
        const snapshot = this.snapshot;
        if (!snapshot || !this.open) return;
        const own = snapshot.units.filter(unit => unit.owner === this.owner && unit.hp > 0);
        const contextShip = own.find(unit => unit.id === this.shipId);
        const characters = own.filter(unit => canEquip(unit) && (this.shipContext ? contextShip && canExchange(snapshot, unit, contextShip) : this.contextIds.includes(unit.id)));
        if (this.shipContext && !characters.some(unit => unit.id === this.unitId)) this.unitId = characters[0]?.id;
        const unit = own.find(unit => unit.id === this.unitId), ship = own.find(unit => unit.id === this.shipId && shipProfile(unit));
        if (!unit && !ship) { this.close(); return; }
        this.root.dataset.mode = ship ? 'ship' : 'character';
        const narrow = !!ship && this.root.clientWidth < 900, short = this.root.clientHeight < 500;
        const holdColumns = narrow ? 4 : 8;
        // Whole rows are paged, so a numbered position never changes identity.
        const holdRows = Math.max(1, Math.floor((this.root.clientHeight - (narrow ? 294 : 254)) / 55));
        const capacity = holdColumns * holdRows, total = ship ? shipHoldSlots(ship) : 0;
        const pageCount = Math.max(1, Math.ceil(total / capacity));
        this.holdPage = Math.min(this.holdPage, pageCount - 1);
        const key = JSON.stringify([narrow, short, holdRows, this.holdPage, this.activePane, bakedAssetsVersion(), this.i18n().locale, this.unitId, this.shipId,
            characters.map(unit => unit.id), ship && shipPassengers(snapshot.units,ship).map(crew=>[crew.id,crew.owner]), snapshot.items.filter(item => unit && item.carrierId === unit.id || ship && item.shipId === ship.id).map(item => [item.id, item.slot, item.holdSlot, item.mountId]), unit?.hands]);
        if (key === this.fingerprint || this.dragging || this.crewDrag) { this.updateValues(unit, ship); return; }
        this.fingerprint = key;
        this.root.dataset.pane = this.activePane;
        this.root.dataset.compact = String(narrow);
        this.root.dataset.short = String(short);
        this.root.replaceChildren();
        const header = document.createElement('header');
        const crest = document.createElement('span'); crest.className = 'equipment-crest'; crest.setAttribute('aria-hidden', 'true'); crest.textContent = '⚔';
        const title = document.createElement('div'); title.innerHTML = `<small>${this.text('军械', 'EQUIPMENT')}</small><h2>${ship ? labelKind(ship.kind, this.i18n()) + this.text(' · 船舱与炮位', ' · Hold & fittings') : labelKind(unit!.kind, this.i18n()) + this.text(' · 装备', ' · Equipment')}</h2>`;
        const close = document.createElement('button'); close.type = 'button'; close.className = 'equipment-close'; close.textContent = '×';
        close.setAttribute('aria-label', this.text('关闭', 'Close')); close.addEventListener('click', () => this.close());
        header.append(crest, title, close); this.root.append(header);
        const tabs = document.createElement('nav'); tabs.className = 'equipment-pane-tabs'; tabs.setAttribute('aria-label', this.text('装备面板', 'Equipment panes'));
        for (const [pane, zh, en] of [['character', '人物', 'Character'], ['hold', '船舱', 'Hold'], ['ship', '船体', 'Ship']] as const) {
            const button = document.createElement('button'); button.type = 'button'; button.textContent = this.text(zh, en);
            button.setAttribute('aria-pressed', String(this.activePane === pane)); button.addEventListener('click', () => { this.activePane = pane; this.render(); }); tabs.append(button);
        }
        this.root.append(tabs);
        const columns = document.createElement('div'); columns.className = 'equipment-columns'; this.root.append(columns);
        const character = document.createElement('section'); character.className = 'equipment-character'; columns.append(character);
        this.selector(character, this.shipContext ? this.text('船员', 'Crew') : this.text('人物', 'Character'), characters, this.unitId, id => { this.unitId = id; this.render(); });
        if (unit) {
            const positions = document.createElement('div'); positions.className = 'equipment-positions'; character.append(positions);
            const outfit = document.createElement('div'); outfit.className = 'equipment-outfit';
            const arms = document.createElement('div'); arms.className = 'equipment-carried';
            for (const [column, zh, en] of [[outfit, '穿戴', 'Outfit'], [arms, '携行', 'Arms']] as const) {
                const heading = document.createElement('h3'); heading.textContent = this.text(zh, en); column.append(heading); positions.append(column);
            }
            const carriedItems = itemsFor(snapshot, unit);
            for (const slot of ARMOR_SLOTS) outfit.append(this.cell(this.text(...SLOT_LABELS[slot]), carriedItems.find(item => itemSlot(snapshot, unit, item) === slot), { unitId: unit.id, slot }));
            const figure = document.createElement('canvas'); figure.width = 240; figure.height = 360; figure.className = 'equipment-figure';
            drawAtlasUnit(figure.getContext('2d')!, unit.kind, {x:120,y:245}, 3.5, '#819b82'); positions.append(figure);
            const heavy = carriedItems.find(item => ITEM_DEFS[item.kind].span === 4);
            if (heavy) {
                const cell = this.cell(this.text('携行 1–4 · 搬运', 'Arms 1–4 · Hauling'), heavy, { unitId: unit.id, slot: 'carry0' });
                cell.classList.add('equipment-four-slots'); arms.append(cell);
            } else for (const slot of CARRY_SLOTS) {
                const item = carriedItems.find(item => itemSlot(snapshot, unit, item) === slot);
                const held = item?.id === unit.hands?.right ? this.text('主手', 'Main') : item?.id === unit.hands?.left ? this.text('副手', 'Off') : this.text('背挂', 'Stowed');
                arms.append(this.cell(`${Number(slot.slice(5)) + 1} · ${item ? held : this.text('空位', 'Empty')}`, item, { unitId: unit.id, slot }));
            }
            const hands = document.createElement('div'); hands.className = 'equipment-hands'; character.append(hands);
            for (const hand of ['right', 'left'] as const) {
                const item = snapshot.items.find(item => item.id === unit.hands?.[hand]);
                const main = snapshot.items.find(item => item.id === unit.hands?.right);
                const cell = this.cell(hand === 'right' ? this.text('主手', 'Main') : this.text('副手', 'Off'), item, undefined, hand);
                if (hand === 'left' && main && itemHands(main) === 2) cell.querySelector('.equipment-hand-name')!.textContent = this.text('双手占用', 'Two-handed');
                hands.append(cell);
                if (item) this.action(cell, this.text('收起', 'Stow'), () => this.wield(undefined, hand));
            }
            const stats = document.createElement('div'); stats.dataset.equipmentStats = '';
            for (const [key, label] of [['health', this.text('生命', 'Health')], ['attack', this.text('攻击', 'Attack')], ['protection', this.text('减伤', 'Protection')]] as const) {
                const stat = document.createElement('div'); stat.className = 'equipment-stat';
                const caption = document.createElement('small'); caption.textContent = label;
                const value = document.createElement('strong'); value.dataset.stat = key; stat.append(caption, value); stats.append(stat);
            }
            character.append(stats);
        } else this.emptyNote(character, this.text('附近没有己方人物。船舱整理与炮位配置可以直接操作。', 'No friendly character nearby. Hold and fitting actions remain available.'));
        const cargo = document.createElement('section'); cargo.className = 'equipment-cargo'; if (ship) columns.append(cargo);
        this.selector(cargo, this.text('船舱', 'Cargo hold'), ship ? [ship] : [], this.shipId, () => {});
        const access = document.createElement('p'); access.dataset.equipmentAccess = ''; cargo.append(access);
        if (ship) {
            const grid = document.createElement('div'); grid.className = 'equipment-hold'; grid.style.setProperty('--hold-columns', String(holdColumns));
            const first = this.holdPage * capacity, end = Math.min(total, first + capacity);
            grid.style.setProperty('--hold-rows', String(Math.ceil((end - first) / holdColumns))); cargo.append(grid);
            // Split a large item at both row and page boundaries. Every segment
            // refers to the same item and its real position, including later pages.
            for (let i = first; i < end;) {
                const occupying = snapshot.items.find(item => item.shipId === ship.id && item.holdSlot !== undefined && i >= item.holdSlot && i < item.holdSlot + (ITEM_DEFS[item.kind].span ?? 1));
                const itemStart = occupying?.holdSlot ?? i, span = occupying ? ITEM_DEFS[occupying.kind].span ?? 1 : 1;
                const width = Math.min(itemStart + span - i, holdColumns - i % holdColumns, end - i);
                const label = width > 1 ? `${i + 1}–${i + width}` : String(i + 1);
                const cell = this.cell(label, occupying, { shipId: ship.id, slot: i }); cell.dataset.holdSlot = String(i); cell.dataset.holdSpan = String(width);
                cell.style.gridColumn = `${(i - first) % holdColumns + 1} / span ${width}`; cell.style.gridRow = String(Math.floor((i - first) / holdColumns) + 1);
                if (span > 1) { cell.classList.add('equipment-heavy'); cell.classList.toggle('equipment-heavy-wide', width >= 3); if (i > itemStart) { cell.classList.add('equipment-continuation'); cell.querySelector('small')!.textContent += this.text(' · 续', ' · cont.'); } }
                grid.append(cell); i += width;
            }
            const pages = document.createElement('div'); pages.className = 'equipment-pages';
            const previous = document.createElement('button'); previous.type = 'button'; previous.textContent = '‹'; previous.setAttribute('aria-label', this.text('上一页船舱', 'Previous hold page')); previous.disabled = this.holdPage === 0;
            previous.addEventListener('click', () => { this.holdPage--; this.render(); });
            const range = document.createElement('span'); range.textContent = `${first + 1}–${end} / ${total} ${this.text('格', 'positions')}`;
            const next = document.createElement('button'); next.type = 'button'; next.textContent = '›'; next.setAttribute('aria-label', this.text('下一页船舱', 'Next hold page')); next.disabled = this.holdPage === pageCount - 1;
            next.addEventListener('click', () => { this.holdPage++; this.render(); }); pages.append(previous, range, next); cargo.append(pages);
            const load = document.createElement('div'); load.className = 'equipment-load';
            const text = document.createElement('p'); text.dataset.equipmentLoad = ''; const meter = document.createElement('span'); meter.className = 'equipment-load-meter'; meter.append(document.createElement('i'));
            load.append(text, meter); cargo.append(load);
        } else { this.emptyNote(cargo, this.text('暂无己方船只，人物仍可穿戴或切换武器。', 'No friendly ship. You can still equip the character.')); }
        const vessel = document.createElement('section'); vessel.className = 'equipment-vessel'; if (ship) columns.append(vessel);
        const shipTitle = document.createElement('h3'); shipTitle.className = 'equipment-section-title'; shipTitle.textContent = this.text('船体装备', 'SHIP FITTINGS'); vessel.append(shipTitle);
        if (ship) {
            const fittings = document.createElement('div'); fittings.className = 'equipment-fittings'; fittings.style.setProperty('--fitting-rows', String(Math.ceil(shipMounts(ship).length / 2))); vessel.append(fittings);
            const profile = shipProfile(ship)!;
            const scene = document.createElement('div'); scene.className = 'equipment-deck-scene'; fittings.append(scene);
            const plan = document.createElement('div'); plan.className = 'equipment-deck-plan';
            const scale=Math.min(148/profile.beam,251.6/profile.length);
            const points=(polygon:typeof profile.hull)=>polygon.map(p=>`${100+p.y*scale},${170-p.x*scale}`).join(' ');
            const obstacles=profile.obstacles.filter(o=>o.type!=='weapon').map(o=>`<circle cx="${100+o.y*scale}" cy="${170-o.x*scale}" r="${o.radius*scale}" fill="#27241b" stroke="#907b51" stroke-width="2"/>`).join('');
            plan.innerHTML = `<svg viewBox="0 0 200 340" aria-hidden="true"><defs><pattern id="deck-planks" width="12" height="12" patternUnits="userSpaceOnUse"><rect width="12" height="12" fill="#493b29"/><path d="M0 0V12 M1 0V12" stroke="#89704b" stroke-width="1"/></pattern></defs><polygon points="${points(profile.hull)}" fill="#28251e" stroke="#a08754" stroke-width="4"/><polygon points="${points(profile.deck)}" fill="url(#deck-planks)" stroke="#645237" stroke-width="2"/>${obstacles}</svg>`; scene.append(plan);
            for (const mount of shipMounts(ship)) {
                const item = snapshot.items.find(item => item.shipId === ship.id && item.mountId === mount.id);
                const cell = this.cell(this.shortMountLabel(mount.id), item, { shipId: ship.id, mountId: mount.id }); cell.dataset.mountId = mount.id;
                cell.classList.add(mount.id === 'bow' || mount.id === 'aft' ? 'equipment-mount-center' : mount.id.startsWith('port') ? 'equipment-mount-port' : 'equipment-mount-starboard');
                cell.style.left = `${50 + mount.y*scale/2}%`;
                cell.style.top = `${50 - mount.x*scale/3.4}%`;
                cell.title = `${mount.accepts.map(kind => labelKind(kind, this.i18n())).join(' / ')} · ${this.text('射界', 'Firing arc')} ±${Math.round(mount.halfArc * 180 / Math.PI)}°`;
                if (item) { const hp = document.createElement('small'); hp.dataset.weaponDurability = item.id; cell.append(hp); } scene.append(cell);
            }
            for (const crew of shipPassengers(snapshot.units,ship)) {
                const token = document.createElement('button'); token.type='button'; token.className='equipment-crew'; token.dataset.crewId=crew.id;
                token.title=labelKind(crew.kind,this.i18n()); token.setAttribute('aria-label',this.text('调整船员位置：','Move crew: ')+token.title);
                token.setAttribute('aria-pressed',String(crew.id===this.unitId));
                const portrait=document.createElement('canvas');portrait.width=portrait.height=48;
                drawAtlasUnitPortrait(portrait.getContext('2d')!,crew.kind,0,0,48,'#a5b394');token.append(portrait);
                const position=(event:PointerEvent)=>{const box=scene.getBoundingClientRect();return {x:(170-(event.clientY-box.top)/box.height*340)/scale,y:((event.clientX-box.left)/box.width*200-100)/scale};};
                let origin:{x:number;y:number}|undefined, offset={x:0,y:0};
                const destination=(event:PointerEvent)=>{const latestShip=this.snapshot!.units.find(unit=>unit.id===ship.id),latestCrew=this.snapshot!.units.find(unit=>unit.id===crew.id),raw=position(event);return latestShip && latestCrew ? projectDeckPoint(latestShip,latestCrew,{x:raw.x+offset.x,y:raw.y+offset.y},this.snapshot!.units) : undefined;};
                token.addEventListener('pointerdown',event=>{if(crew.owner!==this.owner || event.button!==0)return;origin={x:event.clientX,y:event.clientY};const raw=position(event);const latest=this.snapshot!.units.find(unit=>unit.id===crew.id)!;offset={x:latest.deck!.x-raw.x,y:latest.deck!.y-raw.y};this.crewDrag=crew.id;token.setPointerCapture(event.pointerId);event.preventDefault();});
                token.addEventListener('pointermove',event=>{if(this.crewDrag!==crew.id)return;const point=destination(event);if(!point)return;token.style.left=`${50+point.y*scale/2}%`;token.style.top=`${50-point.x*scale/3.4}%`;token.classList.remove('invalid');});
                token.addEventListener('pointerup',event=>{if(this.crewDrag!==crew.id)return;this.crewDrag=undefined;const moved=origin && Math.hypot(event.clientX-origin.x,event.clientY-origin.y)>4;origin=undefined;
                    if(!moved){if(crew.owner===this.owner){this.unitId=crew.id;this.render();}return;}
                    const point=destination(event),latestShip=this.snapshot!.units.find(unit=>unit.id===ship.id),latestCrew=this.snapshot!.units.find(unit=>unit.id===crew.id);
                    if(point && latestShip && latestCrew?.deck?.shipId===latestShip.id)this.command({type:'move',unitIds:[crew.id],...localToWorld(latestShip,point)});
                    else this.feedback(this.text('这里没有足够的甲板空间','Not enough clear deck space here'));
                    this.updateValues(unit,ship);
                });
                token.addEventListener('pointercancel',()=>{this.crewDrag=undefined;this.updateValues(unit,ship);});scene.append(token);
            }
            const parts = document.createElement('p'); parts.dataset.equipmentParts = ''; vessel.append(parts);
        } else this.emptyNote(vessel, this.text('选择船只后查看炮位、船帆与船舵。', 'Select a ship to view fittings, rigging and rudder.'));
        const actions = document.createElement('footer'); actions.dataset.equipmentActions = '';
        const hint = document.createElement('p'); hint.className = 'equipment-action-hint'; hint.textContent = this.text('选择物品查看重量和操作；人物没有背包。', 'Select an item for its weight and actions. Characters have no backpack.'); actions.append(hint); this.root.append(actions);
        const feedback = document.createElement('p'); feedback.dataset.equipmentFeedback = ''; feedback.setAttribute('role', 'status');
        feedback.textContent = this.text('拖拽放置 · Ctrl + 单击 / 双击转移 · Esc 返回战场', 'Drag to place · Ctrl-click / double-click to transfer · Esc to return'); this.root.append(feedback);
        const selected = snapshot.items.find(item => item.id === this.selectedItem && (unit && item.carrierId === unit.id || ship && item.shipId === ship.id));
        if (selected) this.selectItem(selected); else {this.selectedItem = undefined;delete this.root.dataset.itemSelected;}
        this.updateValues(unit, ship);
    }
    private emptyNote(parent: HTMLElement, text: string) { const note = document.createElement('p'); note.className = 'equipment-empty-note'; note.textContent = text; parent.append(note); }
    private mountLabel(id: string) { return id === 'bow' ? this.text('艏部炮位', 'Bow fitting') : id === 'aft' ? this.text('中后部炮位', 'Aft fitting') : id.startsWith('port') ? `${this.text('左舷炮位', 'Port fitting')} ${Number(id.slice(4)) + 1}` : `${this.text('右舷炮位', 'Starboard fitting')} ${Number(id.slice(9)) + 1}`; }
    private shortMountLabel(id: string) { return id === 'bow' ? this.text('船首', 'Bow') : id === 'aft' ? this.text('船尾', 'Aft') : id.startsWith('port') ? `${this.text('左', 'Port ')}${Number(id.slice(4)) + 1}` : `${this.text('右', 'Stbd ')}${Number(id.slice(9)) + 1}`; }
    private selector(parent: HTMLElement, label: string, units: Unit[], selected: string | undefined, change: (id: string) => void) {
        const context = document.createElement('div'); context.className = 'equipment-context';
        const current = units.find(unit => unit.id === selected), index = units.findIndex(unit => unit.id === selected);
        if (current && canEquip(current)) {
            const portrait = document.createElement('canvas'); portrait.width = portrait.height = 80;
            drawAtlasUnitPortrait(portrait.getContext('2d')!, current.kind, 0, 0, 80, '#80988e'); context.append(portrait);
        }
        const name = document.createElement('div'), caption = document.createElement('small'), title = document.createElement('strong');
        caption.textContent = label; title.textContent = current ? `${labelKind(current.kind, this.i18n())} · ${String(index + 1).padStart(2, '0')}` : this.text('未选择', 'Not selected');
        name.append(caption, title); context.append(name);
        for (const [delta, symbol, zh, en] of (units.length > 1 ? [[-1, '‹', '上一个', 'Previous'], [1, '›', '下一个', 'Next']] : []) as [number,string,string,string][]) {
            const button = document.createElement('button'); button.type = 'button'; button.textContent = symbol;
            button.setAttribute('aria-label', `${this.text(zh, en)}${label}`); button.disabled = units.length === 0 || (units.length === 1 && !!current);
            button.addEventListener('click', () => change(units[(index + delta + units.length) % units.length]!.id)); context.append(button);
        }
        parent.append(context);
    }
    private updateValues(unit: Unit | undefined, ship: Unit | undefined) {
        const scene=this.root.querySelector<HTMLElement>('.equipment-deck-scene');
        if(scene && ship){
            const frame=scene.parentElement!,width=Math.min(frame.clientWidth,frame.clientHeight*200/340);
            scene.style.width=`${width}px`;scene.style.height=`${width*340/200}px`;
            const p=shipProfile(ship)!,scale=Math.min(148/p.beam,251.6/p.length);
            for(const token of scene.querySelectorAll<HTMLElement>('[data-crew-id]')){
                const crew=this.snapshot!.units.find(unit=>unit.id===token.dataset.crewId);
                if(!crew?.deck || this.crewDrag===crew.id)continue;
                token.style.left=`${50+crew.deck.y*scale/2}%`;token.style.top=`${50-crew.deck.x*scale/3.4}%`;
                token.style.width=token.style.height=`${Math.max(18,crew.radius*2*scale*width/200)}px`;
                token.classList.remove('invalid');
            }
        }
        const stats = this.root.querySelector<HTMLElement>('[data-equipment-stats]');
        if (stats && unit) {
            stats.querySelector('[data-stat=health]')!.textContent = `${Math.ceil(unit.hp)} / ${unit.maxHp}`;
            stats.querySelector('[data-stat=attack]')!.textContent = String(unit.attackDamage);
            stats.querySelector('[data-stat=protection]')!.textContent = `${Math.round(equipmentProtection(this.snapshot!, unit) * 100)}%`;
        }
        const access = this.root.querySelector<HTMLElement>('[data-equipment-access]');
        if (access) {
            const ready = ship && (!unit || canExchange(this.snapshot!, unit, ship));
            access.textContent = ready ? this.text('交换通路畅通', 'Ready to exchange') : this.text('让人物靠近船只或登船后交换', 'Move the character closer or board to exchange');
            access.classList.toggle('invalid', !ready);
        }
        const parts = this.root.querySelector<HTMLElement>('[data-equipment-parts]');
        if (parts && ship) {
            const max = shipPartMax(ship);
            parts.textContent = `${this.text('船帆', 'Rigging')} ${Math.ceil(ship.shipParts?.rigging ?? max.rigging)} / ${max.rigging} · ${this.text('船舵', 'Rudder')} ${Math.ceil(ship.shipParts?.rudder ?? max.rudder)} / ${max.rudder}`;
            for (const item of this.snapshot!.items.filter(item => item.shipId === ship.id && item.mountId)) {
                const node = this.root.querySelector<HTMLElement>(`[data-weapon-durability="${item.id}"]`);
                if (node)
                    node.textContent = `${this.text('耐久', 'Durability')} ${Math.ceil(item.durability ?? SHIP_WEAPONS[item.kind as keyof typeof SHIP_WEAPONS].hp)} / ${SHIP_WEAPONS[item.kind as keyof typeof SHIP_WEAPONS].hp}`;
            }
        }
        const load = this.root.querySelector<HTMLElement>('[data-equipment-load]');
        if (load && ship) {
            const fill = this.root.querySelector<HTMLElement>('.equipment-load-meter > i');
            if (fill)
                fill.style.width = `${Math.min(100, (ship.sailing?.load ?? 0) / shipProfile(ship)!.loadCapacity * 100)}%`;
            load.textContent = `${this.text('船上装备', 'Equipment aboard')} ${formatMass(shipItemMass(this.snapshot!, ship))} kg · ${this.text('总载重', 'Payload')} ${formatMass(ship.sailing?.load ?? 0)} / ${formatMass(shipProfile(ship)!.loadCapacity)} kg`;
        }
    }
}
