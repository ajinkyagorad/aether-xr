/**
 * A curved glass panel: two canvases (body + additive glow) mapped onto a
 * cylindrically-bent plane, with pixel-space hit testing for pinch rays and
 * fingertip pokes.
 */

import * as THREE from 'three';
import { Painter } from './draw.js';

/**
 * Canvas pixels per metre.
 *
 * Quest 3 resolves roughly 19 screen px per degree. A panel `w` metres wide at
 * `d` metres subtends `w/d` radians, so it covers about `1090·w/d` screen px —
 * meaning one canvas pixel lands on `1090/(PPM·d)` screen pixels. At PPM 1150
 * and a typical 1.2 m reading distance that is ~0.8, which keeps type close to
 * 1:1 with the display while still leaving a little headroom for supersampling
 * on panels the user leans into.
 */
export const PPM = 1150;

/**
 * Bend a plane around a vertical cylinder so the edges wrap toward the viewer.
 * `bend` is the cylinder radius in metres; 0 keeps the panel flat.
 */
export function curvedPlaneGeometry(w, h, bend = 1.6, segX = 24, segY = 2) {
  const geo = new THREE.PlaneGeometry(w, h, segX, segY);
  if (bend > 0) {
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const a = x / bend;
      pos.setX(i, bend * Math.sin(a));
      pos.setZ(i, bend * (1 - Math.cos(a)));
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  }
  return geo;
}

let _uid = 0;

export class Panel {
  /**
   * @param {object} opts
   * @param {number} opts.w  width in metres
   * @param {number} opts.h  height in metres
   * @param {number} [opts.bend] cylinder radius; 0 = flat
   * @param {number} [opts.ppm] canvas resolution override
   */
  constructor({ w, h, bend = 1.5, ppm = PPM, name = 'panel', glow = true }) {
    this.id = `p${++_uid}`;
    this.name = name;
    this.w = w;
    this.h = h;
    this.bend = bend;
    this.cw = Math.max(8, Math.round(w * ppm));
    this.ch = Math.max(8, Math.round(h * ppm));

    this.base = document.createElement('canvas');
    this.base.width = this.cw;
    this.base.height = this.ch;
    this.bctx = this.base.getContext('2d');

    this.useGlow = glow;
    if (glow) {
      this.glowC = document.createElement('canvas');
      this.glowC.width = this.cw;
      this.glowC.height = this.ch;
      this.gctx = this.glowC.getContext('2d');
    }

    this.baseTex = new THREE.CanvasTexture(this.base);
    this.baseTex.colorSpace = THREE.SRGBColorSpace;
    this.baseTex.anisotropy = 8;
    this.baseTex.minFilter = THREE.LinearMipmapLinearFilter;
    this.baseTex.generateMipmaps = true;

    const geo = curvedPlaneGeometry(w, h, bend);
    this.group = new THREE.Group();
    this.group.name = name;

    this.baseMat = new THREE.MeshBasicMaterial({
      map: this.baseTex,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      side: THREE.FrontSide,
    });
    this.mesh = new THREE.Mesh(geo, this.baseMat);
    this.mesh.renderOrder = 20;
    this.mesh.userData.panel = this;
    this.group.add(this.mesh);

    if (glow) {
      this.glowTex = new THREE.CanvasTexture(this.glowC);
      this.glowTex.colorSpace = THREE.SRGBColorSpace;
      this.glowMat = new THREE.MeshBasicMaterial({
        map: this.glowTex,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        opacity: 1,
      });
      this.glowMesh = new THREE.Mesh(geo, this.glowMat);
      this.glowMesh.renderOrder = 21;
      this.glowMesh.position.z = 0.0012; // beat z-fighting with the body
      this.group.add(this.glowMesh);
    }

    /** @type {(p: Painter) => void} */
    this.render = () => {};
    this.hits = [];
    this.dirty = true;
    this.hover = new Map(); // id -> 0..1
    this.pressed = null;
    this.visible = true;
    this.opacity = 0;
    this.targetOpacity = 1;
    this.theme = null;
    // Seed the material/visibility state from opacity 0. Without this a panel
    // that starts hidden never runs applyOpacity (its opacity already equals
    // its target) and stays stuck visible.
    this.applyOpacity();
  }

  get object3D() {
    return this.group;
  }

  setTheme(theme) {
    this.theme = theme;
    this.dirty = true;
  }

  markDirty() {
    this.dirty = true;
  }

  /** Set the paint callback; it receives a `Painter` each repaint. */
  content(fn) {
    this.render = fn;
    this.dirty = true;
    return this;
  }

