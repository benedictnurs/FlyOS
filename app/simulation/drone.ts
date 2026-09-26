import {SwarmBrain} from './swarm-brain';
import {PersonBrain} from './person-brain';
import {MODEL_VERSION,PHYSICAL_SCALE} from './scale';
import {FlightDynamics} from './flight';
import {clearLandingPath,clearTouchdownFoliage,terrainHeight,blockedByTrunk,generateMap,sightBlocked,type WorldMap} from './terrain';
import {personContact,PERSON_HEIGHT,type Position3} from './contact';
export type DroneTask = 'find' | 'find-land';
export type Motion = 'Stationary' | 'Walking' | 'Running' | 'Stop & go' | 'Run & hide';
export type Phase = 'Searching' | 'Acquiring' | 'Tracking' | 'Reacquiring' | 'Camping' | 'Returning' | 'Landing' | 'Landed' | 'Investigating';
export type Point = {x:number;z:number};
export const FIELD = 60;
export const FAILED_LANDING_PENALTY = -250;

export class DroneSimulation {
 map:WorldMap;
 sharedBrain=new SwarmBrain();droneId=0;
 private lastLearningTime=0;private lastLearningReward=0;private learningFeatures=[1,0,0,0,0,1];
 private features(point:Point=this.aim){return [this.sharedBrain.coverage.has(`${Math.floor(point.x/5)},${Math.floor(point.z/5)}`)?0:1,Math.min(1,Math.hypot(point.x-this.drone.x,point.z-this.drone.z)/this.map.size),this.confidence,this.visible?1:0,this.pain,1];}

 agents:DroneSimulation[]=[]; personBrain=new PersonBrain();
 get fleet():DroneSimulation[]{return [this,...this.agents];}
 get missionSuccess(){return this.fleet.some(a=>a.success);}
 get missionFailed(){return this.fleet.some(a=>a.failed)&&!this.missionSuccess;}
 get activeHideouts(){return this.map.hideouts.filter(h=>!h.cleared);}
 get missionContact(){return this.fleet.find(a=>a.contact)?.contact??null;}
 get missionExplosion(){return this.fleet.find(a=>a.explosion)?.explosion??null;}
 get totalReward(){return this.fleet.reduce((sum,a)=>sum+a.reward,0);}
 setDroneCount(count:number){if(!Number.isFinite(count))return;const desired=Math.max(1,Math.min(8,Math.round(count)));this.configureFleet(desired);this.reset();}
 private configureFleet(count:number){this.agents=Array.from({length:count-1},(_,i)=>{const child=new DroneSimulation(this.map);child.task=this.task;child.droneId=i+1;child.sharedBrain=this.sharedBrain;child.person=this.person;child.drone.x=5+(i+1)*.8;child.home={x:child.drone.x,z:5};child.waypoint=Math.floor((i+1)*child.waypoints.length/count);child.aim=child.waypoints[child.waypoint];return child;});}

