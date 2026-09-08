"""Slice representative 3MFs with Bambu Studio on macOS, without printing.

Usage: python3 scripts/slice-verify.py [sample_stem ...]
Requires the installed BambuStudio.app and files created by validate-models.ts.
With no arguments, checks all eleven samples; explicit stems select a subset.
Writes temporary profiles, logs, G-code and slicer projects under work/slicing,
then replaces generated/slicer_report.json with results for this invocation.
No saved user presets are edited and no printer is contacted. The report's
application label records the baseline tested version, not a live version probe.
"""
from pathlib import Path
import json, subprocess, sys
root = Path(__file__).resolve().parents[1]
models = root / 'generated'
work = root / 'work/slicing'
work.mkdir(parents=True, exist_ok=True)
app = Path('/Applications/BambuStudio.app/Contents')
profiles = app / 'Resources/profiles/BBL'
process = json.loads((profiles/'process/0.20mm Standard @BBL X1C.json').read_text())
# Copy the bundled process into an isolated temporary profile. Layer-by-layer
# printing and disabled supports/brims preserve the intended inter-part gaps.
process.update(name='Honeycomb validation', wall_loops='3', sparse_infill_density='15%', enable_support='0', brim_type='no_brim', print_sequence='by layer')
process_path=work/'process.json'
process_path.write_text(json.dumps(process))
report={'application':'Bambu Studio 02.08.02.61','profile':{'printer':'Bambu Lab X1 Carbon 0.4 nozzle','material':'Generic PLA','layer_height_mm':0.2,'wall_loops':3,'infill':'15%','supports':False},'physical_validation':False,'models':{}}
names=sys.argv[1:] or ['closed_pod','all_connectors','half_pod','assembly_3x3','edited_assembly','calibration_in_place_0.20','calibration_in_place_0.10','calibration_in_place_0.15','calibration_separate_0.20','calibration_separate_0.10','calibration_separate_0.15']
for name in names:
    folder=work/name
    folder.mkdir(exist_ok=True)
    # Bambu resolves the output project name relative to cwd/outputdir; keep the
    # filename relative to avoid duplicating an absolute path during project save.
    command=[str(app/'MacOS/BambuStudio'),'--debug','2','--load-settings',str(profiles/'machine/Bambu Lab X1 Carbon 0.4 nozzle.json')+';'+str(process_path),'--load-filaments',str(profiles/'filament/Generic PLA.json'),'--arrange','1','--orient','0','--slice','0','--export-3mf','sliced.3mf','--outputdir',str(folder),str(models/(name+'.3mf'))]
    run=subprocess.run(command,capture_output=True,text=True,timeout=90,cwd=folder)
    log=run.stdout+run.stderr
    (folder/'log.txt').write_text(log)
    gcode=folder/'plate_1.gcode'
    g=gcode.read_text() if gcode.exists() else ''
    # Exit status alone is insufficient: inspect emitted G-code settings and
    # errors, while reporting harmless CLI warnings separately.
    expected=['; enable_support = 0','; wall_loops = 3','; layer_height = 0.2','; sparse_infill_density = 15%']
    errors=[line for line in log.splitlines() if '[error]' in line or 'failed' in line.lower()]
    warnings=[line for line in log.splitlines() if '[warning]' in line and 'cli mode' not in line]
    checked=run.returncode==0 and bool(g) and not errors and all(s in g for s in expected)
    report['models'][name]={'success':checked,'returncode':run.returncode,'gcode_bytes':len(g),'sliced_project':(folder/'sliced.3mf').exists(),'settings_verified':all(s in g for s in expected),'warnings':warnings,'errors':errors}
    print(name, 'PASS' if checked else 'FAIL', flush=True)
(models/'slicer_report.json').write_text(json.dumps(report,indent=2)+'\n')
if not all(m['success'] for m in report['models'].values()):raise SystemExit(1)
