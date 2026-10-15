/**
 * SYSCOHADA (revised, 2018) chart of accounts - working subset for XAF books.
 * Compact row format: [code, name, subType?, overrides?]
 *   type / normalBalance are derived from the code (see deriveType); override when needed.
 * Add more accounts any time from the Accounts screen; this is only the seed.
 */

const ROWS = [
  // Class 1 - Resources
  ['101', 'Capital social'], ['104', 'Primes liees au capital social'], ['105', 'Ecarts de reevaluation'],
  ['111', 'Reserve legale'], ['112', 'Reserves statutaires'], ['118', 'Autres reserves'],
  ['121', 'Report a nouveau crediteur'], ['129', 'Report a nouveau debiteur'],
  ['131', 'Resultat net de l\'exercice : benefice'], ['139', 'Resultat net de l\'exercice : perte'],
  ['141', 'Subventions d\'equipement'],
  ['162', 'Emprunts et dettes aupres des etablissements de credit'], ['165', 'Depots et cautionnements recus'],
  ['168', 'Autres emprunts et dettes'], ['191', 'Provisions pour litiges'],
  // Class 2 - Fixed assets
  ['212', 'Brevets, licences, concessions'], ['213', 'Logiciels et sites internet'],
  ['221', 'Terrains'], ['231', 'Batiments industriels, agricoles, administratifs'], ['237', 'Amenagements et agencements'],
  ['241', 'Materiel et outillage industriel'], ['244', 'Materiel et mobilier'], ['2441', 'Materiel de bureau'],
  ['2444', 'Materiel informatique'], ['2445', 'Mobilier de bureau'], ['245', 'Materiel de transport'],
  ['251', 'Avances et acomptes verses sur immobilisations'], ['271', 'Prets et creances non commerciales'],
  ['275', 'Depots et cautionnements verses'],
  ['281', 'Amortissements des immobilisations incorporelles'], ['283', 'Amortissements des batiments et installations'],
  ['284', 'Amortissements du materiel'],
  // Class 3 - Stocks
  ['311', 'Marchandises'], ['321', 'Matieres premieres et fournitures liees'], ['331', 'Autres approvisionnements'],
  ['391', 'Depreciations des stocks', null, { type: 'asset', normalBalance: 'credit' }],
  // Class 4 - Third parties
  ['4011', 'Fournisseurs'], ['4081', 'Fournisseurs, factures non parvenues'], ['409', 'Fournisseurs debiteurs : avances et acomptes', null, { type: 'asset', normalBalance: 'debit' }],
  ['4111', 'Clients'], ['4181', 'Clients, factures a etablir'], ['419', 'Clients crediteurs : avances recues', null, { type: 'liability', normalBalance: 'credit' }],
  ['4211', 'Personnel, avances et acomptes'], ['422', 'Personnel, remunerations dues'],
  ['431', 'Securite sociale (CNPS)'],
  ['441', 'Etat, impot sur les benefices'], ['4431', 'Etat, TVA facturee sur ventes'], ['4441', 'Etat, TVA due'],
  ['4451', 'Etat, TVA recuperable sur immobilisations'], ['4452', 'Etat, TVA recuperable sur achats'],
  ['4454', 'Etat, TVA recuperable sur services exterieurs'],
  ['447', 'Etat, impots retenus a la source'], ['4471', 'Impot general sur le revenu (IRPP)'],
  ['4472', 'Impots sur salaires'], ['448', 'Etat, charges a payer et produits a recevoir'],
  ['461', 'Associes, operations faites en commun'],
  ['4711', 'Debiteurs divers'], ['4712', 'Crediteurs divers'],
  ['476', 'Charges constatees d\'avance', null, { type: 'asset', normalBalance: 'debit' }],
  ['477', 'Produits constates d\'avance', null, { type: 'liability', normalBalance: 'credit' }],
  ['491', 'Depreciations des comptes clients', null, { type: 'asset', normalBalance: 'credit' }],
  // Class 5 - Treasury
  ['521', 'Banques locales'], ['571', 'Caisse'], ['585', 'Virements de fonds'],
  // Class 6 - Expenses
  ['601', 'Achats de marchandises'], ['602', 'Achats de matieres premieres et fournitures liees'],
  ['604', 'Achats stockes de matieres et fournitures consommables'], ['605', 'Autres achats'],
  ['611', 'Transports sur achats'], ['612', 'Transports sur ventes'], ['614', 'Transports du personnel'],
  ['618', 'Autres frais de transport'],
  ['621', 'Sous-traitance generale'], ['622', 'Locations et charges locatives'],
  ['624', 'Entretien, reparations et maintenance'], ['625', 'Primes d\'assurance'],
  ['626', 'Etudes, recherches et documentation'], ['627', 'Publicite, publications, relations publiques'],
  ['628', 'Frais de telecommunications'],
  ['631', 'Frais bancaires'], ['632', 'Remunerations d\'intermediaires et de conseils'],
  ['633', 'Frais de formation du personnel'], ['635', 'Cotisations'], ['637', 'Remunerations du personnel exterieur'],
  ['638', 'Autres charges externes'],
  ['641', 'Impots et taxes directs'], ['646', 'Droits d\'enregistrement'], ['658', 'Charges diverses'],
  ['661', 'Remunerations directes versees au personnel national'],
  ['663', 'Indemnites forfaitaires versees au personnel'], ['664', 'Charges sociales'],
  ['671', 'Interets des emprunts'], ['676', 'Pertes de change'],
  ['681', 'Dotations aux amortissements d\'exploitation'], ['691', 'Dotations aux provisions d\'exploitation'],
  // Class 7 - Revenue
  ['701', 'Ventes de marchandises'], ['702', 'Ventes de produits finis'], ['705', 'Travaux factures'],
  ['706', 'Services vendus'], ['707', 'Produits accessoires'], ['758', 'Produits divers'],
  ['771', 'Interets de prets'], ['776', 'Gains de change'], ['791', 'Reprises de provisions d\'exploitation'],
  // Class 8 - Other activities
  ['811', 'Valeurs comptables des cessions d\'immobilisations'], ['821', 'Produits des cessions d\'immobilisations'],
  ['891', 'Impots sur les benefices de l\'exercice']
];

