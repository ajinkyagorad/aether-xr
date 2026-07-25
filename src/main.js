/**
 * AETHER — spatial workspace for Meta Quest 3.
 *
 * Boots a WebXR `immersive-ar` session with hand tracking over passthrough,
 * builds the panel wall and the hologram, and runs the frame loop. Falls back to
 * a mouse-driven desktop preview so the whole thing can be developed and
 * reviewed without a headset.
 */

import * as THREE from 'three';
import { store, MODELS, SCENARIOS, TOOLS } from './core/state.js';
import { XRInput } from './core/input.js';
import { Environment } from './core/env.js';
import { Interaction } from './core/interaction.js';
import { Ambient } from './core/audio.js';
import { Workspace, viewLayerPreset } from './ui/workspace.js';
import { Hologram } from './scene/holo.js';
import { SITES, loadSite, simulate, locateUser } from './data/sources.js';
import { answer, answerRemote, replyDelay, SUGGESTIONS } from './data/assistant.js';

/** Flattened once so the chat log can show a suggestion's label, not its id. */
const SUGGESTION_LABELS = new Map(
  Object.values(SUGGESTIONS).flat().map((x) => [x.id, x.label])
);

// ---------------------------------------------------------------------------
// renderer
// ---------------------------------------------------------------------------

/**
 * A thrown error inside the animation loop silently stops the loop forever, so
 * surface it rather than leaving the user staring at an empty headset.
 */
window.addEventListener('error', (e) => {
  window.aetherError = e.error?.stack ?? e.message;
  const el = document.getElementById('status');
  if (el) el.innerHTML = `Renderer stopped: <b>${e.message}</b>`;
});
window.addEventListener('unhandledrejection', (e) => {
  window.aetherError = String(e.reason?.stack ?? e.reason);
});

/** `?capture=1` keeps the drawing buffer around so dev tooling can grab a PNG. */
const CAPTURE = new URLSearchParams(location.search).has('capture');

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: true, // required: passthrough shows through where alpha is 0
  powerPreference: 'high-performance',
  preserveDrawingBuffer: CAPTURE,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.xr.enabled = true;
// Sharper than the default 1.0; the scene is light enough to afford it and the
// panel type is the thing that suffers most from undersampling.
renderer.xr.setFramebufferScaleFactor(1.15);
// The backdrop pass has to run before the workspace, so we clear by hand.
renderer.autoClear = false;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.02, 60);
camera.position.set(0, 1.6, 0);

/** Everything tracked lives under the rig, which stays at the origin. */
const rig = new THREE.Group();
scene.add(rig);

const env = new Environment(scene);
const holo = new Hologram(scene);
const input = new XRInput(renderer, scene, rig);
const workspace = new Workspace(rig, holo);
const interaction = new Interaction(input, workspace, holo, onAction);
const ambient = new Ambient();

/** Web Audio needs a user gesture, so this can only run from a tap. */
async function toggleAudio() {
  const s = store.get();
  if (!s.audioOn) {
    const ok = await ambient.start(s.themeId, s.audioVolume);
    if (!ok) {
      store.say('ai', 'This browser would not let me open an audio context.');
      return;
    }
    ambient.resume();
    store.set({ audioOn: true });
  } else {
    ambient.stop();
    store.set({ audioOn: false });
  }
}

// ---------------------------------------------------------------------------
// theme plumbing
// ---------------------------------------------------------------------------

function applyTheme() {
  const t = store.theme;
  env.setTheme(t);
  holo.setTheme(t);
  input.setTheme(t);
  workspace.applyTheme(t);
  ambient.setTheme(t.id);
  document.documentElement.style.setProperty('--accent', `rgb(${t.accent.join(',')})`);
  document.documentElement.style.setProperty('--accent2', `rgb(${t.accent2.join(',')})`);
}

// ---------------------------------------------------------------------------
// data
// ---------------------------------------------------------------------------

let refreshTimer = 0;

async function refreshData(showLoading = true) {
  if (showLoading) store.set({ loading: true });
  const site = store.site;
  try {
    const data = await loadSite(site);
    store.set({ data, loading: false, dataError: data.weather.ok ? null : data.weather.error });
  } catch (e) {
    store.set({ loading: false, dataError: String(e) });
  }
  recomputeSim();
}

function recomputeSim() {
  const s = store.get();
  const sim = simulate(store.site, s.data?.weather?.ok ? s.data.weather : null, s.data?.air?.ok ? s.data.air : null, s.knobs);
  workspace.setSim(sim, s.data);
  return sim;
}

