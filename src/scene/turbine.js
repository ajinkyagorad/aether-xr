/**
 * Turbine XJ-9 — engineering teardown.
 *
 * A direct-drive generator assembly rendered as the boards show it: solid metal
 * under a blueprint wireframe, with a live exploded-view axis, spinning rotor
 * stages, a thermal gradient across the hot section, and vibration-driven
 * highlighting on whichever component is currently out of tolerance.
 */

import * as THREE from 'three';
import { col, prng, flowMaterial, flowTube, particleField } from './common.js';

const LEN = 0.62;

export function buildTurbine(theme) {
  const rnd = prng(4242);
  const group = new THREE.Group();
  const layers = {};
  const picks = [];
  const anchors = {};

  const steel = (c, rough = 0.32, metal = 0.85) =>
    new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal });

  /** Components carry an `explode` axis offset applied by the update loop. */
  const parts = [];
  const addPart = (mesh, { explode = 0, name, spin = 0 } = {}) => {
    mesh.userData.homeX = mesh.position.x;
    parts.push({ mesh, explode, name, spin });
    return mesh;
  };

  // --------------------------------------------------------------- housing
  layers.buildings = new THREE.Group(); // "structure"
  const housingMat = steel(theme.light ? 0xc8d2de : 0x5a6779, 0.34, 0.8);
  const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.135, 0.24, 48, 1, true), housingMat);
  housing.rotation.z = Math.PI / 2;
  housing.position.x = 0.02;
  housing.material.side = THREE.DoubleSide;
  addPart(housing, { explode: 0, name: 'Stator housing' });
  layers.buildings.add(housing);

  // Cooling fins around the housing.
  const finGeo = new THREE.BoxGeometry(0.2, 0.016, 0.004);
  const finMat = steel(theme.light ? 0xb4bfcd : 0x46525f, 0.42, 0.7);
  const fins = new THREE.InstancedMesh(finGeo, finMat, 36);
  const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), vv = new THREE.Vector3();
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    qq.setFromEuler(new THREE.Euler(a, 0, 0));
    vv.set(0.02, Math.cos(a) * 0.128, Math.sin(a) * 0.128);
    m4.compose(vv, qq, new THREE.Vector3(1, 1, 1));
    fins.setMatrixAt(i, m4);
  }
  fins.instanceMatrix.needsUpdate = true;
  addPart(fins, { explode: 0.02, name: 'Cooling fins' });
  layers.buildings.add(fins);

  // Intake bell and exhaust cone.
  const intake = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.115, 0.1, 40, 1, true), housingMat);
  intake.rotation.z = Math.PI / 2;
  intake.position.x = -0.17;
  intake.material.side = THREE.DoubleSide;
  addPart(intake, { explode: -0.12, name: 'Intake' });
  layers.buildings.add(intake);

  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.085, 0.14, 40, 1, true), housingMat.clone());
  exhaust.rotation.z = Math.PI / 2;
  exhaust.position.x = 0.21;
  exhaust.material.side = THREE.DoubleSide;
  addPart(exhaust, { explode: 0.14, name: 'Exhaust cone' });
  layers.buildings.add(exhaust);
  group.add(layers.buildings);

  picks.push({
    object: layers.buildings,
    kind: 'housing',
    label: 'Stator housing & casing',
    detail: () => [
      ['Material', 'Inconel 718 / GFRP shroud'],
      ['Bore', '230 mm'],
      ['Cooling', '36-fin forced convection'],
      ['Service hours', '18 240 since overhaul'],
    ],
  });

  // ----------------------------------------------------------------- shaft
  layers.terrain = new THREE.Group(); // "rotating assembly"
  const shaftMat = steel(theme.light ? 0xe2e8f0 : 0x9aa7b8, 0.22, 0.95);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, LEN, 24), shaftMat);
  shaft.rotation.z = Math.PI / 2;
  addPart(shaft, { explode: 0, name: 'Main shaft', spin: 1 });
  layers.terrain.add(shaft);

  // Rotor stages: successively larger discs of aerofoil blades.
  const rotors = [];
  const bladeGeo = new THREE.BoxGeometry(0.012, 0.052, 0.006);
  bladeGeo.translate(0, 0.052, 0);
  const STAGES = [
    { x: -0.13, r: 0.062, n: 22, tint: 0xbcc9d8 },
    { x: -0.055, r: 0.078, n: 26, tint: 0xc6d2e0 },
    { x: 0.025, r: 0.09, n: 30, tint: 0xd0dbe8 },
    { x: 0.105, r: 0.1, n: 34, tint: 0xdae3ee },
  ];
  STAGES.forEach((st, si) => {
    const stage = new THREE.Group();
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(st.r * 0.34, st.r * 0.34, 0.018, 24), shaftMat);
    hub.rotation.z = Math.PI / 2;
    stage.add(hub);

    const bMat = steel(st.tint, 0.24, 0.9);
    const blades = new THREE.InstancedMesh(bladeGeo, bMat, st.n);
    for (let i = 0; i < st.n; i++) {
      const a = (i / st.n) * Math.PI * 2;
      const e = new THREE.Euler(a, 0.42, 0); // stagger angle
      qq.setFromEuler(e);
      m4.compose(vv.set(0, 0, 0), qq, new THREE.Vector3(1, st.r / 0.052, 1));
      blades.setMatrixAt(i, m4);
    }
    blades.instanceMatrix.needsUpdate = true;
    stage.add(blades);
    stage.position.x = st.x;
    addPart(stage, { explode: (si - 1.5) * 0.055, name: `Rotor stage ${si + 1}`, spin: 1 });
    layers.terrain.add(stage);
    rotors.push({ stage, blades, mat: bMat, spec: st });
  });

  // Bearings at both ends.
  [-0.26, 0.26].forEach((x, i) => {
    const bearing = new THREE.Mesh(
      new THREE.TorusGeometry(0.032, 0.011, 12, 32),
      steel(theme.light ? 0x9fabbb : 0x3d4a5a, 0.4, 0.9)
    );
    bearing.rotation.y = Math.PI / 2;
    bearing.position.x = x;
    addPart(bearing, { explode: x * 0.5, name: `Bearing ${i + 1}` });
    layers.terrain.add(bearing);
  });
  group.add(layers.terrain);
  anchors.rotor = new THREE.Vector3(0.025, 0.115, 0);
  anchors.shaft = new THREE.Vector3(-0.26, 0.06, 0);

  picks.push({
    object: layers.terrain,
    kind: 'rotor',
    label: 'Rotating assembly',
    detail: (sim) => [
      ['Stages', '4 axial'],
      ['Blades', String(STAGES.reduce((a, s) => a + s.n, 0))],
      ['Speed', (3000 + sim.energy.windCF * 3600).toFixed(0) + ' rpm'],
      ['Balance', 'G2.5 (ISO 1940)'],
    ],
  });

  // ------------------------------------------------------------- wireframe
  // A blueprint overlay of the same silhouette, exactly as in the boards.
  layers.grid = new THREE.Group();
  const wireMat = new THREE.MeshBasicMaterial({
    color: col(theme.accent), wireframe: true, transparent: true, opacity: 0.16,
    depthWrite: false, toneMapped: false,
  });
  const wireShell = new THREE.Mesh(new THREE.CylinderGeometry(0.145, 0.145, 0.58, 28, 8, true), wireMat);
  wireShell.rotation.z = Math.PI / 2;
  layers.grid.add(wireShell);
  const wireEnd = new THREE.Mesh(new THREE.TorusGeometry(0.145, 0.001, 6, 48), wireMat);
  wireEnd.rotation.y = Math.PI / 2;
  wireEnd.position.x = -0.29;
  const wireEnd2 = wireEnd.clone();
  wireEnd2.position.x = 0.29;
  layers.grid.add(wireEnd, wireEnd2);
  group.add(layers.grid);

  // -------------------------------------------------------------- gas path
  layers.mobility = new THREE.Group();
  const gasMat = flowMaterial(col(theme.accent), { speed: 1.4, density: 6, glow: 1, core: 0.12 });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const rr = 0.055 + rnd() * 0.045;
    const pts = [];
    for (let s = 0; s <= 16; s++) {
      const t = s / 16;
      // gas swirls as it passes through the stages
      const ang = a + t * 2.4;
      pts.push(new THREE.Vector3(-0.3 + t * 0.62, Math.cos(ang) * rr * (1 + t * 0.35), Math.sin(ang) * rr * (1 + t * 0.35)));
    }
    layers.mobility.add(flowTube(pts, 0.0016, gasMat));
  }
  group.add(layers.mobility);

  picks.push({
    object: layers.mobility,
    kind: 'flow',
    label: 'Gas path',
    detail: (sim) => [
      ['Mass flow', (28 + sim.energy.windCF * 22).toFixed(1) + ' kg/s'],
      ['Pressure ratio', '17.4 : 1'],
      ['Exit temp', (480 + sim.energy.windCF * 140).toFixed(0) + ' °C'],
      ['Swirl', '38° at stage 4'],
    ],
  });

  // ------------------------------------------------------------ thermal map
  layers.atmosphere = new THREE.Group();
  const thermalMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uHeat: { value: 0.6 } },
    vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      varying vec3 vP; uniform float uTime; uniform float uHeat;
      void main(){
        // hot section sits aft of the mid-stage; ramp along the axis
        float t = clamp((vP.y + 0.29) / 0.58, 0.0, 1.0);
        float heat = smoothstep(0.35, 1.0, t) * uHeat;
        vec3 cold = vec3(0.1, 0.4, 0.9);
        vec3 warm = vec3(1.0, 0.55, 0.1);
        vec3 hot  = vec3(1.0, 0.92, 0.7);
        vec3 cc = mix(cold, warm, smoothstep(0.0, 0.6, heat));
        cc = mix(cc, hot, smoothstep(0.6, 1.0, heat));
        float pulse = 0.85 + 0.15 * sin(uTime * 2.0 + t * 8.0);
        gl_FragColor = vec4(cc, heat * 0.5 * pulse);
      }`,
  });
  const thermal = new THREE.Mesh(new THREE.CylinderGeometry(0.152, 0.152, 0.58, 32, 12, true), thermalMat);
  thermal.rotation.z = Math.PI / 2;
  thermal.renderOrder = 7;
  layers.atmosphere.add(thermal);

  const sparks = particleField(
    120,
    () => ({ x: 0.24 + Math.random() * 0.16, y: (Math.random() - 0.5) * 0.13, z: (Math.random() - 0.5) * 0.13 }),
    col([255, 190, 120]),
    { size: 2.2, speed: 0.8 }
  );
  sparks.mat.uniforms.uOpacity.value = 0.5;
  layers.atmosphere.add(sparks.points);
  group.add(layers.atmosphere);

  // --------------------------------------------------------- sensor pins
  layers.vegetation = new THREE.Group(); // slot reused for "instrumentation"
  const sensors = [];
  const SENSORS = [
    { name: 'Vibration · bearing 1', x: -0.26, tone: 'good' },
    { name: 'EGT · stage 4', x: 0.14, tone: 'warn' },
    { name: 'Oil pressure', x: -0.05, tone: 'good' },
    { name: 'Tip clearance', x: 0.06, tone: 'good' },
  ];
  SENSORS.forEach((sp, i) => {
    const a = (i / SENSORS.length) * Math.PI * 2 + 0.4;
    const tone = { good: theme.good, warn: theme.warn, bad: theme.bad }[sp.tone];
    const pin = new THREE.Group();
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.005, 10, 8),
      new THREE.MeshBasicMaterial({ color: col(tone), toneMapped: false })
    );
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.009, 0.012, 20),
      new THREE.MeshBasicMaterial({
        color: col(tone), transparent: true, opacity: 0.6, side: THREE.DoubleSide,
        depthWrite: false, toneMapped: false,
      })
    );
    pin.add(dot, ring);
    pin.position.set(sp.x, Math.cos(a) * 0.15, Math.sin(a) * 0.15);
    layers.vegetation.add(pin);
    sensors.push({ pin, ring, phase: rnd() * 6, spec: sp });
  });
  group.add(layers.vegetation);
  anchors.sensor = new THREE.Vector3(0.14, 0.17, 0);

  picks.push({
    object: layers.vegetation,
    kind: 'sensor',
    label: 'Instrumentation',
    detail: () => [
      ['Channels', '4 live · 28 logged'],
      ['Sample rate', '2 kHz vibration'],
      ['Alarms', '1 advisory (EGT margin)'],
      ['Last calibration', '31 days ago'],
    ],
  });

  layers.energy = layers.mobility; // shares the flow slot

  const labelSpecs = [
    { key: 'rotor', title: 'Shaft speed', get: (s) => [(3000 + s.energy.windCF * 3600).toFixed(0), 'rpm'] },
    { key: 'sensor', title: 'Exhaust temp', get: (s) => [(480 + s.energy.windCF * 140).toFixed(0), '°C'] },
    { key: 'shaft', title: 'Vibration', get: (s) => [(1.2 + (1 - s.energy.coverage) * 2.4).toFixed(1), 'mm/s'] },
  ];

  /** 0 = assembled, 1 = fully exploded. Driven by the Section tool. */
  let explodeAmt = 0;

  return {
    group, layers, picks, anchors, labelSpecs, radius: LEN * 0.55,
    setExplode(v) { explodeAmt = THREE.MathUtils.clamp(v, 0, 1); },
    update(dt, ctx) {
      const { time, sim, layersOn, tool } = ctx;
      gasMat.uniforms.uTime.value = time;
      thermalMat.uniforms.uTime.value = time;
      sparks.mat.uniforms.uTime.value = time;

      // The Section tool pulls the assembly apart along its axis.
      const want = tool === 'section' ? 1 : 0;
      explodeAmt = THREE.MathUtils.damp(explodeAmt, want, 4, dt);
      for (const p of parts) {
        p.mesh.position.x = p.mesh.userData.homeX + p.explode * explodeAmt * 3.2;
      }
      wireMat.opacity = 0.1 + explodeAmt * 0.22;

      // Load drives speed, temperature and the flow rate together.
      const load = sim ? 0.35 + sim.energy.coverage * 0.65 : 0.6;
      const omega = load * 7.5;
      for (const p of parts) if (p.spin) p.mesh.rotation.x += dt * omega;
      thermalMat.uniforms.uHeat.value = THREE.MathUtils.damp(thermalMat.uniforms.uHeat.value, 0.25 + load * 0.75, 2, dt);
      gasMat.uniforms.uSpeed.value = 0.6 + load * 2.2;
      sparks.mat.uniforms.uOpacity.value = Math.max(0, load - 0.55) * 1.1;

      sensors.forEach((s) => {
        const pulse = 0.85 + 0.4 * Math.sin(time * 2.4 + s.phase);
        s.ring.scale.setScalar(pulse);
        s.ring.material.opacity = 0.2 + 0.45 * (1.35 - pulse);
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
