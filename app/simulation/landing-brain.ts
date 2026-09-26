export type LandingCommand={vx:number;vz:number;vy:number};
export type LandingDecision={features:number[];mean:number[];action:number[];hidden:number[];value:number;command:LandingCommand};
const clamp=(value:number,low:number,high:number)=>Math.max(low,Math.min(high,value));

/** Shared continuous actor/critic. Outputs requested velocities, not coordinates.
 * Basic alignment weights initialize the policy; reward updates every layer.
 */
export class LandingBrain {
 readonly inputs=12;readonly hiddenSize=16;
 weights:number[][]=Array.from({length:16},(_,j)=>Array.from({length:12},(_,i)=>i===j?1:0));
 biases=Array(16).fill(0) as number[];
 actor=Array.from({length:3},()=>Array(16).fill(0) as number[]);
 actorBias=Array(3).fill(0) as number[];
 critic=Array(16).fill(0) as number[];criticBias=0;
 updates=0;successes=0;failures=0;loss=0;reward=0;
 contributors=new Set<number>();private randomState=719;
 constructor(){
  this.actor[0][0]=2;this.actor[0][6]=1.3;this.actor[0][3]=-.12;
  this.actor[1][1]=2;this.actor[1][7]=1.3;this.actor[1][4]=-.12;
  this.actorBias[2]=-.08;
  this.actor[2][2]=2.2;this.actor[2][8]=2.2;this.actor[2][5]=-.25;
 }
 private predict(features:number[]){
  const hidden=this.weights.map((row,j)=>Math.tanh(row.reduce((sum,w,i)=>sum+w*(features[i]??0),this.biases[j])));
  return {hidden,mean:this.actor.map((row,j)=>Math.tanh(row.reduce((sum,w,i)=>sum+w*hidden[i],this.actorBias[j]))),value:hidden.reduce((sum,h,i)=>sum+h*this.critic[i],this.criticBias)};
 }
 get exploration(){return Math.max(.015,.035/Math.sqrt(1+this.updates/500));}
 private random(){this.randomState=(Math.imul(this.randomState,1664525)+1013904223)>>>0;return (this.randomState+.5)/4294967296;}
 decide(features:number[],explore=true):LandingDecision{
  const {hidden,mean,value}=this.predict(features),sigma=explore?this.exploration:0;
  const action=mean.map(m=>clamp(m+Math.sqrt(-2*Math.log(this.random()))*Math.cos(2*Math.PI*this.random())*sigma,-1,1));
  return {features:[...features],hidden,mean,action,value,command:{vx:action[0]*6,vz:action[1]*6,vy:action[2]*2.5}};
 }
 learn(decision:LandingDecision,reward:number,nextFeatures:number[],droneId:number,terminal=false,success=false){
  const target=clamp(reward/25+(terminal?0:.96*this.predict(nextFeatures).value),-12,12);
  const advantage=clamp(target-decision.value,-3,3),sigma=this.exploration;
  const oldActor=this.actor.map(row=>[...row]),oldCritic=[...this.critic];
  const actorGradient=decision.action.map((a,i)=>clamp(advantage*(a-decision.mean[i])/(sigma*sigma)*(1-decision.mean[i]**2),-20,20));
  for(let j=0;j<this.hiddenSize;j++){
   for(let k=0;k<3;k++)this.actor[k][j]=clamp(this.actor[k][j]+.000025*actorGradient[k]*decision.hidden[j],-4,4);
   this.critic[j]=clamp(this.critic[j]+.002*advantage*decision.hidden[j],-4,4);
   const gradient=(actorGradient.reduce((sum,g,k)=>sum+g*oldActor[k][j],0)*.000025+.002*advantage*oldCritic[j])*(1-decision.hidden[j]**2);
   for(let i=0;i<this.inputs;i++)this.weights[j][i]=clamp(this.weights[j][i]+gradient*(decision.features[i]??0),-4,4);
   this.biases[j]=clamp(this.biases[j]+gradient,-4,4);
  }
  for(let k=0;k<3;k++)this.actorBias[k]=clamp(this.actorBias[k]+.000025*actorGradient[k],-4,4);
  this.criticBias=clamp(this.criticBias+.002*advantage,-12,12);
  this.updates++;this.reward+=reward;this.contributors.add(droneId);this.loss=this.loss*.97+advantage*advantage*.03;
  if(terminal){if(success)this.successes++;else this.failures++;}
 }
 export(){return {architecture:[this.inputs,this.hiddenSize,3],features:['targetDeltaX','targetDeltaZ','targetDeltaY','velocityX','velocityZ','velocityY','targetVelocityX','targetVelocityZ','horizontalDistance','confidence','visible','pain'],weights:this.weights,biases:this.biases,actor:this.actor,actorBias:this.actorBias,critic:this.critic,criticBias:this.criticBias,reward:this.reward,updates:this.updates,successes:this.successes,failures:this.failures,loss:this.loss,exploration:this.exploration};}
}
