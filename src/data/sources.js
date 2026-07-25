/**
 * Live data layer.
 *
 * Three real, key-free, CORS-enabled sources feed the workspace:
 *   • Open-Meteo forecast      — temperature, wind, cloud, shortwave radiation
 *   • Open-Meteo air quality   — PM2.5 / PM10 / NO2 / ozone → the AQ readout
 *   • USGS earthquake feed     — seismic events for the Analysis view
 *
 * Everything else (population, grid load, traffic, biodiversity) is produced by
 * a deterministic model in `simulate()` that is *driven by* those real inputs —
 * e.g. measured wind speed sets turbine output via a real power curve, and
 * measured irradiance sets PV yield. Modelled figures are tagged `sim: true`
 * so the UI can label them MODEL rather than passing them off as observations.
 */

const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const AIRQ = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const QUAKES = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson';

export const SITES = [
  { id: 'helsinki', name: 'Helsinki', country: 'FI', lat: 60.1699, lon: 24.9384, pop: 1.32, area: 'Uusimaa' },
  { id: 'singapore', name: 'Singapore', country: 'SG', lat: 1.3521, lon: 103.8198, pop: 5.92, area: 'Central' },
  { id: 'reykjavik', name: 'Reykjavík', country: 'IS', lat: 64.1466, lon: -21.9426, pop: 0.14, area: 'Capital' },
  { id: 'sanfrancisco', name: 'San Francisco', country: 'US', lat: 37.7749, lon: -122.4194, pop: 0.81, area: 'Bay Area' },
  { id: 'nairobi', name: 'Nairobi', country: 'KE', lat: -1.2864, lon: 36.8172, pop: 4.4, area: 'Nairobi' },
  { id: 'rotterdam', name: 'Rotterdam', country: 'NL', lat: 51.9244, lon: 4.4777, pop: 0.66, area: 'Zuid-Holland' },
];

const timeout = (ms) => {
  const ctl = new AbortController();
  setTimeout(() => ctl.abort(), ms);
  return ctl.signal;
};

async function getJSON(url, ms = 9000) {
  const res = await fetch(url, { signal: timeout(ms), cache: 'no-store' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// real sources
// ---------------------------------------------------------------------------

export async function fetchWeather(lat, lon) {
  const q = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,cloud_cover,surface_pressure,wind_speed_10m,wind_direction_10m,weather_code,is_day',
    hourly: 'temperature_2m,shortwave_radiation,wind_speed_10m,cloud_cover,precipitation',
    daily: 'temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_sum',
    forecast_days: '3',
    past_days: '1',
    timezone: 'auto',
    wind_speed_unit: 'ms',
  });
  const d = await getJSON(`${FORECAST}?${q}`);
  const cur = d.current ?? {};
  const h = d.hourly ?? {};
  // Index of "now" in the hourly arrays, so series line up with the clock.
  const nowISO = (cur.time ?? '').slice(0, 13);
  let i = (h.time ?? []).findIndex((t) => t.slice(0, 13) === nowISO);
  if (i < 0) i = Math.min(24, (h.time?.length ?? 1) - 1);

  const slice = (arr, back = 12, fwd = 12) =>
    (arr ?? []).slice(Math.max(0, i - back), i + fwd).map((v) => (v == null ? 0 : v));

  return {
    ok: true,
    tz: d.timezone,
    time: cur.time,
    temp: cur.temperature_2m,
    feels: cur.apparent_temperature,
    humidity: cur.relative_humidity_2m,
    precip: cur.precipitation,
    cloud: cur.cloud_cover,
    pressure: cur.surface_pressure,
    wind: cur.wind_speed_10m,
    windDir: cur.wind_direction_10m,
    code: cur.weather_code,
    isDay: !!cur.is_day,
    irradiance: h.shortwave_radiation?.[i] ?? 0,
    sunrise: d.daily?.sunrise?.[1] ?? d.daily?.sunrise?.[0],
    sunset: d.daily?.sunset?.[1] ?? d.daily?.sunset?.[0],
    tmax: d.daily?.temperature_2m_max?.[1],
    tmin: d.daily?.temperature_2m_min?.[1],
    series: {
      temp: slice(h.temperature_2m),
      irradiance: slice(h.shortwave_radiation),
      wind: slice(h.wind_speed_10m),
      cloud: slice(h.cloud_cover),
      precip: slice(h.precipitation),
      hours: slice(h.time).map((t) => String(t).slice(11, 13)),
    },
  };
}

export async function fetchAirQuality(lat, lon) {
  const q = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    current: 'pm10,pm2_5,nitrogen_dioxide,ozone,european_aqi',
    hourly: 'pm2_5,european_aqi',
    forecast_days: '2',
    timezone: 'auto',
  });
  const d = await getJSON(`${AIRQ}?${q}`);
  const cur = d.current ?? {};
  return {
    ok: true,
    pm25: cur.pm2_5,
    pm10: cur.pm10,
    no2: cur.nitrogen_dioxide,
    ozone: cur.ozone,
    aqi: cur.european_aqi,
    series: (d.hourly?.pm2_5 ?? []).slice(0, 24).map((v) => v ?? 0),
  };
}

