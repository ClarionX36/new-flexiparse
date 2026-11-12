function parseResult(text) {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let result;
  try {
    result = JSON.parse(cleaned);
  } catch (error) {
    throw Object.assign(new Error('AI did not return a valid table. Please try again.'), { status: 502 });
  }
  if (!result || !Array.isArray(result.headers) || !Array.isArray(result.rows)) {
    throw Object.assign(new Error('AI did not return a valid table. Please try again.'), { status: 502 });
  }
  const headers = result.headers.slice(0, 100).map((value) => String(value ?? '').slice(0, 255));
  if (!headers.length) throw Object.assign(new Error('AI could not find any table columns. Please try a different document.'), { status: 422 });
  const rows = result.rows.slice(0, 10000).map((row) => {
    const values = Array.isArray(row) ? row : [row];
    return headers.map((_, index) => String(values[index] ?? '').slice(0, 5000));
  });
  return { title: String(result.title || 'Extraction results').slice(0, 255), headers, rows };
}

function csvEscape(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

module.exports = { parseResult, csvEscape };
