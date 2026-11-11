const mysql = require('mysql2/promise');

const required = ['DB_HOST', 'DB_USER', 'DB_NAME'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  throw new Error(`Missing database configuration: ${missing.join(', ')}`);
}

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 5),
  queueLimit: 0,
  charset: 'utf8mb4',
  timezone: 'Z'
});

module.exports = pool;
