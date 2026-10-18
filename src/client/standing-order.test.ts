import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import * as THREE from 'three';
import { setScratchCanvasFactory } from './art/scratch-canvas';
import { LOOK_DENSITY, LOOK_FOOT, LOOK_HEIGHT, LOOK_WIDTH, byFoot, standingLookCanvas, standingTerrain } from './standing-terrain';
import { StandingField } from './world3d/standing-field';
import { fakeCardGl } from './world3d/card-gl-test-helpers';
import { configureWorldCamera } from './world3d/projection';
import { SHIP_CAMERA } from '../shared/ship-geometry';
import type { Terrain } from '../shared/terrain';

const TILT = Math.tan(SHIP_CAMERA.tilt);
function seeded(seed: number) { let s = seed; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648; }

// A map of forest and rock strewn at random over open ground.
function strewn(seed: number): Terrain {
  const random = seeded(seed), cols = 48, rows = 40;
  const cells = Array.from({ length: cols * rows }, () => { const r = random(); return r < .3 ? 'T' : r < .4 ? '#' : '.'; }).join('');
  return { cols, rows, cell: 32, cells };
}

afterEach(() => setScratchCanvasFactory(undefined));

// @@@standing-field - Whatever stands is ordered by its foot alone (docs/art/render-contract.zh.md, rule 3).
describe('standing objects in front of and behind one another', () => {
  it('stand every card upright with its painted foot on its world foot', () => {
    setScratchCanvasFactory((w, h) => createCanvas(w, h) as unknown as HTMLCanvasElement);
    const terrain = strewn(3), objects = standingTerrain(terrain), scene = new THREE.Scene(), field = new StandingField(scene, 1);
    // The uploader reuses its destination vector: each copy's layer is read as it is made.
    const layers: number[] = [], copy = vi.fn((...call: unknown[]) => { if (call[4] === 0) layers.push((call[3] as THREE.Vector3).z); });
    const renderer = { initTexture: vi.fn(), copyTextureToTexture: copy, getRenderTarget: () => null, getActiveCubeFace: () => 0, getActiveMipmapLevel: () => 0, setRenderTarget: vi.fn(), ...fakeCardGl().renderer };
    // Each look's canvas goes to its own layer on the GPU, flipped so its foot row samples v = 0; nothing is read back.
    const looks = [...new Set(objects.map(object => object.look))], reads = vi.fn();
    for (const look of looks) standingLookCanvas(look).getContext('2d')!.getImageData = reads;
    field.update(terrain, { x: 0, y: 0, width: 4000, height: 4000 }, renderer);
    expect(field.instances).toBe(objects.length);expect(reads).not.toHaveBeenCalled();
    const firstMips = copy.mock.calls.filter(call => call[4] === 0);
    expect(layers).toEqual(looks.map((_, index) => index));
    firstMips.forEach((call, index) => { const source = call[0] as THREE.CanvasTexture; expect(source.image).toBe(standingLookCanvas(looks[index]!)); expect(source.flipY).toBe(true); });
    expect((firstMips[0]![1] as THREE.DataArrayTexture).image).toMatchObject({ width: LOOK_WIDTH, height: LOOK_HEIGHT, depth: looks.length });
    // Instance matrices are float32: a foot is matched to a hundredth of a world unit.
    const near = new Map<string, typeof objects>(), matrix = new THREE.Matrix4();
    for (const object of objects) { const key = `${Math.round(object.x)},${Math.round(object.y)}`; near.set(key, [...near.get(key) ?? [], object]); }
    const standsAt = (x: number, y: number, scale: number) => [-1, 0, 1].some(dx => [-1, 0, 1].some(dy => (near.get(`${Math.round(x) + dx},${Math.round(y) + dy}`) ?? [])
      .some(object => Math.abs(object.x - x) < .01 && Math.abs(object.y - y) < .01 && Math.abs(object.scale - scale) < 1e-4)));
    let checked = 0;
    scene.traverse(mesh => {
      if (!(mesh instanceof THREE.InstancedMesh)) return;
      const rect = mesh.geometry.getAttribute('cardRect');
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, matrix);
        // The card's foot row (its height zero) lands on the ground at its object's foot; its up is the world's up.
        const foot = new THREE.Vector3(0, 0, 0).applyMatrix4(matrix), up = new THREE.Vector3(0, 1, 0).transformDirection(matrix);
        const scale = new THREE.Vector3().setFromMatrixScale(matrix).x;
        expect(standsAt(foot.x, foot.z, scale)).toBe(true);
        expect(foot.y).toBe(0);
        expect(up.y).toBeCloseTo(1, 9);
        // The painted foot sits at height zero of the card: its corners straddle it by the tile's foot row.
        expect(rect.getY(i)).toBeCloseTo((LOOK_FOOT.y - LOOK_HEIGHT) / (LOOK_DENSITY * TILT), 4);
        expect(rect.getW(i)).toBeCloseTo(LOOK_FOOT.y / (LOOK_DENSITY * TILT), 4);
        checked++;
      }
    });
    expect(checked).toBe(objects.length);
  });

  it('show, along every ray of the camera, the card whose foot lies furthest south, whatever their heights', () => {
    const random = seeded(11), camera = new THREE.OrthographicCamera();
    configureWorldCamera(camera, { x: 0, y: 0, width: 1600, height: 1000, zoom: 1 });
    const ray = new THREE.Raycaster(), hit = new THREE.Vector3(), look = camera.getWorldDirection(new THREE.Vector3());
    let compared = 0;
    for (let trial = 0; trial < 4000; trial++) {
      // Two upright cards (a tree, a soldier, a house) at random feet, of random heights, as the field and the troop
      // cards stand them: a plane through the foot, facing the camera.
      const cards = [0, 1].map(() => ({ x: 600 + random() * 400, y: 400 + random() * 300, height: 20 + random() * 300, half: 10 + random() * 60 }));
      const [a, b] = cards as [typeof cards[0], typeof cards[0]];
      // A screen point both cards cover: aim at a point of card a, then see whether the same ray passes through b.
      const target = new THREE.Vector3(a.x + (random() - .5) * a.half, random() * a.height, a.y);
      ray.set(target.clone().addScaledVector(look, -5000), look);
      const through = (card: typeof a) => {
        const at = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -card.y), hit.clone());
        return at && Math.abs(at.x - card.x) <= card.half && at.y >= 0 && at.y <= card.height ? ray.ray.origin.distanceTo(at) : undefined;
      };
      const da = through(a), db = through(b);
      if (da === undefined || db === undefined || a.y === b.y) continue;
      compared++;
      // The nearer of the two along the ray is the one further south.
      expect(da < db).toBe(a.y > b.y);
    }
    expect(compared).toBeGreaterThan(200);
  });

  it('draw, in the Canvas world, back to front by foot whatever each one is', () => {
    const random = seeded(5);
    for (let trial = 0; trial < 50; trial++) {
      const kinds = ['tree', 'stone', 'footman', 'knight', 'farm'];
      const items = Array.from({ length: 60 }, () => ({ x: Math.round(random() * 400), y: Math.round(random() * 400), kind: kinds[Math.floor(random() * kinds.length)]! }));
      const order = byFoot([...items]);
      for (let i = 1; i < order.length; i++) {
        const [before, after] = [order[i - 1]!, order[i]!];
        expect(before.y < after.y || before.y === after.y && before.x <= after.x).toBe(true);
      }
    }
  });
});
