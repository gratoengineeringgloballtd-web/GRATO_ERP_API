// patchCashRequest.js
const mongoose = require('mongoose');
const { getCashRequestApprovalChain } = require('../config/cashRequestApprovalChain');
const CashRequest = require('../models/CashRequest'); // Adjust path if needed

require('dotenv').config();
const MONGO_URI = process.env.MONGODB_URI; // <-- Set your DB name
const REQUEST_ID = '69986ae005d8a85270619b0b'; // <-- Set your request _id
const EMPLOYEE_EMAIL = 'joseph.tayou@gratoglobal.com'; // <-- Set employee email
const REQUEST_TYPE = 'travel'; // <-- Set request type
const PURPOSE = `• Start of work: 22/02/2026
• End of work: 23/02/2026
• 2 people
• Request for a mission for myself and a support technician, for the swap of the PWC as well as the installation of battery at the Souza site.
This operation is part of the energy extension and the provision of services for the new operator CAMTEL.`; // <-- Set your purpose

async function patchRequest() {
  await mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });

  // Get new approval chain
  const approvalChain = getCashRequestApprovalChain(EMPLOYEE_EMAIL, REQUEST_TYPE);

  // Patch the request
  const updated = await CashRequest.findByIdAndUpdate(
    REQUEST_ID,
    {
      approvalChain,
      purpose: PURPOSE
    },
    { new: true }
  );

  if (updated) {
    console.log('Request patched successfully:', updated);
  } else {
    console.log('Request not found or patch failed.');
  }

  await mongoose.disconnect();
}

patchRequest().catch(console.error);