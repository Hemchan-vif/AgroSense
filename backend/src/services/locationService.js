const PlaceCache = require('../models/PlaceCache');

const CACHE_MS = 30 * 24 * 60 * 60 * 1000;
let queue = Promise.resolve();
let lastRequestAt = 0;

function keyFor(latitude, longitude) {
  return `${Number(latitude).toFixed(4)}:${Number(longitude).toFixed(4)}`;
}

function requestNominatim(url) {
  const task = queue.then(async () => {
    const wait = Math.max(0, 1100 - (Date.now() - lastRequestAt));
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
    const response = await fetch(url, {
      headers: { 'user-agent': 'AgroSense/1.0 (farm advisory Mini App)' },
      signal: AbortSignal.timeout(7000)
    });
    if (!response.ok) throw new Error(`Geocoder returned HTTP ${response.status}`);
    return response.json();
  });
  queue = task.then(() => undefined, () => undefined);
  return task;
}

function formatPlace(address = {}, displayName = '') {
  const local = address.neighbourhood || address.suburb || address.city_district || address.hamlet || address.village || address.town || address.city || address.municipality;
  const regional = address.county || address.state_district || address.state || address.region;
  const parts = [...new Set([local, regional, address.state, address.country].filter(Boolean))];
  return parts.length ? parts.join(', ') : displayName.split(',').slice(0, 3).join(',').trim() || null;
}

async function resolve(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  const cacheKey = keyFor(latitude, longitude);
  const cached = await PlaceCache.findOne({ cacheKey, expiresAt: { $gt: new Date() } }).lean();
  if (cached) return { placeName: cached.placeName, address: cached.address, cached: true };

  try {
    const query = new URLSearchParams({ format: 'jsonv2', lat: String(latitude), lon: String(longitude), zoom: '14', addressdetails: '1' });
    const result = await requestNominatim(`https://nominatim.openstreetmap.org/reverse?${query}`);
    const placeName = formatPlace(result.address, result.display_name) || `Near ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
    await PlaceCache.findOneAndUpdate({ cacheKey }, {
      $set: {
        location: { type: 'Point', coordinates: [longitude, latitude] },
        placeName,
        address: result.address || {},
        expiresAt: new Date(Date.now() + CACHE_MS)
      }
    }, { upsert: true, new: true, runValidators: true });
    return { placeName, address: result.address || {}, cached: false };
  } catch (error) {
    console.warn(`[Location] Reverse geocoding unavailable: ${error.message}`);
    return null;
  }
}

module.exports = { resolve, formatPlace };
