const test = require('node:test');
const assert = require('node:assert/strict');
const { parseResult, csvEscape } = require('../utils/tabular');

test('parseResult normalizes and bounds tabular JSON', () => {
  const result = parseResult('{"title":"  Invoice  ","headers":["Item","Qty"],"rows":[["Pen",2]]}');
  assert.deepEqual(result, { title: '  Invoice  ', headers: ['Item', 'Qty'], rows: [['Pen', '2']] });
});

test('parseResult accepts fenced JSON from model responses', () => {
  const result = parseResult('```json\n{"headers":["A"],"rows":[["B"]]}\n```');
  assert.deepEqual(result, { title: 'Hasil ekstraksi', headers: ['A'], rows: [['B']] });
});

test('parseResult rejects invalid table shapes', () => {
  assert.throws(() => parseResult('{"headers":"not an array","rows":[]}'), /tabel valid/i);
  assert.throws(() => parseResult('{"headers":[],"rows":[]}'), /kolom/i);
});

test('parseResult pads short rows and ignores extra cells', () => {
  const result = parseResult('{"headers":["A","B"],"rows":[["one"],["x","y","z"]]}');
  assert.deepEqual(result.rows, [['one', ''], ['x', 'y']]);
});

test('CSV escaping prevents spreadsheet formula execution', () => {
  assert.equal(csvEscape('=1+1'), '"\'=1+1"');
  assert.equal(csvEscape('a,"b"'), '"a,""b"""');
});
