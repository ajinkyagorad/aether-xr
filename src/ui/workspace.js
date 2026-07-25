/**
 * The workspace: one curved wall of glass panels arranged around the user, with
 * the hologram in the well at its centre.
 *
 * Panels are declared once with a polar position and a paint function. The
 * paint function is re-run only when state it depends on changes, which keeps
 * the frame budget on Quest 3 for the 3-D scene.
 */

import * as THREE from 'three';
import { Panel } from './Panel.js';
import { artFor } from './draw.js';
import { c, THEMES } from '../core/theme.js';
import {
  store, VIEWS, SECTIONS, TOOLS, LAYERS, SCENARIOS, MISSIONS, MODELS,
} from '../core/state.js';
import { SITES, aqiBand, wmo, modelSeries } from '../data/sources.js';
import { SUGGESTIONS } from '../data/assistant.js';

/**
 * Panel geometry: metres, and where each sits on the sphere around the user.
 *
 * Sizes are set by legibility rather than taste — a card carrying ~26 characters
 * of body text needs to subtend roughly 20° for that text to clear one degree
 * of visual angle on Quest 3. Yaw/pitch are then spaced so that no two cards
 * overlap in angle, leaving the central ±16° clear for the hologram.
 */
const LAYOUT = {
  nav: { w: 0.225, h: 0.60, yaw: -45, pitch: 1, dist: 1.2 },
  topbar: { w: 1.16, h: 0.088, yaw: 0, pitch: 27, dist: 1.32, bend: 1.3 },

  environment: { w: 0.34, h: 0.225, yaw: -33, pitch: 18, dist: 1.2 },
  vitals: { w: 0.34, h: 0.30, yaw: -33, pitch: -1, dist: 1.16 },
  ecoHealth: { w: 0.34, h: 0.18, yaw: -33, pitch: -17, dist: 1.2 },
  ecoStatus: { w: 0.34, h: 0.25, yaw: -35, pitch: -33, dist: 1.28 },

  copilot: { w: 0.42, h: 0.345, yaw: 33, pitch: 17, dist: 1.2 },
  assets: { w: 0.42, h: 0.30, yaw: 33, pitch: -1, dist: 1.16 },
  analysis: { w: 0.42, h: 0.28, yaw: 33, pitch: -18, dist: 1.2 },
  missions: { w: 0.39, h: 0.22, yaw: 35, pitch: -34, dist: 1.3 },

  // Sits just under the model's containment shell, which bottoms out at ≈ −26°.
  dock: { w: 0.80, h: 0.15, yaw: 0, pitch: -29, dist: 1.12, bend: 1.1 },
  scenarios: { w: 0.92, h: 0.205, yaw: 0, pitch: -41, dist: 1.24, bend: 1.2 },

  inspector: { w: 0.39, h: 0.26, yaw: -15, pitch: -37, dist: 1.24 },
  settings: { w: 0.64, h: 0.55, yaw: 0, pitch: 3, dist: 1.0, bend: 1.1 },
  keyboard: { w: 0.66, h: 0.27, yaw: 6, pitch: -16, dist: 0.82, bend: 0.9 },
};

/** QWERTY, plus the punctuation you actually need to ask a question. */
const KEYS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', "'"],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '?'],
];

/** Which state keys force which panels to repaint. */
const DEPS = {
  nav: ['section', 'themeId'],
  topbar: ['view', 'modelId', 'themeId', 'recording'],
  environment: ['data', 'loading', 'themeId', 'siteId', 'closed'],
  vitals: ['data', 'knobs', 'themeId', 'closed', 'siteId'],
  ecoHealth: ['data', 'knobs', 'themeId', 'closed'],
  ecoStatus: ['data', 'knobs', 'themeId', 'closed'],
  copilot: ['chat', 'chatBusy', 'themeId', 'modelId', 'closed'],
  assets: ['data', 'knobs', 'layers', 'themeId', 'assetTab', 'modelId', 'closed'],
  analysis: ['data', 'knobs', 'themeId', 'modelId', 'view', 'closed'],
  missions: ['data', 'knobs', 'themeId', 'closed'],
  dock: ['tool', 'themeId', 'recording'],
  scenarios: ['activeScenarios', 'themeId', 'knobs'],
  inspector: ['selection', 'themeId', 'measurement'],
  keyboard: ['themeId', 'chatDraft'],
  settings: ['themeId', 'dim', 'modelId', 'siteId', 'uiScale', 'showGlow', 'reducedMotion', 'section', 'data'],
};

export class Workspace {
  /**
   * @param {THREE.Group} rig  panels are parented here so they follow recentre
   */
  constructor(rig, hologram) {
    this.rig = rig;
    this.holo = hologram;
    this.anchor = new THREE.Group();
    this.anchor.position.y = 0; // set to head height on recentre
    rig.add(this.anchor);

    this.panels = new Map();
    this.assetTab = 'assets';
    this.settingsPage = 'appearance';
    this.chatDraft = '';
    this.theme = store.theme;

    this.chatFocused = false;
    for (const id of Object.keys(LAYOUT)) this.make(id);
    this.applyTheme(this.theme);
    // Panels default to visible; settle that against the real state before the
    // first frame, or Settings and the keyboard flash up over the model.
    this.updateVisibility();

    store.on((keys) => this.onState(keys));
  }

  make(id) {
    const L = LAYOUT[id];
    const p = new Panel({ w: L.w, h: L.h, bend: L.bend ?? 1.5, name: id });
    p.placePolar(L.yaw, L.pitch, L.dist);
    p.content((pt) => this.paint(id, pt));
    this.anchor.add(p.object3D);
    this.panels.set(id, p);
    return p;
  }

  applyTheme(theme) {
    this.theme = theme;
    for (const p of this.panels.values()) {
      p.setTheme(theme);
      if (p.glowMat) p.glowMat.visible = store.get().showGlow;
    }
  }

  onState(keys) {
    if (keys.includes('themeId')) this.applyTheme(store.theme);
    if (keys.includes('uiScale')) this.anchor.scale.setScalar(store.get().uiScale);
    for (const [id, p] of this.panels) {
      if (DEPS[id].some((k) => keys.includes(k))) p.markDirty();
    }
    this.updateVisibility();
  }

