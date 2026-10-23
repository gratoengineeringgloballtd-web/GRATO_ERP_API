/**
 * Approval-chain tests (jest - run with: npx jest tests/approvalChains.test.js)
 *
 * No database needed: the chain builders are pure config. `mongoose` is stubbed
 * because config/dynamicStructure.js (runtime org-structure additions) loads it.
 *
 * Tests wrapped in knownDefect() describe KNOWN DEFECTS found while writing this
 * suite. They pass while the defect exists and FAIL once it is fixed, as a
 * reminder to turn them into normal tests.
 */
const path = require('path');

// No database in unit tests: config/dynamicStructure.js loads mongoose.
jest.mock('mongoose', () => ({ connection: { readyState: 0, on() {} } }), { virtual: true });

// The builders are very chatty; keep test output readable.
const realLog = console.log, realErr = console.error, realWarn = console.warn;
const quiet = (fn) => (...a) => {
  console.log = console.error = console.warn = () => {};
  try { return fn(...a); } finally { console.log = realLog; console.error = realErr; console.warn = realWarn; }
};

// A test that is expected to fail today. If it starts passing, this fails so
// you remember to promote it to a regular test.
const knownDefect = (name, reason, fn) =>
  test(`[KNOWN DEFECT] ${name} - ${reason}`, () => {
    let failed = false;
    try { fn(); } catch (e) { failed = true; }
    if (!failed) throw new Error('This now passes - convert it to a regular test()');
  });

const cfg = (f) => require(path.join(__dirname, '..', 'config', f));
const ds = cfg('departmentStructure');
const rq = cfg('requisitionApprovalChain');
const cash = cfg('cashRequestApprovalChain');
const itChain = cfg('itSupportApprovalChain');

const lc = (s) => String(s || '').toLowerCase().trim();
const emailsOf = (chain) => chain.map((s) => lc((s.approver || s).email));

// flatten the main structure
const people = [];
for (const [dept, d] of Object.entries(ds.DEPARTMENT_STRUCTURE)) {
  people.push({ dept, ...d.head, isHead: true });
  for (const [position, p] of Object.entries(d.positions || {})) people.push({ dept, position, ...p });
}

const PRESIDENT = 'kelvin.eyong@gratoglobal.com';
const CEO = 'tom@gratoengineering.com';

// ---------------------------------------------------------------------------
// Structure integrity (config/departmentStructure.js)
// ---------------------------------------------------------------------------
test('structure: every reportsTo points at someone who exists', () => {
  const known = new Set(people.map((p) => lc(p.email)));
  const dangling = people.filter((p) => p.reportsTo && !known.has(lc(p.reportsTo)));
  expect(dangling.map((p) => [p.email, p.reportsTo])).toEqual([]);
});

test('structure: no reporting cycles', () => {
  const byEmail = new Map(people.map((p) => [lc(p.email), p]));
  for (const p of people) {
    const seen = new Set([lc(p.email)]);
    let cur = p;
    while (cur && cur.reportsTo) {
      const next = byEmail.get(lc(cur.reportsTo));
      if (!next) break;
      expect(seen.has(lc(next.email))).toBe(false);
      seen.add(lc(next.email));
      cur = next;
    }
  }
});

knownDefect('structure: each email appears only once', 'rodrigue.nono@ and kelvin.eyong@ are listed twice (head of one dept and a position in another)', () => {
  const emails = people.map((p) => lc(p.email));
  const dupes = emails.filter((e, i) => emails.indexOf(e) !== i);
  expect([...new Set(dupes)]).toEqual([]);
});

// ---------------------------------------------------------------------------
// Single source of truth
// ---------------------------------------------------------------------------
test('requisition chain can see everyone in the main structure', quiet(() => {
  const missing = people.filter((p) => !rq.findPersonByEmail(p.email)).map((p) => p.email);
  expect(missing).toEqual([]);
}));

test('requisition: a person missing from the legacy copy now follows their real supervisors', quiet(() => {
  // che.ernest / ndessop.boris are only in departmentStructure.js
  const chain = emailsOf(rq.getApprovalChainForRequisition('ndessop.boris@gratoglobal.com', 100000));
  expect(chain[0]).toBe('bechem.mbu@gratoglobal.com');
  expect(chain[chain.length - 1]).toBe(PRESIDENT);
}));

