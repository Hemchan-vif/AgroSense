const crypto = require('crypto');
const Farm = require('../models/Farm');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Recommendation = require('../models/Recommendation');
const RotationPlan = require('../models/RotationPlan');
const WeatherCache = require('../models/WeatherCache');
const llmService = require('./llmService');
const trainedCropService = require('./trainedCropService');
const soilProfileService = require('./soilProfileService');
const locationService = require('./locationService');

const SOILS = ['Clay', 'Clay loam', 'Loam', 'Sandy', 'Sandy loam', 'Silt', 'Red soil', 'Black soil', 'Alluvial'];
const CROP_RULES = [
  { crop: 'Millet', soils: ['Sandy', 'Sandy loam', 'Red soil', 'Loam'], seasons: ['Kharif', 'Year-round'], water: 'Low', family: 'cereal', ph: [5, 8.5], rain: [250, 800] },
  { crop: 'Groundnut', soils: ['Sandy', 'Sandy loam', 'Red soil', 'Loam'], seasons: ['Kharif', 'Rabi'], water: 'Moderate', family: 'legume', ph: [5.5, 7.5], rain: [500, 1000] },
  { crop: 'Chickpea', soils: ['Loam', 'Clay loam', 'Black soil', 'Sandy loam'], seasons: ['Rabi'], water: 'Low', family: 'legume', ph: [6, 8], rain: [300, 600] },
  { crop: 'Pigeon pea', soils: ['Loam', 'Red soil', 'Sandy loam', 'Black soil'], seasons: ['Kharif'], water: 'Low', family: 'legume', ph: [5, 7.5], rain: [600, 1000] },
  { crop: 'Maize', soils: ['Loam', 'Clay loam', 'Alluvial', 'Red soil'], seasons: ['Kharif', 'Rabi'], water: 'Moderate', family: 'cereal', ph: [5.5, 7.5], rain: [500, 800] },
  { crop: 'Sorghum', soils: ['Black soil', 'Loam', 'Red soil', 'Clay loam'], seasons: ['Kharif', 'Rabi'], water: 'Low', family: 'cereal', ph: [5.5, 8], rain: [400, 800] },
  { crop: 'Rice', soils: ['Clay', 'Clay loam', 'Alluvial', 'Loam'], seasons: ['Kharif', 'Rabi'], water: 'High', family: 'cereal', ph: [5, 7], rain: [1000, 2500] },
  { crop: 'Green gram', soils: ['Sandy loam', 'Loam', 'Red soil', 'Alluvial'], seasons: ['Kharif', 'Rabi', 'Zaid'], water: 'Low', family: 'legume', ph: [6, 7.5], rain: [350, 700] },
  { crop: 'Cotton', soils: ['Black soil', 'Clay loam', 'Loam'], seasons: ['Kharif'], water: 'Moderate', family: 'fiber', ph: [5.5, 8], rain: [500, 1200] },
  { crop: 'Mustard', soils: ['Loam', 'Sandy loam', 'Alluvial'], seasons: ['Rabi'], water: 'Low', family: 'oilseed', ph: [6, 8], rain: [300, 600] }
];

