"""Build smaller texture variants of the supplied GLBs (macOS sips required).
Geometry, skinning, materials and source assets are preserved.
"""
import json, struct, subprocess, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
for name, resolution in [('drone', 256), ('person', 512)]:
    source = ROOT / 'public/models' / f'{name}.glb'
    data = source.read_bytes()
    json_length = struct.unpack_from('<I', data, 12)[0]
    doc = json.loads(data[20:20 + json_length])
    bin_start = 20 + json_length + 8
    binary = data[bin_start:]
    replacements = {}
    with tempfile.TemporaryDirectory() as folder:
        for i, image in enumerate(doc.get('images', [])):
            if 'bufferView' not in image:
                continue
            view = doc['bufferViews'][image['bufferView']]
            extension = 'png' if image.get('mimeType') == 'image/png' else 'jpg'
            path = Path(folder) / f'{i}.{extension}'
            offset = view.get('byteOffset', 0)
            path.write_bytes(binary[offset:offset + view['byteLength']])
            subprocess.run(['sips', '-Z', str(resolution), str(path)], check=True, stdout=subprocess.DEVNULL)
            replacements[image['bufferView']] = path.read_bytes()
    packed = bytearray()
    for i, view in enumerate(doc['bufferViews']):
        offset = view.get('byteOffset', 0)
        content = replacements.get(i, binary[offset:offset + view['byteLength']])
        packed.extend(b'\0' * (-len(packed) % 4))
        view['byteOffset'] = len(packed)
        view['byteLength'] = len(content)
        packed.extend(content)
    doc['buffers'][0]['byteLength'] = len(packed)
    packed.extend(b'\0' * (-len(packed) % 4))
    encoded = json.dumps(doc, separators=(',', ':')).encode()
    encoded += b' ' * (-len(encoded) % 4)
    output = struct.pack('<III', 0x46546c67, 2, 28 + len(encoded) + len(packed))
    output += struct.pack('<II', len(encoded), 0x4e4f534a) + encoded
    output += struct.pack('<II', len(packed), 0x004e4942) + packed
    target = ROOT / 'public/models/runtime' / f'{name}.glb'
    target.parent.mkdir(exist_ok=True)
    target.write_bytes(output)
    print(f'{name}: {len(data)/1e6:.1f} MB → {len(output)/1e6:.1f} MB')
