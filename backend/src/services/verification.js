const {
  S3Client,
  GetObjectCommand
} = require('@aws-sdk/client-s3');

const {
  BedrockRuntimeClient,
  InvokeModelCommand
} = require('@aws-sdk/client-bedrock-runtime');

const { store } = require('../db/store');

const AWS_REGION = process.env.AWS_REGION || 'ap-south-2';
const S3_BUCKET = process.env.S3_BUCKET;
const BEDROCK_MODEL_ID =
  process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-5-sonnet-20240620-v1:0';

const s3 = new S3Client({ region: AWS_REGION });
const bedrock = new BedrockRuntimeClient({ region: AWS_REGION });

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function getMediaType(key) {
  const ext = key.toLowerCase().split('.').pop();

  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';

  throw new Error(`Unsupported image type: ${ext}`);
}

async function getImageFromS3(key) {
  const res = await s3.send(
    new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: key
    })
  );

  const buffer = await streamToBuffer(res.Body);

  return {
    key,
    mediaType: res.ContentType || getMediaType(key),
    base64: buffer.toString('base64')
  };
}

function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON found in Bedrock response');
  return JSON.parse(match[0]);
}

function normalizeAssessment(a) {
  const score = Math.max(0, Math.min(100, Number(a.conditionScore || 0)));

  const grade = ['A', 'B', 'C', 'D'].includes(a.grade)
    ? a.grade
    : score >= 90
      ? 'A'
      : score >= 70
        ? 'B'
        : score >= 40
          ? 'C'
          : 'D';

  const path = ['Resell', 'Refurbish', 'Donate', 'Recycle'].includes(
    a.recommendedRecoveryPath
  )
    ? a.recommendedRecoveryPath
    : 'Resell';

  return {
    conditionScore: score,
    grade,
    working: Boolean(a.working),
    confidence: Math.max(0, Math.min(1, Number(a.confidence || 0.7))),
    damageDetected: Array.isArray(a.damageDetected) ? a.damageDetected : [],
    authenticityScore: Math.max(0, Math.min(1, Number(a.authenticityScore || 0.6))),
    reasoning: a.reasoning || 'Bedrock Vision verification completed.',
    recommendedRecoveryPath: path,
    recommendedPriceAdjustmentPercent: Number(
      a.recommendedPriceAdjustmentPercent || 0
    )
  };
}

async function assessWithBedrockVision({
  images,
  declaredProduct,
  videoProvided
}) {
  const content = [
    {
      type: 'text',
      text: `
You are an AI product verification expert for a circular commerce marketplace.

Analyze the uploaded product images directly.

Tasks:
1. Identify product type.
2. Check visible damage, scratches, dents, cracks, stains, missing parts.
3. Estimate whether product is working based on visible clues and video proof availability.
4. Estimate authenticity confidence.
5. Assign condition score and grade.
6. Recommend recovery path.
7. Recommend price adjustment percentage.

Declared product:
${JSON.stringify(declaredProduct, null, 2)}

Video proof provided:
${videoProvided ? 'Yes' : 'No'}

Return ONLY valid JSON in this exact format:
{
  "conditionScore": 0-100,
  "grade": "A | B | C | D",
  "working": true,
  "confidence": 0-1,
  "damageDetected": [
    {
      "location": "image-1",
      "severity": "minor | moderate | severe",
      "description": "short damage description"
    }
  ],
  "authenticityScore": 0-1,
  "reasoning": "short explanation",
  "recommendedRecoveryPath": "Resell | Refurbish | Donate | Recycle",
  "recommendedPriceAdjustmentPercent": -100 to 50
}
`
    }
  ];

  for (const img of images) {
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: img.mediaType,
        data: img.base64
      }
    });
  }

  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 1000,
    temperature: 0.1,
    messages: [
      {
        role: 'user',
        content
      }
    ]
  };

  const response = await bedrock.send(
    new InvokeModelCommand({
      modelId: BEDROCK_MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(body)
    })
  );

  const decoded = JSON.parse(Buffer.from(response.body).toString('utf8'));
  const text = decoded.content?.[0]?.text || '{}';

  return normalizeAssessment(extractJson(text));
}

async function verifyProduct(request) {
  const {
    productId,
    imageKeys,
    videoKey,
    declaredCategory,
    declaredBrand,
    declaredModel
  } = request;

  if (!S3_BUCKET) {
    throw new Error('S3_BUCKET environment variable is missing');
  }

  const safeImageKeys = Array.isArray(imageKeys) ? imageKeys : [];

  if (safeImageKeys.length === 0) {
    throw new Error('At least one product image is required');
  }

  const images = [];

  for (const key of safeImageKeys.slice(0, 5)) {
    images.push(await getImageFromS3(key));
  }

  const aiAssessment = await assessWithBedrockVision({
    images,
    videoProvided: Boolean(videoKey),
    declaredProduct: {
      category: declaredCategory,
      brand: declaredBrand,
      model: declaredModel
    }
  });

  const result = {
    productId,
    ...aiAssessment,
    verifiedAt: new Date().toISOString()
  };

  store.emitEvent({
    type: 'ProductVerified',
    detail: {
      productId,
      conditionScore: result.conditionScore,
      grade: result.grade,
      working: result.working,
      recommendedRecoveryPath: result.recommendedRecoveryPath
    }
  });

  return result;
}

module.exports = {
  verifyProduct
};