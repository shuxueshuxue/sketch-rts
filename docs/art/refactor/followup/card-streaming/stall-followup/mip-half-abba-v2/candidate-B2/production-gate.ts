/** Residency gate for tails copied from the original GPU mip chain. Preserve
 * every sampling pass, a full-level margin and a derivative allowance; unsupported
 * projections retain the full chain. Anisotropic behavior is driver-dependent,
 * so the gate is also verified against rendered color and shadow images. */
import type {Camera,Matrix4,OrthographicCamera} from 'three';
import {SHIP_CAMERA} from '../../shared/ship-geometry';

const TILT=Math.tan(SHIP_CAMERA.tilt);
const MAX_BASE_MIP=4,DERIVATIVE_ALLOWANCE=1.01;

export type CardMipPass={
  /** Updated public matrices of an actual orthographic color or shadow camera.
   * Do not pass LightShadow.matrix: its texture-coordinate bias is different. */
  camera:Camera;
  physicalWidth:number;
  physicalHeight:number;
};
export type CardMipResidencyInput={
  sourceSize:number;
  tileSize:number;
  foot:number;
  matrix:Matrix4;
  /** Every sampling pass must be included, with physical framebuffer pixels
   * (including DPR). Unknown/unsupported passes keep the complete chain. */
  passes:readonly CardMipPass[];
};
export type CardMipFootprint={maximumPixelsPerUV:number;minimumTexelsPerPixel:number};

function affine(matrix:Matrix4){
  const e=matrix.elements;
  for(const value of e)if(!Number.isFinite(value))return false;
  // Public inverse-camera matrices can round the constant homogeneous W a few
  // double-precision ulps away from one. This is still affine, not perspective.
  return e[3]===0&&e[7]===0&&e[11]===0&&Math.abs(e[15]!-1)<=Number.EPSILON*32;
}
function nonsingular(matrix:Matrix4){
  const e=matrix.elements;
  const determinant=e[0]!*(e[5]!*e[10]!-e[9]!*e[6]!)-e[4]!*(e[1]!*e[10]!-e[9]!*e[2]!)+e[8]!*(e[1]!*e[6]!-e[5]!*e[2]!);
  return Number.isFinite(determinant)&&determinant!==0;
}
function singularValue(a:number,b:number,c:number,d:number){
  const scale=Math.max(Math.abs(a),Math.abs(b),Math.abs(c),Math.abs(d));
  if(!Number.isFinite(scale)||scale===0)return NaN;
  a/=scale;b/=scale;c/=scale;d/=scale;
  // A grazing/degenerate projection is outside this candidate's proof domain.
  if(Math.abs(a*d-b*c)<=Number.EPSILON*32)return NaN;
  const aa=a*a+c*c,bb=b*b+d*d,ab=a*b+c*d;
  return scale*Math.sqrt((aa+bb+Math.hypot(aa-bb,2*ab))/2);
}
function passStretch(pass:CardMipPass,matrix:Matrix4,width:number,height:number){
  const camera=pass.camera;
  if(!(camera as OrthographicCamera).isOrthographicCamera||!Number.isFinite(pass.physicalWidth)||!Number.isFinite(pass.physicalHeight)||pass.physicalWidth<=0||pass.physicalHeight<=0)return NaN;
  if(!affine(camera.projectionMatrix)||!affine(camera.matrixWorldInverse)||!nonsingular(camera.matrixWorldInverse))return NaN;
  const p=camera.projectionMatrix.elements,v=camera.matrixWorldInverse.elements,m=matrix.elements;
  // Orthographic clip W is constant. Project the instance's U/V basis vectors
  // through the linear part of P*V*M, then convert NDC to physical pixels.
  const homogeneousW=p[15]!*v[15]!*m[15]!;
  const sx=pass.physicalWidth/(2*homogeneousW),sy=-pass.physicalHeight/(2*homogeneousW);
  const x0=(p[0]!*v[0]!+p[4]!*v[1]!+p[8]!*v[2]!)*sx;
  const x1=(p[0]!*v[4]!+p[4]!*v[5]!+p[8]!*v[6]!)*sx;
  const x2=(p[0]!*v[8]!+p[4]!*v[9]!+p[8]!*v[10]!)*sx;
  const y0=(p[1]!*v[0]!+p[5]!*v[1]!+p[9]!*v[2]!)*sy;
  const y1=(p[1]!*v[4]!+p[5]!*v[5]!+p[9]!*v[6]!)*sy;
  const y2=(p[1]!*v[8]!+p[5]!*v[9]!+p[9]!*v[10]!)*sy;
  const a=(x0*m[0]!+x1*m[1]!+x2*m[2]!)*width;
  const b=(x0*m[4]!+x1*m[5]!+x2*m[6]!)*height;
  const c=(y0*m[0]!+y1*m[1]!+y2*m[2]!)*width;
  const d=(y0*m[4]!+y1*m[5]!+y2*m[6]!)*height;
  return singularValue(a,b,c,d);
}

/** Constant UV→screen Jacobian for the original affine card. Translation,
 * reflection, rotation, shear and nonuniform scale are handled by its matrix.
 * Undefined means the complete original mip chain must remain resident. */
export function cardMipFootprint(input:CardMipResidencyInput):CardMipFootprint|undefined{
  const {sourceSize,tileSize,foot,matrix,passes}=input;
  if(!Number.isInteger(sourceSize)||sourceSize<=0||!Number.isFinite(tileSize)||tileSize<=0||!Number.isFinite(foot)||!passes.length||!affine(matrix)||!nonsingular(matrix))return;
  const half=tileSize/2;
  // These are the actual float32 cardRect endpoints, not an idealized tile/TILT.
  const width=Math.fround(half)-Math.fround(-half);
  const low=Math.fround(Math.fround(-half/TILT)+foot/TILT),high=Math.fround(Math.fround(half/TILT)+foot/TILT),height=high-low;
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)return;
  let maximumPixelsPerUV=0;
  for(const pass of passes){
    const stretch=passStretch(pass,matrix,width,height);
    if(!Number.isFinite(stretch)||stretch<=0)return;
    maximumPixelsPerUV=Math.max(maximumPixelsPerUV,stretch);
  }
  const minimumTexelsPerPixel=sourceSize/(maximumPixelsPerUV*DERIVATIVE_ALLOWANCE);
  if(!Number.isFinite(minimumTexelsPerPixel)||minimumTexelsPerPixel<=0)return;
  return{maximumPixelsPerUV,minimumTexelsPerPixel};
}

/** Keep one original level above the candidate base, plus a 1% allowance for
 * CPU versus GPU derivative variation observed in the isolated prototype.
 * An exact integer rebase also preserves NPOT normalized-UV and mip extents. */
export function cardBaseMip(input:CardMipResidencyInput):number{
  const footprint=cardMipFootprint(input);if(!footprint)return 0;
  let base=Math.max(0,Math.min(MAX_BASE_MIP,Math.floor(Math.log2(footprint.minimumTexelsPerPixel)-1)));
  while(base>0&&input.sourceSize%(2**base)!==0)base--;
  return base;
}
