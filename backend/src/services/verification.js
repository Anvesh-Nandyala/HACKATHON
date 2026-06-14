const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { BedrockRuntimeClient, ConverseCommand } = require('@aws-sdk/client-bedrock-runtime');
const { store } = require('../db/store');

const AWS_REGION = process.env.AWS_REGION || 'ap-south-2';
const S3_REGION = process.env.S3_REGION || AWS_REGION;
const BEDROCK_REGION = process.env.BEDROCK_REGION || AWS_REGION;
const S3_BUCKET = process.env.S3_BUCKET;
const BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-5-sonnet-20240620-v1:0';

const s3 = new S3Client({ region: S3_REGION });
const bedrock = new BedrockRuntimeClient({ region: BEDROCK_REGION });

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function scoreToGrade(score) {
  if (score >= 90) return 'A';
  if (score >= 70) return 'B';
  if (score >= 40) return 'C';
  return 'D';
}

function localVerification(request, reason = 'local verification') {
  const categoryScores = {
    electronics: 86,
    appliances: 84,
    furniture: 82,
    clothing: 78,
    sports: 83,
    toys: 85,
    books: 88,
  };
  const conditionScore = categoryScores[request.declaredCategory] || 80;
  const grade = scoreToGrade(conditionScore);

  return {
    productId: request.productId,
    conditionScore,
    grade,
    working: true,
    confidence: 0.72,
    damageDetected: [],
    authenticityScore: 0.78,
    declaredProductMatch: true,
    detectedCategory: request.declaredCategory,
    detectedBrand: request.declaredBrand,
    detectedModel: request.declaredModel,
    mismatchReason: '',
    reasoning: `Local product verification completed: ${reason}`,
    recommendedRecoveryPath: 'Resell',
    recommendedPriceAdjustmentPercent: 0,
    verifiedAt: new Date().toISOString(),
  };
}

function failedVerification(request, reason) {
  return {
    ...localVerification(request, reason),
    declaredProductMatch: false,
    detectedCategory: '',
    detectedBrand: '',
    detectedModel: '',
    mismatchReason: reason || 'Uploaded media could not be verified against the product details.',
    reasoning: `Product media verification failed: ${reason}`,
  };
}

function getImageDimensions(buffer, format) {
  if (format === 'png' && buffer.length >= 24) {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  }

  if (format === 'jpeg') {
    let offset = 2;
    while (offset < buffer.length) {
      if (buffer[offset] !== 0xff) break;
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xc3) {
        return {
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7),
        };
      }
      offset += 2 + length;
    }
  }

  return { width: 0, height: 0 };
}

function getMediaType(key) {
  const ext = key.toLowerCase().split('.').pop();
  if (ext === 'jpg' || ext === 'jpeg') return { contentType: 'image/jpeg', format: 'jpeg' };
  if (ext === 'png') return { contentType: 'image/png', format: 'png' };
  if (ext === 'webp') return { contentType: 'image/webp', format: 'webp' };
  throw new Error(`Unsupported image type: ${ext}`);
}

function getVideoFormat(key) {
  const ext = key.toLowerCase().split('.').pop();
  if (ext === 'mp4') return 'mp4';
  if (ext === 'mov') return 'mov';
  if (ext === 'webm') return 'webm';
  if (ext === 'mkv') return 'mkv';
  throw new Error(`Unsupported video type: ${ext}`);
}

async function getImageFromS3(key) {
  const res = await s3.send(new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
  }));

  const buffer = await streamToBuffer(res.Body);
  const fallbackType = getMediaType(key);
  const contentType = res.ContentType || fallbackType.contentType;
  const format = contentType.includes('png')
    ? 'png'
    : contentType.includes('webp')
      ? 'webp'
      : 'jpeg';
  const dimensions = getImageDimensions(buffer, format);

  if (dimensions.width && dimensions.height && (dimensions.width < 300 || dimensions.height < 300)) {
    throw new Error('Product photos are too small or unclear. Upload clear photos at least 300x300 pixels.');
  }

  return {
    key,
    format,
    bytes: buffer,
  };
}

async function getVideoFromS3(key) {
  const res = await s3.send(new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
  }));

  const buffer = await streamToBuffer(res.Body);
  if (buffer.length > 25 * 1024 * 1024) {
    throw new Error('Video is too large for AI verification. Upload a shorter video under 25 MB.');
  }

  return {
    key,
    format: getVideoFormat(key),
    bytes: buffer,
  };
}

function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON found in Bedrock response');
  return JSON.parse(match[0]);
}

