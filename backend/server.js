import mysql from 'mysql2/promise';
import { createApp } from './app.js';
import { createStorage } from './storage.js';
const db = mysql.createPool({ host: process.env.DB_HOST || 'db', user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE, charset: 'utf8mb4', connectionLimit: 10, supportBigNumbers: true, bigNumberStrings: true, timezone: 'Z' });
db.on('connection', connection => connection.query("SET time_zone = '+00:00'"));
const app = createApp({ db, storage: createStorage(), secret: process.env.COOKIE_SECRET, secureCookie: process.env.COOKIE_SECURE === 'true' });
const server = app.listen(3000, '0.0.0.0', () => console.log('VS API listening on 3000'));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(async () => { await db.end(); process.exit(0); }));
