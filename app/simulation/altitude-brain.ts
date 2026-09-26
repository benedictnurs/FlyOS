/** Shared action values for low, middle and high scans. */
export class AltitudeBrain {
 readonly inputs=7;
 weights=Array.from({length:3},()=>Array(7).fill(0) as number[]);
 biases=[0,0,0];updates=0;loss=0;reward=0;
 values(features:number[]){return this.weights.map((row,j)=>row.reduce((sum,w,i)=>sum+w*(features[i]??0),this.biases[j]));}
 choose(features:number[],random:()=>number){
  const exploration=Math.max(.08,.3/Math.sqrt(1+this.updates/500));
  if(random()<exploration)return Math.floor(random()*3);
  const values=this.values(features),best=Math.max(...values);
  const ties=values.map((v,i)=>v===best?i:-1).filter(i=>i>=0);
  return ties[Math.floor(random()*ties.length)];
 }
 learn(features:number[],action:number,reward:number,next:number[],terminal=false){
  const target=Math.max(-8,Math.min(8,reward/20+(terminal?0:.9*Math.max(...this.values(next)))));
  const error=Math.max(-2,Math.min(2,this.values(features)[action]-target));
  for(let i=0;i<this.inputs;i++)this.weights[action][i]-=.01*error*(features[i]??0);
  this.biases[action]-=.01*error;this.updates++;this.reward+=reward;this.loss=this.loss*.97+error*error*.03;
 }
 export(){return {weights:this.weights,biases:this.biases,updates:this.updates,loss:this.loss,reward:this.reward,actions:['low','middle','high']};}
}
