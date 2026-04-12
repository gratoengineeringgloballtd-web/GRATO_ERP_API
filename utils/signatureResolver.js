/**
 * signatureResolver.js
 *
 * Resolves signature image paths reliably across local Windows dev and Render (Linux).
 * Place in: utils/signatureResolver.js
 */

const fs   = require('fs');
const path = require('path');

// Search dirs in priority order — first match wins
const SIGNATURE_SEARCH_DIRS = [
  process.env.SIGNATURE_PATH,                                    // Render env var (highest priority)
  '/var/data/user-signatures',                                   // Render persistent disk (actual folder)
  '/var/data/signatures',                                        // Render persistent disk (fallback)
  path.resolve(__dirname, '../uploads/user-signatures'),         // ✅ actual local storage folder
  path.resolve(__dirname, '../public/signatures'),               // old migration folder
  path.resolve(__dirname, '../uploads/signatures'),              // generic fallback
].filter(Boolean);

/**
 * Resolves a stored signature path/object to an absolute local path.
 *
 * Accepts:
 *   - User.signature object  { localPath, filename, url }
 *   - A raw path string      "C:\Users\...\uploads\user-signatures\abc.png"
 *   - A filename string      "abc.png"
 *
 * @param {object|string|null} signatureData
 * @returns {string|null}  Absolute path if found, null otherwise
 */
const resolveSignaturePath = (signatureData) => {
  if (!signatureData) return null;

  const storedPath = typeof signatureData === 'string'
    ? signatureData
    : (signatureData.localPath || signatureData.filename || signatureData.url || null);

  if (!storedPath) return null;

  // Strategy 1: stored absolute path still works (local dev happy path)
  if (path.isAbsolute(storedPath) && fs.existsSync(storedPath)) {
    return storedPath;
  }

  // Strategy 2: extract filename and search all known signature dirs
  // Normalise Windows backslashes first
  const normalised = storedPath.replace(/\\/g, '/');
  const filename   = path.basename(normalised);

  for (const dir of SIGNATURE_SEARCH_DIRS) {
    const candidate = path.join(dir, filename);
    if (fs.existsSync(candidate)) {
      console.log(`✅ Signature resolved: ${candidate}`);
      return candidate;
    }
  }

  // Strategy 3: strip leading slash and resolve relative to project root
  const relative = normalised.replace(/^\/+/, '');
  const candidates = [
    path.resolve(__dirname, '..', relative),
    path.resolve(process.cwd(), relative),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      console.log(`✅ Signature resolved (relative): ${candidate}`);
      return candidate;
    }
  }

  console.warn(`⚠️  Signature not found. Stored path: "${storedPath}"`);
  console.warn(`   Searched dirs: ${SIGNATURE_SEARCH_DIRS.join(', ')}`);
  return null;
};

/**
 * Migrates signature files to Render persistent disk.
 *
 * Copies from BOTH known local signature folders:
 *   - uploads/user-signatures/   ← where new signatures are saved
 *   - public/signatures/         ← where old signatures lived
 *
 * Run once after attaching the Render disk:
 *   node -e "require('./utils/signatureResolver').migrateSignaturesToDisk()"
 */
const migrateSignaturesToDisk = async () => {
  const targetDir = '/var/data/user-signatures';
  fs.mkdirSync(targetDir, { recursive: true });

  const sourceDirs = [
    path.resolve(__dirname, '../uploads/user-signatures'),
    path.resolve(__dirname, '../public/signatures'),
  ];

  let totalCopied = 0;

  for (const sourceDir of sourceDirs) {
    if (!fs.existsSync(sourceDir)) {
      console.log(`ℹ️  Skipping (not found): ${sourceDir}`);
      continue;
    }

    console.log(`\n📂 Copying from: ${sourceDir}`);
    const files = fs.readdirSync(sourceDir);

    for (const file of files) {
      const src  = path.join(sourceDir, file);
      const dest = path.join(targetDir, file);

      if (!fs.statSync(src).isFile()) continue; // skip subdirs

      if (!fs.existsSync(dest)) {
        fs.copyFileSync(src, dest);
        totalCopied++;
        console.log(`  ✅ Copied: ${file}`);
      } else {
        console.log(`  ⏭️  Already exists: ${file}`);
      }
    }
  }

  console.log(`\nDone. ${totalCopied} file(s) copied to ${targetDir}`);
};

module.exports = { resolveSignaturePath, migrateSignaturesToDisk, SIGNATURE_SEARCH_DIRS };








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