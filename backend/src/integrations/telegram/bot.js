const TelegramBot = require('node-telegram-bot-api');
const conversationEngine = require('../../services/advisoryService');
const tunnelService = require('../../services/tunnelService');
const User = require('../../models/User');
const Farm = require('../../models/Farm');

let bot = null;
const setupSteps = new Map();
const menu = { inline_keyboard: [
  [{ text: '🌱 Crop Recommendation', callback_data: 'crop:recommend' }, { text: '🔄 Crop Rotation', callback_data: 'rotation:plan' }],
  [{ text: '🌦 Weather Advisory', callback_data: 'weather:check' }, { text: '🧪 Soil Advisory', callback_data: 'soil:advice' }],
  [{ text: '🚜 My Farm', callback_data: 'farm:view' }, { text: '👤 My Profile', callback_data: 'profile:view' }]
] };

const initTelegramBot = () => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token === 'your_telegram_bot_token_here') { console.warn('[Telegram] Bot token not configured.'); return; }
  const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
  bot = webhookUrl && !webhookUrl.includes('your-domain.com') ? new TelegramBot(token) : new TelegramBot(token, { polling: true });
  if (webhookUrl && !webhookUrl.includes('your-domain.com')) {
    const webhookOptions = process.env.TELEGRAM_WEBHOOK_SECRET ? { secret_token: process.env.TELEGRAM_WEBHOOK_SECRET } : {};
    bot.setWebHook(`${webhookUrl.replace(/\/$/, '')}/api/telegram/webhook`, webhookOptions)
      .then(() => console.log('[Telegram] Webhook registered.'))
      .catch(error => console.error('[Telegram] Webhook registration failed:', error.message));
  }
  bot.on('polling_error', error => console.error('[Telegram] Polling error:', error.message));
  bot.on('webhook_error', error => console.error('[Telegram] Webhook error:', error.message));
  configureMiniApp();

  bot.onText(/^\/start(?:\s|$)/, async msg => {
    try {
      const user = await registerUser(msg.from);
      if (msg.text?.trim() === '/skip') {
        const step = setupSteps.get(String(msg.from.id));
        if (step === 'name') { setupSteps.set(String(msg.from.id), 'location'); return bot.sendMessage(msg.chat.id, 'No problem. Share your farm location whenever you are ready.', { reply_markup: { keyboard: [[{ text: '📍 Share farm location', request_location: true }]], resize_keyboard: true, one_time_keyboard: true } }); }
        if (step === 'size') { setupSteps.delete(String(msg.from.id)); return bot.sendMessage(msg.chat.id, 'Farm setup saved. Add your size later from the Mini App or ask me about your farm.', { reply_markup: { remove_keyboard: true } }); }
      }
      const farm = await Farm.findOne({ userId: user._id });
      const text = `🌱 *Welcome to AgroSense, ${escapeMarkdown(user.name || 'Farmer')}!*\n\nAsk me naturally about crops, rotation, soil, or weather. I’ll use the farm information you save and ask when a key detail is missing.${farm ? `\n\nFarm profile found${farm.soilType ? ` · ${farm.soilType} soil` : ''}${farm.locationText ? ` · ${farm.locationText}` : ''}.` : '\n\nLet’s set up your farm so recommendations can be tailored to you.'}`;
      const currentUrl = process.env.TELEGRAM_MINI_APP_URL || process.env.FRONTEND_URL;
      const startKeyboard = { inline_keyboard: [] };
      if (currentUrl?.startsWith('https://')) startKeyboard.inline_keyboard.push([{ text: '📱 Open AgroSense', web_app: { url: currentUrl } }]);
      startKeyboard.inline_keyboard.push([{ text: '🚜 Set Up My Farm', callback_data: 'farm:setup' }]);
      startKeyboard.inline_keyboard.push(...menu.inline_keyboard);
      await bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown', reply_markup: startKeyboard });
    } catch (error) { console.error('[Telegram] Start error:', error.message); await bot.sendMessage(msg.chat.id, 'AgroSense is temporarily unable to load your profile. Please try again shortly.'); }
  });
  bot.onText(/^\/help(?:\s|$)/, msg => bot.sendMessage(msg.chat.id, 'Ask a question in your own words, or use the shortcuts below. I can help with crop recommendations, rotation, weather, soil, and your farm profile. Set your location and soil type for personalized guidance.', { reply_markup: menu }));
  bot.onText(/^\/profile(?:\s|$)/, async msg => sendResult(msg.chat.id, await profileResponse(await registerUser(msg.from))));
  bot.onText(/^\/farm(?:\s|$)/, async msg => sendResult(msg.chat.id, await farmResponse(await registerUser(msg.from))));
  bot.onText(/^\/weather(?:\s|$)/, async msg => sendResult(msg.chat.id, await conversationEngine.processMessage(await registerUser(msg.from), 'weather')));
  bot.onText(/^\/crop(?:\s|$)/, async msg => sendResult(msg.chat.id, await conversationEngine.processMessage(await registerUser(msg.from), 'recommend a crop')));
  bot.onText(/^\/rotation(?:\s|$)/, async msg => sendResult(msg.chat.id, await conversationEngine.processMessage(await registerUser(msg.from), 'crop rotation')));

  bot.on('message', async msg => {
    if (msg.text?.startsWith('/') && msg.text.trim() !== '/skip') return;
    try {
      const user = await registerUser(msg.from);
      if (msg.location) {
        const response = await conversationEngine.processLocation(user, msg.location);
        if (setupSteps.get(String(msg.from.id)) === 'location') {
          setupSteps.set(String(msg.from.id), 'soil');
          return bot.sendMessage(msg.chat.id, `${response.text}\n\nWhat soil type do you have?`, { reply_markup: soilKeyboard() });
        }
        return sendResult(msg.chat.id, response);
      }
      if (!msg.text) return;
      const step = setupSteps.get(String(msg.from.id));
      if (msg.text.trim() === '/skip') {
        if (step === 'name') { setupSteps.set(String(msg.from.id), 'location'); return bot.sendMessage(msg.chat.id, 'No problem. Share a farm location or enter its place name.'); }
        if (step === 'location') { setupSteps.set(String(msg.from.id), 'soil'); return bot.sendMessage(msg.chat.id, 'You can set a precise location later. What soil type do you have?', { reply_markup: soilKeyboard() }); }
        if (step === 'size') { setupSteps.delete(String(msg.from.id)); return bot.sendMessage(msg.chat.id, 'Farm size skipped. You can add it later from the Farm screen.', { reply_markup: { remove_keyboard: true } }); }
      }
      if (step === 'name') {
        user.name = msg.text.trim().slice(0, 80); await user.save(); setupSteps.set(String(msg.from.id), 'location');
        return bot.sendMessage(msg.chat.id, `Thanks, ${escapeMarkdown(user.name)}. Share your farm location using the button.`, { reply_markup: { keyboard: [[{ text: '📍 Share farm location', request_location: true }]], resize_keyboard: true, one_time_keyboard: true } });
      }
      if (step === 'location') {
        await conversationEngine.saveFarm(user, { locationText: msg.text.trim().slice(0, 120) });
        setupSteps.set(String(msg.from.id), 'soil');
        return bot.sendMessage(msg.chat.id, 'Location noted by place name. Share a precise location when possible so I can retrieve local weather. What soil type do you have?', { reply_markup: soilKeyboard() });
      }
      if (step === 'soil') {
        const soil = conversationEngine.SOILS.find(item => item.toLowerCase() === msg.text.trim().toLowerCase());
        if (!soil) return bot.sendMessage(msg.chat.id, 'Please choose one of the soil buttons below.', { reply_markup: soilKeyboard() });
        await conversationEngine.saveFarm(user, { soilType: soil }); setupSteps.set(String(msg.from.id), 'size');
        return bot.sendMessage(msg.chat.id, 'Soil type saved. How large is your farm? Enter acres or hectares, or /skip.');
      }
      if (step === 'size') {
        const match = msg.text.match(/^\s*(\d+(?:\.\d+)?)\s*(acres?|hectares?)?\s*$/i);
        if (!match) return bot.sendMessage(msg.chat.id, 'Please enter a farm size such as 2 acres, or /skip.');
        const unit = (match[2] || 'acres').toLowerCase().startsWith('hect') ? 'hectares' : 'acres';
        await conversationEngine.saveFarm(user, { farmSize: { value: Number(match[1]), unit } }); setupSteps.delete(String(msg.from.id));
        return bot.sendMessage(msg.chat.id, 'Farm setup complete. Ask me about crops, rotation, weather, or soil.', { reply_markup: { remove_keyboard: true } });
      }
      const result = await conversationEngine.processMessage(user, msg.text);
      if (result.metadata?.requestLocation) return bot.sendMessage(msg.chat.id, result.text, { reply_markup: { keyboard: [[{ text: '📍 Share farm location', request_location: true }]], resize_keyboard: true, one_time_keyboard: true } });
      await sendResult(msg.chat.id, result);
    } catch (error) { console.error('[Telegram] Message error:', error.message); bot.sendMessage(msg.chat.id, 'I could not process that just now. Please try again.').catch(() => {}); }
  });

  bot.on('callback_query', async query => {
    try {
      const user = await registerUser(query.from);
      await bot.answerCallbackQuery(query.id);
      if (query.data === 'farm:setup') {
        setupSteps.set(String(query.from.id), 'name');
        return bot.sendMessage(query.message.chat.id, 'What name should I use for you? (or send /skip)', { reply_markup: menu });
      }
      if (query.data === 'soil:advice') return sendResult(query.message.chat.id, await conversationEngine.processMessage(user, 'soil advice'));
      if (query.data.startsWith('soil:')) {
        const soil = query.data.slice(5);
        if (!conversationEngine.SOILS.includes(soil)) return;
        const conversation = await require('../../models/Conversation').findOne({ userId: user._id, status: 'active' }).sort({ updatedAt: -1 });
        if (conversation?.pendingSlot === 'soilType') return sendResult(query.message.chat.id, await conversationEngine.processMessage(user, soil, conversation._id.toString()));
        await conversationEngine.saveFarm(user, { soilType: soil });
        setupSteps.set(String(query.from.id), 'size');
        return bot.sendMessage(query.message.chat.id, `${soil} soil saved. How large is your farm? Enter a number of acres or hectares, or /skip.`);
      }
      if (query.data.startsWith('crop:answer:')) {
        const answer = query.data.slice('crop:answer:'.length);
        return sendResult(query.message.chat.id, await conversationEngine.processMessage(user, answer));
      }
      if (query.data === 'profile:view') return sendResult(query.message.chat.id, await profileResponse(user));
      if (query.data === 'farm:view') return sendResult(query.message.chat.id, await farmResponse(user));
      const prompts = { 'crop:recommend': 'recommend a crop', 'rotation:plan': 'crop rotation', 'weather:check': 'weather' };
      if (prompts[query.data]) return sendResult(query.message.chat.id, await conversationEngine.processMessage(user, prompts[query.data]));
    } catch (error) { console.error('[Telegram] Callback error:', error.message); }
  });
};

