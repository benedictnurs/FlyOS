import test from 'node:test';
import assert from 'node:assert/strict';
import {Environment, Perception, TrainingLoop} from './engine.ts';

test('objects persist after release and failed movement cannot cross a wall', () => {
 const env=new Environment();env.robot.x=2;env.robot.z=2;
 assert.equal(env.act('grab'),1);
 env.robot.x=1;env.robot.z=3;
 assert.equal(env.act('release'),10);
 const cup=env.items.find(o=>o.id==='cup-01');
 env.act('wait');assert.equal(cup.x,1);assert.equal(cup.z,4);assert.equal(cup.done,true);
 env.robot.x=4;env.robot.z=4;env.robot.heading=1;
 assert.equal(env.act('move_forward'),-5);assert.equal(env.robot.x,4);
});
test('perception is local and resetting the house preserves learned weights',()=>{
 const e=new TrainingLoop();assert.ok(new Perception().observe(e.environment).length<e.environment.items.length);
 e.associations.q.example=[1];e.resetEnvironment();assert.deepEqual(e.associations.q.example,[1]);
});
test('experience improves dish reward and completion length',()=>{
 const random=Math.random;let seed=17;Math.random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
 try{const e=new TrainingLoop();while(e.metrics.length<1000)e.tick();const first=e.metrics.slice(0,100),last=e.metrics.slice(-100);const mean=(xs,key)=>xs.reduce((s,x)=>s+x[key],0)/xs.length;
 assert.ok(mean(last,'reward')>mean(first,'reward'));assert.ok(mean(last,'steps')<mean(first,'steps'));assert.ok(mean(last,'success')>.8);assert.ok(Object.keys(e.skills.learned).length>0);
 console.log({initialReward:mean(first,'reward'),finalReward:mean(last,'reward'),initialSteps:mean(first,'steps'),finalSteps:mean(last,'steps')});
 }finally{Math.random=random;}
});
