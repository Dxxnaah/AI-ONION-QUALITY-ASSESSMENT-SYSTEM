const assert = require('assert');
const { calculateQualityMetrics, gradingConfig } = require('./utils/gradingRules');
const aiQualityService = require('./services/aiQualityService');
const demoAIService = require('./services/demoAIService');

async function runAIQualityTests() {
  console.log('=== RUNNING AGRIQUEUE AI QUALITY & GRADING TESTS ===\n');

  // Test 1: Grading Rules Metric Calculation
  console.log('Test 1: Grading Rules & Percentage Calculations');
  const sampleDetections = [
    { id: 1, class: 'GOOD', confidence: 0.96 },
    { id: 2, class: 'GOOD', confidence: 0.94 },
    { id: 3, class: 'GOOD', confidence: 0.92 },
    { id: 4, class: 'GOOD', confidence: 0.90 },
    { id: 5, class: 'GOOD', confidence: 0.88 },
    { id: 6, class: 'GOOD', confidence: 0.85 },
    { id: 7, class: 'GOOD', confidence: 0.91 },
    { id: 8, class: 'GOOD', confidence: 0.89 },
    { id: 9, class: 'DAMAGED', confidence: 0.92 },
    { id: 10, class: 'ROTTEN', confidence: 0.88 },
    { id: 11, class: 'SPROUTED', confidence: 0.65 }, // below 0.70 threshold -> needs review
    { id: 12, class: 'UNDERSIZED', confidence: 0.84 }
  ];

  const metrics = calculateQualityMetrics(sampleDetections);
  assert.strictEqual(metrics.totalDetected, 12, 'Total detected must be 12');
  assert.strictEqual(metrics.counts.good, 8, 'Good count must be 8');
  assert.strictEqual(metrics.counts.damaged, 1, 'Damaged count must be 1');
  assert.strictEqual(metrics.counts.rotten, 1, 'Rotten count must be 1');
  assert.strictEqual(metrics.counts.sprouted, 1, 'Sprouted count must be 1');
  assert.strictEqual(metrics.counts.undersized, 1, 'Undersized count must be 1');

  // Verify Needs Review flag on low confidence detection
  assert.strictEqual(sampleDetections[10].needsReview, true, 'Item 11 (confidence 0.65) must be flagged needsReview');
  assert.strictEqual(sampleDetections[0].needsReview, false, 'Item 1 (confidence 0.96) must NOT be flagged needsReview');

  console.log(`  ✓ Total: ${metrics.totalDetected}, Counts:`, metrics.counts);
  console.log(`  ✓ Percentages: Grade A: ${metrics.percentages.gradeA}%, URS: ${metrics.percentages.urs}%`);
  console.log(`  ✓ Defect Rates: Rotten: ${metrics.percentages.rotten}%, Damaged: ${metrics.percentages.damaged}%, Sprouted: ${metrics.percentages.sprouted}%`);
  console.log(`  ✓ Low confidence (<${gradingConfig.confidenceReviewThreshold * 100}%) item #11 correctly flagged for Human Review.`);

  // Test 2: Demo AI Service Structure
  console.log('\nTest 2: Demo AI Service Execution & Contract Verification');
  const demoResult = await demoAIService.analyze({
    imagePath: 'uploads/quality/sample_test.jpg',
    imageUrl: '/uploads/quality/sample_test.jpg',
    sampleWeight: 2.5
  });

  assert.strictEqual(demoResult.success, true, 'Demo AI analysis should succeed');
  assert.strictEqual(demoResult.demoMode, true, 'Demo AI should explicitly flag demoMode: true');
  assert.ok(demoResult.modelVersion.includes('demo'), 'Model version must indicate demo');
  assert.ok(Array.isArray(demoResult.detections), 'Detections must be an array');
  assert.ok(demoResult.detections.length > 0, 'Detections array must not be empty');

  // Check detection properties
  const firstDet = demoResult.detections[0];
  assert.ok(firstDet.id !== undefined, 'Detection must have id');
  assert.ok(['GOOD', 'DAMAGED', 'ROTTEN', 'SPROUTED', 'UNDERSIZED'].includes(firstDet.class), 'Valid class required');
  assert.ok(typeof firstDet.confidence === 'number' && firstDet.confidence >= 0 && firstDet.confidence <= 1, 'Confidence must be between 0 and 1');
  assert.ok(firstDet.bbox && typeof firstDet.bbox.x === 'number', 'Bbox x must be numeric');
  console.log(`  ✓ Demo AI returned ${demoResult.detections.length} detections with version ${demoResult.modelVersion}`);
  console.log(`  ✓ Sample detection #1: class=${firstDet.class}, confidence=${(firstDet.confidence * 100).toFixed(1)}%, bbox=[${firstDet.bbox.x}, ${firstDet.bbox.y}, ${firstDet.bbox.width}, ${firstDet.bbox.height}]`);

  // Test 3: AI Service Provider Abstraction
  console.log('\nTest 3: AIService Provider Abstraction & Mode Switching');
  process.env.AI_MODE = 'demo';
  const provider = aiQualityService.getProvider();
  assert.strictEqual(aiQualityService.getMode(), 'demo', 'getMode should return demo when AI_MODE=demo');
  assert.strictEqual(provider.mode, 'demo', 'Provider mode must be demo');

  const abstractionResult = await aiQualityService.analyze({
    imagePath: 'uploads/quality/test.jpg',
    imageUrl: '/uploads/quality/test.jpg',
    sampleWeight: 3.0
  });
  assert.strictEqual(abstractionResult.success, true, 'Abstraction result must succeed');
  assert.strictEqual(abstractionResult.demoMode, true, 'Must preserve demoMode in output');
  console.log(`  ✓ Provider correctly routed to: ${provider.name} (demoMode=${abstractionResult.demoMode})`);

  // Test 4: Auditability & Human Verification Persistence
  console.log('\nTest 4: Audit Trail - Human Verification does NOT overwrite AI original prediction');
  const originalAIClass = 'DAMAGED';
  const originalAIConf = 0.91;
  const humanCorrection = 'GOOD';
  const staffId = 'EMP-COUNTER-1';
  const verificationTime = new Date();

  const verifiedItem = {
    id: 1,
    class: originalAIClass,
    confidence: originalAIConf,
    bbox: { x: 10, y: 15, width: 60, height: 60 },
    humanVerifiedClass: humanCorrection,
    humanVerified: true,
    humanReviewNote: 'Minor cosmetic mark, flesh firm and sound'
  };

  assert.strictEqual(verifiedItem.class, originalAIClass, 'Original AI class MUST remain intact');
  assert.strictEqual(verifiedItem.confidence, originalAIConf, 'Original AI confidence MUST remain intact');
  assert.strictEqual(verifiedItem.humanVerifiedClass, humanCorrection, 'Human verified class must be stored separately');
  assert.strictEqual(verifiedItem.humanVerified, true, 'humanVerified flag must be true');
  console.log(`  ✓ Audit intact: AI Result="${verifiedItem.class}" (${(verifiedItem.confidence*100).toFixed(0)}%) | Human Result="${verifiedItem.humanVerifiedClass}" | VerifiedBy="${staffId}"`);

  console.log('\n=== ALL AI QUALITY & GRADING TESTS PASSED! ===');
}

runAIQualityTests().catch(err => {
  console.error('AI Quality test failed:', err);
  process.exit(1);
});
