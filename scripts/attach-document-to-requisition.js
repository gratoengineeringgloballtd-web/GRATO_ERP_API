/**
 * attach-document-to-requisition.js
 *
 * One-off utility to attach a document to a purchase requisition that's
 * already been created, using the PUT /purchase-requisitions/:id endpoint
 * (multipart 'attachments' field). Uses the same route your requisition
 * edit form uses — no direct DB access, no server restart needed.
 *
 * Run this ON THE MACHINE THAT CAN REACH YOUR API (usually your own PC,
 * pointed at your GRATO ERP server, whether that's localhost or a
 * deployed URL).
 *
 * ─── SETUP ────────────────────────────────────────────────────────────
 * 1. npm install axios form-data   (run this once, in any folder)
 * 2. Fill in the CONFIG block below.
 * 3. node attach-document-to-requisition.js
 *
 * ─── HOW TO GET YOUR TOKEN ────────────────────────────────────────────
 * 1. Log into the GRATO ERP web app in your browser.
 * 2. Open DevTools (F12) → Application tab → Local Storage → your site.
 * 3. Copy the value of the "token" key.
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

// ─── CONFIG — edit these four values ───────────────────────────────────
const CONFIG = {
  // Base URL of your running API, no trailing slash, including /api if
  // that's how your server is set up (check your frontend's .env /
  // REACT_APP_API_URL for the exact value).
  API_BASE_URL: 'http://localhost:5001/api',

  // Paste your auth token here (see "HOW TO GET YOUR TOKEN" above).
  TOKEN: 'PASTE_YOUR_TOKEN_HERE',

  // The requisition to attach the document to.
  // (REQ202609296786)
  REQUISITION_ID: '6abc00ea3debc7eecc8cb0a4',

  // Full path to the file on THIS machine.
  FILE_PATH: 'C:\\Users\\user\\Downloads\\LIST_-_September_2026.xlsx'
};
// ────────────────────────────────────────────────────────────────────

async function attachDocument() {
  const { API_BASE_URL, TOKEN, REQUISITION_ID, FILE_PATH } = CONFIG;

  if (!TOKEN || TOKEN === 'PASTE_YOUR_TOKEN_HERE') {
    console.error('❌ Please paste your auth token into CONFIG.TOKEN before running this script.');
    process.exit(1);
  }

  if (!fs.existsSync(FILE_PATH)) {
    console.error(`❌ File not found: ${FILE_PATH}`);
    console.error('   Update CONFIG.FILE_PATH to the correct location on this machine.');
    process.exit(1);
  }

  console.log('📎 Attaching document to requisition...');
  console.log('   Requisition ID:', REQUISITION_ID);
  console.log('   File:', FILE_PATH);
  console.log('   API:', API_BASE_URL);

  const form = new FormData();
  form.append('attachments', fs.createReadStream(FILE_PATH), path.basename(FILE_PATH));

  try {
    const response = await axios.put(
      `${API_BASE_URL}/purchase-requisitions/${REQUISITION_ID}`,
      form,
      {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${TOKEN}`
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      }
    );

    const data = response.data;

    if (!data.success) {
      console.error('❌ Server rejected the request:', data.message);
      process.exit(1);
    }

    if (data.attachments) {
      const { uploaded, total, failed } = data.attachments;
      if (uploaded > 0) {
        console.log(`✅ Uploaded ${uploaded}/${total} file(s) successfully.`);
      }
      if (failed && failed.length > 0) {
        console.error('❌ Some files failed to upload:');
        failed.forEach(f => console.error(`   - ${f.name}: ${f.error}`));
        process.exit(1);
      }
    } else {
      console.log('✅ Request succeeded:', data.message);
    }

    console.log('\nRequisition now has', data.data?.attachments?.length ?? '?', 'attachment(s).');
  } catch (error) {
    if (error.response) {
      console.error(`❌ Request failed (HTTP ${error.response.status}):`, error.response.data?.message || error.response.data);
    } else {
      console.error('❌ Request failed:', error.message);
    }
    process.exit(1);
  }
}

attachDocument();
