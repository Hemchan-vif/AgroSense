const Message = require('../models/Message');

const SYSTEM_INSTRUCTION = [
  'You are AgroSense, a practical agricultural information assistant for farmers.',
  'Give concise, plain-language answers and ask one focused follow-up question when needed.',
  'Use the supplied farm profile and conversation history only as user-provided facts.',
  'Never invent weather, soil measurements, crop yields, diagnoses, or local regulations.',
  'For crop suitability, recommend using the deterministic AgroSense recommendation tool instead of guessing.',
  'For serious pest damage, pesticide use, or uncertain disease identification, advise consulting a local agricultural extension officer and following product labels.'
].join(' ');

function collectText(value) {
  if (typeof value === 'string') return value;
  if (!value) return '';
  if (Array.isArray(value)) return value.map(collectText).filter(Boolean).join('\n');
  if (typeof value === 'object') {
    if (value.type === 'text' && typeof value.text === 'string') return value.text;
    return Object.entries(value).filter(([key]) => ['output', 'steps', 'content', 'parts'].includes(key)).map(([, child]) => collectText(child)).filter(Boolean).join('\n');
  }
  return '';
}

async function answerOpenQuestion(user, conversation, farm, message) {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) return null;
  try {
    const recent = await Message.find({ userId: user._id, conversationId: conversation._id })
      .sort({ createdAt: -1 }).limit(10).select('role content').lean();
    const history = recent.reverse().map(item => `${item.role === 'user' ? 'Farmer' : 'AgroSense'}: ${item.content}`).join('\n');
    const farmContext = farm ? {
      location: farm.locationText || (farm.location ? 'coordinates saved' : null),
      soilType: farm.soilType || null,
      soilMeasurements: farm.soilParameters || null,
      previousCrop: farm.previousCrop || null,
      currentCrop: farm.currentCrop || null,
      season: farm.season || null,
      irrigation: farm.irrigation || null
    } : 'No farm profile saved';
    const input = `Farm profile (user supplied): ${JSON.stringify(farmContext)}\nRecent conversation:\n${history || '(no prior messages)'}\nFarmer's latest question: ${message}`;
    // Prefer a stable, routine-query Flash model; try remaining stable fallbacks
    // in sequence when Google reports temporary overload or rate limiting.
    const models = [...new Set([
      process.env.AI_MODEL || 'gemini-3.6-flash',
      process.env.AI_FALLBACK_MODEL || 'gemini-3.5-flash',
      process.env.AI_LAST_FALLBACK_MODEL || 'gemini-3.5-flash-lite'
    ])];
    const requestModel = model => fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ model, input, system_instruction: SYSTEM_INSTRUCTION, store: false, generation_config: { thinking_level: 'low', max_output_tokens: 500 } }),
      signal: AbortSignal.timeout(20000)
    });
    for (const model of models) {
      // One short retry handles transient network/service hiccups before moving
      // on to a different stable model. Avoid retrying auth/configuration errors.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        let response;
        try {
          response = await requestModel(model);
        } catch (requestError) {
          if (attempt === 0) {
            await new Promise(resolve => setTimeout(resolve, 700));
            continue;
          }
          console.warn(`[AI] ${model} request failed (${requestError.name || 'network error'}).`);
          break;
        }
        if (!response.ok) {
          if ([429, 500, 502, 503, 504].includes(response.status) && attempt === 0) {
            await new Promise(resolve => setTimeout(resolve, 700));
            continue;
          }
          if ([429, 500, 502, 503, 504].includes(response.status)) {
            console.warn(`[AI] ${model} returned HTTP ${response.status}; trying next configured model.`);
            break;
          }
          console.warn(`[AI] Gemini request returned HTTP ${response.status}.`);
          return null;
        }
        const payload = await response.json();
        const text = (payload.output_text || collectText(payload.steps || payload.output)).trim();
        if (text) return text.slice(0, 4000);
        console.warn(`[AI] ${model} returned an empty response; trying next configured model.`);
        break;
      }
    }
    return null;
  } catch (error) {
    console.warn('[AI] Gemini is unavailable; using the local advisory fallback.');
    return null;
  }
}

module.exports = { answerOpenQuestion };
