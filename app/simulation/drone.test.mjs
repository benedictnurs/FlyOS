import test from 'node:test';
import assert from 'node:assert/strict';
import {DroneSimulation} from './drone.ts';
import {FlightDynamics} from './flight.ts';
import {personContact,PERSON_HEIGHT} from './contact.ts';
import {generateMap,terrainHeight,sightBlocked,foliageCleared} from './terrain.ts';
import {PHYSICAL_SCALE} from './scale.ts';
import {PersonBrain} from './person-brain.ts';
const advance=(sim,seconds)=>{for(let i=0;i<seconds*60;i++)sim.tick(1/60);};
const until=(sim,predicate,seconds=240)=>{for(let i=0;i<seconds*60&&!predicate();i++)sim.tick(1/60);assert.ok(predicate(),`${sim.phase} at ${sim.time.toFixed(1)} s`);};

test('Find confirms a person without triggering contact success',()=>{
 const sim=new DroneSimulation();until(sim,()=>sim.success);
 assert.equal(sim.task,'find');assert.equal(sim.contact,null);assert.equal(sim.explosion,null);
 assert.ok(sim.confidence>=.65);assert.ok(sim.drone.y>PERSON_HEIGHT);
});
test('Find / Land only succeeds on verified game collider contact, including moving people',()=>{
 for(const motion of ['Stationary','Walking','Running','Stop & go']){
  const sim=new DroneSimulation({...generateMap(),hideouts:[]});sim.setTask('find-land');sim.setMotion(motion);until(sim,()=>!!sim.contact);
  assert.equal(sim.phase,'Landed');assert.ok(sim.success,motion);assert.ok(sim.contact.separation<=0);
  assert.ok(Math.abs(personContact(sim.drone,sim.person).separation)<1e-6);
  assert.equal(sim.flight.thrust,0);assert.ok(sim.explosion);assert.equal(sim.explosion.x,sim.person.x);
  const effect=sim.explosion,score=sim.reward;advance(sim,3);assert.equal(sim.explosion,effect);assert.equal(sim.reward,score);
 }
});
test('proximity, lateral misses and contact from below cannot count as a landing',()=>{
 const p={x:3,y:0,z:3};
 assert.equal(personContact({x:3,y:2.1,z:3},p).touching,false);
 assert.equal(personContact({x:3.4,y:1.9,z:3},p).touching,false);
 assert.equal(personContact({x:3,y:1,z:3},p).touching,false);
 assert.equal(personContact({x:3,y:1.99,z:3},p).touching,true);
});
test('sensor disabled cannot find, land, or play an explosion',()=>{
 const sim=new DroneSimulation({...generateMap(),hideouts:[]});sim.setTask('find-land');sim.sensorEnabled=false;advance(sim,30);
 assert.equal(sim.success,false);assert.equal(sim.contact,null);assert.equal(sim.explosion,null);
 sim.sensorEnabled=true;until(sim,()=>!!sim.contact);
});
test('loss charges pain once, expires memory, and can recover',()=>{
 const sim=new DroneSimulation();until(sim,()=>sim.confidence>.95);advance(sim,1);
 const losses=sim.lostContacts;sim.sensorEnabled=false;advance(sim,1);
 assert.equal(sim.lostContacts,losses+1);assert.ok(sim.pain>0);assert.equal(sim.success,false);
 assert.ok(sim.rewardEvents.some(e=>e.reason==='Pain · person lost'&&e.amount===-10));
 advance(sim,13);assert.equal(sim.lostContacts,losses+1);assert.equal(sim.lastSeen,null);
 sim.sensorEnabled=true;until(sim,()=>sim.success);
});
test('lost target near remembered cover enters a bounded camping state',()=>{
 const sim=new DroneSimulation();const h=sim.map.hideouts[0];sim.sensorEnabled=false;
 sim.lastSeen={x:h.x,y:0,z:h.z,vx:0,vy:0,vz:0,time:0};sim.confidence=1;
 advance(sim,1);assert.equal(sim.phase,'Camping');assert.ok(sim.reason.includes('cover exit'));
 advance(sim,13);assert.equal(sim.phase,'Searching');
});
test('all drones share one trainable network and a single person clock',()=>{
 const solo=new DroneSimulation(),swarm=new DroneSimulation();swarm.setDroneCount(3);
 solo.setMotion('Running');swarm.setMotion('Running');const before=JSON.stringify(swarm.sharedBrain.weights);
 advance(solo,5);advance(swarm,5);
 assert.equal(swarm.fleet.length,3);assert.ok(swarm.fleet.every(a=>a.sharedBrain===swarm.sharedBrain));
 assert.equal(swarm.sharedBrain.contributors.size,3);assert.ok(swarm.sharedBrain.updates>=27);
 assert.notEqual(JSON.stringify(swarm.sharedBrain.weights),before);assert.ok(Number.isFinite(swarm.sharedBrain.loss));
 assert.ok(Math.abs(solo.person.x-swarm.person.x)<1e-8);assert.ok(Math.abs(solo.person.z-swarm.person.z)<1e-8);
 const brain=swarm.sharedBrain;swarm.reset();assert.equal(swarm.sharedBrain,brain);assert.equal(swarm.fleet.length,3);
});
test('a secondary drone can complete the shared mission',()=>{
 const sim=new DroneSimulation();sim.setDroneCount(3);sim.setTask('find-land');until(sim,()=>!!sim.missionContact);
 assert.ok(sim.missionSuccess);assert.ok(sim.missionExplosion);assert.equal(sim.fleet.filter(a=>a.contact).length,1);
});
test('map expansion preserves existing chunks, adds cover, and updates search bounds',()=>{
 const sim=new DroneSimulation();const old=sim.map;sim.generate(true);
 assert.equal(sim.map.size,90);assert.equal(sim.map.seed,old.seed);
 for(const tree of old.trees)assert.ok(sim.map.trees.some(t=>t.x===tree.x&&t.z===tree.z));
 assert.ok(sim.map.hideouts.length>old.hideouts.length);assert.equal(sim.coverageCells,324);assert.equal(sim.waypoints.length,81);
 const seed=sim.map.seed;sim.generate();assert.notEqual(sim.map.seed,seed);
});
test('cover hides actual sensor rays and trenches have depth',()=>{
 const map=generateMap(),h=map.hideouts[0],t=map.trenches[0];
 assert.ok(terrainHeight(t.x,t.z,map)<-1);
 assert.equal(sightBlocked({x:h.x+6,y:3,z:h.z},{x:h.x,y:1.4,z:h.z},map),true);
});
test('person brain chooses cover and retains exposure experience',()=>{
 const brain=new PersonBrain(),map=generateMap(),p={x:30,y:0,z:30},drones=[{x:31,y:4,z:31}];
 const goal=brain.choose(p,drones,map,1);assert.ok(goal);assert.equal(brain.state,'Seeking cover');assert.ok(brain.danger>.5);
 brain.exposure[goal.name]=5;assert.equal(brain.exposure[goal.name],5);
});
test('physical scale and exported training data use micro-drone dimensions',()=>{
 const sim=new DroneSimulation();advance(sim,1);const data=sim.exportRun();
 assert.equal(sim.flight.mass,.25);assert.equal(PHYSICAL_SCALE.droneSpan,.3);assert.equal(sim.personHeight,2);
 assert.equal('battery' in sim.drone,false);assert.equal(data.schema,2);assert.equal(data.scale.droneSpan,.3);assert.ok(data.samples.length);
});
test('fixed timestep is independent of display frame rate',()=>{
 const a=new DroneSimulation(),b=new DroneSimulation();advance(a,20);for(let i=0;i<20*30;i++)b.tick(1/30);
 assert.ok(Math.abs(a.drone.x-b.drone.x)<1e-8);assert.ok(Math.abs(a.drone.y-b.drone.y)<1e-8);
});
test('insufficient thrust produces descent with motor lag',()=>{
 const f=new FlightDynamics();f.wind=0;f.maxThrust=1;
 const body={x:0,y:10,z:0,heading:0,speed:0};
 f.step(body,{x:0,z:0},10,6,0,1/120);assert.ok(f.thrust>1);
 for(let i=0;i<120;i++)f.step(body,{x:0,z:0},10,6,i/120,1/120);
 assert.ok(body.y<8);assert.ok(f.vy<0);
});
test('return uses each drone launch location',()=>{
 const sim=new DroneSimulation();sim.setDroneCount(2);advance(sim,5);sim.returnRequested=true;advance(sim,60);
 for(const a of sim.fleet){assert.equal(a.phase,'Landed');assert.ok(Math.hypot(a.drone.x-a.home.x,a.drone.z-a.home.z)<.8);}
});
test('person incurs a hiding penalty and leaves cover after its time limit',()=>{
 const brain=new PersonBrain(),map=generateMap();brain.maxHideSeconds=2;
 const goal=brain.choose({x:30,y:0,z:30},[],map,1);
 const person={x:goal.x,y:terrainHeight(goal.x,goal.z,map),z:goal.z};
 brain.choose(person,[],map,2);assert.equal(brain.state,'Hiding');
 brain.choose(person,[],map,2.5);brain.choose(person,[],map,3);brain.choose(person,[],map,3.5);
 assert.ok(brain.timePenalty>0);assert.ok(brain.score<0);
 brain.choose(person,[],map,4.1);assert.notEqual(brain.state,'Hiding');assert.notEqual(brain.goal.name,goal.name);
});

