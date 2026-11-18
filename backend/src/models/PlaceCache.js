const mongoose = require('mongoose');

const placeCacheSchema = new mongoose.Schema({
  cacheKey: { type: String, required: true, unique: true },
  location: {
    type: { type: String, enum: ['Point'], required: true },
    coordinates: { type: [Number], required: true }
  },
  placeName: { type: String, required: true },
  address: { type: mongoose.Schema.Types.Mixed },
  expiresAt: { type: Date, required: true, index: { expires: 0 } }
}, { timestamps: true });

placeCacheSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('PlaceCache', placeCacheSchema);
