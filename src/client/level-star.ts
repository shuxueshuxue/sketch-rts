export function drawLevelStar(ctx: CanvasRenderingContext2D, x: number, y: number, level: number) {
  const palette = levelStarPalette(level);
  ctx.save();
  ctx.fillStyle = palette.fill;
  ctx.strokeStyle = palette.stroke;
  ctx.lineWidth = 1.5;
  ctx.shadowColor = palette.glow;
  ctx.shadowBlur = 5;
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 === 0 ? 8 : 3.7;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.stroke();
  ctx.restore();
}

function levelStarPalette(level: number) {
  if (level >= 3) return { fill: "#d984e8", stroke: "#7a3f89", glow: "rgba(217, 132, 232, 0.5)" };
  if (level === 2) return { fill: "#78b7e8", stroke: "#315f87", glow: "rgba(120, 183, 232, 0.46)" };
  return { fill: "#f2d05c", stroke: "#8a6418", glow: "rgba(242, 208, 92, 0.42)" };
}
