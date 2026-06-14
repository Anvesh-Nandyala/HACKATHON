const express = require('express');
const multer = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

const s3 = new S3Client({
  region: process.env.S3_REGION || process.env.AWS_REGION || 'ap-south-2',
});

const S3_BUCKET = process.env.S3_BUCKET;

async function uploadToS3({ file, userId, folder }) {
  if (!S3_BUCKET) {
    const err = new Error('S3_BUCKET is missing');
    err.statusCode = 500;
    throw err;
  }

  const ext = file.originalname.split('.').pop();
  const key = `products/${userId}/${folder}/${uuidv4()}.${ext}`;

  await s3.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype,
  }));

  return {
    key,
    originalName: file.originalname,
    contentType: file.mimetype,
    size: file.size,
  };
}

router.post('/image', upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Image file is required' });
    }

    if (!req.file.mimetype.startsWith('image/')) {
      return res.status(400).json({ error: 'Only image files are allowed' });
    }

    res.json(await uploadToS3({
      file: req.file,
      userId: req.user.userId,
      folder: 'images',
    }));
  } catch (err) {
    next(err);
  }
});

router.post('/video', upload.single('video'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Video file is required' });
    }

    if (!req.file.mimetype.startsWith('video/')) {
      return res.status(400).json({ error: 'Only video files are allowed' });
    }

    res.json(await uploadToS3({
      file: req.file,
      userId: req.user.userId,
      folder: 'videos',
    }));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
