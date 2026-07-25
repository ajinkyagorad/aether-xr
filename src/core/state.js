/**
 * Application state: one observable object, coarse-grained subscriptions.
 *
 * Panels subscribe to the keys they paint from, so changing the active tool
 * repaints the dock and the hologram label but not the fourteen other panels.
 */

import { THEMES } from './theme.js';
import { SITES } from '../data/sources.js';

export const MODELS = [
  {
    id: 'city',
    name: 'Coastal City',
    subtitle: 'Urban digital twin',
    art: 'city',
    ico: 'building',
    blurb: 'A mixed-density coastal district with offshore wind, tidal defences and a light-rail spine.',
  },
  {
    id: 'planet',
    name: 'Mars Analogue',
    subtitle: 'Planetary survey',
    art: 'mars',
    ico: 'globe',
    blurb: 'Orbital and surface survey of a candidate settlement basin, with live orbiter tracks.',
  },
  {
    id: 'island',
    name: 'Cloud Forest',
    subtitle: 'Living ecosystem',
    art: 'forest',
    ico: 'leaf',
    blurb: 'A montane cloud-forest fragment: canopy, hydrology, and the species that depend on both.',
  },
  {
    id: 'turbine',
    name: 'Turbine XJ-9',
    subtitle: 'Machine teardown',
    art: 'turbine',
    ico: 'settings',
    blurb: 'A 12 MW direct-drive turbine assembly with live thermal, vibration and efficiency telemetry.',
  },
];

export const VIEWS = [
  { id: 'overview', label: 'Overview', ico: 'dashboard' },
  { id: 'surface', label: 'Surface', ico: 'scan' },
  { id: 'ecosystem', label: 'Ecosystem', ico: 'leaf' },
  { id: 'analysis', label: 'Analysis', ico: 'chart' },
  { id: 'simulation', label: 'Simulation', ico: 'simulate' },
  { id: 'missions', label: 'Missions', ico: 'target' },
  { id: 'history', label: 'History', ico: 'history' },
];

export const SECTIONS = [
  { id: 'home', label: 'Home', ico: 'home' },
  { id: 'explore', label: 'Explore', ico: 'explore' },
  { id: 'projects', label: 'Projects', ico: 'projects' },
  { id: 'datasets', label: 'Datasets', ico: 'datasets' },
  { id: 'assistant', label: 'AI Assistant', ico: 'ai' },
  { id: 'settings', label: 'Settings', ico: 'settings' },
];

/**
 * The dock.
 *
 * Orbit / scale / reposition are *not* buttons — they are always live on a
 * pinch, because separating them into three modes meant three taps to do what
 * one gesture already does. `mode: true` entries change what a pinch on the
 * model means; the rest fire once and are done.
 */
export const TOOLS = [
  { id: 'select', label: 'Select', ico: 'select', mode: true, hint: 'Pinch a part to inspect it · pinch open air to orbit · two hands to scale' },
  { id: 'annotate', label: 'Note', ico: 'annotate', mode: true, hint: 'Pinch a point on the model to pin a note there' },
  { id: 'section', label: 'Section', ico: 'section', mode: true, hint: 'Pulls the assembly apart along its axis' },
  { id: 'layers', label: 'Layers', ico: 'layers', hint: 'Opens the layer list — toggle what the model draws' },
  { id: 'frame', label: 'Frame', ico: 'focus', hint: 'Refit the model to a comfortable size' },
  { id: 'recentre', label: 'Recentre', ico: 'target', hint: 'Bring the whole workspace to where you are now' },
  { id: 'pin', label: 'Pin', ico: 'pin', hint: 'Lock the workspace to this spot in your room' },
  { id: 'reset', label: 'Reset', ico: 'rotate', hint: 'Clear notes and restore the default arrangement' },
];

export const LAYERS = [
  { id: 'terrain', label: 'Terrain & water', ico: 'mountain', on: true },
  { id: 'buildings', label: 'Built form', ico: 'building', on: true },
  { id: 'vegetation', label: 'Vegetation', ico: 'leaf', on: true },
  { id: 'energy', label: 'Energy network', ico: 'bolt', on: true },
  { id: 'mobility', label: 'Mobility flows', ico: 'route', on: true },
  { id: 'atmosphere', label: 'Atmosphere', ico: 'wind', on: true },
  { id: 'labels', label: 'Spatial labels', ico: 'pin', on: true },
  { id: 'grid', label: 'Reference grid', ico: 'grid', on: false },
];

