/**
 * Unified XR pointer model.
 *
 * Both hands and both controllers collapse into the same `Pointer` shape so the
 * interaction layer never branches on input type:
 *
 *   ray        — aiming ray from the runtime's target-ray space (Quest supplies
 *                a properly-shouldered ray for hands, so we use it rather than
 *                extrapolating the index finger, which is jittery at distance)
 *   tip        — index fingertip, for direct poke of near panels
 *   pinch      — 0..1 strength with hysteresis, so drags don't drop out
 *   palmUp     — the "summon" gesture that recentres the workspace
 *
 * Visuals (fingertip cursors, tapered ray, pinch spark) live here too, because
 * they are driven from exactly the same numbers.
 */

import * as THREE from 'three';

const PINCH_CLOSE = 0.022; // m — below this the pinch latches on
const PINCH_OPEN = 0.038; // m — above this it releases
const JOINT = {
  wrist: 'wrist',
  thumbTip: 'thumb-tip',
  indexTip: 'index-finger-tip',
  indexKnuckle: 'index-finger-metacarpal',
  middleKnuckle: 'middle-finger-metacarpal',
  pinkyKnuckle: 'pinky-finger-metacarpal',
  middleTip: 'middle-finger-tip',
  ringTip: 'ring-finger-tip',
  pinkyTip: 'pinky-finger-tip',
  palm: 'middle-finger-metacarpal',
};

