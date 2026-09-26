import {AltitudeBrain} from './altitude-brain';
import {LandingBrain} from './landing-brain';
export type CoverCommitment={id:string;x:number;z:number;radius:number;started:number};
type CoverObservation={x:number;z:number;time:number};
/** Small online value network shared by every simulated drone.
 * Eight normalized search features → twelve tanh units → one value estimate.
 * Search values learn from collected rewards; the landing actor/critic controls
 * approach and descent velocities through the aircraft stabilizer.
 */
export class SwarmBrain {
 readonly inputs=8;readonly hidden=12;
 altitude=new AltitudeBrain();
 landing=new LandingBrain();
 weights=Array.from({length:12},(_,j)=>Array.from({length:8},(_,i)=>Math.sin(j*17+i*31+1)*.15));
 biases=Array(12).fill(0) as number[];
 output=Array.from({length:12},(_,i)=>Math.cos(i*13)*.1);outputBias=0;
 dopamineBursts=0;
 trainingRuns=0;
 updates=0;loss=0;reward=0;
 contributors=new Set<number>();coverage=new Set<string>();
 reservations=new Map<number,number>();
 landingDroneId:number|null=null;
 vacantCover=new Map<string,{time:number;until:number}>();
 coverExits=0;
 canInvestigateCover(cover:CoverCommitment,observation:CoverObservation|null,time:number){
  const vacant=this.vacantCover.get(cover.id);
  if(!vacant)return true;
  // Positive evidence of re-entry overrides the temporary vacancy memory.
  if(time>=vacant.until||observation&&observation.time>vacant.time&&time-observation.time<.5&&Math.hypot(observation.x-cover.x,observation.z-cover.z)<cover.radius){this.vacantCover.delete(cover.id);return true;}
  return false;
 }
 coverWasVacated(cover:CoverCommitment,observation:CoverObservation|null,time:number){
  if(!observation||observation.time<=cover.started||time-observation.time>.5||observation.time>time+.02)return false;
  if(Math.hypot(observation.x-cover.x,observation.z-cover.z)<=cover.radius+.35)return false;
  if(!this.vacantCover.has(cover.id))this.coverExits++;
  this.vacantCover.set(cover.id,{time:observation.time,until:time+12});return true;
 }
 failedSearches=0;failurePenalty=0;
 deploymentOutcomes=Array.from({length:8},()=>({successes:0,failures:0}));
 deploymentRisk(count:number){const outcome=this.deploymentOutcomes[count-1];return outcome&&outcome.successes+outcome.failures?outcome.failures/(outcome.successes+outcome.failures):0;}
 recordOutcome(count:number,success:boolean){const outcome=this.deploymentOutcomes[count-1];if(outcome)outcome[success?'successes':'failures']++;}
 memory:({x:number;y:number;z:number;vx:number;vy:number;vz:number;time:number})|null=null;
 predict(features:number[]){const hidden=this.weights.map((row,j)=>Math.tanh(row.reduce((v,w,i)=>v+w*(features[i]??0),this.biases[j])));return {value:hidden.reduce((v,h,j)=>v+h*this.output[j],this.outputBias),hidden};}
 learn(features:number[],reward:number,nextFeatures:number[],droneId:number,terminal=false){
  const current=this.predict(features),target=Math.max(-5,Math.min(5,reward/20+(terminal?0:.9*this.predict(nextFeatures).value)));
  const error=Math.max(-2,Math.min(2,current.value-target)),rate=.006;
  const oldOutput=[...this.output];
  for(let j=0;j<this.hidden;j++){this.output[j]-=rate*error*current.hidden[j];const gradient=error*oldOutput[j]*(1-current.hidden[j]**2);for(let i=0;i<this.inputs;i++)this.weights[j][i]-=rate*gradient*(features[i]??0);this.biases[j]-=rate*gradient;}
  this.outputBias-=rate*error;this.updates++;this.loss=this.updates===1?error*error:this.loss*.97+error*error*.03;this.reward+=reward;this.contributors.add(droneId);
 }
 export(){return {architecture:[this.inputs,this.hidden,1],features:['unexplored','distance','confidence','visible','pain','deployedDrones','deploymentRisk','bias'],weights:this.weights,biases:this.biases,output:this.output,outputBias:this.outputBias,dopamineBursts:this.dopamineBursts,trainingRuns:this.trainingRuns,reward:this.reward,updates:this.updates,loss:this.loss,failedSearches:this.failedSearches,failurePenalty:this.failurePenalty,deploymentOutcomes:this.deploymentOutcomes,altitude:this.altitude.export(),landing:this.landing.export()};}
 clearMission(){this.memory=null;this.coverage.clear();this.reservations.clear();this.landingDroneId=null;this.vacantCover.clear();this.coverExits=0;}
}
