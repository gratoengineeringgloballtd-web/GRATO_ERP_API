const ExcelJS = require('exceljs');
const path = require('path');

const run = async () => {
    const filePath = 'c:\\Users\\IT OFFICER\\Downloads\\GRATO Portfolio UPDATE.csv';
    const workbook = new ExcelJS.Workbook();
    await workbook.csv.readFile(filePath);
    const worksheet = workbook.getWorksheet(1);
    
    console.log(`Total Rows: ${worksheet.rowCount}`);
    
    for(let i=1; i<=5; i++) {
        const row = worksheet.getRow(i);
        console.log(`Row ${i} Values:`, JSON.stringify(row.values).substring(0, 150) + "...");
    }

    const headerRow = worksheet.getRow(3);
    const headers = [];
    headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        headers[colNumber - 1] = cell.text; 
    });

    console.log('\n--- Header Analysis ---');
    const checkHeader = (pattern) => {
        const exact = headers.findIndex(h => h === pattern);
        const fuzzy = headers.findIndex(h => h && h.toLowerCase().includes(pattern.toLowerCase()));
        console.log(`"${pattern}": Exact=${exact}, Fuzzy=${fuzzy} (${fuzzy !== -1 ? headers[fuzzy] : 'None'})`);
    };

    checkHeader('DG brand');
    checkHeader('DG Serial Number');
    checkHeader('DG KVA Update');
    checkHeader('DG2 brand');
    checkHeader('DG2 Serial Number');
    const getVal = (row, headers, pattern) => {
         const headerIndex = headers.findIndex(h => h && h.toLowerCase().includes(pattern.toLowerCase()));
         if (headerIndex === -1) return "NOT FOUND";
         // ExcelJS row.getCell uses 1-based index. headerIndex is 0-based from col 1.
         // So col is headerIndex + 1.
         return row.getCell(headerIndex + 1).value;
    };

    console.log('\n--- Row 4 Data Check ---');
    const row4 = worksheet.getRow(4);
    const checks = ['DG brand', 'DG Serial Number', 'DG KVA Update', 'DG2 brand'];
    checks.forEach(c => {
        console.log(`${c}: ${JSON.stringify(getVal(row4, headers, c))}`);
    });
};

run();