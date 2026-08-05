/**
 * seedOrgHierarchyFromConfig.js
 *
 * PHASE 1 of moving the organizational hierarchy off static config files and onto
 * real User records.
 *
 * WHY THIS EXISTS
 * ----------------
 * The codebase currently has THREE separate sources of truth for "who reports to whom":
 *   1. config/requisitionApprovalChain.js  — hardcoded DEPARTMENT_STRUCTURE, used only
 *      by the purchase requisition approval chain builder (getApprovalChainForRequisition).
 *   2. config/departmentStructure.js       — a second, slightly different hardcoded
 *      DEPARTMENT_STRUCTURE, used by services/hierarchyService.js.
 *   3. User.supervisor / User.directReports / User.hierarchyPath / User.hierarchyLevel /
 *      User.approvalCapacities — real schema fields already defined on the User model,
 *      with a full, working HierarchyService (calculateHierarchyPath, updateSupervisor,
 *      determineApprovalCapacities, etc.) already built against them.
 *
 * In practice (3) is mostly empty for real users, because nothing currently populates it
 * for the whole company — the requisition approval chain instead reads from the static
 * config each time, which is why every hire/exit/promotion currently requires a code
 * deploy instead of a database update.
 *
 * WHAT THIS SCRIPT DOES
 * ----------------------
 * For every entry in config/departmentStructure.js (the config HierarchyService already
 * expects), find the matching User by email and:
 *   - set position / department / hierarchyLevel
 *   - set supervisor (resolved via the 'reportsTo' email) using HierarchyService.updateSupervisor
 *     so directReports/hierarchyPath stay consistent, exactly like a manual reassignment would
 *   - set approvalCapacities via HierarchyService.determineApprovalCapacities
 *
 * It is idempotent — safe to re-run after HR changes the config, or once User records are
 * edited directly and you want to confirm nothing drifted.
 *
 * WHAT THIS SCRIPT DELIBERATELY DOES NOT DO
 * --------------------------------------------
 * It does NOT change getApprovalChainForRequisition() or any other live approval-routing
 * code. That function still reads config/requisitionApprovalChain.js today. Cutting it
 * over to read from User instead is PHASE 2, and should only be done after:
 *   1. Running this script against production data,
 *   2. Spot-checking a handful of users' resulting supervisor chains against reality
 *      (e.g. via HierarchyService.calculateHierarchyPath), and
 *   3. Reconciling any people who exist in the User collection but not in the config
 *      (or vice versa) — this script logs those explicitly below instead of guessing.
 * Rewriting the approval-routing algorithm itself carries real risk (it decides who signs
 * off on money), so it deserves its own reviewed change once this data is verified, not a
 * silent swap bundled into this migration.
 *
 * Usage:
 *   node scripts/seedOrgHierarchyFromConfig.js
 *   node scripts/seedOrgHierarchyFromConfig.js --dry-run
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/your-db-name';
const DRY_RUN = process.argv.includes('--dry-run');

const User = require('../models/User');
const HierarchyService = require('../services/hierarchyService');
const { DEPARTMENT_STRUCTURE } = require('../config/departmentStructure');

/** Flatten DEPARTMENT_STRUCTURE into a single list of { email, name, position, department, reportsTo, hierarchyLevel, isHead }. */
function flattenConfig() {
  const people = [];

  for (const dept of Object.values(DEPARTMENT_STRUCTURE)) {
    if (dept.head?.email) {
      people.push({
        email: dept.head.email.toLowerCase().trim(),
        name: dept.head.name,
        position: dept.head.position,
        department: dept.name,
        reportsTo: dept.head.reportsTo ? dept.head.reportsTo.toLowerCase().trim() : null,
        hierarchyLevel: dept.head.hierarchyLevel,
        isHead: true
      });
    }
    for (const [positionTitle, person] of Object.entries(dept.positions || {})) {
      if (!person.email) continue;
      people.push({
        email: person.email.toLowerCase().trim(),
        name: person.name,
        position: positionTitle,
        department: dept.name,
        reportsTo: person.reportsTo ? person.reportsTo.toLowerCase().trim() : null,
        hierarchyLevel: person.hierarchyLevel,
        isHead: false
      });
    }
  }

  return people;
}

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log(`✅ MongoDB connected${DRY_RUN ? ' (DRY RUN — no writes will be made)' : ''}`);

  const people = flattenConfig();
  console.log(`Found ${people.length} people in config/departmentStructure.js`);

  // Pass 1: create/update basic fields (position, department, hierarchyLevel, approvalCapacities)
  // for everyone who has a matching User record, before wiring up supervisor relationships.
  const matched = [];
  const missingUsers = [];

  for (const person of people) {
    const user = await User.findOne({ email: person.email });
    if (!user) {
      missingUsers.push(person.email);
      continue;
    }

    matched.push({ person, user });

    const capacities = HierarchyService.determineApprovalCapacities(
      person.position || '',
      person.department,
      person.isHead
    );

    console.log(`${DRY_RUN ? '[dry-run] would update' : 'Updating'} ${person.email}: position="${person.position}", department="${person.department}", hierarchyLevel=${person.hierarchyLevel}, approvalCapacities=[${capacities.join(', ')}]`);

    if (!DRY_RUN) {
      user.position = person.position || user.position;
      user.department = person.department || user.department;
      if (person.hierarchyLevel) user.hierarchyLevel = person.hierarchyLevel;
      user.approvalCapacities = capacities;
      await user.save();
    }
  }

  // Pass 2: wire up supervisor relationships now that everyone in this batch exists,
  // via HierarchyService.updateSupervisor so directReports/hierarchyPath/cycle-checks
  // all stay consistent — same code path a manual admin reassignment would use.
  let supervisorLinksSet = 0;
  const missingSupervisors = [];

  for (const { person, user } of matched) {
    if (!person.reportsTo) continue;

    const supervisorUser = await User.findOne({ email: person.reportsTo });
    if (!supervisorUser) {
      missingSupervisors.push({ email: person.email, reportsTo: person.reportsTo });
      continue;
    }

    console.log(`${DRY_RUN ? '[dry-run] would set' : 'Setting'} supervisor: ${person.email} -> ${person.reportsTo}`);

    if (!DRY_RUN) {
      try {
        await HierarchyService.updateSupervisor(user._id, supervisorUser._id, null);
        supervisorLinksSet++;
      } catch (err) {
        console.error(`   ⚠️  Failed to set supervisor for ${person.email}: ${err.message}`);
      }
    }
  }

  // Reconciliation report — deliberately not auto-fixed, since it needs a human decision
  // (e.g. is this a genuine new hire not yet in config, or a config entry for someone who left?).
  console.log('\n=== Reconciliation Report ===');
  console.log(`Matched (config -> existing User): ${matched.length}`);
  console.log(`Supervisor links set: ${supervisorLinksSet}`);

  if (missingUsers.length) {
    console.log(`\n⚠️  ${missingUsers.length} email(s) in config but no matching User record:`);
    missingUsers.forEach(e => console.log(`   - ${e}`));
  }

  if (missingSupervisors.length) {
    console.log(`\n⚠️  ${missingSupervisors.length} person(s) whose configured supervisor has no User record:`);
    missingSupervisors.forEach(m => console.log(`   - ${m.email} -> ${m.reportsTo}`));
  }

  const configEmails = new Set(people.map(p => p.email));
  const activeUsersNotInConfig = await User.find({
    isActive: true,
    role: { $nin: ['supplier', 'admin'] },
    email: { $nin: [...configEmails] }
  }).select('email fullName department');

  if (activeUsersNotInConfig.length) {
    console.log(`\n⚠️  ${activeUsersNotInConfig.length} active User(s) not represented in config/departmentStructure.js (won't get an approval chain until added):`);
    activeUsersNotInConfig.forEach(u => console.log(`   - ${u.email} (${u.fullName}, ${u.department})`));
  }

  console.log(`\n${DRY_RUN ? 'Dry run complete — re-run without --dry-run to apply.' : 'Done.'}`);

  await mongoose.disconnect();
}

run().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
