# Data Migration Fix: Duplicate Material Codes Issue

## Problem
When migrating 300+ items, only 234 items appeared in the database. The remaining ~70 items were "lost" during migration.

## Root Cause
The migration logic checks if an item with the same **Material Code** already exists:
- If a match is found → Update existing item (increment `updated` counter)
- If no match → Create new item (increment `imported` counter)

**Your Excel file contained duplicate material codes.** When processing:
- Row 5: Material Code "IT-001" → Creates new item
- Row 50: Material Code "IT-001" → Finds existing item and UPDATES it
- Result: 1 item in database instead of 2 items

This is why: `imported (234) + updated (~70) = 300+` total rows processed, but only 234 unique items in DB.

## Solution Applied

### Backend Changes (`migrationController.js`)
Enhanced the `migrateAvailableStock` function to:

1. **Detect duplicate codes within the upload**
   - Track codes as they're processed
   - Warn about duplicates found in the same upload

2. **Return detailed results** including:
   - `imported`: New items created
   - `updated`: Existing items updated  
   - `updated_items`: List of what was updated with before/after stock values
   - `duplicateCodesInUpload`: Array of all duplicate codes found
   - `warnings`: Messages about duplicates detected

3. **Enhanced logging** to show which rows contain duplicate codes

### Frontend Changes
Created new component `MigrationResultsDetail.js` to display:
- Summary statistics (created, updated, failed, warnings)
- Warning section highlighting duplicate codes
- Details of which rows had duplicates
- Recommendation to clean source data

## How to Prevent This Going Forward

### 1. Clean Your Source Data
Before migration, ensure each **Material Code** appears only once in your Excel file:
```
Material Code | Description | Category | Qty
IT-001       | Wireless Mouse | Accessories | 100  ← Keep this
IT-001       | Wireless Mouse | Accessories | 50   ← Delete this duplicate
```

### 2. Use Data Validation in Excel
- Add a pivot table to find duplicates
- Use conditional formatting to highlight duplicate codes
- Sort by Material Code and visually scan for repeats

### 3. Monitor Migration Results
After each migration, check:
- How many items were **imported** (new)
- How many were **updated** (already existed)
- How many **warnings** were generated
- If `updated` count is suspiciously high, check for duplicates

## Re-Migration Instructions

If you need to re-migrate with duplicate-cleaned data:

1. **Export current items** (optional backup)
2. **Clean your Excel file**:
   - Remove duplicate Material Codes
   - Keep only the most recent/complete version of each item
3. **Upload and migrate again**
4. The new items will be created, existing items updated

## Example Result Output

```json
{
  "success": true,
  "data": {
    "imported": 234,
    "updated": 0,
    "failed": 2,
    "warnings": [],
    "duplicateCodesInUpload": [],
    "created": [...],
    "updated_items": [...]
  }
}
```

In this case:
- ✅ 234 new items created
- ✅ No items updated
- ⚠️ 2 rows failed (check errors)
- ✅ No duplicates detected in upload

---

**Note:** The migration system intentionally updates rather than skips duplicates to avoid data loss. Always validate your source data before migration.