// ---------------------------------------------------------------------------
// actions
// ---------------------------------------------------------------------------

function onAction(id, ctx) {
  const s = store.get();
  const [ns, arg] = id.includes(':') ? [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)] : [id, ''];

  switch (ns) {
    case 'nav':
      if (arg === 'home') {
        store.openAll();
        holo.resetTransform();
        recentre();
      }
      store.set({ section: arg });
      if (arg === 'assistant') workspace.panels.get('copilot').markDirty();
      if (arg === 'explore') store.set({ view: 'surface' });
      if (arg === 'datasets') store.set({ view: 'analysis' });
      if (arg === 'projects') store.set({ view: 'overview' });
      break;

    case 'view': {
      store.set({ view: arg });
      // A view swaps the panel set (handled in Workspace.updateVisibility) and
      // repoints the model's layers, so the tab bar visibly does something.
      const preset = viewLayerPreset(arg);
      if (Object.keys(preset).length) {
        Object.assign(s.layers, preset);
        store.touch('layers');
      }
      break;
    }

    case 'tool': {
      const spec = TOOLS.find((x) => x.id === arg);
      if (spec?.mode) {
        store.set({ tool: arg });
        break;
      }
      switch (arg) {
        case 'layers':
          workspace.assetTab = 'layers';
          store.set({ section: 'home', view: 'overview' });
          workspace.panels.get('assets').markDirty();
          break;
        case 'frame':
          holo.resetTransform();
          break;
        case 'recentre':
          recentre();
          store.set({ lastGesture: 'recentred' });
          break;
        case 'pin':
          // Pinning does not move anything — it just refuses future automatic
          // repositioning, so the workspace stays where you put it.
          store.set({ pinned: !s.pinned });
          store.say('ai', s.pinned
            ? 'Workspace unpinned — Recentre will move it again.'
            : 'Workspace pinned to this spot. It will stay put until you unpin it.');
          break;
        case 'reset':
          onAction('reset:all', {});
          break;
      }
      break;
    }

    case 'layer':
      setLayer(arg, !s.layers[arg]);
      break;

    case 'assetTab':
      workspace.assetTab = arg;
      workspace.panels.get('assets').markDirty();
      break;

    case 'setPage':
      workspace.settingsPage = arg;
      workspace.panels.get('settings').markDirty();
      break;

    case 'theme':
      store.set({ themeId: arg });
      applyTheme();
      break;

    case 'model':
      if (arg === 'cycle') {
        const i = MODELS.findIndex((m) => m.id === s.modelId);
        store.set({ modelId: MODELS[(i + 1) % MODELS.length].id });
      } else {
        store.set({ modelId: arg });
      }
      loadModel();
      break;

    case 'site': {
      if (arg === 'cycle') {
        const i = SITES.findIndex((x) => x.id === s.siteId);
        store.set({ siteId: SITES[(i + 1) % SITES.length].id });
      } else {
        store.set({ siteId: arg });
      }
      refreshData();
      break;
    }

    case 'scen': {
      if (arg === 'add') {
        store.say('ai', 'All available datasets are already loaded. New sources can be added by extending the data layer.');
        store.set({ section: 'assistant' });
        break;
      }
      const on = !s.activeScenarios[arg];
      s.activeScenarios[arg] = on;
      // Arming a scenario nudges its governing knob, so the model visibly reacts.
      const sc = SCENARIOS.find((x) => x.id === arg);
      if (sc?.knob) {
        s.knobs[sc.knob] = THREE.MathUtils.clamp(s.knobs[sc.knob] + (on ? 0.12 : -0.12), 0, 1);
        store.touch('knobs');
      }
      store.touch('activeScenarios');
      recomputeSim();
      break;
    }

    case 'knob':
      s.knobs[arg] = ctx.value;
      store.touch('knobs');
      recomputeSim();
      break;

    case 'ask':
      ask(arg);
      break;

    case 'chat':
      if (arg === 'input') {
        workspace.chatFocused = true;
        workspace.updateVisibility();
        workspace.panels.get('copilot').markDirty();
      } else if (arg === 'send') {
        const text = workspace.chatDraft.trim();
        workspace.chatDraft = '';
        workspace.chatFocused = false;
        workspace.updateVisibility();
        workspace.panels.get('keyboard').markDirty();
        if (workspace.keyEntry) {
          workspace.keyEntry = false;
          if (text) {
            localStorage.setItem('aether.aiKey', text);
            store.set({ aiKey: text, section: 'settings' });
            store.say('ai', 'Key saved in this browser. I will use OpenRouter from now on.');
          }
        } else if (text) {
          ask(text);
        }
      }
      break;

    case 'key': {
      if (arg === 'close') {
        workspace.chatFocused = false;
        workspace.updateVisibility();
      } else if (arg === 'back') {
        workspace.chatDraft = workspace.chatDraft.slice(0, -1);
      } else if (arg === 'space') {
        workspace.chatDraft += ' ';
      } else if (workspace.chatDraft.length < 90) {
        workspace.chatDraft += arg;
      }
      workspace.panels.get('keyboard').markDirty();
      workspace.panels.get('copilot').markDirty();
      break;
    }

    case 'set':
      if (arg === 'dim') {
        store.set({ dim: ctx.value });
        env.setDim(ctx.value);
      } else if (arg === 'glow') {
        store.set({ showGlow: !s.showGlow });
        workspace.applyTheme(store.theme);
      } else if (arg === 'motion') {
        store.set({ reducedMotion: !s.reducedMotion });
        holo.spin = s.reducedMotion ? 0 : 0.05;
      }
      break;

    case 'dim':
      store.set({ dim: Number(arg) });
      env.setDim(Number(arg));
      break;

    case 'ui':
      if (arg === 'scale') {
        const v = 0.75 + ctx.value * 0.6;
        store.set({ uiScale: v });
        workspace.anchor.scale.setScalar(v);
      }
      break;

    case 'close':
      // Settings and Projects are modal sections, not cards on the wall —
      // closing them means leaving the section, not hiding a panel forever.
      if (arg === 'settings' || arg === 'projects') store.set({ section: 'home' });
      else store.close(arg);
      break;

    case 'ai':
      if (arg === 'key') {
        workspace.chatFocused = true;
        workspace.keyEntry = true;
        workspace.chatDraft = '';
        workspace.updateVisibility();
        workspace.panels.get('keyboard').markDirty();
      } else if (arg === 'clear') {
        localStorage.removeItem('aether.aiKey');
        store.set({ aiKey: '' });
        store.say('ai', 'Key removed. Back to answering on-device.');
      }
      break;

    case 'audio':
      if (arg === 'toggle') toggleAudio();
      else if (arg === 'volume') {
        store.set({ audioVolume: ctx.value });
        ambient.setVolume(ctx.value);
      }
      break;

    case 'reset':
      store.openAll();
      store.set({ dim: 0, uiScale: 1, tool: 'select', view: 'overview', selection: null, measurement: null });
      env.setDim(0);
      workspace.anchor.scale.setScalar(1);
      holo.resetTransform();
      holo.clearAnnotations();
      interaction.measurePoints = [];
      recentre();
      break;

    case 'sel':
      if (arg === 'clear') {
        store.set({ selection: null });
        holo.select(null);
      } else if (arg === 'annotate') {
        store.set({ tool: 'annotate' });
        store.say('ai', 'Annotate armed — pinch a point on the model to drop a note.');
      }
      break;

    case 'measure':
      if (arg === 'clear') {
        interaction.measurePoints = [];
        holo.setMeasurement(null, null);
        store.set({ measurement: null });
      }
      break;

    case 'mission': {
      const sim = recomputeSim();
      store.set({
        selection: {
          kind: 'mission',
          label: id.slice(8),
          detail: [
            ['Target', 'See Missions panel'],
            ['Ecosystem', `${Math.round(sim.env.ecosystem * 100)}/100`],
            ['Renewables', `${Math.round(sim.energy.coverage * 100)}%`],
            ['Water store', `${Math.round(sim.water.reservoir * 100)}%`],
          ],
        },
      });
      break;
    }

    case 'holo':
      handleHolo(arg, ctx);
      break;

    case 'gesture':
      if (arg === 'summon') {
        recentre();
        store.set({ lastGesture: 'summon · recentred' });
      }
      break;

    default:
      // Informational rows: surface what was tapped in the inspector.
      if (ctx.region) {
        store.set({
          selection: { kind: 'record', label: id.replace(/^[a-z]+:/, ''), detail: [] },
        });
      }
  }
}

