import * as T from 'three';

/** Aim limbs in character space so imported bone axes do not affect the pose. */
export function createSpreadPose(model:T.Object3D){
 const limbs:{bone:T.Bone;rest:T.Quaternion;spread:T.Quaternion;arm:boolean;side:number}[]=[];
 model.traverse(object=>{
  if(!(object instanceof T.Bone)||/twist/i.test(object.name))return;
  if(!/upperarm|forearm|thigh|calf/i.test(object.name))return;
  limbs.push({bone:object,rest:object.quaternion.clone(),spread:object.quaternion.clone(),arm:/arm/i.test(object.name),side:/left|\.l|_l/i.test(object.name)?1:-1});
 });
 model.updateWorldMatrix(true,true);
 const characterRotation=model.getWorldQuaternion(new T.Quaternion());
 // Traverse parents before children, keeping elbows and knees extended.
 for(const limb of limbs){
  const child=limb.bone.children.find(object=>object instanceof T.Bone&&!/twist|share/i.test(object.name));
  if(!child||!limb.bone.parent)continue;
  const origin=limb.bone.getWorldPosition(new T.Vector3());
  const direction=child.getWorldPosition(new T.Vector3()).sub(origin).normalize();
  const target=new T.Vector3(limb.side*(limb.arm?1:.4),limb.arm?-.25:-1,0).normalize().applyQuaternion(characterRotation);
  const worldRotation=limb.bone.getWorldQuaternion(new T.Quaternion());
  const rotation=new T.Quaternion().setFromUnitVectors(direction,target).multiply(worldRotation);
  limb.spread.copy(limb.bone.parent.getWorldQuaternion(new T.Quaternion()).invert().multiply(rotation));
  limb.bone.quaternion.copy(limb.spread);
  limb.bone.updateWorldMatrix(false,true);
 }
 for(const limb of limbs)limb.bone.quaternion.copy(limb.rest);
 return {
  apply(amount:number){for(const limb of limbs)limb.bone.quaternion.copy(limb.rest).slerp(limb.spread,amount);},
 };
}
