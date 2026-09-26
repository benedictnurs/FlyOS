import {PHYSICAL_SCALE} from './scale';
// SI units. Reduced rigid-body quadcopter model: collective thrust, attitude
// dynamics, motor lag, gravity, quadratic aerodynamic drag and wind.
export class FlightDynamics {
 mass:number=PHYSICAL_SCALE.droneMass; gravity=9.81; maxThrust:number=PHYSICAL_SCALE.maxThrust; motorTimeConstant=.08;
 vx=0;vy=0;vz=0;roll=0;pitch=0;yaw=0;rollRate=0;pitchRate=0;yawRate=0;
 thrust=this.mass*this.gravity; wind=2; windX=0;windZ=0;acceleration=0;
 private clamp(v:number,lo:number,hi:number){return Math.max(lo,Math.min(hi,v));}
 step(body:{x:number;y:number;z:number;heading:number;speed:number},goal:{x:number;z:number},altitude:number,speedLimit:number,time:number,dt:number,landed=false,surfaceHeight=0,targetVelocity={x:0,z:0},groundHeight=0){
  if(landed){this.thrust=0;this.vx=this.vy=this.vz=0;body.speed=0;body.y=surfaceHeight;return;}
  const clamp=this.clamp;
  this.windX=this.wind*(.7+Math.sin(time*.37)*.3);this.windZ=this.wind*Math.sin(time*.23)*.5;
  const dx=goal.x-body.x,dz=goal.z-body.z,dist=Math.hypot(dx,dz);
  // Stopping-distance envelope reduces overshoot; acceleration is bounded by tilt.
  const takeoffFactor=altitude>1?clamp((body.y-.5)/2,0,1):1;
  const desiredSpeed=Math.min(speedLimit,dist*1.2,Math.sqrt(2*2.8*dist))*takeoffFactor;
  const desiredX=(dist>.01?dx/dist*desiredSpeed:0)+targetVelocity.x,desiredZ=(dist>.01?dz/dist*desiredSpeed:0)+targetVelocity.z;
  const dragX=-.018*(this.vx-this.windX)*Math.abs(this.vx-this.windX),dragZ=-.018*(this.vz-this.windZ)*Math.abs(this.vz-this.windZ);
  const ax=clamp((desiredX-this.vx)*2-dragX/this.mass,-5,5),az=clamp((desiredZ-this.vz)*2-dragZ/this.mass,-5,5);
  const desiredYaw=dist>1?Math.atan2(dx,dz):this.yaw;
  const yawError=Math.atan2(Math.sin(desiredYaw-this.yaw),Math.cos(desiredYaw-this.yaw));
  this.yawRate+=clamp(yawError*8-this.yawRate*5,-8,8)*dt;this.yaw+=this.yawRate*dt;
  // Body +Z points forward; local +Y is the collective thrust axis.
  const lateral=ax*Math.cos(this.yaw)-az*Math.sin(this.yaw),forward=ax*Math.sin(this.yaw)+az*Math.cos(this.yaw);
  const targetRoll=clamp(-Math.atan2(lateral,this.gravity),-.48,.48),targetPitch=clamp(Math.atan2(forward,this.gravity),-.48,.48);
  this.rollRate+=clamp((targetRoll-this.roll)*32-this.rollRate*9,-12,12)*dt;
  this.pitchRate+=clamp((targetPitch-this.pitch)*32-this.pitchRate*9,-12,12)*dt;
  this.roll+=this.rollRate*dt;this.pitch+=this.pitchRate*dt;
  const climbRate=clamp((altitude-body.y)*1.5,-1.5,2.5),verticalAccel=clamp((climbRate-this.vy)*4,-4,5);
  const verticalFactor=Math.cos(this.roll)*Math.cos(this.pitch);
  const command=clamp(this.mass*(this.gravity+verticalAccel)/Math.max(.5,verticalFactor),0,this.maxThrust);
  this.thrust+=(command-this.thrust)*(1-Math.exp(-dt/this.motorTimeConstant));
  const localX=-Math.sin(this.roll),localZ=Math.sin(this.pitch)*Math.cos(this.roll);
  const fx=(localX*Math.cos(this.yaw)+localZ*Math.sin(this.yaw))*this.thrust+dragX;
  const fz=(-localX*Math.sin(this.yaw)+localZ*Math.cos(this.yaw))*this.thrust+dragZ;
  const fy=verticalFactor*this.thrust-this.mass*this.gravity-.03*this.vy*Math.abs(this.vy);
  this.acceleration=Math.hypot(fx,fy,fz)/this.mass;
  this.vx+=fx/this.mass*dt;this.vz+=fz/this.mass*dt;this.vy+=fy/this.mass*dt;
  body.x+=this.vx*dt;body.z+=this.vz*dt;body.y+=this.vy*dt;
  if(body.y<groundHeight){body.y=groundHeight;this.vy=Math.max(0,this.vy);}
  body.speed=Math.hypot(this.vx,this.vz);body.heading=this.yaw;
 }
}