  /** Place the panel on a sphere around the user: yaw/pitch in degrees. */
  placePolar(yawDeg, pitchDeg, dist, { roll = 0, faceUser = true } = {}) {
    const yaw = THREE.MathUtils.degToRad(yawDeg);
    const pitch = THREE.MathUtils.degToRad(pitchDeg);
    this.group.position.set(
      Math.sin(yaw) * Math.cos(pitch) * dist,
      Math.sin(pitch) * dist,
      -Math.cos(yaw) * Math.cos(pitch) * dist
    );
    if (faceUser) {
      this.group.rotation.set(0, 0, 0);
      // For non-camera objects three's lookAt orients +Z *toward* the target,
      // which is exactly what a panel wants: its face turns to the user.
      this.group.lookAt(0, 0, 0);
      this.group.rotateZ(THREE.MathUtils.degToRad(roll));
    }
    this.homePosition = this.group.position.clone();
    this.homeQuaternion = this.group.quaternion.clone();
    return this;
  }

  // ---------------------------------------------------------------- painting

  repaint() {
    if (!this.theme) return;
    const t = this.theme;

    this.hits = [];
    this.bctx.clearRect(0, 0, this.cw, this.ch);
    const bp = new Painter(this.bctx, t, 'base', this.hits);
    bp.panel = this;
    this.bctx.save();
    this.render(bp);
    this.bctx.restore();
    this.baseTex.needsUpdate = true;

    if (this.useGlow) {
      this.gctx.clearRect(0, 0, this.cw, this.ch);
      const gp = new Painter(this.gctx, t, 'glow', null);
      gp.panel = this;
      this.gctx.save();
      this.render(gp);
      this.gctx.restore();
      // Bloom substitute: blur the emissive layer in place, then punch it up.
      const blur = t.glowBlur;
      this.gctx.save();
      this.gctx.globalCompositeOperation = 'copy';
      this.gctx.filter = `blur(${blur}px)`;
      this.gctx.drawImage(this.glowC, 0, 0);
      this.gctx.filter = 'none';
      this.gctx.globalCompositeOperation = 'lighter';
      this.gctx.globalAlpha = 0.55;
      this.gctx.drawImage(this.glowC, 0, 0);
      this.gctx.restore();
      this.glowTex.needsUpdate = true;
    }
    this.dirty = false;
  }

  // ------------------------------------------------------------- interaction

  hoverAmount(id) {
    return this.hover.get(id) ?? 0;
  }

  /** Convert a UV from a raycast into canvas pixel coordinates. */
  uvToPixel(uv) {
    return { x: uv.x * this.cw, y: (1 - uv.y) * this.ch };
  }

  /** Convert a point in panel-local space to canvas pixels (used for pokes). */
  localToPixel(local) {
    let u;
    if (this.bend > 0) {
      const s = THREE.MathUtils.clamp(local.x / this.bend, -1, 1);
      u = (this.bend * Math.asin(s)) / this.w + 0.5;
    } else {
      u = local.x / this.w + 0.5;
    }
    const v = 0.5 - local.y / this.h;
    return { x: u * this.cw, y: v * this.ch, u, v };
  }

  /** Surface depth (local z) of the curve at a given local x. */
  surfaceZ(localX) {
    if (this.bend <= 0) return 0;
    const s = THREE.MathUtils.clamp(localX / this.bend, -1, 1);
    return this.bend * (1 - Math.sqrt(1 - s * s));
  }

  /** @returns the hit region under a canvas pixel, or null. */
  regionAt(px, py) {
    // Topmost-last wins: later widgets paint over earlier ones.
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const r = this.hits[i];
      if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return r;
    }
    return null;
  }

  /** Advance hover easing; returns true when a repaint is needed. */
  tick(dt, activeIds) {
    let need = false;
    const seen = new Set(activeIds);
    for (const r of this.hits) {
      const want = seen.has(r.id) ? 1 : 0;
      const cur = this.hover.get(r.id) ?? 0;
      if (Math.abs(cur - want) > 0.004) {
        const next = THREE.MathUtils.damp(cur, want, 18, dt);
        this.hover.set(r.id, Math.abs(next - want) < 0.01 ? want : next);
        need = true;
      }
    }
    for (const id of seen) if (!this.hover.has(id)) { this.hover.set(id, 0); need = true; }

    // entrance / dismissal easing
    const wantOp = this.visible ? this.targetOpacity : 0;
    if (Math.abs(this.opacity - wantOp) > 0.002) {
      this.opacity = THREE.MathUtils.damp(this.opacity, wantOp, 9, dt);
      this.applyOpacity();
    } else if (this.opacity !== wantOp) {
      this.opacity = wantOp;
      this.applyOpacity();
    }
    return need;
  }

  applyOpacity() {
    const o = THREE.MathUtils.clamp(this.opacity, 0, 1);
    this.baseMat.opacity = o;
    if (this.glowMat) this.glowMat.opacity = o * o;
    const s = 0.94 + 0.06 * o;
    this.group.scale.setScalar(s);
    this.group.visible = o > 0.01;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.baseMat.dispose();
    this.baseTex.dispose();
    if (this.glowMat) {
      this.glowMat.dispose();
      this.glowTex.dispose();
    }
  }
}
