import {blockedByTrunk,type WorldMap} from './terrain';
type Point={x:number;z:number};
const clearance=.85;
function clearSegment(a:Point,b:Point,map:WorldMap){
 const dx=b.x-a.x,dz=b.z-a.z,length=dx*dx+dz*dz;
 return map.trees.every(t=>{const u=length?Math.max(0,Math.min(1,((t.x-a.x)*dx+(t.z-a.z)*dz)/length)):0;return Math.hypot(a.x+dx*u-t.x,a.z+dz*u-t.z)>=clearance;});
}
/** Route around solid trunks instead of repeatedly walking into them. */
export class PersonNavigation {
 private goal:Point|null=null;private path:Point[]=[];
 move(person:Point,goal:Point,distance:number,map:WorldMap){
  // Recover even when a relocated/spawned actor starts inside a trunk.
  for(let pass=0;pass<map.trees.length;pass++){
   let moved=false;
   for(const tree of map.trees){const dx=person.x-tree.x,dz=person.z-tree.z,len=Math.hypot(dx,dz);if(len<clearance){person.x=tree.x+(len?dx/len:1)*(clearance+.01);person.z=tree.z+(len?dz/len:0)*(clearance+.01);moved=true;}}
   if(!moved)break;
  }
  if(distance<=0)return;
  if(clearSegment(person,goal,map)){this.path=[];this.goal=null;}
  else if(!this.goal||this.goal.x!==goal.x||this.goal.z!==goal.z||!this.path.length||!clearSegment(person,this.path[0],map)){
   this.goal={...goal};this.path=this.plan(person,goal,map);
  }
  while(this.path.length&&Math.hypot(person.x-this.path[0].x,person.z-this.path[0].z)<.08)this.path.shift();
  const target=this.path[0]??goal,dx=target.x-person.x,dz=target.z-person.z,len=Math.hypot(dx,dz);
  if(!len)return;
  const step=Math.min(distance,len),next={x:person.x+dx/len*step,z:person.z+dz/len*step};
  if(!blockedByTrunk(next.x,next.z,map)){person.x=next.x;person.z=next.z;}
 }
 private plan(start:Point,goal:Point,map:WorldMap){
  const nodes=[{...start},{...goal},...map.trees.flatMap(t=>Array.from({length:12},(_,i)=>({x:t.x+Math.cos(i*Math.PI/6)*1.05,z:t.z+Math.sin(i*Math.PI/6)*1.05}))).filter(p=>p.x>=.85&&p.z>=.85&&p.x<=map.size-.85&&p.z<=map.size-.85&&!blockedByTrunk(p.x,p.z,map))];
  const costs=nodes.map(()=>Infinity),previous=nodes.map(()=>-1),visited=new Set<number>();costs[0]=0;
  for(let iteration=0;iteration<nodes.length;iteration++){
   let current=-1;for(let i=0;i<nodes.length;i++)if(!visited.has(i)&&(current<0||costs[i]<costs[current]))current=i;
   if(current<0||!Number.isFinite(costs[current]))break;
   if(current===1){const path:Point[]=[];for(let i=1;i>0;i=previous[i])path.unshift(nodes[i]);return path;}
   visited.add(current);
   for(let i=1;i<nodes.length;i++)if(!visited.has(i)&&clearSegment(nodes[current],nodes[i],map)){
    const cost=costs[current]+Math.hypot(nodes[current].x-nodes[i].x,nodes[current].z-nodes[i].z);
    if(cost<costs[i]){costs[i]=cost;previous[i]=current;}
   }
  }
  return [];
 }
}
