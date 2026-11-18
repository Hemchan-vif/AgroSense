const mongoose = require('mongoose');

const weatherCacheSchema = new mongoose.Schema({
  location: {
    type: {
      type: String,
      enum: ['Point'],
      required: true
    },
    coordinates: {
      type: [Number],
      required: true
    }
  },
  data: {
    source: String,
    modelBased: Boolean,
    providerTime: String,
    fetchedAt: String,
    timezone: String,
    locationName: String,
    temperature: Number,
    feelsLike: Number,
    humidity: Number,
    rainChance: Number,
    precipitation: Number,
    rainfall: Number,
    rain: Number,
    wind: Number,
    windDirection: Number,
    windGusts: Number,
    cloudCover: Number,
    condition: String,
    coordinates: [Number],
    forecast: mongoose.Schema.Types.Mixed
  },
  expiresAt: {
    type: Date,
    required: true,
    // TTL index: MongoDB will automatically delete documents where expiresAt is older than current time
    index: { expires: 0 }
  }
}, {
  timestamps: true
});

// 2dsphere index for querying weather by location proximity
weatherCacheSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('WeatherCache', weatherCacheSchema);
