/**
 * Shared building blocks for every hologram: the plinth it stands on, the
 * containment dome, flow ribbons, energy arcs and floating labels.
 *
 * All of it is procedural. Nothing is downloaded, so the model is sharp at any
 * scale the user pinches it to and the whole app stays a ~200 kB payload.
 */

import * as THREE from 'three';
import { radialSprite } from '../core/input.js';

export const col = (t) => new THREE.Color(t[0] / 255, t[1] / 255, t[2] / 255);

/** Deterministic PRNG so a model rebuilds identically for the same seed. */
export function prng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// plinth
// ---------------------------------------------------------------------------

/**
 * The floating base disc: a soft-shouldered cylinder, an emissive rim ring, a
 * ground-glow sprite and a slowly-rotating tick scale.
 */
export function buildPlinth(theme, radius = 0.5) {
  const g = new THREE.Group();
  const accent = col(theme.accent);
  const accent2 = col(theme.accent2);

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius * 0.965, radius * 0.075, 96, 1),
    new THREE.MeshPhysicalMaterial({
      color: theme.light ? 0xf3f6fb : 0x182436,
      roughness: 0.22,
      metalness: 0.1,
      transmission: theme.light ? 0.25 : 0,
      transparent: true,
      opacity: theme.light ? 0.92 : 0.86,
      clearcoat: 1,
      clearcoatRoughness: 0.16,
    })
  );
  body.position.y = -radius * 0.045;
  g.add(body);

  // Emissive rim: a thin torus riding the top edge.
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 0.998, radius * 0.008, 8, 128),
    new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.95, toneMapped: false })
  );
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = -radius * 0.008;
  g.add(rim);

  // Halo on the ground beneath.
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: radialSprite(0, 2.6), color: accent, transparent: true,
      opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending,
    })
  );
  halo.scale.setScalar(radius * 2.4);
  halo.position.y = -radius * 0.1;
  g.add(halo);

  // Under-glow disc so the plinth looks lit from within.
  const under = new THREE.Mesh(
    new THREE.CircleGeometry(radius * 1.05, 64),
    new THREE.MeshBasicMaterial({
      map: radialSprite(0.1, 3.2), color: accent2, transparent: true,
      opacity: 0.24, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    })
  );
  under.rotation.x = -Math.PI / 2;
  under.position.y = -radius * 0.1;
  g.add(under);

  // A rotating measurement collar — the detail that makes it read as an instrument.
  const ticks = new THREE.Group();
  const tickGeo = new THREE.BoxGeometry(radius * 0.004, radius * 0.004, radius * 0.05);
  const tickMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.55, toneMapped: false });
  const tickMesh = new THREE.InstancedMesh(tickGeo, tickMat, 72);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const long = i % 6 === 0;
    m.makeRotationY(-a);
    m.setPosition(Math.sin(a) * radius * 1.09, 0, Math.cos(a) * radius * 1.09);
    m.scale(new THREE.Vector3(long ? 2.4 : 1, 1, long ? 1.8 : 1));
    tickMesh.setMatrixAt(i, m);
  }
  tickMesh.instanceMatrix.needsUpdate = true;
  ticks.add(tickMesh);
  g.add(ticks);

  return { group: g, ticks, rim, halo, radius };
}

// ---------------------------------------------------------------------------
// containment dome
// ---------------------------------------------------------------------------

