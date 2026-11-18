const SoilProfileCache = require('../models/SoilProfileCache');

const BASE_URL = 'https://rest.isric.org/soilgrids/v2.0';
const CACHE_MS = 30 * 24 * 60 * 60 * 1000;
const PROPERTIES = {
  phh2o: { label: 'pH (water)', unit: 'pH', scale: 10 },
  soc: { label: 'Soil organic carbon', unit: 'g/kg', scale: 10 },
  nitrogen: { label: 'Total nitrogen', unit: 'g/kg', scale: 100 },
  clay: { label: 'Clay', unit: '%', scale: 10 },
  silt: { label: 'Silt', unit: '%', scale: 10 },
  sand: { label: 'Sand', unit: '%', scale: 10 },
  cec: { label: 'Cation exchange capacity', unit: 'cmol(+)/kg', scale: 10 },
  bdod: { label: 'Bulk density', unit: 'kg/dm³', scale: 100 }
};
const DEPTHS = ['0-5cm', '5-15cm'];
const providerCalls = [];

function cacheKey(latitude, longitude) {
  // SoilGrids is a 250 m gridded product. Coarse keying prevents repeated
  // requests for slightly different GPS readings within the same locality.
  return `${latitude.toFixed(3)}:${longitude.toFixed(3)}`;
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw new Error(`SoilGrids returned HTTP ${response.status}`);
  return response.json();
}

function normalizeProperties(payload) {
  const layers = payload?.properties?.layers || [];
  return Object.entries(PROPERTIES).map(([key, definition]) => {
    const layer = layers.find(item => item.name === key);
    return {
      key,
      label: definition.label,
      unit: definition.unit,
      depths: DEPTHS.map(depthName => {
        const depth = layer?.depths?.find(item => item.label === depthName);
        const values = depth?.values || {};
        const convert = raw => Number.isFinite(raw) ? Number((raw / definition.scale).toFixed(3)) : null;
        const median = values['Q0.5'];
        const mean = values.mean;
        return { depth: depthName, estimate: convert(Number.isFinite(median) ? median : mean), statistic: Number.isFinite(median) ? 'Median (Q0.5)' : 'Mean', lower: convert(values['Q0.05']), upper: convert(values['Q0.95']) };
      })
    };
  }).filter(property => property.depths.some(depth => depth.estimate !== null));
}

async function fetchProfile(latitude, longitude) {
  const now = Date.now();
  while (providerCalls.length && now - providerCalls[0] >= 60_000) providerCalls.shift();
  if (providerCalls.length >= 5) throw new Error('SoilGrids fair-use request limit reached. Please retry in about a minute.');
  providerCalls.push(now);
  const query = new URLSearchParams({ lat: String(latitude), lon: String(longitude) });
  for (const key of Object.keys(PROPERTIES)) query.append('property', key);
  for (const depth of DEPTHS) query.append('depth', depth);
  for (const value of ['Q0.5', 'mean', 'Q0.05', 'Q0.95']) query.append('value', value);
  // Fetch all selected layers and depths in one provider request to stay
  // within SoilGrids' published fair-use limit.
  const propertyPayload = await fetchJson(`${BASE_URL}/properties/query?${query}`);
  const properties = normalizeProperties(propertyPayload);
  if (!properties.length) throw new Error('SoilGrids returned no soil property estimates for this coordinate.');
  return {
    source: 'ISRIC SoilGrids 2.0',
    method: 'Modeled gridded estimates at the supplied coordinate; not field or laboratory measurements.',
    resolutionMeters: 250,
    retrievedAt: new Date().toISOString(),
    coordinates: [longitude, latitude],
    depthIntervals: DEPTHS,
    properties,
    textureDescription: 'Clay, silt, and sand are modeled particle-size fractions; compare them together as a texture profile. This is not a field classification.'
  };
}

async function getProfile(farm) {
  const [longitude, latitude] = farm?.location?.coordinates || [];
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(longitude) > 180 || Math.abs(latitude) > 90) {
    return { unavailable: true, message: 'Share and save your farm coordinates to request a SoilGrids profile.' };
  }
  const key = cacheKey(latitude, longitude);
  const cacheQuery = { cacheKey: key };
  const now = new Date();
  const cached = await SoilProfileCache.findOne({ ...cacheQuery, expiresAt: { $gt: now } }).lean();
  if (cached?.data) return { ...cached.data, coordinates: [longitude, latitude], cached: true };

  const stale = await SoilProfileCache.findOne(cacheQuery).lean();
  try {
    const data = await fetchProfile(latitude, longitude);
    await SoilProfileCache.findOneAndUpdate(cacheQuery, {
      $set: {
        location: { type: 'Point', coordinates: [longitude, latitude] },
        data,
        expiresAt: new Date(Date.now() + CACHE_MS)
      }
    }, { upsert: true, new: true, runValidators: true });
    return { ...data, cached: false };
  } catch (error) {
    console.warn(`[SoilGrids] Profile unavailable: ${error.message}`);
    if (stale?.data) return { ...stale.data, coordinates: [longitude, latitude], cached: true, stale: true };
    if (error.message.includes('no soil property estimates')) return { unavailable: true, message: 'SoilGrids has no usable estimate for this map pixel. Your saved soil details have not changed.' };
    if (error.message.includes('fair-use')) return { unavailable: true, message: error.message };
    return { unavailable: true, message: 'SoilGrids is temporarily unavailable. Try again later; your saved soil details have not changed.' };
  }
}

module.exports = { getProfile };