const smoothstep = (e0, e1, x) => {
  const t = THREE.MathUtils.clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

export class Pointer {
  constructor(index, kind = 'hand') {
    this.index = index;
    this.kind = kind;
    this.handedness = index === 0 ? 'left' : 'right';
    this.tracked = false;
    this.rayOrigin = new THREE.Vector3();
    this.rayDir = new THREE.Vector3(0, 0, -1);
    this.tip = new THREE.Vector3();
    this.tipPrev = new THREE.Vector3();
    this.tipValid = false;
    this.pinchPoint = new THREE.Vector3();
    this.pinch = 0;
    this.pinching = false;
    this.downEdge = false;
    this.upEdge = false;
    this.palmUp = false;
    this.palmUpHeld = 0;
    this.gripPos = new THREE.Vector3();
    /** Set by the interaction layer while this pointer owns a drag. */
    this.capture = null;
  }
}

export class XRInput {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Scene} scene
   * @param {THREE.Group} rig  the player rig pointers are parented under
   */
  constructor(renderer, scene, rig) {
    this.renderer = renderer;
    this.scene = scene;
    this.rig = rig;
    this.pointers = [new Pointer(0), new Pointer(1)];
    this.controllers = [];
    this.hands = [];
    this.grips = [];
    this.visuals = [];
    this.theme = null;
    /** Emitted gesture names for the current frame, e.g. 'summon'. */
    this.gestures = [];

    for (let i = 0; i < 2; i++) {
      const controller = renderer.xr.getController(i);
      const grip = renderer.xr.getControllerGrip(i);
      const hand = renderer.xr.getHand(i);
      controller.userData.pointerIndex = i;

      controller.addEventListener('connected', (e) => {
        this.pointers[i].handedness = e.data?.handedness ?? this.pointers[i].handedness;
        this.pointers[i].kind = e.data?.hand ? 'hand' : 'controller';
        this.visuals[i].controllerBody.visible = !e.data?.hand;
      });
      controller.addEventListener('disconnected', () => {
        this.pointers[i].tracked = false;
      });
      // Controller trigger maps to the same "pinch" channel as a hand pinch.
      controller.addEventListener('selectstart', () => { this._selectHeld[i] = true; });
      controller.addEventListener('selectend', () => { this._selectHeld[i] = false; });

      rig.add(controller, grip, hand);
      this.controllers.push(controller);
      this.grips.push(grip);
      this.hands.push(hand);
      this.visuals.push(this.buildVisual(controller, grip));
    }
    this._selectHeld = [false, false];
  }

  // ------------------------------------------------------------- visuals

  buildVisual(controller, grip) {
    // Tapered ray: bright at the hand, fading to nothing at 2.5 m.
    const seg = 24;
    const pos = new Float32Array(seg * 3);
    const alpha = new Float32Array(seg);
    for (let i = 0; i < seg; i++) {
      pos[i * 3 + 2] = -(i / (seg - 1)) * 2.5;
      alpha[i] = Math.pow(1 - i / (seg - 1), 1.6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uColor: { value: new THREE.Color(0x35c8ff) },
        uStrength: { value: 0.5 },
      },
      vertexShader: `
        attribute float aAlpha; varying float vA;
        void main(){ vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        uniform vec3 uColor; uniform float uStrength; varying float vA;
        void main(){ gl_FragColor = vec4(uColor, vA * uStrength); }`,
    });
    const ray = new THREE.Line(geo, mat);
    ray.frustumCulled = false;
    ray.renderOrder = 30;
    controller.add(ray);

    // Fingertip cursor: a soft additive disc that grows as a pinch closes.
    const cursorMat = new THREE.SpriteMaterial({
      map: radialSprite(),
      color: 0x35c8ff,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0,
    });
    const cursor = new THREE.Sprite(cursorMat);
    cursor.scale.setScalar(0.03);
    cursor.renderOrder = 31;
    this.scene.add(cursor);

    // A crisp ring at the fingertip gives depth cues the blur alone can't.
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.008, 0.0105, 28), ringMat);
    ring.renderOrder = 32;
    this.scene.add(ring);

    // Minimal controller stand-in so tracked controllers aren't invisible.
    const controllerBody = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.014, 0.07, 4, 12),
      new THREE.MeshStandardMaterial({ color: 0x1a2230, roughness: 0.5, metalness: 0.4 })
    );
    controllerBody.rotation.x = -Math.PI / 3;
    controllerBody.visible = false;
    grip.add(controllerBody);

    return { ray, rayMat: mat, cursor, cursorMat, ring, ringMat, controllerBody };
  }

  setTheme(theme) {
    this.theme = theme;
    const col = new THREE.Color(`rgb(${theme.accent.join(',')})`);
    const col2 = new THREE.Color(`rgb(${theme.accent2.join(',')})`);
    this.visuals.forEach((v, i) => {
      v.rayMat.uniforms.uColor.value.copy(i === 0 ? col2 : col);
      v.cursorMat.color.copy(i === 0 ? col2 : col);
    });
  }

  // -------------------------------------------------------------- update

  /** @param {number} dt seconds */
  update(dt) {
    this.gestures.length = 0;
    for (let i = 0; i < 2; i++) this.updatePointer(i, dt);
  }

  updatePointer(i, dt) {
    const p = this.pointers[i];
    // Desktop preview drives the right-hand pointer from the mouse so every
    // control in the workspace stays reachable without a headset.
    if (this.desktopSource?.enabled) {
      this.updateDesktopPointer(i, dt);
      return;
    }
    const controller = this.controllers[i];
    const hand = this.hands[i];
    const v = this.visuals[i];
    const joints = hand?.joints;
    const hasHand = !!(joints && joints[JOINT.indexTip] && joints[JOINT.indexTip].visible !== false &&
      joints[JOINT.indexTip].matrixWorld);

    p.tracked = controller.visible !== false && (hasHand || controller.userData.connected !== false);
    p.tipPrev.copy(p.tip);

    // -- aiming ray (identical for hands and controllers) ---------------
    if (controller.visible) {
      controller.getWorldPosition(p.rayOrigin);
      p.rayDir.set(0, 0, -1).applyQuaternion(controller.getWorldQuaternion(new THREE.Quaternion())).normalize();
      p.tracked = true;
    } else {
      p.tracked = false;
    }

    // -- pinch ----------------------------------------------------------
    const wasPinching = p.pinching;
    if (hasHand) {
      p.kind = 'hand';
      const thumb = joints[JOINT.thumbTip];
      const index = joints[JOINT.indexTip];
      const a = thumb.getWorldPosition(_v1);
      const b = index.getWorldPosition(_v2);
      const d = a.distanceTo(b);
      p.pinch = 1 - smoothstep(PINCH_CLOSE, PINCH_OPEN * 1.4, d);
      p.pinching = wasPinching ? d < PINCH_OPEN : d < PINCH_CLOSE;
      p.pinchPoint.copy(a).lerp(b, 0.5);
      p.tip.copy(b);
      p.tipValid = true;
      joints[JOINT.wrist]?.getWorldPosition(p.gripPos);
      p.palmUp = this.detectPalmUp(joints);
    } else {
      p.kind = 'controller';
      p.pinch = this._selectHeld[i] ? 1 : 0;
      p.pinching = this._selectHeld[i];
      // Treat a point 6 cm ahead of the controller as the "tip" so poking works.
      p.tip.copy(p.rayOrigin).addScaledVector(p.rayDir, 0.06);
      p.pinchPoint.copy(p.tip);
      p.tipValid = p.tracked;
      this.grips[i].getWorldPosition(p.gripPos);
      p.palmUp = false;
    }
    if (!p.tracked) {
      p.pinching = false;
      p.pinch = 0;
      p.tipValid = false;
      p.palmUp = false;
    }

    p.downEdge = p.pinching && !wasPinching;
    p.upEdge = !p.pinching && wasPinching;

    // -- summon gesture: both palms up and held for ~0.6 s --------------
    p.palmUpHeld = p.palmUp ? p.palmUpHeld + dt : 0;
    if (p.palmUpHeld > 0.6 && this.pointers.every((q) => q.palmUpHeld > 0.5)) {
      this.gestures.push('summon');
      this.pointers.forEach((q) => (q.palmUpHeld = -1.5)); // debounce
    }

    // -- visuals --------------------------------------------------------
    const showRay = p.tracked && (p.kind === 'controller' || !this.nearFieldActive);
    v.rayMat.uniforms.uStrength.value = THREE.MathUtils.damp(
      v.rayMat.uniforms.uStrength.value,
      showRay ? 0.28 + p.pinch * 0.6 : 0,
      12, dt
    );
    v.ray.visible = v.rayMat.uniforms.uStrength.value > 0.01;

    if (p.tipValid) {
      v.cursor.position.copy(p.tip);
      v.ring.position.copy(p.tip);
      v.ring.quaternion.copy(this.cameraQuat ?? v.ring.quaternion);
      const s = 0.026 + p.pinch * 0.02;
      v.cursor.scale.setScalar(s);
      v.cursorMat.opacity = THREE.MathUtils.damp(v.cursorMat.opacity, 0.35 + p.pinch * 0.5, 14, dt);
      v.ringMat.opacity = THREE.MathUtils.damp(v.ringMat.opacity, 0.25 + p.pinch * 0.55, 14, dt);
      v.ring.scale.setScalar(1 - p.pinch * 0.3);
    } else {
      v.cursorMat.opacity = THREE.MathUtils.damp(v.cursorMat.opacity, 0, 14, dt);
      v.ringMat.opacity = THREE.MathUtils.damp(v.ringMat.opacity, 0, 14, dt);
    }
  }

  /** Mouse-driven stand-in for a hand, used only by the screen preview. */
  updateDesktopPointer(i, dt) {
    const p = this.pointers[i];
    const v = this.visuals[i];
    const src = this.desktopSource;

    if (i === 0 || !src.rayOrigin) {
      p.tracked = false;
      p.pinching = false;
      p.pinch = 0;
      p.tipValid = false;
      v.ray.visible = false;
      v.cursorMat.opacity = 0;
      v.ringMat.opacity = 0;
      return;
    }

    const wasPinching = p.pinching;
    p.kind = 'mouse';
    p.tracked = true;
    p.rayOrigin.copy(src.rayOrigin);
    p.rayDir.copy(src.rayDir);
    p.pinching = src.pinching;
    p.pinch = src.pinching ? 1 : 0;
    p.tipValid = false; // no fingertip on desktop, so poke is disabled
    p.downEdge = p.pinching && !wasPinching;
    p.upEdge = !p.pinching && wasPinching;
    p.palmUp = false;

    // Draw the ray as a free-floating line rather than parenting it to a
    // controller that the runtime is not tracking.
    v.ray.visible = true;
    v.ray.position.copy(p.rayOrigin);
    v.ray.quaternion.setFromUnitVectors(_zAxis, p.rayDir);
    v.ray.parent !== this.scene && this.scene.add(v.ray);
    v.rayMat.uniforms.uStrength.value = 0.3 + p.pinch * 0.5;
    v.cursorMat.opacity = 0;
    v.ringMat.opacity = 0;
  }

  /**
   * "Open palm held flat, below eye level."
   *
   * The metacarpal triangle winds the opposite way on left and right hands, so
   * rather than resolving the sign we test that the palm plane is *horizontal*
   * (|n.y| high) and add two conditions that make the pose unambiguous anyway:
   * the hand is below the head, and the fingers are extended. Curling into a
   * fist or turning the hand vertical both drop out of the gesture.
   */
  detectPalmUp(joints) {
    const w = joints[JOINT.wrist];
    const idx = joints[JOINT.indexKnuckle];
    const pky = joints[JOINT.pinkyKnuckle];
    if (!w || !idx || !pky) return false;

    const wrist = w.getWorldPosition(_v1);
    const n = _v4
      .subVectors(idx.getWorldPosition(_v2), wrist)
      .cross(_v5.subVectors(pky.getWorldPosition(_v3), wrist))
      .normalize();
    if (Math.abs(n.y) < 0.8) return false;

    const headY = this.headPosition?.y ?? 1.6;
    if (wrist.y > headY - 0.15) return false;

    // Fingers extended: middle fingertip is far from the wrist.
    const mid = joints[JOINT.middleTip];
    return !!mid && mid.getWorldPosition(_v2).distanceTo(wrist) > 0.135;
  }

  /** Distance from a pointer's fingertip to the camera, for near/far arbitration. */
  setCamera(camera) {
    this.headPosition = camera.getWorldPosition(_v6);
    this.cameraQuat = camera.getWorldQuaternion(_q1);
  }
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _v5 = new THREE.Vector3();
const _v6 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _zAxis = new THREE.Vector3(0, 0, -1);

/** 64×64 radial falloff used for every soft additive sprite in the app. */
export function radialSprite(inner = 0.0, power = 2) {
  const s = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, s * inner, s / 2, s / 2, s / 2);
  // Plenty of stops: eight produced visible concentric banding once a sprite
  // was scaled up to a metre across.
  for (let i = 0; i <= 48; i++) {
    const t = i / 48;
    g.addColorStop(t, `rgba(255,255,255,${Math.pow(1 - t, power).toFixed(4)})`);
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