function scoreCrops(farm = {}) {
  const previousCrop = farm.previousCrop || farm.currentCrop;
  return CROP_RULES.map(rule => {
    let score = 45;
    const reasons = [];
    if (farm.soilType) {
      if (rule.soils.some(s => s.toLowerCase() === farm.soilType.toLowerCase())) { score += 25; reasons.push(`Compatible with ${farm.soilType} soil`); }
      else { score -= 12; reasons.push(`Soil compatibility is less certain for ${farm.soilType} soil`); }
    }
    if (farm.season && farm.season !== 'Unknown') {
      if (rule.seasons.includes(farm.season)) { score += 12; reasons.push(`Suitable for ${farm.season} season`); }
      else score -= 12;
    }
    if (farm.soilParameters?.ph != null) {
      if (farm.soilParameters.ph >= rule.ph[0] && farm.soilParameters.ph <= rule.ph[1]) { score += 10; reasons.push('Measured soil pH is within a suitable range'); }
      else score -= 10;
    }
    if (previousCrop && previousCrop.toLowerCase() !== 'unknown' && previousCrop.toLowerCase() !== 'not recorded') {
      const previous = CROP_RULES.find(c => c.crop.toLowerCase() === previousCrop.toLowerCase());
      if (previous && previous.family !== rule.family) { score += 8; reasons.push('Different crop family supports rotation diversity'); }
      if (previous && previous.family === rule.family) score -= 10;
    }
    score = Math.max(25, Math.min(96, score));
    return { crop: rule.crop, score, suitability: score >= 75 ? 'High' : score >= 60 ? 'Good' : 'Moderate', reason: reasons.length ? reasons.join('; ') + '.' : 'General crop profile only; add soil and seasonal details for a more specific assessment.', waterRequirement: rule.water, season: rule.seasons.join(' / '), family: rule.family };
  }).sort((a, b) => b.score - a.score).slice(0, 3);
}

function inferIntent(text) {
  const t = text.toLowerCase();
  if (/weather|rain|temperature|forecast|wind|humidity/.test(t)) return 'weather';
  if (/rotation|after (rice|paddy|crop)|next crop/.test(t)) return 'crop_rotation';
  if (/recommend|which crop|what crop|what should i (grow|plant)|what to (grow|plant)|suitable crop|best crop/.test(t)) return 'crop_recommendation';
  if (/soil|ph|fertili[sz]|nutrient|nitrogen/.test(t)) return 'soil_advice';
  if (/farm|profile|location|acre|hectare/.test(t)) return 'farm_profile';
  if (/how (do i |to )?(grow|plant|sow|harvest)|when (should i )?(plant|sow|harvest)|planting|cultivat|crop information|tell me about (rice|paddy|maize|corn|groundnut|cotton|millet|chickpea|mustard)/.test(t)) return 'crop_information';
  if (/help|what can you/.test(t)) return 'help';
  return 'general_agriculture';
}

function missingFor(intent, farm) {
  const missing = [];
  if (intent === 'weather' && !farm?.location?.coordinates?.length) missing.push('farm location');
  if (intent === 'crop_recommendation' && !farm?.soilType) missing.push('soil type');
  if (intent === 'crop_recommendation' && !farm?.previousCrop && !farm?.currentCrop) missing.push('previous crop');
  if (intent === 'crop_rotation' && !farm?.previousCrop && !farm?.currentCrop) missing.push('previous crop');
  return missing;
}

function nextSlot(missing) {
  if (missing[0] === 'soil type') return 'soilType';
  if (missing[0] === 'previous crop') return 'previousCrop';
  if (missing[0] === 'farm location') return 'farmLocation';
  return null;
}

function followUpQuestion(slot) {
  if (slot === 'soilType') return 'What type of soil do you have? You can reply with clay, loam, sandy, red soil, black soil, or another listed type.';
  if (slot === 'previousCrop') return 'What crop did you grow previously? You can reply with a crop name, or “skip” if you do not know.';
  if (slot === 'farmLocation') return 'Please share your farm location using Telegram’s location button, or set coordinates in the Farm screen so I can look up local weather.';
  return 'What farm detail can you share?';
}

