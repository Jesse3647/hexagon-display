'use client';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Button } from '@/components/ui/button';
import { RotateCcw, Scan, Move3D } from 'lucide-react';
import { DIM, type ModelResult } from '@/lib/model/types';
type View = 'front' | 'rear' | 'perspective';
export function Preview({
  result,
  selected,
  step,
  onSelect,
}: {
  result: ModelResult | null;
  selected: string;
  step: number;
  onSelect: (id: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    controller = useRef<{
      view: (view: View) => void;
      setState: (id: string, step: number) => void;
    } | null>(null);
  const select = useRef(onSelect);
  useEffect(() => {
    select.current = onSelect;
  }, [onSelect]);
  const [failure, setFailure] = useState('');
  useEffect(() => {
    if (!host.current || !result?.parts.length) return;
    const element = host.current;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      queueMicrotask(() =>
        setFailure(
          '3D preview needs WebGL. Printable downloads are still available.',
        ),
      );
      return;
    }
    queueMicrotask(() => setFailure(''));
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setAnimationLoop(null);
    element.appendChild(renderer.domElement);
    renderer.domElement.setAttribute(
      'aria-label',
      'Interactive 3D model. Drag to orbit; scroll to zoom.',
    );
    renderer.domElement.setAttribute('role', 'img');
    const scene = new THREE.Scene(),
      root = new THREE.Group();
    scene.add(root);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x6b776a, 2.5));
    const key = new THREE.DirectionalLight(0xffffff, 3.0);
    key.position.set(-80, 120, 180);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xc6e3d5, 1.5);
    fill.position.set(80, -40, -70);
    scene.add(fill);
    const minX = Math.min(...result.parts.map((p) => p.x + p.bounds.min[0])),
      maxX = Math.max(...result.parts.map((p) => p.x + p.bounds.max[0]));
    const minY = Math.min(...result.parts.map((p) => p.y + p.bounds.min[1])),
      maxY = Math.max(...result.parts.map((p) => p.y + p.bounds.max[1]));
    root.position.set(-(minX + maxX) / 2, -(minY + maxY) / 2, 0);
    const records: {
      id: string;
      group: THREE.Group;
      material: THREE.MeshStandardMaterial;
      index: number;
    }[] = [];
    const disposables: { dispose: () => void }[] = [];
    const meshes: THREE.Mesh[] = [];
    result.parts.forEach((p) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(p.mesh.positions, 3),
      );
      geometry.setIndex(new THREE.BufferAttribute(p.mesh.indices, 1));
      geometry.computeVertexNormals();
      const material = new THREE.MeshStandardMaterial({
        color: 0x648678,
        roughness: 0.75,
        metalness: 0.05,
        flatShading: true,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData.id = p.id;
      meshes.push(mesh);
      const edges = new THREE.EdgesGeometry(geometry, 28),
        lineMat = new THREE.LineBasicMaterial({
          color: 0x284438,
          transparent: true,
          opacity: 0.22,
        });
      const lines = new THREE.LineSegments(edges, lineMat);
      const group = new THREE.Group();
      group.add(mesh, lines);
      group.position.set(p.x, p.y, 0);
      root.add(group);
      records.push({
        id: p.id,
        group,
        material,
        index: result.layout.order.indexOf(p.id),
      });
      disposables.push(geometry, material, edges, lineMat);
    });
    const camera = new THREE.OrthographicCamera(
      -100,
      100,
      100,
      -100,
      0.1,
      10000,
    );
    camera.up.set(0, 1, 0);
    const reduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = !reduced;
    orbit.dampingFactor = 0.12;
    orbit.target.set(0, 0, DIM.depth / 2);
    orbit.minZoom = 0.2;
    orbit.maxZoom = 12;
    const size = Math.max(result.dimensions[0], result.dimensions[1], 45);
    const frame = () => {
      const w = element.clientWidth,
        h = element.clientHeight,
        aspect = w / Math.max(h, 1);
      const half = Math.max(
        result.dimensions[1] * 0.72,
        (result.dimensions[0] * 0.72) / aspect,
        34,
      );
      camera.left = -half * aspect;
      camera.right = half * aspect;
      camera.top = half;
      camera.bottom = -half;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    };
    const view = (v: View) => {
      camera.zoom = 1;
      orbit.target.set(0, 0, DIM.depth / 2);
      camera.position.set(
        v === 'perspective' ? size * 0.95 : 0,
        v === 'perspective' ? size * 0.6 : 0,
        v === 'rear' ? -size * 4 : v === 'front' ? size * 4 : size * 2.1,
      );
      camera.lookAt(orbit.target);
      frame();
      orbit.update();
    };
    view('perspective');
    let state = { id: '', step: 0 };
    controller.current = {
      view,
      setState: (id, s) => {
        state = { id, step: s };
      },
    };
    const resize = new ResizeObserver(frame);
    resize.observe(element);
    const ray = new THREE.Raycaster(),
      mouse = new THREE.Vector2();
    let down = [0, 0];
    const pointerDown = (e: PointerEvent) => {
      down = [e.clientX, e.clientY];
    };
    const pointerUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
      const box = renderer.domElement.getBoundingClientRect();
      mouse.set(
        ((e.clientX - box.left) / box.width) * 2 - 1,
        (-(e.clientY - box.top) / box.height) * 2 + 1,
      );
      ray.setFromCamera(mouse, camera);
      const hit = ray.intersectObjects(
        meshes.filter((m) => m.parent?.visible),
        false,
      )[0];
      if (hit) select.current(hit.object.userData.id);
    };
    renderer.domElement.addEventListener('pointerdown', pointerDown);
    renderer.domElement.addEventListener('pointerup', pointerUp);
    let animation = 0;
    const tick = () => {
      for (const r of records) {
        const lifted = state.step > 0 && r.index === state.step - 1;
        r.group.visible = state.step === 0 || r.index >= state.step - 1;
        r.group.position.z +=
          (Number(lifted) * (DIM.depth + 5) - r.group.position.z) *
          (reduced ? 1 : 0.16);
        r.material.color.setHex(
          lifted ? 0xd69754 : r.id === state.id ? 0x648b78 : 0x96afa1,
        );
      }
      orbit.update();
      renderer.render(scene, camera);
      animation = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(animation);
      controller.current = null;
      resize.disconnect();
      orbit.dispose();
      renderer.domElement.removeEventListener('pointerdown', pointerDown);
      renderer.domElement.removeEventListener('pointerup', pointerUp);
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    };
    // Build only when the printable mesh changes, not on selection/camera changes.
  }, [result]);
  useEffect(
    () => controller.current?.setState(selected, step),
    [selected, step, result],
  );
  return (
    <div className="preview-wrap">
      <div className="view-controls">
        <Button
          variant="outline"
          onClick={() => controller.current?.view('front')}
        >
          <Scan />
          Front
        </Button>
        <Button
          variant="outline"
          onClick={() => controller.current?.view('rear')}
        >
          Rear
        </Button>
        <Button
          variant="outline"
          aria-label="Reset 3D view"
          onClick={() => controller.current?.view('perspective')}
        >
          <RotateCcw />
        </Button>
      </div>
      <div className="three-host" ref={host} />
      {(!result || !result.parts.length) && (
        <div className="preview-empty">
          {result ? 'Add a pod to start your display.' : 'Preparing your pod…'}
        </div>
      )}
      {failure && <p className="preview-empty">{failure}</p>}
      <div className="orbit-hint">
        <Move3D size={15} /> Drag to orbit · Scroll to zoom
      </div>
      <div className="axis-tag">
        <span>Y ↑</span>
        <span>X →</span>
        <small>FRONT</small>
      </div>
    </div>
  );
}
