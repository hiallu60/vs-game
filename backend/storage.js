import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export function createStorage() {
  const mode = process.env.STORAGE_DRIVER || 'local';
  if (!['local', 's3'].includes(mode)) throw new Error('Invalid STORAGE_DRIVER');
  const bucket = process.env.S3_BUCKET;
  if (mode === 's3' && !bucket) throw new Error('S3_BUCKET is required');
  const s3 = mode === 's3' ? new S3Client({ region: process.env.AWS_REGION }) : null;
  const directory = path.resolve(process.env.UPLOAD_DIR || 'uploads');
  return {
    directory,
    async save(file) {
      if (!file) return null;
      let buffer;
      try {
        const image = sharp(file.buffer, { limitInputPixels: 25000000 });
        const meta = await image.metadata();
        if (!['jpeg', 'png', 'webp'].includes(meta.format)) throw new Error();
        buffer = await image.rotate().resize(1400, 1400, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
      } catch { throw Object.assign(new Error('이미지는 JPG, PNG, WebP 형식이며 2,500만 화소 이하여야 합니다.'), { status: 400 }); }
      const key = `images/${randomUUID()}.webp`;
      if (s3) await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: 'image/webp' }));
      else { await mkdir(path.join(directory, 'images'), { recursive: true }); await writeFile(path.join(directory, key), buffer); }
      return key;
    },
    async remove(key) {
      if (s3) await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      else await unlink(path.join(directory, key));
    },
    async url(key) {
      if (!key) return null;
      return s3 ? getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 3600 }) : `/uploads/${key}`;
    }
  };
}
