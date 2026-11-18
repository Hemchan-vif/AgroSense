const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  title: {
    type: String,
    default: 'New Conversation'
  },
  intent: {
    type: String,
    enum: [
      'crop_recommendation', 'crop_rotation', 'weather', 'soil_advice', 
      'farming_advice', 'crop_information', 'seasonal_advice', 'location_update', 
      'farm_profile', 'general_agriculture', 'help', 'unknown', 'idle'
    ],
    default: 'idle'
  },
  pendingIntent: {
    type: String,
    enum: ['crop_recommendation', 'crop_rotation', 'weather', 'soil_advice', null],
    default: null
  },
  pendingSlot: {
    type: String,
    enum: ['soilType', 'previousCrop', 'farmLocation', null],
    default: null
  },
  farmContext: {
    // Snapshot of the context the conversation is operating with
    farmId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Farm'
    },
    location: Object,
    weather: Object,
    missingData: [String]
  },
  status: {
    type: String,
    enum: ['active', 'archived'],
    default: 'active'
  }
}, {
  timestamps: true
});

conversationSchema.index({ updatedAt: -1 });

module.exports = mongoose.model('Conversation', conversationSchema);
