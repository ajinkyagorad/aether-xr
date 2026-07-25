/**
 * Environment & the passthrough dimmer.
 *
 * On Quest 3 the passthrough camera feed is composited *behind* whatever we
 * draw, so "dimming reality" means painting an opaque shell around the user and
 * ramping its alpha. That shell has to land behind every other object, which the
 * normal transparent sort can't guarantee — so it lives in its own scene that is
 * rendered first, with the depth buffer cleared between the two passes.
 *
 * The dimmer is a continuous 0..1: at 0 you are in your room, at 1 you are
 * sealed inside a starfield. Everything else here (stars, haze, floor grid)
 * fades in against that same curve so there is no visible switch-over point.
 */

import * as THREE from 'three';
import { radialSprite } from './input.js';

const col = (t) => new THREE.Color(t[0] / 255, t[1] / 255, t[2] / 255);

export class Environment {
  constructor(scene) {
    this.scene = scene;
    this.bgScene = new THREE.Scene();
    this.dim = 0;
    this.targetDim = 0;

    // ---- enclosing shell ------------------------------------------------
    this.shellMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        uTop: { value: col([4, 10, 22]) },
        uBottom: { value: col([10, 23, 48]) },
        uOpacity: { value: 0 },
        uTime: { value: 0 },
      },
      vertexShader: `
        varying vec3 vDir;
        void main(){
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 uTop; uniform vec3 uBottom; uniform float uOpacity; uniform float uTime;
        varying vec3 vDir;
        // cheap value noise for a slow nebula drift
        float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
        float noise(vec3 p){
          vec3 i = floor(p), f = fract(p);
          f = f*f*(3.0-2.0*f);
          float n = mix(mix(mix(hash(i), hash(i+vec3(1,0,0)), f.x),
                            mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
                        mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x),
                            mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z);
          return n;
        }
        void main(){
          float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 base = mix(uBottom, uTop, pow(h, 0.85));
          float n = noise(vDir * 2.6 + vec3(uTime * 0.012, 0.0, uTime * 0.008));
          n += 0.5 * noise(vDir * 6.1 - vec3(0.0, uTime * 0.02, 0.0));
          base += (n - 0.55) * 0.11;
          // horizon lift keeps the floor from reading as a black pit
          base += smoothstep(0.5, 0.0, abs(vDir.y)) * 0.045;
          gl_FragColor = vec4(base, uOpacity);
        }`,
    });
    this.shell = new THREE.Mesh(new THREE.SphereGeometry(18, 32, 20), this.shellMat);
    this.shell.frustumCulled = false;
    this.shell.renderOrder = -1000;
    this.bgScene.add(this.shell);

    // ---- starfield ------------------------------------------------------
    this.stars = this.buildStars(1400);
    this.bgScene.add(this.stars);

    // ---- distant haze bands --------------------------------------------
    this.haze = this.buildHaze();
    this.bgScene.add(this.haze);

    // ---- floor grid -----------------------------------------------------
    this.grid = this.buildGrid();
    this.bgScene.add(this.grid);

    // ---- lighting for the hologram (main scene) -------------------------
    this.ambient = new THREE.HemisphereLight(0xbfd8ff, 0x1b2432, 1.0);
    this.key = new THREE.DirectionalLight(0xffffff, 2.1);
    this.key.position.set(1.6, 3.0, 1.9);
    this.fill = new THREE.DirectionalLight(0x5b8fd6, 0.85);
    this.fill.position.set(-2.2, 0.7, -1.4);
    this.rim = new THREE.DirectionalLight(0xc07bff, 1.35);
    this.rim.position.set(-0.6, 1.1, -2.6);
    scene.add(this.ambient, this.key, this.fill, this.rim);

    // Motes: fine drifting particles that read as volume in passthrough too.
    this.motes = this.buildMotes(220);
    scene.add(this.motes);
  }

  buildStars(n) {
    const pos = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const tint = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      // Even distribution on a sphere, biased slightly above the horizon.
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const r = 15.5;
      const s = Math.sqrt(1 - u * u);
      pos[i * 3] = Math.cos(th) * s * r;
      pos[i * 3 + 1] = u * r * 0.85 + 1.4;
      pos[i * 3 + 2] = Math.sin(th) * s * r;
      size[i] = Math.pow(Math.random(), 3) * 0.16 + 0.015;
      tint[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aTint', new THREE.BufferAttribute(tint, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uOpacity: { value: 0 },
        uTime: { value: 0 },
        uWarm: { value: col([255, 214, 170]) },
        uCool: { value: col([160, 210, 255]) },
      },
      vertexShader: `
        attribute float aSize; attribute float aTint;
        varying float vT; varying float vTwinkle;
        uniform float uTime;
        void main(){
          vT = aTint;
          vTwinkle = 0.7 + 0.3 * sin(uTime * 1.4 + aTint * 40.0);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(aSize * 280.0 / max(1.0, -mv.z) * 6.0, 1.0, 9.0);
        }`,
      fragmentShader: `
        varying float vT; varying float vTwinkle;
        uniform float uOpacity; uniform vec3 uWarm; uniform vec3 uCool;
        void main(){
          vec2 d = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.0, length(d));
          a = pow(a, 2.2);
          vec3 cCol = mix(uCool, uWarm, vT);
          gl_FragColor = vec4(cCol, a * uOpacity * vTwinkle);
        }`,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = -999;
    this.starMat = mat;
    return pts;
  }

  buildHaze() {
    const g = new THREE.Group();
    const tex = radialSprite(0, 1.4);
    this.hazeMats = [];
    const specs = [
      { pos: [-7, 2.0, -11], scale: 13, color: [90, 60, 200], a: 0.32 },
      { pos: [8, 3.4, -12], scale: 15, color: [30, 150, 220], a: 0.26 },
      { pos: [0, -1.6, -10], scale: 16, color: [40, 60, 140], a: 0.2 },
      { pos: [-9, 1.0, 9], scale: 12, color: [140, 60, 180], a: 0.18 },
    ];
    for (const s of specs) {
      const m = new THREE.SpriteMaterial({
        map: tex, color: col(s.color), transparent: true, depthWrite: false,
        depthTest: false, blending: THREE.AdditiveBlending, opacity: 0,
      });
      const sp = new THREE.Sprite(m);
      sp.position.set(...s.pos);
      sp.scale.setScalar(s.scale);
      sp.renderOrder = -998;
      m.userData = { base: s.a };
      this.hazeMats.push(m);
      g.add(sp);
    }
    g.frustumCulled = false;
    return g;
  }

  buildGrid() {
    const g = new THREE.Group();
    const grid = new THREE.GridHelper(24, 48, 0x2a6f9e, 0x1d4a6b);
    grid.material.transparent = true;
    grid.material.opacity = 0;
    grid.material.depthWrite = false;
    grid.position.y = 0.002;
    this.gridMat = grid.material;

    // Radial rings under the model give a sense of scale as you walk about.
    const ringGeo = new THREE.RingGeometry(0.98, 1.0, 96);
    this.ringMats = [];
    for (let i = 1; i <= 4; i++) {
      const m = new THREE.MeshBasicMaterial({
        color: 0x35c8ff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false,
      });
      const ring = new THREE.Mesh(ringGeo, m);
      ring.rotation.x = -Math.PI / 2;
      ring.scale.setScalar(i * 1.1);
      ring.position.y = 0.004;
      m.userData = { base: 0.3 / i };
      this.ringMats.push(m);
      g.add(ring);
    }
    g.add(grid);
    return g;
  }

  buildMotes(n) {
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 4.2;
      pos[i * 3 + 1] = Math.random() * 2.4 + 0.1;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 4.2;
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uColor: { value: col([120, 200, 255]) }, uOpacity: { value: 0.5 } },
      vertexShader: `
        attribute float aSeed; varying float vA; uniform float uTime;
        void main(){
          vec3 p = position;
          p.y += sin(uTime * 0.28 + aSeed * 22.0) * 0.16;
          p.x += cos(uTime * 0.21 + aSeed * 30.0) * 0.13;
          p.z += sin(uTime * 0.17 + aSeed * 17.0) * 0.13;
          vA = 0.35 + 0.65 * pow(abs(sin(uTime * 0.5 + aSeed * 12.0)), 2.0);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float dist = -mv.z;
          gl_Position = projectionMatrix * mv;
          // Clamp the sprite size and fade anything inside arm's reach, or a
          // mote drifting past your eye fills the whole display.
          gl_PointSize = min(14.0, (2.2 + aSeed * 3.4) * 90.0 / max(0.4, dist));
          vA *= smoothstep(0.25, 0.85, dist);
        }`,
      fragmentShader: `
        varying float vA; uniform vec3 uColor; uniform float uOpacity;
        void main(){
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.05, d);
          gl_FragColor = vec4(uColor, a * a * vA * uOpacity * 0.5);
        }`,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    this.moteMat = mat;
    return pts;
  }

  // -------------------------------------------------------------- theming

  setTheme(t) {
    this.shellMat.uniforms.uTop.value.copy(col(t.voidTop));
    this.shellMat.uniforms.uBottom.value.copy(col(t.voidBottom));
    this.gridMat.color.copy(col(t.grid));
    this.ringMats.forEach((m) => m.color.copy(col(t.accent)));
    this.moteMat.uniforms.uColor.value.copy(col(t.accent));
    this.starMat.uniforms.uCool.value.copy(col(t.accent));
    this.starMat.uniforms.uWarm.value.copy(col(t.accent2));

    this.ambient.color.copy(col(t.fill)).lerp(new THREE.Color(0xffffff), 0.4);
    this.baseAmbient = t.ambient;
    this.ambient.intensity = 0.5 + t.ambient;
    this.key.color.copy(col(t.key));
    this.fill.color.copy(col(t.fill));
    this.rim.color.copy(col(t.rim));
    this.hazeMats.forEach((m, i) =>
      m.color.copy(col(i % 2 === 0 ? t.accent2 : t.accent)).multiplyScalar(0.9)
    );
  }

  /** @param {number} v 0 = passthrough, 1 = sealed VR */
  setDim(v) {
    this.targetDim = THREE.MathUtils.clamp(v, 0, 1);
  }

  update(dt, t) {
    this.dim = THREE.MathUtils.damp(this.dim, this.targetDim, 5, dt);
    const d = this.dim;

    this.shellMat.uniforms.uOpacity.value = d;
    this.shellMat.uniforms.uTime.value = t;
    // Stars only make sense once the room is mostly gone.
    this.starMat.uniforms.uOpacity.value = Math.max(0, (d - 0.35) / 0.65);
    this.starMat.uniforms.uTime.value = t;
    this.hazeMats.forEach((m) => (m.opacity = m.userData.base * Math.max(0, (d - 0.25) / 0.75)));
    this.gridMat.opacity = 0.5 * Math.max(0, (d - 0.15) / 0.85);
    this.ringMats.forEach((m) => (m.opacity = m.userData.base * Math.max(0, (d - 0.15) / 0.85)));
    // Motes read best in passthrough; ease them back as the void takes over.
    this.moteMat.uniforms.uTime.value = t;
    this.moteMat.uniforms.uOpacity.value = 0.35 + 0.5 * d;

    // Lift the fill light as reality darkens so the model keeps its shape.
    this.ambient.intensity = (0.5 + (this.baseAmbient ?? 0.34)) * (1 - d * 0.35);
    this.rim.intensity = 1.35 + d * 0.5;
  }

  /** Render the backdrop, then clear depth so the workspace sits on top. */
  renderBackdrop(renderer, camera) {
    if (this.dim < 0.002) return;
    renderer.render(this.bgScene, camera);
    renderer.clearDepth();
  }

  /** Keep the shell centred on the player so it never clips. */
  follow(position) {
    this.shell.position.set(position.x, 0, position.z);
    this.stars.position.set(position.x, 0, position.z);
    this.motes.position.set(position.x, 0, position.z);
  }
}