function deriveType(code) {
  const c = String(code);
  const k = Number(c[0]);
  if (k === 1) return /^(16|17|19)/.test(c) ? 'liability' : 'equity';
  if (k === 2 || k === 3 || k === 5) return 'asset';
  if (k === 4) {
    return /^(40|422|43|44[0-3]|4441|447|448|4712)/.test(c) ? 'liability' : 'asset';
  }
  if (k === 6) return 'expense';
  if (k === 7) return 'revenue';
  if (k === 8) return /^8[2468]/.test(c) ? 'revenue' : 'expense';
  return 'asset';
}

function deriveNormal(code, type) {
  const c = String(code);
  if (/^(28|29|39|49|59)/.test(c)) return 'credit';          // contra-assets
  if (/^(129|139)/.test(c)) return 'debit';                  // accumulated loss
  return (type === 'asset' || type === 'expense') ? 'debit' : 'credit';
}

function deriveSubType(code, type) {
  const c = String(code);
  if (type === 'asset') return /^[2]/.test(c) ? 'non_current_asset' : 'current_asset';
  if (type === 'liability') return /^(16|17|19)/.test(c) ? 'non_current_liability' : 'current_liability';
  if (type === 'equity') return 'equity';
  if (type === 'revenue') return /^(70)/.test(c) ? 'operating_revenue' : 'other_revenue';
  if (/^(60|61|62)/.test(c)) return /^(60)/.test(c) ? 'cost_of_sales' : 'operating_expense';
  if (/^(67|63[1])/.test(c)) return /^67/.test(c) ? 'financial_expense' : 'operating_expense';
  return 'operating_expense';
}

const SYSCOHADA_CHART = ROWS.map(([code, name, subType, o]) => {
  const type = (o && o.type) || deriveType(code);
  return {
    code, name, type,
    subType: subType || deriveSubType(code, type),
    normalBalance: (o && o.normalBalance) || deriveNormal(code, type)
  };
});

// Roles the posting engine and reports rely on -> SYSCOHADA account code.
const CODES = {
  CASH: '571', BANK: '521',
  AR: '4111', AP: '4011',
  VAT_RECEIVABLE: '4452', VAT_PAYABLE: '4431',
  WHT_PAYABLE: '447',
  STAFF_ADVANCES: '4211', ACCRUED_EXPENSES: '4081',
  FIXED_ASSETS: '244', ACCUM_DEPRECIATION: '284', DEPRECIATION_EXP: '681',
  EQUITY: '101', RETAINED_EARNINGS: '121', CURRENT_YEAR_EARNINGS: '131',
  SALES: '706', OTHER_REVENUE: '758',
  COST_OF_SERVICES: '621', SALARIES_EXP: '661', TRANSPORT_EXP: '618', ADMIN_EXP: '638',
  FX_LOSS: '676', FX_GAIN: '776'
};

// Old generic codes -> SYSCOHADA. Used by the one-time, idempotent migration.
const LEGACY_MAP = {
  '1000': CODES.CASH, '1010': CODES.BANK, '1100': CODES.AR, '1200': CODES.STAFF_ADVANCES,
  '1300': CODES.VAT_RECEIVABLE, '1500': CODES.FIXED_ASSETS, '1510': CODES.ACCUM_DEPRECIATION,
  '2000': CODES.AP, '2100': CODES.ACCRUED_EXPENSES, '2200': CODES.VAT_PAYABLE, '2300': CODES.WHT_PAYABLE,
  '3000': CODES.EQUITY, '3100': CODES.RETAINED_EARNINGS, '3200': CODES.CURRENT_YEAR_EARNINGS,
  '4000': CODES.SALES, '4100': CODES.OTHER_REVENUE,
  '5000': CODES.COST_OF_SERVICES, '5100': CODES.SALARIES_EXP, '5200': CODES.TRANSPORT_EXP,
  '5300': CODES.ADMIN_EXP, '5400': CODES.DEPRECIATION_EXP, '5500': CODES.FX_LOSS
};

// Default expense account for a supplier bill, by the invoice's service category.
// Anything not listed falls back to CODES.ADMIN_EXP (638).
const EXPENSE_BY_CATEGORY = {
  'HSE': '604',              // consumables / PPE
  'Refurbishment': '621',    // subcontracting
  'Project': '621',
  'Civil works': '621',
  'Rollout': '621',
  'Security': '621',
  'Operations': '624',       // maintenance and repairs
  'Diesel': '605',           // fuel and other purchases
  'Supply Chain': '611',     // transport on purchases
  'IT': '628',               // telecom / IT services
  'HR/Admin': '638',
  'General': '638'
};

module.exports = { SYSCOHADA_CHART, CODES, LEGACY_MAP, EXPENSE_BY_CATEGORY };
