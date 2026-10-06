import { describe, expect, it } from 'vitest';
import { DoubleSide, Mesh, MeshBasicMaterial, OrthographicCamera, PlaneGeometry, Raycaster, Vector3 } from 'three';
import { CrewFacingTracker, uprightCrewRotation } from './crew-pose';
import type { Unit } from '../../shared/types';

describe('physical crew presentation', () => {
  it('keeps the head vertically over the same feet from pitched views around the ship', () => {
    const camera = new OrthographicCamera();
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
      camera.position.set(Math.sin(angle) * 100, 80, Math.cos(angle) * 100);
      camera.lookAt(0, 0, 0);
      const aboveFeet = new Vector3(0, 40, 0).applyQuaternion(uprightCrewRotation(camera));
      expect(aboveFeet.x).toBeCloseTo(0); expect(aboveFeet.y).toBeCloseTo(40); expect(aboveFeet.z).toBeCloseTo(0);
    }
  });

  it('does not lean a person in front of a sail through it when viewing from the left', () => {
    const camera = new OrthographicCamera();
    camera.position.set(-100, 80, 0); camera.lookAt(0, 20, 0);
    const sail = new Mesh(new PlaneGeometry(80, 80), new MeshBasicMaterial({ side: DoubleSide }));
    sail.position.set(0, 40, 0); sail.rotation.y = Math.PI / 2; sail.updateMatrixWorld();
    const feet = new Vector3(-10, 20, 0);
    const head = feet.clone().add(new Vector3(0, 40, 0).applyQuaternion(uprightCrewRotation(camera)));
    const occluded = (point: Vector3) => new Raycaster(camera.position, point.clone().sub(camera.position).normalize(), 0, camera.position.distanceTo(point)).intersectObject(sail).length > 0;
    expect(occluded(head)).toBe(false);
    // The former camera-pitched card incorrectly puts the same head behind the sail.
    const leaningHead = feet.clone().add(new Vector3(0, 40, 0).applyQuaternion(camera.quaternion));
    expect(occluded(leaningHead)).toBe(true);
    // Actual positions behind the sail remain occluded; depth is not disabled.
    expect(occluded(new Vector3(10, 50, 0))).toBe(true);
    sail.geometry.dispose(); (sail.material as MeshBasicMaterial).dispose();
  });

  it('turns with actual deck walking and keeps direction during hull translation', () => {
    const tracker = new CrewFacingTracker(), right = new Vector3(1, 0, 0);
    const unit = (x: number, worldX = 100) => ({ id: 'crew', x: worldX, y: 100, deck: { shipId: 'ship', x, y: 0 }, order: { type: 'move', x: 100, y: 100 } }) as Unit;
    tracker.update({ units: [unit(0)] });
    tracker.update({ units: [unit(-6)] }); expect(tracker.facing(unit(-6), 0, right)).toBe(-1);
    tracker.update({ units: [unit(-6, 500)] }); expect(tracker.facing(unit(-6, 500), 0, right)).toBe(-1);
    tracker.update({ units: [unit(0)] }); expect(tracker.facing(unit(0), 0, right)).toBe(1);
    expect(tracker.facing(unit(0), Math.PI, right)).toBe(-1);
    expect(tracker.facing(unit(0), 0, new Vector3(-1, 0, 0))).toBe(-1);
    expect(tracker.facing(unit(0), 0, right, { x: 50, y: 100 })).toBe(-1);
  });
});
