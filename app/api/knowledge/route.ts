import {readModel,writeModel} from '../../simulation/model-store';
export const runtime='nodejs';
export async function GET(){
 try{return new Response(await readModel(),{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});}
 catch(error){return Response.json({error:'Model checkpoint unavailable'},{status:(error as NodeJS.ErrnoException).code==='ENOENT'?404:500});}
}
export async function POST(request:Request){
 const json=await request.text();
 if(json.length>200000)return Response.json({error:'Checkpoint too large'},{status:413});
 try{await writeModel(json);const checkpoint=JSON.parse(json);return Response.json({saved:true,trainingRuns:checkpoint.drone.trainingRuns??0,savedAt:checkpoint.savedAt});}
 catch{return Response.json({error:'Could not save model checkpoint'},{status:500});}
}
