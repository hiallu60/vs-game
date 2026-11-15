import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import sharp from 'sharp';
import { mkdtemp, rm, access, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from './app.js';
import { createStorage } from './storage.js';

// Stateful DB double: these tests exercise HTTP/cookies/validation, not MySQL itself.
function setup() {
  const topics = [], votes = [], comments = [];
  const db = { query: async () => [[]], execute: async (sql, p) => {
    if (sql.startsWith('INSERT INTO topics')) { const id = topics.length + 1; topics.push({ id, title:p[0], option_a:p[1], option_b:p[2], image_a_key:p[3], image_b_key:p[4] }); return [{ insertId:id }]; }
    if (sql.startsWith('SELECT * FROM topics')) return [topics.filter(t => String(t.id) === p[0])];
    if (sql.startsWith('INSERT INTO votes')) { if (votes.some(v => v.topic_id === p[0] && v.voter_token_hash === p[2])) throw Object.assign(new Error(), { code:'ER_DUP_ENTRY' }); votes.push({ topic_id:p[0], choice:p[1], voter_token_hash:p[2] }); return [{}]; }
    if (sql.includes('COUNT(*) AS count')) return [['A','B'].map(choice => ({ choice, count:votes.filter(v => v.topic_id === p[0] && v.choice === choice).length }))];
    if (sql.includes('FROM votes WHERE')) return [votes.filter(v => v.topic_id === p[0] && v.voter_token_hash === p[1])];
    if (sql.startsWith('INSERT INTO comments')) { comments.push({ id:comments.length+1, content:p[1], topic_id:p[0] }); return [{}]; }
    if (sql.includes('FROM comments WHERE')) return [comments.filter(c => c.topic_id === p[0])];
    if (sql.startsWith('SELECT t.*')) return [topics];
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const storage = { url:async key => key, save:async () => null, remove:async () => {}, directory:tmpdir() };
  const app = createApp({ db, storage, secret:'test-secret-at-least-thirty-two-characters' });
  return { app, agent:request.agent(app) };
}
async function topic(agent) { return agent.post('/api/topics').field('title','평생 하나만?').field('option_a','치킨').field('option_b','피자'); }

test('create topic; reject blank/long fields and missing topics', async () => {
  const { agent } = setup();
  assert.equal((await topic(agent)).status,201);
  assert.equal((await agent.get('/api/topics/1')).body.topic.option_a,'치킨');
  assert.equal((await agent.post('/api/topics').field('title',' ').field('option_a','A').field('option_b','B')).status,400);
  assert.equal((await agent.post('/api/topics').field('title','가'.repeat(201)).field('option_a','A').field('option_b','B')).status,400);
  assert.equal((await agent.get('/api/topics/999')).status,404);
  assert.equal((await agent.get('/api/topics/invalid')).status,400);
});
test('results require a vote; one vote per signed browser cookie', async () => {
  const { agent, app } = setup(); await topic(agent);
  assert.equal((await agent.get('/api/topics/1/results')).status,403);
  assert.equal((await agent.post('/api/topics/1/votes').send({ choice:'C' })).status,400);
  assert.equal((await agent.post('/api/topics/1/votes').send({ choice:'A' })).status,201);
  assert.equal((await agent.post('/api/topics/1/votes').send({ choice:'B' })).status,409);
  const r = await agent.get('/api/topics/1/results'); assert.equal(r.body.total,1); assert.equal(r.body.percent_a,100); assert.equal(r.body.percent_b,0);
  const other = request.agent(app); await other.get('/api/topics/1');
  assert.equal((await other.get('/api/topics/1/results')).status,403);
  assert.equal((await other.post('/api/topics/1/votes').send({ choice:'B' })).status,201);
  assert.equal((await agent.get('/api/topics/1/results')).body.percent_a,50);
});
test('comments are stored as text; blanks and oversized content rejected', async () => {
  const { agent } = setup(); await topic(agent);
  assert.equal((await agent.post('/api/topics/1/comments').send({ content:' ' })).status,400);
  assert.equal((await agent.post('/api/topics/1/comments').send({ content:'가'.repeat(1001) })).status,400);
  const content = '<script>alert(1)</script>';
  assert.equal((await agent.post('/api/topics/1/comments').send({ content })).status,201);
  assert.equal((await agent.get('/api/topics/1/comments')).body.comments[0].content,content);
});
test('cross-site writes and oversized attachments rejected', async () => {
  const { agent } = setup();
  assert.equal((await agent.post('/api/topics').set('Sec-Fetch-Site','cross-site').send({})).status,403);
  assert.equal((await agent.post('/api/topics').field('title','제목').field('option_a','A').field('option_b','B').attach('image_a',Buffer.alloc(5*1024*1024+1),'huge.jpg')).status,400);
});
test('real image decoding, conversion, local persistence and deletion', async () => {
  const directory = await mkdtemp(path.join(tmpdir(),'vs-images-'));
  const previous = process.env.UPLOAD_DIR; process.env.UPLOAD_DIR = directory;
  const storage = createStorage();
  try {
    const buffer = await sharp({ create:{ width:12,height:12,channels:3,background:'#6745ed' } }).png().toBuffer();
    const key = await storage.save({ buffer }); assert.match(key,/^images\/.*\.webp$/);
    await access(path.join(directory,key));
    assert.equal((await sharp(await readFile(path.join(directory,key))).metadata()).format,'webp');
    await assert.rejects(storage.save({ buffer:Buffer.from('<svg>fake image</svg>') }),/이미지/);
    await storage.remove(key); await assert.rejects(access(path.join(directory,key)));
  } finally { if (previous === undefined) delete process.env.UPLOAD_DIR; else process.env.UPLOAD_DIR=previous; await rm(directory,{ recursive:true,force:true }); }
});
