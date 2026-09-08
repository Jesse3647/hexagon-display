"""Independently verify exported bodies and selected layers of Bambu toolpaths.

Run from the repository root with scripts/requirements-verify.txt installed, after
validate-models.ts and slice-verify.py. Reads generated/*.stl and matching 3MFs,
plus work/slicing/<sample>/plate_1.gcode and sliced.3mf. Overwrites
generated/independent_report.json and exits nonzero on a failed check.

All coordinates are millimeters. Cross-sections and line-width buffers test
nominal separation on seven layers, not continuous Z coverage or physical print
release. Unsupported extruding arcs in inspected layers cause failure rather
than being accepted as straight-line evidence.
"""
from pathlib import Path
import json, re, sys, zipfile, xml.etree.ElementTree as ET
import numpy as np
import networkx as graphlib
import trimesh
from shapely.geometry import LineString, Polygon
from shapely.ops import unary_union
root=Path(__file__).resolve().parents[1]
models=root/'generated'
report={'mesh_checks':{},'sampled_toolpath_checks':{},'physical_validation':False}
ns={'m':'http://schemas.microsoft.com/3dmanufacturing/core/2015/02'}
# Compare separately loaded STL shells against positioned 3MF components.
# Counting build items alone would mistake the parent assembly for one fused pod.
for file in sorted(models.glob('*.stl')):
    mesh=trimesh.load_mesh(file,process=True)
    parts=mesh.split(only_watertight=False)
    checked=all(p.is_watertight and p.is_winding_consistent and p.is_volume for p in parts)
    with zipfile.ZipFile(file.with_suffix('.3mf')) as archive:
        model=ET.fromstring(archive.read('3D/3dmodel.model'))
        assert model.attrib['unit']=='millimeter'
        source={}
        for obj in model.findall('m:resources/m:object',ns):
            body=obj.find('m:mesh',ns)
            if body is None:continue
            vertices=np.array([[float(v.attrib[k]) for k in ['x','y','z']] for v in body.findall('m:vertices/m:vertex',ns)])
            triangles=np.array([[int(t.attrib[k]) for k in ['v1','v2','v3']] for t in body.findall('m:triangles/m:triangle',ns)])
            source[obj.attrib['id']]=trimesh.Trimesh(vertices,triangles,process=True)
        posed=[]
        for component in model.findall('m:resources/m:object/m:components/m:component',ns):
            m=source[component.attrib['objectid']].copy()
            transform=np.array(list(map(float,component.attrib['transform'].split()))).reshape(4,3).T
            matrix=np.eye(4);matrix[:3,:]=transform;m.apply_transform(matrix);posed.append(m)
        joined=trimesh.util.concatenate(posed)
        agreement=np.allclose(mesh.bounds,joined.bounds,atol=1e-4) and abs(mesh.volume-joined.volume)<.01
    report['mesh_checks'][file.stem]={'success':bool(checked and agreement and len(parts)==len(posed)),'closed_bodies':len(parts),'stl_3mf_agree':bool(agreement),'minimum_z':float(mesh.bounds[0,2])}