// ---------------------------------------------------------------------------
// Reporting line
// ---------------------------------------------------------------------------
test('department line: coordinator reports up to dept head then president', quiet(() => {
  const chain = emailsOf(ds.getApprovalChainFromStructure('bechem.mbu@gratoglobal.com'));
  expect(chain).toEqual(['didier.oyong@gratoglobal.com', PRESIDENT]);
}));

test('department line: unknown email yields an empty line, not an exception', quiet(() => {
  expect(ds.getApprovalChainFromStructure('nobody@example.com')).toEqual([]);
}));

// ---------------------------------------------------------------------------
// Purchase requisition
// ---------------------------------------------------------------------------
test('requisition: below the CEO threshold the chain stops at the President', quiet(() => {
  const chain = emailsOf(rq.getApprovalChainForRequisition('bechem.mbu@gratoglobal.com', 100000));
  expect(chain[chain.length - 1]).toBe(PRESIDENT);
  expect(chain).not.toContain(CEO);
}));

test('requisition: at or above 500,000 XAF the CEO is the last approver', quiet(() => {
  for (const amount of [500000, 5000000]) {
    const chain = emailsOf(rq.getApprovalChainForRequisition('bechem.mbu@gratoglobal.com', amount));
    expect(chain[chain.length - 1]).toBe(CEO);
  }
}));

test('requisition: unknown amount requires the CEO as a precaution', quiet(() => {
  const chain = emailsOf(rq.getApprovalChainForRequisition('bechem.mbu@gratoglobal.com', null));
  expect(chain[chain.length - 1]).toBe(CEO);
}));

test('requisition: finance verification comes before supply chain, then President', quiet(() => {
  const chain = rq.getApprovalChainForRequisition('bechem.mbu@gratoglobal.com', 100000);
  const roles = chain.map((s) => s.approver.role);
  const fin = roles.findIndex((r) => /Finance/.test(r));
  const sc = roles.findIndex((r) => /Supply Chain/.test(r));
  const pres = roles.findIndex((r) => /Head of Business/.test(r));
  expect(fin).toBeGreaterThanOrEqual(0);
  expect(fin).toBeLessThan(sc);
  expect(sc).toBeLessThan(pres);
}));

test('requisition: unknown employee still gets a usable default chain', quiet(() => {
  const chain = rq.getApprovalChainForRequisition('nobody@example.com', 100000);
  expect(chain.length).toBeGreaterThanOrEqual(3);
}));

test('requisition: no approver appears twice in a chain', quiet(() => {
  for (const email of ['bechem.mbu@gratoglobal.com', 'verla.ivo@gratoengineering.com']) {
    const e = emailsOf(rq.getApprovalChainForRequisition(email, 5000000));
    expect(new Set(e).size).toBe(e.length);
  }
}));

// ---------------------------------------------------------------------------
// Cash request
// ---------------------------------------------------------------------------
test('cash: travel requests include HR, plain expenses do not', quiet(() => {
  const hasHR = (type) => cash.getCashRequestApprovalChain('ndessop.boris@gratoglobal.com', type, 50000)
    .some((s) => /HR/.test(s.approver.role));
  expect(hasHR('travel')).toBe(true);
  expect(hasHR('expense')).toBe(false);
}));

test('cash: Head of Business is the final approver below the CEO threshold', quiet(() => {
  const chain = cash.getCashRequestApprovalChain('ndessop.boris@gratoglobal.com', 'expense', 50000);
  expect(lc(chain[chain.length - 1].approver.email)).toBe(PRESIDENT);
}));

test('cash: a Finance Officer step is always present', quiet(() => {
  const chain = cash.getCashRequestApprovalChain('ndessop.boris@gratoglobal.com', 'expense', 50000);
  expect(chain.some((s) => /Finance/.test(s.approver.role))).toBe(true);
}));

test('cash: unknown employee gets the fallback chain, not an empty one', quiet(() => {
  expect(cash.getCashRequestApprovalChain('nobody@example.com', 'expense', 50000).length).toBeGreaterThan(0);
}));

