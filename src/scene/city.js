/**
 * Coastal-city digital twin.
 *
 * A disc of terrain with a tidal bay, a downtown cluster, parkland, a ring-and-
 * radial road network carrying live traffic pulses, an offshore wind array and
 * a transmission grid. Turbine speed, window-light density, traffic rate and
 * water level are all driven from the live/model state rather than hard-coded,
 * so the model visibly responds to the weather and to the scenario sliders.
 */

import * as THREE from 'three';
import { col, prng, windowMaterial, flowMaterial, flowTube, arcPoints, particleField } from './common.js';

const R = 0.5; // disc radius, metres
const BAY = { x: 0.15, z: 0.08, r: 0.30 };
const DOWNTOWN = { x: -0.14, z: -0.08 };

/** 2-D value noise on a fixed lattice. */
function makeNoise(seed) {
  const rnd = prng(seed);
  const N = 64;
  const grid = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) grid[i] = rnd();
  const at = (x, y) => grid[((y % N) + N) % N * N + (((x % N) + N) % N)];
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return (
      at(xi, yi) * (1 - u) * (1 - v) +
      at(xi + 1, yi) * u * (1 - v) +
      at(xi, yi + 1) * (1 - u) * v +
      at(xi + 1, yi + 1) * u * v
    );
  };
}

const distToBay = (x, z) => Math.hypot(x - BAY.x, z - BAY.z) - BAY.r;