function setLayer(id, on) {
  store.get().layers[id] = on;
  store.touch('layers');
}

function handleHolo(arg, ctx) {
  const sim = recomputeSim();
  const s = store.get();
  if (arg === 'select') {
    const sel = holo.select(ctx.pick, sim, s.data?.weather);
    store.set({ selection: sel, measurement: null });
  } else if (arg === 'measure') {
    interaction.measurePoints.push(ctx.point.clone());
    if (interaction.measurePoints.length === 2) {
      const [a, b] = interaction.measurePoints;
      const d = holo.setMeasurement(a, b);
      store.set({
        measurement: { text: d > 1000 ? (d / 1000).toFixed(2) + ' km' : d.toFixed(1) + ' m' },
        selection: null,
      });
      interaction.measurePoints = [];
    } else {
      store.set({ measurement: { text: 'Pick a second point' }, selection: null });
    }
  } else if (arg === 'annotate') {
    holo.addAnnotation(ctx.point, `Note ${holo.pinGroup.children.length + 1}`);
    store.set({ lastGesture: 'note dropped' });
  }
}

let askTimer = 0;
let pendingReply = null;

async function ask(intent) {
  const s = store.get();
  store.say('user', SUGGESTION_LABELS.get(intent) ?? intent);
  store.set({ chatBusy: true });
  const askCtx = {
    sim: recomputeSim(),
    weather: s.data?.weather?.ok ? s.data.weather : null,
    air: s.data?.air?.ok ? s.data.air : null,
    quakes: s.data?.quakes?.ok ? s.data.quakes : null,
    site: store.site,
    model: store.model,
    knobs: s.knobs,
  };
  // With a key this round-trips OpenRouter and falls back to the on-device
  // analyst on any failure; without one it never leaves the headset.
  const reply = s.aiKey
    ? await answerRemote(intent, askCtx, { key: s.aiKey, model: s.aiModel })
    : answer(intent, askCtx);
  pendingReply = reply;
  askTimer = s.aiKey ? 0 : replyDelay(reply.text);
}

