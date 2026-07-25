/**
 * Design tokens for the four visual identities in the concept boards.
 *
 * Every colour is authored as an `rgba()`-ready triple so the canvas painter can
 * dial alpha per element without re-parsing hex strings each frame.
 */

const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** `c(token, alpha)` → css colour string. */
export const c = (t, a = 1) => `rgba(${t[0]},${t[1]},${t[2]},${a})`;

/** Linear-ish blend of two tokens, for gradients. */
export const mix = (a, b, t) => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

/** Pack a token to the 0xRRGGBB int three.js wants. */
export const hex = (t) => (t[0] << 16) | (t[1] << 8) | t[2];

function makeTheme(id, name, tagline, o) {
  return {
    id,
    name,
    tagline,
    /** true when the panel body is lighter than the text on it */
    light: !!o.light,

    // ---- surfaces -------------------------------------------------------
    glass: rgb(o.glass), //   panel body tint
    glassTop: rgb(o.glassTop ?? o.glass), // gradient stop at the panel's top edge
    glassA: o.glassA, //      panel body alpha
    edge: rgb(o.edge), //     1px outline
    edgeA: o.edgeA,
    spec: rgb(o.spec ?? '#ffffff'), // top specular highlight
    specA: o.specA,
    inset: rgb(o.inset ?? '#000000'), // recessed wells (inputs, tracks, thumbnails)
    insetA: o.insetA,

    // ---- ink ------------------------------------------------------------
    ink: rgb(o.ink), //       primary text
    ink2: rgb(o.ink2), //     secondary text / labels
    ink3: rgb(o.ink3), //     tertiary text / axis ticks

    // ---- brand ----------------------------------------------------------
    accent: rgb(o.accent),
    accent2: rgb(o.accent2),
    good: rgb(o.good ?? '#4ade80'),
    warn: rgb(o.warn ?? '#fbbf24'),
    bad: rgb(o.bad ?? '#f87171'),

    // ---- light & atmosphere --------------------------------------------
    /** additive glow strength multiplier for the bloom pass-substitute */
    glow: o.glow,
    /** blur radius (canvas px) used when building the glow layer */
    glowBlur: o.glowBlur ?? 14,
    /** colour of the volumetric haze that fills the room in full-VR mode */
    fog: rgb(o.fog),
    /** key / fill / rim light colours for the hologram */
    key: rgb(o.key),
    fill: rgb(o.fill),
    rim: rgb(o.rim),
    /** ambient level for the hologram in [0,1] */
    ambient: o.ambient,
    /** the "voidscape" revealed as the passthrough dimmer closes */
    voidTop: rgb(o.voidTop),
    voidBottom: rgb(o.voidBottom),
    /** floor grid colour in full-VR */
    grid: rgb(o.grid),

    // ---- geometry -------------------------------------------------------
    radius: o.radius, //      corner radius in canvas px at 1× scale
    hairline: o.hairline ?? 1.4,
    /** typeface stack + tracking personality */
    font: o.font ?? `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`,
    mono: `ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace`,
    /** uppercase micro-labels get this much letter-spacing (em) */
    track: o.track ?? 0.14,
  };
}

export const THEMES = [
  makeTheme('aurora', 'Aurora', 'Minimal · Clean · Light', {
    light: true,
    glass: '#ffffff',
    glassTop: '#ffffff',
    glassA: 0.62,
    edge: '#8fa3c4',
    edgeA: 0.34,
    spec: '#ffffff',
    specA: 0.9,
    inset: '#5f7190',
    insetA: 0.1,
    ink: '#141a26',
    ink2: '#4a5568',
    ink3: '#8b97ab',
    accent: '#4d6ef5',
    accent2: '#8b5cf6',
    good: '#16a34a',
    warn: '#d97706',
    bad: '#dc2626',
    glow: 0.35,
    glowBlur: 10,
    fog: '#dfe8f5',
    key: '#ffffff',
    fill: '#cfe0ff',
    rim: '#8b5cf6',
    ambient: 0.72,
    voidTop: '#f2f6fc',
    voidBottom: '#d7e0ee',
    grid: '#9fb2cc',
    radius: 22,
    hairline: 1.3,
    track: 0.13,
  }),

  makeTheme('nebula', 'Nebula', 'Futuristic · Neon · Cyber', {
    glass: '#0a1b33',
    glassTop: '#153355',
    glassA: 0.5,
    edge: '#4fd4ff',
    edgeA: 0.5,
    spec: '#b7ecff',
    specA: 0.5,
    inset: '#00060f',
    insetA: 0.4,
    ink: '#eaf6ff',
    ink2: '#9dc4e6',
    ink3: '#5d84a8',
    accent: '#35c8ff',
    accent2: '#b06bff',
    good: '#3ee6a0',
    warn: '#ffc44d',
    bad: '#ff6b81',
    glow: 1,
    glowBlur: 18,
    fog: '#071427',
    key: '#8fdcff',
    fill: '#3a6bd6',
    rim: '#c07bff',
    ambient: 0.34,
    voidTop: '#040a16',
    voidBottom: '#0a1730',
    grid: '#2a6f9e',
    radius: 18,
    hairline: 1.5,
    track: 0.17,
  }),

  makeTheme('verdant', 'Verdant', 'Natural · Organic · Spatial', {
    glass: '#1d2c22',
    glassTop: '#31452f',
    glassA: 0.52,
    edge: '#a8c9a0',
    edgeA: 0.36,
    spec: '#e6f5df',
    specA: 0.42,
    inset: '#0a140d',
    insetA: 0.34,
    ink: '#f0f7ea',
    ink2: '#b9cfae',
    ink3: '#7f9a78',
    accent: '#8fd694',
    accent2: '#e0b467',
    good: '#8fd694',
    warn: '#e0b467',
    bad: '#e08a6a',
    glow: 0.6,
    glowBlur: 20,
    fog: '#16281a',
    key: '#fff3d6',
    fill: '#79a86f',
    rim: '#d9f0a8',
    ambient: 0.5,
    voidTop: '#0c1810',
    voidBottom: '#1a2c1c',
    grid: '#4e7351',
    radius: 26,
    hairline: 1.3,
    track: 0.15,
  }),

  makeTheme('graphite', 'Graphite', 'Technical · Professional · Dense', {
    glass: '#0e141c',
    glassTop: '#1a2430',
    glassA: 0.68,
    edge: '#5c748f',
    edgeA: 0.42,
    spec: '#cfe2f5',
    specA: 0.34,
    inset: '#05080d',
    insetA: 0.5,
    ink: '#dfeaf6',
    ink2: '#93a7bd',
    ink3: '#5e7186',
    accent: '#2f9bf0',
    accent2: '#ff8a3d',
    good: '#35d07f',
    warn: '#ffb020',
    bad: '#ff5c5c',
    glow: 0.55,
    glowBlur: 12,
    fog: '#0a0f16',
    key: '#cfe6ff',
    fill: '#2a5c8a',
    rim: '#ff8a3d',
    ambient: 0.38,
    voidTop: '#05080d',
    voidBottom: '#0d141d',
    grid: '#2c3b4d',
    radius: 10,
    hairline: 1.2,
    track: 0.18,
  }),
];

export const themeById = (id) => THEMES.find((t) => t.id === id) ?? THEMES[1];
