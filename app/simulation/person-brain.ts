import {sightBlocked,terrainHeight,type WorldMap} from './terrain';
import type {Position3} from './contact';
export class PersonBrain {
 enabled=true;awareness=24;state='Roaming';danger=0;coverName='None';
 maxHideSeconds=5;hidingSeconds=0;timePenalty=0;score=0;
 private lastDecision=0;private hideStarted=0;
 goal:{x:number;z:number;name:string}|null=null;
 exposure:Record<string,number>={};decisions:{time:number;text:string}[]=[];
 private nextDecision=0;private restUntil=0;private arrivedGoal='';
 choose(person:Position3,drones:Position3[],map:WorldMap,time:number){
  if(time<this.nextDecision)return this.goal;const elapsed=Math.max(0,Math.min(.5,time-this.lastDecision));this.lastDecision=time;this.nextDecision=time+.4;
  if(this.state==='Hiding'){const penalty=elapsed*.5;this.timePenalty+=penalty;this.score-=penalty;this.hidingSeconds=Math.max(0,time-this.hideStarted);}
  const nearby=drones.filter(d=>Math.hypot(d.x-person.x,d.z-person.z)<this.awareness);
  this.danger=nearby.length?Math.max(0,1-Math.min(...nearby.map(d=>Math.hypot(d.x-person.x,d.z-person.z)))/this.awareness):0;
  const exposed=nearby.some(d=>!sightBlocked(d,{...person,y:person.y+1.4},map));
  if(this.goal&&map.hideouts.some(h=>h.name===this.goal!.name&&h.cleared)){this.goal=null;this.state='Seeking cover';}
  const arrived=this.goal&&Math.hypot(person.x-this.goal.x,person.z-this.goal.z)<.6;
  if(arrived&&!exposed&&this.goal&&this.arrivedGoal!==this.goal.name){this.arrivedGoal=this.goal.name;this.hideStarted=time;this.hidingSeconds=0;this.restUntil=time+this.maxHideSeconds;}
  if(arrived&&!exposed&&time<Math.min(this.restUntil,this.hideStarted+this.maxHideSeconds)){this.state='Hiding';return this.goal;}
  if(arrived&&exposed&&this.goal)this.exposure[this.goal.name]=(this.exposure[this.goal.name]??0)+1;
  if(!this.goal||arrived||exposed&&this.state==='Hiding'){
   if(this.state==='Hiding'&&arrived)this.decisions.unshift({time,text:`Hiding limit reached · relocate (${this.timePenalty.toFixed(1)} total time penalty)`});
   const places=[...map.hideouts.filter(h=>!h.cleared).map(h=>({x:h.x,z:h.z,name:h.name})),...map.trenches.map((t,i)=>({x:t.x,z:t.z,name:`Trench ${i+1}`})),...map.trees.filter(t=>!t.crownCleared).map((t,i)=>{const near=nearby[0];const dx=near?t.x-near.x:1,dz=near?t.z-near.z:1,len=Math.hypot(dx,dz)||1;return {x:t.x+dx/len*(t.radius+1),z:t.z+dz/len*(t.radius+1),name:`Tree ${i+1}`};})];
   const score=(p:{x:number;z:number;name:string})=>{
    const distance=Math.hypot(person.x-p.x,person.z-p.z);
    const hidden=nearby.filter(d=>sightBlocked(d,{x:p.x,y:terrainHeight(p.x,p.z,map)+1.4,z:p.z},map)).length;
    return hidden*15-distance*.5-(this.exposure[p.name]??0)*12-(p.name===this.goal?.name?20:0);
   };
   this.hidingSeconds=0;this.arrivedGoal='';this.goal=places.filter(p=>p.name!==this.goal?.name).sort((a,b)=>score(b)-score(a))[0]??{x:map.size*.25,z:map.size*.25,name:'Open ground'};this.coverName=this.goal.name;this.restUntil=time+7;
   this.state=nearby.length?'Seeking cover':'Exploring cover';this.decisions.unshift({time,text:`${this.state} → ${this.coverName}`});this.decisions=this.decisions.slice(0,8);
  }else this.state=nearby.length?'Seeking cover':'Roaming';
  return this.goal;
 }
}