# Sample the first layer, back, mid-depth, rail end and front-stop region.
# This selection supplements the exact solid sweep checks; it is not exhaustive.
samples={.2,2.4,10.,19.8,20.2,20.6,22.}
for name in ['assembly_3x3','edited_assembly','calibration_in_place_0.20','calibration_in_place_0.10','calibration_in_place_0.15']:
    file=root/'work/slicing'/name/'plate_1.gcode'
    # Read slicer-owned transforms, including its recentering of each part.
    with zipfile.ZipFile(file.parent/'sliced.3mf') as archive:
        tree=ET.fromstring(archive.read('3D/3dmodel.model'))
        item=tree.find('m:build/m:item',ns)
        def transform(text):
            """Convert a 12-number 3MF transform string into a homogeneous 4x4 matrix.

            Args:
                text: Space-separated 3MF affine transform, translation last.
            Returns:
                NumPy matrix mapping local millimeter coordinates into its parent.
            """
            matrix=np.eye(4);matrix[:3,:]=np.array(list(map(float,text.split()))).reshape(4,3).T;return matrix
        build=transform(item.attrib['transform'])
        bodies=[]
        for comp in tree.findall('m:resources/m:object/m:components/m:component',ns):
            part_path=comp.attrib['{http://schemas.microsoft.com/3dmanufacturing/production/2015/06}path'].lstrip('/')
            part_tree=ET.fromstring(archive.read(part_path))
            body=next(o for o in part_tree.findall('m:resources/m:object',ns) if o.attrib['id']==comp.attrib['objectid'])
            vertices=np.array([[float(v.attrib[k]) for k in ['x','y','z']] for v in body.findall('m:mesh/m:vertices/m:vertex',ns)])
            faces=np.array([[int(t.attrib[k]) for k in ['v1','v2','v3']] for t in body.findall('m:mesh/m:triangles/m:triangle',ns)])
            mesh=trimesh.Trimesh(vertices,faces,process=True);mesh.apply_transform(build@transform(comp.attrib['transform']));bodies.append(mesh)
    code=file.read_text()
    offsets=re.search(r'; extruder_offset = ([^\n]+)',code)
    offset=np.array(list(map(float,offsets[1].split(';')[0].split('x')))) if offsets else np.zeros(2)
    # Track relative/absolute extrusion and G92 resets so travel/retraction moves
    # do not contribute fake material bridges between separate pod bodies.
    paths={};x=y=0.;obj=None;z=0.;width=.4;feature='';relative=True;last_e=0.;arcs=0
    for line in file.read_text().splitlines():
        if line.startswith('; Z_HEIGHT:'):z=round(float(line.split(':')[1]),2);obj=None
        elif line.startswith('; OBJECT_ID:'):obj=int(line.split(':')[1])
        elif line.startswith('; LINE_WIDTH:'):width=float(line.split(':')[1])
        elif line.startswith('; FEATURE:'):feature=line.split(':',1)[1].strip()
        elif line.startswith('M83'):relative=True
        elif line.startswith('M82'):relative=False
        elif line.startswith('G92'):
            match=re.search(r'E(-?[\d.]+)',line)
            if match:last_e=float(match[1])
        elif re.match(r'^G[0123](?: |$)',line):
            words={a:float(b) for a,b in re.findall(r'([XYE])(-?(?:\d*\.)?\d+)',line.split(';')[0])}
            nx,ny=words.get('X',x),words.get('Y',y)
            extruded=words.get('E',0) if relative else words.get('E',last_e)-last_e
            if 'E' in words:last_e=words['E'] if not relative else last_e+words['E']
            if z in samples and obj is not None and extruded>0 and (nx!=x or ny!=y) and feature not in ['Skirt','Brim','Custom']:
                if line.startswith(('G2 ','G3 ')):arcs+=1
                paths.setdefault((z,obj),[]).append(LineString([(x,y),(nx,ny)]).buffer(width/2,resolution=3))
            x,y=nx,ny
    layers={}
    for height in sorted(samples):
        all_segments=[segment for (z,_),segments in paths.items() if z==height for segment in segments]
        envelope=unary_union(all_segments)
        islands=list(envelope.geoms) if envelope.geom_type=='MultiPolygon' else [envelope]
        # Bambu may label the entire assembly with one OBJECT_ID. Instead, find
        # a material witness for each transformed pod and require distinct islands.
        matched=[];seeds=[];errors=[]
        for i,body in enumerate(bodies):
            section=trimesh.intersections.mesh_plane(body,plane_origin=[0,0,height-.1],plane_normal=[0,0,1])
            if len(section)==0:errors.append(f'Body {i} missing cross-section');continue
            graph=graphlib.Graph()
            for segment in section:
                a,b=[tuple(np.round(point[:2]-offset,6)) for point in segment]
                if a!=b:graph.add_edge(a,b)
            # Toggle nested closed contours (outer wall minus opening) with XOR,
            # then choose a point inside material rather than inside a compartment.
            filled=Polygon()
            for loop in graphlib.cycle_basis(graph):
                polygon=Polygon(loop)
                if polygon.is_valid:filled=filled.symmetric_difference(polygon)
            seed=filled.representative_point()
            nearest=min(range(len(islands)),key=lambda j:islands[j].distance(seed))
            distance=islands[nearest].distance(seed)
            if distance>.45:errors.append(f'No extrusion near body {i} material witness: {distance:.3f} mm')
            matched.append(nearest)
        if len(set(matched))!=len(bodies):errors.append('Two pod material witnesses share one connected extrusion envelope, or a body is missing.')
        distances=[]
        for i,a in enumerate(matched):
            for b in matched[i+1:]:
                distance=islands[a].distance(islands[b])
                if distance<1:distances.append(distance)
        layers[str(height)]={'expected_bodies':len(bodies),'distinct_extruded_bodies':len(set(matched)),'minimum_xy_bead_gap_mm':round(min(distances),4) if distances else None,'errors':errors}
    report['sampled_toolpath_checks'][name]={'sampled_layers':layers,'unsupported_arcs':arcs,'success':arcs==0 and all(not l['errors'] for l in layers.values())}
report['note']='Toolpath checks buffer positive-extrusion moves by half the declared line width on seven sampled layers. Body witnesses from slicer-transformed meshes must map to distinct extrusion-envelope islands. This verifies nominal separated bead envelopes, not extrusion behavior or adhesion on a physical printer.'
(models/'independent_report.json').write_text(json.dumps(report,indent=2)+'\n')
for section in ['mesh_checks','sampled_toolpath_checks']:
    for name,r in report[section].items():print(section,name,'PASS' if r['success'] else 'FAIL')
if not all(r['success'] for s in ['mesh_checks','sampled_toolpath_checks'] for r in report[s].values()):sys.exit(1)
