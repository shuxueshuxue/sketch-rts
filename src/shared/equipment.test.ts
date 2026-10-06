import { describe, expect, it } from 'vitest';
import { createGame, issuePlayerCommand, snapshotGame, restoreSnapshotIntoGame, stepGame } from './sim';
import { CARRY_SLOTS, ITEM_DEFS, freeItemSlot, itemsFor, itemSlot, normalizeEquipment, shipHoldSlots } from './equipment';
import { UNIT_DEFS } from './catalog';
import { createShop } from './shop';
import { boardUnit, syncDecks } from './decks';
import { checksumGame } from './sim/checksum';
import { isGameCommand } from './command-schema';
import type { ItemKind, WorldItem } from './types';
function match() { const game = createGame('bareDuel', { aiPlayers: [] }); game.units = []; game.items = []; game.buildings = []; game.scriptedVictory = true; delete game.map.terrain; game.players.player!.gold = 3000; return game; }
function give(game: ReturnType<typeof match>, unitId: string, kind: ItemKind) { const unit = game.units.find(unit => unit.id === unitId)!; const item: WorldItem = { id: `test-${kind}-${game.items.length}`, kind, x: unit.x, y: unit.y, cooldownRemaining: 0 }; game.items.push(item); issuePlayerCommand(game, 'player', { type: 'pickupItem', unitId, itemId: item.id }); return item; }
describe('equipment and holds', () => {
    it('drops carried, stored and mounted items without destroying them, and rejects remote removal', () => {
        const game=match(), unit=game.spawnUnit('player','worker',700,700), ship=game.spawnUnit('player','warship',760,700);
        const sword=give(game,unit.id,'greatSword');
        issuePlayerCommand(game,'player',{type:'dropItem',unitId:unit.id,itemId:sword.id,x:710,y:710});
        expect(sword.carrierId).toBeUndefined(); expect(game.items.includes(sword)).toBe(true);
        const gun=game.items.find(item=>item.shipId===ship.id && item.mountId)!;
        const original=gun.id;
        issuePlayerCommand(game,'player',{type:'dropItem',unitId:unit.id,itemId:gun.id,x:710,y:710});
        expect(gun.mountId).toBeUndefined(); expect(gun.shipId).toBeUndefined(); expect(gun.id).toBe(original);
        expect(ship.fittings).toEqual([]);
        const stored:WorldItem={id:'stored-book',kind:'experienceBook',shipId:ship.id,holdSlot:0,x:ship.x,y:ship.y,cooldownRemaining:0};game.items.push(stored);
        unit.x=1300;
        expect(()=>issuePlayerCommand(game,'player',{type:'dropItem',unitId:unit.id,itemId:stored.id,x:unit.x,y:unit.y})).toThrow(/nearby/);
        unit.x=700;
        issuePlayerCommand(game,'player',{type:'dropItem',unitId:unit.id,itemId:stored.id,x:710,y:710});
        expect(stored.shipId).toBeUndefined();expect(stored.holdSlot).toBeUndefined();
    });
    it('spawns with empty carrying positions and retains innate attacks when nothing is wielded', () => {
        const game = match();
        for (const kind of ['worker','footman','archer','priest'] as const) {
            const unit = game.spawnUnit('player', kind, 700, 700);
            expect(itemsFor(game,unit)).toEqual([]);
            expect(unit.hands).toEqual({});
            expect(unit.attackDamage).toBe(UNIT_DEFS[kind].attackDamage);
            expect(unit.attackRange).toBe(UNIT_DEFS[kind].attackRange);
        }
    });
    it('uses four shared weapon positions, with armor in its own compatible positions', () => {
        const game = match(), unit = game.spawnUnit('player', 'footman', 700, 700), boots = give(game, unit.id, 'speedBoots'), cloak = give(game, unit.id, 'flameCloak');
        expect(boots.slot).toBe('feet');
        expect(cloak.slot).toBe('body');
        give(game, unit.id, 'greatSword');
        give(game, unit.id, 'roundShield');
        give(game, unit.id, 'guardianScroll');
        give(game, unit.id, 'experienceBook');
        expect(itemsFor(game, unit).filter(item => CARRY_SLOTS.includes(item.slot as never))).toHaveLength(4);
        expect(freeItemSlot(game, unit, 'experienceBook')).toBeUndefined();
        expect(freeItemSlot(game, unit, 'regenRing')).toBe('head');
        expect(() => issuePlayerCommand(game, 'player', { type: 'transferItem', itemId: boots.id, destination: { unitId: unit.id, slot: 'head' } })).toThrow(/does not fit/);
    });
    it('stows a shield when wielding a two-handed sword without duplicating carrying positions', () => {
        const game = match(), unit = game.spawnUnit('player', 'archer', 700, 700), sword = give(game, unit.id, 'greatSword'), shield = give(game, unit.id, 'roundShield');
        issuePlayerCommand(game, 'player', { type: 'wieldItem', unitId: unit.id, itemId: shield.id, hand: 'left' });
        issuePlayerCommand(game, 'player', { type: 'wieldItem', unitId: unit.id, itemId: sword.id, hand: 'right' });
        expect(unit.attackRange).toBe(ITEM_DEFS.greatSword.weapon!.range);
        expect(unit.attackDamage).toBe(22);
        expect(unit.hands?.left).toBeUndefined();
        expect(itemsFor(game, unit)).toHaveLength(2);
        expect(() => issuePlayerCommand(game, 'player', { type: 'wieldItem', unitId: unit.id, itemId: shield.id, hand: 'left' })).toThrow(/two-handed/);
        issuePlayerCommand(game, 'player', { type: 'wieldItem', unitId: unit.id, hand: 'right' });
        issuePlayerCommand(game, 'player', { type: 'wieldItem', unitId: unit.id, itemId: shield.id, hand: 'left' });
        expect(unit.hands?.left).toBe(shield.id);
        expect(shield.slot).toBeDefined();
        issuePlayerCommand(game, 'player', { type: 'wieldItem', unitId: unit.id, itemId: sword.id, hand: 'right' });
        expect(unit.hands?.left).toBeUndefined();
        expect(shield.carrierId).toBe(unit.id);
    });
    it('removes worn effects in the hold, preserves item cooldown, and includes cargo in payload', () => {
        const game = match(), ship = game.spawnUnit('player', 'transport', 800, 800), unit = game.spawnUnit('player', 'footman', 800, 800);
        boardUnit(ship, unit, game.units);
        syncDecks(game.units);
        const boots = give(game, unit.id, 'speedBoots');
        const speed = unit.speed;
        boots.cooldownRemaining = 99;
        issuePlayerCommand(game, 'player', { type: 'transferItem', itemId: boots.id, destination: { shipId: ship.id, slot: 0 } });
        stepGame(game);
        expect(boots.carrierId).toBeUndefined();
        expect(boots.shipId).toBe(ship.id);
        expect(boots.cooldownRemaining).toBe(98);
        expect(unit.speed).toBe(UNIT_DEFS.footman.speed);
        expect(speed).toBeGreaterThan(unit.speed);
        expect(ship.holdMass).toBe(2);
        issuePlayerCommand(game, 'player', { type: 'transferItem', itemId: boots.id, destination: { unitId: unit.id, slot: 'feet' } });
        expect(unit.speed).toBe(speed);
        expect(boots.shipId).toBeUndefined();
        expect(() => issuePlayerCommand(game, 'player', { type: 'transferItem', itemId: boots.id, destination: { shipId: ship.id, slot: shipHoldSlots(ship) } })).toThrow(/No room/);
    });
    it('rejects remote transfers and another player’s equipment', () => {
        const game = match(), ship = game.spawnUnit('player', 'transport', 1500, 1500), unit = game.spawnUnit('player', 'worker', 700, 700), enemy = game.spawnUnit('enemy', 'footman', 700, 700), boots = give(game, unit.id, 'speedBoots');
        expect(() => issuePlayerCommand(game, 'player', { type: 'transferItem', itemId: boots.id, destination: { shipId: ship.id, slot: 0 } })).toThrow(/closer/);
        const enemyBoots = {id:'enemy-boots', kind:'speedBoots' as const, carrierId:enemy.id, slot:'feet' as const, x:enemy.x, y:enemy.y, cooldownRemaining:0}; game.items.push(enemyBoots);
        expect(() => issuePlayerCommand(game, 'player', { type: 'transferItem', itemId: enemyBoots.id, destination: { unitId: unit.id, slot: 'carry1' } })).toThrow(/own equipment/);
    });
    it('keeps active hands and holds isolated from saved snapshots and replays deterministically', () => {
        const game = match(), unit = game.spawnUnit('player', 'footman', 700, 700), ship = game.spawnUnit('player', 'transport', 750, 700), shield = give(game, unit.id, 'roundShield');
        issuePlayerCommand(game, 'player', { type: 'wieldItem', unitId: unit.id, itemId: shield.id, hand: 'left' });
        const saved = snapshotGame(game);
        issuePlayerCommand(game, 'player', { type: 'wieldItem', unitId: unit.id, hand: 'left' });
        expect(saved.units.find(u => u.id === unit.id)!.hands?.left).toBe(shield.id);
        const restored = match();
        restoreSnapshotIntoGame(restored, saved, game.nextId);
        restored.scriptedVictory = true;
        restoreSnapshotIntoGame(game, saved, game.nextId);
        game.scriptedVictory = true;
        for (const current of [game, restored])
            issuePlayerCommand(current, 'player', { type: 'transferItem', itemId: shield.id, destination: { shipId: ship.id, slot: 0 } });
        for (let i = 0; i < 20; i++) {
            stepGame(game);
            stepGame(restored);
            expect(checksumGame(game)).toBe(checksumGame(restored));
        }
    });
    it('preserves old six-item saves by assigning positions and dropping overflow', () => {
        const game = match(), unit = game.spawnUnit('player', 'footman', 700, 700);
        delete unit.hands;
        game.items = Array.from({ length: 6 }, (_, i) => ({ id: `old-${i}`, kind: 'experienceBook' as const, carrierId: unit.id, x: 700, y: 700, cooldownRemaining: 0 }));
        normalizeEquipment(game, true);
        expect(game.items.filter(item => item.id.startsWith('old-'))).toHaveLength(6);
        expect(itemsFor(game, unit)).toHaveLength(4);
        expect(new Set(itemsFor(game, unit).map(item => itemSlot(game, unit, item))).size).toBe(4);
        expect(game.units.find(current => current.id === unit.id)!.hands?.right).toBeUndefined();
    });
    it('reads a carried consumable and returns to the previous weapon', () => {
        const game = match(), unit = game.spawnUnit('player', 'footman', 700, 700), book = give(game, unit.id, 'experienceBook'), hands = { ...unit.hands };
        issuePlayerCommand(game, 'player', { type: 'useItem', unitId: unit.id, itemId: book.id });
        expect(unit.hands).toEqual(hands);
        expect(game.items.some(item => item.id === book.id)).toBe(false);
        expect(unit.attackRange).toBe(UNIT_DEFS.footman.attackRange);
    });
    it('preserves removed leg equipment as body armor when restoring a preview save', () => {
        const game = match(), unit = game.spawnUnit('player', 'footman', 700, 700);
        give(game, unit.id, 'leatherArmor');
        const saved = snapshotGame(game);
        saved.items.push({ id: 'old-leg-piece', kind: 'legGuards', slot: 'legs', carrierId: unit.id, x: 700, y: 700, cooldownRemaining: 17 } as unknown as WorldItem);
        const restored = match();
        restoreSnapshotIntoGame(restored, saved, game.nextId);
        const migrated = restored.items.find(item => item.id === 'old-leg-piece')!;
        expect(migrated.kind).toBe('leatherArmor');
        expect(migrated.cooldownRemaining).toBe(17);
        expect(migrated.slot).not.toBe('legs');
        const retained = itemsFor(restored, restored.units.find(current => current.id === unit.id)!);
        expect(retained.map(item => item.id)).toContain(migrated.id);
        expect(new Set(retained.map(item => item.slot)).size).toBe(retained.length);
        expect(saved.items.find(item => item.id === migrated.id)!.kind).toBe('legGuards');
    });
    it('removes leg armor from old shop stock even if no character owns it', () => {
        const game = match(); game.shops = [createShop('shop', 700, 650)];
        const saved = snapshotGame(game);
        saved.shops![0]!.goods.push({ kind: 'legGuards', stock: 1 } as unknown as NonNullable<typeof saved.shops>[number]['goods'][number]);
        restoreSnapshotIntoGame(game, saved, game.nextId);
        expect(game.shops![0]!.goods.some(good => (good.kind as string) === 'legGuards')).toBe(false);
        expect(isGameCommand({ type: 'transferItem', itemId: 'x', destination: { unitId: 'u', slot: 'legs' } })).toBe(false);
    });
    it('buys only a small basic equipment catalog and validates network destinations', () => {
        const game = match(), unit = game.spawnUnit('player', 'worker', 700, 700);
        game.shops = [createShop('shop', 700, 650)];
        issuePlayerCommand(game, 'player', { type: 'buy', shopId: 'shop', item: 'leatherArmor' });
        expect(itemsFor(game, unit).find(item => item.kind === 'leatherArmor')?.slot).toBe('body');
        expect(isGameCommand({ type: 'transferItem', itemId: 'x', destination: { unitId: unit.id, slot: 'backpack' } })).toBe(false);
        expect(isGameCommand({ type: 'wieldItem', unitId: unit.id, hand: 'third' })).toBe(false);
    });
});