function parseSoil(text) {
  const normalized = text.trim().toLowerCase()
    .replace(/[.!?]+$/, '')
    .replace(/^(my|the)?\s*soil( type)?\s*(is|:)?\s*/i, '')
    .replace(/^(it is|we have|i have|it's)\s*/i, '')
    .replace(/\s+/g, ' ').trim();
  return SOILS.find(soil => soil.toLowerCase() === normalized) || null;
}

function normalizeCrop(text) {
  const value = text.trim().replace(/^(the previous crop was|previously|we grew|i grew|it was|crop was|i planted)\s+/i, '').replace(/\s+(last season|last year|previous season|before|this year)$/i, '').replace(/[.!?]+$/, '').trim();
  if (/^(skip|none|unknown|don't know|not sure)$/i.test(value)) return null;
  const aliases = { paddy: 'Rice', rice: 'Rice', pulses: 'Green gram', 'green gram': 'Green gram', moong: 'Green gram', maize: 'Maize', corn: 'Maize', groundnut: 'Groundnut', peanut: 'Groundnut', millet: 'Millet', chickpea: 'Chickpea', gram: 'Chickpea', cotton: 'Cotton', mustard: 'Mustard', sorghum: 'Sorghum', jowar: 'Sorghum', 'pigeon pea': 'Pigeon pea', tur: 'Pigeon pea', arhar: 'Pigeon pea' };
  return aliases[value.toLowerCase()] || (value.length <= 60 ? value : null);
}

async function getConversation(user, id) {
  if (id) {
    const existing = await Conversation.findOne({ _id: id, userId: user._id, status: 'active' });
    if (existing) return existing;
  }
  let conversation = await Conversation.findOne({ userId: user._id, status: 'active' }).sort({ updatedAt: -1 });
  if (!conversation) conversation = await Conversation.create({ userId: user._id, title: 'New Conversation' });
  return conversation;
}

async function persist(user, conversation, text, response, metadata = {}) {
  await Message.create([
    { conversationId: conversation._id, userId: user._id, role: 'user', content: text },
    { conversationId: conversation._id, userId: user._id, role: 'ai', content: response, metadata }
  ]);
  if (conversation.title === 'New Conversation') conversation.title = text.slice(0, 48);
  conversation.updatedAt = new Date();
  await conversation.save();
}

async function weatherFor(farm, requestedCoordinates = null) {
  const [longitude, latitude] = requestedCoordinates || farm?.location?.coordinates || [];
  if (longitude == null || latitude == null) return { unavailable: true, message: 'Set your farm location to request local weather.' };
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(longitude) > 180 || Math.abs(latitude) > 90) return { unavailable: true, message: 'The saved location is invalid. Update it in Farm settings.' };
  const now = new Date();
  const locationQuery = { 'location.coordinates.0': longitude, 'location.coordinates.1': latitude };
  const withPlaceName = async data => {
    if (data.locationName && !data.locationName.startsWith('Near ')) return data;
    const place = await locationService.resolve(latitude, longitude);
    return { ...data, locationName: place?.placeName || `Near ${latitude.toFixed(4)}, ${longitude.toFixed(4)}` };
  };
  const cache = await WeatherCache.findOne({ ...locationQuery, expiresAt: { $gt: now } }).sort({ createdAt: -1 });
  if (cache?.data?.fetchedAt && now.getTime() - new Date(cache.data.fetchedAt).getTime() < 10 * 60 * 1000) {
    const cachedData = cache.data.toObject ? cache.data.toObject() : cache.data;
    return { ...await withPlaceName(cachedData), cached: true, locationSource: requestedCoordinates ? 'device' : 'farm' };
  }
  const staleCache = await WeatherCache.findOne(locationQuery).sort({ createdAt: -1 });
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,rain,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover&daily=precipitation_probability_max,temperature_2m_max,temperature_2m_min&forecast_days=3&timezone=auto`;
    const [result, place] = await Promise.all([
      fetch(url, { signal: AbortSignal.timeout(8000) }),
      locationService.resolve(latitude, longitude)
    ]);
    if (!result.ok) throw new Error('Weather provider unavailable');
    const payload = await result.json();
    const current = payload.current;
    const data = {
      source: 'Open-Meteo',
      modelBased: true,
      providerTime: current.time,
      fetchedAt: new Date().toISOString(),
      timezone: payload.timezone,
      locationName: place?.placeName || `Near ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
      temperature: current.temperature_2m,
      feelsLike: current.apparent_temperature,
      humidity: current.relative_humidity_2m,
      precipitation: current.precipitation,
      rainfall: current.precipitation,
      rain: current.rain,
      wind: current.wind_speed_10m,
      windDirection: current.wind_direction_10m,
      windGusts: current.wind_gusts_10m,
      cloudCover: current.cloud_cover,
      condition: weatherLabel(current.weather_code),
      coordinates: [longitude, latitude],
      forecast: payload.daily.time.map((date, i) => ({ date, rainChance: payload.daily.precipitation_probability_max[i], high: payload.daily.temperature_2m_max[i], low: payload.daily.temperature_2m_min[i] }))
    };
    await WeatherCache.create({ location: { type: 'Point', coordinates: [longitude, latitude] }, data, expiresAt: new Date(Date.now() + 10 * 60 * 1000) });
    return { ...data, cached: false, locationSource: requestedCoordinates ? 'device' : 'farm' };
  } catch (error) {
    if (staleCache?.data) {
      const cachedData = staleCache.data.toObject ? staleCache.data.toObject() : staleCache.data;
      return { ...await withPlaceName(cachedData), stale: true, locationSource: requestedCoordinates ? 'device' : 'farm' };
    }
    return { unavailable: true, message: 'Live weather is temporarily unavailable. Please try again later.' };
  }
}

function weatherLabel(code) {
  if (code === 0) return 'Clear'; if ([1, 2].includes(code)) return 'Partly cloudy'; if (code === 3) return 'Overcast'; if ([45, 48].includes(code)) return 'Fog'; if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return 'Rain'; if ([95, 96, 99].includes(code)) return 'Thunderstorm'; return 'Variable conditions';
}

async function generate(user, conversation, text, forcedIntent = null) {
  const farm = await Farm.findOne({ userId: user._id });
  const intent = forcedIntent || inferIntent(text);
  conversation.intent = intent;
  const missing = missingFor(intent, farm);
  const metadata = {};
  let answer;
  if (missing.length) {
    const slot = nextSlot(missing);
    conversation.pendingIntent = intent;
    conversation.pendingSlot = slot;
    answer = followUpQuestion(slot);
    metadata.followUpSlot = slot;
    if (slot === 'farmLocation') metadata.requestLocation = true;
  } else if (intent === 'crop_recommendation') {
    const currentWeather = process.env.CROP_MODEL_ENABLED === 'true' && farm?.location?.coordinates?.length
      ? await weatherFor(farm)
      : null;
    const modelResult = await trainedCropService.recommend(farm, currentWeather);
    const recommendations = modelResult?.recommendations || scoreCrops(farm);
    const recommendationSource = modelResult ? 'ml_model' : 'rule_engine';
    metadata.type = 'crop_list'; metadata.recommendations = recommendations; metadata.recommendationSource = recommendationSource;
    if (modelResult) {
      metadata.modelMissingInputs = modelResult.missingInputs || [];
      metadata.modelLimitation = modelResult.limitation;
      metadata.modelWeatherContext = modelResult.weatherContext || null;
    }
    await Recommendation.create({
      userId: user._id,
      farmId: farm._id,
      inputContext: {
        soil: { type: farm.soilType, ...farm.soilParameters },
        season: farm.season,
        previousCrop: farm.previousCrop || farm.currentCrop,
        ...(modelResult?.weatherContext ? { weather: modelResult.weatherContext } : {}),
        ...(modelResult ? { modelMissingInputs: modelResult.missingInputs || [], modelLimitation: modelResult.limitation } : {})
      },
      recommendations,
      source: recommendationSource
    });
    if (modelResult) {
      const missingText = modelResult.missingInputs?.length
        ? ` Missing inputs were filled with training-set medians/modes: ${modelResult.missingInputs.join(', ')}.`
        : '';
      const weatherNote = modelResult.weatherContext
        ? ` Current Open-Meteo conditions near ${modelResult.weatherContext.locationName || 'your farm'} (${modelResult.weatherContext.temperature}°C, ${modelResult.weatherContext.humidity}% humidity, provider time ${modelResult.weatherContext.providerTime} ${modelResult.weatherContext.timezone || ''}) were included; this snapshot is not a seasonal climate normal.`
        : ' Current location weather was unavailable, so temperature and humidity were imputed from training data.';
      answer = `These are the top crops from AgroSense's experimental trained model. The displayed votes are relative model rankings, not calibrated suitability probabilities; the dataset has not been validated against field outcomes.${missingText}${weatherNote} The model does not use previous-crop history, seasonal climate forecasts, or water requirements. Please confirm choices with local agricultural guidance.`;
    } else {
      answer = `Here are three options based on the farm details you have saved${farm.soilParameters?.ph == null ? '. Soil pH and nutrient measurements were not provided, so those are not assumed' : ', including the measured soil pH'}${farm.previousCrop || farm.currentCrop ? `; crop history considered: ${farm.previousCrop || farm.currentCrop}` : '; crop history was not available'}. Suitability scores are comparative guidance, not yield predictions.`;
    }
  } else if (intent === 'crop_rotation') {
    const prior = farm.previousCrop || farm.currentCrop;
    const priorRule = CROP_RULES.find(c => c.crop.toLowerCase() === prior.toLowerCase());
    const candidates = CROP_RULES.filter(c => !priorRule || c.family !== priorRule.family).filter(c => !farm.soilType || c.soils.some(s => s.toLowerCase() === farm.soilType.toLowerCase())).slice(0, 3);
    const options = candidates.length ? candidates : CROP_RULES.filter(c => c.family !== priorRule?.family).slice(0, 3);
    const plan = [{ step: 1, crop: prior, season: farm.season || 'Next season', reason: 'Previously recorded crop', expectedBenefits: [] }, ...options.slice(0, 2).map((c, i) => ({ step: i + 2, crop: c.crop, season: c.seasons[0], reason: `Different crop family (${c.family}) from ${prior}; check local sowing window and water availability.`, expectedBenefits: c.family === 'legume' ? ['Legume crops can contribute biologically fixed nitrogen'] : ['Adds crop diversity to the rotation'] }))];
    metadata.type = 'rotation_plan'; metadata.plan = plan;
    await RotationPlan.create({ userId: user._id, farmId: farm._id, plan, inputContext: { previousCrop: farm.previousCrop, currentCrop: farm.currentCrop, soilType: farm.soilType, location: farm.location } });
    answer = `A practical next step after ${prior} is a different crop family. The sequence below is a planning suggestion; confirm local season, seed availability, and water before planting.`;
  } else if (intent === 'weather') {
    const weather = await weatherFor(farm); metadata.type = 'weather_card'; Object.assign(metadata, weather);
    answer = weather.unavailable ? weather.message : `Latest Open-Meteo weather-model conditions near ${weather.locationName || 'your selected area'} (${weather.locationSource === 'device' ? 'current device location' : 'saved farm location'}; provider time ${weather.providerTime} ${weather.timezone || ''}): ${weather.temperature}°C, ${weather.condition.toLowerCase()}, humidity ${weather.humidity}%, current precipitation ${weather.precipitation} mm and wind ${weather.wind} km/h. Forecast rain probabilities are predictions. Check local conditions before irrigation or spraying.`;
  } else if (intent === 'soil_advice') {
    const profile = farm?.location ? await soilProfileService.getProfile(farm) : null;
    if (profile && !profile.unavailable) {
      metadata.type = 'soil_profile'; metadata.soilProfile = profile;
      const estimates = profile.properties.map(property => {
        const depth = property.depths.find(item => item.depth === '5-15cm' && item.estimate !== null) || property.depths.find(item => item.estimate !== null);
        return depth ? `${property.label}: ${depth.estimate} ${property.unit} (${depth.depth}, ${depth.statistic})` : null;
      }).filter(Boolean);
      answer = `${farm?.soilType ? `Your saved soil type is ${farm.soilType}. ` : ''}${farm?.soilParameters?.ph != null ? `Your recorded pH is ${farm.soilParameters.ph}. ` : 'No laboratory pH or N-P-K measurements are saved. '}SoilGrids provides modeled estimates for the mapped area, not field measurements${estimates.length ? `: ${estimates.join('; ')}` : ''}. These estimates are useful for regional context; use a local laboratory test before applying lime or fertilizer. For water management, match irrigation frequency to crop stage and soil drainage.`;
    } else {
      answer = farm?.soilType ? `Your saved soil type is ${farm.soilType}. ${farm.soilParameters?.ph != null ? `Your recorded pH is ${farm.soilParameters.ph}.` : 'No laboratory pH or N-P-K measurements are saved, so I cannot assess nutrient levels.'} ${profile?.message || ''} Use a local soil test before applying lime or fertilizer. For water management, match irrigation frequency to crop stage and soil drainage; share soil test values for more targeted guidance.` : `I do not have your soil type or lab measurements yet. ${profile?.message || 'Share your soil type, and use a laboratory soil test for pH and nutrient advice.'}`;
    }
  } else if (intent === 'farm_profile') {
    answer = farm ? `Farm profile: ${farm.locationText || (farm.location ? 'Location saved' : 'Location not set')}; ${farm.farmSize?.value ? `${farm.farmSize.value} ${farm.farmSize.unit || 'acres'}` : 'farm size not recorded'}; soil ${farm.soilType || 'not recorded'}; previous crop ${farm.previousCrop || 'not recorded'}; current crop ${farm.currentCrop || 'not recorded'}.` : 'Your farm profile is not set up yet. Open the Farm tab to add your location, area, soil type, and crop history.';
  } else if (intent === 'help') {
    answer = 'Ask me naturally about crop options, rotation, local weather, soil, or your farm profile. Advice becomes more specific when your location, soil type, and crop history are saved.';
  } else {
    const generatedAnswer = await llmService.answerOpenQuestion(user, conversation, farm, text);
    if (generatedAnswer) answer = generatedAnswer;
    else if (process.env.AI_API_KEY?.trim()) answer = 'The AI answer service is temporarily unavailable. Please try your question again shortly. You can still ask about crop recommendations, rotation, soil, or weather.';
    else answer = farm ? `I can help with crop choice, crop rotation, weather, or soil guidance. Your saved farm details include ${farm.soilType || 'no soil type yet'}${farm.locationText ? ` near ${farm.locationText}` : ''}. Add an AI API key to enable open-ended agricultural answers.` : 'I can help with crop choice, crop rotation, weather, or soil guidance. Set up your farm details for personalized advice. Add an AI API key to enable open-ended agricultural answers.';
  }
  if (!missing.length) { conversation.pendingIntent = null; conversation.pendingSlot = null; }
  conversation.farmContext = { farmId: farm?._id, location: farm?.location, missingData: missing };
  await conversation.save();
  await persist(user, conversation, text, answer, metadata);
  return { text: answer, metadata, conversationId: conversation._id.toString(), farm };
}

async function processMessage(user, text, conversationId) {
  const conversation = await getConversation(user, conversationId);
  if (conversation.pendingIntent && conversation.pendingSlot) {
    const farm = await Farm.findOne({ userId: user._id }) || new Farm({ userId: user._id });
    if (conversation.pendingSlot === 'soilType') {
      const soil = parseSoil(text);
      if (!soil) {
        const answer = `I couldn't match “${text.slice(0, 60)}” to a soil type. Please reply with one of: ${SOILS.join(', ')}.`;
        await persist(user, conversation, text, answer);
        return { text: answer, metadata: {}, conversationId: conversation._id.toString() };
      }
      farm.soilType = soil;
    } else if (conversation.pendingSlot === 'previousCrop') {
      const crop = normalizeCrop(text);
      if (crop) farm.previousCrop = crop;
      else if (/^(skip|none|unknown|don't know|not sure)$/i.test(text.trim())) farm.previousCrop = 'Unknown';
      else {
        const answer = 'Please send the previous crop name, or reply “skip” if you do not know it.';
        await persist(user, conversation, text, answer);
        return { text: answer, metadata: {}, conversationId: conversation._id.toString() };
      }
    } else if (conversation.pendingSlot === 'farmLocation') {
      const answer = followUpQuestion('farmLocation');
      await persist(user, conversation, text, answer, { requestLocation: true });
      return { text: answer, metadata: { requestLocation: true }, conversationId: conversation._id.toString() };
    }
    await farm.save();
    const intent = conversation.pendingIntent;
    conversation.pendingIntent = null;
    conversation.pendingSlot = null;
    await conversation.save();
    return generate(user, conversation, text, intent);
  }
  return generate(user, conversation, text);
}

async function processLocation(user, location) {
  await saveFarm(user, { location });
  const conversation = await getConversation(user);
  if (conversation.pendingIntent === 'weather') {
    const intent = conversation.pendingIntent;
    conversation.pendingIntent = null;
    conversation.pendingSlot = null;
    await conversation.save();
    return generate(user, conversation, 'Farm location shared', intent);
  }
  return { text: `Farm location saved (${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}). I’ll use it for local weather lookups.`, metadata: {}, conversationId: conversation._id.toString() };
}

async function history(user, conversationId) {
  let conversation;
  if (conversationId) conversation = await Conversation.findOne({ _id: conversationId, userId: user._id });
  else conversation = await Conversation.findOne({ userId: user._id, status: 'active' }).sort({ updatedAt: -1 });
  if (!conversation) return { conversationId: null, messages: [] };
  const messages = await Message.find({ userId: user._id, conversationId: conversation._id }).sort({ createdAt: 1 }).limit(200).lean();
  return { conversationId: conversation._id.toString(), messages };
}

async function saveFarm(user, updates) {
  let farm = await Farm.findOne({ userId: user._id });
  if (!farm) farm = new Farm({ userId: user._id });
  const allowed = ['name', 'locationText', 'farmSize', 'soilType', 'soilParameters', 'irrigation', 'currentCrop', 'previousCrop', 'season'];
  for (const key of allowed) if (updates[key] !== undefined) farm[key] = updates[key];
  if (updates.location) {
    const { latitude, longitude } = updates.location;
    if (Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) farm.location = { type: 'Point', coordinates: [longitude, latitude] };
  }
  await farm.save();
  return farm;
}

function validateTelegramInitData(initData, token) {
  if (!initData || !token) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash'); if (!hash) return null;
  params.delete('hash');
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const expected = crypto.createHmac('sha256', secret).update(check).digest('hex');
  const a = Buffer.from(hash, 'hex'), b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const authDate = Number(params.get('auth_date'));
  if (!authDate || Date.now() / 1000 - authDate > 86400) return null;
  try { return JSON.parse(params.get('user') || '{}'); } catch { return null; }
}

function demoEnabled() { return process.env.NODE_ENV !== 'production' && process.env.DEMO_MODE === 'true'; }

async function identify(req) {
  const telegramUser = validateTelegramInitData(req.get('x-telegram-init-data'), process.env.TELEGRAM_BOT_TOKEN);
  if (telegramUser?.id) {
    const User = require('../models/User');
    return User.findOneAndUpdate({ telegramId: String(telegramUser.id) }, { $set: { name: [telegramUser.first_name, telegramUser.last_name].filter(Boolean).join(' '), lastActive: new Date() }, $setOnInsert: { language: telegramUser.language_code === 'ta' ? 'ta' : 'en' } }, { upsert: true, new: true, runValidators: true });
  }
  const demoId = req.get('x-demo-user');
  if (demoEnabled() && demoId && /^[a-zA-Z0-9_-]{1,64}$/.test(demoId)) {
    const User = require('../models/User');
    return User.findOneAndUpdate({ telegramId: `demo:${demoId}` }, { $setOnInsert: { name: 'Demo Farmer', language: 'en' } }, { upsert: true, new: true });
  }
  return null;
}

module.exports = { processMessage, processLocation, history, saveFarm, identify, scoreCrops, inferIntent, SOILS, weatherFor, demoEnabled };
