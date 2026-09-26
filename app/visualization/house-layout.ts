// Existing room layout and furniture footprints, shared by rendering and contacts.
export type Fixture = { id:string; position:[number,number,number]; size:[number,number,number]; material:'wood'|'walnut'|'sage'|'fabric'|'stone'|'wall'|'tile'|'trim'|'graphite'; radius?:number };
export const fixtures: Fixture[] = [
 {id:'foundation',position:[5,-.22,5],size:[11.7,.4,11.7],material:'graphite',radius:.08},
 {id:'kitchen-floor',position:[2.2,-.005,2.2],size:[5.6,.06,5.6],material:'wood'},
 {id:'living-floor',position:[7.8,-.005,2.2],size:[5.6,.06,5.6],material:'wood'},
 {id:'bedroom-floor',position:[2.2,-.005,7.8],size:[5.6,.06,5.6],material:'wood'},
 {id:'bathroom-floor',position:[7.8,-.005,7.8],size:[5.6,.06,5.6],material:'tile'},
 {id:'west-wall',position:[-.6,1.25,5],size:[.17,2.5,11.4],material:'wall'},
 {id:'north-wall',position:[5,1.25,10.6],size:[11.4,2.5,.17],material:'wall'},
 {id:'cabinet-bank',position:[.1,.49,2.4],size:[.8,.98,4.8],material:'sage',radius:.025},
 {id:'countertop',position:[.1,1.01,2.4],size:[1,.08,4.9],material:'stone',radius:.025},
 {id:'low-cabinets',position:[2,.45,.1],size:[3,.9,.8],material:'sage',radius:.02},
 {id:'worktop',position:[2,.94,.1],size:[3.1,.09,.9],material:'stone',radius:.025},
 {id:'tabletop',position:[2.5,.74,2.5],size:[1.7,.09,1.2],material:'walnut',radius:.055},
 {id:'refrigerator',position:[4,.92,.2],size:[.8,1.84,.9],material:'trim',radius:.07},
 {id:'sofa-base',position:[8,.31,.7],size:[3,.5,1.25],material:'sage',radius:.16},
 {id:'sofa-back',position:[8,.72,.17],size:[3,.83,.27],material:'sage',radius:.1},
 {id:'sofa-arm-left',position:[6.6,.53,.7],size:[.28,.7,1.3],material:'sage',radius:.1},
 {id:'sofa-arm-right',position:[9.4,.53,.7],size:[.28,.7,1.3],material:'sage',radius:.1},
 {id:'coffee-table',position:[8,.43,2.6],size:[1.5,.1,.85],material:'walnut',radius:.09},
 {id:'coffee-pedestal',position:[8,.21,2.6],size:[.65,.4,.4],material:'walnut',radius:.06},
 {id:'tv-console',position:[10,.3,3.2],size:[.5,.6,2],material:'walnut',radius:.035},
 {id:'bed-frame',position:[1.6,.25,8.5],size:[2.5,.45,3],material:'walnut',radius:.04},
 {id:'mattress',position:[1.6,.61,8.4],size:[2.5,.32,2.8],material:'fabric',radius:.13},
 {id:'headboard',position:[1.6,.8,10],size:[2.6,1.4,.2],material:'sage',radius:.08},
 {id:'nightstand',position:[3.5,.4,9.5],size:[.8,.8,.8],material:'walnut',radius:.03},
 {id:'vanity',position:[6.2,.45,9.7],size:[1.7,.9,.7],material:'walnut',radius:.025},
 {id:'vanity-top',position:[6.2,.94,9.7],size:[1.8,.08,.8],material:'stone',radius:.035},
 {id:'bath-base',position:[9,.22,9],size:[1.5,.4,2.2],material:'trim',radius:.17},
];
for (const i of [0,1,3,4,6,7,9,10]) {
 fixtures.push({id:`partition-x-${i}`,position:[5,1.3,i],size:[.14,2.6,.96],material:'wall',radius:.015});
 fixtures.push({id:`partition-z-${i}`,position:[i,1.3,5],size:[.96,2.6,.14],material:'wall',radius:.015});
}
for (const x of [1.9,3.1]) for(const z of [2.1,2.9]) fixtures.push({id:`table-leg-${x}-${z}`,position:[x,.36,z],size:[.085,.72,.085],material:'walnut',radius:.018});