function soilKeyboard() { return { inline_keyboard: [['Clay', 'Clay loam', 'Loam'], ['Sandy', 'Sandy loam', 'Silt'], ['Red soil', 'Black soil', 'Alluvial']].map(row => row.map(s => ({ text: s, callback_data: `soil:${s}` }))) }; }
function escapeMarkdown(text = '') { return text.replace(/[_*`\[\]]/g, '\\$&'); }
async function registerUser(tgUser) {
  const existing = await User.findOne({ telegramId: String(tgUser.id) });
  const name = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ');
  if (existing) { if (!setupSteps.has(String(tgUser.id)) && name) existing.name = name; existing.lastActive = new Date(); return existing.save(); }
  return User.create({ telegramId: String(tgUser.id), name, language: tgUser.language_code === 'ta' ? 'ta' : 'en' });
}
async function sendResult(chatId, result) {
  const extra = { parse_mode: 'Markdown', reply_markup: menu };
  if (result.metadata?.requestLocation) extra.reply_markup = { keyboard: [[{ text: '📍 Share farm location', request_location: true }]], resize_keyboard: true, one_time_keyboard: true };
  if (result.metadata?.followUpSlot === 'soilType') extra.reply_markup = soilKeyboard();
  if (result.metadata?.followUpSlot === 'previousCrop') extra.reply_markup = { inline_keyboard: [[{ text: 'Rice', callback_data: 'crop:answer:Rice' }, { text: 'Maize', callback_data: 'crop:answer:Maize' }], [{ text: 'Groundnut', callback_data: 'crop:answer:Groundnut' }, { text: 'Skip', callback_data: 'crop:answer:skip' }]] };
  if (result.metadata?.recommendations) result.text += '\n\n' + result.metadata.recommendations.map((item, i) => `${i + 1}. *${escapeMarkdown(item.crop)}* — ${item.suitability} (${item.score}%)\n   ${escapeMarkdown(item.reason)}`).join('\n\n');
  if (result.metadata?.plan) result.text += '\n\n' + result.metadata.plan.map(item => `${item.step}. *${escapeMarkdown(item.crop)}* (${item.season})\n   ${escapeMarkdown(item.reason)}`).join('\n');
  if (result.metadata?.type === 'weather_card' && !result.metadata.unavailable) result.text += `\n\n📍 ${escapeMarkdown(result.metadata.locationName || 'Farm area')} · Open-Meteo model conditions (${escapeMarkdown(result.metadata.providerTime)} ${escapeMarkdown(result.metadata.timezone || '')})\n${result.metadata.temperature}°C · ${escapeMarkdown(result.metadata.condition)}\nHumidity ${result.metadata.humidity}% · Current precipitation ${result.metadata.precipitation} mm · Wind ${result.metadata.wind} km/h\nThis is weather-model data, not a local sensor observation. Weather data: Open-Meteo (CC BY 4.0).`;
  return bot.sendMessage(chatId, result.text, extra);
}
async function farmResponse(user) {
  const farm = await Farm.findOne({ userId: user._id });
  if (!farm) return { text: 'Your farm profile is not set up yet. Share your location to get started.', metadata: { requestLocation: true } };
  return { text: `🚜 *${escapeMarkdown(farm.name || 'My Farm')}*\nLocation: ${escapeMarkdown(farm.locationText || (farm.location ? farm.location.coordinates.join(', ') : 'Not set'))}\nSize: ${farm.farmSize?.value ? `${farm.farmSize.value} ${farm.farmSize.unit}` : 'Not recorded'}\nSoil: ${escapeMarkdown(farm.soilType || 'Not recorded')}\nPrevious crop: ${escapeMarkdown(farm.previousCrop || 'Not recorded')}\nCurrent crop: ${escapeMarkdown(farm.currentCrop || 'Not recorded')}`, metadata: {} };
}
async function profileResponse(user) { return { text: `👤 *${escapeMarkdown(user.name || 'Farmer')}*\nLanguage: ${user.language === 'ta' ? 'Tamil' : 'English'}\n\nUse /farm to view saved farm details.`, metadata: {} }; }
async function configureMiniApp() {
  const url = process.env.TELEGRAM_MINI_APP_URL || process.env.FRONTEND_URL;
  if (!url?.startsWith('https://')) return;
  try { await bot.setChatMenuButton({ menu_button: { type: 'web_app', text: '🌱 AgroSense App', web_app: { url } } }); }
  catch (error) { console.warn('[Telegram] Could not set Mini App menu:', error.message); }
}
const updateMiniAppUrl = async newUrl => { if (!bot || !newUrl) return; process.env.TELEGRAM_MINI_APP_URL = newUrl; await configureMiniApp(); };
const handleWebhook = (req, res) => {
  if (!bot) return res.sendStatus(503);
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && req.get('x-telegram-bot-api-secret-token') !== secret) return res.sendStatus(401);
  bot.processUpdate(req.body); res.sendStatus(200);
};
module.exports = { initTelegramBot, handleWebhook, updateMiniAppUrl };
