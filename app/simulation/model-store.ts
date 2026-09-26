import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DroneSimulation} from './drone';
import {restoreKnowledge} from './knowledge';
export const MODEL_DIRECTORY=join(process.cwd(),'.data','models');
export async function readModel(directory=MODEL_DIRECTORY){return readFile(join(directory,'fly-brain.json'),'utf8');}
export async function writeModel(json:string,directory=MODEL_DIRECTORY){
 restoreKnowledge(new DroneSimulation(),json);
 await mkdir(directory,{recursive:true});
 const temporary=join(directory,`${randomUUID()}.tmp`);
 await writeFile(temporary,json,'utf8');
 await rename(temporary,join(directory,'fly-brain.json'));
}
