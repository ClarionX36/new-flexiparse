const { GoogleGenAI } = require('@google/genai');

function getClient() {
  if (!process.env.GEMINI_API_KEY) {
    throw Object.assign(
      new Error('Ekstraksi dokumen belum dikonfigurasi. Admin perlu mengisi GEMINI_API_KEY di cPanel.'),
      { status: 503, expose: true }
    );
  }
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

async function extractDocument(buffer, mimeType) {
  const ai = getClient();
  const response = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    contents: [{
      role: 'user',
      parts: [
        {
          text: 'Extract all useful tabular data from this document. Return only valid JSON with this shape: {"title":"short descriptive title","headers":["Column 1"],"rows":[["value"]]}. Include all tables in a consistent set of columns where practical. Preserve values as text, use an empty string for missing cells, and do not invent data. If there are no tables, return the document content as a table with headers ["Content"] and one row per meaningful line.'
        },
        { inlineData: { mimeType, data: buffer.toString('base64') } }
      ]
    }],
    config: { responseMimeType: 'application/json' }
  });
  return response.text;
}

module.exports = { extractDocument };
