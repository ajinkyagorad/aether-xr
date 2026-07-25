/**
 * Interaction router.
 *
 * Each pointer resolves to exactly one target per frame, in priority order:
 *
 *   1. near-field poke   — fingertip within 3 cm of a panel's front face
 *   2. far-field ray     — pinch-ray hitting a panel
 *   3. the hologram      — everything else in front of you
 *
 * Near-field wins because if your finger is on the glass, that is unambiguously
 * what you mean, regardless of where the aiming ray happens to point.
 */

import * as THREE from 'three';

const POKE_RANGE = 0.035; // m in front of the glass where hover begins
const POKE_EXIT = 0.012; // m of hysteresis on the way back out
const RAY_MAX = 4;

export class Interaction {
  /**
   * @param {import('./input.js').XRInput} input
   * @param {import('../ui/workspace.js').Workspace} workspace
   * @param {import('../scene/holo.js').Hologram} holo
   * @param {(action: string, ctx: object) => void} onAction
   */
  constructor(input, workspace, holo, onAction) {
    this.input = input;
    this.ws = workspace;
    this.holo = holo;
    this.onAction = onAction;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = RAY_MAX;
    /** Per-pointer resolved target, for the visuals and for the drag lock. */
    this.targets = [null, null];
    this.hoverIds = new Set();
    this.pokeState = [new Map(), new Map()];
    this.measurePoints = [];
    this.lastActionAt = 0;
  }

  update(dt) {
    this.hoverIds.clear();
    const pointers = this.input.pointers;
    const panels = this.ws.all.filter((p) => p.group.visible && p.opacity > 0.4);

    let anyNear = false;
    for (let i = 0; i < pointers.length; i++) {
      const p = pointers[i];
      if (!p.tracked) {
        this.release(i);
        continue;
      }
      const target = this.resolve(p, i, panels);
      if (target?.type === 'poke') anyNear = true;
      this.targets[i] = target;
      this.dispatch(p, i, target, dt);
    }
    // Hide aiming rays while a fingertip is on the glass; they add clutter.
    this.input.nearFieldActive = anyNear;

    // Panel hover easing + repaint.
    for (const panel of this.ws.all) {
      if (panel.tick(dt, this.hoverIds)) panel.markDirty();
    }

    // Model manipulation runs off whichever pointers grabbed the hologram.
    this.holo.manipulate(pointers, dt, this.storeTool);

    // Gestures from the input layer.
    for (const g of this.input.gestures) this.onAction(`gesture:${g}`, {});
  }

  release(i) {
    const t = this.targets[i];
    if (t?.drag) t.drag = null;
    this.targets[i] = null;
    this.input.pointers[i].capture = null;
  }

  // ------------------------------------------------------------- resolving

  resolve(pointer, i, panels) {
    // A held drag keeps its target no matter where the hand wanders.
    const held = this.targets[i];
    if (held?.locked && pointer.pinching) {
      if (held.type === 'ray') this.updateRayDrag(pointer, held);
      return held;
    }

    // 1. poke
    if (pointer.tipValid) {
      const near = this.findPoke(pointer, i, panels);
      if (near) return near;
    }

    // 2. panel ray
    this.raycaster.set(pointer.rayOrigin, pointer.rayDir);
    const meshes = panels.map((p) => p.mesh);
    const hits = this.raycaster.intersectObjects(meshes, false);
    if (hits.length) {
      const hit = hits[0];
      const panel = hit.object.userData.panel;
      const px = panel.uvToPixel(hit.uv);
      const region = panel.regionAt(px.x, px.y);
      return { type: 'ray', panel, region, px, point: hit.point.clone(), distance: hit.distance };
    }

    // 3. hologram
    const holoHit = this.holo.raycast(this.raycaster);
    return { type: 'holo', pick: holoHit?.pick ?? null, point: holoHit?.point ?? null };
  }