  /** Section and selection decide which panels are on the wall right now. */
  updateVisibility() {
    const s = store.get();
    const inSettings = s.section === 'settings';
    for (const [id, p] of this.panels) {
      let vis = !store.isClosed(id);
      if (id === 'settings') vis = inSettings;
      else if (inSettings) vis = id === 'nav' || id === 'topbar';
      if (id === 'inspector') vis = vis && (!!s.selection || !!s.measurement);
      if (id === 'copilot' && s.section === 'assistant') vis = true;
      if (id === 'keyboard') vis = this.chatFocused;
      p.visible = vis;
    }
  }

  /** Repaint any dirty panel; called once per frame. */
  refresh() {
    for (const p of this.panels.values()) if (p.dirty && p.group.visible !== false) p.repaint();
  }

  get all() {
    return [...this.panels.values()];
  }

  // =========================================================================
  // painting
  // =========================================================================

  paint(id, p) {
    const fn = this[`paint_${id}`];
    if (fn) fn.call(this, p, p.panel.cw, p.panel.ch);
  }

  /** Shared card chrome; returns the inner content rect. */
  card(p, W, H, title, { ico, closeId, chipText, chipTone, pad = 16 } = {}) {
    p.glass(0, 0, W, H);
    let top = pad + 6;
    if (title) {
      const hoverClose = closeId ? p.panel.hoverAmount(closeId) : 0;
      p.header(pad, pad + 8, W - pad * 2, title, { ico, closeId, chipText, chipTone, hoverClose });
      top = pad + 26;
    }
    return { x: pad, y: top, w: W - pad * 2, h: H - top - pad };
  }

  get sim() {
    return this._sim ?? null;
  }

