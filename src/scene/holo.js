/**
 * The hologram: whichever model is loaded, standing on a plinth inside a
 * containment dome, with floating callouts, a selection highlight and the
 * measurement overlay.
 *
 * Direct manipulation lives here too — one-hand pinch-drag orbits, two-hand
 * pinch scales and translates, matching how you'd expect to handle a physical
 * object on a table.
 */

import * as THREE from 'three';
import { buildPlinth, buildDome, makeLabel, col } from './common.js';
import { buildCity } from './city.js';
import { buildPlanet } from './planet.js';
import { buildIsland } from './island.js';
import { buildTurbine } from './turbine.js';

const BUILDERS = { city: buildCity, planet: buildPlanet, island: buildIsland, turbine: buildTurbine };

/**
 * Presented radius ≈ 0.36 m at just over a metre away, so the model fills the
 * central ±20° the panel wall leaves clear and still reads as a table object.
 */
const DEFAULT_SCALE = 0.72;

export class Hologram {
  constructor(scene) {
    this.root = new THREE.Group(); // placed in the room; never touched by gestures
    this.pivot = new THREE.Group(); // user-manipulated transform
    this.root.add(this.pivot);
    scene.add(this.root);

    this.model = null;
    this.modelId = null;
    this.theme = null;
    this.labels = [];
    this.plinth = null;
    this.dome = null;

    this.spin = 0.0; // idle turntable rate, rad/s
    this.userYaw = 0;
    /**
     * Models are authored at a 0.5 m radius so their detail budget is easy to
     * reason about; DEFAULT_SCALE presents them at roughly table size, which
     * leaves the panel wall unobstructed. Two-hand pinch overrides it.
     */
    this.userScale = DEFAULT_SCALE;
    this.targetScale = DEFAULT_SCALE;
    this.offset = new THREE.Vector3();

    this._grab = null; // { pointer, startYaw, startAngle }
    this._twoHand = null;

    // Selection highlight: a pulsing box around whatever is picked.
    this.selectionBox = new THREE.Box3Helper(new THREE.Box3(), 0x35c8ff);
    this.selectionBox.visible = false;
    this.selectionBox.material.transparent = true;
    this.selectionBox.material.depthWrite = false;
    this.pivot.add(this.selectionBox);

    // Measurement overlay.
    this.measureGroup = new THREE.Group();
    this.measureGroup.visible = false;
    const mGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.measureLine = new THREE.Line(
      mGeo,
      new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.012, gapSize: 0.008, transparent: true, opacity: 0.9 })
    );
    this.measureGroup.add(this.measureLine);
    this.measureLabel = null;
    this.pivot.add(this.measureGroup);

    // Annotation pins dropped by the user.
    this.pinGroup = new THREE.Group();
    this.pivot.add(this.pinGroup);
  }

  setTheme(theme) {
    this.theme = theme;
    this.rebuildChrome();
    if (this.modelId) this.load(this.modelId, true);
    this.selectionBox.material.color.copy(col(theme.accent));
    this.measureLine.material.color.copy(col(theme.accent2));
  }

  rebuildChrome() {
    if (this.plinth) {
      this.pivot.remove(this.plinth.group);
      this.plinth.group.traverse((o) => o.geometry?.dispose?.());
    }
    if (this.dome) this.pivot.remove(this.dome.mesh);
    this.plinth = buildPlinth(this.theme, 0.5);
    this.dome = buildDome(this.theme, 0.58);
    // Squashed into an oblate shell so it hugs a disc-shaped model instead of
    // leaving a hemisphere of empty air above it.
    this.dome.mesh.scale.set(1, 0.66, 1);
    this.dome.mesh.position.y = 0.06;
    this.pivot.add(this.plinth.group, this.dome.mesh);
  }

  /** Swap the loaded model, preserving the user's orbit and scale. */
  load(id, force = false) {
    if (id === this.modelId && !force) return;
    if (this.model) {
      this.pivot.remove(this.model.group);
      this.model.dispose();
    }
    for (const l of this.labels) {
      this.pivot.remove(l.group, l.line, l.dot);
    }
    this.labels = [];

    const build = BUILDERS[id] ?? BUILDERS.city;
    this.model = build(this.theme);
    this.modelId = id;
    this.pivot.add(this.model.group);

    // Scale the model so every subject fills roughly the same volume.
    const fit = 0.5 / (this.model.radius || 0.5);
    this.model.group.scale.setScalar(fit);

    const specs = (this.model.labelSpecs ?? []).filter((s) => this.model.anchors[s.key]);
    specs.forEach((spec, i) => {
      const l = makeLabel(this.theme, { title: spec.title, value: '—', unit: '' });
      l.spec = spec;
      l.anchor = this.model.anchors[spec.key].clone().multiplyScalar(fit);
      // Cards ride an evenly-spaced ring around the model with alternating
      // heights, so callouts never stack even when their anchors are adjacent.
      l.ring = {
        angle: (i / specs.length) * Math.PI * 2 + Math.PI * 0.18,
        radius: 0.62,
        lift: 0.1 + (i % 2) * 0.11,
      };
      this.pivot.add(l.group, l.line, l.dot);
      this.labels.push(l);
    });
    this.entering = 0;
  }

  /** Place the hologram in the room in front of the user. */
  place(position, yaw = 0) {
    this.root.position.copy(position);
    this.root.rotation.y = yaw;
  }

  // ------------------------------------------------------------ selection

  select(pick, sim, weather) {
    if (!pick) {
      this.selectionBox.visible = false;
      return null;
    }
    const box = new THREE.Box3().setFromObject(pick.object);
    if (box.isEmpty()) {
      this.selectionBox.visible = false;
    } else {
      box.expandByScalar(0.006);
      this.selectionBox.box.copy(box);
      this.selectionBox.visible = true;
    }
    return {
      kind: pick.kind,
      label: pick.label,
      detail: typeof pick.detail === 'function' ? pick.detail(sim, weather) : pick.detail ?? [],
    };
  }

  /** @returns the pick record whose object a ray hits, or null. */
  raycast(raycaster) {
    if (!this.model) return null;
    for (const p of this.model.picks) {
      const hits = raycaster.intersectObject(p.object, true);
      if (hits.length) return { pick: p, point: hits[0].point, distance: hits[0].distance };
    }
    return null;
  }

  /** Everything the pinch-ray should consider when aiming at the model. */
  get pickables() {
    return this.model ? this.model.picks.map((p) => p.object) : [];
  }

  addAnnotation(worldPoint, text) {
    const local = this.pivot.worldToLocal(worldPoint.clone());
    const pin = new THREE.Group();
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0008, 0.0008, 0.05, 4),
      new THREE.MeshBasicMaterial({ color: col(this.theme.accent2), toneMapped: false })
    );
    stem.position.y = 0.025;
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.0045, 10, 8),
      new THREE.MeshBasicMaterial({ color: col(this.theme.accent2), toneMapped: false })
    );
    head.position.y = 0.05;
    pin.add(stem, head);
    pin.position.copy(local);

    const label = makeLabel(this.theme, { title: 'Note', value: text, width: 0.11 });
    label.group.position.copy(local).add(new THREE.Vector3(0, 0.075, 0));
    pin.add(label.group);
    this.pinGroup.add(pin);
    return { pin, label, local };
  }

  clearAnnotations() {
    while (this.pinGroup.children.length) {
      const c = this.pinGroup.children.pop();
      c.traverse?.((o) => o.geometry?.dispose?.());
      this.pinGroup.remove(c);
    }
  }

  setMeasurement(a, b) {
    if (!a || !b) {
      this.measureGroup.visible = false;
      return;
    }
    const la = this.pivot.worldToLocal(a.clone());
    const lb = this.pivot.worldToLocal(b.clone());
    const p = this.measureLine.geometry.attributes.position;
    p.setXYZ(0, la.x, la.y, la.z);
    p.setXYZ(1, lb.x, lb.y, lb.z);
    p.needsUpdate = true;
    this.measureLine.geometry.computeBoundingSphere();
    this.measureLine.computeLineDistances();
    this.measureGroup.visible = true;

    const dist = la.distanceTo(lb) / this.model.group.scale.x;
    if (!this.measureLabel) {
      this.measureLabel = makeLabel(this.theme, { title: 'Distance', value: '0', unit: 'm', width: 0.1 });
      this.measureGroup.add(this.measureLabel.group);
    }
    // Model scale is 1:1000 for the city, 1:1 for the machine.
    const worldScale = this.modelId === 'turbine' ? 1 : 1000;
    this.measureLabel.set(this.theme, 'Distance', (dist * worldScale).toFixed(worldScale === 1 ? 3 : 0),
      worldScale === 1 ? 'm' : 'm');
    this.measureLabel.group.position.copy(la).lerp(lb, 0.5).add(new THREE.Vector3(0, 0.03, 0));
    return dist * worldScale;
  }

  // --------------------------------------------------------- manipulation

  /**
   * Drive the transform from pointer state.
   * One pinch on empty space = orbit. Two pinches = scale + lift.
   */
  manipulate(pointers, dt, tool) {
    const active = pointers.filter((p) => p.tracked && p.pinching && p.capture === 'holo');

    if (active.length === 2) {
      const [a, b] = active;
      const d = a.pinchPoint.distanceTo(b.pinchPoint);
      const mid = a.pinchPoint.clone().add(b.pinchPoint).multiplyScalar(0.5);
      if (!this._twoHand) {
        this._twoHand = { d0: d, s0: this.targetScale, mid0: mid.clone(), off0: this.offset.clone() };
      } else {
        const t = this._twoHand;
        this.targetScale = THREE.MathUtils.clamp(t.s0 * (d / Math.max(0.02, t.d0)), 0.15, 2.4);
        if (tool === 'move') this.offset.copy(t.off0).add(mid.clone().sub(t.mid0));
      }
      this._grab = null;
    } else if (active.length === 1) {
      this._twoHand = null;
      const p = active[0];
      // Orbit: horizontal travel of the pinch maps to yaw about the model.
      const centre = this.root.getWorldPosition(_v).add(this.offset);
      const ang = Math.atan2(p.pinchPoint.x - centre.x, p.pinchPoint.z - centre.z);
      if (!this._grab) {
        this._grab = { ang0: ang, yaw0: this.userYaw, y0: p.pinchPoint.y, off0: this.offset.clone(), p0: p.pinchPoint.clone() };
      } else {
        if (tool === 'move') {
          this.offset.copy(this._grab.off0).add(p.pinchPoint.clone().sub(this._grab.p0));
        } else {
          let delta = ang - this._grab.ang0;
          while (delta > Math.PI) delta -= Math.PI * 2;
          while (delta < -Math.PI) delta += Math.PI * 2;
          this.userYaw = this._grab.yaw0 - delta;
        }
      }
    } else {
      this._grab = null;
      this._twoHand = null;
    }
    return active.length > 0;
  }

  resetTransform() {
    this.userYaw = 0;
    this.targetScale = DEFAULT_SCALE;
    this.offset.set(0, 0, 0);
  }

  // --------------------------------------------------------------- update

  update(dt, ctx) {
    const { time, sim, weather, camera } = ctx;
    if (!this.model) return;

    this.model.update(dt, ctx);
    if (this.model.setExplode && ctx.tool !== 'section') { /* handled inside */ }

    // Idle turntable, suspended while the user is holding the model.
    const idle = this._grab || this._twoHand ? 0 : this.spin;
    this.userYaw += idle * dt;
    this.pivot.rotation.y = THREE.MathUtils.damp(this.pivot.rotation.y, this.userYaw, 12, dt);
    this.userScale = THREE.MathUtils.damp(this.userScale, this.targetScale, 8, dt);

    // Entrance: the model rises and expands into its dome.
    this.entering = Math.min(1, (this.entering ?? 1) + dt * 1.3);
    const e = easeOutBack(this.entering);
    this.pivot.scale.setScalar(this.userScale * e);
    this.pivot.position.copy(this.offset);
    this.pivot.position.y += (1 - this.entering) * -0.12 + Math.sin(time * 0.5) * 0.004;

    // Chrome animation.
    if (this.plinth) {
      this.plinth.ticks.rotation.y += dt * 0.12;
      this.plinth.halo.material.opacity = 0.35 + 0.12 * Math.sin(time * 0.9);
    }
    if (this.dome) {
      this.dome.mat.uniforms.uTime.value = time;
      this.dome.mat.uniforms.uStrength.value = ctx.layersOn?.atmosphere === false ? 0.25 : 1;
    }

    // Selection pulse.
    if (this.selectionBox.visible) {
      this.selectionBox.material.opacity = 0.45 + 0.35 * Math.sin(time * 3.4);
    }

    // Labels sit on a ring in the model's own space and billboard to the head,
    // with a leader line back to the feature they describe.
    if (camera && this.labels.length) {
      const head = camera.getWorldPosition(_v2);
      const showLabels = ctx.layersOn?.labels !== false;
      for (const l of this.labels) {
        l.group.visible = l.line.visible = l.dot.visible = showLabels;
        if (!showLabels) continue;
        const { angle, radius, lift } = l.ring;
        l.group.position.set(
          Math.sin(angle) * radius,
          l.anchor.y + lift,
          Math.cos(angle) * radius
        );
        // lookAt takes a world-space target and compensates for the parent.
        l.group.lookAt(head);
        // Counter the pivot's scale so a card stays legible however far the
        // user has pinched the model open or closed.
        l.group.scale.setScalar(1 / Math.max(0.2, this.pivot.scale.x));
        l.setLeader(l.group.position, l.anchor);

        if (sim) {
          const [v, u] = l.spec.get(sim, weather);
          if (l._last !== v + u) {
            l.set(this.theme, l.spec.title, v, u);
            l._last = v + u;
          }
        }
      }
    }
  }
}

const easeOutBack = (t) => {
  const c1 = 1.24, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
