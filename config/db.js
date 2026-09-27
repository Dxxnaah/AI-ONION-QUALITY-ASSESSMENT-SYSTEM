const mongoose = require('mongoose');

async function connectDB() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/agriqueue';
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 2000 });
    console.log(`[db] Connected to MongoDB: ${uri}`);
  } catch (err) {
    console.warn(`[db] MongoDB connection unavailable (${err.message}).`);
    console.warn('[db] Server running in standalone demo mode. All web pages, UI, and OTP endpoints remain fully functional.');
  }
}

module.exports = connectDB;