  /** Nearest panel whose front face the fingertip is hovering or through. */
  findPoke(pointer, i, panels) {
    let best = null;
    for (const panel of panels) {
      const local = panel.group.worldToLocal(pointer.tip.clone());
      const surfZ = panel.surfaceZ(local.x);
      const depth = local.z - surfZ; // + in front of the glass, − behind
      const state = this.pokeState[i].get(panel.id);
      const range = state?.inside ? POKE_RANGE + POKE_EXIT : POKE_RANGE;
      if (depth > range || depth < -0.05) {
        if (state) state.inside = false;
        continue;
      }
      const px = panel.localToPixel(local);
      if (px.u < -0.02 || px.u > 1.02 || px.v < -0.02 || px.v > 1.02) {
        if (state) state.inside = false;
        continue;
      }
      if (!best || Math.abs(depth) < Math.abs(best.depth)) {
        best = { type: 'poke', panel, px, depth, local };
      }
    }
    if (!best) return null;
    let st = this.pokeState[i].get(best.panel.id);
    if (!st) this.pokeState[i].set(best.panel.id, (st = { inside: false, through: false }));
    st.inside = true;
    best.state = st;
    best.region = best.panel.regionAt(best.px.x, best.px.y);
    return best;
  }

  updateRayDrag(pointer, target) {
    this.raycaster.set(pointer.rayOrigin, pointer.rayDir);
    const hits = this.raycaster.intersectObject(target.panel.mesh, false);
    if (hits.length) {
      target.px = target.panel.uvToPixel(hits[0].uv);
      target.point = hits[0].point.clone();
    }
  }

  // ------------------------------------------------------------ dispatching

  dispatch(pointer, i, target, dt) {
    if (!target) return;

    if (target.type === 'holo') {
      // Pinching empty space or the model grabs it for orbit/scale.
      if (pointer.downEdge) {
        pointer.capture = 'holo';
        if (this.storeTool === 'select' && target.pick) {
          this.onAction('holo:select', { pick: target.pick, point: target.point });
        } else if (this.storeTool === 'measure' && target.point) {
          this.onAction('holo:measure', { point: target.point });
        } else if (this.storeTool === 'annotate' && target.point) {
          this.onAction('holo:annotate', { point: target.point });
        }
      }
      if (pointer.upEdge) pointer.capture = null;
      return;
    }

    const { panel, region } = target;
    if (region) this.hoverIds.add(region.id);

    // ---- poke ---------------------------------------------------------
    if (target.type === 'poke') {
      const st = target.state;
      const through = target.depth < 0;
      if (through && !st.through && region) {
        st.through = true;
        this.fire(region, panel, target, 1);
      } else if (!through && target.depth > 0.006) {
        st.through = false;
      }
      // A poke on a slider scrubs continuously while the finger stays in.
      if (through && region?.kind === 'slider') {
        this.fireSlider(region, panel, target.px);
      }
      return;
    }

    // ---- ray ----------------------------------------------------------
    if (pointer.downEdge && region) {
      target.locked = true;
      target.pressedRegion = region;
      pointer.capture = 'panel';
      panel.markDirty();
    }

    const pressed = target.pressedRegion;
    if (pointer.pinching && target.locked && pressed?.kind === 'slider') {
      // Scrub for as long as the pinch is held, even off the end of the track.
      this.fireSlider(pressed, panel, target.px);
    }

    if (pointer.upEdge) {
      // A button fires on release, and only if the release lands on it.
      if (target.locked && pressed && pressed.kind !== 'slider' && region?.id === pressed.id) {
        this.fire(region, panel, target, 1);
      }
      target.locked = false;
      target.pressedRegion = null;
      pointer.capture = null;
    }
  }

  fire(region, panel, target, value) {
    const now = performance.now();
    if (now - this.lastActionAt < 60) return; // swallow double-fires
    this.lastActionAt = now;
    this.onAction(region.id, { panel, region, value, point: target.point ?? null });
  }

  fireSlider(region, panel, px) {
    const v = THREE.MathUtils.clamp((px.x - region.trackX) / region.trackW, 0, 1);
    this.onAction(region.id, { panel, region, value: v, continuous: true });
  }

  /** The active tool, injected each frame so we don't import the store here. */
  set tool(v) {
    this.storeTool = v;
  }
}