/** Fresnel shell with a faint latitude/longitude weave. */
export function buildDome(theme, radius = 0.56) {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: col(theme.accent) },
      uColor2: { value: col(theme.accent2) },
      uTime: { value: 0 },
      uStrength: { value: 1 },
    },
    vertexShader: `
      varying vec3 vN; varying vec3 vView; varying vec2 vUv;
      void main(){
        vUv = uv;
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform vec3 uColor2; uniform float uTime; uniform float uStrength;
      varying vec3 vN; varying vec3 vView; varying vec2 vUv;
      void main(){
        // Sharpened falloff keeps the shell as a rim of light rather than a
        // wash that greys out the model behind it.
        float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vView))), 4.2);
        float lon = smoothstep(0.9955, 1.0, abs(sin(vUv.x * 3.14159 * 24.0)));
        float lat = smoothstep(0.9955, 1.0, abs(sin(vUv.y * 3.14159 * 14.0)));
        float grid = max(lon, lat) * 0.075;
        // a scan band sweeping up the shell
        float scan = smoothstep(0.012, 0.0, abs(fract(vUv.y - uTime * 0.06) - 0.5)) * 0.5;
        vec3 tint = mix(uColor, uColor2, vUv.y);
        // Keep the shell as a rim of light: the model has to stay the subject.
        float a = (fres * 0.22 + grid + scan * 0.14) * uStrength;
        gl_FragColor = vec4(tint, clamp(a, 0.0, 0.42));
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 32), mat);
  mesh.renderOrder = 8;
  return { mesh, mat };
}

// ---------------------------------------------------------------------------
// flow ribbons
// ---------------------------------------------------------------------------

/**
 * A tube along a curve with energy pulses running down it. Used for roads,
 * transmission lines, orbital tracks and river courses.
 */
export function flowMaterial(color, { speed = 0.6, density = 5, glow = 1, core = 0.35 } = {}) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: color instanceof THREE.Color ? color : col(color) },
      uTime: { value: 0 },
      uSpeed: { value: speed },
      uDensity: { value: density },
      uGlow: { value: glow },
      uCore: { value: core },
    },
    vertexShader: `
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uTime; uniform float uSpeed;
      uniform float uDensity; uniform float uGlow; uniform float uCore;
      varying vec2 vUv;
      void main(){
        // pulses travelling along the tube's length (u), plus a constant core
        float t = fract(vUv.x * uDensity - uTime * uSpeed);
        float pulse = pow(smoothstep(0.0, 0.35, t) * smoothstep(1.0, 0.55, t), 2.0);
        // fade both ends so tubes don't terminate abruptly
        float ends = smoothstep(0.0, 0.06, vUv.x) * smoothstep(1.0, 0.94, vUv.x);
        float a = (uCore + pulse * 1.5) * ends * uGlow;
        gl_FragColor = vec4(uColor * (0.7 + pulse), a);
      }`,
  });
}

/** Tube mesh along a list of points. */
export function flowTube(points, radius, material, { segs = null, closed = false } = {}) {
  const curve = new THREE.CatmullRomCurve3(points, closed, 'catmullrom', 0.4);
  const geo = new THREE.TubeGeometry(curve, segs ?? Math.max(16, points.length * 6), radius, 6, closed);
  const mesh = new THREE.Mesh(geo, material);
  mesh.renderOrder = 6;
  return mesh;
}

/** Arc between two points, bulging along +Y — power lines, data links, hops. */
export function arcPoints(a, b, lift = 0.35, steps = 24) {
  const mid = a.clone().add(b).multiplyScalar(0.5);
  mid.y += a.distanceTo(b) * lift;
  const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
  return curve.getPoints(steps);
}

// ---------------------------------------------------------------------------
// floating labels
// ---------------------------------------------------------------------------

/**
 * A small billboarded readout pinned to a point on the model, with a leader
 * line back to its anchor — the callouts in the concept boards.
 */
export function makeLabel(theme, { title, value, unit = '', width = 0.13 }) {
  const ppm = 1500;
  const h = width * 0.44;
  const cv = document.createElement('canvas');
  cv.width = Math.round(width * ppm);
  cv.height = Math.round(h * ppm);
  const ctx = cv.getContext('2d');

  const paint = (t, titleTxt, valueTxt, unitTxt) => {
    const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    const r = Math.min(H * 0.32, 18);
    ctx.beginPath();
    ctx.roundRect(1, 1, W - 2, H - 2, r);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, `rgba(${t.glassTop.join(',')},${t.glassA * 0.95})`);
    g.addColorStop(1, `rgba(${t.glass.join(',')},${t.glassA * 0.8})`);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = `rgba(${t.edge.join(',')},${t.edgeA})`;
    ctx.stroke();

    ctx.textBaseline = 'middle';
    ctx.fillStyle = `rgba(${t.ink2.join(',')},0.92)`;
    ctx.font = `600 ${H * 0.2}px ${t.font}`;
    ctx.letterSpacing = `${H * 0.2 * t.track}px`;
    ctx.fillText(String(titleTxt).toUpperCase(), H * 0.28, H * 0.33);

    ctx.letterSpacing = '0px';
    ctx.fillStyle = `rgba(${t.ink.join(',')},1)`;
    ctx.font = `500 ${H * 0.34}px ${t.font}`;
    const vw = ctx.measureText(String(valueTxt)).width;
    ctx.fillText(String(valueTxt), H * 0.28, H * 0.68);
    if (unitTxt) {
      ctx.fillStyle = `rgba(${t.accent.join(',')},0.95)`;
      ctx.font = `600 ${H * 0.2}px ${t.font}`;
      ctx.fillText(unitTxt, H * 0.28 + vw + H * 0.08, H * 0.71);
    }
  };
  paint(theme, title, value, unit);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, h), mat);
  mesh.renderOrder = 12;

  const group = new THREE.Group();
  group.add(mesh);

  // Leader line + anchor dot, drawn toward the model.
  const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const line = new THREE.Line(
    lineGeo,
    new THREE.LineBasicMaterial({ color: col(theme.accent), transparent: true, opacity: 0.5, depthWrite: false })
  );
  line.renderOrder = 11;

  const dot = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: radialSprite(0, 2), color: col(theme.accent), transparent: true,
      opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending,
    })
  );
  dot.scale.setScalar(0.018);

  return {
    group, mesh, line, dot, tex, canvas: cv,
    /** Repaint with new numbers without reallocating anything. */
    set(t, titleTxt, valueTxt, unitTxt) {
      paint(t, titleTxt, valueTxt, unitTxt);
      tex.needsUpdate = true;
    },
    setLeader(from, to) {
      const p = lineGeo.attributes.position;
      p.setXYZ(0, from.x, from.y, from.z);
      p.setXYZ(1, to.x, to.y, to.z);
      p.needsUpdate = true;
      lineGeo.computeBoundingSphere();
      dot.position.copy(to);
    },
  };
}

// ---------------------------------------------------------------------------
// misc
// ---------------------------------------------------------------------------

/** Additive point-cloud emitter used for rain, dust, spores and sparks. */
export function particleField(n, boundsFn, color, { size = 2.6, speed = 0.2, gravity = 0 } = {}) {
  const pos = new Float32Array(n * 3);
  const seed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = boundsFn(i / n);
    pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
    seed[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 }, uColor: { value: color instanceof THREE.Color ? color : col(color) },
      uSize: { value: size }, uSpeed: { value: speed }, uGravity: { value: gravity }, uOpacity: { value: 1 },
    },
    vertexShader: `
      attribute float aSeed; varying float vA;
      uniform float uTime; uniform float uSize; uniform float uSpeed; uniform float uGravity;
      void main(){
        vec3 p = position;
        float t = uTime * uSpeed + aSeed * 10.0;
        p.y -= uGravity * fract(t) * 0.6;
        p.x += sin(t * 1.7 + aSeed * 20.0) * 0.012;
        p.z += cos(t * 1.3 + aSeed * 26.0) * 0.012;
        vA = uGravity > 0.0 ? (1.0 - fract(t)) : (0.45 + 0.55 * sin(t * 2.0));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float dist = -mv.z;
        gl_Position = projectionMatrix * mv;
        // Capped so a particle passing near the eye can't smear the screen.
        gl_PointSize = min(22.0, uSize * 60.0 / max(0.25, dist));
        vA *= smoothstep(0.18, 0.5, dist);
      }`,
    fragmentShader: `
      varying float vA; uniform vec3 uColor; uniform float uOpacity;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        gl_FragColor = vec4(uColor, smoothstep(0.5, 0.0, d) * abs(vA) * uOpacity);
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return { points: pts, mat };
}

