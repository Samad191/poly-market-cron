import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
dotenv.config();

const uri = process.env.MONGO_URI; // your MongoDB connection string
if (!uri) throw new Error('MONGO_URI is not set in environment variables');

const client = new MongoClient(uri);
let db;

export async function connectDB() {
  if (!db) {
    await client.connect();
    db = client.db('polymarket'); // database name
    console.log('✅ Connected to MongoDB');
  }
  return db;
}

export async function saveOrder(orderData) {
  const database = await connectDB();
  const collection = database.collection('orders');
  const result = await collection.insertOne(orderData);
  return result;
}

// Load marketIds that have a successful BUY recorded
export async function loadPurchasedMarketIds() {
  const database = await connectDB();
  const collection = database.collection('orders');
  const docs = await collection
    .find({ side: 'BUY', status: 'success' })
    .project({ marketId: 1, _id: 0 })
    .toArray();
  return docs.map(d => d.marketId).filter(Boolean);
}

// ---- Bot state persistence ----
// Schema example in 'bot_state' collection:
// { token_id: string, completedLevels: number, trailingActive: boolean, localHigh: number, updatedAt: Date }

export async function upsertBotState(tokenId, partialState) {
  const database = await connectDB();
  const collection = database.collection('bot_state');
  const updateDoc = {
    $set: {
      token_id: tokenId,
      ...partialState,
      updatedAt: new Date(),
    },
  };
  await collection.updateOne({ token_id: tokenId }, updateDoc, { upsert: true });
}

export async function loadAllBotStates() {
  const database = await connectDB();
  const collection = database.collection('bot_state');
  const docs = await collection.find({}).toArray();
  return docs;
}
