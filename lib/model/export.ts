import { strToU8, zipSync } from 'fflate';
import type { Configuration, ModelResult, Part } from './types';
const xml = (text: string) =>
  text.replace(
    /[<>&"']/g,
    (c) =>
      ({
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        '"': '&quot;',
        "'": '&apos;',
      })[c]!,
  );
export function printableParts(result: ModelResult, group?: number): Part[] {
  if (result.errors.length) throw new Error(result.errors.join(' '));
  const ids = group === undefined ? null : result.layout.groups[group];
  if (group !== undefined && !ids) throw new Error('Unknown assembly group.');
  const parts = result.parts.filter((p) => !ids || ids.includes(p.id));
  if (!parts.length) throw new Error('There are no pods to export.');
  return parts;
}
export function exportSTL(result: ModelResult, group?: number): Uint8Array {
  const parts = printableParts(result, group),
    count = parts.reduce((sum, p) => sum + p.mesh.indices.length / 3, 0);
  const bytes = new Uint8Array(84 + count * 50),
    view = new DataView(bytes.buffer);
  bytes.set(
    new TextEncoder().encode(
      'Honeycomb Workshop | millimeters | separate pod shells',
    ),
  );
  view.setUint32(80, count, true);
  let offset = 84;
  for (const part of parts) {
    const { positions: v, indices: f } = part.mesh;
    for (let i = 0; i < f.length; i += 3) {
      const points = [f[i], f[i + 1], f[i + 2]].map((n) => [
        v[n * 3] + part.x,
        v[n * 3 + 1] + part.y,
        v[n * 3 + 2],
      ]);
      const u = points[1].map((n, k) => n - points[0][k]),
        w = points[2].map((n, k) => n - points[0][k]);
      const n = [
        u[1] * w[2] - u[2] * w[1],
        u[2] * w[0] - u[0] * w[2],
        u[0] * w[1] - u[1] * w[0],
      ];
      const length = Math.hypot(...n) || 1;
      for (const value of [...n.map((x) => x / length), ...points.flat()]) {
        view.setFloat32(offset, value, true);
        offset += 4;
      }
      view.setUint16(offset, 0, true);
      offset += 2;
    }
  }
  return bytes;
}
export function export3MF(
  result: ModelResult,
  config: Configuration,
  group?: number,
): Uint8Array {
  const parts = printableParts(result, group);
  const objects = parts
    .map((p, i) => {
      const vertices: string[] = [];
      for (let k = 0; k < p.mesh.positions.length; k += 3)
        vertices.push(
          `<vertex x="${p.mesh.positions[k]}" y="${p.mesh.positions[k + 1]}" z="${p.mesh.positions[k + 2]}"/>`,
        );
      const triangles: string[] = [];
      for (let k = 0; k < p.mesh.indices.length; k += 3)
        triangles.push(
          `<triangle v1="${p.mesh.indices[k]}" v2="${p.mesh.indices[k + 1]}" v3="${p.mesh.indices[k + 2]}"/>`,
        );
      return `<object id="${i + 1}" type="model" name="${xml(`${p.id} ${p.kind}`)}"><mesh><vertices>${vertices.join('')}</vertices><triangles>${triangles.join('')}</triangles></mesh></object>`;
    })
    .join('');
  const parent = parts.length + 1;
  const components = parts
    .map(
      (p, i) =>
        `<component objectid="${i + 1}" transform="1 0 0 0 1 0 0 0 1 ${p.x} ${p.y} 0"/>`,
    )
    .join('');
  const model = `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Title">Honeycomb display</metadata><metadata name="Description">Separate interlocked pods. Keep component positions; print all layers together with backs on the bed.</metadata><resources>${objects}<object id="${parent}" type="model" name="Honeycomb assembly"><components>${components}</components></object></resources><build><item objectid="${parent}"/></build></model>`;
  return zipSync(
    {
      '[Content_Types].xml': strToU8(
        '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="json" ContentType="application/json"/></Types>',
      ),
      '_rels/.rels': strToU8(
        '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
      ),
      '3D/3dmodel.model': strToU8(model),
      'Metadata/honeycomb.json': strToU8(
        JSON.stringify(
          {
            version: 2,
            config,
            group: group ?? null,
            removalOrder: result.layout.order,
          },
          null,
          2,
        ),
      ),
    },
    { level: 6 },
  );
}
