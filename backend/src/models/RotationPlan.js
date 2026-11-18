const mongoose = require('mongoose');

const rotationPlanSchema = new mongoose.Schema({
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
  plan: [{
    step: Number,
    crop: String,
    season: String,
    reason: String,
    expectedBenefits: [String]
  }],
  inputContext: {
    previousCrop: String,
    currentCrop: String,
    soilType: String,
    location: Object
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('RotationPlan', rotationPlanSchema);
