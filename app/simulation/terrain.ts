export type Trench={x:number;z:number;width:number;length:number;depth:number};
export type Tree={x:number;z:number;height:number;radius:number;crownCleared?:boolean};
export type Hideout={x:number;z:number;radius:number;height:number;name:string;cleared?:boolean};
export type WorldMap={size:number;seed:number;trees:Tree[];trenches:Trench[];hideouts:Hideout[];clearings?:{x:number;z:number;radius:number;bottom:number}[]};
function randomFor(seed:number){let state=seed>>>0;return()=>{state=(state*1664525+1013904223)>>>0;return state/4294967296;};}
/** Chunk-seeded generation preserves existing terrain when the map expands. */
export function generateMap(size=60,seed=8):WorldMap{
 size=Math.max(60,Math.min(150,Math.round(size/30)*30));
 const map:WorldMap={size,seed,trees:[],trenches:[],hideouts:[]};
 for(let cx=0;cx<size/30;cx++)for(let cz=0;cz<size/30;cz++){
  const random=randomFor(seed+cx*73856093+cz*19349663),x=cx*30,z=cz*30;
  map.hideouts.push({x:x+15+random()*5,z:z+13+random()*5,radius:2.3,height:2.6,name:`Grove ${cx+1}.${cz+1}`});
  for(let i=0;i<5;i++)map.trees.push({x:x+8+random()*16,z:z+5+random()*4,height:4+random()*2,radius:1.4+random()*.6});
  map.hideouts.push({x:x+6+random()*3,z:z+17+random()*3,radius:1.8,height:2.4,name:`Brush ${cx+1}.${cz+1}`});
  const horizontal=random()>.5;
  map.trenches.push({x:x+15,z:z+24,width:horizontal?20:3,length:horizontal?3:10,depth:1+random()*.4});
 }
 return map;
}
export const DEFAULT_MAP=generateMap();
export const TREES=DEFAULT_MAP.trees;
export const TRENCHES=DEFAULT_MAP.trenches;
export function terrainHeight(x:number,z:number,map:WorldMap=DEFAULT_MAP){
 let height=0;
 for(const t of map.trenches){const edge=Math.min(t.width/2-Math.abs(x-t.x),t.length/2-Math.abs(z-t.z));if(edge>0)height=Math.min(height,-t.depth*Math.min(1,edge/.8));}
 return height;
}
export function blockedByTrunk(x:number,z:number,map:WorldMap=DEFAULT_MAP){return map.trees.some(t=>Math.hypot(x-t.x,z-t.z)<.8);}
export function sightBlocked(from:{x:number;y:number;z:number},to:{x:number;y:number;z:number},map:WorldMap){
 const dx=to.x-from.x,dy=to.y-from.y,dz=to.z-from.z;
 // Sample the camera ray through terrain and foliage volumes, never actor positions
 // outside this ray. Cover affects the drone sensor, not the observer locator.
 const steps=Math.ceil(Math.hypot(dx,dy,dz)/.4);
 for(let i=1;i<steps;i++){const t=i/steps,x=from.x+dx*t,y=from.y+dy*t,z=from.z+dz*t;
  if(y<terrainHeight(x,z,map)+.06)return true;
  if(!foliageCleared(x,y,z,map)&&map.hideouts.some(h=>!h.cleared&&Math.hypot(x-h.x,z-h.z)<h.radius&&y<terrainHeight(h.x,h.z,map)+h.height))return true;
  if(!foliageCleared(x,y,z,map)&&map.trees.some(tree=>!tree.crownCleared&&Math.hypot(x-tree.x,z-tree.z)<tree.radius&&y>1.5&&y<tree.height))return true;
 }
 return false;
}

/** Rotor wash cuts a narrow column only as the aircraft descends through it. */
export function foliageCleared(x:number,y:number,z:number,map:WorldMap){
 return map.clearings?.some(c=>Math.hypot(x-c.x,z-c.z)<c.radius&&y>=c.bottom)??false;
}
export function clearLandingPath(x:number,y:number,z:number,map:WorldMap){
 const cuts=map.clearings??(map.clearings=[]);
 const prior=cuts.find(c=>Math.hypot(x-c.x,z-c.z)<.25);
 if(prior)prior.bottom=Math.min(prior.bottom,y-.6);
 else if(cuts.length<256)cuts.push({x,z,radius:.85,bottom:y-.6});
}

/** Touchdown removes the whole intersected foliage patch; trunks stay solid. */
export function clearTouchdownFoliage(x:number,z:number,map:WorldMap){
 for(const cover of map.hideouts)if(Math.hypot(x-cover.x,z-cover.z)<cover.radius+.22)cover.cleared=true;
 for(const tree of map.trees)if(Math.hypot(x-tree.x,z-tree.z)<tree.radius+.22)tree.crownCleared=true;
}
