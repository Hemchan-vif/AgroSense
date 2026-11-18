const mongoose = require('mongoose');

const recommendationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  farmId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Farm',
    required: true,
    index: true
  },
  inputContext: {
    location: Object,
    soil: Object,
    weather: Object,
    season: String,
    previousCrop: String,
    modelMissingInputs: [String],
    modelLimitation: String
  },
  recommendations: [{
    crop: String,
    score: Number,
    suitability: String,
    reason: String,
    waterRequirement: String,
    season: String
  }],
  source: {
    type: String,
    enum: ['ml_model', 'demo_engine', 'rule_engine'],
    default: 'demo_engine'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Recommendation', recommendationSchema);
