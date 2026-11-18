const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const dotenv = require('dotenv');

// Environment setup - Load environment variables reliably from root .env
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config();

const connectDB = require('./config/database');
const telegramBot = require('./integrations/telegram/bot');
const tunnelService = require('./services/tunnelService');

const app = express();

// Middleware - allow Telegram WebApp iframe embedding
app.use(helmet({
  contentSecurityPolicy: false,
  frameguard: false,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: false
}));
app.use(cors({ origin: (origin, callback) => {
  if (!origin || process.env.NODE_ENV !== 'production' || origin === process.env.FRONTEND_URL) return callback(null, true);
  return callback(new Error('Origin not allowed'));
} }));
app.use(express.json());

// Database connection is established before accepting API traffic.

// Serve built frontend static files for Telegram Mini App
const frontendDistPath = path.join(__dirname, '../../frontend/dist/frontend/browser');
app.use(express.static(frontendDistPath));

// Basic Health Route
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    service: 'AgroSense API',
    version: '1.0.0'
  });
});

app.get('/api/miniapp/auth', async (req, res, next) => {
  try {
    const advisory = require('./services/advisoryService');
    const user = await advisory.identify(req);
    if (!user) return res.status(401).json({ success: false, message: 'Telegram authentication failed.' });
    const farm = await require('./models/Farm').findOne({ userId: user._id }).lean();
    res.json({ success: true, data: { user: { name: user.name, language: user.language }, farm } });
  } catch (error) { next(error); }
});

// Import Routes
const chatRoutes = require('./routes/chat');
app.use('/api/chat', chatRoutes);

// Telegram Webhook
app.post('/api/telegram/webhook', telegramBot.handleWebhook);

// Initialize Telegram Bot
telegramBot.initTelegramBot();

// SPA fallback for frontend client routing (excluding API)
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }
  res.sendFile(path.join(frontendDistPath, 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    success: false,
    data: null,
    message: err.status && err.status < 500 ? err.message : 'Internal Server Error',
    error: {
      code: 'SERVER_ERROR'
    }
  });
});

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  connectDB().then(() => {
    app.listen(PORT, () => {
      console.log(`[Backend] Server running on port ${PORT}`);
      tunnelService.startTunnel({ port: PORT, onUrlReady: telegramBot.updateMiniAppUrl });
    });
  }).catch(error => {
    console.error('[Backend] Startup stopped because MongoDB is unavailable:', error.message);
    process.exit(1);
  });
}

module.exports = app;
