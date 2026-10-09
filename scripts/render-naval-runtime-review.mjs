import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';

// node scripts/render-naval-runtime-review.mjs BEFORE.json AFTER.json [OUTPUT.png]
// Input traces require naval-runtime-stress.ts --record (one pose per second).
if (!process.argv[2] || !process.argv[3]) throw new Error('Expected baseline and candidate trace JSON');
const [before, after] = await Promise.all(process.argv.slice(2, 4).map(path => readFile(resolve(path), 'utf8').then(JSON.parse)));
const ids = ['fleet-station-6v1', 'convoy-crossing-12', 'island-convoy-wind', 'weather-boundary-convoy'];
const colors = ['#216d91', '#bf813d', '#5d9851', '#ac5966', '#8070a8', '#8a7560', '#b26c9a', '#526b6a', '#9a9848', '#53a6b6', '#536da4', '#cc6242'];
const canvas = createCanvas(1800, ids.length * 420), ctx = canvas.getContext('2d');
ctx.fillStyle = '#f5f4ee'; ctx.fillRect(0, 0, canvas.width, canvas.height);
for (let row = 0; row < ids.length; row++) {
  const scenes = [before, after].map(data => data.scenes.find(scene => scene.id === ids[row]));
  if (scenes.some(scene => !scene?.frames?.length)) throw new Error(`Missing recorded scene: ${ids[row]}`);
  const points = scenes.flatMap(scene => [...scene.frames.flatMap(frame => frame.ships), ...scene.initial.flatMap(ship => ship.goal ? [ship.goal] : [])]);
  const extent = { left: Math.min(...points.map(point => point.x)), right: Math.max(...points.map(point => point.x)), top: Math.min(...points.map(point => point.y)), bottom: Math.max(...points.map(point => point.y)) };
  for (let col = 0; col < 2; col++) {
    const scene = scenes[col], left = col * 900 + 35, top = row * 420 + 55, width = 830, height = 305;
    const scale = Math.min(width / (extent.right - extent.left + 550), height / (extent.bottom - extent.top + 550));
    const x = value => left + width / 2 + (value - (extent.left + extent.right) / 2) * scale;
    const y = value => top + height / 2 + (value - (extent.top + extent.bottom) / 2) * scale;
    ctx.font = '20px sans-serif'; ctx.fillStyle = '#273c3f'; ctx.fillText(`${col ? 'Candidate' : 'Baseline'} / ${scene.id}`, left, top - 22);
    ctx.fillStyle = '#e5eef0'; ctx.fillRect(left, top, width, height);
    const terrain = scene.map?.terrain;
    if (terrain) {
      ctx.fillStyle = '#d2c29b';
      for (let i = 0; i < terrain.cells.length; i++) if (terrain.cells[i] !== '~') {
        const tx = x(i % terrain.cols * terrain.cell), ty = y(Math.floor(i / terrain.cols) * terrain.cell);
        if (tx >= left - terrain.cell * scale && tx <= left + width && ty >= top - terrain.cell * scale && ty <= top + height) ctx.fillRect(tx, ty, terrain.cell * scale + .2, terrain.cell * scale + .2);
      }
    }
    ctx.save(); ctx.beginPath(); ctx.rect(left, top, width, height); ctx.clip();
    ctx.strokeStyle = '#d1ddde'; ctx.lineWidth = .6;
    for (let world = Math.floor(extent.left / 1000) * 1000; world <= extent.right + 1000; world += 1000) { ctx.beginPath(); ctx.moveTo(x(world), top); ctx.lineTo(x(world), top + height); ctx.stroke(); }
    for (let world = Math.floor(extent.top / 1000) * 1000; world <= extent.bottom + 1000; world += 1000) { ctx.beginPath(); ctx.moveTo(left, y(world)); ctx.lineTo(left + width, y(world)); ctx.stroke(); }
    for (let i = 0; i < scene.initial.length; i++) {
      const unit = scene.initial[i], poses = scene.frames.map(frame => frame.ships.find(ship => ship.id === unit.id));
      const color = unit.owner === 'enemy' ? '#a64040' : colors[i % colors.length];
      ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.beginPath();
      for (let n = 0; n < poses.length; n++) { const pose = poses[n]; if (n) ctx.lineTo(x(pose.x), y(pose.y)); else ctx.moveTo(x(pose.x), y(pose.y)); } ctx.stroke();
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x(unit.x), y(unit.y), 3, 0, 2 * Math.PI); ctx.fill();
      if (unit.goal) { const gx = x(unit.goal.x), gy = y(unit.goal.y); ctx.beginPath(); ctx.moveTo(gx, gy - 5); ctx.lineTo(gx + 5, gy); ctx.lineTo(gx, gy + 5); ctx.lineTo(gx - 5, gy); ctx.closePath(); ctx.stroke(); }
      const end = poses.at(-1); ctx.font = '12px sans-serif'; ctx.fillText(String(i + 1), x(unit.x) + 5, y(unit.y) - 5);
      for (let n = 15; n < poses.length; n += 35) {
        const pose = poses[n], size = 6; ctx.save(); ctx.translate(x(pose.x), y(pose.y)); ctx.rotate(pose.heading); ctx.beginPath(); ctx.moveTo(size, 0); ctx.lineTo(-size, -size * .55); ctx.lineTo(-size * .5, 0); ctx.lineTo(-size, size * .55); ctx.closePath(); ctx.fill(); ctx.restore();
      }
      ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x(end.x) - 4, y(end.y) - 4); ctx.lineTo(x(end.x) + 4, y(end.y) + 4); ctx.moveTo(x(end.x) - 4, y(end.y) + 4); ctx.lineTo(x(end.x) + 4, y(end.y) - 4); ctx.stroke();
    }
    ctx.restore(); ctx.strokeStyle = '#94a4a5'; ctx.lineWidth = 1; ctx.strokeRect(left, top, width, height);
    const allies = scene.quality.ships.filter(ship => ship.owner === 'player'), shots = allies.reduce((sum, ship) => sum + ship.shots, 0), reversals = allies.reduce((sum, ship) => sum + (ship.movingTurnReversals ?? ship.movingRapidTurnReversals ?? ship.rapidTurnReversals), 0), yaw = allies.reduce((sum, ship) => sum + ship.totalYawDegrees, 0);
    ctx.fillStyle = '#384f50'; ctx.font = '15px sans-serif'; ctx.fillText(`${scene.duration}s | shots ${shots} | yaw ${Math.round(yaw)}° | moving reversals ${reversals} | overlap ${scene.quality.maxHullOverlap.toFixed(3)} | coast ${scene.quality.coastViolations}`, left, top + height + 25);
    ctx.font = '12px sans-serif'; ctx.fillText('Circle: start. Cross: final. Diamond: goal. Arrows: heading every 35s. Identical scales in both columns.', left, top + height + 45);
  }
}
const output = resolve(process.argv[4] || 'work/naval-runtime-comparison.png');
await mkdir(dirname(output), { recursive: true }); await writeFile(output, canvas.toBuffer('image/png')); console.log(output);
