const { computePayslip, summarize, postingAmounts, annualIrpp } = require('../services/payrollEngine');

describe('payroll engine', () => {
  test('IRPP brackets', () => {
    expect(annualIrpp(2000000)).toBe(200000);
    expect(annualIrpp(3000000)).toBe(350000);
    expect(annualIrpp(6000000)).toBe(350000 + 500000 + 350000);
  });

  test('payslip arithmetic', () => {
    const r = computePayslip({ baseSalary: 500000, allowances: [{ name: 'Transport', amount: 50000 }] }, []);
    expect(r.gross).toBe(550000);
    expect(r.cnpsEmployee).toBe(Math.round(550000 * 0.028));
    expect(r.netPay).toBe(r.gross - r.totalDeductions);
    expect(r.cac).toBe(Math.round(r.irpp * 0.1));
  });

  test('CNPS ceiling', () => {
    const r = computePayslip({ baseSalary: 2000000 }, []);
    expect(r.cnpsBase).toBe(750000);
    expect(r.cnpsEmployee).toBe(21000);
  });

  test('adjustments and recoveries', () => {
    const r = computePayslip({ baseSalary: 300000, fixedDeductions: [{ name: 'Loan', amount: 10000 }] },
      [{ label: 'Bonus', type: 'earning', amount: 50000 }, { label: 'Advance', type: 'deduction', amount: 5000 }]);
    expect(r.gross).toBe(350000);
    expect(r.recoveryTotal).toBe(15000);
  });

  test('exemptions', () => {
    const r = computePayslip({ baseSalary: 400000, exemptCnps: true, exemptTax: true }, []);
    expect(r.cnpsEmployee + r.irpp + r.cac).toBe(0);
    expect(r.employer.pension + r.employer.family).toBe(0);
  });

  test('posting balances', () => {
    const lines = [
      computePayslip({ baseSalary: 1234567, allowances: [{ name: 'A', amount: 33333 }], fixedDeductions: [{ name: 'L', amount: 777 }] }, []),
      computePayslip({ baseSalary: 250000 }, [{ label: 'OT', type: 'earning', amount: 12345 }]),
      computePayslip({ baseSalary: 90000, exemptTax: true }, [])
    ];
    const a = postingAmounts(summarize(lines));
    const debit = a.debitSalaries + a.debitCharges;
    const credit = a.creditNet + a.creditCnps + a.creditIncomeTax + a.creditOtherTaxes + a.creditRecoveries;
    expect(debit).toBe(credit);
  });
});
