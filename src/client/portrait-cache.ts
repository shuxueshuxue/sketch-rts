import { bakedAssetsVersion } from './art/baked-assets';

/** Every persistent portrait follows the same art revision, including buttons
 * created before lazy model images finish loading. */
export function paintPortrait(canvas: HTMLCanvasElement, key: string, paint: (canvas: HTMLCanvasElement) => void) {
  const revision=`${key}:${bakedAssetsVersion()}`;
  if(canvas.dataset.artKey===revision)return;
  canvas.getContext('2d')!.clearRect(0,0,canvas.width,canvas.height);
  paint(canvas);
  canvas.dataset.artKey=revision;
}
