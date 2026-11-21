import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

// 図面座標 (x, y奥, z上) → Three.js (x, y上, z手前)
const T = (p) => new THREE.Vector3(p[0], p[2], -p[1]);

// 部材ごとに木の色の濃さを少し変える
const COLORS = { side: 0xc79a68, back: 0xbf8f5c, front: 0xd2a676, bottom: 0xe0c49a };

export class View3D {
  constructor(el) {
    this.el = el;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 1, 20000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a66, 1.6));
    const dl = new THREE.DirectionalLight(0xffffff, 1.6);
    dl.position.set(1, 1.6, 1.2);
    this.scene.add(dl);
    const dl2 = new THREE.DirectionalLight(0xffffff, 0.5);
    dl2.position.set(-1.2, 0.4, -0.8);
    this.scene.add(dl2);
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.dimGroup = new THREE.Group();
    this.scene.add(this.dimGroup);
    // 寸法の数字（HTMLで重ねる）
    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'dimlayer';
    el.appendChild(this.labels.domElement);
    this.opts = { explode: false, levels: 1, dims: ['out'] };
    this.fitted = false;
    new ResizeObserver(() => this.resize()).observe(el);
    const loop = () => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.labels.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    loop();
  }

  resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setBox(box) { this.box = box; this.rebuild(); if (!this.fitted) { this.resize(); this.fit(); this.fitted = true; } }
  setOpts(o) { Object.assign(this.opts, o); this.rebuild(); }

  rebuild() {
    const { box } = this;
    if (!box) return;
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    this.group.clear();
    const levels = Math.max(1, Math.min(10, this.opts.levels || 1)); // 積む段数
    const cols = Math.max(1, Math.min(10, this.opts.cols || 1));     // 横に並べる数（すき間なしで隣り合わせ）
    const ex = this.opts.explode ? Math.max(box.v.W, box.v.H) * 0.22 : 0;
    for (let C = 0; C < cols; C++) {
      for (let L = 0; L < levels; L++) {
        for (const part of box.parts) {
          const o = part.outward, ol = Math.hypot(...o);
          const off = [o[0] / ol * ex + C * (box.v.W + 2 * ex), o[1] / ol * ex, o[2] / ol * ex + L * box.v.stackPitch];
          this.group.add(this.partObject(part, off));
        }
      }
    }
    this.buildDims();
  }

  // ---------- 寸法線 ----------
  // 分解のときは板が動くので出さない。積んだときは外寸に全体の高さと1段の高さ、内寸はいちばん上の箱に出す
  buildDims() {
    this.dimGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); if (o.element) o.element.remove(); });
    this.dimGroup.clear();
    // dims: 出す寸法の組（'out' 外寸・'in' 内寸）。両方なら両方出す
    const modes = [].concat(this.opts.dims || []).filter(Boolean);
    if (!modes.length || this.opts.explode || !this.box) return;
    for (const mode of modes) this.buildDimSet(mode);
  }

  buildDimSet(mode) {
    const v = this.box.v, hw = v.W / 2, t = v.t, S2 = Math.SQRT2;
    const n = Math.max(1, Math.min(10, this.opts.levels || 1)), p = v.stackPitch;
    const Htot = v.H + (n - 1) * p;                 // 積んだ全体の高さ
    const off = Math.max(v.W, v.depth, v.H) * 0.08, tk = off * 0.18;
    const segs = [];
    const seg = (a, b) => segs.push(a, b);
    const label = (p, text, cls) => {
      const d = document.createElement('div');
      d.className = 'dimlbl ' + cls; d.textContent = text;
      const o = new CSS2DObject(d); o.position.copy(T(p)); this.dimGroup.add(o);
    };
    const f = (x) => String(Math.round(x * 10) / 10);
    // a→b の寸法線。n は端の目印（短い線）の向き
    const dimLine = (a, b, n, text, cls) => {
      seg(a, b);
      for (const p of [a, b]) seg(p.map((x, i) => x - n[i] * tk), p.map((x, i) => x + n[i] * tk));
      label(a.map((x, i) => (x + b[i]) / 2), text, cls);
    };
    let color;
    if (mode === 'out') {
      color = 0x3a2c1e;
      // 幅：前の先端（高さの半分）のさらに手前
      const yw = -v.H / 2 - off;
      seg([-hw, -v.H / 2, v.H / 2], [-hw, yw - tk, v.H / 2]); seg([hw, -v.H / 2, v.H / 2], [hw, yw - tk, v.H / 2]);
      dimLine([-hw, yw, v.H / 2], [hw, yw, v.H / 2], [0, 1, 0], f(v.W), 'out');
      // 横に並べたときは全体の幅（さらに手前）
      const nc = Math.max(1, Math.min(10, this.opts.cols || 1));
      if (nc > 1) {
        const yw2 = yw - off * 0.9, xr = -hw + nc * v.W;
        seg([-hw, yw, v.H / 2], [-hw, yw2 - tk, v.H / 2]); seg([xr, -v.H / 2, v.H / 2], [xr, yw2 - tk, v.H / 2]);
        dimLine([-hw, yw2, v.H / 2], [xr, yw2, v.H / 2], [0, 1, 0], `全体 ${f(nc * v.W)}`, 'out');
      }
      // 奥行（先端まで）：いちばん右の箱の右側、床の高さ
      const xe = hw + (nc - 1) * v.W, xd = xe + off;
      seg([xe, v.D, 0], [xd + tk, v.D, 0]);
      seg([xe, -v.H / 2, v.H / 2], [xe, -v.H / 2, 0]); seg([xe, -v.H / 2, 0], [xd + tk, -v.H / 2, 0]);
      dimLine([xd, -v.H / 2, 0], [xd, v.D, 0], [1, 0, 0], f(v.depth), 'out');
      // 高さ：いちばん右の箱の右後ろの角（積んだときは全体の高さ）
      seg([xe, v.D, Htot], [xd + tk, v.D, Htot]);
      dimLine([xd, v.D, 0], [xd, v.D, Htot], [1, 0, 0], n > 1 ? `全体 ${f(Htot)}` : f(v.H), 'out');
      // 積んだときは1段の高さ（下の箱の底 → 2段目の箱の底）を左後ろの角に
      if (n > 1) {
        const xl = -hw - off;
        seg([-hw, v.D, 0], [xl - tk, v.D, 0]); seg([-hw, v.D, p], [xl - tk, v.D, p]);
        dimLine([xl, v.D, 0], [xl, v.D, p], [1, 0, 0], `1段 ${f(p)}`, 'out');
      }
    } else {
      color = 0x1f5fa8;
      // 積んだときは、いちばん上の箱に出す（上から見える箱）
      const zo = (n - 1) * p;
      const dimLineZ = (a, b, nn, text, cls) => dimLine([a[0], a[1], a[2] + zo], [b[0], b[1], b[2] + zo], nn, text, cls);
      const xi = hw - t, yb = v.D - t, yf = t * S2 - t, zf = t + 0.5;
      const id = v.D - t * S2, ih = v.H - t;
      const m = Math.min(off * 0.6, (v.W - 2 * t) * 0.15);
      // 幅：底面の奥寄り
      const yw = yb - Math.min(off * 0.6, id * 0.2);
      dimLineZ([-xi, yw, zf], [xi, yw, zf], [0, 1, 0], f(v.W - 2 * t), 'in');
      // 奥行（底面）：左寄りの床の上
      dimLineZ([-xi + m, yf, zf], [-xi + m, yb, zf], [1, 0, 0], f(id), 'in');
      // 深さ：左奥の角
      dimLineZ([-xi + m, yb - 0.5, t], [-xi + m, yb - 0.5, v.H], [1, 0, 0], f(ih), 'in');
      // 前板の上端の高さでの奥行（いちばん広いところ、参考）
      const zr = v.H / 2 + t / S2;
      dimLineZ([-xi + m, -v.H / 2 + t / S2, zr], [-xi + m, yb, zr], [1, 0, 0], '前板の上で ' + f(v.depth - t * (1 + 1 / S2)), 'in sub');
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(segs.flatMap((p) => { const q = T(p); return [q.x, q.y, q.z]; }), 3));
    const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true }));
    lines.renderOrder = 10;
    this.dimGroup.add(lines);
  }

  partObject(part, off) {
    const g = new THREE.Group();
    const pos = [], nor = [];
    part.faces.forEach((f) => {
      const n = T(f.n);
      for (let i = 1; i < f.pts.length - 1; i++) {
        [f.pts[0], f.pts[i], f.pts[i + 1]].forEach((p) => { const v = T(p); pos.push(v.x, v.y, v.z); nor.push(n.x, n.y, n.z); });
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    const col = COLORS[part.group];
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: col, roughness: 0.85, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
    g.add(mesh);
    const ep = [];
    part.edges.forEach((e) => { const a = T(e.a), b = T(e.b); ep.push(a.x, a.y, a.z, b.x, b.y, b.z); });
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.Float32BufferAttribute(ep, 3));
    g.add(new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: 0x2a2118 })));
    g.position.copy(T(off));
    return g;
  }

  fit() {
    const b = new THREE.Box3().setFromObject(this.group);
    const c = b.getCenter(new THREE.Vector3());
    const r = b.getSize(new THREE.Vector3()).length() / 2;
    const vf = this.camera.fov * Math.PI / 180;
    const hf = 2 * Math.atan(Math.tan(vf / 2) * this.camera.aspect);
    const dist = r / Math.sin(Math.min(vf, hf) / 2) * 1.05;
    const dir = new THREE.Vector3(0.75, 0.6, 1).normalize();
    this.camera.position.copy(c.clone().add(dir.multiplyScalar(dist)));
    this.camera.near = dist / 100; this.camera.far = dist * 100;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(c);
    this.controls.update();
  }

  // 組立図に貼る立体図（白背景・等角に近い向き）
  snapshot(box) {
    const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
    r.setPixelRatio(1);
    r.setSize(800, 600);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a66, 1.7));
    const dl = new THREE.DirectionalLight(0xffffff, 1.5); dl.position.set(1, 1.6, 1.2); scene.add(dl);
    const save = { ...this.opts };
    const grp = new THREE.Group();
    box.parts.forEach((p) => grp.add(this.partObject(p, [0, 0, 0])));
    scene.add(grp);
    const b = new THREE.Box3().setFromObject(grp);
    const c = b.getCenter(new THREE.Vector3());
    const rad = b.getSize(new THREE.Vector3()).length() / 2;
    const cam = new THREE.OrthographicCamera(-rad * 4 / 3, rad * 4 / 3, rad, -rad, 0.1, rad * 20);
    cam.position.copy(c.clone().add(new THREE.Vector3(1, 0.85, 1.25).normalize().multiplyScalar(rad * 5)));
    cam.lookAt(c);
    cam.zoom = 1.05; cam.updateProjectionMatrix();
    r.render(scene, cam);
    const url = r.domElement.toDataURL('image/png');
    grp.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    r.dispose();
    this.opts = save;
    return url;
  }
}
