import { bakedAssetsVersion } from "./art/baked-assets";
import { SHIP_WEAPONS, isShipEquipment, shipMounts, shipPartMax } from "../shared/ship-equipment";
import { ARMOR_SLOTS, CARRY_SLOTS, ITEM_DEFS, canEquip, canExchange, equipmentProtection, freeItemSlot, itemHands, itemSlot, itemsFor, shipHoldSlots, shipItemMass, transferRefusal, wieldRefusal, type ItemDestination } from '../shared/equipment';
import { shipPassengers, shipProfile } from '../shared/ship-geometry';
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
]> = { head: ['头部', 'Head'], body: ['身体', 'Body'], legs: ['腿部', 'Legs'], feet: ['脚部', 'Feet'], carry0: ['携行 1', 'Carry 1'], carry1: ['携行 2', 'Carry 2'], carry2: ['携行 3', 'Carry 3'], carry3: ['携行 4', 'Carry 4'] };
const SLOT_SHAPES: Record<string, string> = {
    head: 'M15 27V19a9 9 0 0 1 18 0v8M13 27h22M18 19h12M21 19v8',
    body: 'M16 11l8 4 8-4 8 9-7 5v13H15V25l-7-5z',
    legs: 'M15 10h18l2 28H25l-1-18-1 18H13z',
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
    'A crew member must be nearby to install or remove weapons': ['安装或拆卸需要附近的己方人员', 'A crew member must be nearby to install or remove weapons'],
    'Clear the deck around this fitting first': ['这个炮位被士兵挡住，请先让开甲板空间', 'Soldiers are blocking the fitting; clear the deck first'],
    'Move closer before exchanging items': ['距离不足，请让人物靠近船只或登船', 'Move closer to the ship or board it first'],
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
    private fingerprint = '';
    private dragging: string | undefined;
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
    }
    isOpen() { return this.open; }
    close() { this.open = false; this.root.hidden = true; this.dragging = undefined; }
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
        this.unitId = unit?.id;
        this.shipId = ship?.id ?? unit?.deck?.shipId ?? this.snapshot.units.find(candidate => candidate.owner === this.owner && shipProfile(candidate) && unit && canExchange(this.snapshot!, unit, candidate))?.id;
        this.open = true;
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
        node.textContent = this.text('已发出物品操作', 'Item action sent');
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
        const unit = this.snapshot!.units.find(unit => unit.id === this.unitId), ship = this.snapshot!.units.find(unit => unit.id === this.shipId);
        if (item.shipId && unit) {
            const slot = freeItemSlot(this.snapshot!, unit, item.kind);
            if (!slot) {
                this.feedback(this.text('人物没有兼容的空位', 'No compatible equipment position is free'));
                return;
            }
            this.transfer(item, { unitId: unit.id, slot });
        }
        else if (ship) {
            if (unit && !canExchange(this.snapshot!, unit, ship)) {
                this.feedback('Move closer before exchanging items');
                return;
            }
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
        button.draggable = true;
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
        button.addEventListener('dragstart', event => { this.dragging = item.id; event.dataTransfer?.setData('application/x-sketch-item', item.id); if (event.dataTransfer)
            event.dataTransfer.effectAllowed = 'move'; });
        button.addEventListener('dblclick', () => this.quickTransfer(item));
        button.addEventListener('click', () => { for (const other of this.root.querySelectorAll('.equipment-item.chosen'))
            other.classList.remove('chosen'); button.classList.add('chosen'); const actions = this.root.querySelector<HTMLElement>('[data-equipment-actions]')!; actions.replaceChildren(); const description = document.createElement('p'); const def = ITEM_DEFS[item.kind]; description.textContent = `${this.name(item)} · ${def.mass} kg${itemHands(item) === 2 ? this.text(' · 双手', ' · Two-handed') : ''}`; actions.append(description); this.action(actions, this.text('转移 ⇄', 'Transfer ⇄'), () => this.quickTransfer(item)); if (isShipEquipment(item.kind) && this.unitId && this.shipId) {
            const ship = this.snapshot!.units.find(unit => unit.id === this.shipId)!;
            for (const mount of shipMounts(ship).filter(mount => mount.accepts.includes(item.kind as never)))
                this.action(actions, `${this.text('安装到', 'Install at')} ${this.mountLabel(mount.id)}`, () => this.transfer(item, { shipId: ship.id, mountId: mount.id, installerId: this.unitId! }));
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
        } });
        return button;
    }
    private action(parent: HTMLElement, label: string, run: () => void) { const button = document.createElement('button'); button.type = 'button'; button.className = 'equipment-action'; button.textContent = label; button.addEventListener('click', run); parent.append(button); }
    private cell(label: string, item: WorldItem | undefined, destination?: ItemDestination, hand?: 'right' | 'left') {
        const cell = document.createElement('div');
        cell.className = 'equipment-cell';
        cell.tabIndex = 0;
        cell.setAttribute('aria-label', label);
        cell.classList.toggle('empty', !item);
        const shape = hand ? 'hand' : destination && 'mountId' in destination ? 'mount' : destination && 'slot' in destination && typeof destination.slot === 'string' ? destination.slot : 'carry';
        cell.style.setProperty('--equipment-slot-icon', slotIcon(shape));
        const title = document.createElement('small');
        title.textContent = label;
        cell.append(title);
        if (item)
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
        if (!snapshot || !this.open)
            return;
        const own = snapshot.units.filter(unit => unit.owner === this.owner && unit.hp > 0), unit = own.find(unit => unit.id === this.unitId), ship = own.find(unit => unit.id === this.shipId && shipProfile(unit));
        if (!unit && !ship) {
            this.close();
            return;
        }
        const key = JSON.stringify([bakedAssetsVersion(), this.i18n().locale, this.unitId, this.shipId, own.map(unit => unit.id), snapshot.items.filter(item => unit && item.carrierId === unit.id || ship && item.shipId === ship.id).map(item => [item.id, item.slot, item.holdSlot, item.mountId]), unit?.hands]);
        if (key === this.fingerprint || this.dragging) {
            this.updateValues(unit, ship);
            return;
        }
        this.fingerprint = key;
        this.root.replaceChildren();
        const header = document.createElement('header');
        const crest = document.createElement('span');
        crest.className = 'equipment-crest';
        crest.setAttribute('aria-hidden', 'true');
        crest.textContent = '⚔';
        header.append(crest);
        const title = document.createElement('div');
        title.innerHTML = `<small>${this.text('舰队军械库', 'FLEET ARMORY')}</small><h2>${this.text('装备与船舱', 'Equipment & hold')}</h2>`;
        header.append(title);
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'equipment-close';
        close.textContent = '×';
        close.setAttribute('aria-label', this.text('关闭', 'Close'));
        close.addEventListener('click', () => this.close());
        header.append(close);
        this.root.append(header);
        const columns = document.createElement('div');
        columns.className = 'equipment-columns';
        this.root.append(columns);
        const character = document.createElement('section');
        character.className = 'equipment-character';
        columns.append(character);
        this.selector(character, this.text('人物', 'Character'), own.filter(canEquip), this.unitId, id => { this.unitId = id; this.fingerprint = ''; this.render(); });
        if (unit) {
            const paperdoll = document.createElement('div');
            paperdoll.className = 'equipment-paperdoll';
            character.append(paperdoll);
            for (const slot of ARMOR_SLOTS) {
                const item = itemsFor(snapshot, unit).find(item => itemSlot(snapshot, unit, item) === slot);
                const cell = this.cell(this.text(...SLOT_LABELS[slot]), item, { unitId: unit.id, slot });
                cell.classList.add(`equipment-${slot}`);
                paperdoll.append(cell);
            }
            const portrait = document.createElement('canvas');
            portrait.width = 240;
            portrait.height = 320;
            portrait.className = 'equipment-person';
            drawAtlasUnit(portrait.getContext('2d')!, unit.kind, { x: 120, y: 246 }, 3.8, '#80988e');
            paperdoll.append(portrait);
            const hands = document.createElement('div');
            hands.className = 'equipment-hands';
            character.append(hands);
            for (const hand of ['right', 'left'] as const) {
                const item = snapshot.items.find(item => item.id === unit.hands?.[hand]);
                const main = snapshot.items.find(item => item.id === unit.hands?.right);
                const label = hand === 'right' ? this.text('主手', 'Main hand') : main && itemHands(main) === 2 ? this.text('副手 · 被双手武器占用', 'Off hand · Two-handed weapon') : this.text('副手', 'Off hand');
                const cell = this.cell(label, item, undefined, hand);
                hands.append(cell);
                if (item)
                    this.action(cell, this.text('收起', 'Stow'), () => this.wield(undefined, hand));
            }
            const carried = document.createElement('div');
            carried.className = 'equipment-carried';
            character.append(carried);
            const heavy = itemsFor(snapshot, unit).find(item => ITEM_DEFS[item.kind].span === 4);
            if (heavy) {
                const cell = this.cell(this.text('搬运武器 · 占满四格', 'Hauling weapon · All four positions'), heavy, { unitId: unit.id, slot: 'carry0' });
                cell.classList.add('equipment-four-slots');
                carried.append(cell);
            }
            else
                for (const slot of CARRY_SLOTS) {
                    const item = itemsFor(snapshot, unit).find(item => itemSlot(snapshot, unit, item) === slot);
                    carried.append(this.cell(this.text(...SLOT_LABELS[slot]), item, { unitId: unit.id, slot }));
                }
            const explanation = document.createElement('p');
            explanation.className = 'equipment-note';
            explanation.textContent = this.text('手持与背挂共用以上 4 格。主副手显示当前持用，不增加容量。', 'Hands and back share the four positions above. Hand displays do not add capacity.');
            character.append(explanation);
            const stats = document.createElement('div');
            stats.dataset.equipmentStats = '';
            for (const [key, label] of [['health', this.text('生命', 'Health')], ['attack', this.text('攻击', 'Attack')], ['protection', this.text('护甲减伤', 'Protection')]] as const) {
                const stat = document.createElement('div');
                stat.className = 'equipment-stat';
                const caption = document.createElement('small');
                caption.textContent = label;
                const value = document.createElement('strong');
                value.dataset.stat = key;
                stat.append(caption, value);
                stats.append(stat);
            }
            character.append(stats);
        }
        else {
            const note = document.createElement('p');
            note.textContent = this.text('船上暂无己方船员，可选择附近人物。', 'No friendly crew aboard. Choose a nearby character.');
            character.append(note);
        }
        const cargo = document.createElement('section');
        cargo.className = 'equipment-cargo';
        columns.append(cargo);
        this.selector(cargo, this.text('船舱', 'Ship hold'), own.filter(unit => shipProfile(unit)), this.shipId, id => { this.shipId = id; this.fingerprint = ''; this.render(); });
        const summary = document.createElement('div');
        summary.className = 'equipment-ship-summary';
        cargo.append(summary);
        if (ship) {
            const portrait = document.createElement('canvas');
            portrait.width = 240;
            portrait.height = 168;
            portrait.className = 'equipment-ship-art';
            drawAtlasUnitPortrait(portrait.getContext('2d')!, ship.kind, 24, -20, 200, '#8f9d7e');
            summary.append(portrait);
        }
        const details = document.createElement('div');
        summary.append(details);
        const access = document.createElement('p');
        access.dataset.equipmentAccess = '';
        details.append(access);
        const load = document.createElement('p');
        load.dataset.equipmentLoad = '';
        details.append(load);
        const meter = document.createElement('span');
        meter.className = 'equipment-load-meter';
        meter.append(document.createElement('i'));
        details.append(meter);
        if (ship) {
            const parts = document.createElement('p');
            parts.dataset.equipmentParts = '';
            details.append(parts);
            const fittingsTitle = document.createElement('h3');
            fittingsTitle.className = 'equipment-section-title';
            fittingsTitle.textContent = this.text('甲板炮位', 'Deck fittings');
            cargo.append(fittingsTitle);
            const fittings = document.createElement('div');
            fittings.className = 'equipment-fittings';
            cargo.append(fittings);
            for (const mount of shipMounts(ship)) {
                const item = snapshot.items.find(item => item.shipId === ship.id && item.mountId === mount.id);
                const cell = this.cell(this.mountLabel(mount.id), item, { shipId: ship.id, mountId: mount.id, installerId: unit?.id ?? '' });
                cell.dataset.mountId = mount.id;
                cell.title = `${mount.accepts.map(kind => labelKind(kind, this.i18n())).join(' / ')} · ${this.text('射界', 'Firing arc')} ±${Math.round(mount.halfArc * 180 / Math.PI)}°`;
                if (item) {
                    const hp = document.createElement('small');
                    hp.dataset.weaponDurability = item.id;
                    cell.append(hp);
                    this.action(cell, this.text('拆到船舱', 'Stow in hold'), () => { if (!unit || !canExchange(snapshot, unit, ship)) {
                        this.feedback('A crew member must be nearby to install or remove weapons');
                        return;
                    } const slot = Array.from({ length: shipHoldSlots(ship) }, (_, i) => i).find(slot => !transferRefusal(this.snapshot!, this.owner, item.id, { shipId: ship.id, slot })); if (slot === undefined) {
                        this.feedback('No room in the hold');
                        return;
                    } this.transfer(item, { shipId: ship.id, slot }); });
                }
                fittings.append(cell);
            }
            const holdTitle = document.createElement('h3');
            holdTitle.className = 'equipment-section-title';
            holdTitle.textContent = this.text('船舱储物', 'Cargo hold');
            cargo.append(holdTitle);
            const grid = document.createElement('div');
            grid.className = 'equipment-hold';
            cargo.append(grid);
            for (let i = 0; i < shipHoldSlots(ship); i++) {
                const occupying = snapshot.items.find(item => item.shipId === ship.id && item.holdSlot !== undefined && i >= item.holdSlot && i < item.holdSlot + (ITEM_DEFS[item.kind].span ?? 1));
                if (occupying && occupying.holdSlot !== i)
                    continue;
                const cell = this.cell(String(i + 1), occupying, { shipId: ship.id, slot: i });
                if (occupying && ITEM_DEFS[occupying.kind].span === 4)
                    cell.classList.add('equipment-four-slots');
                grid.append(cell);
            }
        }
        else {
            const empty = document.createElement('p');
            empty.textContent = this.text('附近没有船只；穿戴与武器切换仍可使用。', 'No ship nearby. Equipment and weapon switching remain available.');
            cargo.append(empty);
        }
        const actions = document.createElement('footer');
        actions.dataset.equipmentActions = '';
        this.root.append(actions);
        const feedback = document.createElement('p');
        feedback.dataset.equipmentFeedback = '';
        feedback.setAttribute('role', 'status');
        feedback.textContent = this.text('拖拽放置 · 双击转移 · 单击持用或安装 · Esc 返回战场', 'Drag to place · Double-click to transfer · Click for actions · Esc to return');
        this.root.append(feedback);
        this.updateValues(unit, ship);
    }
    private mountLabel(id: string) { return id === 'bow' ? this.text('艏部炮位', 'Bow fitting') : id === 'aft' ? this.text('中后部炮位', 'Aft fitting') : id.startsWith('port') ? `${this.text('左舷炮位', 'Port fitting')} ${Number(id.slice(4)) + 1}` : `${this.text('右舷炮位', 'Starboard fitting')} ${Number(id.slice(9)) + 1}`; }
    private selector(parent: HTMLElement, label: string, units: Unit[], selected: string | undefined, change: (id: string) => void) { const container = document.createElement('label'); container.className = 'equipment-selector'; container.textContent = label; const select = document.createElement('select'); select.setAttribute('aria-label', label); for (const [index, unit] of units.entries()) {
        const option = document.createElement('option');
        option.value = unit.id;
        option.textContent = `${labelKind(unit.kind, this.i18n())} · ${String(index + 1).padStart(2, '0')}`;
        option.selected = unit.id === selected;
        select.append(option);
    } if (!selected) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = this.text('选择…', 'Choose…');
        option.selected = true;
        select.prepend(option);
    } select.addEventListener('change', () => change(select.value)); container.append(select); parent.append(container); }
    private updateValues(unit: Unit | undefined, ship: Unit | undefined) {
        const stats = this.root.querySelector<HTMLElement>('[data-equipment-stats]');
        if (stats && unit) {
            stats.querySelector('[data-stat=health]')!.textContent = `${Math.ceil(unit.hp)} / ${unit.maxHp}`;
            stats.querySelector('[data-stat=attack]')!.textContent = String(unit.attackDamage);
            stats.querySelector('[data-stat=protection]')!.textContent = `${Math.round(equipmentProtection(this.snapshot!, unit) * 100)}%`;
        }
        const access = this.root.querySelector<HTMLElement>('[data-equipment-access]');
        if (access) {
            const ready = unit && ship && canExchange(this.snapshot!, unit, ship);
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
            load.textContent = `${this.text('船上装备', 'Equipment aboard')} ${shipItemMass(this.snapshot!, ship).toFixed(1)} kg · ${this.text('总载重', 'Payload')} ${Math.round(ship.sailing?.load ?? 0)} / ${shipProfile(ship)!.loadCapacity} kg`;
        }
    }
}
