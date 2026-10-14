import { modelArtRevision } from './model-portraits';

/** Every persistent portrait follows the same art revision, including buttons
 * created before lazy model images finish loading. */
export function paintPortrait(canvas: HTMLCanvasElement, key: string, paint: (canvas: HTMLCanvasElement) => void) {
  const width=canvas.clientWidth||canvas.width,height=canvas.clientHeight||canvas.height;
  const revision=`${key}:${modelArtRevision()}:${width}:${height}`;
  if(canvas.dataset.artKey===revision)return;
  const ctx=canvas.getContext('2d')!;
  ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.save();ctx.scale(canvas.width/width,canvas.height/height);
  try{paint(canvas);}finally{ctx.restore();}
  canvas.dataset.artKey=revision;
}
