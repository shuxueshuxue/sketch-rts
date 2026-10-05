import { CORE_SCENERY } from "../../client/art/scenery";
import { INK, MOSS, ellipse, line, polygon, type Brush } from "../../client/art/kit";
import type { PropPainter } from "../../story/cast";

// Campaign-specific scenery extends the common asset set. Menus never import this pack.
function heartwood(b: Brush, state: string | undefined) {
  // The Old Grove's heart: a vast tree, its bark lit from within while the grove lives.
  const scorched = state === "scorched";
  ellipse(b, 0, 26, 50, 11, "#30483634");
  for (const [x1, x2] of [[-10, -26], [-4, -12], [6, 14], [10, 28]]) line(b, [[x1!, 12], [x2!, 26]], "#6b5a3e", 4);
  polygon(b, [[-14, 16], [-10, -30], [-4, -40], [6, -40], [11, -28], [14, 16]], "#7c6a48", INK, 1.4);
  for (const x of [-7, 0, 7]) line(b, [[x, -34], [x + (x < 0 ? -2 : 2), 14]], "#5f5034", 1.2);
  if (!scorched) ellipse(b, 0, -8, 4, 7, "#f4e7a0", "#b9a45a");
  for (const [x, y, r] of [[-26, -46, 18], [0, -58, 24], [24, -46, 18], [-12, -38, 14], [14, -36, 14], [0, -40, 16]]) ellipse(b, x!, y!, r!, r! * 0.78, scorched ? "#6f6a55" : (x! + y!) % 3 === 0 ? MOSS : "#6f8f5a", "#526951");
  if (!scorched) for (const [x, y] of [[-20, -50], [8, -64], [26, -44], [-4, -44], [16, -52]]) ellipse(b, x!, y!, 1.8, 1.8, "#f4f0b0");
}

export const SCENERY: Record<string, PropPainter> = { ...CORE_SCENERY, heartwood };
