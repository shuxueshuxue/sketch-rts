import * as THREE from 'three';
import type { Terrain } from '../../shared/terrain';
import { SHIP_CAMERA } from '../../shared/ship-geometry';
import { waterField, waterCoverPixels, waterNormalPixels, WATER_NORMAL_SIZE } from '../water-field';

export const WATER_VERTEX_SHADER = `
varying vec2 waterPosition;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  waterPosition = world.xz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

/** Analytic normals, shallow absorption and Fresnel sky reflection, in the
 * existing actor render pass. No mirror camera, framebuffer readback, FFT grid
 * or additional scene render. GPU Gems ch. 1 supplies the wave model; Three's
 * Water addon is the reference for the separation of normal/light/reflection. */
export const WATER_FRAGMENT_SHADER = `
uniform sampler2D shore;
uniform sampler2D normals;
uniform sampler2D seabed;
uniform vec2 worldSize;
uniform float seconds;
varying vec2 waterPosition;
void main() {
  vec2 field = texture2D(shore, waterPosition / worldSize).rg;
  if (field.r < .5) discard;
  vec2 a = texture2D(normals, waterPosition / 384.0 - seconds * vec2(.009, .003)).rg;
  vec2 b = texture2D(normals, waterPosition / 613.0 + seconds * vec2(.004, -.005)).rg;
  vec2 slope = a + b - vec2(1.0);
  slope *= mix(.25, 2.1, field.g);
  vec3 normal = normalize(vec3(-slope.x, 1.0, -slope.y));
  vec3 view = vec3(0.0, ${Math.cos(SHIP_CAMERA.tilt).toFixed(7)}, ${Math.sin(SHIP_CAMERA.tilt).toFixed(7)});
  vec3 sun = normalize(vec3(-.45, .65, .25));
  float fresnel = .02 + .98 * pow(1.0 - max(0.0, dot(normal, view)), 5.0);
  float shine = pow(max(0.0, dot(normal, normalize(sun + view))), 24.0);
  vec3 bed = texture2D(seabed, waterPosition / worldSize).rgb;
  vec3 sky = vec3(.38, .53, .57);
  vec3 colour = mix(bed, sky, fresnel * .8);
  colour += vec3(.75, .69, .51) * shine * .18;
  colour *= .94 + .12 * dot(normal, sun);
  float caustic = pow(max(0.0, 1.0 - abs(slope.x * 3.0 - slope.y * 2.0)), 24.0);
  colour += vec3(.045, .065, .04) * caustic * pow(1.0 - field.g, 2.0);
  float foam = (1.0 - smoothstep(.015, .18, field.g)) *
    pow(.5 + .5 * sin(dot(waterPosition, vec2(.038, .012)) - seconds * .9), 6.0);
  colour = mix(colour, vec3(.57, .65, .56), foam * .15);
  gl_FragColor = vec4(colour, 1.0);
  #include <colorspace_fragment>
}`;

export class WaterSurface {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private terrain: Terrain | undefined;
  private texture: THREE.DataTexture | undefined;
  private seabed: THREE.DataTexture | undefined;
  private normals: THREE.DataTexture | undefined;
  constructor(scene: THREE.Scene) {
    const material = new THREE.ShaderMaterial({
      vertexShader: WATER_VERTEX_SHADER, fragmentShader: WATER_FRAGMENT_SHADER, toneMapped: false,
      uniforms: { shore: { value: null }, normals: { value: null }, seabed: { value: null }, worldSize: { value: new THREE.Vector2() }, seconds: { value: 0 } },
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), material);
    this.mesh.name = 'WaterSurface'; this.mesh.visible = false;
    this.mesh.raycast = () => {}; // Presentation surface must never intercept unit selection.
    scene.add(this.mesh);
  }
  prepare(terrain: Terrain | undefined) {
    if (terrain === this.terrain) return;
    this.texture?.dispose(); this.texture = undefined;
    this.seabed?.dispose(); this.seabed = undefined; this.terrain = terrain;
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
      pixels[i * 4] = field.wet[i]! * 255;
      pixels[i * 4 + 1] = Math.round(field.depth[i]! * 255);
      pixels[i * 4 + 3] = 255;
    }
    this.texture = new THREE.DataTexture(pixels, terrain.cols, terrain.rows);
    this.texture.minFilter = this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false; this.texture.needsUpdate = true;
    const cover = waterCoverPixels(terrain);
    this.seabed = new THREE.DataTexture(cover.pixels, cover.width, cover.height);
    this.seabed.colorSpace = THREE.SRGBColorSpace;
    this.seabed.minFilter = this.seabed.magFilter = THREE.LinearFilter;
    this.seabed.generateMipmaps = false; this.seabed.needsUpdate = true;
    const width = terrain.cols * terrain.cell, height = terrain.rows * terrain.cell;
    this.mesh.position.set(width / 2, -.2, height / 2); this.mesh.scale.set(width, 1, height);
    this.mesh.material.uniforms.shore!.value = this.texture;
    this.mesh.material.uniforms.seabed!.value = this.seabed;
    this.mesh.material.uniforms.worldSize!.value.set(width, height);
  }
  update(now: number, reducedMotion = false) { this.mesh.material.uniforms.seconds!.value = reducedMotion ? 0 : now / 1000; }
  dispose() { this.normals?.dispose(); this.texture?.dispose(); this.seabed?.dispose(); this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.mesh.removeFromParent(); }
}