export async function fetchQuakes() {
  const d = await getJSON(QUAKES);
  return {
    ok: true,
    events: (d.features ?? []).slice(0, 40).map((f) => ({
      mag: f.properties.mag,
      place: f.properties.place,
      time: f.properties.time,
      depth: f.geometry.coordinates[2],
      lat: f.geometry.coordinates[1],
      lon: f.geometry.coordinates[0],
      tsunami: !!f.properties.tsunami,
    })),
  };
}

/** European AQI bands → label + tone token. */
export function aqiBand(aqi) {
  if (aqi == null) return { label: '—', tone: 'mute' };
  if (aqi <= 20) return { label: 'Good', tone: 'good' };
  if (aqi <= 40) return { label: 'Fair', tone: 'good' };
  if (aqi <= 60) return { label: 'Moderate', tone: 'warn' };
  if (aqi <= 80) return { label: 'Poor', tone: 'warn' };
  return { label: 'Very poor', tone: 'bad' };
}

/** WMO weather codes → short text + an icon name from our set. */
export function wmo(code) {
  const m = {
    0: ['Clear sky', 'sun'], 1: ['Mainly clear', 'sun'], 2: ['Partly cloudy', 'cloud'], 3: ['Overcast', 'cloud'],
    45: ['Fog', 'cloud'], 48: ['Rime fog', 'cloud'],
    51: ['Light drizzle', 'rain'], 53: ['Drizzle', 'rain'], 55: ['Dense drizzle', 'rain'],
    61: ['Light rain', 'rain'], 63: ['Rain', 'rain'], 65: ['Heavy rain', 'rain'],
    71: ['Light snow', 'rain'], 73: ['Snow', 'rain'], 75: ['Heavy snow', 'rain'], 77: ['Snow grains', 'rain'],
    80: ['Rain showers', 'rain'], 81: ['Showers', 'rain'], 82: ['Violent showers', 'rain'],
    85: ['Snow showers', 'rain'], 86: ['Snow showers', 'rain'],
    95: ['Thunderstorm', 'rain'], 96: ['Storm + hail', 'rain'], 99: ['Storm + hail', 'rain'],
  };
  return m[code] ?? ['—', 'cloud'];
}

// ---------------------------------------------------------------------------
// deterministic model
// ---------------------------------------------------------------------------