// ---------------------------------------------------------------------------
// model + placement
// ---------------------------------------------------------------------------

function loadModel() {
  holo.load(store.get().modelId);
  workspace.panels.get('copilot').markDirty();
  workspace.panels.get('analysis').markDirty();
  recomputeSim();
}

const _head = new THREE.Vector3();
const _dir = new THREE.Vector3();

/**
 * Re-seat the whole workspace on wherever the user is now looking.
 *
 * Only ever called explicitly — from the Recentre tool, Home, or the very first
 * frame of a session. Nothing in the frame loop touches it, so the wall stays
 * bolted to the room while you walk around it.
 */
function recentre({ force = false } = {}) {
  if (store.get().pinned && !force) return;
  camera.getWorldPosition(_head);
  camera.getWorldDirection(_dir);
  _dir.y = 0;
  if (_dir.lengthSq() < 1e-6) _dir.set(0, 0, -1);
  _dir.normalize();

  // A group rotated by θ about Y sends its local −Z to (−sinθ, 0, −cosθ);
  // solving that against the view direction gives the yaw that puts the panel
  // wall square in front of the user.
  const yaw = Math.atan2(-_dir.x, -_dir.z);

  workspace.anchor.position.copy(_head);
  workspace.anchor.rotation.set(0, yaw, 0);

  holo.place(_head.clone().addScaledVector(_dir, 1.02).add(new THREE.Vector3(0, -0.22, 0)), yaw);
  env.follow(_head);
}

// ---------------------------------------------------------------------------
// session
// ---------------------------------------------------------------------------

const overlay = document.getElementById('overlay');
const enterBtn = document.getElementById('enter');
const desktopBtn = document.getElementById('desktop');
const statusEl = document.getElementById('status');
const bootBar = document.querySelector('#boot i');

const setBoot = (v) => (bootBar.style.width = `${Math.round(v * 100)}%`);
const say = (html) => (statusEl.innerHTML = html);

let mode = null; // 'xr' | 'desktop'

async function checkSupport() {
  if (!navigator.xr) {
    enterBtn.textContent = 'WebXR not available';
    say('This browser has no WebXR runtime. Open the page in the <b>Meta Quest Browser</b> on your headset, or use the screen preview below.');
    return false;
  }
  const ok = await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
  if (!ok) {
    const vr = await navigator.xr.isSessionSupported('immersive-vr').catch(() => false);
    enterBtn.textContent = vr ? 'Enter in VR (no passthrough)' : 'Immersive AR unsupported';
    enterBtn.disabled = !vr;
    say(vr
      ? 'This device supports immersive VR but not passthrough AR. The dimmer will start fully closed.'
      : 'No immersive session available on this device.');
    return vr ? 'vr' : false;
  }
  enterBtn.textContent = 'Enter workspace';
  enterBtn.disabled = false;
  say('Passthrough AR ready. Grant hand tracking when prompted.');
  return 'ar';
}

