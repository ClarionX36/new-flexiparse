const db = require('../config/db');
const { PDFDocument } = require('pdf-lib');
const { parseResult, csvEscape } = require('../utils/tabular');
const { planLimits } = require('../utils/plans');
const { processQueueItem } = require('../queue/processor');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

async function getPageCount(file) {
  if (file.detectedMime !== 'application/pdf') return 1;
  try {
    const pdf = await PDFDocument.load(file.buffer, { ignoreEncryption: true });
    const pages = Math.max(pdf.getPageCount(), 1);
    if (pages > 100) throw Object.assign(new Error('PDF terlalu panjang. Batas maksimum adalah 100 halaman per file.'), { status: 413 });
    return pages;
  } catch (error) {
    if (error.status) throw error;
    throw Object.assign(new Error('PDF tidak dapat dibaca. Pastikan file tidak rusak atau terkunci.'), { status: 400 });
  }
}

async function checkQuota(req, res, next) {
  try {
    const [rows] = await db.execute(
      'SELECT plan_tier, subscription_status, monthly_quota_remaining, add_on_quota_remaining FROM users WHERE id = ?',
      [req.user.id]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Sesi pengguna tidak lagi aktif. Silakan masuk kembali.' });
    const plan = user?.subscription_status === 'active' ? user.plan_tier : 'free';
    const limits = planLimits[plan] || planLimits.free;
    const [countRows] = await db.execute('SELECT COUNT(*) AS count FROM parsed_tables WHERE user_id = ?', [req.user.id]);
    if (Number(countRows[0].count) >= limits.tables) {
      return res.status(403).json({ error: `Paket ${plan} hanya dapat menyimpan ${limits.tables} tabel. Hapus tabel lama atau upgrade paket.` });
    }
    if (Number(user.monthly_quota_remaining) + Number(user.add_on_quota_remaining) < req.filePages) {
      return res.status(403).json({ error: `Kuota tidak cukup untuk ${req.filePages} halaman. Sisa kuota: ${Number(user.monthly_quota_remaining) + Number(user.add_on_quota_remaining)} halaman.` });
    }
    return next();
  } catch (error) {
    return next(error);
  }
}

async function enqueueExtraction(req, res, next) {
  let filePath;
  try {
    const [users] = await db.execute(
      'SELECT plan_tier, subscription_status FROM users WHERE id = ?',
      [req.user.id]
    );
    const user = users[0];
    if (!user) return res.status(401).json({ error: 'Sesi pengguna tidak lagi aktif. Silakan masuk kembali.' });
    const plan = user.subscription_status === 'active' ? user.plan_tier : 'free';
    const delayMinutes = (planLimits[plan] || planLimits.free).queueMinutes;
    const extension = {
      'application/pdf': '.pdf',
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp'
    }[req.file.detectedMime];
    const filename = `${crypto.randomBytes(24).toString('hex')}${extension}`;
    filePath = path.join(__dirname, '..', 'uploads', filename);
    await fs.writeFile(filePath, req.file.buffer, { flag: 'wx', mode: 0o600 });
    const scheduledAt = new Date(Date.now() + delayMinutes * 60 * 1000);
    const [insert] = await db.execute(
      `INSERT INTO extraction_queue
        (user_id, file_path, mime_type, original_filename, total_pages, status, scheduled_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      [req.user.id, filePath, req.file.detectedMime, path.basename(req.file.originalname).slice(0, 255), req.filePages, scheduledAt]
    );
    const jobId = insert.insertId;
    if (delayMinutes === 0) {
      setImmediate(() => {
        processQueueItem(jobId).catch((error) => console.error(`[FlexiParse] Could not start extraction job ${jobId}:`, error));
      });
    }
    return res.status(202).json({ id: jobId, status: 'pending', scheduledAt });
  } catch (error) {
    if (filePath) {
      await fs.unlink(filePath).catch((removeError) => {
        if (removeError.code !== 'ENOENT') console.error('[FlexiParse] Could not remove unqueued upload:', removeError);
      });
    }
    return next(error);
  }
}

async function uploadAndExtract(req, res, next) {
  try {
    req.filePages = await getPageCount(req.file);
    return checkQuota(req, res, () => enqueueExtraction(req, res, next));
  } catch (error) {
    return next(error);
  }
}

async function getExtractionStatus(req, res, next) {
  try {
    const [rows] = await db.execute(
      'SELECT id, status, error_message AS errorMessage, parsed_table_id AS tableId, scheduled_at AS scheduledAt FROM extraction_queue WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Job ekstraksi tidak ditemukan.' });
    return res.json({ job: rows[0] });
  } catch (error) {
    return next(error);
  }
}

async function listTables(req, res, next) {
  try {
    const [tables] = await db.execute(
      'SELECT id, title, original_filename AS originalFilename, total_pages AS totalPages, created_at AS createdAt FROM parsed_tables WHERE user_id = ? ORDER BY created_at DESC LIMIT 100',
      [req.user.id]
    );
    return res.json({ tables });
  } catch (error) {
    return next(error);
  }
}

async function getTable(req, res, next) {
  try {
    const [rows] = await db.execute(
      'SELECT id, title, original_filename AS originalFilename, total_pages AS totalPages, parsed_json AS parsedJson FROM parsed_tables WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Tabel tidak ditemukan.' });
    return res.json({ table: { ...rows[0], result: JSON.parse(rows[0].parsedJson) } });
  } catch (error) {
    return next(error);
  }
}

async function updateTable(req, res, next) {
  try {
    const { title, result } = req.body;
    if (typeof title !== 'string' || !result || !Array.isArray(result.headers) || !Array.isArray(result.rows)) {
      return res.status(400).json({ error: 'Data tabel tidak valid.' });
    }
    const normalized = parseResult(JSON.stringify(result));
    const [update] = await db.execute(
      'UPDATE parsed_tables SET title = ?, parsed_json = ? WHERE id = ? AND user_id = ?',
      [title.trim().slice(0, 255) || 'Hasil ekstraksi', JSON.stringify(normalized), req.params.id, req.user.id]
    );
    if (!update.affectedRows) return res.status(404).json({ error: 'Tabel tidak ditemukan.' });
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
}

async function deleteTable(req, res, next) {
  try {
    const [deleted] = await db.execute('DELETE FROM parsed_tables WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!deleted.affectedRows) return res.status(404).json({ error: 'Tabel tidak ditemukan.' });
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
}

async function exportTable(req, res, next) {
  try {
    const [rows] = await db.execute('SELECT title, parsed_json FROM parsed_tables WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Tabel tidak ditemukan.' });
    const result = JSON.parse(rows[0].parsed_json);
    const filename = String(rows[0].title).replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-|-$/g, '') || 'flexiparse';
    if (req.query.format === 'xlsx') {
      const ExcelJS = require('exceljs');
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Extracted data');
      sheet.addRow(result.headers);
      result.rows.forEach((row) => sheet.addRow(row));
      sheet.getRow(1).font = { bold: true };
      sheet.views = [{ state: 'frozen', ySplit: 1 }];
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
      await workbook.xlsx.write(res);
      return res.end();
    }
    const csv = [result.headers, ...result.rows].map((row) => row.map(csvEscape).join(',')).join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
    return res.send(`\uFEFF${csv}`);
  } catch (error) {
    return next(error);
  }
}

module.exports = { uploadAndExtract, getExtractionStatus, listTables, getTable, updateTable, deleteTable, exportTable, planLimits };
