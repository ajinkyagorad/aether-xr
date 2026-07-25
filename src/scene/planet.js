/**
 * Planetary survey model.
 *
 * A displaced sphere shaded from procedural fBm (basins, highlands, polar
 * volatiles), wrapped in an atmospheric shell, with orbiter tracks that carry
 * live spacecraft and a terminator that tracks the model clock.
 */

import * as THREE from 'three';
import { col, prng, flowMaterial, flowTube, particleField } from './common.js';

const R = 0.34;

const FBM = `
  float hash31(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float vnoise(vec3 p){
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = hash31(i), n100 = hash31(i + vec3(1,0,0));
    float n010 = hash31(i + vec3(0,1,0)), n110 = hash31(i + vec3(1,1,0));
    float n001 = hash31(i + vec3(0,0,1)), n101 = hash31(i + vec3(1,0,1));
    float n011 = hash31(i + vec3(0,1,1)), n111 = hash31(i + vec3(1,1,1));
    return mix(mix(mix(n000,n100,f.x), mix(n010,n110,f.x), f.y),
               mix(mix(n001,n101,f.x), mix(n011,n111,f.x), f.y), f.z);
  }
  float fbm(vec3 p){
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 5; i++){ s += a * vnoise(p); p *= 2.03; a *= 0.5; }
    return s;
  }`;

