/**
 * migrate-to-cloudinary.js
 *
 * Migrates ALL existing files from Render disk / local storage to Cloudinary.
 * Updates MongoDB documents with new Cloudinary URLs.
 * Safe to run multiple times — already-migrated files are skipped.
 *
 * Run locally (connects to Atlas):
 *   node scripts/migrate-to-cloudinary.js --dry-run     ← preview only
 *   node scripts/migrate-to-cloudinary.js --apply       ← actually migrate
 *
 * Or from Render Shell after deploy:
 *   node scripts/migrate-to-cloudinary.js --apply
 */

require('dotenv').config();
const mongoose    = require('mongoose');
const cloudinary  = require('cloudinary').v2;
const fs          = require('fs');
const path        = require('path');
const https       = require('https');

// ─── Config ───────────────────────────────────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure:     true,
});

const CLOUDINARY_ROOT = process.env.CLOUDINARY_ROOT_FOLDER || 'grato-erp';
const APPLY           = process.argv.includes('--apply');
const DRY_RUN         = !APPLY;

if (DRY_RUN) {
  console.log('\n⚠️  DRY RUN MODE — no files will be uploaded or DB records changed');
  console.log('    Run with --apply to perform the actual migration\n');
}

// ─── Search dirs (Render disk + local dev) ────────────────────────────────────
const SEARCH_DIRS = [
  process.env.UPLOADS_PATH,
  '/var/data/uploads',
  '/var/data/user-signatures',
  path.resolve(__dirname, '../uploads'),
  path.resolve(__dirname, '../public/signatures'),
  path.resolve(__dirname, '../uploads/user-signatures'),
].filter(Boolean);

// ─── Models ───────────────────────────────────────────────────────────────────
// Require User first to avoid "Schema hasn't been registered" errors
const User                       = require('../models/User');
const CashRequest                = require('../models/CashRequest');
const PurchaseRequisition        = require('../models/PurchaseRequisition');
// Add any other models that store file references:
// const SupplierInvoice         = require('../models/SupplierInvoice');
// const Contract                = require('../models/Contract');

// ─── Counters ─────────────────────────────────────────────────────────────────
const stats = {
  total:     0,
  migrated:  0,
  skipped:   0,   // already on Cloudinary
  missing:   0,   // file not found on disk
  failed:    0,
  errors:    [],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const isCloudinaryUrl = (str = '') =>
  str.startsWith('https://res.cloudinary.com') ||
  str.startsWith('http://res.cloudinary.com');

/**
 * Find a file on disk by filename, searching all known dirs
 */
const findOnDisk = (storedPath) => {
  if (!storedPath) return null;

  // Absolute path still works
  if (path.isAbsolute(storedPath) && fs.existsSync(storedPath)) return storedPath;

  const normalised = storedPath.replace(/\\/g, '/');
  const filename   = path.basename(normalised);

  for (const dir of SEARCH_DIRS) {
    if (!fs.existsSync(dir)) continue;
    const candidate = path.join(dir, filename);
    if (fs.existsSync(candidate)) return candidate;
  }

  // Relative from project root
  const relative   = normalised.replace(/^\/+/, '');
  const candidates = [
    path.resolve(__dirname, '..', relative),
    path.resolve(process.cwd(), relative),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  return null;
};

/**
 * Upload a local file to Cloudinary
 * @returns {string} secure_url
 */
const uploadFile = async (localPath, folder, mimetype) => {
  const resourceType = mimetype?.startsWith('image/') ? 'image' : 'raw';
  const ext          = path.extname(localPath).toLowerCase();
  const baseName     = path.basename(localPath, ext)
                         .replace(/[^a-zA-Z0-9_\-]/g, '_')
                         .substring(0, 80);

  // For raw resources include extension in public_id
  const publicId = resourceType === 'raw' ? `${baseName}${ext}` : baseName;

  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload(
      localPath,
      {
        folder,
        public_id:     publicId,
        resource_type: resourceType,
        use_filename:  false,
        overwrite:     false,
      },
      (err, result) => {
        if (err) return reject(err);
        resolve(result.secure_url);
      }
    );
  });
};

