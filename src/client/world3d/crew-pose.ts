import { Camera, Quaternion, Vector3 } from 'three';
import { FACING_TURN_DISTANCE, type Facing } from '../unit-facing';
import type { GameSnapshot, Unit } from '../../shared/types';

const UP = new Vector3(0, 1, 0);

/** A person stands vertically over their feet; camera pitch must never lean
 * their head across the deck and through a sail. Only the card's yaw changes. */
export function uprightCrewRotation(camera: Camera) {
  const forward = camera.getWorldDirection(new Vector3());
  return new Quaternion().setFromAxisAngle(UP, Math.atan2(-forward.x, -forward.z));
}

type Track = { shipId: string; x: number; y: number; heading: number; facing: Facing };

/** Walking is measured on the deck, then projected into the current view.
 * Hull translation cannot turn a standing person; a stopped person keeps heading. */
export class CrewFacingTracker {
  private tracks = new Map<string, Track>();

  update(snapshot: Pick<GameSnapshot, 'units'>) {
    const next = new Map<string, Track>();
    for (const unit of snapshot.units) {
      if (!unit.deck) continue;
      const deck = unit.deck, previous = this.tracks.get(unit.id);
      const track: Track = previous?.shipId === deck.shipId ? { ...previous }
        : { shipId: deck.shipId, x: deck.x, y: deck.y, heading: 0, facing: 1 };
      const dx = deck.x - track.x, dy = deck.y - track.y;
      if (Math.hypot(dx, dy) >= FACING_TURN_DISTANCE) {
        track.heading = Math.atan2(dy, dx);
        track.x = deck.x; track.y = deck.y;
      }
      next.set(unit.id, track);
    }
    this.tracks = next;
  }

  facing(unit: Unit, hullHeading: number, cameraRight: Vector3, target?: { x: number; y: number }): Facing {
    const track = this.tracks.get(unit.id);
    if (!track) return 1;
    const heading = target && Math.hypot(target.x - unit.x, target.y - unit.y) >= FACING_TURN_DISTANCE
      ? Math.atan2(target.y - unit.y, target.x - unit.x)
      : track.heading + hullHeading;
    const horizontal = Math.cos(heading) * cameraRight.x - Math.sin(heading) * cameraRight.z;
    if (Math.abs(horizontal) > .15) track.facing = horizontal < 0 ? -1 : 1;
    return track.facing;
  }
}
