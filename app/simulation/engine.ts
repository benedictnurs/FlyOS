export const ACTIONS = ['move_forward','move_backward','turn_left','turn_right','look','grab','release','push','pull','open','close','wait'] as const;
export type Action = typeof ACTIONS[number];
export type Item = {id:string;kind:string;x:number;z:number;room:string;destination?:string;open?:boolean;done?:boolean};
export const chores = ['Put dishes in the sink','Put trash in the bin','Pick clothes off the floor','Put toys in the chest','Close open drawers','Search for a cup','Bring a cup to a person','Clean the house'];
export class Robot {x=1;z=1;heading=0;battery=100;holding:string|null=null;}
export class Environment {
 items:Item[]=[];robot=new Robot();collisions=0;
 constructor(){this.reset();}
 reset(){this.robot=new Robot();this.collisions=0;this.items=[
 {id:'cup-01',kind:'cup',x:2,z:2,room:'Kitchen',destination:'sink'}, {id:'cup-02',kind:'cup',x:3,z:3,room:'Kitchen',destination:'sink'},
 {id:'sink',kind:'container',x:1,z:4,room:'Kitchen'}, {id:'trash-01',kind:'trash',x:7,z:2,room:'Living room',destination:'bin'},
 {id:'bin',kind:'container',x:5,z:1,room:'Kitchen'}, {id:'shirt-01',kind:'clothes',x:2,z:8,room:'Bedroom',destination:'basket'},
 {id:'basket',kind:'container',x:1,z:6,room:'Bedroom'}, {id:'toy-01',kind:'toy',x:8,z:4,room:'Living room',destination:'chest'},
 {id:'chest',kind:'container',x:9,z:2,room:'Living room'}, {id:'drawer',kind:'drawer',x:8,z:8,room:'Bathroom',open:true},
 {id:'person',kind:'person',x:7,z:6,room:'Hallway'}];}
 blocked(x:number,z:number){return x<0||z<0||x>10||z>10 || (x===5 && ![2,5,8].includes(z)) || (z===5 && ![2,5,8].includes(x));}
 act(a:Action){const r=this.robot;let reward=-.1;const dx=[0,1,0,-1][r.heading],dz=[1,0,-1,0][r.heading];
 if(a==='turn_left')r.heading=(r.heading+3)%4;if(a==='turn_right')r.heading=(r.heading+1)%4;
 if(a==='move_forward'||a==='move_backward'){const s=a==='move_forward'?1:-1;if(this.blocked(r.x+dx*s,r.z+dz*s)){this.collisions++;reward=-5;}else{r.x+=dx*s;r.z+=dz*s;reward=-1;}}
 const near=this.items.filter(o=>Math.hypot(o.x-r.x,o.z-r.z)<=1.45&&o.id!==r.holding);
 if(a==='grab'){const o=near.find(o=>o.destination&&!o.done);if(o&&!r.holding){r.holding=o.id;reward=1;}else reward=-5;}
 if(a==='release'){const o=this.items.find(o=>o.id===r.holding);if(o){const dest=near.find(n=>n.id===o.destination);o.x=dest?.x??r.x;o.z=dest?.z??r.z;o.done=!!dest;r.holding=null;reward=dest?10:-1;}else reward=-5;}
 if(a==='open'||a==='close'){const o=near.find(o=>o.kind==='drawer');if(o){const changed=o.open !== (a==='open');o.open=a==='open';reward=changed&&a==='close'?10:-1;}else reward=-5;}
 if(a==='push'||a==='pull'){const o=near.find(o=>o.destination&&!o.done);const s=a==='push'?1:-1;if(o&&!this.blocked(o.x+dx*s,o.z+dz*s)){o.x+=dx*s;o.z+=dz*s;}else reward=-5;}
 const held=this.items.find(o=>o.id===r.holding);if(held){held.x=r.x;held.z=r.z;}r.battery=Math.max(0,r.battery-.025);return reward;
 }
}
export class Perception {observe(e:Environment){const r=e.robot;return e.items.filter(o=>o.id!==r.holding&&Math.hypot(o.x-r.x,o.z-r.z)<4).map(o=>({...o,distance:Math.hypot(o.x-r.x,o.z-r.z),graspable:!!o.destination,container:o.kind==='container',dirty:!!o.destination&&!o.done,direction:Math.atan2(o.x-r.x,o.z-r.z)-r.heading*Math.PI/2}));}}
export class WorkingMemory {events:{action:Action;reward:number;step:number;state:string}[]=[];remember(action:Action,reward:number,step:number,state:string){this.events.unshift({action,reward,step,state});this.events=this.events.slice(0,12);}}
export class SpatialMemory {objects:Record<string,Item>={};remember(obs:Item[]){obs.forEach(o=>this.objects[o.id]={...o});}}
export class AssociativeMemory {q:Record<string,number[]>={};values(s:string){return this.q[s]??(this.q[s]=ACTIONS.map(()=>0));}update(s:string,a:number,r:number,next:string){const q=this.values(s);q[a]+=.22*(r+.94*Math.max(...this.values(next))-q[a]);}}
export class SkillMemory { learned:Record<string,Record<string,number>>={}; suggest(state:string){const row=this.learned[state];if(!row)return undefined;return Object.entries(row).sort((a,b)=>b[1]-a[1])[0]?.[0] as Action|undefined;} skills:Record<string,{actions:Action[];uses:number}>={};learn(events:WorkingMemory['events']){events.slice(0,6).filter(e=>e.reward>=-1).forEach(e=>{const row=this.learned[e.state]??(this.learned[e.state]={});row[e.action]=(row[e.action]??0)+1;});const seq=events.slice(0,6).reverse().map(e=>e.action);const name=seq.at(-1)==='grab'?'approach_and_grab':seq.at(-1)==='release'?'transport_and_release':'approach_and_close';const old=this.skills[name];this.skills[name]={actions:seq,uses:(old?.uses??0)+1};}}
export class Planner {target(memory:SpatialMemory,robot:Robot,goal:number){const all=Object.values(memory.objects);if(robot.holding){const item=memory.objects[robot.holding];return all.find(o=>o.id===(goal===6?'person':item?.destination));}const kind=['cup','trash','clothes','toy','drawer','cup','cup'][goal];return all.filter(o=>!o.done&&(goal===7?!!o.destination||o.open:o.kind===kind)&&(o.kind!=='drawer'||o.open)).sort((a,b)=>Math.hypot(a.x-robot.x,a.z-robot.z)-Math.hypot(b.x-robot.x,b.z-robot.z))[0];}}
export class Policy {epsilon=.95;choose(values:number[],skill?:Action){if(Math.random()<this.epsilon)return Math.floor(Math.random()*ACTIONS.length);const best=values.indexOf(Math.max(...values));return skill&&values[ACTIONS.indexOf(skill)]>=values[best]-.1?ACTIONS.indexOf(skill):best;}}
export class RewardSystem {calculate(raw:number,before:number,after:number){return raw+(Number.isFinite(before)&&Number.isFinite(after)?(before-after)*1.5:0);}}
export type Metric={episode:number;reward:number;success:number;steps:number;collisions:number;exploration:number;skills:number};
export class TrainingLoop {
 environment=new Environment();perception=new Perception();working=new WorkingMemory();spatial=new SpatialMemory();associations=new AssociativeMemory();skills=new SkillMemory();planner=new Planner();policy=new Policy();rewards=new RewardSystem();
 episode=1;step=0;total=0;goal=0;action:Action='look';reward=0;predicted=0;metrics:Metric[]=[];observation:ReturnType<Perception['observe']>=[];trail:{x:number;z:number}[]=[];finished=false;visited=new Set<string>();
 constructor(){this.observe();}
 observe(){this.observation=this.perception.observe(this.environment);this.spatial.remember(this.observation);}
 state(){const r=this.environment.robot,t=this.planner.target(this.spatial,r,this.goal);if(!t)return `${this.goal}:explore:${r.x}:${r.z}:${r.heading}`;const dx=t.x-r.x,dz=t.z-r.z;const forward=dx*[0,1,0,-1][r.heading]+dz*[1,0,-1,0][r.heading];const side=dx*[1,0,-1,0][r.heading]+dz*[0,-1,0,1][r.heading];return `${t.kind}:${r.holding?'carry':'seek'}:${Math.hypot(dx,dz)<=1.45?'near':'far'}:${Math.sign(forward)}:${Math.sign(side)}:${this.environment.blocked(r.x+[0,1,0,-1][r.heading],r.z+[1,0,-1,0][r.heading])}`;}
 tick(){if(this.finished)this.nextEpisode();this.observe();const r=this.environment.robot;const target=this.planner.target(this.spatial,r,this.goal);const before=target?Math.hypot(target.x-r.x,target.z-r.z):Infinity;const state=this.state(),values=this.associations.values(state),index=this.policy.choose(values,this.skills.suggest(state));this.predicted=values[index];this.action=ACTIONS[index];if(this.goal===6&&r.holding){const item=this.environment.items.find(o=>o.id===r.holding);if(item)item.destination='person';}
 const raw=this.environment.act(this.action);const cell=`${r.x},${r.z}`;const novelty=this.visited.has(cell)?0:1;this.visited.add(cell);this.observe();const after=target?Math.hypot(target.x-r.x,target.z-r.z):Infinity;this.reward=this.rewards.calculate(raw,before,after)+novelty;this.step++;
 const kinds=['cup','trash','clothes','toy'];const success=this.goal<4?this.environment.items.filter(o=>o.kind===kinds[this.goal]).every(o=>o.done):this.goal===4?!this.environment.items.find(o=>o.kind==='drawer')?.open:this.goal===5?this.observation.some(o=>o.kind==='cup'&&o.distance<1.5):this.goal===6?this.environment.items.some(o=>o.destination==='person'&&o.done):this.environment.items.filter(o=>o.destination).every(o=>o.done)&&!this.environment.items.find(o=>o.kind==='drawer')?.open;
 if(success)this.reward+=100;this.total+=this.reward;this.associations.update(state,index,this.reward,this.state());this.working.remember(this.action,this.reward,this.step,state);if(raw>=1)this.skills.learn(this.working.events);this.trail.push({x:r.x,z:r.z});this.trail=this.trail.slice(-80);
 if(success||this.step>=400||r.battery===0){this.metrics.push({episode:this.episode,reward:this.total,success:success?1:0,steps:this.step,collisions:this.environment.collisions,exploration:this.policy.epsilon,skills:Object.keys(this.skills.skills).length});this.finished=true;}
 }
 nextEpisode(){this.episode++;this.step=0;this.total=0;this.environment.reset();this.spatial=new SpatialMemory();this.trail=[];this.visited.clear();this.finished=false;this.policy.epsilon=Math.max(.07,.95*Math.exp(-this.episode/90));this.observe();}
 resetEnvironment(){this.environment.reset();this.spatial=new SpatialMemory();this.step=0;this.total=0;this.finished=false;this.trail=[];this.visited.clear();this.observe();}
}
