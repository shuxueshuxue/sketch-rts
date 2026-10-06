import {afterEach,describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {resources} from '../resources';
import {ModelLibrary} from './model-library';

afterEach(()=>vi.restoreAllMocks());
describe('shared in-flight model preparation',()=>{
  it('records both phases while sharing one parse of the actual GLB',async()=>{
    let release!:(bytes:ArrayBuffer)=>void;
    const data=new Promise<ArrayBuffer>(resolve=>{release=resolve;});
    const request=vi.spyOn(resources,'bytes').mockReturnValue(data),library=new ModelLibrary();
    const home=library.prepare(['ships/warship'],'home'),match=library.prepare(['ships/warship'],'match');
    expect(request.mock.calls.map(call=>call[2])).toEqual(['home','match']);
    const bytes=readFileSync('public/art/world3d/ships/warship.glb');
    release(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer);
    await Promise.all([home,match]);expect(library.component('ships/warship','Hull')).toBeTruthy();library.dispose();
  });
});
