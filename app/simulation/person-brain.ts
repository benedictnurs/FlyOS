import {BrainInstance} from './brain-instance';
import {SwarmBrain} from './swarm-brain';
import {blockedByTrunk,sightBlocked,terrainHeight,type WorldMap} from './terrain';
import type {Position3} from './contact';
export class PersonBrain {
 brain=new BrainInstance(new SwarmBrain(),0);
 private learningFeatures:number[]|null=null;
 private lastGoalDistance:number|null=null;
 routeReward=0;routeUpdates=0;
 enabled=true;awareness=24;state='Roaming';danger=0;coverName='None';
 hidingLimitsEnabled=true;visibilityPenalty=0;
 maxHideSeconds=5;hidingSeconds=0;timePenalty=0;score=0;
 private lastDecision=0;private hideStarted=0;
 goal:{x:number;z:number;name:string}|null=null;
 exposure:Record<string,number>={};decisions:{time:number;text:string}[]=[];
 stamina=100;staminaCooldown=0;exhausted=false;stumbles=0;
 private pendingStumblePenalty=0;
 private staminaReadyAt=0;private stumbleUntil=0;private staminaRandom=137;
 updateStamina(requestedSpeed:number,time:number,dt:number,threatNearby:boolean){
  const running=requestedSpeed>2&&!this.exhausted&&time>=this.stumbleUntil;
  if(running){
   this.stamina=Math.max(0,this.stamina-12*dt);this.staminaReadyAt=time+3;
   if(this.stamina<=0)this.exhausted=true;
   if(this.stamina<25&&threatNearby){
    this.staminaRandom=(Math.imul(this.staminaRandom,1664525)+1013904223)>>>0;
    if(this.staminaRandom/4294967296<1-Math.exp(-.35*dt)){
     this.stumbleUntil=time+1.5;this.stumbles++;this.score-=5;this.pendingStumblePenalty-=5;
     this.decisions.unshift({time,text:'Tired sprint · stumbled near a drone (−5)'});this.decisions=this.decisions.slice(0,8);
    }
   }
  }else if(time>=this.staminaReadyAt){this.stamina=Math.min(100,this.stamina+18*dt);}
  this.staminaCooldown=Math.max(0,this.staminaReadyAt-time);
  if(this.exhausted&&this.stamina>=30)this.exhausted=false;
  if(time<this.stumbleUntil)return 0;
  return this.exhausted?Math.min(requestedSpeed,1.3):requestedSpeed;
 }
 private nextDecision=0;private restUntil=0;private arrivedGoal='';
 finishRun(hit:boolean){
  if(this.learningFeatures)this.brain.learn(this.learningFeatures,(hit?-50:0)+this.pendingStumblePenalty,this.learningFeatures,true);
  if(hit)this.score-=50;
  this.pendingStumblePenalty=0;
 }
 private routeFeatures(goal:{x:number;z:number;name:string},person:Position3,drones:Position3[],map:WorldMap){
  return [(this.exposure[goal.name]??0)>0?0:1,Math.min(1,Math.hypot(person.x-goal.x,person.z-goal.z)/map.size),1-this.danger,drones.some(d=>!sightBlocked(d,{x:goal.x,y:terrainHeight(goal.x,goal.z,map)+1.4,z:goal.z},map))?1:0,this.danger,this.stamina/100,this.exhausted?1:0,1];
 }
 choose(person:Position3,drones:Position3[],map:WorldMap,time:number){
  if(time<this.nextDecision)return this.goal;const elapsed=Math.max(0,Math.min(.5,time-this.lastDecision));this.lastDecision=time;this.nextDecision=time+.4;
  if(this.state==='Hiding'){const penalty=this.hidingLimitsEnabled?elapsed*.5:0;this.timePenalty+=penalty;this.score-=penalty;this.hidingSeconds=Math.max(0,time-this.hideStarted);}
  const nearby=drones.filter(d=>Math.hypot(d.x-person.x,d.z-person.z)<this.awareness);
  this.danger=nearby.length?Math.max(0,1-Math.min(...nearby.map(d=>Math.hypot(d.x-person.x,d.z-person.z)))/this.awareness):0;
  const exposed=nearby.some(d=>!sightBlocked(d,{...person,y:person.y+1.4},map));
  const sightPenalty=exposed?elapsed*5:0;this.visibilityPenalty+=sightPenalty;this.score-=sightPenalty;
  const distance=this.goal?Math.hypot(person.x-this.goal.x,person.z-this.goal.z):null;
  const arrivedNow=distance!==null&&distance<.6&&!exposed&&this.arrivedGoal!==this.goal?.name;
  const progress=distance!==null&&this.lastGoalDistance!==null?Math.max(-1,Math.min(1,this.lastGoalDistance-distance)):0;
  const travelCost=distance!==null&&distance>=.6?elapsed*.2:0;
  const reward=elapsed*((exposed?-5:1)-(this.hidingLimitsEnabled&&this.state==='Hiding'?.5:0))-travelCost+progress+(arrivedNow?5:0)+this.pendingStumblePenalty;
  const observation=this.goal?this.routeFeatures(this.goal,person,nearby,map):[1,0,1-this.danger,exposed?1:0,this.danger,this.stamina/100,this.exhausted?1:0,1];
  if(this.learningFeatures){this.brain.learn(this.learningFeatures,reward,observation);this.routeUpdates++;this.routeReward+=reward;}
  this.pendingStumblePenalty=0;
  this.lastGoalDistance=distance;
  if(this.goal&&map.hideouts.some(h=>h.name===this.goal!.name&&h.cleared)){this.goal=null;this.state='Seeking cover';}
  const arrived=this.goal&&Math.hypot(person.x-this.goal.x,person.z-this.goal.z)<.6;
  if(arrived&&!exposed&&this.goal&&this.arrivedGoal!==this.goal.name){this.arrivedGoal=this.goal.name;this.hideStarted=time;this.hidingSeconds=0;this.restUntil=time+this.maxHideSeconds;}
  if(arrived&&!exposed&&(!this.hidingLimitsEnabled||time<Math.min(this.restUntil,this.hideStarted+this.maxHideSeconds))){this.state='Hiding';return this.goal;}
  if(arrived&&exposed&&this.goal)this.exposure[this.goal.name]=(this.exposure[this.goal.name]??0)+1;
  if(!this.goal||arrived||exposed&&this.state==='Hiding'){
   if(this.state==='Hiding'&&arrived)this.decisions.unshift({time,text:`Hiding limit reached · relocate (${this.timePenalty.toFixed(1)} total time penalty)`});
   const places=[...map.hideouts.filter(h=>!h.cleared).map(h=>({x:h.x,z:h.z,name:h.name})),...map.trenches.map((t,i)=>({x:t.x,z:t.z,name:`Trench ${i+1}`})),...map.trees.filter(t=>!t.crownCleared).map((t,i)=>{const near=nearby[0];const dx=near?t.x-near.x:1,dz=near?t.z-near.z:1,len=Math.hypot(dx,dz)||1;return {x:t.x+dx/len*(t.radius+1),z:t.z+dz/len*(t.radius+1),name:`Tree ${i+1}`};})];
   const score=(p:{x:number;z:number;name:string})=>{
    const distance=Math.hypot(person.x-p.x,person.z-p.z);
    const hidden=nearby.filter(d=>sightBlocked(d,{x:p.x,y:terrainHeight(p.x,p.z,map)+1.4,z:p.z},map)).length;
    return hidden*15-distance*.5-(this.exposure[p.name]??0)*12-(p.name===this.goal?.name?20:0);
   };
   this.hidingSeconds=0;this.arrivedGoal='';
   const selected=this.brain.choose(places.filter(p=>p.name!==this.goal?.name&&!blockedByTrunk(p.x,p.z,map)).map(p=>({...p,features:this.routeFeatures(p,person,nearby,map)})),p=>score(p)/15,2);
   this.goal=selected??{x:map.size*.25,z:map.size*.25,name:'Open ground'};
   this.learningFeatures=selected?.features??this.routeFeatures(this.goal,person,nearby,map);
   this.lastGoalDistance=Math.hypot(person.x-this.goal.x,person.z-this.goal.z);
   this.coverName=this.goal.name;this.restUntil=time+7;
   this.state=nearby.length?'Seeking cover':'Exploring cover';this.decisions.unshift({time,text:`${this.state} → ${this.coverName}`});this.decisions=this.decisions.slice(0,8);
  }else this.state=nearby.length?'Seeking cover':'Roaming';
  return this.goal;
 }
}
