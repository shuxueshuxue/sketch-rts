/* Decode bundled functional data without a server, fetch, external library or network access. */
window.PLAN_TIMELINE_READY = (async () => {
 if(!globalThis.DecompressionStream)throw new Error('此离线样稿需要支持 DecompressionStream 的现代浏览器。');
 const bytes=Uint8Array.from(atob(window.PLAN_TIMELINE_PACK.join('')),c=>c.charCodeAt(0));
 const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
 const payload=await new Response(stream).json();
 window.PLAN_TIMELINE_NODES=payload.nodes;
 delete payload.nodes;
 window.PLAN_TIMELINE=payload;
 delete window.PLAN_TIMELINE_PACK;
})();
