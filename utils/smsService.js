/**
 * signatureResolver.js
 *
 * Updated for Cloudinary.
 * - If signature.url is a Cloudinary URL → return it directly
 * - Otherwise → fall back to disk search (legacy / transition period)
 *
 * Place at: utils/signatureResolver.js
 */

const fs   = require('fs');
const path = require('path');

// Legacy disk search dirs (used only for files not yet migrated to Cloudinary)
const SIGNATURE_SEARCH_DIRS = [
  process.env.SIGNATURE_PATH,
  '/var/data/user-signatures',
  '/var/data/signatures',
  path.resolve(__dirname, '../uploads/user-signatures'),
  path.resolve(__dirname, '../public/signatures'),
  path.resolve(__dirname, '../uploads/signatures'),
].filter(Boolean);

const isCloudinaryUrl = (str = '') =>
  str.startsWith('https://res.cloudinary.com') ||
  str.startsWith('http://res.cloudinary.com');

/**
 * resolveSignaturePath
 *
 * Returns either:
 *   { type: 'cloudinary', url: '...' }   — use res.redirect() or proxy
 *   { type: 'local', filePath: '...' }   — use doc.image(filePath)
 *   null                                  — not found
 *
 * For PDFService (which calls doc.image()), check type first:
 *
 *   const resolved = resolveSignaturePath(user.signature);
 *   if (resolved?.type === 'cloudinary') {
 *     // download to temp buffer, then doc.image(buffer)
 *   } else if (resolved?.type === 'local') {
 *     doc.image(resolved.filePath, ...)
 *   }
 */
const resolveSignaturePath = (signatureData) => {
  if (!signatureData) return null;

  const storedUrl = typeof signatureData === 'string'
    ? signatureData
    : (signatureData.url || signatureData.localPath || signatureData.filename || null);

  if (!storedUrl) return null;

  // ── Cloudinary (new files) ────────────────────────────────────────────────
  if (isCloudinaryUrl(storedUrl)) {
    return { type: 'cloudinary', url: storedUrl };
  }

  // ── Legacy disk search ────────────────────────────────────────────────────
  if (path.isAbsolute(storedUrl) && fs.existsSync(storedUrl)) {
    return { type: 'local', filePath: storedUrl };
  }

  const normalised = storedUrl.replace(/\\/g, '/');
  const filename   = path.basename(normalised);

  for (const dir of SIGNATURE_SEARCH_DIRS) {
    const candidate = path.join(dir, filename);
    if (fs.existsSync(candidate)) {
      console.log(`✅ Signature resolved (local): ${candidate}`);
      return { type: 'local', filePath: candidate };
    }
  }

  const relative   = normalised.replace(/^\/+/, '');
  const candidates = [
    path.resolve(__dirname, '..', relative),
    path.resolve(process.cwd(), relative),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      console.log(`✅ Signature resolved (relative): ${candidate}`);
      return { type: 'local', filePath: candidate };
    }
  }

  console.warn(`⚠️  Signature not found. Stored: "${storedUrl}"`);
  return null;
};

/**
 * downloadCloudinaryToBuffer
 *
 * Downloads a Cloudinary URL to a Buffer so PDFKit can use doc.image(buffer).
 * Required for Cloudinary signatures in PDF generation.
 *
 * Usage in pdfService.js:
 *
 *   const { resolveSignaturePath, downloadCloudinaryToBuffer } = require('../utils/signatureResolver');
 *
 *   const resolved = resolveSignaturePath(signature);
 *   if (resolved?.type === 'cloudinary') {
 *     const buffer = await downloadCloudinaryToBuffer(resolved.url);
 *     if (buffer) doc.image(buffer, x, y, { width: 80 });
 *   } else if (resolved?.type === 'local') {
 *     doc.image(resolved.filePath, x, y, { width: 80 });
 *   }
 */
