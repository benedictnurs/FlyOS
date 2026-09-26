/** Small online value network shared by every simulated drone.
 * Six normalized search features → twelve tanh units → one value estimate.
 * It learns from collected simulation rewards; it does not control flight motors.
 */
export class SwarmBrain {
 readonly inputs=6;readonly hidden=12;
 weights=Array.from({length:12},(_,j)=>Array.from({length:6},(_,i)=>Math.sin(j*17+i*31+1)*.15));
 biases=Array(12).fill(0) as number[];
 output=Array.from({length:12},(_,i)=>Math.cos(i*13)*.1);outputBias=0;
 updates=0;loss=0;reward=0;
 contributors=new Set<number>();coverage=new Set<string>();
 reservations=new Map<number,number>();
 landingDroneId:number|null=null;
 memory:({x:number;y:number;z:number;vx:number;vy:number;vz:number;time:number})|null=null;
 predict(features:number[]){const hidden=this.weights.map((row,j)=>Math.tanh(row.reduce((v,w,i)=>v+w*(features[i]??0),this.biases[j])));return {value:hidden.reduce((v,h,j)=>v+h*this.output[j],this.outputBias),hidden};}
 learn(features:number[],reward:number,nextFeatures:number[],droneId:number){
  const current=this.predict(features),target=Math.max(-5,Math.min(5,reward/20+.9*this.predict(nextFeatures).value));
  const error=Math.max(-2,Math.min(2,current.value-target)),rate=.006;
  const oldOutput=[...this.output];
  for(let j=0;j<this.hidden;j++){this.output[j]-=rate*error*current.hidden[j];const gradient=error*oldOutput[j]*(1-current.hidden[j]**2);for(let i=0;i<this.inputs;i++)this.weights[j][i]-=rate*gradient*(features[i]??0);this.biases[j]-=rate*gradient;}
  this.outputBias-=rate*error;this.updates++;this.loss=this.updates===1?error*error:this.loss*.97+error*error*.03;this.reward+=reward;this.contributors.add(droneId);
 }
 export(){return {architecture:[6,12,1],weights:this.weights,biases:this.biases,output:this.output,outputBias:this.outputBias,updates:this.updates,loss:this.loss};}
 clearMission(){this.memory=null;this.coverage.clear();this.reservations.clear();this.landingDroneId=null;}
}