 routeIndex=0; hideUntil=0; pain=0; lostContacts=0;
 private lossArmed=false;private unseenSeconds=0;
 get coverageCells(){return (this.map.size/5)**2;}
 get hidingPlace(){return this.activeHideouts.find(h=>Math.hypot(this.person.x-h.x,this.person.z-h.z)<h.radius);}
 ground(x:number,z:number){return terrainHeight(x,z,this.map);}
 private clamp(v:number){return Math.max(2,Math.min(this.map.size-2,v));}
 generate(expand=false){this.map=generateMap(expand?this.map.size+30:this.map.size,expand?this.map.seed:this.map.seed+1);this.reset();this.log(expand?'Map expanded · new search sectors':'New map generated');}
 samples:{time:number;drone:Position3;person:Position3;visible:boolean;phase:Phase;reward:number;thrust:number;roll:number;pitch:number}[]=[];
 exportRun(){return {schema:2,model:MODEL_VERSION,units:{distance:'m',mass:'kg',time:'s',force:'N'},scale:PHYSICAL_SCALE,map:this.map,task:this.task,motion:this.motion,success:this.missionSuccess,failed:this.missionFailed,landingDroneId:this.sharedBrain.landingDroneId,contact:this.missionContact,sharedBrain:this.sharedBrain.export(),reward:this.reward,lostContacts:this.lostContacts,personBrain:{enabled:this.personBrain.enabled,awareness:this.personBrain.awareness,maxHideSeconds:this.personBrain.maxHideSeconds,timePenalty:this.personBrain.timePenalty,score:this.personBrain.score,exposure:this.personBrain.exposure},drones:this.fleet.map((a,i)=>({id:i+1,success:a.success,failed:a.failed,contact:a.contact,samples:a.samples})),samples:this.samples};}
 flight=new FlightDynamics();
 private accumulator=0;
 drone={x:5,z:5,y:0,heading:0,speed:0};
 person={x:43,y:terrainHeight(43,37),z:37,vx:0,vy:0,vz:0,speed:0,heading:0};
 motion:Motion='Stationary'; phase:Phase='Searching'; time=0; confidence=0; visible=false;
 sensorRange=15; sensorEnabled=true; prediction=true; altitude=7; lockSeconds=0; detections=0;
 lastSeen:({time:number;y:number;vy:number;vx:number;vz:number}&Point)|null=null;
 aim:Point={x:5,z:5}; trail:Point[]=[]; coverage=new Set<string>();
 events:{time:number;text:string}[]=[]; history:{time:number;confidence:number;speed:number}[]=[];
 reward=0; rewardRate=0; rewardEvents:{time:number;amount:number;reason:string}[]=[];
 foundRewarded=false; confirmedRewarded=false; landingRewarded=false; trackingReward=0;
 task:DroneTask='find'; success=false; completedAt:number|null=null;
 personHeight=PERSON_HEIGHT;
 contact:({time:number;separation:number;point:Position3})|null=null;
 contactSeparation:number|null=null;
 get landRequested(){return this.task==='find-land';}
 private get canLand(){return this.sharedBrain.landingDroneId===null||this.sharedBrain.landingDroneId===this.droneId;}
 private claimLanding(){if(this.sharedBrain.landingDroneId===null){this.sharedBrain.landingDroneId=this.droneId;this.log(`Drone ${this.droneId+1} assigned as sole landing aircraft`);}}
 setTask(task:DroneTask){this.task=task;this.reset();this.log(`Task selected · ${task==='find'?'Find':'Find / Land'}`);}