export const SCENARIOS = [
  { id: 'wind', label: 'Wind Simulation', art: 'wind', knob: 'renewableMix', ico: 'wind' },
  { id: 'energy', label: 'Energy Grid', art: 'energy', knob: 'renewableMix', ico: 'bolt' },
  { id: 'density', label: 'Population Density', art: 'density', knob: 'densification', ico: 'people' },
  { id: 'climate', label: 'Climate Projection', art: 'climate', knob: null, ico: 'globe' },
  { id: 'transport', label: 'Transport Flow', art: 'transport', knob: 'transitShare', ico: 'route' },
  { id: 'resource', label: 'Resource Map', art: 'resource', knob: 'greening', ico: 'seed' },
];

export const MISSIONS = [
  { id: 'water', label: 'Improve water resilience', metric: 'water.reservoir', target: 0.8, state: 'active' },
  { id: 'carbon', label: 'Reduce carbon intensity', metric: 'energy.coverageInv', target: 0.75, state: 'active' },
  { id: 'mobility', label: 'Smart mobility upgrade', metric: 'mobility.flow', target: 0.7, state: 'planned' },
  { id: 'bio', label: 'Biodiversity expansion', metric: 'env.biodiversity', target: 0.65, state: 'active' },
  { id: 'air', label: 'Clean air corridor', metric: 'env.airInv', target: 0.7, state: 'planned' },
];

function initial() {
  return {
    // presentation
    themeId: 'nebula',
    /** 0 = full passthrough, 1 = fully enclosed VR */
    dim: 0,
    uiScale: 1,
    handedness: 'right',
    showGlow: true,
    reducedMotion: false,

    // navigation
    section: 'home',
    view: 'overview',
    tool: 'select',
    modelId: 'city',
    siteId: SITES[0].id,

    // model controls
    layers: Object.fromEntries(LAYERS.map((l) => [l.id, l.on])),
    knobs: { renewableMix: 0.62, densification: 0.5, greening: 0.5, transitShare: 0.45 },
    activeScenarios: { wind: true, energy: true, density: true, climate: true, transport: true, resource: true },
    timeOfDay: 0.42, // 0..1 across the 24 h model window
    playing: false,

    // selection & annotation
    selection: null, // { kind, label, detail:[[k,v]…] }
    annotations: [],
    measurement: null, // { a: Vector3, b: Vector3, dist }

    // assistant
    chat: [
      { role: 'ai', text: 'Workspace ready. Ask me about this model, or pick a suggestion below.' },
    ],
    chatBusy: false,

    // panel visibility (users can close cards; Home restores them)
    closed: {},

    // anchoring — the workspace only moves when you ask it to
    pinned: false,

    // copilot: optional OpenRouter passthrough, key held in this browser only
    aiKey: localStorage.getItem('aether.aiKey') ?? '',
    aiModel: localStorage.getItem('aether.aiModel') ?? 'anthropic/claude-3.5-sonnet',

    // ambient audio
    audioOn: false,
    audioVolume: 0.35,

    // session
    data: null, // result of loadSite()
    loading: true,
    dataError: null,
    recording: false,
    recordStart: 0,
    fps: 0,
    lastGesture: '',
  };
}

class Store {
  constructor() {
    this.s = initial();
    this.subs = new Set();
  }

  get() {
    return this.s;
  }

  /** Shallow-merge a patch and notify subscribers with the changed keys. */
  set(patch) {
    const changed = [];
    for (const k of Object.keys(patch)) {
      if (this.s[k] !== patch[k]) changed.push(k);
      this.s[k] = patch[k];
    }
    if (changed.length) this.emit(changed);
    return this.s;
  }

  /** Mutate in place (for nested objects) and announce the top-level keys. */
  touch(...keys) {
    this.emit(keys);
  }

  emit(keys) {
    for (const fn of this.subs) fn(keys, this.s);
  }

  /** @returns unsubscribe */
  on(fn) {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  // -- convenience ------------------------------------------------------
  get theme() {
    return THEMES.find((t) => t.id === this.s.themeId) ?? THEMES[1];
  }
  get model() {
    return MODELS.find((m) => m.id === this.s.modelId) ?? MODELS[0];
  }
  get site() {
    return SITES.find((x) => x.id === this.s.siteId) ?? SITES[0];
  }
  isClosed(id) {
    return !!this.s.closed[id];
  }
  close(id) {
    this.s.closed[id] = true;
    this.emit(['closed']);
  }
  openAll() {
    this.s.closed = {};
    this.emit(['closed']);
  }
  say(role, text) {
    this.s.chat.push({ role, text });
    if (this.s.chat.length > 40) this.s.chat.shift();
    this.emit(['chat']);
  }
}

export const store = new Store();
