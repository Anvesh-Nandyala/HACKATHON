require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const bucket = process.env.FRONTEND_BUCKET || 'circular-commerce-frontend-anvesh';
const region = process.env.S3_REGION || process.env.AWS_REGION || 'ap-south-2';
const distDir = path.resolve(__dirname, '../../frontend/dist');

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

async function main() {
  const s3 = new S3Client({ region });
  const files = walk(distDir);

  for (const filePath of files) {
    const key = path.relative(distDir, filePath).replace(/\\/g, '/');
    const ext = path.extname(filePath).toLowerCase();

    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: fs.readFileSync(filePath),
      ContentType: contentTypes[ext] || 'application/octet-stream',
      CacheControl: key === 'index.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    }));

    console.log(`Uploaded s3://${bucket}/${key}`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
