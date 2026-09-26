import RAPIER from '@dimforge/rapier3d-compat';
import * as T from 'three';
import {fixtures} from '../visualization/house-layout';
import {ACTIONS, type Action, type TrainingLoop, type Item} from './engine';

export type Part = {id:string;body:RAPIER.RigidBody;collider:RAPIER.Collider;shape:'box'|'capsule'|'wheel'|'ball';size:number[];finish:'shell'|'graphite'|'metal'|'rubber';hand?:'L'|'R';finger?:string};
export type Motor = {id:string;parent:RAPIER.RigidBody;body:RAPIER.RigidBody;joint:RAPIER.RevoluteImpulseJoint;axis:T.Vector3;target:number;command:number;velocity:number;angle:number;torque:number;limit:number;min:number;max:number;finger:boolean};
export type Contact = {part:string;object:string;force:number;point:{x:number;y:number;z:number}};
export type PhysicalEvent = {id:number;time:number;kind:'sense'|'action'|'reward'|'pain'|'skill';text:string;value?:number};
export type MotorPattern = {attempts:number;successes:number;force:number;offset:number};
const v=(x=0,y=0,z=0)=>({x,y,z});
const qIdentity={x:0,y:0,z:0,w:1};
const clamp=T.MathUtils.clamp;
const dt=1/120;
let initialization:Promise<void>|undefined;
export function initializePhysics(){return initialization??(initialization=RAPIER.init());}

/** Physical embodiment adapter. It reuses the existing brain; it never calls the
 * legacy instantaneous Environment.act or attaches a grasped object to a hand. */
