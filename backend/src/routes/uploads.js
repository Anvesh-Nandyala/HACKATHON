const express = require('express');
const multer = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const s3 = new S3Client({
  region: process.env.AWS_REGION || 'ap-south-2'
});

const S3_BUCKET = process.env.S3_BUCKET;

router.post('/image', upload.single('image'), async (req, res, next) => {
  try {
    if (!S3_BUCKET) {
      return res.status(500).json({ error: 'S3_BUCKET is missing' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Image file is required' });
    }

    const ext = req.file.originalname.split('.').pop();
    const key = `products/${req.user.userId}/${uuidv4()}.${ext}`;

    await s3.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        Body: req.file.buffer,
        ContentType: req.file.mimetype
      })
    );

    res.json({ key });
  } catch (err) {
    next(err);
  }
});

module.exports = router;