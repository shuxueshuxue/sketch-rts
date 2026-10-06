import { OrthographicCamera,Vector3,Plane,Raycaster,Vector2 } from 'three';
import { SHIP_CAMERA } from '../../shared/ship-geometry';
export type WorldView={x:number;y:number;width:number;height:number;zoom?:number};
const TILT=SHIP_CAMERA.tilt;

/** Ground points project identically to the existing 2D map. Height is real;
 * only the orthographic viewport compensates for the oblique camera angle. */
export function configureWorldCamera(camera:OrthographicCamera,view:WorldView){
  const zoom=view.zoom??1,cx=view.x+view.width/(2*zoom),cy=view.y+view.height/(2*zoom);
  camera.left=-view.width/(2*zoom);camera.right=-camera.left;
  camera.top=view.height*Math.cos(TILT)/(2*zoom);camera.bottom=-camera.top;
  camera.near=1;camera.far=12000;
  camera.position.set(cx,6000*Math.cos(TILT),cy+6000*Math.sin(TILT));camera.lookAt(cx,0,cy);
  camera.updateProjectionMatrix();camera.updateMatrixWorld();
}
export function projectWorld(view:WorldView,point:{x:number;y:number},height=0){const z=view.zoom??1;return{x:(point.x-view.x)*z,y:(point.y-view.y-height*Math.tan(TILT))*z};}
export function screenOnPlane(camera:OrthographicCamera,view:WorldView,point:{x:number;y:number},height=0){
  const ray=new Raycaster();ray.setFromCamera(new Vector2(point.x/view.width*2-1,1-point.y/view.height*2),camera);
  const hit=ray.ray.intersectPlane(new Plane(new Vector3(0,1,0),-height),new Vector3());
  return hit?{x:hit.x,y:hit.z}:undefined;
}