function normalizeAssessment(assessment) {
  const conditionScore = Math.max(0, Math.min(100, Number(assessment.conditionScore || 0)));
  const grade = ['A', 'B', 'C', 'D'].includes(assessment.grade)
    ? assessment.grade
    : scoreToGrade(conditionScore);

  return {
    conditionScore,
    grade,
    working: Boolean(assessment.working),
    confidence: Math.max(0, Math.min(1, Number(assessment.confidence || 0.7))),
    damageDetected: Array.isArray(assessment.damageDetected) ? assessment.damageDetected : [],
    authenticityScore: Math.max(0, Math.min(1, Number(assessment.authenticityScore || 0.6))),
    declaredProductMatch: assessment.declaredProductMatch === true,
    detectedCategory: assessment.detectedCategory || '',
    detectedBrand: assessment.detectedBrand || '',
    detectedModel: assessment.detectedModel || '',
    mismatchReason: assessment.mismatchReason || '',
    reasoning: assessment.reasoning || 'Bedrock image verification completed.',
    recommendedRecoveryPath: assessment.recommendedRecoveryPath || 'Resell',
    recommendedPriceAdjustmentPercent: Number(assessment.recommendedPriceAdjustmentPercent || 0),
  };
}

async function assessWithBedrock({ images, video, declaredProduct }) {
  const content = [
    {
      text: `Analyze these product images for a local resale marketplace.

Declared product:
${JSON.stringify(declaredProduct, null, 2)}

Video proof provided: ${video ? 'Yes' : 'No'}

Return ONLY valid JSON:
{
  "conditionScore": 0-100,
  "grade": "A | B | C | D",
  "working": true,
  "confidence": 0-1,
  "damageDetected": [],
  "authenticityScore": 0-1,
  "declaredProductMatch": true | false,
  "detectedCategory": "category visible in media",
  "detectedBrand": "brand visible in media or unknown",
  "detectedModel": "model visible in media or unknown",
  "mismatchReason": "explain mismatch if declaredProductMatch is false",
  "reasoning": "short explanation",
  "recommendedRecoveryPath": "Resell | Refurbish | Donate | Recycle",
  "recommendedPriceAdjustmentPercent": -100 to 50
}

Strict matching rules:
- Do not copy the declared product values into detected fields unless they are visible in the media.
- Set declaredProductMatch to true only when the visible product category matches and the visible brand/model evidence does not contradict the declared brand/model.
- Set declaredProductMatch to false when the media is unclear, too generic, shows a different product type, shows a different brand, shows a different model, or does not provide enough evidence to verify the declared product.
- If brand or exact model is not visible, use "unknown" and set declaredProductMatch to false.`,
    },
  ];

  for (const image of images) {
    content.push({
      image: {
        format: image.format,
        source: {
          bytes: image.bytes,
        },
      },
    });
  }

  if (video) {
    content.push({
      video: {
        format: video.format,
        source: {
          bytes: video.bytes,
        },
      },
    });
  }

  const response = await bedrock.send(new ConverseCommand({
    modelId: BEDROCK_MODEL_ID,
    inferenceConfig: {
      maxTokens: 1000,
      temperature: 0.1,
    },
    messages: [{ role: 'user', content }],
  }));

  const text = response.output?.message?.content?.[0]?.text || '{}';
  return normalizeAssessment(extractJson(text));
}

async function verifyProduct(request) {
  const {
    productId,
    imageKeys,
    videoKey,
    declaredCategory,
    declaredBrand,
    declaredModel,
  } = request;

  let result;
  if (process.env.ENABLE_BEDROCK !== 'true') {
    result = localVerification(request, 'ENABLE_BEDROCK is not true');
  } else if (!S3_BUCKET) {
    result = failedVerification(request, 'S3_BUCKET is not configured');
  } else {
    try {
      const safeImageKeys = Array.isArray(imageKeys) ? imageKeys.slice(0, 5) : [];
      if (safeImageKeys.length === 0) throw new Error('At least one image key is required');

      const images = [];
      for (const key of safeImageKeys) {
        images.push(await getImageFromS3(key));
      }

      const video = videoKey ? await getVideoFromS3(videoKey) : null;

      const assessment = await assessWithBedrock({
        images,
        video,
        declaredProduct: {
          category: declaredCategory,
          brand: declaredBrand,
          model: declaredModel,
        },
      });

      result = {
        productId,
        ...assessment,
        verifiedAt: new Date().toISOString(),
      };
    } catch (err) {
      console.warn(`[verification] Falling back after Bedrock/S3 failure: ${err.message}`);
      result = failedVerification(request, err.message);
    }
  }

  store.emitEvent({
    type: 'ProductVerified',
    detail: {
      productId,
      conditionScore: result.conditionScore,
      grade: result.grade,
      working: result.working,
    },
  });

  return result;
}

module.exports = {
  verifyProduct,
};