/** Small xorshift PRNG so a given site+hour always models identically. */
function rng(seed) {
  let s = seed | 0 || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

const hash = (str) => {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};

/**
 * IEC-class turbine power curve, normalised to rated output.
 * Cut-in 3 m/s, rated 12 m/s, cut-out 25 m/s.
 */
export function turbinePower(ws) {
  if (ws == null || ws < 3) return 0;
  if (ws >= 25) return 0;
  if (ws >= 12) return 1;
  return Math.pow((ws - 3) / 9, 3);
}

/**
 * Build the full modelled state of a site from its real observations.
 * Pure and deterministic: same inputs → same numbers.
 */
export function simulate(site, weather, air, knobs = {}) {
  const hourOfDay = weather?.time ? Number(String(weather.time).slice(11, 13)) : new Date().getHours();
  const rnd = rng(hash(site.id) ^ (hourOfDay * 7919));

  const {
    renewableMix = 0.62, // scenario knobs, driven by the Simulation panel
    densification = 0.5,
    greening = 0.5,
    transitShare = 0.45,
  } = knobs;

  // --- population -----------------------------------------------------
  const population = site.pop * (0.94 + densification * 0.16);

  // --- energy ---------------------------------------------------------
  // Demand follows a two-peak daily curve, lifted by heating/cooling load.
  const t = weather?.temp ?? 15;
  const comfortGap = Math.abs(t - 18);
  const dayShape = 0.62 + 0.2 * Math.sin(((hourOfDay - 7) / 24) * Math.PI * 2) + 0.22 * Math.exp(-((hourOfDay - 19) ** 2) / 8);
  const demandGW = population * 0.9 * dayShape * (1 + comfortGap * 0.018);

  const pvCapacityGW = population * 0.42 * renewableMix;
  const pvYield = Math.max(0, (weather?.irradiance ?? 0) / 1000) * (1 - (weather?.cloud ?? 0) / 100 * 0.35);
  const solarGW = pvCapacityGW * pvYield;

  const windCapacityGW = population * 0.5 * renewableMix;
  const windCF = turbinePower(weather?.wind);
  const windGW = windCapacityGW * windCF;

  const renewableGW = solarGW + windGW;
  const gridCoverage = Math.min(1, renewableGW / Math.max(0.05, demandGW));
  const importGW = Math.max(0, demandGW - renewableGW);

  // --- mobility -------------------------------------------------------
  // Rain pushes people off bikes and into cars; congestion follows.
  const rainFactor = Math.min(1, (weather?.precip ?? 0) / 3);
  const rushness = Math.exp(-((hourOfDay - 8) ** 2) / 4) + Math.exp(-((hourOfDay - 17.5) ** 2) / 5);
  const congestion = Math.min(0.97, 0.16 + rushness * 0.46 * (1 - transitShare * 0.5) + rainFactor * 0.18 + densification * 0.1);
  const transitLoad = Math.min(0.99, 0.2 + rushness * 0.5 * transitShare + rainFactor * 0.15);

  // --- water ----------------------------------------------------------
  const reservoir = Math.max(0.15, Math.min(1, 0.68 + (weather?.precip ?? 0) * 0.05 - Math.max(0, t - 22) * 0.012));
  const waterDemand = population * 0.155 * (1 + Math.max(0, t - 18) * 0.02);

  // --- environment ----------------------------------------------------
  const aqi = air?.aqi ?? 30 + (1 - gridCoverage) * 30 + congestion * 25;
  const canopy = 0.18 + greening * 0.34;
  const biodiversity = Math.max(0.05, Math.min(1, 0.32 + canopy * 0.9 - densification * 0.16));
  const heatIsland = Math.max(0, (1.2 + densification * 2.4 - canopy * 3.1) * (t > 20 ? 1 : 0.45));
  // Cheap Mitchell-style soil moisture proxy from recent precipitation.
  const soil = Math.max(0.08, Math.min(1, 0.42 + (weather?.precip ?? 0) * 0.12 - Math.max(0, t - 24) * 0.02));

  const ecosystem = Math.max(0.05, Math.min(1,
    0.32 * biodiversity + 0.24 * (1 - Math.min(1, aqi / 100)) + 0.2 * soil + 0.24 * reservoir
  ));

  // --- carbon ---------------------------------------------------------
  const gridIntensity = 40 + (1 - gridCoverage) * 380; // gCO2/kWh
  const carbonMtYr = (demandGW * 8.76 * gridIntensity) / 1e3 / 1000 + population * 1.9 * (1 - transitShare * 0.5);

  // --- asset counts (stable per site) ---------------------------------
  const scaleN = (base) => Math.round(base * population * (0.8 + rnd() * 0.4));
  const assets = {
    buildings: scaleN(9400),
    infrastructure: scaleN(6600),
    vehicles: scaleN(3900) * (1 - transitShare * 0.4) | 0,
    people: Math.round(population * 1e6),
    nature: scaleN(17700 * (0.6 + greening)),
    materials: scaleN(5200),
  };

  return {
    hourOfDay,
    population,
    energy: {
      demandGW, solarGW, windGW, renewableGW, importGW,
      coverage: gridCoverage, windCF, pvYield,
      intensity: gridIntensity,
    },
    mobility: { congestion, transitLoad, flow: 1 - congestion },
    water: { reservoir, demand: waterDemand },
    env: { aqi, canopy, biodiversity, heatIsland, soil, ecosystem },
    carbonMtYr,
    assets,
    sim: true,
  };
}

/** Derive a 24-point series for any scalar produced by `simulate`. */
export function modelSeries(site, weather, air, knobs, pick) {
  if (!weather?.series?.temp?.length) return [];
  const out = [];
  const n = weather.series.temp.length;
  for (let i = 0; i < n; i++) {
    const w = {
      ...weather,
      temp: weather.series.temp[i],
      irradiance: weather.series.irradiance[i],
      wind: weather.series.wind[i],
      cloud: weather.series.cloud[i],
      precip: weather.series.precip[i],
      time: `0000-00-00T${String(weather.series.hours[i] ?? '00').padStart(2, '0')}:00`,
    };
    out.push(pick(simulate(site, w, air, knobs)));
  }
  return out;
}

// ---------------------------------------------------------------------------
// orchestration
// ---------------------------------------------------------------------------

/**
 * Load everything for a site. Never rejects: each source degrades to
 * `{ ok:false, error }` so one dead endpoint cannot blank the workspace.
 */
export async function loadSite(site) {
  const settle = (p) => p.then((v) => v).catch((e) => ({ ok: false, error: String(e.message ?? e) }));
  const [weather, air, quakes] = await Promise.all([
    settle(fetchWeather(site.lat, site.lon)),
    settle(fetchAirQuality(site.lat, site.lon)),
    settle(fetchQuakes()),
  ]);
  return { site, weather, air, quakes, fetchedAt: Date.now() };
}

/** Best-effort device location; falls back to the first preset site. */
export function locateUser(timeoutMs = 6000) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          id: 'here',
          name: 'Current position',
          country: '',
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          pop: 1.0,
          area: 'Local',
        }),
      () => resolve(null),
      { timeout: timeoutMs, maximumAge: 300000, enableHighAccuracy: false }
    );
  });
}
