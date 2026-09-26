'use client';
import {useEffect,useRef,useState} from 'react';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {PHYSICAL_SCALE} from './simulation/scale';
import type {DroneSimulation} from './simulation/drone';
import {terrainHeight} from './simulation/terrain';
import {createSpreadPose,personCollapseProgress} from './visualization/person-pose';
export function World({engine,mode='orbit',droneIndex=0}:{engine:DroneSimulation;mode?:'orbit'|'top'|'drone'|'person'|'follow';droneIndex?:number}){
 const host=useRef<HTMLDivElement>(null),[status,setStatus]=useState('Loading field models…');
 useEffect(()=>{
  if(!host.current)return;const el=host.current,size=engine.map.size,groundAt=(x:number,z:number)=>terrainHeight(x,z,engine.map);let disposed=false,raf=0;
  const scene=new T.Scene();scene.background=new T.Color('#cad9cf');scene.fog=new T.Fog('#cad9cf',size*1.6,size*3.5);
  let renderer:T.WebGLRenderer;
  try{renderer=new T.WebGLRenderer({antialias:true});}catch{setStatus('WebGL unavailable. Simulation telemetry is still available.');return;}
  const audioContext=typeof window!=='undefined'?new AudioContext():null;
  let lastExplosionId=0,lastFootstep=0,buzzGain:GainNode|null=null,buzzOscillators:OscillatorNode[]=[];
  const tone=(frequency:number,duration:number,volume:number,type:OscillatorType='sine')=>{
   if(!audioContext||audioContext.state!=='running')return;
   const oscillator=audioContext.createOscillator(),gain=audioContext.createGain();oscillator.type=type;oscillator.frequency.value=frequency;gain.gain.setValueAtTime(volume,audioContext.currentTime);gain.gain.exponentialRampToValueAtTime(.001,audioContext.currentTime+duration);oscillator.connect(gain).connect(audioContext.destination);oscillator.start();oscillator.stop(audioContext.currentTime+duration);
  };
  const explosionSound=()=>{
   if(!audioContext||audioContext.state!=='running')return;
   const length=Math.floor(audioContext.sampleRate*.7),buffer=audioContext.createBuffer(1,length,audioContext.sampleRate),data=buffer.getChannelData(0);
   for(let i=0;i<length;i++){const t=i/length;data[i]=(Math.random()*2-1)*(1-t)**2.5;}
   const source=audioContext.createBufferSource(),filter=audioContext.createBiquadFilter(),gain=audioContext.createGain();
   source.buffer=buffer;filter.type='lowpass';filter.frequency.setValueAtTime(420,audioContext.currentTime);filter.frequency.exponentialRampToValueAtTime(90,audioContext.currentTime+.65);gain.gain.setValueAtTime(.0001,audioContext.currentTime);gain.gain.exponentialRampToValueAtTime(.32,audioContext.currentTime+.012);gain.gain.exponentialRampToValueAtTime(.0001,audioContext.currentTime+.7);source.connect(filter).connect(gain).connect(audioContext.destination);source.start();
   tone(48,.7,.28,'sine');tone(110,.25,.12,'triangle');
  };
  const footstepSound=()=>{
   if(!audioContext||audioContext.state!=='running')return;
   const length=Math.floor(audioContext.sampleRate*.12),buffer=audioContext.createBuffer(1,length,audioContext.sampleRate),data=buffer.getChannelData(0);
   for(let i=0;i<length;i++)data[i]=(Math.random()*2-1)*Math.pow(1-i/length,2.2);
   const source=audioContext.createBufferSource(),filter=audioContext.createBiquadFilter(),gain=audioContext.createGain();
   source.buffer=buffer;filter.type='lowpass';filter.frequency.value=900;gain.gain.setValueAtTime(.0001,audioContext.currentTime);gain.gain.exponentialRampToValueAtTime(.07,audioContext.currentTime+.008);gain.gain.exponentialRampToValueAtTime(.0001,audioContext.currentTime+.12);source.connect(filter).connect(gain).connect(audioContext.destination);source.start();
   tone(72,.09,.025,'sine');
  };
  const unlockAudio=()=>{if(audioContext?.state==='suspended')void audioContext.resume();};
  window.addEventListener('pointerdown',unlockAudio,{once:false});
  renderer.setPixelRatio(Math.min(devicePixelRatio,mode==='orbit'?1.5:1.25));renderer.shadowMap.enabled=mode==='orbit';renderer.shadowMap.type=T.PCFSoftShadowMap;renderer.outputColorSpace=T.SRGBColorSpace;el.appendChild(renderer.domElement);
  const camera=new T.PerspectiveCamera(48,1,.05,size*5);camera.position.set(size*1.3,size*1.05,size*1.4);
  const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(size/2,0,size/2);controls.enableDamping=true;controls.maxPolarAngle=Math.PI*.48;controls.minDistance=3;controls.maxDistance=size*2.5;controls.enabled=mode==='orbit';
  scene.add(new T.HemisphereLight(0xeef7ff,0x62774b,2.5));const sun=new T.DirectionalLight(0xfff2d7,3);sun.position.set(size/3,size*1.5,size/3);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-size,right:size,top:size,bottom:-size,far:size*4});scene.add(sun);sun.target.position.set(size/2,0,size/2);scene.add(sun.target);
  const material=(color:string)=>new T.MeshStandardMaterial({color,roughness:.95});
  for(const [x,z,w,h] of [[size/2,-45,size+180,90],[size/2,size+45,size+180,90],[-45,size/2,90,size],[size+45,size/2,90,size]]){
   const ground=new T.Mesh(new T.PlaneGeometry(w,h),material('#839a6a'));ground.rotation.x=-Math.PI/2;ground.position.set(x,-.03,z);ground.receiveShadow=true;scene.add(ground);
  }
  const terrainGeometry=new T.PlaneGeometry(size,size,Math.min(300,size*4),Math.min(300,size*4));terrainGeometry.rotateX(-Math.PI/2);
  const positions=terrainGeometry.attributes.position,colors=new Float32Array(positions.count*3);
  const grassColor=new T.Color('#9bab7a'),earthColor=new T.Color('#705c42');
  for(let i=0;i<positions.count;i++){const x=positions.getX(i)+size/2,z=positions.getZ(i)+size/2,y=groundAt(x,z);positions.setY(i,y);const c=grassColor.clone().lerp(earthColor,Math.min(1,-y*3));c.toArray(colors,i*3);}
  terrainGeometry.setAttribute('color',new T.BufferAttribute(colors,3));terrainGeometry.computeVertexNormals();
  const field=new T.Mesh(terrainGeometry,new T.MeshStandardMaterial({vertexColors:true,roughness:1}));field.position.set(size/2,0,size/2);field.receiveShadow=true;scene.add(field);
  // Terrain-following survey lines keep the trench cuts visible from above.
  const gridPoints:T.Vector3[]=[];
  for(let lane=0;lane<=size;lane+=5)for(let n=0;n<size*4;n++){const a=n*.25,b=a+.25;gridPoints.push(new T.Vector3(lane,groundAt(lane,a)+.025,a),new T.Vector3(lane,groundAt(lane,b)+.025,b),new T.Vector3(a,groundAt(a,lane)+.025,lane),new T.Vector3(b,groundAt(b,lane)+.025,lane));}
  const grid=new T.LineSegments(new T.BufferGeometry().setFromPoints(gridPoints),new T.LineBasicMaterial({color:'#c1cda2',transparent:true,opacity:.2}));scene.add(grid);
  // Small timber retaining posts make depth and trench edges legible.
  for(const t of engine.map.trenches){const alongX=t.width>t.length,length=alongX?t.width:t.length;for(let offset=-length/2+2;offset<length/2;offset+=3)for(const side of [-1,1]){const x=t.x+(alongX?offset:side*(t.width/2-.7)),z=t.z+(alongX?side*(t.length/2-.7):offset);const post=new T.Mesh(new T.BoxGeometry(.13,t.depth,.13),material('#78674d'));post.position.set(x,-t.depth/2+.08,z);post.castShadow=true;scene.add(post);}}
  const ring=(radius:number,color:string)=>{const m=new T.Mesh(new T.RingGeometry(radius-.07,radius,96),new T.MeshBasicMaterial({color,side:T.DoubleSide,transparent:true,opacity:.65}));m.rotation.x=-Math.PI/2;m.position.y=.06;scene.add(m);return m;};
  const launch=ring(2,'#f3efc3');launch.position.set(5,.06,5);
  const sensor=ring(1,'#d7f5ae'),targetRing=ring(1.3,'#ffe0a0'),aimRing=ring(.6,'#f6fbea');
  const landingEffects=engine.fleet.map(()=>{
  const blast=new T.Group();scene.add(blast);blast.visible=false;
  const flash=new T.Mesh(new T.SphereGeometry(1,20,12),new T.MeshBasicMaterial({color:'#fff3bb',transparent:true,opacity:0,depthWrite:false}));blast.add(flash);
  const shockwave=ring(1,'#ffb347');shockwave.visible=false;
  const sparks=Array.from({length:28},(_,i)=>{const particle=new T.Mesh(new T.SphereGeometry(.12,6,5),new T.MeshBasicMaterial({color:i%3?'#ffaf46':'#fff4ce',transparent:true,depthWrite:false}));blast.add(particle);const a=i*2.39996;return {particle,v:new T.Vector3(Math.sin(a)*(2+i%4),2+i%5,Math.cos(a)*(2+i%4))};});
  const smoke=Array.from({length:9},(_,i)=>{const particle=new T.Mesh(new T.SphereGeometry(.6,12,8),new T.MeshBasicMaterial({color:'#778178',transparent:true,depthWrite:false}));blast.add(particle);return {particle,angle:i*2.39996};});
  return {blast,flash,shockwave,sparks,smoke};
  });
  // Trees within the playable field share their locations with the simulation.
  const cuts=Array.from({length:256},()=>new T.Vector4(0,0,0,1e6));
  const foliageMaterials:T.Material[]=[];
  function cutFoliage(mesh:T.Mesh){
   const material=mesh.material as T.MeshStandardMaterial;
   const install=(m:T.Material)=>{m.onBeforeCompile=shader=>{
    shader.uniforms.landingCuts={value:cuts};
    shader.vertexShader='varying vec3 foliageWorld;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nfoliageWorld=(modelMatrix*vec4(position,1.0)).xyz;');
    shader.fragmentShader='varying vec3 foliageWorld; uniform vec4 landingCuts[256];\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('void main() {','void main() { for(int i=0;i<256;i++){vec4 c=landingCuts[i];if(c.z>0.0 && distance(foliageWorld.xz,c.xy)<c.z && foliageWorld.y>=c.w)discard;}');
   };foliageMaterials.push(m);};
   install(material);mesh.customDepthMaterial=new T.MeshDepthMaterial({depthPacking:T.RGBADepthPacking});install(mesh.customDepthMaterial);
  }
  const coverGroups:{cover:(typeof engine.map.hideouts)[number];group:T.Group}[]=[];
  const crownGroups:{tree:(typeof engine.map.trees)[number];group:T.Group}[]=[];
  for(const t of engine.map.trees){const base=groundAt(t.x,t.z);const trunk=new T.Mesh(new T.CylinderGeometry(.22,.35,t.height*.65,8),material('#746146'));trunk.position.set(t.x,base+t.height*.325,t.z);trunk.castShadow=true;scene.add(trunk);const crowns=new T.Group();scene.add(crowns);crownGroups.push({tree:t,group:crowns});for(let layer=0;layer<3;layer++){const crown=new T.Mesh(new T.ConeGeometry(t.radius*(1-layer*.18),t.height*.55,9),material(layer%2?'#567349':'#668353'));crown.position.set(t.x,base+t.height*(.46+layer*.14),t.z);crown.castShadow=true;cutFoliage(crown);crowns.add(crown);}}
  for(const h of engine.map.hideouts){const cover=new T.Group();scene.add(cover);coverGroups.push({cover:h,group:cover});const patch=new T.Mesh(new T.CylinderGeometry(h.radius,h.radius,.08,24),material('#657c4e'));patch.position.set(h.x,groundAt(h.x,h.z)+.04,h.z);cover.add(patch);for(let i=0;i<8;i++){const a=i*Math.PI/4;const bush=new T.Mesh(new T.SphereGeometry(h.radius*.55,10,8),new T.MeshStandardMaterial({color:i%2?'#708650':'#839660',roughness:1,transparent:true,opacity:.65}));bush.scale.y=1.2;bush.position.set(h.x+Math.sin(a)*h.radius*.6,groundAt(h.x,h.z)+h.height*.5,h.z+Math.cos(a)*h.radius*.6);bush.castShadow=true;cutFoliage(bush);cover.add(bush);}}
  // Additional trees form a distant perimeter.
  for(let i=0;i<48;i++){const a=i*2.39996,r=size*.8+(i%5)*5,x=size/2+Math.sin(a)*r,z=size/2+Math.cos(a)*r;const trunk=new T.Mesh(new T.CylinderGeometry(.25,.4,3,6),material('#7c7156'));trunk.position.set(x,1.5,z);scene.add(trunk);const crown=new T.Mesh(new T.ConeGeometry(2+i%3*.4,6+i%3,7),material(i%2?'#586f4e':'#6a8055'));crown.position.set(x,5,z);crown.castShadow=true;cutFoliage(crown);scene.add(crown);}
  const droneGroups=engine.fleet.map(()=>new T.Group()),drone=droneGroups[0],person=new T.Group();scene.add(...droneGroups,person);
  const personPose=new T.Group();person.add(personPose);
  let spreadPose:ReturnType<typeof createSpreadPose>|null=null,proneHeight=.25;
  const loader=new GLTFLoader();const bones:{bone:T.Object3D;base:T.Euler;side:number;arm:boolean}[]=[];
  const disposeObject=(root:T.Object3D)=>root.traverse(o=>{if(o instanceof T.Mesh||o instanceof T.Line){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material]){for(const value of Object.values(m))if(value instanceof T.Texture)value.dispose();m.dispose();}}});
  let loaded=0;
  function load(path:string,parent:T.Group,size:number,isPerson=false){loader.load(path,gltf=>{
   if(disposed){disposeObject(gltf.scene);return;}
   const model=gltf.scene;const box=new T.Box3().setFromObject(model),extent=box.getSize(new T.Vector3());const scale=size/(isPerson?extent.y:Math.max(extent.x,extent.z));model.scale.multiplyScalar(scale);
   const bounds=new T.Box3().setFromObject(model),center=bounds.getCenter(new T.Vector3());model.position.sub(new T.Vector3(center.x,bounds.min.y,center.z));
   model.traverse(o=>{if(o instanceof T.Mesh){o.castShadow=true;o.receiveShadow=true;}if(isPerson&&o instanceof T.Bone&&/upleg|upperleg|upperarm|thigh/i.test(o.name)&&!/twist/i.test(o.name))bones.push({bone:o,base:o.rotation.clone(),side:/left|\.l|_l/i.test(o.name)?1:-1,arm:/arm/i.test(o.name)});});parent.add(model);
   if(isPerson){
    // Put the fall pivot at the torso, then settle the spread pose on the ground.
    model.position.y-=engine.personHeight*.5;
    model.traverse(o=>{if(o instanceof T.Mesh)o.frustumCulled=false;});
    spreadPose=createSpreadPose(model);spreadPose.apply(1);personPose.position.set(0,0,0);personPose.rotation.x=Math.PI/2;person.updateMatrixWorld(true);
    model.traverse(o=>{if(o instanceof T.SkinnedMesh)o.skeleton.update();});
    proneHeight=person.position.y+.03-new T.Box3().setFromObject(personPose,true).min.y;
    personPose.rotation.x=0;personPose.position.y=engine.personHeight*.5;spreadPose.apply(0);
   }else droneGroups.slice(1).forEach(group=>group.add(model.clone(true)));
   if(++loaded===2)setStatus('');
  },undefined,()=>{if(!disposed)setStatus(`Could not load ${path}. Reload to retry.`);});}
  for(const group of droneGroups)for(const x of [-.095,.095])for(const z of [-.095,.095]){
   const guard=new T.Mesh(new T.TorusGeometry(.09,.009,6,24),new T.MeshStandardMaterial({color:'#f3bd58',metalness:.5,roughness:.4}));
   guard.rotation.x=Math.PI/2;guard.position.set(x,.045,z);guard.visible=false;group.add(guard);
  }
  load('/models/runtime/drone.glb' ,drone,PHYSICAL_SCALE.droneSpan);load('/models/runtime/person.glb',personPose,engine.personHeight,true);
  const trailGeometry=new T.BufferGeometry(),trail=new T.Line(trailGeometry,new T.LineBasicMaterial({color:'#f0f7c7',transparent:true,opacity:.7}));scene.add(trail);
  const resize=()=>{const w=el.clientWidth,h=el.clientHeight;renderer.setSize(w,h);camera.aspect=w/Math.max(1,h);camera.updateProjectionMatrix();};const observer=new ResizeObserver(resize);observer.observe(el);
  let previousFrame=performance.now(),firstFrame=true,lastTrailLength=-1,lastTrailTime=-1;
  const smoothedLook=new T.Vector3(),renderPosition=new T.Vector3(),desiredQuaternion=new T.Quaternion(),desiredEuler=new T.Euler(0,0,0,'YXZ');
  const render=()=>{
   const now=performance.now(),dt=Math.min(.1,(now-previousFrame)/1000);previousFrame=now;const alpha=1-Math.exp(-14*dt);
   const flying=engine.fleet.some(agent=>agent.phase!=='Landed'&&agent.flight.thrust>.15);
   if(audioContext&&audioContext.state==='running'){
    if(flying){if(!buzzGain){
     buzzGain=audioContext.createGain();buzzGain.gain.value=.0001;buzzGain.connect(audioContext.destination);
     for(const [frequency,volume] of [[185,.012],[370,.007],[555,.003]]){const oscillator=audioContext.createOscillator();oscillator.type='sawtooth';oscillator.frequency.value=frequency;const motorGain=audioContext.createGain();motorGain.gain.value=volume;oscillator.connect(motorGain).connect(buzzGain);oscillator.start();buzzOscillators.push(oscillator);}
     const modulator=audioContext.createOscillator(),modulationGain=audioContext.createGain();modulator.frequency.value=18;modulationGain.gain.value=28;modulator.connect(modulationGain);for(const oscillator of buzzOscillators)modulationGain.connect(oscillator.frequency);modulator.start();buzzOscillators.push(modulator);
    }buzzGain.gain.setTargetAtTime(Math.min(.8,.18*engine.fleet.filter(agent=>agent.phase!=='Landed').length),audioContext.currentTime,.08);}
    else if(buzzGain){buzzGain.gain.setTargetAtTime(.0001,audioContext.currentTime,.08);}
    const latest=engine.missionExplosion;if(latest&&latest.id!==lastExplosionId){lastExplosionId=latest.id;explosionSound();}
    if(engine.person.speed>0&&now-lastFootstep>Math.max(180,550/Math.max(1,engine.person.speed))){lastFootstep=now;footstepSound();}
   }

   coverGroups.forEach(({cover,group})=>{group.visible=!cover.cleared;});
   crownGroups.forEach(({tree,group})=>{group.visible=!tree.crownCleared;});
   cuts.forEach((v,i)=>{const c=engine.map.clearings?.[i];if(c)v.set(c.x,c.z,c.radius,c.bottom);else v.set(0,0,0,1e6);});
   const selected=engine.fleet[droneIndex]??engine,d=selected.drone,p=engine.person;engine.fleet.forEach((agent,i)=>{const group=droneGroups[i];if(!group)return;renderPosition.set(agent.drone.x,agent.drone.y,agent.drone.z);if(firstFrame||agent.phase==='Landed')group.position.copy(renderPosition);else group.position.lerp(renderPosition,alpha);desiredQuaternion.setFromEuler(desiredEuler.set(agent.flight.pitch,agent.flight.yaw,agent.flight.roll,'YXZ'));group.quaternion.slerp(desiredQuaternion,alpha);group.visible=agent.phase!=='Landed'&&(mode!=='drone'||i!==droneIndex);});renderPosition.set(p.x,p.y,p.z);if(firstFrame||engine.missionContact)person.position.copy(renderPosition);else person.position.lerp(renderPosition,alpha);person.rotation.y=p.heading;
   spreadPose?.apply(0);
   bones.forEach(({bone,base,side,arm})=>{bone.rotation.copy(base);bone.rotation.x+=Math.sin(engine.time*(p.speed>2?12:6))*Math.min(.65,p.speed*.2)*side*(arm?-1:1);});
   const touchdown=engine.missionContact,personDown=!!touchdown;
   const proneAmount=personCollapseProgress(touchdown?.wallTime??null,Date.now()/1000);
   if(personDown)spreadPose?.apply(proneAmount);
   personPose.rotation.x=Math.PI/2*proneAmount;
   personPose.position.set(0,T.MathUtils.lerp(engine.personHeight*.5,proneHeight,proneAmount),0);
   sensor.position.set(d.x,.08,d.z);sensor.scale.setScalar(Math.sqrt(Math.max(0,engine.sensorRange**2-d.y**2)));sensor.visible=engine.sensorEnabled&&engine.phase!=='Landed';
   targetRing.position.set(p.x,p.y+.09,p.z);targetRing.visible=selected.visible;aimRing.position.set(selected.aim.x,groundAt(selected.aim.x,selected.aim.z)+.1,selected.aim.z);aimRing.visible=engine.phase!=='Landed';
   landingEffects.forEach(({blast,flash,shockwave,sparks,smoke},index)=>{
   const effect=engine.fleet[index]?.explosion,age=effect?Date.now()/1000-effect.wallTime:Infinity;
   blast.visible=!!effect&&age>=0&&age<2.8;shockwave.visible=blast.visible;
   if(effect&&blast.visible){
    const intensity=engine.fleet[index]?.contact ? .35 : 1;
    blast.position.set(effect.x,effect.y,effect.z);
    flash.scale.setScalar(.3+Math.min(age,.5)*5*intensity);(flash.material as T.MeshBasicMaterial).opacity=Math.max(0,1-age*3)*intensity;
    shockwave.position.set(effect.x,effect.y+.14,effect.z);shockwave.scale.setScalar(1+age*5);(shockwave.material as T.MeshBasicMaterial).opacity=Math.max(0,.8-age*.6);
    sparks.forEach(({particle,v})=>{particle.position.copy(v).multiplyScalar(age);particle.position.y-=2.5*age*age;particle.scale.setScalar(Math.max(.05,1-age*.5));(particle.material as T.MeshBasicMaterial).opacity=Math.max(0,1-age*.7);});
    smoke.forEach(({particle,angle},i)=>{particle.position.set(Math.sin(angle)*age*.8,age*(1.3+i*.1),Math.cos(angle)*age*.8);particle.scale.setScalar(.3+age*.9);(particle.material as T.MeshBasicMaterial).opacity=Math.min(.45,age*.9)*Math.max(0,1-age/2.8)*intensity;});
   }
   });
   if(lastTrailLength!==selected.trail.length||lastTrailTime!==selected.history.at(-1)?.time){trailGeometry.setFromPoints(selected.trail.map(pt=>new T.Vector3(pt.x,groundAt(pt.x,pt.z)+.12,pt.z)));lastTrailLength=selected.trail.length;lastTrailTime=selected.history.at(-1)?.time??0;}
   if(mode==='top'){camera.position.set(size/2,size*1.4,size/2+.01);camera.lookAt(size/2,0,size/2);}else if(mode==='follow'){const focus=droneGroups[droneIndex]?.position??droneGroups[0].position;const desired=focus.clone().add(new T.Vector3(2.5,1.7,3.5));if(firstFrame){camera.position.copy(desired);smoothedLook.copy(focus);}else{camera.position.lerp(desired,1-Math.exp(-5*dt));smoothedLook.lerp(focus,1-Math.exp(-9*dt));}camera.lookAt(smoothedLook);}else if(mode==='person'){camera.position.set(p.x+7,p.y+6,p.z+9);camera.lookAt(p.x,p.y+1,p.z);}else if(mode==='drone'){const focus=droneGroups[droneIndex]?.position??droneGroups[0].position;camera.position.copy(focus).add(new T.Vector3(0,.08,0));const look=new T.Vector3(focus.x+Math.sin(d.heading)*12,focus.y-5,focus.z+Math.cos(d.heading)*12);if(firstFrame)smoothedLook.copy(look);else smoothedLook.lerp(look,1-Math.exp(-8*dt));camera.lookAt(smoothedLook);}else controls.update();
   firstFrame=false;renderer.render(scene,camera);raf=requestAnimationFrame(render);
  };resize();render();return()=>{disposed=true;cancelAnimationFrame(raf);observer.disconnect();controls.dispose();disposeObject(scene);trailGeometry.dispose();(trail.material as T.Material).dispose();foliageMaterials.forEach(m=>m.dispose());renderer.dispose();if(audioContext)void audioContext.close();window.removeEventListener('pointerdown',unlockAudio);el.replaceChildren();};
 },[engine,mode,engine.map,engine.agents,droneIndex]);
 return <><div className="world" ref={host}/>{status&&<div className="model-status" role="status">{status}</div>}</>;
}