export function buildPlanet(theme) {
  const rnd = prng(31337);
  const group = new THREE.Group();
  const layers = {};
  const picks = [];
  const anchors = {};

  // ----------------------------------------------------------------- body
  const surfaceMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(1, 0.35, 0.5).normalize() },
      uLow: { value: col([92, 44, 30]) },
      uMid: { value: col([176, 104, 66]) },
      uHigh: { value: col([222, 176, 138]) },
      uIce: { value: col([228, 240, 250]) },
      uScan: { value: col(theme.accent) },
      uScanAmt: { value: 0.35 },
      uIceLine: { value: 0.78 },
    },
    vertexShader: `
      ${FBM}
      varying vec3 vN; varying vec3 vPos; varying float vH;
      void main(){
        vPos = normalize(position);
        // relief displacement: broad basins plus fine ridging
        float h = fbm(vPos * 2.4) * 0.7 + fbm(vPos * 7.0) * 0.3;
        vH = h;
        vec3 p = position * (1.0 + (h - 0.5) * 0.05);
        vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uSunDir; uniform vec3 uLow; uniform vec3 uMid; uniform vec3 uHigh;
      uniform vec3 uIce; uniform vec3 uScan; uniform float uScanAmt; uniform float uTime;
      uniform float uIceLine;
      varying vec3 vN; varying vec3 vPos; varying float vH;
      void main(){
        vec3 base = mix(uLow, uMid, smoothstep(0.35, 0.58, vH));
        base = mix(base, uHigh, smoothstep(0.58, 0.78, vH));
        // volatile caps toward the poles
        float lat = abs(vPos.y);
        base = mix(base, uIce, smoothstep(uIceLine, uIceLine + 0.12, lat + vH * 0.08));

        float lambert = max(0.06, dot(normalize(vN), normalize(uSunDir)));
        // soft terminator rather than a hard edge
        lambert = smoothstep(-0.12, 0.55, dot(normalize(vN), normalize(uSunDir))) * 0.9 + 0.1;
        vec3 lit = base * (0.22 + lambert * 1.15);

        // survey graticule + a sweeping scan line
        float gx = smoothstep(0.975, 1.0, abs(sin(atan(vPos.z, vPos.x) * 12.0)));
        float gy = smoothstep(0.975, 1.0, abs(sin(asin(clamp(vPos.y,-1.0,1.0)) * 12.0)));
        lit += uScan * max(gx, gy) * uScanAmt * 0.35;
        float sweep = smoothstep(0.02, 0.0, abs(vPos.y - sin(uTime * 0.25) * 0.9));
        lit += uScan * sweep * uScanAmt * 0.8;
        gl_FragColor = vec4(lit, 1.0);
      }`,
  });
  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(R, 48), surfaceMat);
  layers.terrain = new THREE.Group();
  layers.terrain.add(body);
  group.add(layers.terrain);
  anchors.surface = new THREE.Vector3(R * 0.7, R * 0.7, 0);

  picks.push({
    object: body,
    kind: 'surface',
    label: 'Candidate landing basin',
    detail: () => [
      ['Elevation', '−2 840 m datum'],
      ['Slope', '3.1° mean'],
      ['Regolith', 'Basaltic sand, low cohesion'],
      ['Hazard score', 'Low (0.18)'],
    ],
  });

  // ---------------------------------------------------------- atmosphere
  const atmoMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: col([210, 140, 100]) },
      uSunDir: { value: surfaceMat.uniforms.uSunDir.value },
      uPower: { value: 3.2 },
    },
    vertexShader: `
      varying vec3 vN; varying vec3 vWorld;
      void main(){
        vN = normalize(normalMatrix * normal);
        vWorld = normalize((modelMatrix * vec4(position,1.0)).xyz);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform vec3 uSunDir; uniform float uPower;
      varying vec3 vN; varying vec3 vWorld;
      void main(){
        float rim = pow(1.0 - abs(dot(normalize(vN), vec3(0.0,0.0,1.0))), uPower);
        float sun = max(0.15, dot(normalize(vWorld), normalize(uSunDir)) * 0.5 + 0.5);
        gl_FragColor = vec4(uColor * sun, rim * 0.85);
      }`,
  });
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.055, 48, 32), atmoMat);
  atmo.renderOrder = 7;
  layers.atmosphere = new THREE.Group();
  layers.atmosphere.add(atmo);

  // Dust haze wrapping the equator.
  const dust = particleField(
    260,
    () => {
      const a = Math.random() * Math.PI * 2;
      const r = R * (1.02 + Math.random() * 0.06);
      const y = (Math.random() - 0.5) * R * 0.9;
      return { x: Math.cos(a) * r, y, z: Math.sin(a) * r };
    },
    col([230, 180, 140]),
    { size: 1.6, speed: 0.15 }
  );
  dust.mat.uniforms.uOpacity.value = 0.45;
  layers.atmosphere.add(dust.points);
  group.add(layers.atmosphere);

  // ------------------------------------------------------------- orbiters
  layers.energy = new THREE.Group(); // reuse the "network" layer slot
  const orbiters = [];
  const ORBITS = [
    { r: R * 1.42, tilt: 0.28, speed: 0.30, name: 'Reconnaissance', ico: 'satellite' },
    { r: R * 1.72, tilt: -0.62, speed: 0.21, name: 'Relay', ico: 'satellite' },
    { r: R * 2.05, tilt: 1.15, speed: 0.15, name: 'Polar mapper', ico: 'satellite' },
  ];
  const trackMat = flowMaterial(col(theme.accent), { speed: 0.4, density: 2, glow: 0.8, core: 0.16 });
  ORBITS.forEach((o, i) => {
    const pts = [];
    for (let s = 0; s <= 64; s++) {
      const a = (s / 64) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * o.r, 0, Math.sin(a) * o.r));
    }
    const track = flowTube(pts, 0.0011, trackMat, { closed: true });
    const holder = new THREE.Group();
    holder.rotation.set(o.tilt, i * 0.7, o.tilt * 0.4);
    holder.add(track);

    const sat = new THREE.Group();
    const bus = new THREE.Mesh(
      new THREE.BoxGeometry(0.012, 0.009, 0.009),
      new THREE.MeshStandardMaterial({ color: 0xd8e2ee, roughness: 0.35, metalness: 0.6 })
    );
    const panelMat = new THREE.MeshStandardMaterial({
      color: 0x1b3d6b, roughness: 0.25, metalness: 0.5,
      emissive: new THREE.Color(0x0a2a55), emissiveIntensity: 0.6,
    });
    const pL = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.0012, 0.008), panelMat);
    pL.position.x = -0.018;
    const pR = pL.clone();
    pR.position.x = 0.018;
    sat.add(bus, pL, pR);
    holder.add(sat);
    layers.energy.add(holder);
    orbiters.push({ sat, orbit: o, phase: rnd() * Math.PI * 2 });
  });
  group.add(layers.energy);
  anchors.orbit = new THREE.Vector3(0, R * 1.6, 0);

  picks.push({
    object: layers.energy,
    kind: 'orbit',
    label: 'Orbital assets',
    detail: () => [
      ['Active craft', String(ORBITS.length)],
      ['Lowest orbit', (R * 0.42 * 1000).toFixed(0) + ' km altitude'],
      ['Relay window', '11 min every 2.1 h'],
      ['Downlink', '2.4 Mbit/s aggregate'],
    ],
  });

  // ---------------------------------------------------------------- moons
  layers.vegetation = new THREE.Group(); // slot reused for "companions"
  const moons = [];
  [{ r: 0.028, d: R * 2.6, s: 0.11, c: 0x9aa3ad }, { r: 0.017, d: R * 3.4, s: 0.07, c: 0x7f8792 }].forEach((m, i) => {
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(m.r, 2),
      new THREE.MeshStandardMaterial({ color: m.c, roughness: 0.95, flatShading: true })
    );
    // lumpy, not spherical
    const p = mesh.geometry.attributes.position;
    for (let v = 0; v < p.count; v++) {
      const s = 0.86 + rnd() * 0.28;
      p.setXYZ(v, p.getX(v) * s, p.getY(v) * s, p.getZ(v) * s);
    }
    mesh.geometry.computeVertexNormals();
    const holder = new THREE.Group();
    holder.rotation.z = (i === 0 ? 0.2 : -0.35);
    mesh.position.x = m.d;
    holder.add(mesh);
    layers.vegetation.add(holder);
    moons.push({ holder, speed: m.s, phase: rnd() * 6 });
  });
  group.add(layers.vegetation);

  // ------------------------------------------------------- landing sites
  layers.mobility = new THREE.Group();
  const sites = [];
  for (let i = 0; i < 6; i++) {
    const lat = (rnd() - 0.5) * 1.6;
    const lon = rnd() * Math.PI * 2;
    const dir = new THREE.Vector3(
      Math.cos(lat) * Math.cos(lon),
      Math.sin(lat),
      Math.cos(lat) * Math.sin(lon)
    );
    const marker = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.008, 0.011, 24),
      new THREE.MeshBasicMaterial({
        color: col(i === 0 ? theme.accent2 : theme.accent),
        transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, toneMapped: false,
      })
    );
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0006, 0.0006, 0.05, 4),
      new THREE.MeshBasicMaterial({ color: col(theme.accent), transparent: true, opacity: 0.5, toneMapped: false })
    );
    stem.position.y = 0.025;
    marker.add(ring, stem);
    marker.position.copy(dir).multiplyScalar(R * 1.01);
    marker.lookAt(dir.clone().multiplyScalar(R * 2));
    marker.rotateX(Math.PI / 2);
    ring.rotation.x = Math.PI / 2;
    layers.mobility.add(marker);
    sites.push({ marker, dir, phase: rnd() * 6 });
    if (i === 0) anchors.site = dir.clone().multiplyScalar(R * 1.18);
  }
  group.add(layers.mobility);

  layers.buildings = layers.mobility; // no separate built layer on a survey
  layers.grid = new THREE.Group();
  group.add(layers.grid);

  const labelSpecs = [
    { key: 'surface', title: 'Surface temp', get: (s, w) => [(-63 + (w?.temp ?? 10) * 0.2).toFixed(0), '°C'] },
    { key: 'orbit', title: 'Craft in view', get: () => ['3', ''] },
    { key: 'site', title: 'Site score', get: (s) => [(s.env.ecosystem * 100).toFixed(0), '/100'] },
  ];

  return {
    group, layers, picks, anchors, labelSpecs, radius: R * 2.2,
    update(dt, ctx) {
      const { time, sim, weather, layersOn } = ctx;
      surfaceMat.uniforms.uTime.value = time;
      trackMat.uniforms.uTime.value = time;
      dust.mat.uniforms.uTime.value = time;

      // The sun sweeps with the model clock, so the terminator is meaningful.
      const sunAngle = (ctx.timeOfDay ?? 0.4) * Math.PI * 2;
      surfaceMat.uniforms.uSunDir.value.set(Math.cos(sunAngle), 0.32, Math.sin(sunAngle)).normalize();

      // Ice line retreats as the modelled climate warms.
      surfaceMat.uniforms.uIceLine.value = 0.68 + (1 - (sim?.env.ecosystem ?? 0.5)) * 0.18;
      body.rotation.y += dt * 0.035;

      orbiters.forEach((o) => {
        o.phase += dt * o.orbit.speed;
        o.sat.position.set(Math.cos(o.phase) * o.orbit.r, 0, Math.sin(o.phase) * o.orbit.r);
        o.sat.lookAt(0, 0, 0);
      });
      moons.forEach((m) => {
        m.phase += dt * m.speed;
        m.holder.rotation.y = m.phase;
      });
      sites.forEach((s, i) => {
        const pulse = 0.85 + 0.35 * Math.sin(time * 2 + s.phase);
        s.marker.children[0].scale.setScalar(pulse);
      });
      // Dust storms respond to modelled wind.
      dust.mat.uniforms.uOpacity.value = 0.25 + Math.min(0.6, (weather?.wind ?? 5) / 18);

      if (layersOn) for (const k in layers) if (layers[k]) layers[k].visible = layersOn[k] !== false;
    },
    dispose() {
      group.traverse((o) => {
        o.geometry?.dispose?.();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      });
    },
  };
}
