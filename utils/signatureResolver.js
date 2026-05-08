/**
 * signatureResolver.js
 * Place at: utils/signatureResolver.js
 *
 * Returns { type: 'local', filePath } or { type: 'cloudinary', url } or null.
 * This matches what renderSignatureImage() in pdfService.js expects.
 */

const fs   = require('fs');
const path = require('path');

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
 * @param {object|string|null} signatureData
 *   - User.signature object { url, localPath, filename }
 *   - Raw path string  "C:\Users\...\uploads\user-signatures\abc.png"
 *   - Cloudinary URL   "https://res.cloudinary.com/..."
 *
 * @returns {{ type: 'cloudinary', url: string }
 *          |{ type: 'local',     filePath: string }
 *          | null }
 */
const resolveSignaturePath = (signatureData) => {
  if (!signatureData) return null;

  // Accept object or plain string
  const storedUrl = typeof signatureData === 'string'
    ? signatureData
    : (signatureData.url || signatureData.localPath || signatureData.filename || null);

  if (!storedUrl) return null;

  // ── Cloudinary URL (new files after migration) ────────────────────────────
  if (isCloudinaryUrl(storedUrl)) {
    return { type: 'cloudinary', url: storedUrl };
  }

  // ── Local absolute path (works on dev machine) ────────────────────────────
  if (path.isAbsolute(storedUrl) && fs.existsSync(storedUrl)) {
    return { type: 'local', filePath: storedUrl };
  }

  // ── Search by filename across known dirs ──────────────────────────────────
  const normalised = storedUrl.replace(/\\/g, '/');
  const filename   = path.basename(normalised);

  for (const dir of SIGNATURE_SEARCH_DIRS) {
    const candidate = path.join(dir, filename);
    if (fs.existsSync(candidate)) {
      console.log(`✅ Signature resolved: ${candidate}`);
      return { type: 'local', filePath: candidate };
    }
  }

  // ── Relative path fallback ────────────────────────────────────────────────
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

  console.warn(`⚠️  Signature not found. Stored path: "${storedUrl}"`);
  console.warn(`   Searched dirs: ${SIGNATURE_SEARCH_DIRS.join(', ')}`);
  return null;
};

/**
 * downloadCloudinaryToBuffer
 * Downloads a Cloudinary URL to a Buffer so PDFKit can use doc.image(buffer).
 */
const downloadCloudinaryToBuffer = (url) => {
  const https = require('https');
  const http  = require('http');
  const lib   = url.startsWith('https') ? https : http;

  return new Promise((resolve) => {
    lib.get(url, (res) => {
      if (res.statusCode !== 200) {
        console.warn(`⚠️  Could not download signature (${res.statusCode}): ${url}`);
        return resolve(null);
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end',  ()    => resolve(Buffer.concat(chunks)));
      res.on('error', err  => { console.warn('⚠️  Signature download error:', err.message); resolve(null); });
    }).on('error', (err) => { console.warn('⚠️  Signature download error:', err.message); resolve(null); });
  });
};

const migrateSignaturesToDisk = async () => {
  const targetDir = '/var/data/user-signatures';
  fs.mkdirSync(targetDir, { recursive: true });

  const sourceDirs = [
    path.resolve(__dirname, '../uploads/user-signatures'),
    path.resolve(__dirname, '../public/signatures'),
  ];

  let totalCopied = 0;
  for (const sourceDir of sourceDirs) {
    if (!fs.existsSync(sourceDir)) { console.log(`ℹ️  Skipping: ${sourceDir}`); continue; }
    console.log(`\n📂 Copying from: ${sourceDir}`);
    for (const file of fs.readdirSync(sourceDir)) {
      const src  = path.join(sourceDir, file);
      const dest = path.join(targetDir, file);
      if (!fs.statSync(src).isFile()) continue;
      if (!fs.existsSync(dest)) { fs.copyFileSync(src, dest); totalCopied++; console.log(`  ✅ Copied: ${file}`); }
      else console.log(`  ⏭️  Already exists: ${file}`);
    }
  }
  console.log(`\nDone. ${totalCopied} file(s) copied to ${targetDir}`);
};

module.exports = { resolveSignaturePath, downloadCloudinaryToBuffer, migrateSignaturesToDisk, SIGNATURE_SEARCH_DIRS };






// =============================================================================
// PATCH INSTRUCTIONS FOR pdfService.js
// =============================================================================
//
// 1. At the top of pdfService.js, add:
//
//      const { resolveSignaturePath } = require('../utils/signatureResolver');
//
//
// 2. In drawSignatureSection() — replace every signature image block:
//
//    BEFORE:
//      if (signature?.signaturePath && fs.existsSync(signature.signaturePath)) {
//        doc.image(signature.signaturePath, imgX, imgY, { width: imgWidth });
//      }
//
//    AFTER:
//      const resolvedSigPath = resolveSignaturePath(signature?.signaturePath || signature);
//      if (resolvedSigPath) {
//        doc.image(resolvedSigPath, imgX, imgY, { width: imgWidth });
//      }
//
//
// 3. In drawApproverSignatures() — replace:
//
//    BEFORE:
//      const signaturePath = block.step?.decidedBy?.signature?.localPath;
//      if (signaturePath && fs.existsSync(signaturePath)) {
//        doc.image(signaturePath, x + 10, lineY - 24, { width: 110, height: 36 });
//      }
//
//    AFTER:
//      const resolvedSigPath = resolveSignaturePath(block.step?.decidedBy?.signature);
//      if (resolvedSigPath) {
//        doc.image(resolvedSigPath, x + 10, lineY - 24, { width: 110, height: 36 });
//      }
//
//
// 4. In drawRequesterAcknowledgmentSignature() and drawBuyerAcknowledgmentSignature():
//
//    BEFORE:
//      const signaturePath = acknowledgment?.signatureLocalPath;
//      if (signaturePath && fs.existsSync(signaturePath)) {
//        doc.image(signaturePath, centerX + 10, yPos - 28, { width: 160, height: 36 });
//      }
//
//    AFTER:
//      const resolvedSigPath = resolveSignaturePath(acknowledgment?.signatureLocalPath);
//      if (resolvedSigPath) {
//        doc.image(resolvedSigPath, centerX + 10, yPos - 28, { width: 160, height: 36 });
//      }
//
//
// That's it — no other changes needed. The resolver handles all path formats
// automatically, both on Windows (local) and Linux (Render).
// =============================================================================