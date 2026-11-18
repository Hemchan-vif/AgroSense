const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: false,
    trim: true
  },
  telegramId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  language: {
    type: String,
    enum: ['en', 'ta'], // English, Tamil
    default: 'en'
  },
  lastActive: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('User', userSchema);
