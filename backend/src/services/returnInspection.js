const { BedrockRuntimeClient, ConverseCommand } = require('@aws-sdk/client-bedrock-runtime');

const BEDROCK_REGION = process.env.BEDROCK_REGION || process.env.AWS_REGION || 'ap-south-2';
const MODEL_ID = process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-haiku-20240307-v1:0';
const bedrock = new BedrockRuntimeClient({ region: BEDROCK_REGION });

function clamp(value, fallback = 0.4) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

function fallbackInspection(product, returnDetails = {}) {
  const damageLevel = String(returnDetails.damageLevel || 'minor');
  const reason = String(returnDetails.reason || '').toLowerCase();
  const conditionScore = Number(product.verification?.conditionScore || product.conditionScore || 75);
  let damageScore = damageLevel === 'severe' ? 0.85 : damageLevel === 'moderate' ? 0.55 : 0.25;
  const findings = [];

  if (conditionScore < 60) {
    damageScore += 0.2;
    findings.push('Existing condition score is low.');
  }

  if (/(broken|crack|water|dead|not working|screen damage|missing)/i.test(reason)) {
    damageScore += 0.2;
    findings.push('Return reason mentions major functional or physical damage.');
  }

  if (findings.length === 0) {
    findings.push('Return details do not indicate major damage.');
  }

  damageScore = clamp(damageScore);
  const severity = damageScore > 0.75 ? 'major' : damageScore >= 0.45 ? 'significant' : 'minor';
  const disposition = severity === 'minor'
    ? 'refurbish'
    : severity === 'significant'
      ? 'recycle'
      : 'admin_review';

  return {
    severity,
    damageScore,
    disposition,
    confidence: 0.65,
    findings,
    recommendation: disposition === 'refurbish'
      ? 'Damage appears low. Refurbish and relist as a refurbished product.'
      : disposition === 'recycle'
        ? 'Damage appears significant. Send this product to recycle.'
        : 'Damage appears severe. Admin should choose donate or recycle.',
    fallback: true,
  };
}

async function inspectReturnedProduct(product, returnDetails = {}) {
  const fallback = fallbackInspection(product, returnDetails);

  if (process.env.ENABLE_BEDROCK !== 'true') {
    return fallback;
  }

  try {
    const prompt = `Inspect this returned product for a circular commerce platform. Decide what should happen next. Return ONLY JSON:
{
  "severity": "minor" | "significant" | "major",
  "damageScore": 0.0-1.0,
  "disposition": "refurbish" | "recycle" | "admin_review",
  "confidence": 0.0-1.0,
  "findings": ["specific damage findings"],
  "recommendation": "short admin-facing recommendation"
}

Rules:
- minor damage means refurbish and relist.
- significant damage means send to recycle.
- more than significant/major damage means admin review, where admin chooses donate or recycle.
- Never relist a returned product unless disposition is refurbish.

Product:
- Category: ${product.category}
- Brand: ${product.brand}
- Model: ${product.model}
- Existing condition score: ${product.verification?.conditionScore || product.conditionScore || 'unknown'}/100
- Existing grade: ${product.verification?.grade || product.grade || 'unknown'}
- Working before sale: ${product.verification?.working !== false && product.working !== false ? 'yes' : 'no'}
- Description: ${product.description || 'None'}

Buyer return details:
- Reason: ${returnDetails.reason || 'Not provided'}
- Reported damage level: ${returnDetails.damageLevel || 'minor'}
- Notes: ${returnDetails.notes || 'None'}`;

    const response = await bedrock.send(new ConverseCommand({
      modelId: MODEL_ID,
      inferenceConfig: { maxTokens: 450, temperature: 0.1 },
      messages: [{ role: 'user', content: [{ text: prompt }] }],
    }));

    const text = response.output?.message?.content?.[0]?.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return fallback;

    const parsed = JSON.parse(match[0]);
    const damageScore = clamp(parsed.damageScore, fallback.damageScore);
    const severity = ['minor', 'significant', 'major'].includes(parsed.severity)
      ? parsed.severity
      : damageScore > 0.75 ? 'major' : damageScore >= 0.45 ? 'significant' : 'minor';
    const disposition = ['refurbish', 'recycle', 'admin_review'].includes(parsed.disposition)
      ? parsed.disposition
      : severity === 'minor' ? 'refurbish' : severity === 'significant' ? 'recycle' : 'admin_review';

    return {
      severity,
      damageScore,
      disposition,
      confidence: clamp(parsed.confidence, 0.7),
      findings: Array.isArray(parsed.findings) && parsed.findings.length ? parsed.findings : fallback.findings,
      recommendation: parsed.recommendation || fallback.recommendation,
      fallback: false,
    };
  } catch (err) {
    console.warn(`[ReturnInspection] AI inspection failed: ${err.message}`);
    return fallback;
  }
}

module.exports = {
  inspectReturnedProduct,
  fallbackInspection,
};
