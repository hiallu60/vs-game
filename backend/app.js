import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import { createHash, randomBytes, createHmac, timingSafeEqual } from 'node:crypto';

const fail = (status, message) => Object.assign(new Error(message), { status });
function text(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || [...value.trim()].length > max) throw fail(400, `${label}: 1~${max}자로 입력해 주세요.`);
  return value.trim();
}
export function createApp({ db, storage, secret, secureCookie = false }) {
  if (!secret || secret.length < 32) throw new Error('COOKIE_SECRET must contain at least 32 characters');
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(express.json({ limit: '16kb' }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(req.method) && (req.get('sec-fetch-site') === 'cross-site' || (req.get('origin') && new URL(req.get('origin')).host !== req.get('host')))) return next(fail(403, '다른 사이트에서 보낸 요청은 허용하지 않습니다.'));
    const sign = token => createHmac('sha256', secret).update(token).digest('hex');
    const cookie = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith('vs_voter='))?.slice(9) || '';
    let [token, signature] = cookie.split('.');
    if (!/^[a-f0-9]{64}$/.test(token || '') || !/^[a-f0-9]{64}$/.test(signature || '') || !timingSafeEqual(Buffer.from(signature), Buffer.from(sign(token)))) {
      token = randomBytes(32).toString('hex');
      res.cookie('vs_voter', `${token}.${sign(token)}`, { httpOnly: true, sameSite: 'lax', secure: secureCookie, maxAge: 31536000000, path: '/' });
    }
    req.voter = createHash('sha256').update(token).digest('hex');
    next();
  });
  const limiter = (limit, windowMs) => rateLimit({ windowMs, limit, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: '요청이 많습니다. 잠시 후 다시 시도해 주세요.' } });
  app.use('/api', limiter(300, 60000));
  const writes = limiter(30, 60000);
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 2, fields: 3, fieldSize: 2048 } }).fields([{ name: 'image_a', maxCount: 1 }, { name: 'image_b', maxCount: 1 }]);
  app.get('/api/health', async (req, res) => { await db.query('SELECT 1'); res.json({ status: 'ok' }); });
  app.param('id', (req, res, next, id) => { if (!/^[1-9]\d{0,17}$/.test(id)) return next(fail(400, '올바른 주제 번호가 아닙니다.')); next(); });
  const findTopic = async id => {
    const [rows] = await db.execute('SELECT * FROM topics WHERE id = ?', [id]);
    if (!rows.length) throw fail(404, '주제를 찾을 수 없습니다.');
    return rows[0];
  };
  const present = async row => ({ ...row, image_a_url: await storage.url(row.image_a_key), image_b_url: await storage.url(row.image_b_key), image_a_key: undefined, image_b_key: undefined });
  app.get('/api/topics', async (req, res) => {
    const before = req.query.before;
    if (before && !/^[1-9]\d{0,17}$/.test(before)) throw fail(400, '잘못된 페이지입니다.');
    const [rows] = await db.execute(`SELECT t.*, (SELECT COUNT(*) FROM votes v WHERE v.topic_id=t.id) AS vote_count, (SELECT COUNT(*) FROM comments c WHERE c.topic_id=t.id) AS comment_count FROM topics t ${before ? 'WHERE t.id < ?' : ''} ORDER BY t.id DESC LIMIT 13`, before ? [before] : []);
    res.json({ topics: await Promise.all(rows.slice(0, 12).map(present)), next: rows.length > 12 ? String(rows[11].id) : null });
  });
  app.post('/api/topics', writes, upload, async (req, res) => {
    const title = text(req.body.title, 200, '제목');
    const a = text(req.body.option_a, 255, '선택지 A');
    const b = text(req.body.option_b, 255, '선택지 B');
    const keys = [];
    try {
      const imageA = await storage.save(req.files?.image_a?.[0]); if (imageA) keys.push(imageA);
      const imageB = await storage.save(req.files?.image_b?.[0]); if (imageB) keys.push(imageB);
      const [result] = await db.execute('INSERT INTO topics (title, option_a, option_b, image_a_key, image_b_key) VALUES (?, ?, ?, ?, ?)', [title, a, b, imageA, imageB]);
      res.status(201).json({ id: String(result.insertId) });
    } catch (err) { await Promise.allSettled(keys.map(key => storage.remove(key))); throw err; }
  });
  app.get('/api/topics/:id', async (req, res) => {
    const topic = await findTopic(req.params.id);
    const [votes] = await db.execute('SELECT choice FROM votes WHERE topic_id = ? AND voter_token_hash = ?', [req.params.id, req.voter]);
    res.json({ topic: await present(topic), my_choice: votes[0]?.choice || null });
  });
  app.post('/api/topics/:id/votes', writes, async (req, res) => {
    if (!['A', 'B'].includes(req.body.choice)) throw fail(400, 'A 또는 B를 선택해 주세요.');
    await findTopic(req.params.id);
    try { await db.execute('INSERT INTO votes (topic_id, choice, voter_token_hash) VALUES (?, ?, ?)', [req.params.id, req.body.choice, req.voter]); }
    catch (err) { if (err.code === 'ER_DUP_ENTRY') throw fail(409, '이미 투표한 주제입니다.'); throw err; }
    res.status(201).json({ choice: req.body.choice });
  });
  app.get('/api/topics/:id/results', async (req, res) => {
    await findTopic(req.params.id);
    const [rows] = await db.execute('SELECT choice, voter_token_hash FROM votes WHERE topic_id = ? AND voter_token_hash = ?', [req.params.id, req.voter]);
    if (!rows.length) throw fail(403, '투표에 참여하면 결과를 볼 수 있습니다.');
    const [counts] = await db.execute('SELECT choice, COUNT(*) AS count FROM votes WHERE topic_id = ? GROUP BY choice', [req.params.id]);
    const a = Number(counts.find(row => row.choice === 'A')?.count || 0), b = Number(counts.find(row => row.choice === 'B')?.count || 0);
    res.json({ a, b, total: a + b, percent_a: a + b ? Math.round(a / (a + b) * 100) : 0, percent_b: a + b ? 100 - Math.round(a / (a + b) * 100) : 0, my_choice: rows[0].choice });
  });
  app.get('/api/topics/:id/comments', async (req, res) => {
    await findTopic(req.params.id);
    const before = req.query.before;
    if (before && !/^[1-9]\d{0,17}$/.test(before)) throw fail(400, '잘못된 페이지입니다.');
    const [rows] = await db.execute(`SELECT id, content, created_at FROM comments WHERE topic_id = ? ${before ? 'AND id < ?' : ''} ORDER BY id DESC LIMIT 21`, before ? [req.params.id, before] : [req.params.id]);
    res.json({ comments: rows.slice(0, 20), next: rows.length > 20 ? String(rows[19].id) : null });
  });
  app.post('/api/topics/:id/comments', writes, async (req, res) => {
    const content = text(req.body.content, 1000, '댓글');
    await findTopic(req.params.id);
    await db.execute('INSERT INTO comments (topic_id, content) VALUES (?, ?)', [req.params.id, content]);
    res.status(201).json({ status: 'created' });
  });
  if ((process.env.STORAGE_DRIVER || 'local') === 'local') app.use('/uploads', express.static(storage.directory, { immutable: true, maxAge: '7d' }));
  app.use((req, res) => res.status(404).json({ error: '요청한 경로를 찾을 수 없습니다.' }));
  app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) return res.status(400).json({ error: '이미지는 선택지별 1개, 각 5MB 이하로 첨부해 주세요.' });
    const status = err.status || 500;
    if (status >= 500) console.error(err.code || err.message);
    res.status(status).json({ error: status >= 500 ? '서버 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.' : err.message });
  });
  return app;
}
