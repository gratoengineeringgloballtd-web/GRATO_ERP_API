const mongoose = require('mongoose');

async function fixBudgetCode() {
  try {
    await mongoose.connect('mongodb+srv://marcelngong50:dp1d6ABP6ggkvQli@cluster0.9nhviyl.mongodb.net/');
    
    const BudgetCode = mongoose.model('BudgetCode', new mongoose.Schema({}, { strict: false }));
    
    // Fix DEPT-IT-2027 specifically
    const result = await BudgetCode.updateOne(
      { code: 'DEPT-IT-2027' },
      {
        $set: { 
          budgetType: 'OPERATIONAL',
          allocations: [],
          used: 0
        }
      }
    );
    
    console.log('Fixed:', result);
    
    // Fix all invalid types
    await BudgetCode.updateMany(
      { budgetType: { $nin: ['OPEX', 'CAPEX', 'PROJECT', 'OPERATIONAL'] } },
      { $set: { budgetType: 'OPERATIONAL' } }
    );
    
    // Remove invalid allocations
    await BudgetCode.updateMany(
      {},
      { $pull: { allocations: { amount: { $exists: false } } } }
    );
    
    console.log('All budget codes fixed!');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

fixBudgetCode();