 failed=false;
 investigation:({started:number}&Point)|null=null;
 landingSite:Point|null=null;
 explosion:({time:number;id:number;y:number;wallTime:number}&Point)|null=null;
 private explosionId=0;
 waypoint=0; home={x:5,z:5}; returnRequested=false;
 waypoints:Point[]=[];
 constructor(map:WorldMap=generateMap()){
  this.map=map;const lanes=map.size/10;
  this.waypoints=Array.from({length:lanes*lanes},(_,i)=>({x:5+(Math.floor(i/lanes)%2?lanes-1-i%lanes:i%lanes)*10,z:5+Math.floor(i/lanes)*10}));
  this.person.x=map.size*.72;this.person.z=map.size*.62;for(let i=0;i<20&&map.trees.some(t=>Math.hypot(t.x-this.person.x,t.z-this.person.z)<t.radius+1);i++)this.person.z=this.clamp(this.person.z+3);
  this.person.y=this.ground(this.person.x,this.person.z);
  this.log('Mission ready · systematic field sweep');
 }
 get coveragePercent(){return Math.round(this.coverage.size/this.coverageCells*100);}
 get reason(){return this.failed?'Search failed · landed without finding a person':this.phase==='Investigating'?'Suspected foliage · descend, clear a path, and inspect':this.phase==='Returning'?'Return to launch requested':this.phase==='Landing'?'Match the observed person’s motion and descend onto the model':this.phase==='Landed'?'Touchdown complete · Search starts a new flight':this.phase==='Searching'?'Sweep parallel lanes until a person enters sensor range':this.phase==='Camping'?'Watch the last observed cover exit, then resume searching':this.phase==='Reacquiring'?'Search around the last observed position; memory expires after 12 s':this.phase==='Acquiring'?'Accumulate consistent observations to confirm the target':this.lastSeen&&Math.hypot(this.lastSeen.vx,this.lastSeen.vz)>.5?'Estimate velocity and follow a predicted position':'Hold position near the stationary person';}
 award(amount:number,reason:string){this.reward+=amount;this.rewardEvents.unshift({time:this.time,amount,reason});this.rewardEvents=this.rewardEvents.slice(0,20);this.log(`${amount>0?'+':''}${amount.toFixed(0)} reward · ${reason}`);}
 search(){
  this.sharedBrain.landingDroneId=null;
  this.failed=false;this.investigation=null;this.returnRequested=false;this.task='find';this.success=false;this.completedAt=null;this.contact=null;this.contactSeparation=null;this.explosion=null;this.landingSite=null;this.lastSeen=null;this.confidence=0;this.lockSeconds=0;this.visible=false;this.phase='Searching';
  // Prefer unobserved lanes; the person position is never used by search planning.
  this.waypoint=this.nextSearchWaypoint();this.aim=this.waypoints[this.waypoint];this.log('Search commanded · sweep unobserved terrain');
 }
 land(){
  if(this.phase==='Landed'||this.phase==='Returning')return;
  this.task='find-land';this.success=false;this.completedAt=null;this.returnRequested=false;
  this.log('Land on person commanded · find and confirm before descent');
 }
 private nextSearchWaypoint(){
  const reserved=new Set([...this.sharedBrain.reservations.entries()].filter(([id])=>id!==this.droneId).map(([,index])=>index));
  const candidates=this.waypoints.map((point,index)=>({index,features:this.features(point)})).filter(c=>!reserved.has(c.index)&&c.index!==this.waypoint);
  // Coverage and travel cost form a prior; shared learned values refine ordering.
  candidates.sort((a,b)=>(b.features[0]*3-b.features[1]+this.sharedBrain.predict(b.features).value*.25)-(a.features[0]*3-a.features[1]+this.sharedBrain.predict(a.features).value*.25));
  const index=candidates[0]?.index??(this.waypoint+1)%this.waypoints.length;
  this.sharedBrain.reservations.set(this.droneId,index);return index;
 }
 log(text:string){this.events.unshift({time:this.time,text});this.events=this.events.slice(0,30);}
 setMotion(motion:Motion){this.motion=motion;this.log(`Person behavior → ${motion}`);}
 reset(){this.map.clearings=[];for(const h of this.map.hideouts)h.cleared=false;for(const t of this.map.trees)t.crownCleared=false;const sharedBrain=this.sharedBrain,count=this.fleet.length,personEnabled=this.personBrain.enabled,awareness=this.personBrain.awareness,maxHideSeconds=this.personBrain.maxHideSeconds,task=this.task,motion=this.motion,range=this.sensorRange,prediction=this.prediction,altitude=this.altitude,wind=this.flight.wind;Object.assign(this,new DroneSimulation(this.map));this.task=task;this.motion=motion;this.sensorRange=range;this.prediction=prediction;this.altitude=altitude;this.flight.wind=wind;this.sharedBrain=sharedBrain;this.sharedBrain.clearMission();this.personBrain.enabled=personEnabled;this.personBrain.awareness=awareness;this.personBrain.maxHideSeconds=maxHideSeconds;this.configureFleet(count);}
 relocate(){this.sharedBrain.landingDroneId=null;this.failed=false;this.investigation=null;do{this.person.x=5+Math.random()*(this.map.size-10);this.person.z=5+Math.random()*(this.map.size-10);}while(blockedByTrunk(this.person.x,this.person.z,this.map));this.person.y=this.ground(this.person.x,this.person.z);this.lastSeen=null;this.confidence=0;this.success=false;this.completedAt=null;this.contact=null;this.contactSeparation=null;this.explosion=null;if(this.phase==='Landed')this.phase='Searching';for(const child of this.agents){child.failed=false;child.investigation=null;child.lastSeen=null;child.success=false;child.contact=null;child.explosion=null;child.confidence=0;if(child.phase==='Landed')child.phase='Searching';}this.log('Person relocated · sensor must reacquire');}
 tick(dt:number){
  if(!Number.isFinite(dt)||dt<=0)return;this.accumulator+=Math.min(dt,.1);
  while(this.accumulator>=1/120){
   if(this.missionContact)break;
   this.advance(1/120);
   for(const child of this.agents){if(this.missionContact)break;child.task=this.task;child.motion=this.motion;child.sensorRange=this.sensorRange;child.sensorEnabled=this.sensorEnabled;child.altitude=this.altitude;child.prediction=this.prediction;child.flight.wind=this.flight.wind;child.returnRequested=this.returnRequested;child.advance(1/120,false);}
   // Resolve overlapping guard envelopes between fleet members.
   const fleet=this.missionContact?[]:this.fleet;
   for(let i=0;i<fleet.length;i++)for(let j=i+1;j<fleet.length;j++){
    const a=fleet[i],b=fleet[j],dx=b.drone.x-a.drone.x,dy=b.drone.y-a.drone.y,dz=b.drone.z-a.drone.z;
    const distance=Math.hypot(dx,dy,dz),radius=.44;
    if(distance>=radius)continue;
    const nx=distance>1e-6?dx/distance:1,ny=distance>1e-6?dy/distance:0,nz=distance>1e-6?dz/distance:0;
    const movable=[a,b].filter(agent=>agent.phase!=='Landed');
    for(const agent of movable){const sign=agent===a?-1:1,shift=(radius-distance)/movable.length;
     agent.drone.x+=nx*shift*sign;agent.drone.y+=ny*shift*sign;agent.drone.z+=nz*shift*sign;
     const inward=(agent.flight.vx*nx+agent.flight.vy*ny+agent.flight.vz*nz)*sign;
     if(inward<0){agent.flight.vx-=inward*nx*sign;agent.flight.vy-=inward*ny*sign;agent.flight.vz-=inward*nz*sign;}
    }
   }
   this.accumulator-=1/120;
  }
  if(this.missionContact)this.accumulator=0;
 }
 private advance(dt:number,movePerson=true){
  this.time+=dt;
  if(this.phase==='Landed'&&!movePerson){this.rewardRate=0;return;}
  const scoreBefore=this.reward,coveredBefore=this.coverage.size;
  const p=this.person,d=this.drone;
  if(movePerson){
  const oldX=p.x,oldZ=p.z,oldY=p.y;
  const hiding=this.motion==='Run & hide'&&this.time<this.hideUntil;
  p.speed=this.motion==='Stationary'||hiding?0:this.motion==='Walking'?1.3:this.motion==='Stop & go'&&Math.floor(this.time/9)%2===0?0:3.8;
  const adaptive=this.personBrain.enabled&&this.motion==='Run & hide'?this.personBrain.choose(p,this.fleet.map(a=>a.drone),this.map,this.time):null;
  const openRoute=[{x:3,z:3},{x:this.map.size-3,z:3},{x:this.map.size-3,z:this.map.size-3},{x:3,z:this.map.size-3}];
  const coverRoute=this.activeHideouts[this.routeIndex%this.activeHideouts.length];
  const route=this.motion==='Run & hide'?(adaptive??coverRoute??openRoute[this.routeIndex%openRoute.length]):openRoute[this.routeIndex%openRoute.length];
  if(adaptive&&this.personBrain.state==='Hiding')p.speed=0;
  let dx=route.x-p.x,dz=route.z-p.z,dist=Math.hypot(dx,dz);
  if(!adaptive&&dist<.4&&this.time>=this.hideUntil){
   this.routeIndex++;
   if(this.motion==='Run & hide'){this.hideUntil=this.time+5;p.speed=0;}
  }
  if(dist>.01&&p.speed){const step=Math.min(dist,p.speed*dt);p.x+=dx/dist*step;p.z+=dz/dist*step;}
  if(blockedByTrunk(p.x,p.z,this.map)){
   p.x=oldX;p.z=oldZ;const obstacle=this.map.trees.find(t=>Math.hypot(t.x-p.x,t.z-p.z)<1.2);
   if(obstacle){const ox=p.x-obstacle.x,oz=p.z-obstacle.z,n=Math.hypot(ox,oz)||1;const side=ox*dz-oz*dx>0?1:-1;
    p.x=this.clamp(p.x+(ox/n*.7-oz/n*side)*p.speed*dt);p.z=this.clamp(p.z+(oz/n*.7+ox/n*side)*p.speed*dt);}
  }
  p.y=this.ground(p.x,p.z);p.vy=(p.y-oldY)/dt;
  p.vx=(p.x-oldX)/dt;p.vz=(p.z-oldZ)/dt;if(p.speed)p.heading=Math.atan2(p.vx,p.vz);
  }
  if(this.phase==='Landed'){this.rewardRate=0;return;}
  this.visible=this.sensorEnabled&&Math.hypot(p.x-d.x,p.z-d.z,d.y-p.y-1)<this.sensorRange&&!sightBlocked(d,{x:p.x,y:p.y+1.4,z:p.z},this.map);
  this.pain=Math.max(0,this.pain-dt*.18);
  if(this.visible){this.unseenSeconds=0;if(this.lockSeconds>.5)this.lossArmed=true;}
  else{this.unseenSeconds+=dt;if(this.lossArmed&&this.unseenSeconds>.25){this.award(-10,'Pain · person lost');if(this.task==='find')this.success=false;this.pain=1;this.lostContacts++;this.lossArmed=false;}}
  const previous=this.phase;
  if(this.visible){
   const wasLost=!this.lastSeen||this.time-this.lastSeen.time>.3;
   if(wasLost){this.detections++;this.log('Visual contact · person detected');if(!this.foundRewarded){this.award(100,'First person found');this.foundRewarded=true;}}
   const prior=this.lastSeen,elapsed=prior?this.time-prior.time:0;
   const vx=prior&&elapsed<.3?(p.x-prior.x)/elapsed:0,vz=prior&&elapsed<.3?(p.z-prior.z)/elapsed:0;
   this.lastSeen={x:p.x,y:p.y,vy:prior&&elapsed<.3?(p.y-prior.y)/elapsed:0,z:p.z,time:this.time,vx:prior?prior.vx*.6+vx*.4:0,vz:prior?prior.vz*.6+vz*.4:0};
   this.confidence=Math.min(1,this.confidence+dt*.45);this.lockSeconds+=dt;
  }else {this.confidence=Math.max(0,this.confidence-dt*.24);this.lockSeconds=0;}
  if(this.visible&&this.lastSeen)this.sharedBrain.memory={...this.lastSeen};
  if(!this.visible&&this.sharedBrain.memory&&this.time-this.sharedBrain.memory.time<2&&(!this.lastSeen||this.sharedBrain.memory.time>this.lastSeen.time))this.lastSeen={...this.sharedBrain.memory};
  // Suspicion comes from remembered cover, or nearby cover after an unsuccessful sweep.
  // Never read the hidden person's coordinates to choose an investigation.
  if(this.canLand&&!this.investigation&&this.phase!=='Landing'&&!this.visible&&this.sensorEnabled&&!this.returnRequested){
   const memory=this.lastSeen&&this.time-this.lastSeen.time<12?this.lastSeen:null;
   const cover=this.activeHideouts.find(h=>memory?Math.hypot(h.x-memory.x,h.z-memory.z)<h.radius+2:this.time>45&&Math.hypot(h.x-d.x,h.z-d.z)<this.sensorRange);
   if(cover){this.claimLanding();this.investigation={x:cover.x,z:cover.z,started:this.time};this.log('Suspected person in foliage · inspecting cover');}
  }
  if(this.visible&&this.confidence>=.65)this.investigation=null;
  if(this.returnRequested||this.phase==='Returning'){
   this.phase='Returning';this.aim={...this.home};
   if(Math.hypot(d.x-this.home.x,d.z-this.home.z)<.8&&d.y<.08&&Math.abs(this.flight.vy)<.5)this.phase='Landed';
  }else if(this.canLand&&this.investigation&&(!this.visible||this.confidence<.65)){
   this.phase='Investigating';this.aim={x:this.investigation.x,z:this.investigation.z};
  }else if(this.canLand&&this.landRequested&&this.lastSeen&&(this.visible&&this.confidence>=.65||this.phase==='Landing')){
   this.claimLanding();this.phase='Landing';
   if(this.visible||!this.landingSite)this.landingSite={x:this.clamp(this.lastSeen.x),z:this.clamp(this.lastSeen.z)};
   this.aim={...this.landingSite!};
  }else if(this.visible&&this.lastSeen){
   this.phase=this.confidence<.65?'Acquiring':'Tracking';
   const lead=this.prediction?1.4:0;
   this.aim={x:this.clamp(this.lastSeen.x+this.lastSeen.vx*lead-3),z:this.clamp(this.lastSeen.z+this.lastSeen.vz*lead-3)};
  }else if(this.lastSeen&&this.time-this.lastSeen.time<12){
   this.phase='Reacquiring';const age=this.time-this.lastSeen.time;
   const cover=this.activeHideouts.find(h=>Math.hypot(h.x-this.lastSeen!.x,h.z-this.lastSeen!.z)<h.radius+3);
   const trench=this.map.trenches.find(t=>Math.abs(t.x-this.lastSeen!.x)<t.width/2+2&&Math.abs(t.z-this.lastSeen!.z)<t.length/2+2);
   if((cover||trench)&&age<8){
    this.phase='Camping';const coverPoint=cover??trench!;const dx=this.lastSeen.x-coverPoint.x,dz=this.lastSeen.z-coverPoint.z,len=Math.hypot(dx,dz)||1;
    this.aim={x:this.clamp(coverPoint.x+dx/len*5),z:this.clamp(coverPoint.z+dz/len*5)};
   }else this.aim={x:this.clamp(this.lastSeen.x+this.lastSeen.vx*Math.min(age,3)+Math.sin(age*2)*age*.5),z:this.clamp(this.lastSeen.z+this.lastSeen.vz*Math.min(age,3)+Math.cos(age*2)*age*.5)};
  }else{
   this.phase='Searching';this.lastSeen=null;
   if(Math.hypot(d.x-this.waypoints[this.waypoint].x,d.z-this.waypoints[this.waypoint].z)<1)this.waypoint=this.nextSearchWaypoint();
   this.aim=this.waypoints[this.waypoint];
  }
  if(this.confidence>=.65&&!this.confirmedRewarded){this.award(25,'Person confirmed');this.confirmedRewarded=true;}
  if(this.task==='find'&&this.visible&&this.confidence>=.65&&!this.success){this.success=true;this.completedAt=this.time;this.log('Task success · person found and confirmed');}
  if(previous!==this.phase)this.log(`${this.phase} · ${this.reason}`);
  const landing=(this.phase==='Returning'||this.phase==='Landing'||this.phase==='Investigating')&&Math.hypot(d.x-this.aim.x,d.z-this.aim.z)<1.2;
  const personLanding=this.phase==='Landing';
  const touchdownHeight=personLanding&&this.visible&&this.lastSeen?this.lastSeen.y+this.personHeight-.12:this.ground(this.aim.x,this.aim.z);
  const targetVelocity=personLanding&&this.visible&&this.lastSeen?{x:this.lastSeen.vx,z:this.lastSeen.vz}:{x:0,z:0};
  // Cruise clears the nearby tree crowns. Person descent uses terrain-relative height.
  const clearance=this.map.trees.reduce((h,t)=>Math.hypot(t.x-d.x,t.z-d.z)<t.radius+4?Math.max(h,t.height+2):h,this.altitude);
  const before={x:d.x,y:d.y,z:d.z};
  this.flight.step(d,this.aim,landing?touchdownHeight:clearance,this.phase==='Searching'?6:8,this.time,dt,this.phase==='Landed',0,targetVelocity,this.ground(d.x,d.z));
  // Guard envelope resolves hard trunks and world bounds; foliage is soft cover.
  for(const tree of this.map.trees){
   const radius=.35+.22,dx=d.x-tree.x,dz=d.z-tree.z,dist=Math.hypot(dx,dz);
   if(d.y<tree.height+this.ground(tree.x,tree.z)&&dist<radius){
    const nx=dist>.0001?dx/dist:1,nz=dist>.0001?dz/dist:0;
    d.x=tree.x+nx*radius;d.z=tree.z+nz*radius;
    const inward=this.flight.vx*nx+this.flight.vz*nz;
    if(inward<0){this.flight.vx-=inward*nx;this.flight.vz-=inward*nz;}
   }
  }
  d.x=Math.max(.22,Math.min(this.map.size-.22,d.x));d.z=Math.max(.22,Math.min(this.map.size-.22,d.z));
  if(d.x===.22||d.x===this.map.size-.22)this.flight.vx=0;
  if(d.z===.22||d.z===this.map.size-.22)this.flight.vz=0;
  d.y=Math.max(d.y,this.ground(d.x,d.z));
  if(landing&&d.y<=before.y&&this.phase!=='Returning')clearLandingPath(d.x,d.y,d.z,this.map);
  this.contactSeparation=null;
  if(personLanding){
   const hit=personContact(d,p);this.contactSeparation=hit.separation;
   const relativeSpeed=Math.hypot(this.flight.vx-p.vx,this.flight.vz-p.vz);
   if(hit.touching){
    // Resolve contact against the collider, then emit success from this event only.
    const verticalSpeed=this.flight.vy-p.vy;d.y=hit.supportHeight;this.flight.vy=p.vy;
    if(relativeSpeed<1.5&&Math.abs(verticalSpeed)<2){
     this.contact={time:this.time,separation:hit.separation,point:hit.point};
     clearTouchdownFoliage(d.x,d.z,this.map);
     this.phase='Landed';this.success=true;this.completedAt=this.time;
     p.speed=0;p.vx=0;p.vy=0;p.vz=0;this.flight.vx=0;this.flight.vy=0;this.flight.vz=0;this.flight.thrust=0;d.speed=0;
     this.explosion={x:p.x,y:p.y,z:p.z,time:this.time,wallTime:Date.now()/1000,id:++this.explosionId};
     if(!this.landingRewarded){this.award(50,'Touchdown on person');this.landingRewarded=true;}
     this.log('Task success · collider contact verified');
    }
   }
  }
  if((this.phase==='Landing'||this.phase==='Investigating')&&landing&&d.y-this.ground(d.x,d.z)<.08&&Math.abs(this.flight.vy)<.5&&(!this.visible||this.phase==='Landing')){
   clearTouchdownFoliage(d.x,d.z,this.map);
   this.phase='Landed';this.failed=true;this.success=false;this.completedAt=this.time;
   d.y=this.ground(d.x,d.z);this.flight.vx=this.flight.vy=this.flight.vz=this.flight.thrust=d.speed=0;
   this.award(FAILED_LANDING_PENALTY,'Landing failed · did not land on the person');
  }
  if(this.sensorEnabled&&this.phase!=='Landed')for(let x=0;x<this.map.size/5;x++)for(let z=0;z<this.map.size/5;z++)if(Math.hypot(x*5+2.5-d.x,z*5+2.5-d.z,d.y)<this.sensorRange)this.coverage.add(`${x},${z}`);
  if(this.phase!=='Landed'){
   this.reward-=.02*dt;
   this.reward+=(this.coverage.size-coveredBefore)*.2;
   if(this.phase==='Tracking'){const bonus=Math.min(dt*.5,20-this.trackingReward);this.trackingReward+=bonus;this.reward+=bonus;}
  }
  this.rewardRate=(this.reward-scoreBefore)/dt;
  for(const cell of this.coverage)this.sharedBrain.coverage.add(cell);
  if(this.time-this.lastLearningTime>=.5||this.contact||this.failed){const next=this.features();this.sharedBrain.learn(this.learningFeatures,this.reward-this.lastLearningReward,next,this.droneId);this.learningFeatures=next;this.lastLearningTime=this.time;this.lastLearningReward=this.reward;}

  if(!this.history.length||this.time-this.history.at(-1)!.time>=.25){this.trail.push({x:d.x,z:d.z});this.trail=this.trail.slice(-500);this.samples.push({time:this.time,drone:{x:d.x,y:d.y,z:d.z},person:{x:p.x,y:p.y,z:p.z},visible:this.visible,phase:this.phase,reward:this.reward,thrust:this.flight.thrust,roll:this.flight.roll,pitch:this.flight.pitch});this.samples=this.samples.slice(-2400);this.history.push({time:this.time,confidence:this.confidence,speed:d.speed});this.history=this.history.slice(-240);}
 }

}
