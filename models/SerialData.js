const mongoose = require('mongoose');
const serialDataSchema = new mongoose.Schema({
  rawData: String,
  timestamp: { type: Date, default: Date.now }
});
module.exports = mongoose.model('SerialData', serialDataSchema);
