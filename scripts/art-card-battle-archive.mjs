/** Reuse an already verified lossless movie only after exact fresh PNG proof. */
import {readFile,writeFile,unlink} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
const arg=k=>{const i=process.argv.indexOf(k);return process.argv[i+1];};
const root=resolve(arg('--root')),reference=resolve(arg('--reference'));
const sha=v=>createHash('sha256').update(v).digest('hex');
const oldProof=JSON.parse(await readFile(resolve(reference,'before/proof.json'))),oldArchive=JSON.parse(await readFile(resolve(reference,'archive.json')));
const movie=resolve(reference,oldArchive.archives.before.file);
if(!oldArchive.rgbaIdentical||!oldArchive.archives.before.verified||sha(await readFile(movie))!==oldArchive.archives.before.sha256)throw new Error('Invalid reference lossless archive');
const proofs={};
for(const side of ['before','after']){
 const directory=resolve(root,`battle-${side}`),p=proofs[side]=JSON.parse(await readFile(resolve(directory,'proof.json')));
 if(!p.passed||p.framePngSha256.length!==oldProof.framePngSha256.length||JSON.stringify(p.framePngSha256)!==JSON.stringify(oldProof.framePngSha256))throw new Error('Fresh captures do not match reference PNGs');
 for(let i=0;i<p.framePngSha256.length;i++)if(sha(await readFile(resolve(directory,`frame-${String(i).padStart(3,'0')}.png`)))!==p.framePngSha256[i])throw new Error(`Changed fresh frame ${side}/${i}`);
}
if(JSON.stringify(proofs.before.simSnapshotHashes)!==JSON.stringify(proofs.after.simSnapshotHashes)||JSON.stringify(proofs.before.viewportSource.sourceTrees)!==JSON.stringify(proofs.after.viewportSource.sourceTrees)||proofs.before.viewportSource.normalizedFixtureSha256!==proofs.after.viewportSource.normalizedFixtureSha256)throw new Error('Changed simulation or battle fixture');
const result={passed:true,frames:proofs.before.framePngSha256.length,simulationHashesIdentical:true,encodedPngHashesIdentical:true,sourceTreesIdentical:true,normalizedFixtureSha256:proofs.before.viewportSource.normalizedFixtureSha256,beforeCommit:proofs.before.viewportSource.sourceCommit,afterCommit:proofs.after.viewportSource.sourceCommit,archive:{file:relative(root,movie),sha256:oldArchive.archives.before.sha256,bytes:oldArchive.archives.before.bytes,rgbaSha256:oldArchive.rgbaSha256.before},scope:'Every newly captured encoded PNG was rehashed and is identical to both the paired fresh capture and the previous independently decoded/verified FFV1 archive source. The unchanged archive file was rehashed; no lossy viewing video is used as pixel evidence. Reuse avoids duplicating an identical 19MB archive. Simulation snapshots and shared/AI/server source trees also match. Selected PNGs, camera probes, fresh capture provenance, hashes and H.264 viewing videos remain.'};
await writeFile(resolve(root,'battle-comparison.json'),JSON.stringify(result,null,2)+'\n');
for(const side of ['before','after'])for(let i=0;i<proofs[side].framePngSha256.length;i++)await unlink(resolve(root,`battle-${side}`,`frame-${String(i).padStart(3,'0')}.png`));
console.log(JSON.stringify({passed:result.passed,frames:result.frames,archive:result.archive.file}));
