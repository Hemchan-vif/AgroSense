const serviceUrl = (process.env.AI_SERVICE_URL || 'http://localhost:8000').replace(/\/$/, '');

function measuredValue(value) {
  return Number.isFinite(Number(value)) && value !== '' && value !== null && value !== undefined
    ? Number(value)
    : null;
}

function farmInputs(farm = {}, weather = null) {
  const irrigation = farm.irrigation;
  const waterSource = irrigation === 'Rainfed'
    ? 'rainfed'
    : ['Drip', 'Sprinkler', 'Canal', 'Tube Well'].includes(irrigation) ? 'irrigated' : null;
  const season = farm.season && farm.season !== 'Unknown' ? farm.season : null;
  return {
    soilType: farm.soilType || null,
    season,
    waterSource,
    ph: measuredValue(farm.soilParameters?.ph),
    N: measuredValue(farm.soilParameters?.nitrogen),
    P: measuredValue(farm.soilParameters?.phosphorus),
    K: measuredValue(farm.soilParameters?.potassium),
    temperature: weather && !weather.unavailable && !weather.stale ? measuredValue(weather.temperature) : null,
    humidity: weather && !weather.unavailable && !weather.stale ? measuredValue(weather.humidity) : null
  };
}

async function recommend(farm, weather = null) {
  if (process.env.CROP_MODEL_ENABLED !== 'true') return null;
  try {
    const response = await fetch(`${serviceUrl}/predict/crop/trained`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(farmInputs(farm, weather)),
      signal: AbortSignal.timeout(4000)
    });
    if (!response.ok) {
      console.warn(`[CropModel] Service returned HTTP ${response.status}; using the rule recommender.`);
      return null;
    }
    const payload = await response.json();
    if (payload?.success && Array.isArray(payload.data?.recommendations) && payload.data.recommendations.length) {
      const weatherContext = weather && !weather.unavailable && !weather.stale ? {
        source: 'Open-Meteo current weather-model snapshot',
        locationName: weather.locationName || null,
        providerTime: weather.providerTime,
        timezone: weather.timezone,
        temperature: weather.temperature,
        humidity: weather.humidity,
        precipitation: weather.precipitation,
        cached: Boolean(weather.cached),
        stale: Boolean(weather.stale)
      } : null;
      return { ...payload.data, weatherContext };
    }
  } catch (error) {
    console.warn(`[CropModel] Service unavailable (${error.name || 'request error'}); using the rule recommender.`);
  }
  return null;
}

module.exports = { recommend };
