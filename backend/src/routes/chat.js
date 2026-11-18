const express = require('express');
const advisory = require('../services/advisoryService');
const Farm = require('../models/Farm');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Recommendation = require('../models/Recommendation');
const RotationPlan = require('../models/RotationPlan');
const soilProfileService = require('../services/soilProfileService');
const locationService = require('../services/locationService');

const router = express.Router();
const requestCounts = new Map();
router.use((req, res, next) => {
  const key = req.get('x-telegram-init-data') || req.get('x-demo-user') || req.ip;
  const now = Date.now();
  const item = requestCounts.get(key);
  if (item && now - item.start < 60_000 && item.count >= 30) return res.status(429).json({ success: false, message: 'Too many requests. Please wait a moment and try again.' });
  if (!item || now - item.start >= 60_000) requestCounts.set(key, { start: now, count: 1 });
  else item.count += 1;
  if (requestCounts.size > 5000) for (const [user, value] of requestCounts) if (now - value.start >= 60_000) requestCounts.delete(user);
  next();
});
router.use(async (req, res, next) => {
  try {
    const user = await advisory.identify(req);
    if (!user) return res.status(401).json({ success: false, message: 'Valid Telegram Mini App data is required. Use demo mode only during development.' });
    req.user = user;
    next();
  } catch (error) { next(error); }
});

router.post('/', async (req, res, next) => {
  try {
    const { message, conversationId } = req.body || {};
    if (typeof message !== 'string' || !message.trim() || message.length > 2000) return res.status(400).json({ success: false, message: 'Message must contain 1 to 2,000 characters.' });
    const result = await advisory.processMessage(req.user, message.trim(), conversationId);
    res.json({ success: true, data: result });
  } catch (error) { next(error); }
});

router.get('/history', async (req, res, next) => {
  try { res.json({ success: true, data: await advisory.history(req.user, req.query.conversationId) }); }
  catch (error) { next(error); }
});

router.post('/new', async (req, res, next) => {
  try {
    await Conversation.updateMany({ userId: req.user._id, status: 'active' }, { $set: { status: 'archived' } });
    const conversation = await Conversation.create({ userId: req.user._id, title: 'New Conversation' });
    res.json({ success: true, data: { conversationId: conversation._id.toString(), messages: [] } });
  } catch (error) { next(error); }
});

router.get('/farm', async (req, res, next) => {
  try { res.json({ success: true, data: await Farm.findOne({ userId: req.user._id }).lean() }); }
  catch (error) { next(error); }
});

router.put('/farm', async (req, res, next) => {
  try {
    const body = req.body || {};
    if (body.soilType && !advisory.SOILS.includes(body.soilType)) return res.status(400).json({ success: false, message: 'Select a supported soil type.' });
    const hasFarmSize = body.farmSize?.value !== undefined && body.farmSize?.value !== null && body.farmSize?.value !== '';
    if (hasFarmSize && (!Number.isFinite(Number(body.farmSize.value)) || Number(body.farmSize.value) <= 0)) return res.status(400).json({ success: false, message: 'Farm size must be a positive number when provided.' });
    if (body.soilParameters) for (const [key, value] of Object.entries(body.soilParameters)) if (value !== '' && (!Number.isFinite(Number(value)) || Number(value) < 0)) return res.status(400).json({ success: false, message: `Invalid soil measurement: ${key}.` });
    const farm = await advisory.saveFarm(req.user, body);
    res.json({ success: true, data: farm });
  } catch (error) { next(error); }
});

router.get('/weather', async (req, res, next) => {
  try {
    const hasLatitude = req.query.latitude !== undefined;
    const hasLongitude = req.query.longitude !== undefined;
    if (hasLatitude !== hasLongitude) return res.status(400).json({ success: false, message: 'Provide both latitude and longitude.' });
    let coordinates = null;
    if (hasLatitude && hasLongitude) {
      const latitude = Number(req.query.latitude);
      const longitude = Number(req.query.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
        return res.status(400).json({ success: false, message: 'Location coordinates are invalid.' });
      }
      coordinates = [longitude, latitude];
    }
    const farm = await Farm.findOne({ userId: req.user._id });
    res.json({ success: true, data: await advisory.weatherFor(farm, coordinates) });
  } catch (error) { next(error); }
});

router.get('/location-name', async (req, res, next) => {
  try {
    const latitude = Number(req.query.latitude);
    const longitude = Number(req.query.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      return res.status(400).json({ success: false, message: 'Location coordinates are invalid.' });
    }
    res.json({ success: true, data: await locationService.resolve(latitude, longitude) });
  } catch (error) { next(error); }
});

router.get('/soil-profile', async (req, res, next) => {
  try {
    const farm = await Farm.findOne({ userId: req.user._id });
    res.json({ success: true, data: await soilProfileService.getProfile(farm) });
  } catch (error) { next(error); }
});

router.get('/recommendations', async (req, res, next) => {
  try {
    const items = await Recommendation.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(10).lean();
    res.json({ success: true, data: items });
  } catch (error) { next(error); }
});

router.get('/rotation-plans', async (req, res, next) => {
  try {
    const items = await RotationPlan.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(10).lean();
    res.json({ success: true, data: items });
  } catch (error) { next(error); }
});

router.get('/conversations', async (req, res, next) => {
  try {
    const items = await Conversation.find({ userId: req.user._id }).sort({ updatedAt: -1 }).limit(20).select('title intent status updatedAt').lean();
    res.json({ success: true, data: items });
  } catch (error) { next(error); }
});

router.post('/conversations/:id/activate', async (req, res, next) => {
  try {
    if (!require('mongoose').Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, message: 'Conversation not found.' });
    const selected = await Conversation.findOne({ _id: req.params.id, userId: req.user._id });
    if (!selected) return res.status(404).json({ success: false, message: 'Conversation not found.' });
    await Conversation.updateMany({ userId: req.user._id, status: 'active', _id: { $ne: selected._id } }, { $set: { status: 'archived' } });
    selected.status = 'active';
    await selected.save();
    res.json({ success: true, data: { conversationId: selected._id.toString() } });
  } catch (error) { next(error); }
});

module.exports = router;
