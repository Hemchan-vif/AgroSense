const mongoose = require('mongoose');

const soilProfileCacheSchema = new mongoose.Schema({
  cacheKey: { type: String, required: true, unique: true, index: true },
  location: {
    type: { type: String, enum: ['Point'], required: true },
    coordinates: { type: [Number], required: true }
  },
  data: { type: mongoose.Schema.Types.Mixed, required: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } }
}, { timestamps: true });

soilProfileCacheSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('SoilProfileCache', soilProfileCacheSchema);
