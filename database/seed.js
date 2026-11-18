require('dotenv').config({ path: '../.env' });
const mongoose = require('mongoose');

// Models
const User = require('../backend/src/models/User');
const Farm = require('../backend/src/models/Farm');
const Conversation = require('../backend/src/models/Conversation');
const Message = require('../backend/src/models/Message');

const seedDatabase = async () => {
  try {
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/agrosense';
    console.log(`Connecting to MongoDB at ${mongoURI}...`);
    await mongoose.connect(mongoURI);
    
    console.log('Clearing existing data...');
    await User.deleteMany({});
    await Farm.deleteMany({});
    await Conversation.deleteMany({});
    await Message.deleteMany({});
    
    console.log('Inserting Demo User...');
    const user = await User.create({
      name: 'Demo Farmer',
      telegramId: 'demo_user_123',
      language: 'en'
    });
    
    console.log('Inserting Demo Farm...');
    const farm = await Farm.create({
      userId: user._id,
      name: 'Demo Farm (Tiruchirappalli)',
      location: {
        type: 'Point',
        coordinates: [78.7047, 10.7905] // [longitude, latitude]
      },
      locationText: 'Tiruchirappalli, Tamil Nadu, India',
      farmSize: { value: 5, unit: 'acres' },
      soilType: 'Red Soil',
      soilParameters: { ph: 6.5, nitrogen: 90, phosphorus: 42, potassium: 43 },
      irrigation: 'Tube Well',
      currentCrop: 'Rice',
      previousCrop: 'Pulses',
      season: 'Kharif'
    });
    
    console.log('Inserting Demo Conversation...');
    const conversation = await Conversation.create({
      userId: user._id,
      title: 'Crop Recommendation Query',
      intent: 'crop_recommendation',
      farmContext: {
        farmId: farm._id,
        location: farm.location,
        missingData: []
      }
    });

    console.log('Inserting Demo Messages...');
    await Message.create([
      {
        conversationId: conversation._id,
        userId: user._id,
        role: 'system',
        content: 'System initialized.'
      },
      {
        conversationId: conversation._id,
        userId: user._id,
        role: 'user',
        content: 'What should I plant after Rice?'
      },
      {
        conversationId: conversation._id,
        userId: user._id,
        role: 'ai',
        content: 'Based on your Red Soil in Tiruchirappalli and previous crop (Rice), I recommend planting Groundnut or Pulses to restore nitrogen levels.'
      }
    ]);
    
    console.log('Database Seeding Completed Successfully! 🌱');
    process.exit(0);
  } catch (error) {
    console.error('Error seeding database:', error);
    process.exit(1);
  }
};

seedDatabase();
