import { readFileSync } from 'node:fs';
import { it, expect } from 'vitest';
import geometry from '../../shared/generated/ship-geometry.json';
import { deckPointFits, projectDeckPoint } from '../../shared/decks';
import { localToWorld } from '../../shared/ship-geometry';
import { issuePlayerCommand, stepGame } from '../../shared/sim';
import { createShipWebglScene } from './ship-webgl';

it('keeps the authored gun pivot and declares every dynamic rig component in the GLB',()=>{
  const bytes=readFileSync('public/art/world3d/ships/warship.glb');
  expect(bytes.readUInt32LE(0)).toBe(0x46546c67);expect(bytes.readUInt32LE(4)).toBe(2);expect(bytes.readUInt32LE(8)).toBe(bytes.length);
  const gltf=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
  const rig=gltf.nodes.find((node:{name:string})=>node.name==='Hull').extras.shipRig;
  expect(rig.version).toBe(1);expect(rig.sails).toHaveLength(2);
  const components=['Gun','Hull','OwnerFlag',...rig.sails.map((sail:{node:string})=>sail.node),...rig.rigidParts.map((part:{node:string})=>part.node)];
  expect(gltf.nodes.map((node:{name:string})=>node.name).sort()).toEqual(components.sort());
  const flag=gltf.nodes.find((node:{name:string})=>node.name==='OwnerFlag'),flagMesh=gltf.meshes[flag.mesh];
  expect(flagMesh.primitives.length).toBeGreaterThan(0);
  for(const primitive of flagMesh.primitives)expect(gltf.materials[primitive.material]).toMatchObject({name:'TeamColor'});
  for(const sail of rig.sails){
    const node=gltf.nodes.find((node:{name:string})=>node.name===sail.node),mesh=gltf.meshes[node.mesh];
    expect(mesh.extras.targetNames).toEqual(expect.arrayContaining(Object.values(sail.morphTargets)));
    for(const primitive of mesh.primitives)expect(primitive.targets).toHaveLength(3);
  }
  const [x,y,z]=geometry.ships.warship.weaponPivot;
  expect(gltf.nodes.find((node:{name:string})=>node.name==='Gun').translation).toEqual([x,z,y!||0]);
  expect(gltf.meshes).toHaveLength(components.length);expect(bytes.length).toBeLessThan(1024*1024);
});

it('moves physical crew and deals real aimed cannon damage in the preview scene',()=>{
  const {game,ship,target}=createShipWebglScene(),crew=game.units.filter(unit=>unit.deck);
  expect(crew).toHaveLength(2);expect(game.items.filter(item=>item.mountId)).toHaveLength(1);
  const worker=crew.find(unit=>unit.kind==='worker')!,before={...worker.deck!};
  const point=projectDeckPoint(ship,worker,{x:-2,y:-18},game.units)!;
  issuePlayerCommand(game,'player',{type:'move',unitIds:[worker.id],...localToWorld(ship,point)});
  for(let tick=0;tick<40;tick++)stepGame(game);
  expect(Math.hypot(worker.deck!.x-before.x,worker.deck!.y-before.y)).toBeGreaterThan(1);
  for(const unit of crew)expect(deckPointFits(ship,unit,unit.deck!,game.units)).toBe(true);
  issuePlayerCommand(game,'player',{type:'attack',unitIds:[ship.id],targetId:target.id});
  for(let tick=0;tick<240;tick++)stepGame(game);
  expect(target.hp).toBeLessThan(target.maxHp);expect(ship.aim).toBeUndefined();expect(game.items[0]!.aim).toBeDefined();
});
