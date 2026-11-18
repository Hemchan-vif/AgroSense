const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/agrosense';
    console.log('[Database] Connecting to configured MongoDB…');
    
    const conn = await mongoose.connect(mongoURI, {
      // Mongoose 6+ has these true by default, but left here for explicit clarity
    });

    console.log(`[Database] MongoDB Connected: ${conn.connection.host}`);
    
    // Connection error events
    mongoose.connection.on('error', err => {
      console.error(`[Database] MongoDB connection error: ${err}`);
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('[Database] MongoDB disconnected');
    });

  } catch (error) {
    console.error(`[Database] Error connecting to MongoDB: ${error.message}`);
    process.exitCode = 1;
    throw error;
  }
};

// Graceful shutdown
process.on('SIGINT', async () => {
  await mongoose.connection.close();
  console.log('[Database] MongoDB connection closed due to app termination');
  process.exit(0);
});

module.exports = connectDB;
