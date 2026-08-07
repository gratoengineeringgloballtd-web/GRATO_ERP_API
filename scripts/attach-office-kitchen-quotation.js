/**
 * scripts/attach-office-kitchen-quotation.js
 *
 * Uploads the office kitchen construction quotation to Cloudinary and attaches it to
 * Purchase Requisition REQ202608059427's attachments[] array.
 *
 * Unlike the earlier attach-* scripts, this one doesn't assume a fixed filename/
 * extension - it searches the public/ folder for a file matching the given base name
 * (with or without an extension) and figures out the real file type from its magic
 * bytes, since the file was placed there directly rather than uploaded through chat.
 *
 * Usage:
 *   node scripts/attach-office-kitchen-quotation.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const fs       = require('fs');
const path     = require('path');

const User                = require('../models/User'); // must be required before PurchaseRequisition (populate refs)
const PurchaseRequisition = require('../models/PurchaseRequisition');
const { saveFile, STORAGE_CATEGORIES } = require('../utils/cloudinaryStorage');

// ── Config ──────────────────────────────────────────────────────────────────
const REQUISITION_NUMBER = 'REQ202608059427';
const PUBLIC_DIR = path.resolve(__dirname, '../public');
const BASE_NAME = '2026805-GRATO ENG-QUOTATION FOR OFFICE KITCHEN-55500';
const DISPLAY_NAME = BASE_NAME; // shown to users as attachment name (extension appended after detection)

// ── Magic-byte mimetype/extension detection ──────────────────────────────────
const detectFileType = (buffer) => {
  const magic = {
    pdf:  { sig: [0x25, 0x50, 0x44, 0x46], ext: '.pdf',  mimetype: 'application/pdf' },
    png:  { sig: [0x89, 0x50, 0x4e, 0x47], ext: '.png',  mimetype: 'image/png' },
    jpg:  { sig: [0xff, 0xd8, 0xff],       ext: '.jpg',  mimetype: 'image/jpeg' },
    gif:  { sig: [0x47, 0x49, 0x46, 0x38], ext: '.gif',  mimetype: 'image/gif' },
    // Modern .docx/.xlsx (zip-based Office formats) also start with this signature
    zipOffice: { sig: [0x50, 0x4b, 0x03, 0x04], ext: '.docx', mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  };

  for (const { sig, ext, mimetype } of Object.values(magic)) {
    if (sig.every((byte, i) => buffer[i] === byte)) {
      return { ext, mimetype };
    }
  }

  console.warn('⚠️  Could not detect file signature — defaulting to application/pdf. Verify this is correct.');
  return { ext: '.pdf', mimetype: 'application/pdf' };
};

// ── Locate the file in public/, with or without an extension ─────────────────
const findFile = () => {
  if (!fs.existsSync(PUBLIC_DIR)) {
    console.error(`❌ public/ directory not found at: ${PUBLIC_DIR}`);
    process.exit(1);
  }

  const entries = fs.readdirSync(PUBLIC_DIR);
  const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const target = normalize(BASE_NAME);

  const matches = entries.filter((name) => {
    const withoutExt = name.replace(/\.[^.]+$/, '');
    return normalize(withoutExt) === target || normalize(name) === target;
  });

  if (matches.length === 0) {
    console.error(`❌ No file matching "${BASE_NAME}" found in ${PUBLIC_DIR}`);
    console.error('   Files present:');
    entries.forEach((e) => console.error(`     - ${e}`));
    process.exit(1);
  }

  if (matches.length > 1) {
    console.error(`❌ Multiple files match "${BASE_NAME}" - please remove the extras so only one remains:`);
    matches.forEach((m) => console.error(`     - ${m}`));
    process.exit(1);
  }

  return path.join(PUBLIC_DIR, matches[0]);
};

async function main() {
  console.log('='.repeat(65));
  console.log(' ATTACH FILE TO PURCHASE REQUISITION');
  console.log('='.repeat(65));

  const filePath = findFile();
  const buffer = fs.readFileSync(filePath);
  const { ext, mimetype } = detectFileType(buffer);
  console.log(`📄 Source file : ${filePath}`);
  console.log(`   Size        : ${(buffer.length / 1024).toFixed(2)} KB`);
  console.log(`   Detected    : ${mimetype} (${ext})`);

  // ── Connect to DB ───────────────────────────────────────────────────────────
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  console.log('✅ Connected to MongoDB');

  // ── Find the requisition ────────────────────────────────────────────────────
  const requisition = await PurchaseRequisition.findOne({ requisitionNumber: REQUISITION_NUMBER });
  if (!requisition) {
    console.error(`❌ Requisition ${REQUISITION_NUMBER} not found`);
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log(`📋 Found requisition: ${requisition.requisitionNumber} — ${requisition.title}`);

  const finalName = `${DISPLAY_NAME}${ext}`;
  const alreadyAttached = requisition.attachments.some(a => a.name === finalName);
  if (alreadyAttached) {
    console.log(`ℹ️  "${finalName}" is already attached to this requisition — skipping upload.`);
    await mongoose.disconnect();
    return;
  }

  // ── Upload to Cloudinary ─────────────────────────────────────────────────────
  const fileForUpload = {
    buffer,
    originalname: finalName,
    mimetype,
    size: buffer.length,
  };

  console.log('\n☁️  Uploading to Cloudinary...');
  const uploadResult = await saveFile(
    fileForUpload,
    STORAGE_CATEGORIES.PURCHASE_REQUISITIONS,
    requisition.requisitionNumber
  );

  // ── Build attachment entry matching the schema ───────────────────────────────
  const attachment = {
    name:       finalName,
    url:        uploadResult.url,
    publicId:   uploadResult.publicId,
    localPath:  uploadResult.localPath, // cloudinaryStorage sets this to the secure_url
    size:       uploadResult.bytes || buffer.length,
    mimetype:   uploadResult.mimetype,
    uploadedAt: new Date(),
  };

  requisition.attachments.push(attachment);
  await requisition.save();

  console.log('\n✅ Attachment saved to requisition:');
  console.log(`   Name : ${attachment.name}`);
  console.log(`   URL  : ${attachment.url}`);
  console.log(`   Size : ${(attachment.size / 1024).toFixed(2)} KB`);
  console.log(`\n   Requisition attachments count: ${requisition.attachments.length}`);

  await mongoose.disconnect();
  console.log('\n' + '='.repeat(65));
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