  // ------------------------------------------------------------------- nav
  paint_nav(p, W, H) {
    const s = store.get();
    const t = this.theme;
    p.glass(0, 0, W, H, { r: t.radius });

    // brand mark
    p.halo(W / 2 - 20, 22, 40, 40, t.accent, { r: 20, alpha: 0.6 });
    p.layer('base', (ctx) => {
      const g = ctx.createRadialGradient(W / 2 - 5, 36, 2, W / 2, 42, 22);
      g.addColorStop(0, c([255, 255, 255], 0.95));
      g.addColorStop(0.45, c(t.accent, 0.95));
      g.addColorStop(1, c(t.accent2, 0.95));
      ctx.beginPath();
      ctx.arc(W / 2, 42, 19, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
    });
    p.text('AETHER', W / 2, 76, {
      size: 15, weight: 700, align: 'center', caps: true, track: 0.26, color: c(t.ink, 0.9),
    });
    p.divider(14, 94, W - 28);

    const itemH = 52;
    SECTIONS.forEach((sec, i) => {
      const y = 108 + i * (itemH + 6);
      p.navItem(`nav:${sec.id}`, 10, y, W - 20, itemH, {
        label: sec.label, ico: sec.ico,
        active: s.section === sec.id,
        hover: p.panel.hoverAmount(`nav:${sec.id}`),
      });
    });

    // Live connection state at the foot of the rail.
    const y = H - 46;
    p.divider(14, y - 14, W - 28);
    const ok = s.data?.weather?.ok;
    p.layer('base', (ctx) => {
      ctx.beginPath();
      ctx.arc(24, y + 8, 4, 0, Math.PI * 2);
      ctx.fillStyle = c(s.loading ? t.warn : ok ? t.good : t.bad, 1);
      ctx.fill();
    });
    p.halo(16, y, 16, 16, s.loading ? t.warn : ok ? t.good : t.bad, { r: 8, alpha: 0.8 });
    p.text(s.loading ? 'Connecting' : ok ? 'Live data' : 'Offline', 38, y + 8, {
      size: 14, weight: 500, color: c(t.ink2, 0.95), max: W - 48,
    });
  }

  // ---------------------------------------------------------------- topbar
  paint_topbar(p, W, H) {
    const s = store.get();
    const t = this.theme;
    p.glass(0, 0, W, H, { r: H / 2 });

    // model badge on the left
    const badgeW = 168;
    p.icon(store.model.ico, 34, H / 2, 22, c(t.accent, 1), 2);
    p.icon(store.model.ico, 34, H / 2, 22, c(t.accent, 0.7), 3, 'glow');
    p.text(store.model.name, 54, H / 2 - 9, { size: 17, weight: 600, color: c(t.ink, 1), max: badgeW - 60 });
    p.text(store.model.subtitle, 54, H / 2 + 11, { size: 13, color: c(t.ink3, 1), max: badgeW - 60 });
    p.hit('model:cycle', 12, 8, badgeW - 8, H - 16, { kind: 'button' });
    p.layer('base', (ctx) => {
      ctx.beginPath();
      ctx.moveTo(badgeW + 4, 14);
      ctx.lineTo(badgeW + 4, H - 14);
      ctx.lineWidth = 1;
      ctx.strokeStyle = c(t.edge, t.edgeA * 0.5);
      ctx.stroke();
    });

    const railX = badgeW + 18;
    const railW = W - railX - (s.recording ? 130 : 22);
    const tw = railW / VIEWS.length;
    VIEWS.forEach((v, i) => {
      p.tab(`view:${v.id}`, railX + i * tw + 3, 8, tw - 6, H - 16, {
        label: v.label, ico: v.ico, size: 19,
        active: s.view === v.id,
        hover: p.panel.hoverAmount(`view:${v.id}`),
      });
    });

    if (s.recording) {
      const el = ((performance.now() - s.recordStart) / 1000) | 0;
      const mm = String((el / 60) | 0).padStart(2, '0');
      const ss = String(el % 60).padStart(2, '0');
      p.halo(W - 124, 16, 106, H - 32, t.bad, { r: (H - 32) / 2, alpha: 0.35 });
      p.layer('base', (ctx) => {
        p.rr(W - 124, 16, 106, H - 32, (H - 32) / 2);
        ctx.fillStyle = c(t.bad, 0.2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(W - 106, H / 2, 5.5, 0, Math.PI * 2);
        ctx.fillStyle = c(t.bad, 0.6 + 0.4 * Math.sin(p.now * 5));
        ctx.fill();
      });
      p.text(`REC ${mm}:${ss}`, W - 94, H / 2, { size: 15, weight: 700, mono: true, color: c(t.bad, 1) });
      p.hit('tool:record', W - 128, 12, 114, H - 24, { kind: 'button' });
    }
  }

  // ----------------------------------------------------------- environment
  paint_environment(p, W, H) {
    const t = this.theme;
    const s = store.get();
    const w = s.data?.weather;
    const air = s.data?.air;
    const r = this.card(p, W, H, 'Environment', { closeId: 'close:environment' });

    if (!w?.ok) {
      p.text(s.loading ? 'Fetching observations…' : 'Weather feed unavailable', r.x, r.y + 34, {
        size: 17, color: c(t.ink2, 0.9), max: r.w,
      });
      p.text(s.loading ? '' : 'Model still runs on defaults.', r.x, r.y + 58, { size: 14, color: c(t.ink3, 1), max: r.w });
      return;
    }

    const [desc, ico] = wmo(w.code);
    p.icon(ico, r.x + 26, r.y + 34, 46, c(t.accent, 0.95), 2.1);
    p.icon(ico, r.x + 26, r.y + 34, 46, c(t.accent, 0.55), 3.2, 'glow');
    p.text(`${Math.round(w.temp)}°`, r.x + 60, r.y + 26, { size: 42, weight: 300, color: c(t.ink, 1) });
    p.text('C', r.x + 60 + p.measure(`${Math.round(w.temp)}°`, 42, 300) + 4, r.y + 34, {
      size: 17, weight: 600, color: c(t.accent, 1),
    });
    p.text(desc, r.x + 60, r.y + 56, { size: 15, color: c(t.ink2, 1), max: r.w - 66 });

    const band = aqiBand(air?.aqi);
    if (air?.ok) p.chip(r.x + r.w - 76, r.y + 16, band.label, { tone: band.tone, size: 12.5 });

    p.divider(r.x, r.y + 74, r.w);
    const rows = [
      { ico: 'wind', label: 'Wind', value: `${w.wind.toFixed(1)} m/s` },
      { ico: 'droplet', label: 'Humidity', value: `${Math.round(w.humidity)}%` },
      { ico: 'sun', label: 'Irradiance', value: `${Math.round(w.irradiance)} W/m²` },
    ];
    rows.forEach((row, i) => p.stat(r.x, r.y + 96 + i * 26, r.w, { ...row, size: 16 }));

    p.text(String(w.time ?? '').slice(11, 16) + ' local', r.x, r.y + r.h - 8, {
      size: 13, color: c(t.ink3, 1),
    });
    p.text('OPEN-METEO', r.x + r.w, r.y + r.h - 8, {
      size: 11, weight: 700, align: 'right', caps: true, track: 0.14, color: c(t.ink3, 0.8),
    });
  }

  // ---------------------------------------------------------------- vitals
  paint_vitals(p, W, H) {
    const t = this.theme;
    const sim = this._sim;
    const r = this.card(p, W, H, `${store.site.name} vitals`, { closeId: 'close:vitals', chipText: 'model', chipTone: 'mute' });
    if (!sim) return;

    const rows = [
      { ico: 'people', label: 'Population', value: `${sim.population.toFixed(2)}M` },
      { ico: 'bolt', label: 'Renewable', value: `${Math.round(sim.energy.coverage * 100)}%`, tone: sim.energy.coverage > 0.6 ? 'good' : 'warn' },
      { ico: 'droplet', label: 'Water store', value: `${Math.round(sim.water.reservoir * 100)}%`, tone: sim.water.reservoir > 0.5 ? 'good' : 'bad' },
      { ico: 'car', label: 'Traffic flow', value: `${Math.round(sim.mobility.flow * 100)}%`, tone: sim.mobility.flow > 0.6 ? 'good' : 'warn' },
      { ico: 'leaf', label: 'Air quality', value: aqiBand(sim.env.aqi).label, tone: aqiBand(sim.env.aqi).tone },
    ];
    rows.forEach((row, i) => {
      p.stat(r.x, r.y + 18 + i * 28, r.w, { ...row, size: 17 });
      if (i < rows.length - 1) p.divider(r.x, r.y + 32 + i * 28, r.w, { alpha: 0.45 });
    });

    const y = r.y + 18 + rows.length * 28 + 6;
    p.micro('Grid demand · 24 h', r.x, y, { size: 12 });
    p.spark(r.x, y + 10, r.w, r.h - (y - r.y) - 18, this._series?.demand ?? [], { dots: true });
  }

  // ------------------------------------------------------------ ecoHealth
  paint_ecoHealth(p, W, H) {
    const t = this.theme;
    const sim = this._sim;
    const r = this.card(p, W, H, 'Ecosystem health', { closeId: 'close:ecoHealth' });
    if (!sim) return;
    const v = sim.env.ecosystem;
    p.gauge(r.x + 42, r.y + 42, 33, v, {
      sub: v > 0.66 ? 'Healthy' : v > 0.4 ? 'Stressed' : 'Critical',
    });
    p.spark(r.x + 92, r.y + 16, r.w - 96, 52, this._series?.eco ?? [], { dots: true, tint: t.good });
    p.text('30-day trend', r.x + 92, r.y + 80, { size: 13, color: c(t.ink3, 1) });
    const delta = this._series?.eco?.length
      ? (this._series.eco.at(-1) - this._series.eco[0]) * 100
      : 0;
    p.text(`${delta >= 0 ? '+' : ''}${delta.toFixed(1)} pts`, r.x + r.w, r.y + 80, {
      size: 14, weight: 600, align: 'right', mono: true, color: c(delta >= 0 ? t.good : t.bad, 1),
    });
  }

  // ------------------------------------------------------------ ecoStatus
  paint_ecoStatus(p, W, H) {
    const t = this.theme;
    const sim = this._sim;
    const r = this.card(p, W, H, 'Ecosystem status', { closeId: 'close:ecoStatus' });
    if (!sim) return;
    const grade = (v) => (v > 0.66 ? ['High', 'good'] : v > 0.4 ? ['Moderate', 'warn'] : ['Low', 'bad']);
    const rows = [
      ['Species diversity', sim.env.biodiversity],
      ['Water quality', 1 - Math.min(1, sim.env.aqi / 120)],
      ['Soil health', sim.env.soil],
      ['Carbon balance', 1 - Math.min(1, sim.carbonMtYr / 24)],
      ['Canopy cover', sim.env.canopy / 0.55],
    ];
    rows.forEach(([label, v], i) => {
      const [txt, tone] = grade(THREE.MathUtils.clamp(v, 0, 1));
      p.listRow(`eco:${i}`, r.x - 6, r.y + 8 + i * 27, r.w + 12, 25, {
        label, value: txt, dot: tone, hover: p.panel.hoverAmount(`eco:${i}`),
      });
    });
    p.pill('view:ecosystem', r.x, r.y + r.h - 30, 108, 28, {
      label: 'View details', hover: p.panel.hoverAmount('view:ecosystem'), tone: 'accent',
      active: store.get().view === 'ecosystem',
    });
  }

  // --------------------------------------------------------------- copilot
  paint_copilot(p, W, H) {
    const t = this.theme;
    const s = store.get();
    const r = this.card(p, W, H, 'AI Copilot', { ico: 'ai', closeId: 'close:copilot', chipText: 'on-device', chipTone: 'accent' });

    // orb
    const ox = r.x + r.w / 2, oy = r.y + 34;
    p.halo(ox - 34, oy - 34, 68, 68, t.accent, { r: 34, alpha: s.chatBusy ? 0.85 : 0.5 });
    p.layer('base', (ctx) => {
      const g = ctx.createRadialGradient(ox - 5, oy - 6, 1, ox, oy, 24);
      g.addColorStop(0, c([255, 255, 255], 0.95));
      g.addColorStop(0.4, c(t.accent, 0.9));
      g.addColorStop(1, c(t.accent2, 0.85));
      ctx.beginPath();
      ctx.arc(ox, oy, s.chatBusy ? 22 + Math.sin(p.now * 7) * 2 : 21, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
    });

    // last exchange
    const last = s.chat.at(-1);
    let y = oy + 40;
    if (last) {
      if (last.role === 'user') {
        p.text('You asked', r.x, y, { size: 12.5, weight: 600, caps: true, track: t.track, color: c(t.ink3, 1) });
        y += 18;
      }
      y = p.paragraph(s.chatBusy ? 'Working through the model…' : last.text, r.x, y, r.w, {
        size: 15.5, lh: 1.42, maxLines: 5, color: c(t.ink, last.role === 'ai' ? 0.94 : 0.72),
      });
      y += 12;
    }

    // suggestions
    const sug = SUGGESTIONS[s.modelId] ?? SUGGESTIONS.city;
    const rowH = 30;
    const avail = r.y + r.h - 46 - y;
    const n = Math.max(0, Math.min(sug.length, Math.floor(avail / (rowH + 6))));
    for (let i = 0; i < n; i++) {
      p.pill(`ask:${sug[i].id}`, r.x, y + i * (rowH + 6), r.w, rowH, {
        label: sug[i].label, ico: sug[i].ico, hover: p.panel.hoverAmount(`ask:${sug[i].id}`),
      });
    }

    p.field('chat:input', r.x, r.y + r.h - 36, r.w, 34, {
      placeholder: 'Ask anything…', value: this.chatDraft, sendId: 'chat:send',
      focused: this.chatFocused,
    });
  }

  // ---------------------------------------------------------------- assets
  paint_assets(p, W, H) {
    const t = this.theme;
    const s = store.get();
    const sim = this._sim;
    p.glass(0, 0, W, H);

    const tabs = [['assets', 'Assets'], ['layers', 'Layers'], ['data', 'Data']];
    const tw = (W - 32) / 3;
    tabs.forEach(([id, label], i) => {
      p.tab(`assetTab:${id}`, 16 + i * tw, 12, tw, 30, {
        label, active: this.assetTab === id, hover: p.panel.hoverAmount(`assetTab:${id}`),
      });
    });
    p.divider(16, 48, W - 32);
    const r = { x: 16, y: 60, w: W - 32, h: H - 76 };

    if (this.assetTab === 'assets') {
      if (!sim) return;
      const rows = [
        ['building', 'Buildings', sim.assets.buildings],
        ['box', 'Infrastructure', sim.assets.infrastructure],
        ['car', 'Vehicles', sim.assets.vehicles],
        ['people', 'People', sim.assets.people],
        ['leaf', 'Nature', sim.assets.nature],
        ['grid', 'Materials', sim.assets.materials],
      ];
      rows.forEach(([ico, label, v], i) => {
        p.listRow(`asset:${label}`, r.x - 6, r.y + i * 26, r.w + 12, 24, {
          label, ico, value: v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v.toLocaleString(),
          hover: p.panel.hoverAmount(`asset:${label}`),
        });
      });
      p.text('Counts are modelled, not surveyed', r.x, r.y + r.h - 6, { size: 12, color: c(t.ink3, 1), max: r.w });
    } else if (this.assetTab === 'layers') {
      LAYERS.forEach((l, i) => {
        const y = r.y + i * 24;
        p.icon(l.ico, r.x + 10, y + 10, 17, c(t.ink2, 0.85), 1.7);
        p.text(l.label, r.x + 26, y + 10, { size: 15, color: c(t.ink, 0.94), max: r.w - 80 });
        p.toggle(`layer:${l.id}`, r.x + r.w - 38, y + 3, 34, 15, !!s.layers[l.id], p.panel.hoverAmount(`layer:${l.id}`));
      });
    } else {
      const w = s.data?.weather;
      const air = s.data?.air;
      const q = s.data?.quakes;
      const rows = [
        ['Open-Meteo forecast', w?.ok ? 'Live' : 'Down', w?.ok ? 'good' : 'bad'],
        ['Open-Meteo air quality', air?.ok ? 'Live' : 'Down', air?.ok ? 'good' : 'bad'],
        ['USGS seismic (24 h)', q?.ok ? `${q.events.length} events` : 'Down', q?.ok ? 'good' : 'bad'],
        ['Site model', 'Deterministic', 'accent'],
      ];
      rows.forEach(([label, value, dot], i) =>
        p.listRow(`data:${i}`, r.x - 6, r.y + i * 30, r.w + 12, 28, {
          label, value, dot, hover: p.panel.hoverAmount(`data:${i}`),
        })
      );
      const y = r.y + rows.length * 30 + 4;
      p.micro('Site', r.x, y, { size: 12 });
      p.text(`${store.site.name}${store.site.country ? ', ' + store.site.country : ''}`, r.x, y + 20, {
        size: 15, weight: 600, color: c(t.ink, 1), max: r.w - 70,
      });
      p.pill('site:cycle', r.x + r.w - 66, y + 6, 66, 26, {
        label: 'Change', hover: p.panel.hoverAmount('site:cycle'), align: 'center',
      });
    }
  }

  // -------------------------------------------------------------- analysis
  paint_analysis(p, W, H) {
    const t = this.theme;
    const sim = this._sim;
    const s = store.get();
    const r = this.card(p, W, H, 'Technical analysis', { closeId: 'close:analysis', chipText: s.view, chipTone: 'accent' });
    if (!sim) return;

    const metrics = this.analysisMetrics(sim);
    metrics.slice(0, 3).forEach((m, i) => {
      const y = r.y + 20 + i * 34;
      p.miniRing(r.x + 17, y, 14, m.v, m.short, { tint: m.tint });
      p.text(m.label, r.x + 40, y - 8, { size: 14, color: c(t.ink2, 1), max: r.w - 120 });
      p.text(m.value, r.x + r.w, y - 8, { size: 15, weight: 600, align: 'right', mono: true, color: c(t.ink, 1) });
      p.progress(r.x + 40, y + 6, r.w - 40, m.v, { tint: m.tint, h: 4 });
    });

    const y = r.y + 128;
    const half = (r.w - 12) / 2;
    p.micro('Field', r.x, y, { size: 12 });
    p.fieldMap(r.x, y + 10, half, r.h - (y - r.y) - 18, sim.assets.buildings % 9973, { blobs: 5 });
    p.micro('Trend', r.x + half + 12, y, { size: 12 });
    p.spark(r.x + half + 12, y + 10, half, r.h - (y - r.y) - 18, this._series?.primary ?? [], {
      dots: true, tint: t.accent2,
    });
  }

  /** Model-specific readouts so the panel is never generic filler. */
  analysisMetrics(sim) {
    const t = this.theme;
    const m = store.get().modelId;
    if (m === 'turbine') {
      const load = 0.35 + sim.energy.coverage * 0.65;
      const eff = (84 + load * 8) / 100;
      const vib = 1.2 + (1 - sim.energy.coverage) * 2.4;
      return [
        { label: 'Efficiency', v: eff, value: (eff * 100).toFixed(1) + '%', short: String(Math.round(eff * 100)), tint: t.accent },
        { label: 'Power output', v: load, value: (load * 12.4).toFixed(1) + ' MW', short: String(Math.round(load * 100)), tint: t.good },
        { label: 'Vibration', v: Math.min(1, vib / 4.5), value: vib.toFixed(1) + ' mm/s', short: vib.toFixed(1), tint: vib > 3.5 ? t.bad : t.warn },
      ];
    }
    if (m === 'planet') {
      return [
        { label: 'Site suitability', v: sim.env.ecosystem, value: Math.round(sim.env.ecosystem * 100) + '/100', short: String(Math.round(sim.env.ecosystem * 100)), tint: t.accent },
        { label: 'Atmos. opacity', v: Math.min(1, sim.env.aqi / 100), value: (sim.env.aqi / 100).toFixed(2) + ' τ', short: (sim.env.aqi / 100).toFixed(1), tint: t.warn },
        { label: 'Power margin', v: sim.energy.coverage, value: (sim.energy.coverage * 100).toFixed(0) + '%', short: String(Math.round(sim.energy.coverage * 100)), tint: t.good },
      ];
    }
    if (m === 'island') {
      return [
        { label: 'Biodiversity', v: sim.env.biodiversity, value: Math.round(sim.env.biodiversity * 100) + '/100', short: String(Math.round(sim.env.biodiversity * 100)), tint: t.good },
        { label: 'Soil moisture', v: sim.env.soil, value: Math.round(sim.env.soil * 100) + '%', short: String(Math.round(sim.env.soil * 100)), tint: t.accent },
        { label: 'Canopy closure', v: sim.env.canopy / 0.55, value: Math.round(sim.env.canopy * 100) + '%', short: String(Math.round(sim.env.canopy * 100)), tint: t.accent2 },
      ];
    }
    return [
      { label: 'Renewable share', v: sim.energy.coverage, value: (sim.energy.coverage * 100).toFixed(0) + '%', short: String(Math.round(sim.energy.coverage * 100)), tint: t.good },
      { label: 'Network flow', v: sim.mobility.flow, value: (sim.mobility.flow * 100).toFixed(0) + '%', short: String(Math.round(sim.mobility.flow * 100)), tint: t.accent },
      { label: 'Carbon', v: Math.min(1, sim.carbonMtYr / 24), value: sim.carbonMtYr.toFixed(1) + ' Mt/yr', short: sim.carbonMtYr.toFixed(0), tint: t.warn },
    ];
  }

  // -------------------------------------------------------------- missions
  paint_missions(p, W, H) {
    const t = this.theme;
    const sim = this._sim;
    const r = this.card(p, W, H, 'Missions', { closeId: 'close:missions' });
    if (!sim) return;
    // Title + percentage on one line, status and bar on the next.
    const rowH = 40;
    const rows = MISSIONS.slice(0, Math.max(1, Math.floor((r.h - 30) / rowH)));
    rows.forEach((mi, i) => {
      const y = r.y + 14 + i * rowH;
      const pv = missionProgress(mi, sim);
      const tint = pv >= 1 ? t.good : mi.state === 'planned' ? t.ink3 : t.accent;
      p.text(mi.label, r.x, y, { size: 15, weight: 500, color: c(t.ink, 0.95), max: r.w - 56 });
      p.text(`${Math.round(pv * 100)}%`, r.x + r.w, y, {
        size: 14.5, weight: 700, align: 'right', mono: true, color: c(tint, 1),
      });
      p.text(mi.state === 'planned' ? 'Planned' : pv >= 1 ? 'Met' : 'In progress', r.x, y + 18, {
        size: 11.5, weight: 600, caps: true, track: t.track,
        color: c(mi.state === 'planned' ? t.ink3 : pv >= 1 ? t.good : t.warn, 1),
      });
      p.progress(r.x + 82, y + 15, r.w - 82, Math.min(1, pv), { tint, h: 5 });
      p.hit(`mission:${mi.id}`, r.x - 6, y - 12, r.w + 12, rowH - 4, { kind: 'button' });
    });
    p.pill('view:missions', r.x, r.y + r.h - 26, r.w, 25, {
      label: 'View all missions', align: 'center', hover: p.panel.hoverAmount('view:missions'),
    });
  }

  // ------------------------------------------------------------------ dock
  paint_dock(p, W, H) {
    const t = this.theme;
    const s = store.get();
    p.glass(0, 0, W, H, { r: H / 2.4 });
    p.micro('Quick tools', 22, 18, { size: 11.5 });

    const pad = 18;
    const bw = (W - pad * 2) / TOOLS.length;
    TOOLS.forEach((tool, i) => {
      p.tool(`tool:${tool.id}`, pad + i * bw + 3, 28, bw - 6, H - 40, {
        label: tool.label, ico: tool.ico,
        active: s.tool === tool.id || (tool.id === 'record' && s.recording),
        hover: p.panel.hoverAmount(`tool:${tool.id}`),
      });
    });

    // Contextual hint for whichever tool is armed.
    const hint = TOOLS.find((x) => x.id === s.tool)?.hint;
    if (hint) p.text(hint, W - 22, 18, { size: 12.5, align: 'right', color: c(t.ink3, 1), max: W * 0.55 });
  }

  // ------------------------------------------------------------- scenarios
  paint_scenarios(p, W, H) {
    const t = this.theme;
    const s = store.get();
    p.glass(0, 0, W, H, { r: t.radius });
    p.micro('Scenarios & datasets', 22, 20, { size: 12 });
    p.text('Tap to arm · sliders drive the model', W - 22, 20, {
      size: 12, align: 'right', color: c(t.ink3, 1), max: W * 0.5,
    });

    const pad = 20;
    const n = SCENARIOS.length + 1;
    const gap = 10;
    const tw = (W - pad * 2 - gap * (n - 1)) / n;
    const ty = 38;
    const th = H - ty - 16;

    SCENARIOS.forEach((sc, i) => {
      const x = pad + i * (tw + gap);
      const on = !!s.activeScenarios[sc.id];
      const hov = p.panel.hoverAmount(`scen:${sc.id}`);
      p.thumb(x, ty, tw, th - 26, artFor(sc.art), { r: 10, dim: on ? 0 : 0.42 });
      if (on) {
        p.halo(x - 2, ty - 2, tw + 4, th - 22, t.accent, { r: 12, alpha: 0.28 + hov * 0.2 });
        p.layer('base', (ctx) => {
          p.rr(x + 0.5, ty + 0.5, tw - 1, th - 27, 10);
          ctx.lineWidth = 1.6;
          ctx.strokeStyle = c(t.accent, 0.85);
          ctx.stroke();
        });
      }
      p.icon(sc.ico, x + 16, ty + 16, 16, c([255, 255, 255], on ? 0.95 : 0.55), 1.8);
      p.text(sc.label, x + tw / 2, ty + th - 38, {
        size: 12.5, weight: 600, align: 'center', color: c([255, 255, 255], 0.97), max: tw - 12,
      });
      p.text(on ? 'Active' : 'Off', x + tw / 2, ty + th - 12, {
        size: 11.5, weight: 700, align: 'center', caps: true, track: t.track,
        color: c(on ? t.accent : t.ink3, 1),
      });
      p.hit(`scen:${sc.id}`, x, ty, tw, th - 12, { kind: 'button' });
    });

    // "add dataset" tile
    const x = pad + SCENARIOS.length * (tw + gap);
    const hov = p.panel.hoverAmount('scen:add');
    p.well(x, ty, tw, th - 26, { r: 10, alpha: 0.7 + hov * 0.5 });
    p.icon('plus', x + tw / 2, ty + (th - 26) / 2, 26, c(t.ink2, 0.6 + hov * 0.4), 2);
    p.text('Add data', x + tw / 2, ty + th - 12, {
      size: 11.5, weight: 700, align: 'center', caps: true, track: t.track, color: c(t.ink3, 1),
    });
    p.hit('scen:add', x, ty, tw, th - 12, { kind: 'button' });
  }

  // ------------------------------------------------------------- inspector
  paint_inspector(p, W, H) {
    const t = this.theme;
    const s = store.get();
    const sel = s.selection;
    const r = this.card(p, W, H, sel ? 'Selection' : 'Measurement', {
      ico: sel ? 'target' : 'measure', closeId: 'close:inspector',
    });

    if (s.measurement && !sel) {
      p.bigStat(r.x, r.y + 34, s.measurement.text, 'Distance in model units', { size: 40, tint: t.accent2 });
      p.text('Pinch two points on the model to measure again.', r.x, r.y + 88, {
        size: 13.5, color: c(t.ink3, 1), max: r.w,
      });
      p.pill('measure:clear', r.x, r.y + r.h - 30, 92, 28, {
        label: 'Clear', ico: 'close', hover: p.panel.hoverAmount('measure:clear'),
      });
      return;
    }
    if (!sel) return;

    p.text(sel.label, r.x, r.y + 20, { size: 19, weight: 600, color: c(t.ink, 1), max: r.w });
    p.chip(r.x, r.y + 44, sel.kind, { tone: 'accent', size: 12 });
    p.divider(r.x, r.y + 60, r.w);
    (sel.detail ?? []).slice(0, 4).forEach(([k, v], i) =>
      p.stat(r.x, r.y + 80 + i * 24, r.w, { label: k, value: v, size: 15 })
    );
    p.pill('sel:annotate', r.x, r.y + r.h - 30, 104, 28, {
      label: 'Add note', ico: 'annotate', hover: p.panel.hoverAmount('sel:annotate'),
    });
    p.pill('sel:clear', r.x + 112, r.y + r.h - 30, 74, 28, {
      label: 'Clear', hover: p.panel.hoverAmount('sel:clear'),
    });
  }

  // -------------------------------------------------------------- keyboard
  paint_keyboard(p, W, H) {
    const t = this.theme;
    p.glass(0, 0, W, H, { r: t.radius, elevated: true });

    // Draft readout, so you can see what you are typing without looking away.
    p.well(16, 12, W - 32, 34, { r: 17 });
    p.text(this.chatDraft || 'Ask the copilot…', 32, 29, {
      size: 17, color: c(this.chatDraft ? t.ink : t.ink3, 0.95), max: W - 80,
    });
    p.layer('base', (ctx) => {
      const cx = 32 + p.measure(this.chatDraft, 17, 400) + 3;
      ctx.fillStyle = c(t.accent, 0.5 + 0.5 * Math.sin(p.now * 6));
      ctx.fillRect(cx, 20, 2, 18);
    });

    const pad = 14;
    const kw = (W - pad * 2 - 9 * 4) / 10;
    const kh = 32;
    const top = 56;
    KEYS.forEach((row, ri) => {
      const inset = ri === 1 ? kw * 0.3 : ri === 2 ? kw * 0.6 : 0;
      row.forEach((key, ci) => {
        const x = pad + inset + ci * (kw + 4);
        const y = top + ri * (kh + 5);
        const hov = p.panel.hoverAmount(`key:${key}`);
        p.layer('base', (ctx) => {
          p.rr(x, y, kw, kh, 7);
          ctx.fillStyle = c(t.spec, 0.07 + hov * 0.16);
          ctx.fill();
          p.rr(x + 0.5, y + 0.5, kw - 1, kh - 1, 7);
          ctx.lineWidth = 1;
          ctx.strokeStyle = c(t.edge, t.edgeA * (0.4 + hov * 0.6));
          ctx.stroke();
        });
        if (hov > 0.05) p.halo(x, y, kw, kh, t.accent, { r: 7, alpha: 0.22 * hov });
        p.text(key.toUpperCase(), x + kw / 2, y + kh / 2, {
          size: 17, weight: 500, align: 'center', color: c(t.ink, 0.94),
        });
        p.hit(`key:${key}`, x, y, kw, kh, { kind: 'button' });
      });
    });

    // Bottom row: space, backspace, send, close.
    const by = top + 3 * (kh + 5);
    const spaceW = W * 0.42;
    const mk = (id, x, w, label, ico, tone) => {
      const hov = p.panel.hoverAmount(id);
      p.pill(id, x, by, w, kh, { label, ico, align: 'center', hover: hov, tone, active: tone === 'accent' });
    };
    mk('key:space', pad, spaceW, 'Space', null, 'default');
    mk('key:back', pad + spaceW + 6, (W - pad * 2 - spaceW - 18) * 0.4, 'Delete', 'chevL', 'default');
    const sendX = pad + spaceW + 12 + (W - pad * 2 - spaceW - 18) * 0.4;
    mk('chat:send', sendX, W - pad - sendX - 42, 'Send', 'send', 'accent');
    p.icon('close', W - pad - 18, by + kh / 2, 18, c(t.ink3, 0.8), 2);
    p.hit('key:close', W - pad - 36, by, 36, kh, { kind: 'button' });
  }

  // -------------------------------------------------------------- settings
  paint_settings(p, W, H) {
    const t = this.theme;
    const s = store.get();
    p.glass(0, 0, W, H);
    p.header(24, 30, W - 48, 'Settings', { ico: 'settings', closeId: 'close:settings', hoverClose: p.panel.hoverAmount('close:settings') });

    const pages = [['appearance', 'Appearance'], ['immersion', 'Immersion'], ['model', 'Model'], ['about', 'About']];
    const tw = (W - 48) / pages.length;
    pages.forEach(([id, label], i) => {
      p.tab(`setPage:${id}`, 24 + i * tw, 50, tw, 32, {
        label, active: this.settingsPage === id, hover: p.panel.hoverAmount(`setPage:${id}`),
      });
    });
    p.divider(24, 90, W - 48);
    const r = { x: 28, y: 108, w: W - 56, h: H - 130 };

    if (this.settingsPage === 'appearance') {
      p.micro('Visual theme', r.x, r.y, { size: 13 });
      const sw = (r.w - 30) / 4;
      THEMES.forEach((th, i) => {
        const x = r.x + i * (sw + 10);
        const on = s.themeId === th.id;
        const hov = p.panel.hoverAmount(`theme:${th.id}`);
        p.layer('base', (ctx) => {
          p.rr(x, r.y + 18, sw, 64, 12);
          const g = ctx.createLinearGradient(x, r.y + 18, x, r.y + 82);
          g.addColorStop(0, c(th.glassTop, 0.95));
          g.addColorStop(1, c(th.glass, 0.95));
          ctx.fillStyle = g;
          ctx.fill();
          [th.accent, th.accent2, th.good].forEach((cc, k) => {
            ctx.beginPath();
            ctx.arc(x + 16 + k * 15, r.y + 42, 6, 0, Math.PI * 2);
            ctx.fillStyle = c(cc, 1);
            ctx.fill();
          });
          ctx.font = `600 12px ${t.font}`;
          ctx.fillStyle = c(th.ink, 0.95);
          ctx.textBaseline = 'middle';
          ctx.fillText(th.name, x + 12, r.y + 68);
          p.rr(x + 0.5, r.y + 18.5, sw - 1, 63, 12);
          ctx.lineWidth = on ? 2 : 1;
          ctx.strokeStyle = c(on ? t.accent : t.edge, on ? 0.95 : t.edgeA);
          ctx.stroke();
        });
        if (on || hov > 0.1) p.halo(x, r.y + 18, sw, 64, t.accent, { r: 12, alpha: on ? 0.3 : 0.15 * hov });
        p.hit(`theme:${th.id}`, x, r.y + 18, sw, 68, { kind: 'button' });
      });

      let y = r.y + 106;
      p.slider('ui:scale', r.x, y, r.w, (s.uiScale - 0.75) / 0.6, {
        label: 'Panel scale', valueText: `${Math.round(s.uiScale * 100)}%`, showTicks: 5,
      });
      y += 52;
      p.text('Bloom & glow layers', r.x, y + 8, { size: 15, color: c(t.ink, 0.95) });
      p.toggle('set:glow', r.x + r.w - 38, y, 36, 16, s.showGlow, p.panel.hoverAmount('set:glow'));
      y += 34;
      p.text('Reduce motion', r.x, y + 8, { size: 15, color: c(t.ink, 0.95) });
      p.toggle('set:motion', r.x + r.w - 38, y, 36, 16, s.reducedMotion, p.panel.hoverAmount('set:motion'));
      p.text('Stops the idle turntable and softens transitions.', r.x, y + 30, {
        size: 12.5, color: c(t.ink3, 1), max: r.w,
      });
    } else if (this.settingsPage === 'immersion') {
      // The passthrough dimmer — the one control that changes where you are.
      p.micro('Reality blend', r.x, r.y, { size: 13 });
      p.text(
        s.dim < 0.02 ? 'Full passthrough' : s.dim > 0.98 ? 'Fully immersed' : `${Math.round(s.dim * 100)}% dimmed`,
        r.x + r.w, r.y, { size: 14, weight: 600, align: 'right', mono: true, color: c(t.accent, 1) }
      );

      // A gradient preview strip reading room → void.
      p.layer('base', (ctx) => {
        p.rr(r.x, r.y + 16, r.w, 34, 8);
        const g = ctx.createLinearGradient(r.x, 0, r.x + r.w, 0);
        g.addColorStop(0, c(t.ink3, 0.18));
        g.addColorStop(1, c(t.voidTop, 1));
        ctx.fillStyle = g;
        ctx.fill();
        const kx = r.x + r.w * s.dim;
        ctx.fillStyle = c([255, 255, 255], 0.9);
        ctx.fillRect(kx - 1.5, r.y + 12, 3, 42);
      });
      p.text('Room', r.x + 8, r.y + 33, { size: 12, weight: 600, color: c(t.ink, 0.8) });
      p.text('Void', r.x + r.w - 8, r.y + 33, { size: 12, weight: 600, align: 'right', color: c([235, 245, 255], 0.9) });

      p.slider('set:dim', r.x, r.y + 62, r.w, s.dim, { showTicks: 5, h: 10 });
      p.text(
        'Slide right to fade your room out and seal into VR. Everything stays hand-tracked; ' +
          'you can slide back at any time.',
        r.x, r.y + 96, { size: 13, color: c(t.ink3, 1), max: r.w }
      );
      p.paragraph(
        'Passthrough is the safe default. Set a boundary in your headset before going past ' +
          'about 70% — you will not be able to see obstacles.',
        r.x, r.y + 124, r.w, { size: 13, color: c(t.warn, 0.95), maxLines: 3 }
      );

      let y = r.y + 182;
      const presets = [['Room', 0], ['Dim', 0.4], ['Theatre', 0.75], ['Void', 1]];
      const pw = (r.w - 24) / 4;
      presets.forEach(([label, v], i) => {
        p.pill(`dim:${v}`, r.x + i * (pw + 8), y, pw, 32, {
          label, align: 'center', active: Math.abs(s.dim - v) < 0.02,
          tone: 'accent', hover: p.panel.hoverAmount(`dim:${v}`),
        });
      });
    } else if (this.settingsPage === 'model') {
      p.micro('Subject', r.x, r.y, { size: 13 });
      MODELS.forEach((m, i) => {
        const y = r.y + 16 + i * 46;
        const on = s.modelId === m.id;
        p.listRow(`model:${m.id}`, r.x - 6, y, r.w + 12, 42, {
          label: m.name, sub: m.blurb, ico: m.ico, active: on,
          value: on ? 'Loaded' : '', hover: p.panel.hoverAmount(`model:${m.id}`),
        });
      });
      let y = r.y + 16 + MODELS.length * 46 + 8;
      p.divider(r.x, y, r.w);
      y += 16;
      p.micro('Observation site', r.x, y, { size: 13 });
      const cols = 3;
      const cw = (r.w - 16) / cols;
      SITES.forEach((site, i) => {
        const x = r.x + (i % cols) * (cw + 8);
        const yy = y + 16 + Math.floor(i / cols) * 34;
        p.pill(`site:${site.id}`, x, yy, cw, 30, {
          label: site.name, align: 'center', active: s.siteId === site.id,
          hover: p.panel.hoverAmount(`site:${site.id}`), tone: 'accent',
        });
      });
    } else {
      let y = r.y;
      p.text('AETHER Workspace', r.x, y, { size: 20, weight: 600, color: c(t.ink, 1) });
      y = p.paragraph(
        'A single spatial interface for exploring living models. Built with WebXR and ' +
          'three.js, rendered entirely procedurally — no downloaded meshes or textures.',
        r.x, y + 26, r.w, { size: 14, lh: 1.5 }
      );
      y += 14;
      p.micro('Live data sources', r.x, y, { size: 12 });
      [
        ['Open-Meteo', 'Weather forecast & air quality · CC BY 4.0'],
        ['USGS', 'Global earthquake feed, magnitude 2.5+ · public domain'],
        ['On-device model', 'Population, grid, mobility, ecology — deterministic'],
      ].forEach(([k, v], i) => {
        p.text(k, r.x, y + 22 + i * 32, { size: 14.5, weight: 600, color: c(t.accent, 1) });
        p.text(v, r.x, y + 39 + i * 32, { size: 12.5, color: c(t.ink3, 1), max: r.w });
      });
      y += 22 + 3 * 32 + 8;
      p.divider(r.x, y, r.w);
      p.text(`${Math.round(store.get().fps)} fps · ${store.get().lastGesture || 'hands ready'}`, r.x, y + 20, {
        size: 13, mono: true, color: c(t.ink3, 1),
      });
      p.pill('reset:all', r.x + r.w - 150, y + 8, 150, 30, {
        label: 'Reset workspace', ico: 'rotate', align: 'center', hover: p.panel.hoverAmount('reset:all'),
      });
    }
  }

  // =========================================================================
  // data plumbing
  // =========================================================================

  /** Recompute derived series when the underlying data or knobs change. */
  setSim(sim, data) {
    this._sim = sim;
    const s = store.get();
    if (data?.weather?.ok) {
      const site = store.site;
      this._series = {
        demand: modelSeries(site, data.weather, data.air, s.knobs, (x) => x.energy.demandGW),
        eco: modelSeries(site, data.weather, data.air, s.knobs, (x) => x.env.ecosystem),
        primary:
          s.modelId === 'turbine'
            ? modelSeries(site, data.weather, data.air, s.knobs, (x) => 0.84 + x.energy.coverage * 0.08)
            : s.modelId === 'island'
              ? modelSeries(site, data.weather, data.air, s.knobs, (x) => x.env.biodiversity)
              : modelSeries(site, data.weather, data.air, s.knobs, (x) => x.energy.coverage),
      };
    } else {
      this._series = { demand: [], eco: [], primary: [] };
    }
    for (const id of ['vitals', 'ecoHealth', 'ecoStatus', 'analysis', 'missions', 'assets', 'environment', 'settings'])
      this.panels.get(id)?.markDirty();
  }
}

/** Map a mission's metric path onto the model state. */
export function missionProgress(mission, sim) {
  const map = {
    'water.reservoir': sim.water.reservoir,
    'energy.coverageInv': sim.energy.coverage,
    'mobility.flow': sim.mobility.flow,
    'env.biodiversity': sim.env.biodiversity,
    'env.airInv': 1 - Math.min(1, sim.env.aqi / 100),
  };
  const v = map[mission.metric] ?? 0;
  return THREE.MathUtils.clamp(v / mission.target, 0, 1.2);
}
