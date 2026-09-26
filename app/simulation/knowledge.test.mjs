import test from 'node:test';
import assert from 'node:assert/strict';
import {DroneSimulation} from './drone.ts';
import {serializeKnowledge,restoreKnowledge} from './knowledge.ts';

test('training changes real weights and persisted knowledge restores all models',()=>{
 const engine=new DroneSimulation();engine.setDroneCount(3);engine.setTask('find-land');engine.setMotion('Run & hide');
 const search=JSON.stringify(engine.sharedBrain.weights),landing=JSON.stringify(engine.sharedBrain.landing.export()),person=JSON.stringify(engine.personBrain.brain.model.weights);
 for(let i=0;i<1800&&!engine.missionContact&&!engine.missionFailed;i++)engine.tick(1/60);
 assert.notEqual(JSON.stringify(engine.sharedBrain.weights),search);
 assert.notEqual(JSON.stringify(engine.sharedBrain.landing.export()),landing);
 assert.notEqual(JSON.stringify(engine.personBrain.brain.model.weights),person);
 assert.ok(engine.sharedBrain.landing.updates>0);
 const saved=serializeKnowledge(engine),restored=new DroneSimulation();restored.setDroneCount(3);
 restoreKnowledge(restored,saved);
 assert.deepEqual(restored.sharedBrain.export(),engine.sharedBrain.export());
 assert.deepEqual(restored.personBrain.brain.model.export(),engine.personBrain.brain.model.export());
 assert.ok(restored.fleet.every(a=>a.brain.model===restored.sharedBrain));
 const updates=restored.sharedBrain.updates;restored.reset();
 assert.equal(restored.sharedBrain.updates,updates);
 for(let i=0;i<60;i++)restored.tick(1/60);
 assert.ok(restored.sharedBrain.updates>updates);
});
test('invalid saved knowledge cannot partially replace trained models',()=>{
 const engine=new DroneSimulation();engine.tick(.1);
 const before=serializeKnowledge(engine),invalid=JSON.parse(before);
 invalid.person.weights[0]=[null];
 assert.throws(()=>restoreKnowledge(engine,JSON.stringify(invalid)));
 const after=JSON.parse(serializeKnowledge(engine));delete after.savedAt;
 const original=JSON.parse(before);delete original.savedAt;
 assert.deepEqual(after,original);
});

test('each run finalizes once and writes trained weights to a project file',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {writeModel,readModel}=await import('./model-store.ts');
 const directory=await mkdtemp(join(tmpdir(),'flyos-model-'));
 try{
  const engine=new DroneSimulation();engine.setTask('find-land');
  for(let i=0;i<14400&&!engine.missionContact&&!engine.missionFailed;i++)engine.tick(1/60);
  assert.ok(engine.missionContact||engine.missionFailed);
  engine.finalizeTrainingRun();engine.finalizeTrainingRun();assert.equal(engine.sharedBrain.trainingRuns,1);
  await writeModel(serializeKnowledge(engine),directory);
  const next=new DroneSimulation();restoreKnowledge(next,await readModel(directory));
  assert.deepEqual(next.sharedBrain.export(),engine.sharedBrain.export());
  assert.deepEqual(next.personBrain.brain.model.export(),engine.personBrain.brain.model.export());
  next.setTask('find-land');for(let i=0;i<14400&&!next.missionContact&&!next.missionFailed;i++)next.tick(1/60);
  next.finalizeTrainingRun();assert.equal(next.sharedBrain.trainingRuns,2);
  await writeModel(serializeKnowledge(next),directory);
  const saved=JSON.parse(await readModel(directory));assert.equal(saved.drone.trainingRuns,2);
  assert.ok(saved.drone.updates>engine.sharedBrain.updates);
  await assert.rejects(()=>writeModel('{"version":0}',directory));
 }finally{await rm(directory,{recursive:true,force:true});}
});


test('new training runs randomize terrain while retaining learned models and controls',()=>{
 const engine=new DroneSimulation();engine.setDroneCount(3);engine.setTask('find-land');engine.setMotion('Run & hide');engine.landingRadius=4;engine.personBrain.hidingLimitsEnabled=false;
 for(let i=0;i<120;i++)engine.tick(1/60);
 const drone=engine.sharedBrain,person=engine.personBrain.brain.model;
 const weights=JSON.stringify(drone.export()),personWeights=JSON.stringify(person.export());
 let oldMap=engine.map;
 for(let run=0;run<3;run++){
  engine.personBrain.exposure['Grove 1.1']=10;engine.startTrainingRun();
  assert.notEqual(engine.map.seed,oldMap.seed);assert.notDeepEqual(engine.map.trees,oldMap.trees);
  assert.equal(engine.map.size,oldMap.size);assert.equal(engine.time,0);assert.equal(engine.trainingFinalized,false);
  assert.equal(engine.sharedBrain,drone);assert.equal(engine.personBrain.brain.model,person);
  assert.equal(JSON.stringify(drone.export()),weights);assert.equal(JSON.stringify(person.export()),personWeights);
  assert.deepEqual(engine.personBrain.exposure,{});assert.equal(engine.fleet.length,3);
  assert.equal(engine.task,'find-land');assert.equal(engine.motion,'Run & hide');assert.equal(engine.landingRadius,4);assert.equal(engine.personBrain.hidingLimitsEnabled,false);
  oldMap=engine.map;
 }
});
