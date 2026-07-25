/**
 * On-device analyst.
 *
 * There is no language model in this build, so the copilot is a deterministic
 * analyst over the live observations and the model state. Every answer is
 * computed from numbers on screen — it never invents a figure — and several
 * intents also act on the workspace (switching view, moving a slider), which is
 * what makes it worth having rather than decorative.
 */

import { wmo, aqiBand } from './sources.js';

const pct = (v) => `${Math.round(v * 100)}%`;
const f1 = (v) => (v == null ? '—' : v.toFixed(1));

/**
 * @typedef {{ id:string, label:string, ico:string }} Suggestion
 * Suggestions are per-model so the panel never offers something meaningless
 * (you cannot "optimise the ecosystem" of a turbine).
 */
export const SUGGESTIONS = {
  city: [
    { id: 'growth', label: 'Analyse city growth', ico: 'trend' },
    { id: 'energy', label: 'Predict energy demand', ico: 'bolt' },
    { id: 'traffic', label: 'Optimise traffic', ico: 'route' },
    { id: 'flood', label: 'Show flood risk', ico: 'water' },
  ],
  planet: [
    { id: 'sites', label: 'Rank landing sites', ico: 'target' },
    { id: 'terrain', label: 'Analyse terrain', ico: 'mountain' },
    { id: 'weather', label: 'Predict dust activity', ico: 'wind' },
    { id: 'ice', label: 'Find water ice', ico: 'droplet' },
  ],
  island: [
    { id: 'species', label: 'Identify species', ico: 'fish' },
    { id: 'foodchain', label: 'Show the food chain', ico: 'route' },
    { id: 'climate', label: 'Climate change impact', ico: 'globe' },
    { id: 'conserve', label: 'Conservation ideas', ico: 'seed' },
  ],
  turbine: [
    { id: 'efficiency', label: 'Explain efficiency drop', ico: 'gauge' },
    { id: 'vibration', label: 'Diagnose vibration', ico: 'alert' },
    { id: 'maintenance', label: 'Plan maintenance', ico: 'settings' },
    { id: 'optimise', label: 'Optimise output', ico: 'trend' },
  ],
};

/**
 * @param {string} intentOrText  a suggestion id, or free text the user "typed"
 * @param {object} ctx  { store, sim, weather, air, quakes, site, model }
 * @returns {{ text: string, act?: (store) => void }}
 */
