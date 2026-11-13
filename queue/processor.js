const fs = require('fs/promises');
const path = require('path');
const db = require('../config/db');
const { extractDocument } = require('../config/gemini');
const { parseResult } = require('../utils/tabular');
const { planLimits } = require('../utils/plans');

const uploadDirectory = path.resolve(__dirname, '..', 'uploads');

function getSafeUploadPath(filePath) {
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(`${uploadDirectory}${path.sep}`)) {
    throw new Error('Queue job references a file outside the uploads directory.');
  }
  return resolved;
}

async function processQueueItem(id) {
  const claim = await db.execute(
    "UPDATE extraction_queue SET status = 'processing', error_message = NULL WHERE id = ? AND status = 'pending' AND scheduled_at <= UTC_TIMESTAMP()",
    [id]
  );
  if (!claim[0].affectedRows) return false;

  let job;
  try {
    const [jobs] = await db.execute(
      'SELECT id, user_id, file_path, mime_type, original_filename, total_pages FROM extraction_queue WHERE id = ?',
      [id]
    );
    job = jobs[0];
    if (!job) throw new Error('Extraction queue job was not found after claiming.');

    const filePath = getSafeUploadPath(job.file_path);
    const fileBuffer = await fs.readFile(filePath);
    const parsed = parseResult(await extractDocument(fileBuffer, job.mime_type));
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [users] = await connection.execute(
        'SELECT plan_tier, subscription_status, monthly_quota_remaining, add_on_quota_remaining FROM users WHERE id = ? FOR UPDATE',
        [job.user_id]
      );
      const user = users[0];
      if (!user) throw Object.assign(new Error('Account not found.'), { status: 401 });
      const plan = user.subscription_status === 'active' ? user.plan_tier : 'free';
      const limits = planLimits[plan] || planLimits.free;
      const [tables] = await connection.execute('SELECT COUNT(*) AS count FROM parsed_tables WHERE user_id = ?', [job.user_id]);
      if (Number(tables[0].count) >= limits.tables) {
        throw Object.assign(new Error(`The ${plan} plan table limit has been reached.`), { status: 403 });
      }

      const monthly = Number(user.monthly_quota_remaining);
      const addon = Number(user.add_on_quota_remaining);
      if (monthly + addon < Number(job.total_pages)) {
        throw Object.assign(new Error('There is not enough page quota for this document.'), { status: 403 });
      }
      const monthlyUsed = Math.min(monthly, Number(job.total_pages));
      const addonUsed = Number(job.total_pages) - monthlyUsed;
      const title = String(parsed.title || 'Extraction results').trim().slice(0, 255) || 'Extraction results';
      const [saved] = await connection.execute(
        'INSERT INTO parsed_tables (user_id, title, original_filename, parsed_json, total_pages) VALUES (?, ?, ?, ?, ?)',
        [job.user_id, title, path.basename(job.original_filename).slice(0, 255), JSON.stringify(parsed), job.total_pages]
      );
      await connection.execute(
        'UPDATE users SET monthly_quota_remaining = monthly_quota_remaining - ?, add_on_quota_remaining = add_on_quota_remaining - ? WHERE id = ?',
        [monthlyUsed, addonUsed, job.user_id]
      );
      await connection.execute(
        "UPDATE extraction_queue SET status = 'completed', parsed_table_id = ?, error_message = NULL WHERE id = ?",
        [saved.insertId, id]
      );
      await connection.commit();
      await fs.unlink(filePath).catch((error) => console.error('[FlexiParse] Could not remove processed upload:', error));
      return true;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error(`[FlexiParse] Extraction job ${id} failed:`, error);
    const publicMessage = error.expose || (error.status && error.status < 500)
      ? error.message
      : 'The document could not be processed. Check the file or try again.';
    await db.execute(
      "UPDATE extraction_queue SET status = 'failed', error_message = ? WHERE id = ? AND status = 'processing'",
      [publicMessage.slice(0, 1000), id]
    );
    if (job?.file_path) {
      try {
        await fs.unlink(getSafeUploadPath(job.file_path));
      } catch (removeError) {
        if (removeError.code !== 'ENOENT') console.error('[FlexiParse] Could not remove failed upload:', removeError);
      }
    }
    return false;
  }
}

module.exports = { processQueueItem, getSafeUploadPath };