export class PhysicalSession {
 world:RAPIER.World;
 parts:Part[]=[];motors:Motor[]=[];objects=new Map<string,RAPIER.RigidBody>();
 objectColliders=new Map<number,string>();robotColliders=new Map<number,Part>();
 base!:RAPIER.RigidBody;palms:{} & Record<'L'|'R',RAPIER.RigidBody>={} as Record<'L'|'R',RAPIER.RigidBody>;
 contacts:Contact[]=[];events:PhysicalEvent[]=[];patterns:Record<string,MotorPattern>={};
 running=false;manualActive=false;speed=1;time=0;phase='Standby';gripForce=0;slip=0;armLoad=0;pain=0;currentSkill='Untrained motor exploration';
 batchRemaining=0;completed=0;revision=0;rewardTrace:number[]=[];painTrace:number[]=[];
 action:Action='look';busy=false;elapsed=0;targetId:string|null=null;holding:string|null=null;contactTime=0;grip=0;selectedHand:'L'|'R'='L';twoHands=false;
 private counter=0;private accumulator=0;private actionState='';private actionIndex=0;private predicted=0;private beforeDistance=Infinity;private startCollisions=0;
 private baseTarget=new T.Vector3(1,.32,1);private headingTarget=0;private initialObjectHeight=0;private lastHeight=0;private failures=0;private hasLifted=false;
 private remembered=new Set<string>();private disposed=false;private resetPending=false;private collisionCooldown=0;
 private activePattern:MotorPattern|null=null;private motorChoice='';private motorTrial=0;private actionTimeout=1.4;
 private armGoals:Record<'L'|'R',T.Vector3>={L:new T.Vector3(),R:new T.Vector3()};
 constructor(public brain:TrainingLoop){this.world=new RAPIER.World(v(0,-9.81,0));this.build();}
 private body(id:string,p:{x:number;y:number;z:number},size:number[],mass:number,shape:Part['shape']='box',finish:Part['finish']='shell',hand?:'L'|'R',finger?:string){
  const body=this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x,p.y,p.z).setLinearDamping(.25).setAngularDamping(.5).setCcdEnabled(true).setCanSleep(false));
  const desc=shape==='capsule'?RAPIER.ColliderDesc.capsule(size[1]/2,size[0]):shape==='ball'?RAPIER.ColliderDesc.ball(size[0]):shape==='wheel'?RAPIER.ColliderDesc.cylinder(size[1]/2,size[0]).setRotation(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,0,1),Math.PI/2)):RAPIER.ColliderDesc.cuboid(size[0]/2,size[1]/2,size[2]/2);
  const collider=this.world.createCollider(desc.setMass(mass).setFriction(finger?1.5:shape==='wheel'?1.1:.6).setRestitution(0).setCollisionGroups(0x00010006),body);
  const part={id,body,collider,shape,size,finish,hand,finger};this.parts.push(part);this.robotColliders.set(collider.handle,part);return body;
 }
 private fixed(parent:RAPIER.RigidBody,child:RAPIER.RigidBody,anchor1:{x:number;y:number;z:number},anchor2=v()){
  const joint=this.world.createImpulseJoint(RAPIER.JointData.fixed(anchor1,qIdentity,anchor2,qIdentity),parent,child,true);joint.setContactsEnabled(false);
 }
 private hinge(id:string,parent:RAPIER.RigidBody,child:RAPIER.RigidBody,a:{x:number;y:number;z:number},b:{x:number;y:number;z:number},axis:T.Vector3,min:number,max:number,limit:number,finger=false){
  const joint=this.world.createImpulseJoint(RAPIER.JointData.revolute(a,b,axis),parent,child,true) as RAPIER.RevoluteImpulseJoint;
  joint.setContactsEnabled(false);joint.setLimits(min,max);
  const motor={id,parent,body:child,joint,axis,target:0,command:0,velocity:0,angle:0,torque:0,limit,min,max,finger};this.motors.push(motor);return motor;
 }
 private build(){
  this.world.timestep=dt;this.world.numSolverIterations=12;
  fixtures.forEach(f=>{this.world.createCollider(RAPIER.ColliderDesc.cuboid(f.size[0]/2,f.size[1]/2,f.size[2]/2).setTranslation(...f.position).setFriction(.7).setCollisionGroups(0x00020005));});
  // Invisible perimeter matches the old environment bounds.
  for(const [x,z,w,d] of [[-.65,5,.1,11.5],[10.65,5,.1,11.5],[5,-.65,11.5,.1],[5,10.65,11.5,.1]])this.world.createCollider(RAPIER.ColliderDesc.cuboid(w/2,1.4,d/2).setTranslation(x,1.4,z).setCollisionGroups(0x00020005));
  this.base=this.body('chassis',v(1,.32,1),[.63,.32,.64],24,'box','graphite');
  const torso=this.body('torso',v(1,1.03,1),[.47,.56,.29],7,'box','shell');this.fixed(this.base,torso,v(0,.71,0));
  const spine=this.body('spine',v(1,.62,1),[.21,.32,.2],2,'box','metal');this.fixed(this.base,spine,v(0,.3,0));
  const head=this.body('head',v(1,1.65,1),[.32,.32,.25],1.4,'box','shell');this.fixed(torso,head,v(0,.62,0));
  for(const side of [-1,1])for(const z of [-.22,.22]){
   const wheel=this.body(`wheel-${side}-${z}`,v(1+side*.34,.2,1+z),[.2,.09,.2],.7,'wheel','rubber');
   const j=this.world.createImpulseJoint(RAPIER.JointData.revolute(v(side*.34,-.12,z),v(),v(1,0,0)),this.base,wheel,true);j.setContactsEnabled(false);
  }
  for(const hand of ['L','R'] as const){
   const sign=hand==='L'?-1:1,x=1+sign*.33;
   const yaw=this.body(`${hand}-shoulder-yaw`,v(x,1.38,1),[.055],.25,'ball','metal');
   this.hinge(`${hand}/shoulder yaw`,torso,yaw,v(sign*.33,.35,0),v(),new T.Vector3(0,1,0),-1.6,1.6,35);
   const upper=this.body(`${hand}-upper-arm`,v(x,1.18,1),[.069,.27],1.1,'capsule','shell');
   this.hinge(`${hand}/shoulder pitch`,yaw,upper,v(),v(0,.2,0),new T.Vector3(1,0,0),-1.8,2.6,55);
   const forearm=this.body(`${hand}-forearm`,v(x,.79,1),[.056,.26],.8,'capsule','shell');
   this.hinge(`${hand}/elbow`,upper,forearm,v(0,-.2,0),v(0,.19,0),new T.Vector3(1,0,0),-2.5,.1,32);
   const wrist=this.body(`${hand}-wrist`,v(x,.57,1),[.045],.15,'ball','metal');
   this.hinge(`${hand}/wrist roll`,forearm,wrist,v(0,-.22,0),v(),new T.Vector3(0,1,0),-1.5,1.5,8);
   const palm=this.body(`${hand}-palm`,v(x,.47,1),[.19,.18,.065],.25,'box','graphite',hand);this.palms[hand]=palm;
   this.hinge(`${hand}/wrist pitch`,wrist,palm,v(),v(0,.1,0),new T.Vector3(1,0,0),-1.6,1.6,8);
   const fingers=['index','middle','ring','little','thumb'];
   fingers.forEach((name,index)=>{
    const thumb=index===4;const fx=thumb?sign*.125:(index-1.5)*.048;
    const lengths=thumb?[.063,.055,.046]:[.065,.052,.043].map(n=>n*(index===3?.85:1));
    let parent=palm,y=.38;let previousLength=0;
    lengths.forEach((length,j)=>{
     const body=this.body(`${hand}-${name}-${j}`,v(x+fx,y-length/2,1),[.018,length-.02],.022,'capsule',j===2?'rubber':'metal',hand,name);
     this.hinge(`${hand}/${name}/${j}`,parent,body,j===0?v(fx,-.09,0):v(0,-previousLength/2,0),v(0,length/2,0),new T.Vector3(thumb?0:1,0,thumb?sign:0),thumb?-1.4:-1.65,.15,.38,true);
     parent=body;y-=length;previousLength=length;
    });
   });
  }
  this.brain.environment.items.forEach(o=>this.makeObject(o));
  this.baseTarget.set(1,.32,1);this.headingTarget=0;this.restArms();
  // Settle gravity with the same torque controllers used during execution.
  for(let i=0;i<30;i++){this.control();this.world.step();}
  this.sync();this.log('sense','Physical embodiment initialized');
 }
 private makeObject(item:Item){
  if(item.kind==='person'){this.world.createCollider(RAPIER.ColliderDesc.capsule(.5,.22).setTranslation(item.x,.75,item.z).setCollisionGroups(0x00020005));return;}
  if(item.id==='sink'){
   const fixed=this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(item.x,.68,item.z));
   [[0,0,0,.9,.08,.8],[-.43,.14,0,.04,.3,.8],[.43,.14,0,.04,.3,.8],[0,.14,.38,.9,.3,.04],[0,.14,-.38,.9,.3,.04]].forEach(a=>this.world.createCollider(RAPIER.ColliderDesc.cuboid(a[3]/2,a[4]/2,a[5]/2).setTranslation(a[0],a[1],a[2]).setCollisionGroups(0x00020005),fixed));this.objects.set(item.id,fixed);return;
  }
  if(item.kind==='container'){
   const body=this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(item.x,.04,item.z));
   [[0,0,0,.62,.06,.62],[-.3,.24,0,.04,.5,.62],[.3,.24,0,.04,.5,.62],[0,.24,.3,.62,.5,.04],[0,.24,-.3,.62,.5,.04]].forEach(a=>this.world.createCollider(RAPIER.ColliderDesc.cuboid(a[3]/2,a[4]/2,a[5]/2).setTranslation(a[0],a[1],a[2]).setCollisionGroups(0x00020005).setFriction(.7),body));this.objects.set(item.id,body);return;
  }
  if(item.kind==='drawer'){
   const cabinet=this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(item.x,.6,item.z));
   this.world.createCollider(RAPIER.ColliderDesc.cuboid(.45,.12,.35).setTranslation(0,-.42,0).setCollisionGroups(0x00020005),cabinet);
   const body=this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(item.x,.6,item.z+.32).setLinearDamping(3));
   const c=this.world.createCollider(RAPIER.ColliderDesc.cuboid(.36,.12,.28).setMass(1.2).setCollisionGroups(0x00040007).setFriction(.5),body);
   const joint=this.world.createImpulseJoint(RAPIER.JointData.prismatic(v(),v(),v(0,0,1)),cabinet,body,true) as RAPIER.PrismaticImpulseJoint;joint.setLimits(0,.4);joint.setContactsEnabled(false);
   this.objects.set(item.id,body);this.objectColliders.set(c.handle,item.id);return;
  }
  const height=item.kind==='cup'?.91:.15;
  const body=this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(item.x,height,item.z).setCcdEnabled(true).setLinearDamping(.1).setAngularDamping(.2));
  if(item.kind==='cup'){
   // Hollow cup: base and 12 convex wall panels permit genuine finger contact.
   const base=this.world.createCollider(RAPIER.ColliderDesc.cylinder(.012,.092).setTranslation(0,-.105,0).setMass(.08).setFriction(.85).setCollisionGroups(0x00040007),body);this.objectColliders.set(base.handle,item.id);
   for(let i=0;i<12;i++){const a=i*Math.PI/6;const c=this.world.createCollider(RAPIER.ColliderDesc.cuboid(.027,.108,.008).setTranslation(Math.sin(a)*.092,0,Math.cos(a)*.092).setRotation(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),a)).setMass(.012).setFriction(.9).setCollisionGroups(0x00040007),body);this.objectColliders.set(c.handle,item.id);}
  }else{
   const shape=item.kind==='trash'?RAPIER.ColliderDesc.cylinder(.13,.065):item.kind==='clothes'?RAPIER.ColliderDesc.cuboid(.18,.025,.14):RAPIER.ColliderDesc.cuboid(.12,.12,.12);
   const c=this.world.createCollider(shape.setMass(item.kind==='clothes'?.18:.25).setFriction(item.kind==='clothes'?1.1:.75).setCollisionGroups(0x00040007),body);this.objectColliders.set(c.handle,item.id);
  }
  this.objects.set(item.id,body);
 }
 log(kind:PhysicalEvent['kind'],text:string,value?:number){this.events.unshift({id:++this.counter,time:this.time,kind,text,value});this.events=this.events.slice(0,80);}
 private motor(id:string,target:number){const m=this.motors.find(x=>x.id===id);if(m)m.target=clamp(target,m.min,m.max);}
 private restArms(){for(const h of ['L','R'] as const){const p=this.base.translation();const local=new T.Vector3(h==='L'?-.33:.33,.48,.2).applyQuaternion(new T.Quaternion().copy(this.base.rotation()));this.armGoals[h].set(p.x+local.x,p.y+local.y,p.z+local.z);}}
 private reach(hand:'L'|'R',goal:T.Vector3){
  const base=this.base.translation(),q=new T.Quaternion().copy(this.base.rotation());
  const shoulder=new T.Vector3(hand==='L'?-.33:.33,1.06,0).applyQuaternion(q).add(new T.Vector3(base.x,base.y,base.z));
  const direction=goal.clone().sub(shoulder).applyQuaternion(q.invert());
  // Two-link analytic IK produces targets; torque-limited joints execute them.
  const yaw=clamp(Math.atan2(direction.x,Math.max(.02,direction.z)),-1.55,1.55);
  const horizontal=Math.hypot(direction.x,direction.z),down=-direction.y-.16;
  const distance=clamp(Math.hypot(horizontal,down),.08,.77),a=.4,b=.38;
  const elbow=-Math.acos(clamp((distance*distance-a*a-b*b)/(2*a*b),-1,1));
  const shoulderAngle=Math.atan2(horizontal,down)-Math.atan2(b*Math.sin(elbow),a+b*Math.cos(elbow));
  this.motor(`${hand}/shoulder yaw`,yaw);this.motor(`${hand}/shoulder pitch`,shoulderAngle);this.motor(`${hand}/elbow`,elbow);
  this.motor(`${hand}/wrist pitch`,-(shoulderAngle+elbow)*.7);this.motor(`${hand}/wrist roll`,0);
 }
 private control(){
  this.base.resetForces(true);this.base.resetTorques(true);
  const p=this.base.translation(),vel=this.base.linvel();
  const force=new T.Vector3((this.baseTarget.x-p.x)*90-vel.x*65,0,(this.baseTarget.z-p.z)*90-vel.z*65).clampLength(0,85);
  this.base.addForce(force,true);
  const q=new T.Quaternion().copy(this.base.rotation()),euler=new T.Euler().setFromQuaternion(q,'YXZ'),angular=this.base.angvel();
  const yawError=Math.atan2(Math.sin(this.headingTarget-euler.y),Math.cos(this.headingTarget-euler.y));
  this.base.addTorque(v(clamp(-euler.x*260-angular.x*55,-140,140),clamp(yawError*65-angular.y*30,-45,45),clamp(-euler.z*260-angular.z*55,-140,140)),true);
  for(const h of ['L','R'] as const)this.reach(h,this.armGoals[h]);
  for(const motor of this.motors){
   if(motor.finger){const use=motor.id.startsWith(this.selectedHand)||this.twoHands;const digit=motor.id.split('/')[1];const variant=this.motorChoice.includes('pinch')&&['ring','little'].includes(digit)?.15:1;motor.target=use?-this.grip*(digit==='thumb'?.95:1.3)*variant:0;}
   // Jerk-free target velocity ramp, angular speed limit and explicit PD torque cap.
   const desired=clamp((motor.target-motor.command)*6,-1.8,1.8);motor.velocity+=clamp(desired-motor.velocity,-6*dt,6*dt);motor.command=clamp(motor.command+motor.velocity*dt,motor.min,motor.max);
   const parentQ=new T.Quaternion().copy(motor.parent.rotation()),relative=parentQ.clone().invert().multiply(new T.Quaternion().copy(motor.body.rotation()));
   let angle=2*Math.atan2(relative.x*motor.axis.x+relative.y*motor.axis.y+relative.z*motor.axis.z,relative.w);angle=Math.atan2(Math.sin(angle),Math.cos(angle));motor.angle=angle;
   const axis=motor.axis.clone().applyQuaternion(parentQ),av=motor.body.angvel(),pv=motor.parent.angvel();
   const omega=(av.x-pv.x)*axis.x+(av.y-pv.y)*axis.y+(av.z-pv.z)*axis.z;
   const cap=motor.finger?motor.limit*(this.activePattern?.force??1):motor.limit;
   motor.torque=clamp((motor.command-angle)*(motor.finger?1.6:65)-omega*(motor.finger?.07:7),-cap,cap);
   const impulse=axis.multiplyScalar(motor.torque*dt);motor.body.applyTorqueImpulse(impulse,true);motor.parent.applyTorqueImpulse(impulse.multiplyScalar(-1),true);
  }
 }
 private sense(){
  this.contacts=[];this.gripForce=0;let worldImpact=0;
  for(const part of this.parts){this.world.contactPairsWith(part.collider,other=>{
   const id=this.objectColliders.get(other.handle);
   this.world.contactPair(part.collider,other,manifold=>{let force=0;for(let i=0;i<manifold.numContacts();i++)force+=manifold.contactImpulse(i)/dt;
    if(part.hand&&id&&force>.005){this.contacts.push({part:part.id,object:id,force,point:part.body.translation()});this.gripForce+=force;}
    if(!id&&part.id==='chassis')worldImpact=Math.max(worldImpact,force);
   });
  });}
  this.armLoad=this.motors.filter(m=>!m.finger).reduce((s,m)=>s+Math.abs(m.torque),0);
  this.collisionCooldown-=dt;
  if(worldImpact>35&&this.collisionCooldown<=0){this.brain.environment.collisions++;this.collisionCooldown=.5;this.log('pain','Chassis contact',Math.min(1,worldImpact/150));}
  if(this.holding){const object=this.objects.get(this.holding);if(object){const o=object.translation();const contact=this.contacts.filter(c=>c.object===this.holding);this.slip=Math.max(0,(this.lastHeight-o.y)/dt);this.lastHeight=o.y;
   if(contact.length===0&&this.slip>.12){this.failures++;if(this.failures>20){this.log('pain','Object slipped from fingers',.6);this.holding=null;this.brain.environment.robot.holding=null;this.hasLifted=false;}}else this.failures=0;
  }}else this.slip=0;
 }
 private sync(){
  const p=this.base.translation();this.brain.environment.robot.x=p.x;this.brain.environment.robot.z=p.z;
  this.brain.environment.robot.holding=this.holding;
  this.brain.environment.items.forEach(o=>{const b=this.objects.get(o.id);if(b&&o.kind!=='container'){const p=b.translation();o.x=p.x;o.z=p.z;if(o.kind==='drawer')o.open=p.z>8.09;}});
  this.brain.observe();
 }
 begin(action?:Action){
  if(this.busy)return;this.sync();const brain=this.brain;
  if(brain.finished){this.reset(true);return;}
  this.actionState=brain.state();const values=brain.associations.values(this.actionState);this.actionIndex=action?ACTIONS.indexOf(action):brain.policy.choose(values,brain.skills.suggest(this.actionState));
  this.action=ACTIONS[this.actionIndex];brain.action=this.action;this.predicted=values[this.actionIndex];brain.predicted=this.predicted;
  this.elapsed=0;this.busy=true;this.contactTime=0;this.startCollisions=brain.environment.collisions;this.targetId=null;
  const r=brain.environment.robot;const planned=brain.planner.target(brain.spatial,r,brain.goal);
  this.beforeDistance=planned?Math.hypot(planned.x-r.x,planned.z-r.z):Infinity;
  const p=this.base.translation();this.baseTarget.set(p.x,.32,p.z);this.headingTarget=r.heading*Math.PI/2;
  this.actionTimeout=['grab','open','close','push','pull'].includes(this.action)?4.2:this.action==='release'?2.5:1.5;
  if(this.action==='move_forward'||this.action==='move_backward'){
   const s=this.action==='move_forward'?1:-1;this.baseTarget.x+=Math.sin(this.headingTarget)*.65*s;this.baseTarget.z+=Math.cos(this.headingTarget)*.65*s;
  }else if(this.action==='turn_left'||this.action==='turn_right'){
   r.heading=(r.heading+(this.action==='turn_right'?1:3))%4;this.headingTarget=r.heading*Math.PI/2;
  }else if(['grab','push','pull','open','close'].includes(this.action)){
   const near=brain.observation.filter(o=>this.objects.get(o.id)?.isDynamic()&&!o.done&&o.id!==this.holding).sort((a,b)=>a.distance-b.distance);
   const item=near.find(o=>['open','close'].includes(this.action)?o.kind==='drawer':o.kind!=='drawer');
   if(item&&item.distance<1.5){this.targetId=item.id;const o=this.objects.get(item.id)!.translation();this.initialObjectHeight=o.y;this.lastHeight=o.y;
    const local=new T.Vector3(o.x-p.x,0,o.z-p.z).applyAxisAngle(new T.Vector3(0,1,0),-this.headingTarget);this.selectedHand=local.x<0?'L':'R';
    this.twoHands=item.kind==='clothes';const grasp=item.kind==='cup'?'precision_grasp':item.kind==='clothes'?'two_hand_carry':item.kind==='trash'?'power_grasp':'pinch_grasp';
    const candidates=[0,1,2].map(i=>`${grasp}:${i}`);this.motorChoice=candidates[Math.random()<brain.policy.epsilon?Math.floor(Math.random()*3):candidates.map(k=>this.patterns[k]).map(x=>x?x.successes/Math.max(1,x.attempts):0).indexOf(Math.max(...candidates.map(k=>this.patterns[k]?this.patterns[k].successes/Math.max(1,this.patterns[k].attempts):0)))];
    this.motorTrial=+this.motorChoice.split(':')[1];this.activePattern=this.patterns[this.motorChoice]??(this.patterns[this.motorChoice]={attempts:0,successes:0,force:[.45,.9,1.4][this.motorTrial],offset:[-.035,0,.035][this.motorTrial]});this.currentSkill=`${grasp} · trial ${this.activePattern.attempts+1}`;
    this.grip=0;this.hasLifted=false;
   }
  }
  this.phase=this.action.replaceAll('_',' ');this.log('action',this.phase.charAt(0).toUpperCase()+this.phase.slice(1));
 }
 private animateIntent(){
  const p=this.base.translation();
  if(this.holding&&!this.targetId){for(const hand of ['L','R'] as const){if(hand===this.selectedHand||this.twoHands){const local=new T.Vector3(hand==='L'?-.24:.24,.7,.43).applyAxisAngle(new T.Vector3(0,1,0),this.headingTarget);this.armGoals[hand].set(p.x+local.x,p.y+local.y,p.z+local.z);}}}
  else if(!this.targetId&&!this.holding)this.restArms();
  if(!this.busy)return;
  if(this.action==='release'){
   this.phase='Opening fingers';this.grip=Math.max(0,this.grip-dt*1.7);if(this.elapsed>.5){this.holding=null;this.brain.environment.robot.holding=null;}return;
  }
  if(this.targetId){const body=this.objects.get(this.targetId);if(!body)return;const o=body.translation();
   if(this.action==='grab'){
    const lift=this.elapsed>2.5;this.phase=this.elapsed<1?'Reaching · fingers open':this.elapsed<2.5?'Closing fingers · sensing contact':'Testing lift · grip maintained';
    this.grip=this.elapsed<1?0:Math.min(1,(this.elapsed-1)/1.1);
    const offset=this.activePattern?.offset??0;
    const target=new T.Vector3(o.x+offset,lift?this.initialObjectHeight+.4:o.y+.18,o.z-.06);
    if(lift&&this.contacts.some(c=>c.object===this.targetId)){this.contactTime+=dt;}
    this.armGoals[this.selectedHand].lerp(target,1-Math.exp(-dt*5));
    if(this.twoHands){const other=this.selectedHand==='L'?'R':'L';this.armGoals[other].lerp(target.clone().add(new T.Vector3(.25,0,0)),1-Math.exp(-dt*5));}
    const digitContacts=new Set(this.contacts.filter(c=>c.object===this.targetId).map(c=>c.part.split('-')[1]));
    if(lift&&o.y>this.initialObjectHeight+.09&&digitContacts.size>=2){this.holding=this.targetId;this.hasLifted=true;this.lastHeight=o.y;}
   }else{
    const direction=(this.action==='pull'||this.action==='open')?1:-1;this.grip=this.action==='pull'||this.action==='open'?.75:0;
    this.phase='Contact manipulation';this.armGoals[this.selectedHand].lerp(new T.Vector3(o.x,o.y+.08,o.z+direction*Math.min(.4,this.elapsed*.1)),1-Math.exp(-dt*4));
   }
  }
 }
 private finish(){
  const brain=this.brain;this.sync();let raw=-.1;
  if(this.action==='move_forward'||this.action==='move_backward')raw=-1;
  if(brain.environment.collisions>this.startCollisions)raw=-5;
  if(this.action==='grab'){
   raw=this.hasLifted&&this.holding?1:-5;
   if(this.activePattern){this.activePattern.attempts++;if(raw>0){this.activePattern.successes++;this.log('skill',`${this.motorChoice.split(':')[0]} learned from supported lift`);}}
   this.log(raw>0?'reward':'pain',raw>0?'Grasp supported by finger contact':'Grasp failed · no supported lift',raw>0?1:.25);
   if(raw<0){this.holding=null;this.grip=0;}
  }
  if(this.action==='release'){
   raw=-1;brain.environment.items.filter(o=>o.destination&&!o.done).forEach(o=>{
    const object=this.objects.get(o.id),dest=this.objects.get(brain.goal===6?'person':o.destination!);const person=brain.environment.items.find(i=>i.id==='person');
    const position=object?.translation(),destination=dest?.translation()??(brain.goal===6&&person?{x:person.x,y:0,z:person.z}:null);
    if(position&&destination&&Math.hypot(position.x-destination.x,position.z-destination.z)<.35&&position.y<1.15&&Math.hypot(...Object.values(object!.linvel()))<.8){o.done=true;raw=10;this.log('reward',`${o.id} placed at ${o.destination}`,10);}
   });
  }
  if(['open','close','push','pull'].includes(this.action)){const item=brain.environment.items.find(i=>i.id===this.targetId);raw=item?(this.action==='close'&&!item.open?10:this.action==='open'&&item.open?1:this.contacts.some(c=>c.object===item.id)?1:-5):-5;}
  const target=brain.planner.target(brain.spatial,brain.environment.robot,brain.goal),r=brain.environment.robot;
  const after=target?Math.hypot(target.x-r.x,target.z-r.z):Infinity;
  brain.reward=brain.rewards.calculate(raw,this.beforeDistance,after);
  const kinds=['cup','trash','clothes','toy'];
  const success=brain.goal<4?brain.environment.items.filter(o=>o.kind===kinds[brain.goal]).every(o=>o.done):brain.goal===4?!brain.environment.items.find(o=>o.kind==='drawer')?.open:brain.goal===5?brain.observation.some(o=>o.kind==='cup'&&o.distance<1.5):brain.goal===6?brain.environment.items.some(o=>o.destination&&o.done):brain.environment.items.filter(o=>o.destination).every(o=>o.done)&&!brain.environment.items.find(o=>o.kind==='drawer')?.open;
  if(success)brain.reward+=100;
  brain.total+=brain.reward;brain.step++;brain.environment.robot.battery=Math.max(0,r.battery-.025);
  const proprio=`${this.actionState}:contact=${this.contacts.length>0}:slip=${this.slip>.1}:load=${Math.round(this.armLoad/25)}`;
  brain.associations.update(this.actionState,this.actionIndex,brain.reward,brain.state());
  brain.associations.update(proprio,this.actionIndex,raw,brain.state());
  brain.working.remember(this.action,brain.reward,brain.step,this.actionState);if(raw>=1)brain.skills.learn(brain.working.events);
  brain.trail.push({x:r.x,z:r.z});brain.trail=brain.trail.slice(-80);
  this.pain=clamp(Math.max(0,-raw)/20,0,1);this.rewardTrace.push(brain.reward);this.painTrace.push(this.pain);this.rewardTrace=this.rewardTrace.slice(-120);this.painTrace=this.painTrace.slice(-120);
  if(brain.reward>0)this.log('reward','Reward feedback',brain.reward);else if(raw<=-5)this.log('pain','Aversive feedback',this.pain);
  brain.observation.forEach(o=>{if(!this.remembered.has(o.id)){this.remembered.add(o.id);this.log('sense',`Detected ${o.id}`);}});
  if(success||brain.step>=400||r.battery===0){brain.metrics.push({episode:brain.episode,reward:brain.total,success:success?1:0,steps:brain.step,collisions:brain.environment.collisions,exploration:brain.policy.epsilon,skills:Object.values(this.patterns).filter(p=>p.successes>0).length});brain.finished=true;this.completed++;if(this.batchRemaining>0&&--this.batchRemaining===0)this.running=false;}
  this.busy=false;this.manualActive=false;this.targetId=null;this.revision++;
 }
 advance(seconds:number){
  if(this.disposed)return;this.accumulator+=Math.min(seconds,.05)*(this.running?this.speed:1);
  // Budget fixed substeps, never increase the solver timestep for acceleration.
  let budget=0;while(this.accumulator>=dt&&budget++<160){this.accumulator-=dt;
   if(this.running&&!this.busy)this.begin();
   if(this.running||this.manualActive){this.elapsed+=dt;this.time+=dt;this.animateIntent();this.control();this.world.step();this.sense();if(this.busy&&this.elapsed>=this.actionTimeout)this.finish();}
  }
  this.accumulator=Math.min(this.accumulator,.25);this.sync();
 }
 manual(action:Action){if(!this.busy){this.running=false;this.manualActive=true;this.begin(action);}}
 reset(nextEpisode=false){
  const wasRunning=this.running;this.busy=false;this.world.free();this.world=new RAPIER.World(v(0,-9.81,0));this.parts=[];this.motors=[];this.objects.clear();this.objectColliders.clear();this.robotColliders.clear();this.contacts=[];this.holding=null;this.targetId=null;this.grip=0;this.slip=0;this.hasLifted=false;this.activePattern=null;this.accumulator=0;this.remembered.clear();
  if(nextEpisode)this.brain.nextEpisode();else this.brain.resetEnvironment();this.build();this.running=wasRunning;this.revision++;
 }
 dispose(){this.disposed=true;this.world.free();}
}
