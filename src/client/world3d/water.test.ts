import { describe, expect, it, vi } from 'vitest';
import { Scene, DataTexture, ShaderMaterial } from 'three';
import { WaterSurface } from './water';
import type { Terrain } from '../../shared/terrain';

describe('GPU water lifecycle and rendering budget', () => {
  it('uses two triangles and one cell-sized texture, reuses it across frames and disposes it on map changes', () => {
    const scene = new Scene(), water = new WaterSurface(scene);
    const terrain: Terrain = { cols: 20, rows: 20, cell: 32, cells: '~'.repeat(400) };
    water.prepare(terrain);
    expect(scene.children).toHaveLength(1);
    expect(water.mesh.geometry.index!.count).toBe(6);
    const texture = water.mesh.material.uniforms.shore!.value as DataTexture;
    expect(texture.image.width).toBe(20); expect(texture.image.height).toBe(20);
    const dispose = vi.spyOn(texture, 'dispose');
    for (let i = 0; i < 120; i++) { water.prepare(terrain); water.update(i * 16); }
    expect(dispose).not.toHaveBeenCalled();
    expect(water.mesh.material.uniforms.shore!.value).toBe(texture);
    expect(water.mesh.material.uniforms.seconds!.value).toBeCloseTo(1.904);
    water.update(2000, true); expect(water.mesh.material.uniforms.seconds!.value).toBe(0);
    water.prepare({ ...terrain, cells: '.'.repeat(400) });
    expect(dispose).toHaveBeenCalledOnce(); expect(water.mesh.visible).toBe(false);
    expect(water.mesh.material.uniforms.shore!.value).toBeNull();
    water.dispose(); expect(scene.children).toHaveLength(0);
  });
  it('shares softened coast coverage without ever adding a selectable entity or a reflection render callback', () => {
    const scene = new Scene(), water = new WaterSurface(scene);
    water.prepare({ cols: 4, rows: 1, cell: 32, cells: '.,~=' });
    const pixels = (water.mesh.material.uniforms.shore!.value as DataTexture).image.data!;
    expect([pixels[0], pixels[4], pixels[8], pixels[12]]).toEqual([64, 191, 191, 64]);
    expect(water.mesh.material.transparent).toBe(true);
    expect(water.mesh.material.depthWrite).toBe(false);
    expect(water.mesh.material.uniforms.seabed).toBeUndefined();
    const intersections: unknown[] = []; water.mesh.raycast({} as never, intersections as never);
    expect(intersections).toEqual([]);
    expect(water.mesh.material).toBeInstanceOf(ShaderMaterial);
    expect(water.mesh.castShadow).toBe(false);
    water.dispose();
  });
});
