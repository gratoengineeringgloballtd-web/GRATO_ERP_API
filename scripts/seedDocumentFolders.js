/**
 * seedDocumentFolders.js
 *
 * WHY THIS EXISTS
 * ----------------
 * The HR document manager's 10 original section types (National ID, Birth Certificate,
 * etc.) have always existed but were never organized into folders - they just sat in a
 * flat list. This creates the full folder structure requested (Civil Status File,
 * Education and Professional Training, Contracts, Bank Details, Health and Insurance,
 * Leave and Absence, CNPS, Disciplinary, Policies, Termination, Others - see
 * config/builtInDocumentSections.js for the exact structure, transcribed from the
 * provided planning notes), nests the 10 existing types into their correct folders, and
 * adds every new section from those notes that didn't exist before.
 *
 * Everything this script creates is GLOBAL (visible to every employee) - that's the
 * defaults set. Anything created afterward through the normal "Add Custom Section" flow
 * with a specific employee in context is personal to that one employee instead (see
 * createDocumentSection in hrController.js).
 *
 * SAFE TO RE-RUN: checks for an existing section by key before creating, so running
 * this twice does not create duplicates or error out.
 *
 * Usage:
 *   node scripts/seedDocumentFolders.js
 *   node scripts/seedDocumentFolders.js --dry-run
 */

require('dotenv').config();
const mongoose = require('mongoose');
const DocumentSection = require('../models/DocumentSection');
const User = require('../models/User');
const { FOLDER_STRUCTURE } = require('../config/builtInDocumentSections');

const DRY_RUN = process.argv.includes('--dry-run');

async function getSystemUser() {
  // Attribute seeded records to an admin/HR account rather than leaving createdBy
  // empty, since the schema requires it. Falls back to any admin if no HR user exists.
  const user = await User.findOne({ role: { $in: ['hr', 'admin'] }, isActive: true }).sort({ role: 1 });
  if (!user) {
    throw new Error('No active HR or admin user found to attribute seeded sections to. Create one first.');
  }
  return user;
}

async function seedFolder(folderDef, createdById) {
  let folder = await DocumentSection.findOne({ key: folderDef.key, employeeId: null });

  if (folder) {
    console.log(`  Folder "${folderDef.label}" already exists - skipping creation, checking its sections...`);
  } else {
    console.log(`${DRY_RUN ? '[dry-run] would create' : 'Creating'} folder: "${folderDef.label}" (${folderDef.key})`);
    if (!DRY_RUN) {
      folder = await DocumentSection.create({
        key: folderDef.key,
        label: folderDef.label,
        isFolder: true,
        scope: 'global',
        employeeId: null,
        parentFolder: null,
        ancestors: [],
        depth: 0,
        createdBy: createdById
      });
    }
  }

  let created = folder ? 0 : 1; // count the folder itself if it would be created in dry-run
  let skipped = folder ? 1 : 0;

  for (const sectionDef of folderDef.sections) {
    const key = sectionDef.builtInKey || sectionDef.key;
    const existing = await DocumentSection.findOne({ key, employeeId: null });

    if (existing) {
      console.log(`    - "${sectionDef.label}" (${key}) already exists - skipping`);
      skipped++;
      continue;
    }

    console.log(`    ${DRY_RUN ? '[dry-run] would create' : 'Creating'} section: "${sectionDef.label}" (${key})${sectionDef.builtInKey ? ' [migrated built-in]' : ''}`);
    if (!DRY_RUN) {
      await DocumentSection.create({
        key,
        label: sectionDef.label,
        required: !!sectionDef.required,
        multiple: true,
        isFolder: false,
        scope: 'global',
        employeeId: null,
        // If the folder doesn't exist yet (dry-run), we can't reference its real _id -
        // this only matters for the dry-run preview, since nothing is actually written.
        parentFolder: folder ? folder._id : null,
        ancestors: folder ? [folder._id] : [],
        depth: 1,
        createdBy: createdById
      });
    }
    created++;
  }

  return { created, skipped };
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  console.log(`✅ Connected to MongoDB${DRY_RUN ? ' (DRY RUN — no writes will be made)' : ''}\n`);

  const systemUser = await getSystemUser();
  console.log(`Attributing seeded sections to: ${systemUser.fullName} (${systemUser.email})\n`);

  let totalCreated = 0;
  let totalSkipped = 0;

  for (const folderDef of FOLDER_STRUCTURE) {
    const { created, skipped } = await seedFolder(folderDef, systemUser._id);
    totalCreated += created;
    totalSkipped += skipped;
  }

  console.log(`\n${DRY_RUN ? 'Dry run complete' : 'Done'}: ${totalCreated} item(s) ${DRY_RUN ? 'would be' : 'were'} created, ${totalSkipped} already existed and were left untouched.`);
  if (DRY_RUN) console.log('Re-run without --dry-run to apply.');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Seed script failed:', err);
  process.exit(1);
});
