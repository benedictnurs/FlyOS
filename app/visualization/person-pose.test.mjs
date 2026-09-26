import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createSpreadPose,personCollapseProgress} from './person-pose.ts';

async function personModel(){
 const bytes=readFileSync(new URL('../../public/models/runtime/person.glb',import.meta.url));
 const jsonSize=bytes.readUInt32LE(12),document=JSON.parse(bytes.subarray(20,20+jsonSize).toString());
 const binOffset=20+jsonSize,binSize=bytes.readUInt32LE(binOffset);
 document.buffers[0].uri=`data:application/octet-stream;base64,${bytes.subarray(binOffset+8,binOffset+8+binSize).toString('base64')}`;
 // Geometry and skinning are tested with the actual asset; texture decoding needs a browser.
 delete document.images;delete document.textures;delete document.materials;
 for(const mesh of document.meshes)for(const primitive of mesh.primitives)delete primitive.material;
 globalThis.ProgressEvent??=class ProgressEvent{constructor(type,details){this.type=type;Object.assign(this,details);}};
 return (await new GLTFLoader().parseAsync(JSON.stringify(document),'' )).scene;
}
const updateSkin=model=>{let root=model;while(root.parent)root=root.parent;root.updateMatrixWorld(true);model.traverse(o=>{if(o instanceof T.SkinnedMesh)o.skeleton.update();});};

test('the actual person rig spreads both arms and legs and returns to its rest pose',async()=>{
 const model=await personModel(),rest=new Map();model.traverse(o=>{if(o instanceof T.Bone)rest.set(o,o.quaternion.clone());});
 const pose=createSpreadPose(model);pose.apply(1);model.updateWorldMatrix(true,true);
 let limbs=0;
 model.traverse(bone=>{
  if(!(bone instanceof T.Bone)||!/upperarm|thigh/i.test(bone.name)||/twist/i.test(bone.name))return;
  const child=bone.children.find(o=>o instanceof T.Bone&&!/twist|share/i.test(o.name));
  const direction=child.getWorldPosition(new T.Vector3()).sub(bone.getWorldPosition(new T.Vector3())).normalize();
  const side=/_l/i.test(bone.name)?1:-1,arm=/arm/i.test(bone.name);
  const expected=new T.Vector3(side*(arm?1:.4),arm?-.25:-1,0).normalize();
  assert.ok(direction.dot(expected)>.999,bone.name);limbs++;
 });
 assert.equal(limbs,4);pose.apply(0);
 for(const [bone,quaternion] of rest)assert.ok(1-Math.abs(bone.quaternion.dot(quaternion))<1e-6,bone.name);
});
test('the actual skinned model lies flat above the ground after the fall',async()=>{
 const model=await personModel(),standing=new T.Box3().setFromObject(model,true),scale=2/standing.getSize(new T.Vector3()).y;
 model.scale.multiplyScalar(scale);const normalized=new T.Box3().setFromObject(model,true),center=normalized.getCenter(new T.Vector3());
 model.position.sub(new T.Vector3(center.x,normalized.min.y,center.z));model.position.y-=1;
 const pivot=new T.Group();pivot.add(model);const pose=createSpreadPose(model);pose.apply(1);pivot.rotation.x=-Math.PI/2;updateSkin(model);
 const bounds=new T.Box3().setFromObject(pivot,true);pivot.position.y=.03-bounds.min.y;updateSkin(model);
 const settled=new T.Box3().setFromObject(pivot,true),extent=settled.getSize(new T.Vector3());
 assert.ok(Math.abs(settled.min.y-.03)<1e-4);assert.ok(extent.y<.8,`prone height ${extent.y}`);assert.ok(extent.x>1.2);assert.ok(extent.z>1.7);
});
test('the fall plays on presentation time after simulation stops and stays down',()=>{
 assert.equal(personCollapseProgress(null,100),0);assert.equal(personCollapseProgress(10,9.99),0);assert.equal(personCollapseProgress(10,10),1);
 assert.equal(personCollapseProgress(10,10.001),1);
 assert.equal(personCollapseProgress(10,10.5),1);assert.equal(personCollapseProgress(10,100),1);
});
