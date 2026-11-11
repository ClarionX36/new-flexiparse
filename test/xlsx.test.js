const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');

test('ExcelJS produces a valid XLSX archive with tabular rows', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Extracted data');
  sheet.addRow(['Item', 'Qty']);
  sheet.addRow(['Pen', '2']);

  const output = await workbook.xlsx.writeBuffer();
  assert.equal(output.subarray(0, 2).toString(), 'PK');
  assert.ok(output.length > 1000);
});