// ---------------------------------------------------------------------------
// IT support
// ---------------------------------------------------------------------------
test('IT support: chain ends at CEO final authority', quiet(() => {
  const chain = emailsOf(itChain.getITSupportApprovalChain('ndessop.boris@gratoglobal.com'));
  expect(chain[chain.length - 1]).toBe(CEO);
}));

knownDefect('IT support: no approver appears twice', 'for a CEO-Office employee the CEO is added at level 1 (as dept head) and again as final authority', quiet(() => {
  const e = emailsOf(itChain.getITSupportApprovalChain('che.ernest@gratoglobal.com'));
  expect(new Set(e).size).toBe(e.length);
}));

// ---------------------------------------------------------------------------
// Runtime structure (people registered from the IT console)
// ---------------------------------------------------------------------------
test('runtime structure: a registered person is found by the lookups', quiet(() => {
  const dyn = cfg('dynamicStructure');
  // seed the in-memory cache the same way refresh() does
  dyn._testSeed && dyn._testSeed([{ email: 'new.hire@gratoglobal.com', name: 'New Hire', department: 'Technical', position: 'Technician', reportsTo: 'bechem.mbu@gratoglobal.com', hierarchyLevel: 1, approvalAuthority: 'staff' }]);
  const found = ds.findPersonByEmail('new.hire@gratoglobal.com');
  expect(found && found.reportsTo).toBe('bechem.mbu@gratoglobal.com');
  const line = emailsOf(ds.getApprovalChainFromStructure('new.hire@gratoglobal.com'));
  expect(line[0]).toBe('bechem.mbu@gratoglobal.com');
}));

// ---------------------------------------------------------------------------
// Org-structure editor overrides
// ---------------------------------------------------------------------------
describe('structure overrides (admin editor)', () => {
  const dyn = cfg('dynamicStructure');
  afterEach(() => dyn._testSeed([]));

  test('an edited base person follows the new supervisor in every chain', quiet(() => {
    // Move bechem.mbu from reporting to didier.oyong to reporting straight to the President.
    dyn._testSeed([{
      email: 'bechem.mbu@gratoglobal.com', name: 'Mr. Ovo Bechem', department: 'Technical', position: 'HSE Coordinator',
      reportsTo: PRESIDENT, hierarchyLevel: 3, approvalAuthority: 'coordinator', source: 'base', edited: true
    }]);
    expect(emailsOf(ds.getApprovalChainFromStructure('bechem.mbu@gratoglobal.com'))).toEqual([PRESIDENT]);
    // requisition lookup (which has its own legacy copy first) must honour the override too
    expect(rq.findPersonByEmail('bechem.mbu@gratoglobal.com').reportsTo).toBe(PRESIDENT);
    // and people reporting to him are unaffected
    expect(emailsOf(ds.getApprovalChainFromStructure('ndessop.boris@gratoglobal.com'))[0]).toBe('bechem.mbu@gratoglobal.com');
  }));

  test('an imported-but-unedited base copy changes nothing', quiet(() => {
    dyn._testSeed([{
      email: 'bechem.mbu@gratoglobal.com', name: 'x', department: 'Technical', position: 'x',
      reportsTo: PRESIDENT, hierarchyLevel: 3, source: 'base', edited: false
    }]);
    expect(emailsOf(ds.getApprovalChainFromStructure('bechem.mbu@gratoglobal.com')))
      .toEqual(['didier.oyong@gratoglobal.com', PRESIDENT]);
  }));

  test('a runtime person can be a supervisor for another runtime person', quiet(() => {
    dyn._testSeed([
      { email: 'lead@gratoglobal.com', name: 'Lead', department: 'Technical', position: 'Lead', reportsTo: 'bechem.mbu@gratoglobal.com', hierarchyLevel: 2, source: 'runtime' },
      { email: 'junior@gratoglobal.com', name: 'Junior', department: 'Technical', position: 'Tech', reportsTo: 'lead@gratoglobal.com', hierarchyLevel: 1, source: 'runtime' }
    ]);
    expect(emailsOf(ds.getApprovalChainFromStructure('junior@gratoglobal.com')).slice(0, 2))
      .toEqual(['lead@gratoglobal.com', 'bechem.mbu@gratoglobal.com']);
  }));
});
