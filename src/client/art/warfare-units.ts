import type { UnitModel } from '../../story/cast';
import { polygon, line, ellipse, type Brush } from './kit';
import type { UnitKind } from '../../shared/types';
import { unitMover } from '../../shared/catalog';
import { IDLE_FRAME, type UnitAnimationFrame } from '../unit-animation';
import { withUnitPose } from './pose';
import { poseOf } from './pose';
const ink = '#252f34', wood = '#77634c', metal = '#7d9298', ivory = '#d9d0b6';
function plate(b: Brush, p: number[][], color: string) { polygon(b, p, color, ink, .8); line(b, p.slice(0, 2), '#e3d4ad88', .7); }
function ship(id: string): UnitModel {
    return { shadow: 'none', paint(b, team) {
            const lineShip = id === 'lineShip';
            if(lineShip){b.save();b.scale(.84,.84);}
            const heavy = id === 'bombard' || id === 'frigate', w = id === 'cutter' ? 32 : lineShip ? 61 : id === 'carrier' ? 54 : 45;
            ellipse(b, 0, 17, w + 3, 8, '#c9ded533');
            line(b, [[-w - 5, 18], [-w / 2, 25], [w / 2, 24], [w + 5, 14]], '#d3e1d799', 1);
            plate(b, [[-w, 0], [-w + 12, 17], [w - 12, 19], [w, -1], [12, 6]], '#4b443c');
            plate(b, [[-w, 0], [-w + 20, -13], [w - 12, -11], [w, -1], [12, 6]], wood);
            for (let y = -4; y < 11; y += 4)
                line(b, [[-w + 14, y], [w - 12, y - 2]], '#b19b7166', .8);
            if (id === 'transport' || id === 'carrier') {
                for (let x = id === 'carrier' ? -35 : -20; x <= (id === 'carrier' ? 35 : 20); x += 13)
                    plate(b, [[x, -3], [x + 10, -3], [x + 10, 6], [x, 6]], '#998365');
            }
            if (id === 'fireship') {
                for (let x = -20; x <= 18; x += 13) {
                    ellipse(b, x, 0, 5, 6, '#45352a');
                    plate(b, [[x - 3, -1], [x - 2, -20], [x + 3, -10], [x + 5, -2]], '#c8843c');
                }
            }
            else if (lineShip) {
                // The compact portrait keeps all three masts and the broadside
                // visible before decoded model portraits become available.
                plate(b, [[-57,-5],[-53,-21],[-34,-20],[-27,-7]], '#67513b');
                for (const [x,height] of [[-29,48],[1,60],[30,43]] as const) {
                    line(b, [[x,3],[x,-height]], ink, 2.5);
                    line(b, [[x-14,-height+7],[x+15,-height+6]], '#a48c64', 2);
                    plate(b, [[x-13,-height+8],[x+14,-height+7],[x+12,-height+29],[x-10,-height+29]], ivory);
                    line(b, [[x,-height],[x-22,1]], '#968d7544', .7);
                }
                plate(b, [[1,-63],[17,-59],[1,-55]], team);
                for (const x of [-33,-11,11,33]) {
                    plate(b, [[x-5,7],[x+5,7],[x+5,14],[x-5,14]], '#242b2d');
                    line(b, [[x,9],[x+6,13]], metal, 3);
                    plate(b, [[x-5,-5],[x+4,-5],[x+4,0],[x-5,0]], '#353332');
                }
                line(b, [[-47,15],[47,12]], '#c3a673', 1.5);
            }
            else {
                line(b, [[0, 4], [0, -49]], ink, 3);
                line(b, [[-.8, 4], [-.8, -49]], '#b4a482', 1);
                plate(b, [[2, -45], [30, -35], [34, -9], [2, -13]], ivory);
                plate(b, [[-3, -43], [-22, -10], [-3, -15]], '#a5aa9e');
                plate(b, [[0, -51], [18, -46], [0, -40]], team);
                line(b, [[14, -40], [18, -15]], '#978d7544', 1);
            }
            if (heavy) {
                for (let x = -23; x <= 23; x += 23) {
                    plate(b, [[x - 5, 3], [x + 4, 3], [x + 9, -5], [x, -6]], metal);
                    line(b, [[x + 4, -3], [x + 17, -8]], '#30383a', 4);
                    line(b, [[x + 4, -4], [x + 17, -9]], '#a8b4b1', 1);
                }
            }
            if(lineShip)b.restore();
        } };
}
function siege(id: string): UnitModel {
    return { shadow: 'beast', paint(b, team) {
            const pose = poseOf(b);
            const recoil = pose.mode === 'attack' ? ([0, -3, -5, -2, 0, 0][pose.frame] ?? 0) : 0;
            b.translate(recoil, 0);
            ellipse(b, 0, 18, 30, 6, '#252c3033');
            for (const x of [-21, 20]) {
                ellipse(b, x, 12, 7, 10, '#343432');
                ellipse(b, x, 12, 4, 7, '#998773');
                b.save();
                b.translate(x, 12);
                b.rotate(pose.mode === 'walk' ? pose.frame / 8 * Math.PI * 2 : 0);
                line(b, [[0, -7], [0, 7]], '#433c32', 1.2);
                line(b, [[-5, 0], [5, 0]], '#433c32', 1.2);
                b.restore();
            }
            plate(b, [[-28, 5], [-22, -6], [25, -6], [30, 7], [8, 14]], wood);
            if (id === 'ram') {
                plate(b, [[-28, 0], [-18, -25], [20, -25], [30, 0]], '#839090');
                plate(b, [[-18, -25], [-10, -31], [28, -26], [20, -25]], metal);
                line(b, [[-31, 2], [42, -4]], '#403d35', 9);
                line(b, [[-31, -1], [42, -7]], '#a89675', 2);
                plate(b, [[36, -11], [45, -7], [45, 1], [36, 2]], metal);
            }
            else if (id === 'mortar') {
                for (const x of [-12, 12])
                    line(b, [[x, 6], [x - 5, -33]], '#3e3931', 5);
                line(b, [[-22, -37], [34, -14]], '#b19a70', 5);
                line(b, [[-22, -37], [-12, -15]], '#424746', 9);
                line(b, [[34, -14], [36, -5]], ivory, 1);
            }
            else if (id === 'ballista') {
                line(b, [[-18, 2], [34, -14]], '#b29b70', 4);
                line(b, [[20, -33], [31, -16], [30, 6]], metal, 3);
                line(b, [[20, -33], [4, -5], [30, 6]], ivory, .8);
                line(b, [[-16, 4], [43, -16]], '#d5d5c4', 1.5);
            }
            else
                for (let i = 0; i < 5; i++) {
                    line(b, [[-12, i * 4 - 12], [34, i * 4 - 24]], '#343b3d', 4);
                    line(b, [[-12, i * 4 - 13], [34, i * 4 - 25]], metal, 1);
                }
            plate(b, [[-21, 0], [-11, -3], [-11, 7], [-21, 9]], team);
        } };
}
export function warfarePainter(id: string) { return (id === 'ram' || id === 'mortar' || id === 'ballista' || id === 'organ' ? siege(id) : ship(id)).paint; }
const MODEL_IDS: Partial<Record<UnitKind, string>> = { transport: "transport", warship: "frigate", shipOfTheLine: "lineShip", cutter: "cutter", bombardShip: "bombard", fireShip: "fireship", carrier: "carrier", siegeRam: "ram", ballista: "ballista", catapult: "mortar", organGun: "organ" };
export const hasWarfareUnit = (kind: UnitKind) => MODEL_IDS[kind] !== undefined;
export function paintWarfareUnit(b: Brush, kind: UnitKind, team: string, pose: UnitAnimationFrame) {
    const id = MODEL_IDS[kind];
    if (!id)
        return false;
    // Sailing ships have no walking bounce; land siege engines keep their wheel motion.
    const sailingPose = unitMover(kind) === 'sea' && pose.mode === 'walk' ? IDLE_FRAME : pose;
    withUnitPose(b, sailingPose, () => warfarePainter(id)(b, team));
    return true;
}
