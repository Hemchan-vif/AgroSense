const mongoose = require('mongoose');

const userPreferenceSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  theme: {
    type: String,
    enum: ['light', 'dark', 'system'],
    default: 'system'
  },
  notifications: {
    weatherAlerts: { type: Boolean, default: true },
    farmingReminders: { type: Boolean, default: true },
    recommendationUpdates: { type: Boolean, default: true }
  },
  dataPreferences: {
    shareDataForAnalytics: { type: Boolean, default: false }
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('UserPreference', userPreferenceSchema);
