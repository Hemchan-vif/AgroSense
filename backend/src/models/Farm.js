const mongoose = require('mongoose');

const pointSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['Point'],
    required: true,
    default: 'Point'
  },
  coordinates: {
    type: [Number], // [longitude, latitude]
    required: true,
    validate: { validator: value => value.length === 2 && value.every(Number.isFinite) && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90, message: 'Coordinates must be [longitude, latitude].' }
  }
}, { _id: false });

const farmSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  name: {
    type: String,
    trim: true,
    default: 'My Farm'
  },
  location: {
    type: pointSchema,
    required: false,
    index: '2dsphere'
  },
  locationText: {
    type: String,
    trim: true
  },
  farmSize: {
    value: Number,
    unit: {
      type: String,
      enum: ['acres', 'hectares', 'sq_meters']
    }
  },
  soilType: {
    type: String,
    trim: true
  },
  soilParameters: {
    ph: Number,
    nitrogen: Number,
    phosphorus: Number,
    potassium: Number
  },
  irrigation: {
    type: String,
    enum: ['Rainfed', 'Drip', 'Sprinkler', 'Canal', 'Tube Well', 'Other', 'Unknown'],
    default: 'Unknown'
  },
  currentCrop: {
    type: String,
    trim: true
  },
  previousCrop: {
    type: String,
    trim: true
  },
  season: {
    type: String,
    enum: ['Kharif', 'Rabi', 'Zaid', 'Year-round', 'Unknown'],
    default: 'Unknown'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Farm', farmSchema);