async function startXR(kind) {
  enterBtn.disabled = true;
  enterBtn.textContent = 'Starting…';
  const sessionInit = {
    requiredFeatures: ['local-floor'],
    optionalFeatures: ['hand-tracking', 'bounded-floor', 'layers', 'anchors', 'unbounded'],
  };
  try {
    const session = await navigator.xr.requestSession(
      kind === 'vr' ? 'immersive-vr' : 'immersive-ar',
      sessionInit
    );
    await renderer.xr.setSession(session);
    mode = 'xr';
    overlay.classList.add('hidden');

    // In a VR session there is no passthrough to blend with, so seal the void.
    const blend = session.environmentBlendMode;
    if (kind === 'vr' || blend === 'opaque') {
      store.set({ dim: 1 });
      env.setDim(1);
      env.dim = 1;
    }

    session.addEventListener('end', () => {
      mode = null;
      overlay.classList.remove('hidden');
      enterBtn.disabled = false;
      enterBtn.textContent = 'Re-enter workspace';
    });

    // Seat the workspace once the runtime has a real head pose.
    setTimeout(() => recentre({ force: true }), 350);
  } catch (e) {
    enterBtn.disabled = false;
    enterBtn.textContent = 'Enter workspace';
    say(`Could not start the session: <b>${e.message ?? e}</b>`);
  }
}

// ---------------------------------------------------------------------------
// desktop preview
// ---------------------------------------------------------------------------

const desktop = {
  enabled: false,
  yaw: 0,
  pitch: 0,
  pos: new THREE.Vector3(0, 1.6, 0),
  keys: new Set(),
  ndc: new THREE.Vector2(0, 0),
  pinching: false,
};

function startDesktop() {
  mode = 'desktop';
  desktop.enabled = true;
  input.desktopSource = desktop;
  // Approximate Quest 3's field of view so the preview shows what actually
  // fits around the user, rather than a much narrower keyhole.
  camera.fov = 88;
  camera.updateProjectionMatrix();
  overlay.classList.add('hidden');
  renderer.domElement.style.cursor = 'crosshair';
  recentre();

  renderer.domElement.addEventListener('click', () => renderer.domElement.requestPointerLock?.());
  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === renderer.domElement) {
      desktop.yaw -= e.movementX * 0.0022;
      desktop.pitch = THREE.MathUtils.clamp(desktop.pitch - e.movementY * 0.0022, -1.3, 1.3);
    } else {
      desktop.ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    }
  });
  document.addEventListener('mousedown', (e) => { if (e.button === 0) desktop.pinching = true; });
  document.addEventListener('mouseup', () => (desktop.pinching = false));
  document.addEventListener('keydown', (e) => {
    desktop.keys.add(e.code);
    if (e.code === 'KeyR') recentre();
    if (e.code === 'Escape') document.exitPointerLock?.();
  });
  document.addEventListener('keyup', (e) => desktop.keys.delete(e.code));
}

function updateDesktop(dt) {
  const speed = desktop.keys.has('ShiftLeft') ? 2.4 : 1.1;
  const fwd = new THREE.Vector3(-Math.sin(desktop.yaw), 0, -Math.cos(desktop.yaw));
  const right = new THREE.Vector3(Math.cos(desktop.yaw), 0, -Math.sin(desktop.yaw));
  if (desktop.keys.has('KeyW')) desktop.pos.addScaledVector(fwd, speed * dt);
  if (desktop.keys.has('KeyS')) desktop.pos.addScaledVector(fwd, -speed * dt);
  if (desktop.keys.has('KeyA')) desktop.pos.addScaledVector(right, -speed * dt);
  if (desktop.keys.has('KeyD')) desktop.pos.addScaledVector(right, speed * dt);
  if (desktop.keys.has('KeyQ')) desktop.pos.y -= speed * dt;
  if (desktop.keys.has('KeyE')) desktop.pos.y += speed * dt;

  camera.position.copy(desktop.pos);
  camera.rotation.set(desktop.pitch, desktop.yaw, 0, 'YXZ');
  camera.updateMatrixWorld(true);

  // Feed the pointer from the mouse ray so every control is testable.
  const origin = camera.getWorldPosition(new THREE.Vector3());
  const dir = new THREE.Vector3(desktop.ndc.x, desktop.ndc.y, 0.5)
    .unproject(camera).sub(origin).normalize();
  desktop.rayOrigin = origin;
  desktop.rayDir = dir;
}

