/**
 * Pure payroll calculation (no DB). Amounts are XAF, rounded to whole francs.
 * All rates come from the PayrollRate document so they can be edited without a deploy.
 */
const DEFAULT_RATES = {
  cnpsCeiling: 750000,            // monthly CNPS ceiling
  employeePensionRate: 2.8,       // % of capped base
  employerPensionRate: 4.2,
  familyAllowanceRate: 7,         // employer, capped base
  workAccidentRate: 1.75,         // employer, capped base
  cfcEmployeeRate: 1,             // Credit Foncier, % of gross
  cfcEmployerRate: 1.5,
  fneEmployerRate: 1,             // National Employment Fund, employer
  cacRate: 10,                    // communal surtax, % of IRPP
  professionalAbatementRate: 30,  // % of annual gross
  annualFixedAbatement: 500000,
  irppBrackets: [
    { upTo: 2000000, rate: 10 },
    { upTo: 3000000, rate: 15 },
    { upTo: 5000000, rate: 25 },
    { upTo: null, rate: 35 }
  ]
};

const rnd = (v) => Math.round(Number(v) || 0);
const num = (v) => Number(v) || 0;

function annualIrpp(taxable, brackets) {
  let tax = 0;
  let prev = 0;
  const list = (brackets && brackets.length ? brackets : DEFAULT_RATES.irppBrackets)
    .slice()
    .sort((a, b) => (a.upTo == null ? Infinity : a.upTo) - (b.upTo == null ? Infinity : b.upTo));
  for (const b of list) {
    const top = b.upTo == null ? Infinity : b.upTo;
    if (taxable > prev) {
      tax += (Math.min(taxable, top) - prev) * (num(b.rate) / 100);
    }
    prev = top;
    if (taxable <= top) break;
  }
  return tax;
}

/**
 * profile: { baseSalary, allowances:[{name,amount,taxable,cnpsable}], fixedDeductions:[{name,amount}] }
 * adjustments: [{label,type:'earning'|'deduction',amount}]
 * options: { exemptCnps, exemptTax }
 */
function computePayslip(profile, adjustments = [], ratesIn = {}) {
  const r = { ...DEFAULT_RATES, ...(ratesIn || {}) };
  const base = rnd(profile.baseSalary);
  const allowances = (profile.allowances || []).map((a) => ({
    name: a.name, amount: rnd(a.amount), taxable: a.taxable !== false, cnpsable: a.cnpsable !== false
  }));
  const earnings = (adjustments || []).filter((a) => a.type !== 'deduction')
    .map((a) => ({ label: a.label, amount: rnd(a.amount) }));
  const adjDeductions = (adjustments || []).filter((a) => a.type === 'deduction')
    .map((a) => ({ name: a.label, amount: rnd(a.amount) }));

  const allowTotal = allowances.reduce((s, a) => s + a.amount, 0);
  const earnTotal = earnings.reduce((s, a) => s + a.amount, 0);
  const gross = base + allowTotal + earnTotal;

  const taxableGross = base + allowances.filter((a) => a.taxable).reduce((s, a) => s + a.amount, 0) + earnTotal;
  const cnpsGross = base + allowances.filter((a) => a.cnpsable).reduce((s, a) => s + a.amount, 0) + earnTotal;
  const cnpsBase = Math.min(cnpsGross, num(r.cnpsCeiling) || Infinity);

  const cnpsEmployee = profile.exemptCnps ? 0 : rnd(cnpsBase * num(r.employeePensionRate) / 100);
  const cfcEmployee = rnd(taxableGross * num(r.cfcEmployeeRate) / 100);

  let irpp = 0;
  let cac = 0;
  if (!profile.exemptTax) {
    const annual = taxableGross * 12;
    const taxableAnnual = Math.max(
      0,
      annual - annual * num(r.professionalAbatementRate) / 100 - num(r.annualFixedAbatement) - cnpsEmployee * 12
    );
    irpp = rnd(annualIrpp(taxableAnnual, r.irppBrackets) / 12);
    cac = rnd(irpp * num(r.cacRate) / 100);
  }

  const fixed = (profile.fixedDeductions || []).map((d) => ({ name: d.name, amount: rnd(d.amount) }));
  const recoveries = [...fixed, ...adjDeductions];
  const recoveryTotal = recoveries.reduce((s, d) => s + d.amount, 0);

  const totalDeductions = cnpsEmployee + irpp + cac + cfcEmployee + recoveryTotal;
  const netPay = gross - totalDeductions;

  const employer = {
    pension: profile.exemptCnps ? 0 : rnd(cnpsBase * num(r.employerPensionRate) / 100),
    family: profile.exemptCnps ? 0 : rnd(cnpsBase * num(r.familyAllowanceRate) / 100),
    accident: profile.exemptCnps ? 0 : rnd(cnpsBase * num(r.workAccidentRate) / 100),
    cfc: rnd(taxableGross * num(r.cfcEmployerRate) / 100),
    fne: rnd(taxableGross * num(r.fneEmployerRate) / 100)
  };
  employer.total = employer.pension + employer.family + employer.accident + employer.cfc + employer.fne;

  return {
    base, allowances, earnings, gross, taxableGross, cnpsBase,
    cnpsEmployee, irpp, cac, cfcEmployee, recoveries, recoveryTotal,
    totalDeductions, netPay, employer, employerCost: gross + employer.total
  };
}

/** Totals + the balanced journal lines (by account role) for a set of computed lines. */
function summarize(lines) {
  const t = {
    gross: 0, net: 0, cnpsEmployee: 0, irpp: 0, cac: 0, cfcEmployee: 0, recoveryTotal: 0,
    employerPension: 0, employerFamily: 0, employerAccident: 0, employerCfc: 0, employerFne: 0,
    employerTotal: 0, employerCost: 0
  };
  for (const l of lines) {
    t.gross += l.gross; t.net += l.netPay; t.cnpsEmployee += l.cnpsEmployee; t.irpp += l.irpp;
    t.cac += l.cac; t.cfcEmployee += l.cfcEmployee; t.recoveryTotal += l.recoveryTotal;
    t.employerPension += l.employer.pension; t.employerFamily += l.employer.family;
    t.employerAccident += l.employer.accident; t.employerCfc += l.employer.cfc; t.employerFne += l.employer.fne;
    t.employerTotal += l.employer.total; t.employerCost += l.employerCost;
  }
  return t;
}

function postingAmounts(t) {
  const cnps = t.cnpsEmployee + t.employerPension + t.employerFamily + t.employerAccident;
  return {
    debitSalaries: t.gross,
    debitCharges: t.employerTotal,
    creditNet: t.net,
    creditCnps: cnps,
    creditIncomeTax: t.irpp + t.cac,
    creditOtherTaxes: t.cfcEmployee + t.employerCfc + t.employerFne,
    creditRecoveries: t.recoveryTotal
  };
}

module.exports = { DEFAULT_RATES, computePayslip, summarize, postingAmounts, annualIrpp };