/**
 * Migrate a single attachment object in-place.
 * Mutates the attachment object if successful.
 * @returns {'migrated'|'skipped'|'missing'|'failed'}
 */
const migrateAttachment = async (attachment, cloudinaryFolder) => {
  if (!attachment) return 'skipped';

  const storedUrl  = attachment.url || attachment.localPath;
  const mimetype   = attachment.mimetype || attachment.format;

  // Already on Cloudinary
  if (isCloudinaryUrl(storedUrl)) return 'skipped';

  stats.total++;

  const localPath = findOnDisk(attachment.localPath || storedUrl);

  if (!localPath) {
    console.warn(`   ⚠️  File not found on disk: ${attachment.localPath || storedUrl}`);
    stats.missing++;
    return 'missing';
  }

  if (DRY_RUN) {
    console.log(`   [DRY RUN] Would upload: ${path.basename(localPath)} → ${cloudinaryFolder}`);
    stats.migrated++;
    return 'migrated';
  }

  try {
    const newUrl = await uploadFile(localPath, cloudinaryFolder, mimetype);
    console.log(`   ✅ Migrated: ${path.basename(localPath)}`);
    console.log(`      → ${newUrl}`);

    // Update attachment object in-place
    attachment.url       = newUrl;
    attachment.localPath = newUrl;
    if (attachment.relativePath !== undefined) attachment.relativePath = newUrl;

    stats.migrated++;
    return 'migrated';
  } catch (err) {
    console.error(`   ❌ Upload failed: ${path.basename(localPath)} — ${err.message}`);
    stats.failed++;
    stats.errors.push({ file: localPath, error: err.message });
    return 'failed';
  }
};

// ─── Migration tasks ──────────────────────────────────────────────────────────

/**
 * 1. User signatures
 */
const migrateUserSignatures = async () => {
  console.log('\n' + '═'.repeat(70));
  console.log('1. USER SIGNATURES');
  console.log('═'.repeat(70));

  const users = await User.find({ 'signature.url': { $exists: true, $ne: null } });
  console.log(`   Found ${users.length} users with signatures\n`);

  for (const user of users) {
    console.log(`   ${user.fullName} (${user.email})`);
    const result = await migrateAttachment(user.signature, `${CLOUDINARY_ROOT}/user-signatures`);

    if (result === 'migrated' && !DRY_RUN) {
      await User.findByIdAndUpdate(user._id, { signature: user.signature });
    }
  }
};

/**
 * 2. Cash Requests — attachments, justification docs, reimbursement receipts
 */
const migrateCashRequests = async () => {
  console.log('\n' + '═'.repeat(70));
  console.log('2. CASH REQUESTS');
  console.log('═'.repeat(70));

  const requests = await CashRequest.find({});
  console.log(`   Found ${requests.length} cash requests\n`);

  for (const req of requests) {
    let changed = false;

    // Main attachments
    if (Array.isArray(req.attachments)) {
      for (const att of req.attachments) {
        const r = await migrateAttachment(att, `${CLOUDINARY_ROOT}/cash-requests/attachments`);
        if (r === 'migrated') changed = true;
      }
    }

    // Justification documents
    if (Array.isArray(req.justification?.documents)) {
      for (const doc of req.justification.documents) {
        const r = await migrateAttachment(doc, `${CLOUDINARY_ROOT}/justifications`);
        if (r === 'migrated') changed = true;
      }
    }

    // Reimbursement receipts
    if (Array.isArray(req.reimbursementDetails?.receiptDocuments)) {
      for (const doc of req.reimbursementDetails.receiptDocuments) {
        const r = await migrateAttachment(doc, `${CLOUDINARY_ROOT}/reimbursements`);
        if (r === 'migrated') changed = true;
      }
    }

    // Disbursement docs
    if (Array.isArray(req.disbursements)) {
      for (const disb of req.disbursements) {
        if (Array.isArray(disb.documents)) {
          for (const doc of disb.documents) {
            const r = await migrateAttachment(doc, `${CLOUDINARY_ROOT}/cash-requests/disbursements`);
            if (r === 'migrated') changed = true;
          }
        }
      }
    }

    if (changed && !DRY_RUN) {
      await req.save();
      console.log(`   💾 Saved: ${req.displayId || req._id}`);
    }
  }
};

