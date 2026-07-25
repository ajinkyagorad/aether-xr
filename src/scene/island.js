/**
 * Cloud-forest ecosystem model.
 *
 * A floating island: layered rock strata tapering to a root, a plateau with a
 * tarn feeding a waterfall over the lip, a canopy of instanced trees, drifting
 * mist and pollen, and animal markers whose activity follows the model clock.
 */

import * as THREE from 'three';
import { col, prng, flowMaterial, flowTube, particleField } from './common.js';

const R = 0.42;

export function buildIsland(theme) {
  const rnd = prng(8675309);
  const group = new THREE.Group();
  const layers = {};
  const picks = [];
  const anchors = {};

  // --------------------------------------------------------------- landmass
  // A lathe profile gives the classic tapering underside in one mesh.
  const profile = [];
  const STEPS = 26;
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    // top plateau → shoulder → long taper to a point below
    const r = t < 0.12 ? R * (1 - Math.pow(t / 0.12, 2) * 0.04)
      : R * Math.pow(1 - (t - 0.12) / 0.88, 0.72) * (1 + Math.sin(t * 14) * 0.035);
    const y = 0.055 - t * 0.42;
    profile.push(new THREE.Vector2(Math.max(0.001, r), y));
  }
  const rockGeo = new THREE.LatheGeometry(profile, 96);
  // Roughen the silhouette so it does not read as a machined cone.
  {
    const p = rockGeo.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const n = Math.sin(v.x * 41 + v.z * 29) * Math.cos(v.y * 37) * 0.5 + 0.5;
      const amt = 1 + (n - 0.5) * 0.09 * (v.y < 0.04 ? 1 : 0.25);
      p.setXYZ(i, v.x * amt, v.y + (n - 0.5) * 0.004, v.z * amt);
    }
    rockGeo.computeVertexNormals();
  }
  const rockMat = new THREE.MeshStandardMaterial({
    color: theme.light ? 0x8d8477 : 0x4a4237, roughness: 0.95, metalness: 0.02, flatShading: true,
  });
  // Strata: emissive bands keyed to depth, painted through the standard shader.
  rockMat.onBeforeCompile = (sh) => {
    sh.uniforms.uMoss = { value: col(theme.light ? [126, 168, 108] : [72, 118, 68]) };
    sh.uniforms.uStrata = { value: col([120, 96, 74]) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n varying float vY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vY = position.y;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n uniform vec3 uMoss; uniform vec3 uStrata; varying float vY;')
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
         float band = abs(sin(vY * 92.0)) * 0.5 + 0.5;
         gl_FragColor.rgb = mix(gl_FragColor.rgb, uStrata, band * 0.16 * smoothstep(0.03, -0.2, vY));
         // moss creeps over the top and the upper shoulder
         gl_FragColor.rgb = mix(gl_FragColor.rgb, uMoss, smoothstep(-0.02, 0.05, vY) * 0.55);`
      );
  };
  const rock = new THREE.Mesh(rockGeo, rockMat);
  layers.terrain = new THREE.Group();
  layers.terrain.add(rock);

  // ------------------------------------------------------------------ tarn
  const tarnMat = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      uTime: { value: 0 },
      uShallow: { value: col([120, 190, 190]) },
      uDeep: { value: col([26, 82, 96]) },
    },
    vertexShader: `
      varying vec2 vUv; uniform float uTime;
      void main(){
        vUv = uv; vec3 p = position;
        p.z += sin(p.x * 90.0 + uTime * 1.4) * 0.0008;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      varying vec2 vUv; uniform vec3 uShallow; uniform vec3 uDeep; uniform float uTime;
      void main(){
        float d = length(vUv - 0.5) * 2.0;
        vec3 base = mix(uDeep, uShallow, smoothstep(0.2, 1.0, d));
        float rip = sin(d * 46.0 - uTime * 2.4) * 0.5 + 0.5;
        gl_FragColor = vec4(base + rip * 0.06, 0.9 - d * 0.18);
      }`,
  });
  const tarn = new THREE.Mesh(new THREE.CircleGeometry(0.085, 48), tarnMat);
  tarn.rotation.x = -Math.PI / 2;
  tarn.position.set(-0.08, 0.058, -0.05);
  layers.terrain.add(tarn);
  anchors.water = tarn.position.clone().add(new THREE.Vector3(0, 0.03, 0));
  group.add(layers.terrain);

  // -------------------------------------------------------------- waterfall
  const fallMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uColor: { value: col([206, 236, 244]) }, uOpacity: { value: 0.75 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      varying vec2 vUv; uniform float uTime; uniform vec3 uColor; uniform float uOpacity;
      float h(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
      void main(){
        // vertical streaks scrolling downward, thinning as they fall
        vec2 uv = vec2(vUv.x, vUv.y + uTime * 0.55);
        float streak = h(vec2(floor(uv.x * 34.0), floor(uv.y * 5.0)));
        float fine = smoothstep(0.35, 1.0, fract(uv.y * 4.0 + streak * 3.0));
        float body = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
        float fade = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.35, vUv.y);
        gl_FragColor = vec4(uColor, (0.35 + fine * 0.65) * body * fade * uOpacity);
      }`,
  });
  const fall = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.3, 1, 1), fallMat);
  fall.position.set(-0.135, -0.07, -0.115);
  fall.rotation.y = 0.7;
  fall.renderOrder = 6;
  layers.terrain.add(fall);

  // Spray at the lip and where it disperses into cloud.
  const spray = particleField(
    180,
    () => ({
      x: -0.135 + (Math.random() - 0.5) * 0.09,
      y: -0.2 + Math.random() * 0.12,
      z: -0.115 + (Math.random() - 0.5) * 0.07,
    }),
    col([220, 244, 250]),
    { size: 3.4, speed: 0.35 }
  );
  spray.mat.uniforms.uOpacity.value = 0.5;
  layers.terrain.add(spray.points);

  // Stream feeding the fall.
  const streamMat = flowMaterial(col([160, 220, 230]), { speed: 0.7, density: 3, glow: 0.8, core: 0.35 });
  layers.mobility = new THREE.Group();
  layers.mobility.add(
    flowTube(
      [
        new THREE.Vector3(-0.09, 0.057, -0.09),
        new THREE.Vector3(-0.11, 0.056, -0.11),
        new THREE.Vector3(-0.128, 0.054, -0.118),
        new THREE.Vector3(-0.14, 0.05, -0.122),
      ],
      0.004,
      streamMat
    )
  );
  group.add(layers.mobility);

  // ------------------------------------------------------------------ trees
  const trunkGeo = new THREE.CylinderGeometry(0.0016, 0.0026, 0.03, 5);
  trunkGeo.translate(0, 0.015, 0);
  const canopyGeo = new THREE.IcosahedronGeometry(0.016, 1);
  canopyGeo.scale(1, 0.82, 1);
  canopyGeo.translate(0, 0.04, 0);

  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4432, roughness: 0.95, flatShading: true });
  const leafMat = new THREE.MeshStandardMaterial({
    color: theme.light ? 0x6fae63 : 0x3e8a52, roughness: 0.82, flatShading: true,
  });
  const spots = [];
  for (let i = 0; i < 260; i++) {
    const a = rnd() * Math.PI * 2;
    const rr = Math.sqrt(rnd()) * (R - 0.035);
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    if (Math.hypot(x + 0.08, z + 0.05) < 0.1) continue; // keep the tarn clear
    spots.push({ x, z, s: 0.55 + rnd() * 0.95, rot: rnd() * 6.3 });
  }
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
  const canopies = new THREE.InstancedMesh(canopyGeo, leafMat, spots.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s3 = new THREE.Vector3(), p3 = new THREE.Vector3();
  spots.forEach((t, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot);
    m.compose(p3.set(t.x, 0.05, t.z), q, s3.setScalar(t.s));
    trunks.setMatrixAt(i, m);
    canopies.setMatrixAt(i, m);
  });
  trunks.instanceMatrix.needsUpdate = true;
  canopies.instanceMatrix.needsUpdate = true;
  layers.vegetation = new THREE.Group();
  layers.vegetation.add(trunks, canopies);
  group.add(layers.vegetation);
  anchors.canopy = new THREE.Vector3(0.16, 0.14, 0.1);

  picks.push({
    object: canopies,
    kind: 'canopy',
    label: 'Montane canopy',
    detail: (sim) => [
      ['Stems modelled', String(spots.length)],
      ['Canopy closure', (sim.env.canopy * 100).toFixed(0) + '%'],
      ['Soil moisture', (sim.env.soil * 100).toFixed(0) + '%'],
      ['Species richness', (sim.env.biodiversity * 180).toFixed(0) + ' est.'],
    ],
  });
  picks.push({
    object: tarn,
    kind: 'water',
    label: 'Summit tarn',
    detail: (sim) => [
      ['Volume', (sim.water.reservoir * 42).toFixed(1) + ' × 10³ m³'],
      ['Outflow', (0.4 + sim.water.reservoir * 1.9).toFixed(2) + ' m³/s'],
      ['Turbidity', sim.env.soil > 0.6 ? 'Low' : 'Moderate'],
      ['Feeds', 'Cascade → cloud layer'],
    ],
  });

  // ------------------------------------------------------------------- mist
  layers.atmosphere = new THREE.Group();
  const mist = particleField(
    320,
    () => {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * R * 1.25;
      return { x: Math.cos(a) * r, y: -0.05 + Math.random() * 0.14, z: Math.sin(a) * r };
    },
    col([214, 232, 236]),
    { size: 9, speed: 0.1 }
  );
  mist.mat.uniforms.uOpacity.value = 0.3;
  layers.atmosphere.add(mist.points);

  const pollen = particleField(
    160,
    () => {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * R;
      return { x: Math.cos(a) * r, y: 0.06 + Math.random() * 0.18, z: Math.sin(a) * r };
    },
    col(theme.accent2),
    { size: 2.4, speed: 0.3 }
  );
  layers.atmosphere.add(pollen.points);
  group.add(layers.atmosphere);

  // ------------------------------------------------------------- fauna pins
  layers.buildings = new THREE.Group(); // slot reused for "observations"
  const fauna = [];
  const FAUNA = [
    { name: 'Resplendent quetzal', ico: 'fish', y: 0.14 },
    { name: 'Spectacled bear', ico: 'leaf', y: 0.075 },
    { name: 'Glass frog', ico: 'droplet', y: 0.07 },
    { name: 'Orchid bee', ico: 'sparkle', y: 0.11 },
  ];
  FAUNA.forEach((f, i) => {
    const a = (i / FAUNA.length) * Math.PI * 2 + 0.6;
    const rr = 0.2 + rnd() * 0.14;
    const pinGroup = new THREE.Group();
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.005, 12, 10),
      new THREE.MeshBasicMaterial({ color: col(theme.accent2), toneMapped: false })
    );
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(0.008, 0.011, 24),
      new THREE.MeshBasicMaterial({
        color: col(theme.accent2), transparent: true, opacity: 0.6,
        side: THREE.DoubleSide, depthWrite: false, toneMapped: false,
      })
    );
    halo.rotation.x = -Math.PI / 2;
    pinGroup.add(dot, halo);
    pinGroup.position.set(Math.cos(a) * rr, f.y, Math.sin(a) * rr);
    layers.buildings.add(pinGroup);
    fauna.push({ pinGroup, halo, phase: rnd() * 6, spec: f });
  });
  group.add(layers.buildings);

  picks.push({
    object: layers.buildings,
    kind: 'fauna',
    label: 'Species observations',
    detail: (sim) => [
      ['Tagged', String(FAUNA.length) + ' indicator species'],
      ['Last survey', 'Continuous acoustic'],
      ['Habitat score', (sim.env.biodiversity * 100).toFixed(0) + '/100'],
      ['Trend', sim.env.biodiversity > 0.55 ? 'Stable' : 'Declining'],
    ],
  });

  layers.energy = new THREE.Group();
  group.add(layers.energy);
  layers.grid = new THREE.Group();
  group.add(layers.grid);

  const labelSpecs = [
    { key: 'canopy', title: 'Canopy closure', get: (s) => [(s.env.canopy * 100).toFixed(0), '%'] },
    { key: 'water', title: 'Tarn level', get: (s) => [(s.water.reservoir * 100).toFixed(0), '%'] },
  ];

  return {
    group, layers, picks, anchors, labelSpecs, radius: R,
    update(dt, ctx) {
      const { time, sim, weather, layersOn } = ctx;
      tarnMat.uniforms.uTime.value = time;
      fallMat.uniforms.uTime.value = time;
      streamMat.uniforms.uTime.value = time;
      mist.mat.uniforms.uTime.value = time;
      pollen.mat.uniforms.uTime.value = time;
      spray.mat.uniforms.uTime.value = time;

      // Discharge follows reservoir level: the fall visibly thins in drought.
      const flow = sim?.water.reservoir ?? 0.6;
      fallMat.uniforms.uOpacity.value = 0.25 + flow * 0.7;
      fall.scale.x = 0.55 + flow * 0.7;
      streamMat.uniforms.uSpeed.value = 0.25 + flow * 0.9;

      // Mist thickens with humidity, thins in sun.
      const humid = (weather?.humidity ?? 70) / 100;
      mist.mat.uniforms.uOpacity.value = THREE.MathUtils.damp(
        mist.mat.uniforms.uOpacity.value, 0.1 + humid * 0.45, 2, dt
      );
      // Pollen is a daytime phenomenon.
      const daylight = THREE.MathUtils.clamp((weather?.irradiance ?? 200) / 400, 0, 1);
      pollen.mat.uniforms.uOpacity.value = 0.15 + daylight * 0.6;

      fauna.forEach((f) => {
        const pulse = 0.8 + 0.5 * Math.sin(time * 1.6 + f.phase);
        f.halo.scale.setScalar(pulse);
        f.halo.material.opacity = 0.25 + 0.4 * (1.4 - pulse);
        f.pinGroup.position.y += Math.sin(time * 0.8 + f.phase) * dt * 0.004;
      });

      if (layersOn) for (const k in layers) if (layers[k]) layers[k].visible = layersOn[k] !== false;
    },
    dispose() {
      group.traverse((o) => {
        o.geometry?.dispose?.();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((mm) => mm.dispose());
      });
    },
  };
}
