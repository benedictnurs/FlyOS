import {PHYSICAL_SCALE} from './scale';
export type Position3 = {x:number;y:number;z:number};
export const PERSON_HEIGHT=PHYSICAL_SCALE.personHeight;
export const HEAD_RADIUS=PHYSICAL_SCALE.headRadius;
export const LANDING_RADIUS=PHYSICAL_SCALE.landingRadius;
export const LANDING_CENTER=PHYSICAL_SCALE.landingCenter;
/** Sphere contact between the avatar head and the drone's lower landing envelope.
 * Positive separation is not contact. All coordinates are world-space meters.
 * These are explicit game colliders, not a pixel/GLB triangle intersection.
 */
export function personContact(drone:Position3,person:Position3){
 const dx=drone.x-person.x,dz=drone.z-person.z;
 const headY=person.y+PERSON_HEIGHT-HEAD_RADIUS;
 const dy=drone.y+LANDING_CENTER-headY;
 const radius=HEAD_RADIUS+LANDING_RADIUS;
 const distance=Math.hypot(dx,dy,dz),separation=distance-radius;
 const horizontal=Math.hypot(dx,dz);
 const supported=dy>0&&horizontal<radius;
 return {
  touching:supported&&separation<=0,
  separation,
  supportHeight:supported?headY+Math.sqrt(Math.max(0,radius*radius-horizontal*horizontal))-LANDING_CENTER:drone.y,
  point:{x:person.x+dx*HEAD_RADIUS/Math.max(distance,.0001),y:headY+dy*HEAD_RADIUS/Math.max(distance,.0001),z:person.z+dz*HEAD_RADIUS/Math.max(distance,.0001)},
 };
}
