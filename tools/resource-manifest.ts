import { readdir,stat,writeFile,readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
export async function resourceManifest(root:string){
  const assets:{url:string;bytes:number;kind:string;stage:string;revision:string}[]=[];
  async function walk(directory:string,prefix=''){
    for(const entry of await readdir(directory,{withFileTypes:true})){
      if(entry.name.startsWith('.')||entry.name==='resource-manifest.json')continue;
      const url=prefix+entry.name,path=join(directory,entry.name);
      if(entry.isDirectory()){await walk(path,url+'/');continue;}
      const bytes=(await stat(path)).size,ext=url.split('.').pop();
      const kind=ext==='glb'?'model':ext==='png'?'texture':ext==='woff2'?'font':ext==='js'?'code':ext==='css'?'style':['ogg','mp3','wav'].includes(ext??'')?'audio':'data';
      const stage=!url.startsWith('assets/benchmark-')&&url.startsWith('assets/')&&['code','style','font'].includes(kind)?/world3d|world-vendor/.test(url)?'renderer':'startup':'lazy';
      assets.push({url,bytes,kind,stage,revision:createHash('sha256').update(await readFile(path)).digest('hex').slice(0,12)});
    }
  }
  await walk(root);return{assets:assets.sort((a,b)=>a.url.localeCompare(b.url))};
}
export async function writeResourceManifest(root:string){await writeFile(join(root,'resource-manifest.json'),JSON.stringify(await resourceManifest(root)));}