export function buildCity(theme) {
  const rnd = prng(20240711);
  const noise = makeNoise(97);
  const group = new THREE.Group();
  const layers = {};
  const picks = [];
  const anchors = {};

  const accent = col(theme.accent);
  const accent2 = col(theme.accent2);

  // ---------------------------------------------------------------- terrain
  const terrainGroup = new THREE.Group();
  // CircleGeometry only rings its rim, so build the disc by hand to get
  // interior vertices we can displace and colour.
  const RINGS = 40, SEGS = 128;
  const positions = [];
  const colors = [];
  const indices = [];
  const landCol = col(theme.light ? [126, 168, 118] : [58, 104, 66]);
  const grassCol = col(theme.light ? [156, 192, 140] : [76, 128, 82]);
  const sandCol = col(theme.light ? [224, 210, 176] : [176, 158, 122]);
  const rockCol = col(theme.light ? [176, 178, 186] : [86, 94, 108]);
  const bedCol = col(theme.light ? [92, 128, 150] : [22, 46, 68]);

  const heightAt = (x, z) => {
    const d = distToBay(x, z);
    if (d < 0) return -0.012 * Math.min(1, -d / BAY.r) - 0.001; // seabed
    const inland = Math.min(1, d / 0.18);
    const n = noise(x * 26 + 30, z * 26 + 30) * 0.7 + noise(x * 58, z * 58) * 0.3;
    const edgeFall = Math.min(1, (R - Math.hypot(x, z)) / 0.07);
    return (0.004 + n * 0.03) * inland * Math.max(0, edgeFall);
  };

  const vColor = new THREE.Color();
  for (let ri = 0; ri <= RINGS; ri++) {
    const rr = (ri / RINGS) * R;
    for (let si = 0; si < SEGS; si++) {
      const a = (si / SEGS) * Math.PI * 2;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      const y = heightAt(x, z);
      positions.push(x, y, z);

      const d = distToBay(x, z);
      if (d < -0.02) vColor.copy(bedCol);
      else if (d < 0.012) vColor.copy(sandCol);
      else {
        const urban = Math.max(0, 1 - Math.hypot(x - DOWNTOWN.x, z - DOWNTOWN.z) / 0.26);
        vColor.copy(grassCol).lerp(landCol, noise(x * 40, z * 40));
        vColor.lerp(rockCol, Math.pow(urban, 1.6) * 0.8);
      }
      colors.push(vColor.r, vColor.g, vColor.b);
    }
  }
  for (let ri = 0; ri < RINGS; ri++) {
    for (let si = 0; si < SEGS; si++) {
      const a = ri * SEGS + si;
      const b = ri * SEGS + ((si + 1) % SEGS);
      const cIdx = (ri + 1) * SEGS + si;
      const d = (ri + 1) * SEGS + ((si + 1) % SEGS);
      indices.push(a, cIdx, b, b, cIdx, d);
    }
  }
  const landGeo = new THREE.BufferGeometry();
  landGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  landGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  landGeo.setIndex(indices);
  landGeo.computeVertexNormals();
  const land = new THREE.Mesh(
    landGeo,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.02, flatShading: false })
  );
  terrainGroup.add(land);

  // Skirt: a short wall so the disc has thickness from the side.
  const skirtGeo = new THREE.CylinderGeometry(R, R * 0.97, 0.028, SEGS, 1, true);
  const skirt = new THREE.Mesh(
    skirtGeo,
    new THREE.MeshStandardMaterial({
      color: theme.light ? 0xb9c2cf : 0x2b3648, roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide,
    })
  );
  skirt.position.y = -0.014;
  terrainGroup.add(skirt);

  // ------------------------------------------------------------------ water
  const waterMat = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      uTime: { value: 0 },
      uShallow: { value: col(theme.light ? [104, 176, 200] : [46, 132, 168]) },
      uDeep: { value: col(theme.light ? [40, 96, 140] : [10, 44, 78]) },
      uFoam: { value: col([230, 246, 255]) },
      uLevel: { value: 0 },
      uBay: { value: new THREE.Vector3(BAY.x, BAY.z, BAY.r) },
    },
    vertexShader: `
      varying vec2 vXZ; varying vec3 vN;
      uniform float uTime;
      void main(){
        // CircleGeometry lies in local XY and the mesh is rotated −90° about X,
        // so local (x, y, z) lands at world (x, z, −y): the bay test needs
        // (x, −y), and the swell has to displace local z.
        vec3 p = position;
        vXZ = vec2(p.x, -p.y);
        float w = sin(vXZ.x * 62.0 + uTime * 1.6) * 0.0011 + sin(vXZ.y * 47.0 - uTime * 1.2) * 0.0009;
        p.z += w;
        vN = normalize(vec3(-cos(vXZ.x * 62.0 + uTime * 1.6) * 0.07, 1.0, cos(vXZ.y * 47.0 - uTime * 1.2) * 0.055));
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uShallow; uniform vec3 uDeep; uniform vec3 uFoam;
      uniform float uTime; uniform vec3 uBay;
      varying vec2 vXZ; varying vec3 vN;
      void main(){
        float d = length(vXZ - uBay.xy) - uBay.z;
        // inside the bay d is negative; deeper toward the middle
        float depth = clamp(-d / uBay.z, 0.0, 1.0);
        if (d > 0.004) discard;
        vec3 base = mix(uShallow, uDeep, pow(depth, 0.6));
        float shore = smoothstep(0.0, -0.02, d) * (1.0 - smoothstep(-0.03, -0.05, d));
        float foam = shore * (0.45 + 0.55 * sin(uTime * 2.2 + vXZ.x * 90.0 + vXZ.y * 70.0));
        float spec = pow(max(0.0, vN.y), 24.0) * 0.25;
        gl_FragColor = vec4(base + uFoam * foam * 0.5 + spec, 0.82 + shore * 0.18);
      }`,
  });
  const water = new THREE.Mesh(new THREE.CircleGeometry(R * 0.999, 160), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.0005;
  water.renderOrder = 2;
  terrainGroup.add(water);
  layers.terrain = terrainGroup;
  group.add(terrainGroup);

  anchors.bay = new THREE.Vector3(BAY.x, 0.01, BAY.z);

  // -------------------------------------------------------------- buildings
  const buildings = [];
  const isLand = (x, z) => distToBay(x, z) > 0.016 && Math.hypot(x, z) < R - 0.035;
  for (let i = 0; i < 260; i++) {
    // Rejection-sample toward downtown so density falls off naturally.
    let x, z, tries = 0;
    do {
      const a = rnd() * Math.PI * 2;
      const rr = Math.pow(rnd(), 0.62) * 0.36;
      x = DOWNTOWN.x + Math.cos(a) * rr;
      z = DOWNTOWN.z + Math.sin(a) * rr;
    } while (!isLand(x, z) && ++tries < 12);
    if (!isLand(x, z)) continue;

    const core = Math.max(0, 1 - Math.hypot(x - DOWNTOWN.x, z - DOWNTOWN.z) / 0.3);
    // Peak ≈ 0.09 of the disc radius, i.e. about 450 m at the 1:1000 scale the
    // measure tool reports — dramatic without becoming a spike field.
    const h = (0.008 + Math.pow(core, 2.1) * 0.088 * (0.35 + rnd())) * (0.7 + rnd() * 0.6);
    const w = 0.011 + rnd() * 0.013 * (1.4 - core * 0.5);
    buildings.push({ x, z, y: heightAt(x, z), h, w, d: w * (0.7 + rnd() * 0.7), rot: rnd() * Math.PI });
  }
  buildings.sort((a, b) => b.h - a.h);

  const buildMat = windowMaterial(theme, { rows: 16, cols: 5, lit: 0.5 });
  const buildMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), buildMat, buildings.length);
  const mtx = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const pos = new THREE.Vector3();
  buildings.forEach((b, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.rot);
    scl.set(b.w, b.h, b.d);
    pos.set(b.x, b.y + b.h / 2, b.z);
    buildMesh.setMatrixAt(i, mtx.compose(pos, q, scl));
  });
  buildMesh.instanceMatrix.needsUpdate = true;
  buildMesh.castShadow = false;
  layers.buildings = new THREE.Group();
  layers.buildings.add(buildMesh);
  group.add(layers.buildings);

  const tallest = buildings[0];
  anchors.downtown = new THREE.Vector3(tallest.x, tallest.y + tallest.h + 0.02, tallest.z);
  picks.push({
    object: buildMesh,
    kind: 'district',
    label: 'Central Business District',
    detail: () => [
      ['Buildings', String(buildings.length) + ' modelled'],
      ['Tallest', (tallest.h * 1000).toFixed(0) + ' m @ 1:1000'],
      ['Footprint', '0.28 km² (scaled)'],
      ['Use mix', 'Office 54% · Resi 31% · Retail 15%'],
    ],
  });

  // ------------------------------------------------------------- vegetation
  // One merged tree (trunk + canopy) instanced across the parkland.
  const trunkGeo = new THREE.CylinderGeometry(0.0009, 0.0013, 0.008, 5);
  trunkGeo.translate(0, 0.004, 0);
  const canopyGeo = new THREE.IcosahedronGeometry(0.0055, 0);
  canopyGeo.translate(0, 0.011, 0);
  const treeGeo = mergeGeometries([trunkGeo, canopyGeo]);
  const treeMat = new THREE.MeshStandardMaterial({
    color: theme.light ? 0x6f9e63 : 0x3f7a4a, roughness: 0.88, metalness: 0, flatShading: true,
  });
  const trees = [];
  for (let i = 0; i < 900; i++) {
    const a = rnd() * Math.PI * 2;
    const rr = Math.sqrt(rnd()) * (R - 0.03);
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    if (!isLand(x, z)) continue;
    const core = Math.max(0, 1 - Math.hypot(x - DOWNTOWN.x, z - DOWNTOWN.z) / 0.3);
    if (rnd() < core * 0.85) continue; // downtown is not a forest
    trees.push({ x, z, y: heightAt(x, z), s: 0.6 + rnd() * 0.9, rot: rnd() * Math.PI * 2 });
  }
  const treeMesh = new THREE.InstancedMesh(treeGeo, treeMat, trees.length);
  trees.forEach((t, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot);
    treeMesh.setMatrixAt(i, mtx.compose(pos.set(t.x, t.y, t.z), q, scl.setScalar(t.s)));
  });
  treeMesh.instanceMatrix.needsUpdate = true;
  layers.vegetation = new THREE.Group();
  layers.vegetation.add(treeMesh);
  group.add(layers.vegetation);

  const park = trees[Math.floor(trees.length * 0.4)] ?? { x: -0.3, y: 0.01, z: 0.2 };
  anchors.park = new THREE.Vector3(park.x, park.y + 0.03, park.z);
  picks.push({
    object: treeMesh,
    kind: 'green',
    label: 'Urban canopy',
    detail: (sim) => [
      ['Canopy cover', (sim.env.canopy * 100).toFixed(0) + '%'],
      ['Trees modelled', String(trees.length)],
      ['Cooling effect', '−' + (sim.env.canopy * 3.4).toFixed(1) + ' °C peak'],
      ['Biodiversity', (sim.env.biodiversity * 100).toFixed(0) + '/100'],
    ],
  });

  // --------------------------------------------------------------- turbines
  const turbineGroup = new THREE.Group();
  const rotors = [];
  const towerMat = new THREE.MeshStandardMaterial({ color: 0xeaf0f6, roughness: 0.35, metalness: 0.25 });
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0xf6f9fc, roughness: 0.3, metalness: 0.1, side: THREE.DoubleSide });
  const bladeGeo = new THREE.CapsuleGeometry(0.0012, 0.034, 3, 6);
  bladeGeo.translate(0, 0.019, 0);
  bladeGeo.scale(1, 1, 0.35);

  const turbineSpots = [
    [BAY.x + 0.14, BAY.z - 0.14], [BAY.x + 0.2, BAY.z + 0.03], [BAY.x + 0.08, BAY.z + 0.19],
    [BAY.x - 0.09, BAY.z + 0.2], [BAY.x - 0.02, BAY.z - 0.2], [BAY.x + 0.24, BAY.z - 0.05],
  ].filter(([x, z]) => distToBay(x, z) < -0.01 && Math.hypot(x, z) < R - 0.02);

  turbineSpots.forEach(([x, z], i) => {
    const t = new THREE.Group();
    const height = 0.056 + rnd() * 0.014;
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.0012, 0.0021, height, 8), towerMat);
    tower.position.y = height / 2;
    const nacelle = new THREE.Mesh(new THREE.CapsuleGeometry(0.0024, 0.006, 3, 8), towerMat);
    nacelle.rotation.z = Math.PI / 2;
    nacelle.position.set(0, height, 0.003);
    const hub = new THREE.Group();
    hub.position.set(0, height, 0.008);
    for (let b = 0; b < 3; b++) {
      const blade = new THREE.Mesh(bladeGeo, bladeMat);
      blade.rotation.z = (b / 3) * Math.PI * 2;
      hub.add(blade);
    }
    t.add(tower, nacelle, hub);
    t.position.set(x, 0, z);
    t.rotation.y = -0.4 + rnd() * 0.8;
    turbineGroup.add(t);
    rotors.push({ hub, phase: rnd() * Math.PI * 2 });
    if (i === 0) anchors.wind = new THREE.Vector3(x, height + 0.03, z);
  });
  layers.energy = new THREE.Group();
  layers.energy.add(turbineGroup);
  group.add(layers.energy);

  picks.push({
    object: turbineGroup,
    kind: 'energy',
    label: 'Offshore wind array',
    detail: (sim, weather) => [
      ['Units', String(turbineSpots.length) + ' × 12 MW'],
      ['Wind speed', (weather?.wind ?? 0).toFixed(1) + ' m/s'],
      ['Capacity factor', (sim.energy.windCF * 100).toFixed(0) + '%'],
      ['Output now', sim.energy.windGW.toFixed(2) + ' GW'],
    ],
  });

  // ---------------------------------------------------- transmission arcs
  const gridMat = flowMaterial(accent2, { speed: 0.85, density: 3, glow: 0.9, core: 0.2 });
  const substation = new THREE.Vector3(DOWNTOWN.x + 0.06, heightAt(DOWNTOWN.x + 0.06, DOWNTOWN.z + 0.1) + 0.01, DOWNTOWN.z + 0.1);
  turbineSpots.slice(0, 4).forEach(([x, z]) => {
    const pts = arcPoints(new THREE.Vector3(x, 0.09, z), substation, 0.22, 20);
    layers.energy.add(flowTube(pts, 0.0013, gridMat));
  });
  anchors.grid = substation.clone().setY(substation.y + 0.05);

  // ------------------------------------------------------------- mobility
  const roadMat = flowMaterial(accent, { speed: 0.5, density: 7, glow: 1, core: 0.22 });
  layers.mobility = new THREE.Group();
  const ringRadii = [0.16, 0.27, 0.375];
  ringRadii.forEach((rr, ri) => {
    const pts = [];
    for (let i = 0; i <= 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      const x = DOWNTOWN.x + Math.cos(a) * rr;
      const z = DOWNTOWN.z + Math.sin(a) * rr;
      if (!isLand(x, z)) continue;
      pts.push(new THREE.Vector3(x, heightAt(x, z) + 0.0022, z));
    }
    if (pts.length > 4) layers.mobility.add(flowTube(pts, 0.0011 + ri * 0.0002, roadMat));
  });
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.3;
    const pts = [];
    for (let s = 0; s <= 18; s++) {
      const rr = 0.02 + (s / 18) * 0.42;
      const x = DOWNTOWN.x + Math.cos(a) * rr + Math.sin(s * 0.6) * 0.012;
      const z = DOWNTOWN.z + Math.sin(a) * rr + Math.cos(s * 0.5) * 0.012;
      if (!isLand(x, z)) break;
      pts.push(new THREE.Vector3(x, heightAt(x, z) + 0.0022, z));
    }
    if (pts.length > 4) layers.mobility.add(flowTube(pts, 0.0009, roadMat));
  }
  group.add(layers.mobility);

  anchors.transit = new THREE.Vector3(DOWNTOWN.x, heightAt(DOWNTOWN.x, DOWNTOWN.z) + 0.16, DOWNTOWN.z);
  picks.push({
    object: layers.mobility,
    kind: 'mobility',
    label: 'Mobility network',
    detail: (sim) => [
      ['Congestion', (sim.mobility.congestion * 100).toFixed(0) + '%'],
      ['Transit load', (sim.mobility.transitLoad * 100).toFixed(0) + '%'],
      ['Network', '3 ring · 7 radial corridors'],
      ['On transit', (sim.mobility.transitLoad * 100).toFixed(0) + '% of trips'],
    ],
  });

  // ------------------------------------------------------------ atmosphere
  layers.atmosphere = new THREE.Group();
  const rain = particleField(
    340,
    () => ({ x: (Math.random() - 0.5) * R * 2, y: 0.06 + Math.random() * 0.22, z: (Math.random() - 0.5) * R * 2 }),
    col([170, 210, 255]),
    { size: 1.8, speed: 0.9, gravity: 0.5 }
  );
  rain.mat.uniforms.uOpacity.value = 0;
  layers.atmosphere.add(rain.points);

  // Wind streamers: faint ribbons showing prevailing direction.
  const windMat = flowMaterial(col([180, 220, 255]), { speed: 0.5, density: 2, glow: 0.5, core: 0.06 });
  const streamers = new THREE.Group();
  for (let i = 0; i < 9; i++) {
    const y = 0.06 + rnd() * 0.16;
    const off = (rnd() - 0.5) * 0.7;
    const pts = [];
    for (let s = 0; s <= 12; s++) {
      const tt = s / 12;
      pts.push(new THREE.Vector3(-R * 1.1 + tt * R * 2.2, y + Math.sin(tt * 5 + i) * 0.012, off + Math.sin(tt * 3 + i) * 0.05));
    }
    streamers.add(flowTube(pts, 0.0007, windMat));
  }
  streamers.rotation.y = 0;
  layers.atmosphere.add(streamers);
  group.add(layers.atmosphere);

  // ------------------------------------------------------------------ misc
  layers.grid = new THREE.Group();
  const helper = new THREE.PolarGridHelper(R, 8, 5, 96, col(theme.grid), col(theme.grid));
  helper.material.transparent = true;
  helper.material.opacity = 0.28;
  helper.material.depthWrite = false;
  helper.position.y = 0.001;
  layers.grid.add(helper);
  group.add(layers.grid);

  // ---------------------------------------------------------------- update
  const labelSpecs = [
    { key: 'downtown', title: 'Population', get: (s) => [(s.population).toFixed(2), 'M'] },
    { key: 'wind', title: 'Wind output', get: (s) => [s.energy.windGW.toFixed(2), 'GW'] },
    { key: 'bay', title: 'Water level', get: (s, w) => [(s.water.reservoir * 3.6 - 1.2).toFixed(1), 'm'] },
    { key: 'transit', title: 'Traffic flow', get: (s) => [(s.mobility.flow * 100).toFixed(0), '%'] },
    { key: 'park', title: 'Canopy', get: (s) => [(s.env.canopy * 100).toFixed(0), '%'] },
  ];

  return {
    group,
    layers,
    picks,
    anchors,
    labelSpecs,
    radius: R,
    update(dt, ctx) {
      const { time, sim, weather, layersOn } = ctx;
      waterMat.uniforms.uTime.value = time;
      roadMat.uniforms.uTime.value = time;
      gridMat.uniforms.uTime.value = time;
      windMat.uniforms.uTime.value = time;
      rain.mat.uniforms.uTime.value = time;

      // Traffic pulses run faster when the network is free-flowing.
      roadMat.uniforms.uSpeed.value = 0.18 + (sim?.mobility.flow ?? 0.5) * 0.85;
      roadMat.uniforms.uDensity.value = 4 + (sim?.mobility.congestion ?? 0.4) * 9;
      // Grid pulses track renewable coverage.
      gridMat.uniforms.uSpeed.value = 0.3 + (sim?.energy.coverage ?? 0.5) * 1.3;

      // Rotors spin at the real measured wind speed (rad/s, scaled for legibility).
      const ws = weather?.wind ?? 6;
      const rpm = ws < 3 ? 0 : Math.min(1, (ws - 3) / 9) * 2.6 + 0.25;
      rotors.forEach((r) => (r.hub.rotation.z += dt * rpm));

      // Rain only when it is actually raining.
      const wet = Math.min(1, (weather?.precip ?? 0) / 1.2);
      rain.mat.uniforms.uOpacity.value = THREE.MathUtils.damp(rain.mat.uniforms.uOpacity.value, wet, 3, dt);
      streamers.rotation.y = THREE.MathUtils.degToRad(-(weather?.windDir ?? 270));
      windMat.uniforms.uSpeed.value = 0.15 + Math.min(1.6, ws / 12);

      // Night-time window lighting follows the model's clock.
      const u = buildMat.userData.uniforms;
      if (u) {
        u.uTime.value = time;
        const night = 1 - THREE.MathUtils.clamp((weather?.irradiance ?? 300) / 260, 0, 1);
        u.uLit.value = 0.12 + night * 0.62;
      }

      // Tidal / reservoir level nudges the water plane.
      waterMat.uniforms.uLevel.value = sim?.water.reservoir ?? 0.6;
      water.position.y = 0.0005 + ((sim?.water.reservoir ?? 0.6) - 0.6) * 0.012;

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

/** Minimal geometry merge (position/normal/uv only) to avoid an addon import. */
function mergeGeometries(list) {
  const out = new THREE.BufferGeometry();
  const attrs = ['position', 'normal', 'uv'];
  const buffers = {};
  const index = [];
  let offset = 0;
  for (const g of list) {
    const nonIndexed = g.index ? g.toNonIndexed() : g;
    for (const a of attrs) {
      const src = nonIndexed.attributes[a];
      if (!src) continue;
      (buffers[a] ??= []).push(...src.array);
    }
    const count = nonIndexed.attributes.position.count;
    for (let i = 0; i < count; i++) index.push(offset + i);
    offset += count;
  }
  for (const a of attrs) {
    if (!buffers[a]) continue;
    const size = a === 'uv' ? 2 : 3;
    out.setAttribute(a, new THREE.Float32BufferAttribute(buffers[a], size));
  }
  out.setIndex(index);
  return out;
}
