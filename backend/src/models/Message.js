const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  role: {
    type: String,
    enum: ['user', 'ai', 'system'],
    required: true
  },
  content: {
    type: String,
    required: true
  },
  messageType: {
    type: String,
    enum: ['text', 'card', 'location', 'error'],
    default: 'text'
  },
  metadata: {
    // Used for rich UI cards like weather stats, crop suitability scores, etc.
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true // createdAt is used for sorting messages
});

// To query messages in order for a specific conversation
messageSchema.index({ conversationId: 1, createdAt: 1 });

module.exports = mongoose.model('Message', messageSchema);
