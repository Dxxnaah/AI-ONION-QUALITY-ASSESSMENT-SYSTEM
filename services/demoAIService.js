/**
 * Demo AI Service for Onion Quality Assessment
 * 
 * Generates realistic computer vision detections for an onion sample image,
 * with bounding boxes, classes (GOOD, DAMAGED, ROTTEN, SPROUTED, UNDERSIZED),
 * and confidence scores.
 * 
 * NOTE: As required, this mode is explicitly flagged as "DEMO AI MODE"
 * to maintain transparency until a verified trained onion model is connected.
 */

const { calculateQualityMetrics } = require('../utils/gradingRules');

class DemoAIService {
  constructor() {
    this.name = 'DemoAIService';
    this.modelVersion = 'onion-yolo-v8-demo-v1.0';
    this.mode = 'demo';
  }

  /**
   * Run demo AI analysis on an onion image
   * @param {Object} params
   * @param {string} params.imagePath - Path to the saved image file
   * @param {string} params.imageUrl - Accessible URL for the image
   * @param {number} params.sampleWeight - Weight of the sample in kg
   * @returns {Promise<Object>} Analysis results
   */
  async analyze({ imagePath, imageUrl, sampleWeight = 2.0 }) {
    // Simulate brief asynchronous processing delay
    await new Promise(resolve => setTimeout(resolve, 600));

    // Realistic detection layout for a representative onion sample tray
    // Bounding boxes are normalized percentages [0-100] for responsive overlay scaling
    const rawDetections = [
      { id: 1, class: 'GOOD', confidence: 0.96, bbox: { x: 12, y: 15, width: 22, height: 24 } },
      { id: 2, class: 'GOOD', confidence: 0.94, bbox: { x: 38, y: 14, width: 24, height: 25 } },
      { id: 3, class: 'DAMAGED', confidence: 0.91, bbox: { x: 66, y: 16, width: 23, height: 23 }, notes: 'Surface cut / skin peel detected' },
      { id: 4, class: 'GOOD', confidence: 0.95, bbox: { x: 10, y: 42, width: 23, height: 26 } },
      { id: 5, class: 'SPROUTED', confidence: 0.88, bbox: { x: 36, y: 40, width: 25, height: 26 }, notes: 'Apical shoot germination visible' },
      { id: 6, class: 'GOOD', confidence: 0.92, bbox: { x: 65, y: 41, width: 22, height: 25 } },
      { id: 7, class: 'UNDERSIZED', confidence: 0.89, bbox: { x: 14, y: 68, width: 18, height: 20 }, notes: 'Diameter < 45mm' },
      { id: 8, class: 'GOOD', confidence: 0.93, bbox: { x: 39, y: 69, width: 24, height: 25 } },
      { id: 9, class: 'ROTTEN', confidence: 0.92, bbox: { x: 67, y: 67, width: 23, height: 25 }, notes: 'Bacterial soft rot / fungal discoloration' },
      // Include one detection with lower confidence (< 0.70) to test "Needs Review" flag
      { id: 10, class: 'SPROUTED', confidence: 0.64, bbox: { x: 50, y: 28, width: 20, height: 22 }, notes: 'Possible early green shoot - needs human check' }
    ];

    const detections = rawDetections.map(d => ({
      ...d,
      needsReview: d.confidence < 0.70,
      humanVerified: false,
      humanVerifiedClass: null
    }));

    const metrics = calculateQualityMetrics(detections);

    return {
      success: true,
      mode: this.mode,
      modeLabel: 'DEMO AI MODE',
      demoMode: true,
      modelVersion: this.modelVersion,
      imageUrl,
      sampleWeight: Number(sampleWeight),
      analyzedAt: new Date(),
      totalDetected: detections.length,
      detections,
      counts: metrics.counts,
      percentages: metrics.percentages,
      needsReviewCount: metrics.needsReviewCount,
      gradingRuleVersion: metrics.gradingRuleVersion,
      ruleNotice: metrics.ruleNotice,
      recommendedStatus: metrics.recommendedStatus
    };
  }
}

module.exports = new DemoAIService();