/**
 * 3. Purchase Requisitions
 */
const migratePurchaseRequisitions = async () => {
  console.log('\n' + '═'.repeat(70));
  console.log('3. PURCHASE REQUISITIONS');
  console.log('═'.repeat(70));

  const reqs = await PurchaseRequisition.find({});
  console.log(`   Found ${reqs.length} purchase requisitions\n`);

  for (const req of reqs) {
    let changed = false;

    if (Array.isArray(req.attachments)) {
      for (const att of req.attachments) {
        const r = await migrateAttachment(att, `${CLOUDINARY_ROOT}/purchase-requisitions/attachments`);
        if (r === 'migrated') changed = true;
      }
    }

    if (changed && !DRY_RUN) {
      await req.save();
      console.log(`   💾 Saved: ${req.requisitionNumber || req._id}`);
    }
  }
};

// Add more migration tasks here for SupplierInvoice, Contract, etc.
// Follow the same pattern: find docs, loop attachments, call migrateAttachment

// ─── Main ─────────────────────────────────────────────────────────────────────

const main = async () => {
  console.log('\n' + '█'.repeat(70));
  console.log('  CLOUDINARY MIGRATION SCRIPT — GRATO ERP');
  console.log('  Mode:', DRY_RUN ? 'DRY RUN (preview only)' : '⚡ LIVE — files will be uploaded');
  console.log('  Cloudinary cloud:', process.env.CLOUDINARY_CLOUD_NAME);
  console.log('  Root folder:', CLOUDINARY_ROOT);
  console.log('█'.repeat(70) + '\n');

  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY) {
    console.error('❌ Cloudinary credentials missing. Check your .env file.');
    process.exit(1);
  }

  try {
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err.message);
    process.exit(1);
  }

  const start = Date.now();

  await migrateUserSignatures();
  await migrateCashRequests();
  await migratePurchaseRequisitions();

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log('\n' + '═'.repeat(70));
  console.log('MIGRATION SUMMARY');
  console.log('═'.repeat(70));
  console.log(`Total files found    : ${stats.total}`);
  console.log(`Migrated             : ${stats.migrated} ✅`);
  console.log(`Already on Cloudinary: ${stats.skipped} ⏭️`);
  console.log(`Not found on disk    : ${stats.missing} ⚠️`);
  console.log(`Failed               : ${stats.failed} ❌`);
  console.log(`Time elapsed         : ${elapsed}s`);
  console.log('═'.repeat(70));

  if (stats.errors.length > 0) {
    console.log('\nFailed files:');
    stats.errors.forEach(e => console.log(`  • ${e.file}: ${e.error}`));
  }

  if (DRY_RUN) {
    console.log('\n⚠️  This was a DRY RUN. Run with --apply to perform the migration.');
  } else {
    console.log('\n✅ Migration complete!');
    console.log('   Next steps:');
    console.log('   1. Verify files appear in your Cloudinary Media Library');
    console.log('   2. Deploy the new cloudinaryStorage.js and uploadMiddleware.js');
    console.log('   3. Remove UPLOADS_PATH env var from Render (no longer needed)');
    console.log('   4. Optionally detach the Render disk to save $2.50/month');
  }

  await mongoose.disconnect();
  process.exit(0);
};

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});