import * as THREE from 'three';
import { configureCardMaterial } from './card-bank-shader';
import { CardMipUploader, createCardArray, type CardTextureRenderer } from './card-mip-uploader';
import { SHIP_CAMERA } from '../../shared/ship-geometry';
import type { Terrain } from '../../shared/terrain';
import { LOOK_DENSITY, LOOK_FOOT, LOOK_HEIGHT, LOOK_WIDTH, standingLookCanvas, standingTerrain } from '../standing-terrain';

const TILT = Math.tan(SHIP_CAMERA.tilt);
// Instances are kept in square chunks of the world, each shown only while it nears the view.
const CHUNK = 1024;
// How far past the view a chunk still shows: its objects' tops rise above their feet.
const REACH = 200;

// @@@standing-field - The terrain's standing objects (see @@@standing-terrain) in the 3D world: each an upright card
// whose painted foot stands on its world foot, so the depth buffer orders it against units, buildings and ships by foot
// alone (an upright card nearer the camera is the one whose foot lies further south, whatever heights its pixels and the
// others' have; see the render contract's third rule). The terrain stands still, so its cards are laid out once when a
// map is shown: one array texture, a layer a look, and an instanced draw a chunk; a frame only shows or hides chunks.
// A look's canvas goes to its layer on the GPU (see @@@canvas-upload): no pixel is read back. The layers live only on
// the GPU, so a lost context drops the field and the next frame lays it out again.
export class StandingField {
  private terrain: Terrain | undefined;
  private group = new THREE.Group();
  private texture: THREE.DataArrayTexture | undefined;
  private uploader: CardMipUploader;
  private material: THREE.MeshBasicMaterial | undefined;
  // What the sun's shadow map sees of a card: its painted silhouette, cut out as the colour pass cuts it.
  private depth: THREE.MeshDepthMaterial | undefined;
  private chunks: { mesh: THREE.InstancedMesh; left: number; top: number }[] = [];
  constructor(scene: THREE.Scene, private anisotropy: number) {
    this.uploader = new CardMipUploader(anisotropy);
    this.group.name = 'StandingField';
    scene.add(this.group);
  }

  /** Lays out the terrain's cards when the map changes, then shows the chunks near the view (world units). */
  update(terrain: Terrain | undefined, view: { x: number; y: number; width: number; height: number }, renderer: CardTextureRenderer) {
    if (terrain !== this.terrain) this.build(terrain, renderer);
    for (const chunk of this.chunks) chunk.mesh.visible = chunk.left < view.x + view.width + REACH && chunk.left + CHUNK > view.x - REACH
      && chunk.top < view.y + view.height + REACH * 2 && chunk.top + CHUNK > view.y - REACH;
  }

  get instances() { return this.chunks.reduce((total, chunk) => total + chunk.mesh.count, 0); }

  private build(terrain: Terrain | undefined, renderer: CardTextureRenderer) {
    this.dispose();
    this.terrain = terrain;
    if (!terrain) return;
    const objects = standingTerrain(terrain);
    if (!objects.length) return;
    const looks = [...new Set(objects.map(object => object.look))], layer = new Map(looks.map((look, index) => [look, index]));
    // One layer a look, its rows bottom first (the upload flips the canvas): a card samples v = 0 at its foot's side, as a
    // troop card's (see painted-card-batches.ts).
    const page = { texture: createCardArray(LOOK_WIDTH, LOOK_HEIGHT, looks.length, this.anisotropy), uploaded: false };
    this.texture = page.texture;
    looks.forEach((look, index) => this.uploader.uploadCanvasLayer(page, index, standingLookCanvas(look), renderer, { sourceWidth: LOOK_WIDTH, sourceHeight: LOOK_HEIGHT, baseMip: 0 }));
    // The scratch textures served this layout only.
    this.uploader.dispose();
    const texture = page.texture;
    // Alpha to coverage: the multisampled edge of a crown is as soft as the painted ground's was, not a cutout's stair.
    const material = this.material = new THREE.MeshBasicMaterial({ map: texture, alphaTest: .4, alphaToCoverage: true, side: THREE.DoubleSide, toneMapped: false });
    configureCardMaterial(material, [texture], 1);
    const depth = this.depth = new THREE.MeshDepthMaterial({ map: texture, alphaTest: .4, side: THREE.DoubleSide, depthPacking: THREE.RGBADepthPacking });
    configureCardMaterial(depth, [texture], 1);
    // The card's corners in world units at scale one: its foot at the origin, standing up, as a troop card's (see painted-card-batches.ts).
    const rect = [-LOOK_FOOT.x / LOOK_DENSITY, (LOOK_FOOT.y - LOOK_HEIGHT) / (LOOK_DENSITY * TILT),
      (LOOK_WIDTH - LOOK_FOOT.x) / LOOK_DENSITY, LOOK_FOOT.y / (LOOK_DENSITY * TILT)] as const;
    const byChunk = new Map<string, typeof objects>();
    for (const object of objects) {
      const key = `${Math.floor(object.x / CHUNK)},${Math.floor(object.y / CHUNK)}`;
      let list = byChunk.get(key); if (!list) byChunk.set(key, list = []); list.push(object);
    }
    const matrix = new THREE.Matrix4(), scale = new THREE.Vector3(), place = new THREE.Vector3(), turn = new THREE.Quaternion();
    for (const [key, list] of byChunk) {
      const [cx, cy] = key.split(',').map(Number) as [number, number];
      const geometry = new THREE.PlaneGeometry(1, 1);
      const rects = new Float32Array(list.length * 4), layers = new Float32Array(list.length);
      list.forEach((object, i) => { rects.set(rect, i * 4); layers[i] = layer.get(object.look)!; });
      geometry.setAttribute('cardRect', new THREE.InstancedBufferAttribute(rects, 4));
      geometry.setAttribute('cardLayer', new THREE.InstancedBufferAttribute(layers, 1));
      geometry.setAttribute('cardBank', new THREE.InstancedBufferAttribute(new Float32Array(list.length), 1));
      geometry.setAttribute('cardUv', new THREE.InstancedBufferAttribute(new Float32Array(list.length * 4).map((_, i) => i % 4 < 2 ? 0 : 1), 4));
      const mesh = new THREE.InstancedMesh(geometry, material, list.length);
      list.forEach((object, i) => mesh.setMatrixAt(i, matrix.compose(place.set(object.x, 0, object.y), turn, scale.setScalar(object.scale))));
      // Each casts the sun's shadow (docs/art/render-contract.zh.md, rule 4); the ground keeps none painted.
      mesh.name = 'StandingCards'; mesh.frustumCulled = false; mesh.castShadow = true; mesh.customDepthMaterial = depth; mesh.raycast = () => {};
      this.group.add(mesh);
      this.chunks.push({ mesh, left: cx * CHUNK, top: cy * CHUNK });
    }
  }

  dispose() {
    for (const chunk of this.chunks) { this.group.remove(chunk.mesh); chunk.mesh.geometry.dispose(); chunk.mesh.dispose(); }
    this.chunks = [];
    this.material?.dispose(); this.material = undefined;
    this.depth?.dispose(); this.depth = undefined;
    this.texture?.dispose(); this.texture = undefined;
    this.terrain = undefined;
  }
}
