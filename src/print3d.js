// 3Dプリントタブ：書き出す立体（一塊・STL と同じ三角形）をそのまま見せる
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// 図面座標 (x, y奥, z上) → Three.js (x, y上, z手前)
const T = (p) => [p[0], p[2], -p[1]];

export class PrintView {
  constructor(el) {
    this.el = el;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 1, 20000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 1.5));
    const dl = new THREE.DirectionalLight(0xffffff, 1.7); dl.position.set(1, 1.6, 1.2); this.scene.add(dl);
    const dl2 = new THREE.DirectionalLight(0xffffff, 0.5); dl2.position.set(-1.2, 0.5, -0.8); this.scene.add(dl2);
    const dl3 = new THREE.DirectionalLight(0xffffff, 0.9); dl3.position.set(0.4, -1, 0.6); this.scene.add(dl3); // 底を下から見たときも暗くなりすぎないように
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.fitted = false;
    new ResizeObserver(() => this.resize()).observe(el);
    const loop = () => {
      if (this.el.offsetParent !== null) { // 見えているときだけ描く
        this.controls.update();
        // 下から見るときは造形台の網目が底に重なって見づらいので消す
        if (this.grid) this.grid.visible = this.camera.position.y > this.grid.position.y;
        this.renderer.render(this.scene, this.camera);
      }
      requestAnimationFrame(loop);
    };
    loop();
  }

  resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // tris: [[a,b,c], ...]（図面座標、mm）
  setTriangles(tris) {
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    this.group.clear();
    const pos = new Float32Array(tris.length * 9);
    tris.forEach((t, i) => t.forEach((p, j) => pos.set(T(p), i * 9 + j * 3)));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.computeVertexNormals(); // 三角形ごとに頂点を持つので面ごとの法線になる
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xd8d2c8, roughness: 0.75, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
    this.group.add(mesh);
    this.group.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), new THREE.LineBasicMaterial({ color: 0x3a3530 })));
    // 造形台（10mm 目盛り）
    const b = new THREE.Box3().setFromObject(mesh), size = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
    const span = Math.ceil((Math.max(size.x, size.z) * 1.3) / 20) * 20;
    const grid = new THREE.GridHelper(span, span / 10, 0x9a9187, 0xcfc8bd);
    grid.position.set(c.x, b.min.y - 0.05, c.z);
    grid.material.transparent = true; grid.material.opacity = 0.6; // 上から見るときも少し薄く
    this.group.add(grid);
    this.grid = grid;
    if (!this.fitted) { this.resize(); this.fit(); this.fitted = true; }
  }

  fit() {
    const b = new THREE.Box3().setFromObject(this.group.children[0] || this.group);
    const c = b.getCenter(new THREE.Vector3());
    const r = b.getSize(new THREE.Vector3()).length() / 2 || 100;
    const vf = this.camera.fov * Math.PI / 180;
    const hf = 2 * Math.atan(Math.tan(vf / 2) * this.camera.aspect);
    const dist = r / Math.sin(Math.min(vf, hf) / 2) * 1.05;
    const dir = new THREE.Vector3(0.75, 0.65, 1).normalize();
    this.camera.position.copy(c.clone().add(dir.multiplyScalar(dist)));
    this.camera.near = dist / 100; this.camera.far = dist * 100;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(c);
    this.controls.update();
  }
}