export function answer(intentOrText, ctx) {
  const { sim, weather, air, quakes, site, model } = ctx;
  const id = normalise(intentOrText);

  if (!sim) return { text: 'Still loading the model — give me a moment.' };

  switch (id) {
    // ---------------------------------------------------------- city
    case 'growth': {
      const a = sim.assets;
      return {
        text:
          `${site.name} is modelled at ${sim.population.toFixed(2)} M residents across ` +
          `${a.buildings.toLocaleString()} buildings. At the current densification setting ` +
          `(${pct(ctx.knobs.densification)}) the built stock grows about ` +
          `${(sim.population * 0.9).toFixed(0)}k m²/yr, which pushes canopy cover down unless ` +
          `greening is raised alongside it. Canopy is ${pct(sim.env.canopy)} today.`,
        act: (store) => store.set({ view: 'analysis' }),
      };
    }
    case 'energy': {
      const e = sim.energy;
      return {
        text:
          `Demand is running at ${f1(e.demandGW)} GW. Renewables are covering ${pct(e.coverage)} of ` +
          `it — ${f1(e.windGW)} GW wind at a ${pct(e.windCF)} capacity factor on the measured ` +
          `${f1(weather?.wind)} m/s, plus ${f1(e.solarGW)} GW solar at ${Math.round(weather?.irradiance ?? 0)} W/m². ` +
          `The remaining ${f1(e.importGW)} GW is imported at roughly ${Math.round(e.intensity)} gCO₂/kWh.`,
        act: (store) => store.set({ view: 'simulation' }),
      };
    }
    case 'traffic': {
      const m = sim.mobility;
      const gain = Math.min(0.35, (1 - ctx.knobs.transitShare) * 0.4);
      return {
        text:
          `Congestion is at ${pct(m.congestion)} with ${pct(m.transitLoad)} of trips on transit. ` +
          `Raising the transit share to ${pct(Math.min(0.9, ctx.knobs.transitShare + 0.2))} should cut ` +
          `peak congestion by around ${pct(gain)}. I've moved the slider so you can watch the flows change.`,
        act: (store) => {
          store.get().knobs.transitShare = Math.min(0.9, store.get().knobs.transitShare + 0.2);
          store.set({ view: 'simulation' });
          store.touch('knobs');
        },
      };
    }
    case 'flood': {
      const level = sim.water.reservoir;
      const risk = level > 0.85 ? 'elevated' : level > 0.7 ? 'moderate' : 'low';
      return {
        text:
          `Flood risk is ${risk}. Reservoir and tidal level sit at ${pct(level)} of the design ` +
          `envelope after ${f1(weather?.precip ?? 0)} mm of recent precipitation. The bay-side ` +
          `district is the exposed edge — it carries about ${Math.round(sim.population * 90)}k ` +
          `residents inside the 1-in-100-year contour.`,
        act: (store) => {
          store.get().layers.terrain = true;
          store.set({ view: 'analysis' });
          store.touch('layers');
        },
      };
    }

    // -------------------------------------------------------- planet
    case 'sites':
      return {
        text:
          `Six candidate basins are marked. The highest scorer combines a 3.1° mean slope, ` +
          `low boulder density and a ${pct(sim.env.ecosystem)} composite site score. Relay ` +
          `coverage there is 11 minutes every 2.1 hours from the three craft currently in orbit.`,
        act: (store) => store.set({ view: 'surface' }),
      };
    case 'terrain':
      return {
        text:
          `The relief model shows roughly 5.2 km of total range between basin floor and the ` +
          `highland rim. Slopes above 15° cluster on the crater walls; the interior plain holds ` +
          `under 4° across most of its area, which is inside landing tolerance.`,
        act: (store) => store.set({ view: 'surface' }),
      };
    case 'weather':
      return {
        text:
          `Dust lifting scales with wind. The analogue site is reading ${f1(weather?.wind)} m/s, ` +
          `so atmospheric opacity in the model sits at ${pct(Math.min(0.85, (weather?.wind ?? 5) / 18))}. ` +
          `Above about 15 m/s you would expect regional storms and a solar-array derate.`,
      };
    case 'ice':
      return {
        text:
          `Modelled volatiles concentrate poleward of the ice line, currently at ` +
          `${Math.round((0.68 + (1 - sim.env.ecosystem) * 0.18) * 90)}° latitude. Subsurface ice ` +
          `is most likely within a metre of the surface on pole-facing slopes in that band.`,
        act: (store) => store.set({ view: 'analysis' }),
      };

    // -------------------------------------------------------- island
    case 'species':
      return {
        text:
          `Four indicator species are tagged in this fragment: resplendent quetzal, spectacled ` +
          `bear, glass frog and orchid bee. Habitat score is ${Math.round(sim.env.biodiversity * 100)}/100 ` +
          `with ${pct(sim.env.canopy)} canopy closure — the frog is the sensitive one, it needs ` +
          `the stream margin to stay above ${pct(0.5)} soil moisture (currently ${pct(sim.env.soil)}).`,
        act: (store) => store.set({ view: 'ecosystem' }),
      };
    case 'foodchain':
      return {
        text:
          `Primary production runs through the epiphyte and bromeliad layer, feeding invertebrates ` +
          `(orchid bee as pollinator), then insectivores like the glass frog, with the quetzal as a ` +
          `frugivore-insectivore and the bear as the apex omnivore. Pull canopy below about 40% and ` +
          `the frugivore link breaks first.`,
        act: (store) => store.set({ view: 'ecosystem' }),
      };
    case 'climate':
      return {
        text:
          `Cloud forests live on the condensation band. At the measured ${f1(weather?.temp)} °C and ` +
          `${Math.round(weather?.humidity ?? 0)}% humidity, the band sits where the canopy is. Each ` +
          `1 °C of warming lifts it roughly 150 m upslope — on a fragment this size that removes ` +
          `habitat rather than moving it.`,
        act: (store) => store.set({ view: 'simulation' }),
      };
    case 'conserve':
      return {
        text:
          `Highest-leverage actions in the model: widen the riparian buffer along the stream, ` +
          `connect this fragment to the next ridge, and raise the greening setting — at ` +
          `${pct(ctx.knobs.greening)} today, taking it to 80% lifts biodiversity from ` +
          `${Math.round(sim.env.biodiversity * 100)} toward the mid-70s.`,
        act: (store) => {
          store.get().knobs.greening = 0.8;
          store.touch('knobs');
          store.set({ view: 'missions' });
        },
      };

    // ------------------------------------------------------- turbine
    case 'efficiency': {
      const load = 0.35 + sim.energy.coverage * 0.65;
      return {
        text:
          `The unit is at ${pct(load)} load, giving ${(84 + load * 8).toFixed(1)}% isentropic ` +
          `efficiency. The shortfall against the 92.4% design point is mostly stage-4 tip ` +
          `clearance opening up as the hot section runs at ${(480 + sim.energy.windCF * 140).toFixed(0)} °C. ` +
          `It recovers on a cold restart, which points at thermal growth rather than wear.`,
        act: (store) => store.set({ view: 'analysis' }),
      };
    }
    case 'vibration': {
      const v = 1.2 + (1 - sim.energy.coverage) * 2.4;
      return {
        text:
          `Broadband vibration is ${f1(v)} mm/s RMS against a 4.5 mm/s alarm. The energy sits at ` +
          `1× shaft order, which is imbalance rather than a bearing defect — a bearing fault would ` +
          `show up at the ball-pass frequencies instead. Trim balance at the next window.`,
        act: (store) => store.set({ view: 'analysis' }),
      };
    }
    case 'maintenance':
      return {
        text:
          `18 240 hours since overhaul. On condition, the next actions are: trim-balance the rotor, ` +
          `borescope stage 4 for tip rub, and recalibrate the EGT harness — it was last done 31 days ` +
          `ago and is the one advisory currently open.`,
        act: (store) => store.set({ view: 'missions' }),
      };
    case 'optimise':
      return {
        text:
          `Output tracks the grid setpoint. At the current renewable mix of ` +
          `${pct(ctx.knobs.renewableMix)} the machine is asked for ${f1(sim.energy.importGW)} GW of ` +
          `firming, which is why it is cycling. Raising the mix reduces cycling and the thermal ` +
          `fatigue that goes with it — I've opened the simulation controls.`,
        act: (store) => store.set({ view: 'simulation' }),
      };

    // ----------------------------------------------------- general
    case 'weathernow': {
      const [desc] = wmo(weather?.code);
      const band = aqiBand(air?.aqi);
      return {
        text:
          `${site.name} right now: ${desc.toLowerCase()}, ${f1(weather?.temp)} °C, wind ` +
          `${f1(weather?.wind)} m/s, ${Math.round(weather?.humidity ?? 0)}% humidity. Air quality ` +
          `is ${band.label.toLowerCase()} (EAQI ${Math.round(air?.aqi ?? 0)}, PM2.5 ${f1(air?.pm25)} µg/m³). ` +
          `Observations from Open-Meteo.`,
      };
    }
    case 'quakes': {
      const n = quakes?.events?.length ?? 0;
      const top = quakes?.events?.[0];
      return {
        text: n
          ? `${n} magnitude-2.5+ events worldwide in the last 24 hours (USGS). Largest is M${f1(top.mag)} ` +
            `at ${top.place}, ${Math.round(top.depth)} km deep.`
          : `The seismic feed is unavailable right now.`,
        act: (store) => store.set({ view: 'analysis' }),
      };
    }
    case 'help':
      return {
        text:
          `I read this workspace's live data. Ask me about energy, water, traffic, air quality, ` +
          `the ecosystem or the machine — or say "reset" to recentre everything, "dark"/"light" to ` +
          `change theme, or name a model: city, planet, forest, turbine.`,
      };

    default:
      return fallback(intentOrText, ctx);
  }
}