/**
 * Standard material with an emissive window grid injected — the trick that
 * makes instanced boxes read as inhabited buildings rather than grey blocks.
 */
export function windowMaterial(theme, { rows = 14, cols = 6, lit = 0.55 } = {}) {
  const mat = new THREE.MeshStandardMaterial({
    color: theme.light ? 0xe3eaf4 : 0x50627e,
    roughness: 0.42,
    metalness: 0.22,
  });
  mat.userData.uniforms = null;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uWindow = { value: col(theme.accent).lerp(new THREE.Color(0xfff2cf), 0.45) };
    shader.uniforms.uLit = { value: lit };
    shader.uniforms.uRows = { value: rows };
    shader.uniforms.uCols = { value: cols };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n varying vec3 vLocalPos; varying vec3 vLocalNormal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n vLocalPos = position; vLocalNormal = normal;`);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uTime; uniform vec3 uWindow; uniform float uLit;
         uniform float uRows; uniform float uCols;
         varying vec3 vLocalPos; varying vec3 vLocalNormal;
         float h21(vec2 p){ return fract(sin(dot(p, vec2(41.7, 289.3))) * 43758.5453); }`
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
         // Only the vertical faces get windows; roofs stay clean.
         float side = 1.0 - abs(vLocalNormal.y);
         if (side > 0.5) {
           vec2 face = abs(vLocalNormal.x) > 0.5 ? vLocalPos.zy : vLocalPos.xy;
           vec2 gridUv = vec2(face.x * uCols, face.y * uRows);
           vec2 cell = floor(gridUv);
           vec2 f = fract(gridUv);
           float pane = step(0.18, f.x) * step(f.x, 0.82) * step(0.24, f.y) * step(f.y, 0.76);
           float on = step(1.0 - uLit, h21(cell));
           // a few windows flicker as occupants come and go
           on *= step(0.5, 0.5 + 0.5 * sin(uTime * 0.6 + h21(cell + 3.1) * 40.0) + 0.35);
           gl_FragColor.rgb += uWindow * pane * on * 0.85;
         }`
      );
    mat.userData.uniforms = shader.uniforms;
  };
  return mat;
}
