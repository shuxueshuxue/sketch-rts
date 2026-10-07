import * as THREE from 'three';
import type { Terrain } from '../../shared/terrain';
import { SHIP_CAMERA } from '../../shared/ship-geometry';
import { waterField, waterNormalPixels, WATER_NORMAL_SIZE, WATER_SHORE_FADE, WATER_DEPTH_FADE } from '../water-field';

export const WATER_VERTEX_SHADER = `
varying vec2 waterPosition;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  waterPosition = world.xz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

/** Transparent surface light over the shared Canvas seabed. Water colour and
 * coast coverage have one source; the actor pass cannot paint a second ocean. */
export const WATER_FRAGMENT_SHADER = `
uniform sampler2D shore;
uniform sampler2D normals;
uniform vec2 worldSize;
uniform float seconds;
varying vec2 waterPosition;
void main() {
  vec2 field = texture2D(shore, waterPosition / worldSize).rg;
  float coverage = smoothstep(${WATER_SHORE_FADE[0]}, ${WATER_SHORE_FADE[1]}, field.r);
  float strength = coverage * smoothstep(${WATER_DEPTH_FADE[0]}, ${WATER_DEPTH_FADE[1]}, field.g);
  if (strength < .001) discard;
  vec2 a = texture2D(normals, waterPosition / 256.0 - seconds * vec2(7.0, 3.0) / 256.0).rg;
  vec2 b = texture2D(normals, waterPosition / 384.0 + seconds * vec2(3.0, -5.0) / 384.0).rg;
  vec2 slope = (a + b - vec2(1.0)) * mix(.35, 1.0, field.g);
  vec3 normal = normalize(vec3(-slope.x, 1.0, -slope.y));
  vec3 view = vec3(0.0, ${Math.cos(SHIP_CAMERA.tilt).toFixed(7)}, ${Math.sin(SHIP_CAMERA.tilt).toFixed(7)});
  vec3 sun = normalize(vec3(-.45, .65, .25));
  float fresnel = .02 + .98 * pow(1.0 - max(0.0, dot(normal, view)), 5.0);
  float shine = pow(max(0.0, dot(normal, normalize(sun + view))), 12.0);
  // Linear RGB of the quiet, cool sky highlight; Three encodes it for display.
  gl_FragColor = vec4(.521, .694, .665, strength * (.004 + .22 * shine + .08 * fresnel));
  #include <colorspace_fragment>
}`;

export class WaterSurface {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private terrain: Terrain | undefined;
  private texture: THREE.DataTexture | undefined;
  private normals: THREE.DataTexture | undefined;
  constructor(scene: THREE.Scene) {
    const material = new THREE.ShaderMaterial({
      vertexShader: WATER_VERTEX_SHADER, fragmentShader: WATER_FRAGMENT_SHADER, toneMapped: false, transparent: true, depthWrite: false,
      uniforms: { shore: { value: null }, normals: { value: null }, worldSize: { value: new THREE.Vector2() }, seconds: { value: 0 } },
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), material);
    this.mesh.name = 'WaterSurface'; this.mesh.visible = false;
    this.mesh.raycast = () => {}; // Presentation surface must never intercept unit selection.
    scene.add(this.mesh);
  }
  prepare(terrain: Terrain | undefined) {
    if (terrain === this.terrain) return;
    this.texture?.dispose(); this.texture = undefined;
    this.mesh.material.uniforms.shore!.value = null; this.terrain = terrain;
    this.mesh.visible = Boolean(terrain && waterField(terrain).hasWater);
    if (!terrain || !this.mesh.visible) return;
    if (!this.normals) {
      this.normals = new THREE.DataTexture(waterNormalPixels(), WATER_NORMAL_SIZE, WATER_NORMAL_SIZE);
      this.normals.minFilter = this.normals.magFilter = THREE.LinearFilter;
      this.normals.wrapS = this.normals.wrapT = THREE.RepeatWrapping;
      this.normals.generateMipmaps = false; this.normals.needsUpdate = true;
      this.mesh.material.uniforms.normals!.value = this.normals;
    }
    const field = waterField(terrain), pixels = new Uint8Array(terrain.cols * terrain.rows * 4);
    for (let i = 0; i < field.wet.length; i++) {
      pixels[i * 4] = Math.round(field.coverage[i]! * 255);
      pixels[i * 4 + 1] = Math.round(field.depth[i]! * 255);
      pixels[i * 4 + 3] = 255;
    }
    this.texture = new THREE.DataTexture(pixels, terrain.cols, terrain.rows);
    this.texture.minFilter = this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false; this.texture.needsUpdate = true;
    const width = terrain.cols * terrain.cell, height = terrain.rows * terrain.cell;
    this.mesh.position.set(width / 2, -.2, height / 2); this.mesh.scale.set(width, 1, height);
    this.mesh.material.uniforms.shore!.value = this.texture;
    this.mesh.material.uniforms.worldSize!.value.set(width, height);
  }
  update(now: number, reducedMotion = false) { this.mesh.material.uniforms.seconds!.value = reducedMotion ? 0 : now / 1000; }
  dispose() { this.normals?.dispose(); this.texture?.dispose(); this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.mesh.removeFromParent(); }
}
