import {SwarmBrain,type CoverCommitment} from './swarm-brain';
import type {LandingDecision} from './landing-brain';

/** Per-agent decisions and exploration, backed by a reusable learning model. */
export class BrainInstance {
 decisions=0;explorations=0;
 private randomState:number;
 constructor(public model:SwarmBrain,readonly id:number){this.randomState=((id+1)*2654435761)>>>0;}
 private random(){this.randomState=(Math.imul(this.randomState,1664525)+1013904223)>>>0;return this.randomState/4294967296;}
 get explorationRate(){return Math.max(.05,.2/Math.sqrt(1+this.model.updates/500));}
 choose<T extends {features:number[]}>(candidates:T[],prior:(candidate:T)=>number,learnedWeight=.25){
  if(!candidates.length)return null;
  this.decisions++;
  const ranked=[...candidates].sort((a,b)=>(prior(b)+this.model.predict(b.features).value*learnedWeight)-(prior(a)+this.model.predict(a.features).value*learnedWeight));
  // Explore promising alternatives while retaining the controller's safety constraints.
  if(this.random()<this.explorationRate){this.explorations++;return ranked[Math.floor(this.random()*Math.min(5,ranked.length))];}
  return ranked[0];
 }
 learn(features:number[],reward:number,nextFeatures:number[],terminal=false){this.model.learn(features,reward,nextFeatures,this.id,terminal);}
 scan(features:number[]){this.decisions++;return this.model.altitude.choose(features,()=>this.random());}
 learnScan(features:number[],action:number,reward:number,next:number[],terminal=false){this.model.altitude.learn(features,action,reward,next,terminal);}
 land(features:number[]){this.decisions++;return this.model.landing.decide(features);}
 coverWasVacated(cover:CoverCommitment,observation:{x:number;z:number;time:number}|null,time:number){return this.model.coverWasVacated(cover,observation,time);}
 learnLanding(decision:LandingDecision,reward:number,nextFeatures:number[],terminal=false,success=false){this.model.landing.learn(decision,reward,nextFeatures,this.id,terminal,success);}
}
