require('dotenv').config();
const fs = require('fs/promises');
const path = require('path');
const db = require('../config/db');
const { processQueueItem } = require('./processor');

async function cleanupUploads() {
  const directory = path.join(__dirname, '..', 'uploads');
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  let deleted = 0;
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await db.execute(
    `DELETE FROM extraction_queue WHERE status IN ('completed', 'failed')
     AND created_at < UTC_TIMESTAMP() - INTERVAL 30 DAY`
  );
  await db.execute(
    `UPDATE extraction_queue SET status = 'failed', error_message = 'Job kedaluwarsa setelah 24 jam.'
     WHERE status IN ('pending', 'processing') AND created_at < UTC_TIMESTAMP() - INTERVAL 24 HOUR`
  );
  const [activeJobs] = await db.execute(
    "SELECT file_path FROM extraction_queue WHERE status IN ('pending', 'processing')"
  );
  const activePaths = new Set(activeJobs.map((job) => path.resolve(job.file_path)));
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name === '.gitkeep') continue;
    const file = path.join(directory, entry.name);
    if (activePaths.has(path.resolve(file))) continue;
    let stat;
    try {
      stat = await fs.stat(file);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (stat.mtimeMs < cutoff) {
      await fs.unlink(file);
      deleted += 1;
    }
  }
  return deleted;
}

async function runWorker() {
  await db.execute(
    `UPDATE extraction_queue SET status = 'pending', scheduled_at = UTC_TIMESTAMP()
     WHERE status = 'processing' AND updated_at < UTC_TIMESTAMP() - INTERVAL 30 MINUTE`
  );
  const [rows] = await db.execute(
    "SELECT id FROM extraction_queue WHERE status = 'pending' AND scheduled_at <= UTC_TIMESTAMP() ORDER BY scheduled_at ASC LIMIT 10"
  );
  for (const job of rows) await processQueueItem(job.id);
  const deleted = await cleanupUploads();
  console.log(`Processed ${rows.length} due extraction job(s); cleaned ${deleted} expired upload(s).`);
}

if (require.main === module) {
  runWorker().then(() => db.end()).catch((error) => {
    console.error('[FlexiParse worker]', error);
    process.exitCode = 1;
    db.end().catch((closeError) => console.error(closeError));
  });
}

module.exports = { cleanupUploads, runWorker };