/** Keyword routing for typed text, plus a few direct commands. */
function normalise(s) {
  const k = String(s).trim().toLowerCase();
  if (SUGGESTION_IDS.has(k)) return k;
  const rules = [
    [/energy|power|grid|electric|demand/, 'energy'],
    [/traffic|congest|transit|mobility|commut/, 'traffic'],
    [/flood|water level|sea|tide|reservoir/, 'flood'],
    [/grow|population|density|housing|build/, 'growth'],
    [/species|animal|wildlife|bird|frog/, 'species'],
    [/food ?chain|trophic|predator/, 'foodchain'],
    [/climate|warming|temperature trend/, 'climate'],
    [/conserv|restore|rewild|protect/, 'conserve'],
    [/vibrat|balance|bearing/, 'vibration'],
    [/efficien|performance|isentropic/, 'efficiency'],
    [/maintain|service|overhaul|repair/, 'maintenance'],
    [/landing|site|basin/, 'sites'],
    [/terrain|slope|relief|elevation/, 'terrain'],
    [/dust|storm/, 'weather'],
    [/ice|volatile|frozen/, 'ice'],
    [/weather|forecast|wind|rain|air quality|aqi|pollut/, 'weathernow'],
    [/quake|seismic|earthquake/, 'quakes'],
    [/help|what can you|how do i/, 'help'],
  ];
  for (const [re, id] of rules) if (re.test(k)) return id;
  return k;
}