const downloadCloudinaryToBuffer = (url) => {
  const https = require('https');
  const http  = require('http');
  const lib   = url.startsWith('https') ? https : http;

  return new Promise((resolve) => {
    lib.get(url, (res) => {
      if (res.statusCode !== 200) {
        console.warn(`⚠️  Could not download signature from Cloudinary (${res.statusCode}): ${url}`);
        return resolve(null);
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end',  ()    => resolve(Buffer.concat(chunks)));
      res.on('error', err  => {
        console.warn('⚠️  Signature download stream error:', err.message);
        resolve(null);
      });
    }).on('error', (err) => {
      console.warn('⚠️  Signature download request error:', err.message);
      resolve(null);
    });
  });
};

/**
 * migrateSignaturesToDisk — kept for legacy compat, no-op if Cloudinary is active
 */
const migrateSignaturesToDisk = async () => {
  console.log('ℹ️  migrateSignaturesToDisk: use migrate-to-cloudinary.js instead');
};

module.exports = {
  resolveSignaturePath,
  downloadCloudinaryToBuffer,
  migrateSignaturesToDisk,
  SIGNATURE_SEARCH_DIRS,
};









// require('dotenv').config();

// const accountSid = process.env.TWILIO_ACCOUNT_SID;
// const authToken = process.env.TWILIO_AUTH_TOKEN;

// // Verify credential format before creating client
// const validateCredentials = () => {
//     if (!accountSid || typeof accountSid !== 'string' || !accountSid.startsWith('AC')) {
//         throw new Error('Invalid TWILIO_ACCOUNT_SID format');
//     }
    
//     if (!authToken || typeof authToken !== 'string' || authToken.length < 32) {
//         throw new Error('Invalid TWILIO_AUTH_TOKEN format');
//     }

//     if (!process.env.TWILIO_PHONE_NUMBER || !process.env.TWILIO_PHONE_NUMBER.startsWith('+')) {
//         throw new Error('Invalid TWILIO_PHONE_NUMBER format');
//     }
// };

// // Create client only after validation
// let client;
// try {
//     validateCredentials();
//     client = require('twilio')(accountSid, authToken);
// } catch (error) {
//     console.error('Twilio client initialization failed:', error.message);
//     throw error;
// }

// const sendSMS = async (phoneNumber, message) => {
//     try {
//         // Format phone number to E.164 format
//         let formattedPhone = phoneNumber;
        
//         // Add Cameroon country code if not present
//         if (!phoneNumber.startsWith('+')) {
//             formattedPhone = phoneNumber.startsWith('237') 
//                 ? '+' + phoneNumber 
//                 : '+237' + phoneNumber;
//         }

//         // Validate phone number format
//         const phoneRegex = /^\+237[2368]\d{8}$/;
//         if (!phoneRegex.test(formattedPhone)) {
//             throw new Error(`Invalid Cameroon phone number format: ${formattedPhone}`);
//         }

//         // Log attempt details (safely)
//         console.log('SMS Attempt Details:', {
//             to: formattedPhone,
//             from: process.env.TWILIO_PHONE_NUMBER,
//             messageLength: message.length,
//             credentials: {
//                 accountSid: `${accountSid.substring(0, 8)}...${accountSid.substring(accountSid.length - 4)}`,
//                 authTokenPresent: !!authToken,
//                 authTokenLength: authToken?.length,
//                 fromNumber: process.env.TWILIO_PHONE_NUMBER
//             }
//         });

//         // Test client authentication before sending
//         await client.api.accounts(accountSid).fetch();
//         console.log('Twilio authentication successful');

//         // Send the message
//         const twilioMessage = await client.messages.create({
//             from: process.env.TWILIO_PHONE_NUMBER,
//             to: formattedPhone,
//             body: message
//         });

//         console.log(`SMS sent successfully. SID: ${twilioMessage.sid}`);
//         return {
//             success: true,
//             messageId: twilioMessage.sid,
//             status: twilioMessage.status
//         };
//     } catch (error) {
//         console.error('SMS Service Error:', {
//             name: error.name,
//             message: error.message,
//             code: error.code,
//             status: error.status,
//             moreInfo: error.moreInfo,
//             stack: error.stack
//         });

//         // Check for specific auth errors
//         if (error.status === 401) {
//             console.error('Authentication failed. Please verify your Twilio credentials.');
//         }

//         throw {
//             message: 'Failed to send SMS',
//             originalError: {
//                 code: error.code,
//                 status: error.status,
//                 message: error.message
//             }
//         };
//     }
// };

// module.exports = sendSMS;