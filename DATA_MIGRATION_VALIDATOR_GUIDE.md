# Data Migration Validator - Quick Start Guide

## What is the Data Migration Validator?

The Data Migration Validator is a tool that **analyzes your Excel file BEFORE migration** to detect and fix duplicate material codes. This prevents data loss during import.

---

## Access the Tool

### Method 1: Direct URL (Fastest)
Navigate to:
```
http://localhost:3000/supply-chain/data-migration-validator
```

### Method 2: Through Navigation
1. Log in to your ERP system
2. Go to **Supply Chain** section
3. Look for **Data Migration Validator** in the menu (or use search)

---

## Step-by-Step Process

### Step 1: Upload Your Excel File
1. Click **"Select Excel File"**
2. Choose your `available_stock.xlsx` file (the one with 329 rows)
3. Wait for it to load and analyze

### Step 2: Review Analysis Results
You'll see statistics like:
- **Total Rows**: 329
- **Unique Codes**: 234 ← This is the problem!
- **Duplicate Codes**: ~95
- **Duplicate Rows**: ~95

A table will show all duplicate material codes with:
- Material code
- How many times it appears
- Which rows contain it
- Descriptions

### Step 3: Fix Duplicates (Choose One Option)

#### ✅ **Option A: Auto-Generate Cleaned File (RECOMMENDED)**
1. Click **"Generate Cleaned File (Keep First)"**
2. A new Excel file downloads automatically
3. This file keeps only the first occurrence of each duplicate
4. Result: 234 unique items (clean!)

**Then:**
5. Upload the cleaned file to **Data Migration** 
6. Run the migration normally
7. Result: 234 new items created ✓

---

#### Option B: Download Report and Fix Manually
1. Click **"Download Duplicates Report"**
2. Get an Excel file listing all duplicates
3. Open your original file and manually remove or consolidate duplicates
4. Re-upload to validator to confirm it's fixed
5. Then migrate as normal

---

#### Option C: Keep All 329 as Separate Items (Advanced)
If you actually want all 329 items including duplicates with different values:
1. Download cleaned file with **"Keep First"** option
2. Manually add back variants with modified codes:
   - `IT-001` (first occurrence)
   - `IT-001-V2` (second occurrence - you add this manually)
   - `IT-001-V3` (third occurrence - you add this manually)
3. Rename the Material Code column for duplicates
4. Then migrate using special `mode: 'create-new'` (contact support for this)

---

## What Happens After Cleaning?

### If you use the Auto-Cleaned File:
```
Original Upload: 329 rows
  ↓
Analysis: 234 unique codes + 95 duplicates
  ↓
Cleaned File: 234 rows (duplicates removed, first kept)
  ↓
Migration: 234 items created successfully ✓
```

### Result in Inventory:
- Total Items: 234 (unique)
- All items have different material codes
- Stock data is preserved from the first occurrence
- Ready for operational use

---

## FAQ

**Q: Will I lose data by removing duplicates?**
A: No! The validator keeps the first occurrence of each code. If duplicates had different data, they were likely data errors. You can review the duplicates report before deleting.

**Q: What if the duplicates have different stock quantities?**
A: The cleaned file keeps the FIRST occurrence. You can:
1. Download the duplicates report to see what data you're keeping
2. Manually edit the cleaned file if you need different values
3. Or choose the occurrence with the most important data and mark it as first

**Q: Can I merge the duplicate quantities instead?**
A: For now, the validator doesn't auto-sum. You'll need to:
1. Download the duplicates report
2. Manually calculate/edit your Excel file
3. Then upload the modified file

**Q: My cleaned file is still showing warnings?**
A: Upload it again to the validator to confirm. If still warnings, check for:
- Different casing (IT-001 vs it-001)
- Extra spaces
- Special characters

---

## Common Issues & Solutions

| Issue | Solution |
|-------|----------|
| "File failed to upload" | Ensure file is `.xlsx` (not `.xls` or CSV) |
| "Still showing duplicates" | The file has codes that differ only in spaces/casing. Clean in Excel first. |
| "Analysis won't complete" | Try with a smaller test file (10 rows) to verify format |
| "Download not working" | Try a different browser or clear cache |

---

## Next Steps

1. **Now**: Upload your current Excel file to validator
2. **Download**: The auto-cleaned file
3. **Go to**: Supply Chain → Data Migration
4. **Upload**: The cleaned file
5. **Run Migration**: Should create 234 items ✓

---

## Support

If the validator doesn't work or you have issues:
1. Check browser console for errors (F12 → Console)
2. Ensure your Excel has correct column headers:
   - `Material Code`
   - `Material Name`
   - `Category`
   - `UOM`
   - `ON HAND`
   - etc.

---

**Good luck! The validator should solve your duplicate problem in minutes.** 🚀
