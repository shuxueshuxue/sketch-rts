import type { WorldEffect } from "../shared/types";
type Point = {
    x: number;
    y: number;
};
const kinds = new Set<WorldEffect["type"]>(["shellFlight", "siegeBolt", "siegeImpact", "grapeshot", "burningGround"]);
export function shellFlightFrame(from: Point, to: Point, progress: number) {
    const p = Math.max(0, Math.min(1, progress));
    const ground = { x: from.x + (to.x - from.x) * p, y: from.y + (to.y - from.y) * p };
    return { ground, head: { x: ground.x, y: ground.y - 4 * p * (1 - p) * Math.min(110, Math.hypot(to.x - from.x, to.y - from.y) * .2) } };
}
export function drawWarfareEffect(ctx: CanvasRenderingContext2D, effect: WorldEffect, project: (p: Point) => Point, visible: (p: Point, pad: number) => boolean) {
    if (!kinds.has(effect.type))
        return false;
    const at = project(effect), from = project({ x: effect.fromX ?? effect.x, y: effect.fromY ?? effect.y }), to = project({ x: effect.toX ?? effect.x, y: effect.toY ?? effect.y });
    if (!visible(at, 150) && !visible(from, 150))
        return true;
    const life = effect.remaining / effect.duration, p = 1 - life;
    ctx.save();
    ctx.lineCap = "round";
    if (effect.type === "shellFlight") {
        const frame = shellFlightFrame(from, to, p), previous = shellFlightFrame(from, to, Math.max(0, p - .07));
        ctx.fillStyle = "#19242b35";
        ctx.beginPath();
        ctx.ellipse(frame.ground.x, frame.ground.y, 6, 2.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#9f9a8370";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(previous.head.x, previous.head.y);
        ctx.lineTo(frame.head.x, frame.head.y);
        ctx.stroke();
        ctx.fillStyle = "#525751";
        ctx.strokeStyle = "#d0c6a4";
        ctx.lineWidth = .8;
        ctx.beginPath();
        ctx.arc(frame.head.x, frame.head.y, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    }
    else if (effect.type === "siegeBolt") {
        const dx = to.x - from.x, dy = to.y - from.y, len = Math.hypot(dx, dy) || 1;
        const head = { x: from.x + dx * p, y: from.y + dy * p };
        ctx.translate(head.x, head.y);
        ctx.rotate(Math.atan2(dy, dx));
        ctx.strokeStyle = "#c6c1a5";
        ctx.lineWidth = 1.7;
        ctx.beginPath();
        ctx.moveTo(-24, 0);
        ctx.lineTo(2, 0);
        ctx.stroke();
        ctx.fillStyle = "#c0ccca";
        ctx.beginPath();
        ctx.moveTo(6, 0);
        ctx.lineTo(-2, -3);
        ctx.lineTo(-2, 3);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "#e7d4a058";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-Math.min(36, len * p), 0);
        ctx.lineTo(-24, 0);
        ctx.stroke();
    }
    else if (effect.type === "grapeshot") {
        const dx = to.x - from.x, dy = to.y - from.y, len = Math.hypot(dx, dy) || 1, angle = Math.atan2(dy, dx), fire = effect.sourceKind === "fireShip";
        ctx.translate(from.x, from.y);
        ctx.rotate(angle);
        ctx.globalAlpha = life * .8;
        for (let i = 0; i < 7; i++) {
            const spread = (i - 3) * .095, reach = Math.min(effect.radius ?? len, len) * (p * .75 + .2);
            const x = Math.cos(spread) * reach, y = Math.sin(spread) * reach;
            ctx.strokeStyle = fire ? "#d28c48" : "#d9c7a0";
            ctx.lineWidth = fire ? 3.5 : 1;
            ctx.beginPath();
            ctx.moveTo(x - (fire ? 35 : 12), y);
            ctx.lineTo(x, y);
            ctx.stroke();
            if (fire) {
                ctx.fillStyle = "#eece8770";
                ctx.beginPath();
                ctx.ellipse(x - 12, y, 15, 5, 0, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }
    else if (effect.type === "siegeImpact") {
        ctx.translate(at.x, at.y);
        ctx.globalAlpha = life;
        const size = Math.min(65, effect.radius ?? 24), radius = 8 + p * size;
        ctx.fillStyle = "#a2977440";
        ctx.beginPath();
        ctx.ellipse(0, 4, radius, radius * .36, 0, 0, Math.PI * 2);
        ctx.fill();
        for (let i = 0; i < 9; i++) {
            const a = i * 2.4, d = 4 + p * (14 + (i % 4) * 8);
            ctx.fillStyle = i % 2 ? "#d2bea0" : "#575c55";
            ctx.fillRect(Math.cos(a) * d, Math.sin(a) * d * .5 - 12 * Math.sin(Math.PI * p), 2.8, 2);
        }
    }
    else {
        ctx.translate(at.x, at.y);
        const r = effect.radius ?? 85;
        ctx.fillStyle = "#3f343527";
        ctx.beginPath();
        ctx.ellipse(0, 4, r, r * .45, 0, 0, Math.PI * 2);
        ctx.fill();
        for (let i = 0; i < 11; i++) {
            const x = Math.sin(i * 13.2) * r * .7, y = Math.cos(i * 7.1) * r * .3, height = 7 + Math.sin(effect.remaining * .33 + i) * 4;
            ctx.fillStyle = "#c7814380";
            ctx.beginPath();
            ctx.moveTo(x - 4, y);
            ctx.quadraticCurveTo(x - 1, y - height, x + 3, y - height - 5);
            ctx.quadraticCurveTo(x + 7, y - 2, x + 3, y);
            ctx.fill();
            ctx.fillStyle = "#e7c98570";
            ctx.fillRect(x, y - 3, 2, 4);
        }
    }
    ctx.restore();
    return true;
}