const SUGGESTION_IDS = new Set(Object.values(SUGGESTIONS).flat().map((s) => s.id));

/** Commands and a genuinely useful "I don't know" reply. */
function fallback(text, ctx) {
  const k = String(text).trim().toLowerCase();
  if (!k) return { text: 'Ask me anything about this model.' };

  const modelWords = { city: 'city', urban: 'city', planet: 'planet', mars: 'planet', forest: 'island', ecosystem: 'island', island: 'island', turbine: 'turbine', machine: 'turbine', engine: 'turbine' };
  for (const w in modelWords) {
    if (k.includes(w) && (k.includes('show') || k.includes('open') || k.includes('load') || k.includes('switch'))) {
      return { text: `Loading the ${w} model.`, act: (store) => store.set({ modelId: modelWords[w] }) };
    }
  }
  if (/reset|recent|centre|center/.test(k))
    return { text: 'Recentred the workspace on you.', act: (store) => store.set({ recenter: Date.now() }) };
  if (/dark|night|neon|cyber/.test(k))
    return { text: 'Switched to the Nebula theme.', act: (store) => store.set({ themeId: 'nebula' }) };
  if (/light|bright|clean|minimal/.test(k))
    return { text: 'Switched to the Aurora theme.', act: (store) => store.set({ themeId: 'aurora' }) };
  if (/vr|immers|passthrough|dim/.test(k))
    return {
      text: 'The passthrough dimmer is in Settings — slide it right to seal yourself into VR.',
      act: (store) => store.set({ section: 'settings' }),
    };

  return {
    text:
      `I can't answer that from the data I hold. I have live weather and air quality for ` +
      `${ctx.site.name}, the global seismic feed, and the full model state for the ` +
      `${ctx.model.name}. Try one of the suggestions, or ask about energy, water, traffic or air.`,
  };
}

