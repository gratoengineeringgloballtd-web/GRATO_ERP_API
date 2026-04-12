// fetchCashRequestDetails.js
const mongoose = require('mongoose');
const CashRequest = require('../models/CashRequest');
require('dotenv').config();

const MONGO_URI = process.env.MONGODB_URI; // Ensure your .env has MONGODB_URI
const REQUEST_DISPLAY_ID = 'REQ-AA52BD'; // The display ID

async function fetchRequestDetails() {
  await mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });

  // Find by displayId (virtual), so we need to find by _id ending with AA52BD
  // If you know the actual _id, use findById. Otherwise, search for displayId.
  const allRequests = await CashRequest.find({});
  const request = allRequests.find(r => r.displayId === REQUEST_DISPLAY_ID);

  if (!request) {
    console.log('Request not found for displayId:', REQUEST_DISPLAY_ID);
  } else {
    console.log('Request details:', request);
  }

  await mongoose.disconnect();
}

fetchRequestDetails().catch(console.error);
