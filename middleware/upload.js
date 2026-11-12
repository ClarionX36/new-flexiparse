const multer = require('multer');
const path = require('path');

const maxBytes = Number(process.env.MAX_UPLOAD_MB || 15) * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxBytes, files: 1 },
  fileFilter: (req, file, callback) => {
    const allowed = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
    if (!allowed.has(file.mimetype) || path.basename(file.originalname).length > 255) {
      return callback(new Error('Files must be PDF, JPG, PNG, or WEBP.'));
    }
    return callback(null, true);
  }
});

function verifyFileSignature(req, res, next) {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'Choose a PDF or image file first.' });
  const bytes = file.buffer;
  const isPdf = bytes.subarray(0, 5).toString() === '%PDF-';
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isWebp = bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  if (!(isPdf || isJpeg || isPng || isWebp)) {
    return res.status(400).json({ error: 'The file contents do not match a supported PDF or image format.' });
  }
  file.detectedMime = isPdf ? 'application/pdf' : isJpeg ? 'image/jpeg' : isPng ? 'image/png' : 'image/webp';
  return next();
}

module.exports = { upload, verifyFileSignature };