// ---------------------------------------------------------------------------
// frame loop
// ---------------------------------------------------------------------------

const clock = new THREE.Clock();
let fpsAcc = 0, fpsN = 0;

function frame() {
  const dt = Math.min(0.05, clock.getDelta());
  const time = clock.elapsedTime;
  const s = store.get();

  if (mode === 'desktop') updateDesktop(dt);

  // fps readout (smoothed, only surfaced in Settings → About)
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) {
    store.get().fps = fpsN / fpsAcc;
    fpsAcc = 0; fpsN = 0;
  }

  // pending assistant reply
  if (pendingReply) {
    askTimer -= dt;
    if (askTimer <= 0) {
      const r = pendingReply;
      pendingReply = null;
      store.set({ chatBusy: false });
      store.say('ai', r.text);
      r.act?.(store);
      if (store.get().recenter) { recentre(); store.set({ recenter: 0 }); }
      recomputeSim();
    }
  }

  // periodic data refresh — the observations update roughly every 15 minutes
  refreshTimer += dt;
  if (refreshTimer > 600 && !s.loading) {
    refreshTimer = 0;
    refreshData(false);
  }

  input.setCamera(camera);
  input.update(dt);
  interaction.tool = s.tool;
  interaction.update(dt);

  const sim = workspace._sim;
  const ctx = {
    time, sim, weather: s.data?.weather?.ok ? s.data.weather : null,
    camera, layersOn: s.layers, tool: s.tool, timeOfDay: s.timeOfDay,
  };
  holo.spin = s.reducedMotion ? 0 : 0.05;
  holo.update(dt, ctx);
  env.update(dt, time);
  env.follow(camera.getWorldPosition(_head));
  workspace.refresh();

  renderer.clear();
  env.renderBackdrop(renderer, camera);
  renderer.render(scene, camera);
}

renderer.setAnimationLoop(frame);

// Handy from the browser console, and how the dev capture tooling introspects
// the running app.
window.aether = { THREE, renderer, scene, camera, rig, env, holo, input, workspace, interaction, store, recentre, frame };

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------

(async function boot() {
  setBoot(0.15);
  applyTheme();
  loadModel();
  setBoot(0.45);

  const support = await checkSupport();
  setBoot(0.6);
  enterBtn.addEventListener('click', () => startXR(support === 'vr' ? 'vr' : 'ar'));
  desktopBtn.addEventListener('click', startDesktop);

  // Copilot key, configurable before the headset goes on. Kept in localStorage
  // on this device only — there is no server here to hold it.
  const keyEl = document.getElementById('aiKey');
  const modelEl = document.getElementById('aiModel');
  const savedEl = document.getElementById('prefsSaved');
  keyEl.value = store.get().aiKey;
  modelEl.value = store.get().aiModel;
  const persist = () => {
    const key = keyEl.value.trim();
    const model = modelEl.value.trim() || 'anthropic/claude-3.5-sonnet';
    key ? localStorage.setItem('aether.aiKey', key) : localStorage.removeItem('aether.aiKey');
    localStorage.setItem('aether.aiModel', model);
    store.set({ aiKey: key, aiModel: model });
    savedEl.textContent = key ? `Saved · using ${model}` : 'Cleared · answering on-device';
  };
  keyEl.addEventListener('change', persist);
  modelEl.addEventListener('change', persist);

  // Try the device's own location so the model is about somewhere real to you.
  const here = await locateUser(5000);
  if (here) {
    SITES.unshift(here);
    store.set({ siteId: here.id });
  }
  setBoot(0.8);

  await refreshData();
  setBoot(1);
  const w = store.get().data?.weather;
  if (w?.ok) {
    say(
      `Live: <b>${store.site.name}</b> · ${Math.round(w.temp)} °C · wind ${w.wind.toFixed(1)} m/s. ` +
        (support ? 'Put the headset on and enter.' : 'Use the screen preview below.')
    );
  } else if (store.get().dataError) {
    say(`Running on the offline model — live feed unreachable (<b>${store.get().dataError}</b>).`);
  }
  setTimeout(() => setBoot(0), 900);
})();
