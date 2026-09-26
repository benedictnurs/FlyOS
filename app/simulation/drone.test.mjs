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
test('Find / Land still supports direct collider touchdown, including moving people',()=>{
 for(const motion of ['Stationary','Walking','Running','Stop & go']){
  const sim=new DroneSimulation({...generateMap(),hideouts:[],trees:[]});sim.setTask('find-land');sim.earlyLanding=false;sim.setMotion(motion);until(sim,()=>!!sim.contact);
  assert.equal(sim.phase,'Landed');assert.ok(sim.success,motion);assert.ok(sim.contact.separation<=0);
  assert.ok(Math.abs(personContact(sim.drone,sim.person).separation)<1e-6);
  assert.equal(sim.flight.thrust,0);assert.ok(sim.explosion);assert.deepEqual({x:sim.explosion.x,y:sim.explosion.y,z:sim.explosion.z},{x:sim.drone.x,y:sim.drone.y,z:sim.drone.z});
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
 const sim=new DroneSimulation({...generateMap(),hideouts:[],trees:[]});sim.setTask('find-land');sim.sensorEnabled=false;advance(sim,30);
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
 for(const a of sim.fleet){assert.equal(a.phase,'Landed');assert.ok(Math.hypot(a.drone.x-a.home.x,a.drone.z-a.home.z)<.8);assert.ok(a.explosion);assert.equal(a.explosion.x,a.drone.x);assert.equal(a.explosion.y,a.drone.y);}
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
 assert.equal(sim.phase,'Landed');assert.equal(sim.success,false);assert.equal(sim.contact,null);assert.ok(sim.explosion);assert.equal(sim.explosion.y,sim.drone.y);
 assert.equal(sim.flight.thrust,0);assert.equal(sim.drone.y,sim.ground(sim.drone.x,sim.drone.z));
 const position={...sim.drone},effect=sim.explosion;advance(sim,3);assert.equal(sim.explosion,effect);assert.deepEqual(sim.drone,position);assert.ok(sim.map.clearings.length);
 sim.reset();assert.equal(sim.explosion,null);assert.equal(sim.failed,false);assert.equal(sim.map.clearings.length,0);
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


test('fly brain instances share drone weights but keep independent exploration',async()=>{
 const {BrainInstance}=await import('./brain-instance.ts');
 const sim=new DroneSimulation();sim.setDroneCount(3);
 assert.equal(new Set(sim.fleet.map(a=>a.brain)).size,3);
 assert.ok(sim.fleet.every(a=>a.brain.model===sim.sharedBrain));
 assert.ok(sim.personBrain.brain instanceof BrainInstance);
 assert.notEqual(sim.personBrain.brain.model,sim.sharedBrain);
 const candidates=Array.from({length:5},(_,i)=>({index:i,features:[1,0,0,0,0,0,0,1]}));
 const traces=sim.fleet.map(a=>Array.from({length:100},()=>a.brain.choose(candidates,()=>0).index));
 assert.notDeepEqual(traces[0],traces[1]);
 assert.ok(sim.fleet.every(a=>a.brain.explorations>0));
 const before=sim.sharedBrain.updates;sim.fleet[1].brain.learn(candidates[0].features,10,candidates[0].features);
 assert.equal(sim.sharedBrain.updates,before+1);
});
test('person learns with fly brain software and retains its model across runs',()=>{
 const sim=new DroneSimulation();sim.setMotion('Run & hide');advance(sim,3);
 const model=sim.personBrain.brain.model,updates=model.updates;
 assert.ok(updates>0);assert.ok(model.weights.flat().every(Number.isFinite));
 sim.personBrain.exposure.test=2;sim.reset();
 assert.equal(sim.personBrain.brain.model,model);assert.equal(model.updates,updates);
 assert.equal(sim.personBrain.exposure.test,2);assert.equal(sim.personBrain.brain.decisions,0);
});


test('landing duration reduces reward and stops charging after touchdown',()=>{
 const sim=new DroneSimulation({...generateMap(),hideouts:[]});sim.setTask('find-land');until(sim,()=>!!sim.contact);
 assert.ok(sim.landingSeconds>0);assert.ok(Math.abs(sim.landingTimePenalty-sim.landingSeconds)<1e-9);
 assert.ok(sim.rewardEvents.some(e=>e.reason.includes('Landing time')&&e.amount===-sim.landingTimePenalty));
 const penalty=sim.landingTimePenalty,seconds=sim.landingSeconds,updates=sim.sharedBrain.updates;
 advance(sim,3);assert.equal(sim.landingTimePenalty,penalty);assert.equal(sim.landingSeconds,seconds);
 assert.ok(updates>0);assert.equal(sim.exportRun().drones[0].landingTimePenalty,penalty);
 sim.reset();assert.equal(sim.landingSeconds,0);assert.equal(sim.landingTimePenalty,0);
});


test('ground touchdown succeeds inside the person radius and fails outside it',()=>{
 for(const distance of [2.9,3,3.1]){
  const sim=new DroneSimulation({size:60,seed:1,trees:[],trenches:[],hideouts:[]});
  sim.setTask('find-land');sim.drone={x:15,y:0,z:15,heading:0,speed:0};
  sim.person.x=15+distance;sim.person.z=15;sim.person.y=0;
  sim.phase='Landing';sim.sensorEnabled=false;sim.landingSite={x:15,z:15};
  sim.lastSeen={x:15,y:0,z:15,vx:0,vy:0,vz:0,time:0};
  sim.tick(1/120);
  assert.equal(sim.phase,'Landed');assert.equal(sim.success,distance<=3);assert.equal(sim.failed,distance>3);
  assert.equal(!!sim.contact,distance<=3);assert.ok(sim.explosion);
  assert.equal(sim.landingRewarded,distance<=3);
 }
});


test('person routes past a trunk and recovers from starting inside it',async()=>{
 const {PersonNavigation}=await import('./person-navigation.ts');
 const map={size:60,seed:1,trees:[{x:15,z:15,radius:2,height:6}],hideouts:[],trenches:[]};
 for(const start of [{x:10,z:15},{x:15,z:15}]){
  const navigator=new PersonNavigation(),person={...start},goal={x:20,z:15};
  for(let i=0;i<1200&&Math.hypot(person.x-goal.x,person.z-goal.z)>.1;i++){
   navigator.move(person,goal,1.3/60,map);
   assert.ok(Math.hypot(person.x-15,person.z-15)>=.8);
  }
  assert.ok(Math.hypot(person.x-goal.x,person.z-goal.z)<.1);
 }
});

test('the fly brain issues landing commands and learns from success, retaining its policy on reset',()=>{
 const sim=new DroneSimulation({...generateMap(),hideouts:[]});sim.setTask('find-land');
 const policy=sim.sharedBrain.landing,before=JSON.stringify(policy.actor);let calls=0;
 const decide=sim.brain.land.bind(sim.brain);sim.brain.land=features=>{calls++;return decide(features);};
 until(sim,()=>!!sim.contact);
 assert.ok(calls>0);assert.ok(policy.updates>0);assert.equal(policy.successes,1);assert.notEqual(JSON.stringify(policy.actor),before);
 assert.ok(policy.weights.flat().every(Number.isFinite));assert.equal(policy.failures,0);
 sim.reset();assert.equal(sim.sharedBrain.landing,policy);assert.ok(sim.exportRun().sharedBrain.landing.updates>0);
});
test('only one drone descends at a time; failed landings continue until the fleet reaches zero',()=>{
 const sim=new DroneSimulation({size:60,seed:1,trees:[],trenches:[],hideouts:[15,20,25].map(x=>({x,z:15,radius:1.8,height:2.6,name:`Cover ${x}`}))});
 sim.setDroneCount(3);sim.setTask('find-land');sim.time=46;sim.person.x=500;sim.person.z=500;sim.person.y=0;
 sim.fleet.forEach((a,i)=>{a.time=46;a.drone.x=15+i*5;a.drone.z=15;a.drone.y=7;a.lastSeen={x:15+i*5,z:15,y:0,vx:0,vz:0,vy:0,time:46};});
 let sawFailureWithActiveDrones=false;
 for(let i=0;i<180*60&&!sim.missionFailed;i++){
  sim.tick(1/60);
  assert.ok(sim.fleet.filter(a=>a.phase==='Landing'||a.phase==='Investigating').length<=1);
  if(sim.fleet.some(a=>a.failed)&&sim.remainingDrones>0){sawFailureWithActiveDrones=true;assert.equal(sim.missionFailed,false);assert.equal(sim.searchFailure,null);}
 }
 assert.ok(sawFailureWithActiveDrones);assert.equal(sim.remainingDrones,0);assert.equal(sim.missionFailed,true);
 assert.ok(sim.fleet.every(a=>a.failed));assert.equal(sim.sharedBrain.failedSearches,1);assert.equal(sim.searchFailure.penalty,-750);
 assert.equal(sim.failurePenalty,-1500);assert.ok(sim.fleet.every(a=>a.pain===1));assert.equal(sim.sharedBrain.landing.failures,3);
 assert.equal(sim.sharedBrain.deploymentRisk(3),1);assert.ok(sim.sharedBrain.contributors.has(2));
 assert.ok(sim.map.hideouts.every(h=>h.cleared));assert.equal(sim.activeHideouts.length,0);
 const score=sim.totalReward,updates=sim.sharedBrain.updates,clock=sim.time;advance(sim,5);
 assert.equal(sim.totalReward,score);assert.equal(sim.sharedBrain.updates,updates);assert.equal(sim.time,clock);
 const brain=sim.sharedBrain;sim.reset();assert.equal(sim.remainingDrones,3);assert.equal(sim.missionFailed,false);assert.equal(sim.sharedBrain,brain);assert.equal(sim.sharedBrain.failedSearches,1);assert.ok(sim.map.hideouts.every(h=>!h.cleared));
});
test('tree foliage follows bush suspicion and clearing rules while the trunk remains solid',()=>{
 const map={size:60,seed:1,trees:[{x:15,z:15,height:6,radius:2}],trenches:[],hideouts:[]};
 const sim=new DroneSimulation(map);sim.drone.x=15.9;sim.drone.z=15;sim.drone.y=8;sim.person.x=55;sim.person.z=55;sim.person.y=0;
 sim.lastSeen={x:15.9,y:0,z:15,vx:0,vy:0,vz:0,time:0};
 sim.tick(1/60);assert.equal(sim.phase,'Investigating');assert.ok(Math.hypot(sim.aim.x-15,sim.aim.z-15)>.8);
 assert.equal(sightBlocked({x:15.9,y:8,z:15},{x:15.9,y:1.4,z:15},map),true);
 until(sim,()=>sim.failed,60);assert.equal(map.trees[0].crownCleared,true);assert.equal(sim.sharedBrain.landing.failures,1);
 assert.equal(sightBlocked({x:15.9,y:8,z:15},{x:15.9,y:1.4,z:15},map),false);
 assert.equal(sim.activeCover.length,0);assert.equal(map.trees.length,1);
 sim.reset();assert.equal(map.trees[0].crownCleared,false);
});
test('a return command does not penalize the fleet for an exhausted search',()=>{
 const sim=new DroneSimulation();sim.setDroneCount(3);sim.returnRequested=true;advance(sim,60);
 assert.equal(sim.searchFailure,null);assert.equal(sim.sharedBrain.failedSearches,0);assert.equal(sim.fleet.reduce((n,a)=>n+a.rewardEvents.filter(e=>e.reason.includes('Fleet search failed')).length,0),0);
});

test('brain velocity commands drive the descent instead of the scripted altitude controller',()=>{
 const prepare=()=>{const s=new DroneSimulation({size:60,seed:1,trees:[],trenches:[],hideouts:[]});s.setTask('find-land');s.person.x=15;s.person.z=15;s.person.y=0;s.drone={x:15,y:7,z:15,heading:0,speed:0};s.confidence=1;s.lastSeen={x:15,y:0,z:15,vx:0,vy:0,vz:0,time:0};s.flight.wind=0;return s;};
 const held=prepare(),descending=prepare(),decide=held.brain.land.bind(held.brain);
 held.brain.land=features=>({...decide(features),command:{vx:0,vz:0,vy:0}});
 advance(held,3);advance(descending,3);
 assert.ok(held.drone.y>6.9);assert.ok(descending.drone.y<5);assert.equal(held.contact,null);
});
test('a person hidden by a tree is investigated, learned from, and clears the crown on touchdown',()=>{
 const sim=new DroneSimulation({size:60,seed:1,trees:[{x:15,z:15,height:6,radius:2}],trenches:[],hideouts:[]});
 sim.setTask('find-land');sim.drone={x:15.9,y:8,z:15,heading:0,speed:0};sim.person.x=15.9;sim.person.z=15;sim.person.y=0;
 sim.lastSeen={x:15.9,y:0,z:15,vx:0,vy:0,vz:0,time:0};advance(sim,.1);
 assert.equal(sim.phase,'Investigating');assert.equal(sim.visible,false);
 until(sim,()=>!!sim.contact,60);assert.equal(sim.failed,false);assert.equal(sim.map.trees[0].crownCleared,true);
 assert.ok(sim.sharedBrain.landing.updates>0);assert.equal(sim.sharedBrain.landing.successes,1);
});


test('early landing triggers in range without contact and preserves settings on reset',()=>{
 const map={size:60,seed:1,trees:[],trenches:[],hideouts:[]};
 const sim=new DroneSimulation(map);sim.setTask('find-land');sim.landingRadius=4;
 sim.person.x=15;sim.person.z=15;sim.person.y=0;
 sim.drone={x:17,y:3,z:15,heading:0,speed:0};sim.confidence=1;
 sim.tick(1/120);assert.equal(sim.success,true);assert.equal(sim.phase,'Landed');assert.ok(sim.explosion);
 assert.equal(personContact(sim.drone,sim.person).touching,false);
 sim.reset();assert.equal(sim.landingRadius,4);assert.equal(sim.earlyLanding,true);
 sim.setDroneCount(2);assert.ok(sim.fleet.every(a=>a.landingRadius===4));
});
test('small effect radius cannot trigger early outside range',()=>{
 const sim=new DroneSimulation({size:60,seed:1,trees:[],trenches:[],hideouts:[]});sim.setTask('find-land');sim.landingRadius=.5;
 sim.person.x=15;sim.person.z=15;sim.person.y=0;sim.drone={x:17,y:3,z:15,heading:0,speed:0};sim.confidence=1;
 sim.tick(1/120);assert.equal(sim.success,false);assert.equal(sim.contact,null);
});


test('sprinting drains stamina, exhaustion slows movement, recovery waits for cooldown',()=>{
 const brain=new PersonBrain();let time=0,speed=0;
 for(let i=0;i<600&&!brain.exhausted;i++){time+=1/60;speed=brain.updateStamina(3.8,time,1/60,false);}
 assert.ok(brain.stamina<1);assert.equal(brain.exhausted,true);assert.equal(speed,1.3);
 const stamina=brain.stamina;
 for(let i=0;i<120;i++){time+=1/60;brain.updateStamina(0,time,1/60,false);}
 assert.equal(brain.stamina,stamina);assert.ok(brain.staminaCooldown>0);
 for(let i=0;i<240;i++){time+=1/60;brain.updateStamina(0,time,1/60,false);}
 assert.ok(brain.stamina>30);assert.equal(brain.exhausted,false);
});
test('repeated tired running near drones risks a stumble; resting does not',()=>{
 const runner=new PersonBrain(),resting=new PersonBrain();
 for(let i=0;i<12000;i++){
  runner.updateStamina(3.8,i/60,1/60,true);
  resting.updateStamina(0,i/60,1/60,true);
 }
 assert.ok(runner.stumbles>0);assert.equal(resting.stumbles,0);assert.equal(resting.stamina,100);
 assert.ok(runner.stamina>=0&&runner.stamina<=100);
});

test('hiding limits can be disabled without disabling cover behavior',()=>{
 const brain=new PersonBrain(),map=generateMap();brain.hidingLimitsEnabled=false;brain.maxHideSeconds=2;
 const goal=brain.choose({x:30,y:0,z:30},[],map,1),person={x:goal.x,y:terrainHeight(goal.x,goal.z,map),z:goal.z};
 for(let time=2;time<20;time+=.5)brain.choose(person,[],map,time);
 assert.equal(brain.state,'Hiding');assert.equal(brain.goal.name,goal.name);assert.equal(brain.timePenalty,0);
 const sim=new DroneSimulation();sim.personBrain.hidingLimitsEnabled=false;sim.reset();assert.equal(sim.personBrain.hidingLimitsEnabled,false);
});
test('being visible penalizes the person learning model and score',()=>{
 const brain=new PersonBrain(),map={size:60,seed:1,trees:[],trenches:[],hideouts:[]};
 brain.choose({x:15,y:0,z:15},[{x:16,y:3,z:15}],map,.4);
 brain.choose({x:15,y:0,z:15},[{x:16,y:3,z:15}],map,.8);
 assert.ok(brain.visibilityPenalty>0);assert.ok(brain.score<0);assert.ok(brain.brain.model.reward<0);
});
test('suspected cover can trigger a radius landing without seeing the person',()=>{
 const sim=coverMission(true);sim.task='find-land';
 until(sim,()=>!!sim.contact,40);
 assert.equal(sim.success,true);assert.equal(sim.visible,false);assert.equal(personContact(sim.drone,sim.person).touching,false);
 assert.ok(sim.map.hideouts[0].cleared);
});


test('terrain seeds vary cover counts, tree positions and trench dimensions reproducibly',()=>{
 const maps=Array.from({length:8},(_,seed)=>generateMap(60,seed+100));
 assert.deepEqual(generateMap(60,100),maps[0]);
 assert.ok(new Set(maps.map(m=>m.trees.length)).size>1);
 assert.ok(new Set(maps.map(m=>m.hideouts.length)).size>1);
 assert.ok(new Set(maps.map(m=>m.trenches[0].depth)).size>1);
 assert.ok(new Set(maps.map(m=>m.trenches[0].x)).size>1);
 for(const map of maps)assert.ok(map.trees.every(t=>Math.hypot(t.x-5,t.z-5)>3));
});
test('person route learning credits the selected route rather than a generic observation',()=>{
 const brain=new PersonBrain(),map=generateMap();let trainedFeatures=null;
 const learn=brain.brain.learn.bind(brain.brain);
 brain.brain.learn=(features,...args)=>{trainedFeatures=[...features];learn(features,...args);};
 const position={x:30,y:0,z:30};brain.choose(position,[],map,.4);
 const destination=brain.goal;assert.ok(destination);
 const originalDistance=Math.hypot(position.x-destination.x,position.z-destination.z)/map.size;
 brain.choose(position,[],map,.8);
 assert.ok(Math.abs(trainedFeatures[1]-Math.min(1,originalDistance))<1e-9);
 assert.ok(brain.routeUpdates>0);
});

test('a fresh sighting outside investigated foliage cancels descent without using up the drone',()=>{
 for(const tree of [false,true]){
  const sim=tree?new DroneSimulation({size:60,seed:1,trees:[{x:15,z:15,height:6,radius:2.3}],trenches:[],hideouts:[]}):coverMission(true);
  if(tree){sim.drone={x:15.9,y:8,z:15,heading:0,speed:0};sim.person.x=15.9;sim.person.z=15;sim.person.y=0;sim.lastSeen={x:15.9,y:0,z:15,vx:0,vz:0,vy:0,time:0};}
  sim.task='find-land';sim.earlyLanding=false;advance(sim,.1);
  assert.equal(sim.phase,'Investigating');assert.equal(sim.sharedBrain.landingDroneId,0);
  sim.person.x=24;sim.person.z=15;sim.person.y=0;advance(sim,.1);
  assert.equal(sim.visible,true);assert.equal(sim.investigation,null);assert.notEqual(sim.phase,'Landing');assert.notEqual(sim.phase,'Investigating');
  assert.equal(sim.sharedBrain.landingDroneId,null);assert.equal(sim.failed,false);assert.equal(sim.remainingDrones,1);assert.equal(sim.contact,null);
  assert.equal(sim.sharedBrain.coverExits,1);assert.ok(sim.events.some(e=>e.text.includes('cancel descent')));
  assert.ok(sim.sharedBrain.landing.updates>0);assert.equal(sim.sharedBrain.landing.failures,0);
  assert.equal(tree?sim.map.trees[0].crownCleared:sim.map.hideouts[0].cleared,undefined);
 }
});
test('a teammate sighting can cancel a descent even when the investigating drone cannot see the exit',()=>{
 const sim=coverMission(false);sim.setDroneCount(2);sim.task='find-land';sim.earlyLanding=false;sim.sensorRange=8;
 sim.person.x=500;sim.person.z=500;sim.person.y=0;
 sim.drone={x:15,y:7,z:15,heading:0,speed:0};sim.lastSeen={x:15,y:0,z:15,vx:0,vz:0,vy:0,time:0};
 sim.agents[0].drone={x:28,y:7,z:15,heading:0,speed:0};advance(sim,.1);
 assert.equal(sim.phase,'Investigating');sim.person.x=25;sim.person.z=15;sim.person.y=0;advance(sim,.1);
 assert.equal(sim.visible,false);assert.equal(sim.agents[0].visible,true);assert.equal(sim.investigation,null);
 assert.ok(sim.sharedBrain.vacantCover.has('bush:15:15'));assert.equal(sim.sharedBrain.coverExits,1);assert.equal(sim.failed,false);
 assert.ok(sim.events.some(e=>e.text.includes('Person observed leaving cover')));
});
test('a hidden departure does not give the investigating drone knowledge it has not observed',()=>{
 const sim=coverMission(true);sim.task='find-land';sim.earlyLanding=false;advance(sim,.1);assert.equal(sim.phase,'Investigating');
 sim.sensorEnabled=false;sim.person.x=40;sim.person.z=40;advance(sim,.5);
 assert.equal(sim.visible,false);assert.equal(sim.phase,'Investigating');assert.equal(sim.sharedBrain.coverExits,0);assert.equal(sim.sharedBrain.vacantCover.size,0);
});
test('shared vacancy memory ignores stale sightings, prevents repeated attempts, and permits observed re-entry',()=>{
 const sim=new DroneSimulation(),brain=sim.sharedBrain,cover={id:'bush:15:15',x:15,z:15,radius:2.3,started:10};
 assert.equal(brain.coverWasVacated(cover,{x:20,z:15,time:9.9},10.1),false);
 assert.equal(brain.coverWasVacated(cover,{x:20,z:15,time:10.1},11),false);
 assert.equal(brain.coverWasVacated(cover,{x:17.6,z:15,time:10.1},10.2),false);
 assert.equal(brain.coverWasVacated(cover,{x:20,z:15,time:10.1},10.2),true);
 assert.equal(brain.canInvestigateCover(cover,null,10.3),false);
 assert.equal(brain.canInvestigateCover(cover,{x:15,z:15,time:10.1},10.3),false);
 assert.equal(brain.canInvestigateCover(cover,{x:15,z:15,time:10.3},10.4),true);
 assert.equal(brain.vacantCover.size,0);
 brain.coverWasVacated(cover,{x:20,z:15,time:11},11.1);
 assert.equal(brain.canInvestigateCover(cover,null,23.2),true);
 brain.coverWasVacated(cover,{x:20,z:15,time:24},24.1);sim.reset();assert.equal(brain.vacantCover.size,0);
});
test('a cover departure cancels a committed landing and briefly reassesses before retargeting',()=>{
 const sim=coverMission(true);sim.task='find-land';sim.earlyLanding=false;advance(sim,.1);
 sim.phase='Landing';sim.confidence=1;sim.landingSite={x:15,z:15};sim.person.x=19;sim.person.z=15;sim.person.y=0;
 advance(sim,.1);assert.equal(sim.landingSite,null);assert.equal(sim.phase,'Tracking');assert.equal(sim.sharedBrain.landingDroneId,null);
 advance(sim,.5);assert.notEqual(sim.phase,'Landing');assert.equal(sim.sharedBrain.coverExits,1);
});


test('confirmed target lock gives a strong dopamine reward and immediately updates shared weights once',()=>{
 const sim=new DroneSimulation({size:60,seed:1,trees:[],trenches:[],hideouts:[]});sim.setDroneCount(2);
 sim.person.x=15;sim.person.z=15;sim.person.y=0;sim.drone={x:15,y:7,z:15,heading:0,speed:0};sim.confidence=.649;
 const weights=JSON.stringify(sim.sharedBrain.weights),updates=sim.sharedBrain.updates;
 sim.tick(1/120);
 assert.ok(sim.dopamine>.99);assert.equal(sim.sharedBrain.dopamineBursts,1);
 assert.ok(sim.sharedBrain.updates>updates);assert.notEqual(JSON.stringify(sim.sharedBrain.weights),weights);
 assert.ok(sim.rewardEvents.some(e=>e.reason==='Dopamine burst · target lock'&&e.amount===75));
 assert.equal(sim.agents[0].brain.model,sim.sharedBrain);
 advance(sim,2);assert.ok(sim.dopamine<.5);assert.equal(sim.rewardEvents.filter(e=>e.reason==='Dopamine burst · target lock').length,1);
 const bursts=sim.sharedBrain.dopamineBursts;sim.reset();assert.equal(sim.dopamine,0);assert.equal(sim.sharedBrain.dopamineBursts,bursts);
});


test('learned scan heights cover low and high altitudes and fixed mode survives reset',()=>{
 const sim=new DroneSimulation({size:60,seed:1,trees:[],trenches:[],hideouts:[]});sim.setDroneCount(3);
 sim.scanAction=0;assert.equal(sim.scanAltitudeTarget(),3);sim.scanAction=2;assert.equal(sim.scanAltitudeTarget(),10);
 assert.ok(sim.fleet.every(a=>a.brain.model.altitude===sim.sharedBrain.altitude));
 sim.dynamicAltitude=false;assert.equal(sim.scanAltitudeTarget(),7);sim.reset();assert.equal(sim.dynamicAltitude,false);
});
test('low scanning keeps terrain and nearby tree clearance',()=>{
 const sim=new DroneSimulation({size:60,seed:1,trees:[{x:5,z:5,radius:2,height:8}],trenches:[],hideouts:[]});
 assert.equal(sim.scanAltitudeTarget(),9);
 sim.drone.x=15;assert.equal(sim.scanAltitudeTarget(),3);
});


test('scan policy learns successful altitude actions and changes real weights',async()=>{
 const {AltitudeBrain}=await import('./altitude-brain.ts');const brain=new AltitudeBrain(),features=[0,0,0,.2,.3,0,1];
 for(let i=0;i<100;i++){brain.learn(features,2,20,features,true);brain.learn(features,0,-10,features,true);}
 assert.equal(brain.choose(features,()=>.9),2);assert.ok(brain.values(features)[2]>brain.values(features)[0]);
 assert.ok(brain.weights[2].some(w=>w!==0));
 const sim=new DroneSimulation({size:60,seed:1,trees:[],trenches:[],hideouts:[]});sim.sensorEnabled=false;advance(sim,12);
 assert.ok(sim.sharedBrain.altitude.updates>=2);
 const model=sim.sharedBrain.altitude;sim.reset();assert.equal(sim.sharedBrain.altitude,model);
});


test('successful landing gives a huge dopamine boost once and reinforces saved weights',()=>{
 const sim=new DroneSimulation({size:60,seed:1,trees:[],trenches:[],hideouts:[]});sim.setTask('find-land');
 until(sim,()=>!!sim.contact);
 assert.equal(sim.dopamine,3);assert.equal(sim.landingDopamineRewarded,true);
 assert.ok(sim.rewardEvents.some(e=>e.reason==='Huge dopamine burst · successful landing'&&e.amount===500));
 assert.ok(sim.sharedBrain.landing.reward>=500);
 const reward=sim.reward,bursts=sim.sharedBrain.dopamineBursts;
 sim.finalizeTrainingRun();advance(sim,3);assert.equal(sim.reward,reward);assert.equal(sim.sharedBrain.dopamineBursts,bursts);
 const miss=coverMission(false);until(miss,()=>miss.failed,40);
 assert.equal(miss.landingDopamineRewarded,false);assert.equal(miss.dopamine,0);
});
