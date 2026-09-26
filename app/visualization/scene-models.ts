import * as T from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {fixtures} from './house-layout';
import type {Materials} from './materials';
export function rounded(parent:T.Object3D,material:T.Material,position:number[],size:number[],radius=.025){
 const mesh=new T.Mesh(new RoundedBoxGeometry(size[0],size[1],size[2],2,Math.min(radius,...size.map(v=>v/3))),material);
 mesh.position.set(position[0],position[1],position[2]);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
}
export function cylinder(parent:T.Object3D,material:T.Material,position:number[],r:number,h:number,top=r){
 const mesh=new T.Mesh(new T.CylinderGeometry(top,r,h,24),material);mesh.position.set(position[0],position[1],position[2]);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
}
export function makeHouse(scene:T.Scene,m:Materials){
 const root=new T.Group();root.name='Existing household / visual dressing';scene.add(root);
 fixtures.forEach(f=>rounded(root,m[f.material],f.position,f.size,f.radius??.015));
 // Shadow gaps, skirting, panel reveals and brushed handles.
 rounded(root,m.trim,[-.49,.075,5],[.045,.15,11.15]);rounded(root,m.trim,[5,.075,10.49],[11.15,.15,.045]);
 rounded(root,m.graphite,[.535,.09,2.4],[.025,.12,4.65]);
 for(let z=.5;z<4.6;z+=.78){rounded(root,m.graphite,[.506,.52,z],[.012,.75,.012],.002);rounded(root,m.brass,[.555,.82,z+.17],[.028,.026,.29],.01);}
 for(let x=.8;x<3.5;x+=.65){rounded(root,m.graphite,[x,.5,.51],[.009,.69,.01]);rounded(root,m.brass,[x+.24,.76,.54],[.22,.025,.04]);}
 rounded(root,m.metal,[4.43,1.05,.36],[.035,.62,.04]);rounded(root,m.graphite,[4,.72,.661],[.72,.012,.009]);
 // Oven, glass hob and induction rings.
 rounded(root,m.visor,[2.7,.48,.525],[.64,.56,.035],.025);rounded(root,m.metal,[2.7,.77,.58],[.51,.035,.05]);rounded(root,m.visor,[2.7,1,.1],[.74,.015,.65]);
 for(const x of [2.49,2.91]) for(const z of [-.08,.27]){const ring=new T.Mesh(new T.TorusGeometry(.105,.007,6,32),m.metal);ring.rotation.x=Math.PI/2;ring.position.set(x,1.011,z);root.add(ring);}
 // Cushions with piping and small variations; footprints remain unchanged.
 [7,8,9].forEach(x=>{rounded(root,m.fabric,[x,.61,.77],[.88,.2,.85],.085);rounded(root,m.sage,[x,.83,.39],[.85,.48,.19],.08).rotation.x=-.12;});
 const cushion=rounded(root,m.terracotta,[7,.85,.77],[.43,.43,.16],.09);cushion.rotation.z=.2;cushion.rotation.x=-.23;
 rounded(root,m.fabric,[9,.82,.77],[.43,.43,.18],.09).rotation.z=-.24;
 const rug=rounded(root,m.fabric,[8,.035,2.8],[3.8,.018,2.5],.007);
 for(let i=0;i<9;i++)rounded(root,m.sage,[6.15+i*.46,.047,2.8],[.015,.003,2.44],.001);
 rounded(root,m.visor,[9.96,1.17,3.2],[.065,1.02,1.72],.02);rounded(root,m.graphite,[9.96,.73,3.2],[.18,.16,.38]);
 rounded(root,m.sage,[1.6,.8,8.0],[2.5,.11,1.65],.04);
 [1,2.2].forEach(x=>rounded(root,m.fabric,[x,.85,9.4],[1,.16,.57],.075));
 for(let z=7.3;z<8.6;z+=.12)rounded(root,m.fabric,[1.6,.863,z],[2.45,.006,.012],.002);
 // Bath rim, porcelain basin, mirror and taps.
 rounded(root,m.tile,[9,.43,9],[1.2,.02,1.91],.1);
 [[8.3,9,.12,2.16],[9.7,9,.12,2.16],[9,8,.14,1.4],[9,10,.14,1.4]].forEach((a,i)=>rounded(root,m.trim,[a[0],.53,a[1]],i<2?[a[2],.24,a[3]]:[a[3],.24,a[2]],.07));
 rounded(root,m.trim,[6.2,1.015,9.7],[.8,.14,.51],.08);rounded(root,m.metal,[6.2,1.8,10.48],[1.25,1.2,.025],.02);
 cylinder(root,m.metal,[6.2,1.18,10],.025,.3);rounded(root,m.metal,[6.2,1.32,9.93],[.04,.04,.2]);
 // Tall windows sit on existing walls, with glass, mullions and curtains.
 for(const z of [1.5,7.5]){
  rounded(root,m.graphite,[-.493,1.68,z],[.035,1.36,2.1]);rounded(root,m.glass,[-.466,1.68,z],[.016,1.22,1.97]);
  rounded(root,m.trim,[-.43,1.68,z],[.08,1.35,.035]);rounded(root,m.trim,[-.43,1.68,z],[.08,.035,2.07]);
  rounded(root,m.stone,[-.38,.99,z],[.35,.07,2.26]);
  for(const side of [-1,1])for(let j=0;j<4;j++)cylinder(root,m.fabric,[-.3,1.62,z+side*(1.09+j*.045)],.038,1.6);
 }
 // Localized warm architectural lights.
 for(const z of [3.7,8.9]){rounded(root,m.brass,[-.45,1.75,z],[.14,.37,.13]);const lamp=new T.PointLight('#ffca8e',2,3,2);lamp.position.set(-.15,1.9,z);root.add(lamp);}
 const lamp=cylinder(root,m.brass,[3.5,1.02,9.5],.018,.5);cylinder(root,m.fabric,[3.5,1.27,9.5],.18,.25,.12);
 function plant(x:number,z:number,size=1){const g=new T.Group();g.position.set(x,0,z);g.scale.setScalar(size);root.add(g);cylinder(g,m.stone,[0,.21,0],.19,.42,.23);for(let i=0;i<9;i++){const a=i*2.4;const stem=cylinder(g,m.leaf,[Math.sin(a)*.1,.52,Math.cos(a)*.1],.013,.62);stem.rotation.z=Math.sin(a)*.3;const leaf=new T.Mesh(new T.SphereGeometry(.16,12,8),m.leaf);leaf.scale.set(.7,2.5,.25);leaf.position.set(Math.sin(a)*.2,.72+(i%3)*.13,Math.cos(a)*.2);leaf.rotation.set(.4*Math.cos(a),a,.5*Math.sin(a));g.add(leaf);}}
 plant(9.9,.1,1.35);plant(.1,6);plant(6,6,.8);
 // Books, framed artwork, folded linens and tableware are visual dressing.
 [0,1,2].forEach(i=>{rounded(root,i===1?m.terracotta:m.sage,[8.15,.52+i*.055,2.6],[.42,.045,.29],.01).rotation.y=.2*i;});
 cylinder(root,m.trim,[7.65,.59,2.5],.075,.23,.09);
 for(let i=0;i<3;i++)rounded(root,m.fabric,[6.7,1.035+i*.06,9.7],[.47,.05,.35],.015);
 for(const x of [1.2,2.1,3]){rounded(root,m.walnut,[x,1.7,10.485],[.7,.9,.05]);rounded(root,x===2.1?m.terracotta:m.sage,[x,1.7,10.45],[.61,.8,.01]);const art=new T.Mesh(new T.CircleGeometry(.2,32),m.fabric);art.position.set(x,1.72,10.437);art.rotation.y=Math.PI;root.add(art);}
 // Minimal kitchen pendant.
 cylinder(root,m.brass,[2.5,2.65,2.5],.012,.65);cylinder(root,m.graphite,[2.5,2.27,2.5],.26,.13,.14);cylinder(root,m.amber,[2.5,2.2,2.5],.22,.012);
 return root;
}
