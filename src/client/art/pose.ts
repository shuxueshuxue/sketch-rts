import { IDLE_FRAME, type UnitAnimationFrame } from "../unit-animation";

type Brush = CanvasRenderingContext2D;
const poses = new WeakMap<Brush, UnitAnimationFrame>();
export const poseOf = (b: Brush) => poses.get(b) ?? IDLE_FRAME;
export const strideOf = (b: Brush) => {
  const pose = poseOf(b);
  return pose.mode === "walk" ? Math.sin(pose.frame / 8 * Math.PI * 2) : 0;
};

/** Scope the rig to one cached sprite. Portraits and unrelated painters remain
 * at rest, including when a painter throws or nests another drawing. */
export function withUnitPose(b: Brush, pose: UnitAnimationFrame, paint: () => void) {
  const previous = poses.get(b);
  poses.set(b, pose);
  b.save();
  const stride = strideOf(b);
  if (pose.mode === "walk") b.translate(0, -Math.abs(stride) * 1.2);
  if (pose.mode === "attack") {
    const lean = [0.09, 0.07, 0.035, 0, -0.02, 0][pose.frame] ?? 0;
    b.translate(0, 10); b.rotate(lean); b.translate(0, -10);
  }
  try { paint(); } finally {
    b.restore();
    if (previous) poses.set(b, previous); else poses.delete(b);
  }
}

/** Weapons and the hand holding them share a shoulder pivot; moving only the
 * sword would detach it from its owner. Angles are six intentional key poses. */
export function articulated(b: Brush, part: "weapon" | "bow" | "staff" | "shield", paint: () => void) {
  const pose = poseOf(b);
  let angle = strideOf(b) * (part === "shield" ? -0.06 : 0.09);
  if (pose.mode === "attack") {
    const swing = [0.9, 0.65, 0.32, 0, -0.12, 0][pose.frame] ?? 0;
    angle = part === "bow" ? swing * 0.12 : part === "staff" ? swing * 0.25 : part === "shield" ? -swing * 0.12 : swing;
  } else if (pose.mode === "cast") {
    angle = ([-0.12, -0.38, -0.48, -0.32, -0.15, 0][pose.frame] ?? 0) * (part === "shield" ? -0.3 : 1);
  }
  const x = part === "shield" ? -6 : 6;
  b.save(); b.translate(x, -6); b.rotate(angle); b.translate(-x, 6);
  try {
    paint();
    if (part === "staff" && pose.mode === "cast") {
      const light = [0.8, 1, 0.8, 0.5, 0.2, 0][pose.frame] ?? 0;
      b.globalAlpha *= light;
      b.fillStyle = "#fff1b499";
      b.beginPath(); b.arc(16, -29, 8 + pose.frame, 0, Math.PI * 2); b.fill();
      b.strokeStyle = "#fff8d8"; b.lineWidth = 1.4;
      b.beginPath(); b.arc(16, -29, 5, 0, Math.PI * 2); b.stroke();
    }
  } finally { b.restore(); }
}