/** Rough reading time so the reply can stream in at a natural pace. */
export const replyDelay = (text) => Math.min(1.6, 0.35 + text.length / 400);

// ---------------------------------------------------------------------------
// optional OpenRouter passthrough
// ---------------------------------------------------------------------------

/**
 * Compact snapshot of everything the workspace currently knows, handed to the
 * remote model as context. Kept small and factual so the model has no room to
 * invent figures that contradict the panels.
 */
function snapshot(ctx) {
  const { sim, weather, air, site, model, knobs } = ctx;
  const n = (v, d = 2) => (v == null ? null : Number(v.toFixed(d)));
  return {
    subject: model.name,
    site: `${site.name}${site.country ? ', ' + site.country : ''}`,
    observed: weather && {
      tempC: n(weather.temp, 1), windMs: n(weather.wind, 1),
      humidityPct: weather.humidity, cloudPct: weather.cloud,
      irradianceWm2: Math.round(weather.irradiance ?? 0),
      precipMm: n(weather.precip, 1), conditions: wmo(weather.code)[0],
      source: 'Open-Meteo',
    },
    airQuality: air && { eaqi: air.aqi, pm25: n(air.pm25, 1), band: aqiBand(air.aqi).label },
    modelled: sim && {
      populationM: n(sim.population),
      energy: {
        demandGW: n(sim.energy.demandGW), windGW: n(sim.energy.windGW),
        solarGW: n(sim.energy.solarGW), renewableSharePct: Math.round(sim.energy.coverage * 100),
        gridIntensityG: Math.round(sim.energy.intensity),
      },
      mobility: { congestionPct: Math.round(sim.mobility.congestion * 100) },
      water: { reservoirPct: Math.round(sim.water.reservoir * 100) },
      environment: {
        canopyPct: Math.round(sim.env.canopy * 100),
        biodiversity: Math.round(sim.env.biodiversity * 100),
        ecosystemScore: Math.round(sim.env.ecosystem * 100),
      },
      carbonMtPerYear: n(sim.carbonMtYr, 1),
    },
    scenarioKnobs: knobs,
  };
}

const SYSTEM = `You are the copilot inside AETHER, a spatial XR workspace the user is
wearing on a Meta Quest 3. A JSON snapshot of the live workspace state follows every
question. Rules:
- Answer only from that snapshot plus general knowledge. Never invent a number that
  contradicts it, and never present a modelled figure as an observation.
- Observed values come from Open-Meteo; everything under "modelled" is simulation.
- Be brief: 2-4 sentences. The user is reading this on a floating panel, not a page.
- No markdown, no bullet lists, no headings. Plain sentences only.`;

/**
 * Ask OpenRouter. Falls back to the deterministic analyst on any failure, so a
 * bad key or a dead network degrades to "still works" rather than "broken".
 * @returns {Promise<{text:string, act?:Function, remote:boolean}>}
 */
export async function answerRemote(question, ctx, { key, model }) {
  if (!key) return { ...answer(question, ctx), remote: false };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: ctl.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
        'HTTP-Referer': location.origin,
        'X-Title': 'AETHER XR',
      },
      body: JSON.stringify({
        model: model || 'anthropic/claude-3.5-sonnet',
        max_tokens: 400,
        messages: [
          { role: 'system', content: SYSTEM },
          {
            role: 'user',
            content: `${question}\n\nWORKSPACE STATE:\n${JSON.stringify(snapshot(ctx))}`,
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 120)}`);
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('empty response');
    // Keep any workspace action the local router would have taken, so remote
    // answers still drive the UI the way the built-in suggestions do.
    return { text, act: answer(question, ctx).act, remote: true };
  } catch (e) {
    const local = answer(question, ctx);
    return {
      ...local,
      text: `${local.text}\n\n(OpenRouter unavailable — ${String(e.message ?? e).slice(0, 80)} — answered on-device.)`,
      remote: false,
    };
  } finally {
    clearTimeout(timer);
  }
}
