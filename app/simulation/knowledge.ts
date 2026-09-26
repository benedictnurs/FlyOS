import type {DroneSimulation} from './drone';
import {SwarmBrain} from './swarm-brain';
export const KNOWLEDGE_KEY='flyos-knowledge-v1';
const searchFields=['weights','biases','output','outputBias','updates','loss','reward','failedSearches','failurePenalty','deploymentOutcomes','trainingRuns','dopamineBursts'] as const;
const landingFields=['weights','biases','actor','actorBias','critic','criticBias','updates','successes','failures','loss','reward'] as const;
function matches(value:unknown,template:unknown):boolean{
 if(typeof template==='number')return typeof value==='number'&&Number.isFinite(value);
 if(Array.isArray(template))return Array.isArray(value)&&value.length===template.length&&template.every((item,i)=>matches(value[i],item));
 if(template&&typeof template==='object')return !!value&&typeof value==='object'&&Object.entries(template).every(([key,item])=>matches((value as Record<string,unknown>)[key],item));
 return typeof value===typeof template;
}
function restoreModel(value:unknown){
 if(!value||typeof value!=='object')throw new Error('Invalid model checkpoint');
 const data=value as Record<string,unknown>,model=new SwarmBrain();
 for(const key of searchFields){if((key==='trainingRuns'||key==='dopamineBursts')&&data[key]===undefined)continue;if(!matches(data[key],model[key]))throw new Error(`Invalid search ${key}`);Object.assign(model,{[key]:data[key]});}
 if(data.altitude!==undefined){
  const altitude=data.altitude as Record<string,unknown>;
  for(const key of ['weights','biases','updates','loss','reward'] as const){if(!matches(altitude?.[key],model.altitude[key]))throw new Error(`Invalid altitude ${key}`);Object.assign(model.altitude,{[key]:altitude[key]});}
 }
 const landing=data.landing as Record<string,unknown>;
 if(!landing||typeof landing!=='object')throw new Error('Missing landing model');
 for(const key of landingFields){if(!matches(landing[key],model.landing[key]))throw new Error(`Invalid landing ${key}`);Object.assign(model.landing,{[key]:landing[key]});}
 return model;
}
export function serializeKnowledge(engine:DroneSimulation){
 return JSON.stringify({version:1,savedAt:new Date().toISOString(),drone:engine.sharedBrain.export(),person:engine.personBrain.brain.model.export(),exposure:engine.personBrain.exposure});
}
/** Validate both models before mutating the running simulation. */
export function restoreKnowledge(engine:DroneSimulation,json:string){
 const data=JSON.parse(json);
 if(data?.version!==1)throw new Error('Unsupported knowledge version');
 const drone=restoreModel(data.drone),person=restoreModel(data.person);
 if(!data.exposure||typeof data.exposure!=='object'||Array.isArray(data.exposure)||!Object.values(data.exposure).every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0))throw new Error('Invalid cover experience');
 Object.assign(engine.sharedBrain,drone);
 Object.assign(engine.personBrain.brain.model,person);
 engine.personBrain.exposure={...data.exposure};
 return data.savedAt as string;
}