function coverMission(present){
 const sim=new DroneSimulation({size:60,seed:1,trees:[],trenches:[],hideouts:[{x:15,z:15,height:2.6,radius:2.3,name:'Test grove'}]});
 sim.drone={x:15,y:7,z:15,heading:0,speed:0};
 sim.lastSeen={x:15,y:0,z:15,vx:0,vy:0,vz:0,time:0};
 if(present){sim.person.x=15;sim.person.z=15;sim.person.y=0;}
 return sim;
}
test('suspected cover clears a local descent path and reveals a hidden person',()=>{
 const sim=coverMission(true);advance(sim,.1);assert.equal(sim.phase,'Investigating');assert.equal(sim.visible,false);
 until(sim,()=>sim.success,40);assert.equal(sim.failed,false);assert.equal(sim.contact,null);
 assert.ok(foliageCleared(15,1.4,15,sim.map));assert.equal(foliageCleared(17,1.4,15,sim.map),false);
 assert.equal(sightBlocked({x:15,y:7,z:15},{x:15,y:1.4,z:15},sim.map),false);
});
test('empty suspected cover ends grounded and failed, retaining its clearing until reset',()=>{
 const sim=coverMission(false);until(sim,()=>sim.failed,40);
 assert.equal(sim.phase,'Landed');assert.equal(sim.success,false);assert.equal(sim.contact,null);assert.equal(sim.explosion,null);
 assert.equal(sim.flight.thrust,0);assert.equal(sim.drone.y,sim.ground(sim.drone.x,sim.drone.z));
 const position={...sim.drone};advance(sim,3);assert.deepEqual(sim.drone,position);assert.ok(sim.map.clearings.length);
 sim.reset();assert.equal(sim.failed,false);assert.equal(sim.map.clearings.length,0);
});
test('guard envelopes reject trunk penetration and separate drones',()=>{
 const sim=new DroneSimulation({size:60,seed:1,trees:[{x:5,z:5,height:6,radius:2}],trenches:[],hideouts:[]});
 sim.drone.y=2;sim.tick(1/120);assert.ok(Math.hypot(sim.drone.x-5,sim.drone.z-5)>=.569);
 const swarm=new DroneSimulation();swarm.setDroneCount(2);
 Object.assign(swarm.agents[0].drone,swarm.drone);swarm.tick(1/120);
 const [a,b]=swarm.fleet.map(a=>a.drone);assert.ok(Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)>=.439);
});
test('unobserved nearby foliage can be suspected without hidden target coordinates',()=>{
 const a=coverMission(false),b=coverMission(true);
 for(const sim of [a,b]){sim.lastSeen=null;sim.time=46;sim.tick(1/120);}
 assert.equal(a.phase,'Investigating');assert.equal(b.phase,'Investigating');assert.deepEqual(a.aim,b.aim);
});
test('failed fleet leader does not stop the person clock or other aircraft',()=>{
 const sim=coverMission(false);sim.setDroneCount(2);sim.phase='Landed';sim.failed=true;sim.setMotion('Walking');
 const old={...sim.person};advance(sim,1);
 assert.ok(Math.hypot(sim.person.x-old.x,sim.person.z-old.z)>0);assert.ok(sim.agents[0].time>.9);
});
