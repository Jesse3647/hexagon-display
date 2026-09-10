import { strToU8, zipSync } from 'fflate';
import { spacePartsForPrinting, PRINT_PART_GAP } from './print-layout';
import {
  CONNECTOR_SYSTEM,
  type Configuration,
  type ModelResult,
  type Part,
} from './types';
/** Escapes arbitrary names before inserting them into XML attributes. */
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
/**
 * Selects exportable bodies without changing their positions or merging meshes.
 * @param result Generation result whose errors must be empty.
 * @param group Zero-based connected-group index; omit to include every group.
 * @throws For invalid geometry, an unknown group, or an empty selection.
 */
export function printableParts(result: ModelResult, group?: number): Part[] {
  if (result.errors.length) throw new Error(result.errors.join(' '));
  const ids = group === undefined ? null : result.layout.groups[group];
  if (group !== undefined && !ids) throw new Error('Unknown assembly group.');
  const parts = result.parts.filter((p) => !ids || ids.includes(p.id));
  if (!parts.length) throw new Error('There are no pods to export.');
  return parts;
}
/**
 * Serializes binary little-endian STL with one triangle stream of separate shells.
 * @param result Validated meshes; local meshes receive export-only spacing; preview positions remain unchanged.
 * @param group Optional zero-based export group; undefined exports all bodies.
 * @returns File bytes. Coordinates are mm, but STL has no standard unit metadata.
 * @throws If printableParts rejects the result or selection.
 */
export function exportSTL(result: ModelResult, group?: number): Uint8Array {
  const parts = spacePartsForPrinting(printableParts(result, group)),
    count = parts.reduce((sum, p) => sum + p.mesh.indices.length / 3, 0);
  // Binary STL: 80-byte header + uint32 triangle count + 50 bytes per facet
  // (normal, three vertices, and an unused uint16 attribute field).
  const bytes = new Uint8Array(84 + count * 50),
    view = new DataView(bytes.buffer);
  bytes.set(
    new TextEncoder().encode(
      'Honeycomb Workshop | T-slot v2 | millimeters | separate pod shells',
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
/**
 * Packages a millimeter 3MF model with one mesh object per pod and a parent assembly.
 * @param result Validated meshes; vertices remain local and components carry spaced print positions.
 * @param config Matching source configuration to embed as descriptive metadata.
 * @param group Optional zero-based connected group; undefined includes all pods.
 * @returns ZIP/OPC bytes with model, relationships, content types and configuration.
 * No slicer profiles or G-code are included. Pods are spaced for printing, then assembled.
 * Source assembly positions are retained in JSON metadata for reference.
 * Metadata records the connector system so T-slot files are distinguishable from dovetails.
 */
export function export3MF(
  result: ModelResult,
  config: Configuration,
  group?: number,
): Uint8Array {
  const sourceParts = printableParts(result, group);
  const parts = spacePartsForPrinting(sourceParts);
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
  // 3MF stores the 3x4 affine transform as 12 values with translation last.
  // One build item references the parent, keeping slicers from auto-arranging pods.
  const components = parts
    .map(
      (p, i) =>
        `<component objectid="${i + 1}" transform="1 0 0 0 1 0 0 0 1 ${p.x} ${p.y} 0"/>`,
    )
    .join('');
  const model = `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Title">Honeycomb display</metadata><metadata name="Description">Pods spaced apart for printing. Print layer by layer with backs on the bed; slide together afterward.</metadata><resources>${objects}<object id="${parent}" type="model" name="Honeycomb print layout"><components>${components}</components></object></resources><build><item objectid="${parent}"/></build></model>`;
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
            version: 5,
            printLayout: {
              mode: 'separated',
              minimumPartGapMm: PRINT_PART_GAP,
            },
            // Original preview placement survives the export-only rearrangement.
            assemblyPositions: sourceParts.map(({ id, x, y }) => ({
              id,
              x,
              y,
              z: 0,
            })),
            connectorSystem: CONNECTOR_SYSTEM,
            // Record bed treatment separately: mating dimensions still use T-slot v2.
            // Explicitly identify square bed edges in newly generated files.
            bedRelief: null,
            railEnd: 'square',
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
