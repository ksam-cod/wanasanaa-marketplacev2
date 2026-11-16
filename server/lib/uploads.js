import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import multer from 'multer';
import { config } from '../config.js';
import { ApiError } from './http.js';

fs.mkdirSync(config.uploadsDir, { recursive: true });

const extensions = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/avif', '.avif'],
]);

const storage = multer.diskStorage({
  destination: config.uploadsDir,
  filename: (_req, file, cb) => {
    const extension = extensions.get(file.mimetype) ?? '.jpg';
    cb(null, `${Date.now()}-${randomBytes(6).toString('hex')}${extension}`);
  },
});

export const uploadArtworkImage = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (extensions.has(file.mimetype)) return cb(null, true);
    cb(new ApiError(415, 'unsupported_media', 'Upload a JPG, PNG, WebP or AVIF image.'));
  },
}).single('image');
