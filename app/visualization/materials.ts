import * as T from 'three';

// Presentation-only materials. No collision or simulation geometry is changed.
export function createMaterials(renderer: T.WebGLRenderer) {
  const textures: T.Texture[] = [];
  const materials: T.Material[] = [];
  function standard(parameters: T.MeshStandardMaterialParameters) {
    const material = new T.MeshStandardMaterial(parameters);
    materials.push(material);
    return material;
  }
  function physical(parameters: T.MeshPhysicalMaterialParameters) {
    const material = new T.MeshPhysicalMaterial(parameters);
    materials.push(material);
    return material;
  }
  function pattern(kind: 'fabric' | 'stone' | 'plaster') {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const pixels = ctx.createImageData(256, 256);
    let seed = 42;
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const noise = seed / 4294967296;
      const weave = kind === 'fabric' ? ((x % 4 < 2) !== (y % 4 < 2) ? 24 : -12) : 0;
      const vein = kind === 'stone' ? Math.sin(x * .055 + Math.sin(y * .03) * 3) * 13 : 0;
      const shade = 200 + noise * 35 + weave + vein;
      const i = (y * 256 + x) * 4;
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = shade;
      pixels.data[i + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
    const tex = new T.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = T.RepeatWrapping;
    tex.repeat.set(kind === 'fabric' ? 4 : 2, kind === 'fabric' ? 4 : 2);
    textures.push(tex);
    return tex;
  }
  const loader = new T.TextureLoader();
  function woodMap(name: string, color = false) {
    const texture = loader.load(`/textures/${name}.jpg`);
    texture.wrapS = texture.wrapT = T.RepeatWrapping;
    texture.repeat.set(2, 2);
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    if (color) texture.colorSpace = T.SRGBColorSpace;
    textures.push(texture);
    return texture;
  }
  const woodColor = woodMap('wood-color', true);
  const woodNormal = woodMap('wood-normal');
  const woodRoughness = woodMap('wood-roughness');
  const weave = pattern('fabric'), stonePattern = pattern('stone'), plaster = pattern('plaster');
  const m = {
    wood: standard({color:'#d5c1a2', map:woodColor, normalMap:woodNormal, normalScale:new T.Vector2(.35,.35), roughnessMap:woodRoughness, roughness:.85}),
    walnut: standard({color:'#7d5335', map:woodColor, roughness:.5, normalMap:woodNormal, normalScale:new T.Vector2(.15,.15)}),
    fabric: physical({color:'#d2cbbd', roughness:.94, bumpMap:weave, bumpScale:.035, sheen:1, sheenColor:'#f5e9d4', sheenRoughness:.8}),
    sage: physical({color:'#778379', roughness:.95, bumpMap:weave, bumpScale:.035, sheen:1, sheenColor:'#c4d0be'}),
    terracotta: physical({color:'#b97451', roughness:.95, bumpMap:weave, bumpScale:.025, sheen:.7}),
    stone: standard({color:'#eeece3', roughness:.35, map:stonePattern, bumpMap:stonePattern, bumpScale:.018}),
    tile: standard({color:'#bec5bd', roughness:.35, bumpMap:stonePattern, bumpScale:.014}),
    wall: standard({color:'#e7e4da', roughness:.95, bumpMap:plaster, bumpScale:.025}),
    trim: standard({color:'#f1eee5', roughness:.5}),
    graphite: standard({color:'#202b2e', roughness:.38, metalness:.62}),
    rubber: standard({color:'#111c20', roughness:.95}),
    metal: standard({color:'#b6c6c9', metalness:.95, roughness:.24}),
    brass: standard({color:'#bda16c', metalness:.8, roughness:.28}),
    shell: physical({color:'#e7eeec', metalness:.22, roughness:.24, clearcoat:1, clearcoatRoughness:.18}),
    glass: physical({color:'#b4d6dd', metalness:.15, roughness:.08, transparent:true, opacity:.2, side:T.DoubleSide, depthWrite:false}),
    visor: physical({color:'#091720', metalness:.6, roughness:.12, clearcoat:1}),
    cyan: standard({color:'#76eddd', emissive:'#49dac8', emissiveIntensity:2.2, roughness:.2}),
    amber: standard({color:'#f5b277', emissive:'#ffac58', emissiveIntensity:1.2}),
    leaf: standard({color:'#41654c', roughness:.85, side:T.DoubleSide}),
  };
  return { ...m, standard, physical, dispose() { materials.forEach(x=>x.dispose()); textures.forEach(x=>x.dispose()); } };
}
export type Materials = ReturnType<typeof createMaterials>;
