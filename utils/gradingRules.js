/**
 * Configurable Onion Grading Rules Engine
 * 
 * NOTE: As per requirements, official government specifications are not hardcoded.
 * This rules engine provides configurable thresholds and formulas for calculating
 * Grade A and URS (Under-sized/Rejection Standard) percentages.
 * 
 * The UI explicitly states: "Grade A / URS calculated using configured grading rules."
 */

const DEFAULT_GRADING_CONFIG = {
  version: '1.0.0-ruleset',
  ruleName: 'Standard Procurement Centre Onion Ruleset',
  // Confidence score below this threshold triggers "Needs Review"
  confidenceReviewThreshold: 0.70,

  // Maximum permissible defect percentages for Grade A classification
  gradeA: {
    maxDamagedPercent: 5.0,
    maxRottenPercent: 0.0,
    maxSproutedPercent: 3.0,
    maxUndersizedPercent: 5.0,
    minGoodPercent: 85.0
  },

  // Rejection thresholds for severe defects (URS)
  urs: {
    rottenWeightFactor: 1.0,     // 100% of rotten onions go to URS
    damagedWeightFactor: 0.8,    // 80% of damaged onions count toward URS
    sproutedWeightFactor: 0.5,   // 50% of sprouted count toward URS
    undersizedWeightFactor: 0.7  // 70% of undersized count toward URS
  },

  // Final status recommendations based on Grade A and defect levels
  statusThresholds: {
    passMinGradeA: 75.0,
    conditionalMinGradeA: 55.0,
    maxPermissibleRottenForPass: 2.0
  }
};

/**
 * Calculate counts, percentages, Grade A %, and URS % for a set of detections
 * 
 * @param {Array} detections - List of detections ({ id, class, confidence, humanVerifiedClass, ... })
 * @param {Object} [customConfig] - Optional custom configuration overriding defaults
 * @returns {Object} Quality metrics summary
 */
function calculateQualityMetrics(detections = [], customConfig = {}) {
  const config = { ...DEFAULT_GRADING_CONFIG, ...customConfig };
  const total = detections.length;

  if (total === 0) {
    return {
      total: 0,
      counts: { good: 0, damaged: 0, rotten: 0, sprouted: 0, undersized: 0 },
      percentages: { good: 0, damaged: 0, rotten: 0, sprouted: 0, undersized: 0, gradeA: 0, urs: 0 },
      needsReviewCount: 0,
      recommendedStatus: 'failed',
      gradingRuleVersion: config.version,
      ruleNotice: 'Grade A / URS calculated using configured grading rules.'
    };
  }

  // Count classes using effective class (humanVerifiedClass takes precedence over AI class)
  const counts = { good: 0, damaged: 0, rotten: 0, sprouted: 0, undersized: 0 };
  let needsReviewCount = 0;

  detections.forEach(det => {
    const effectiveClass = (det.humanVerifiedClass || det.class || 'GOOD').toUpperCase();
    if (counts[effectiveClass.toLowerCase()] !== undefined) {
      counts[effectiveClass.toLowerCase()]++;
    } else {
      counts.good++;
    }

    // Flag low confidence if not yet verified
    if (!det.humanVerified && (det.confidence == null || det.confidence < config.confidenceReviewThreshold)) {
      needsReviewCount++;
      det.needsReview = true;
    } else {
      det.needsReview = false;
    }
  });

  // Calculate raw category percentages
  const percentages = {
    good: Number(((counts.good / total) * 100).toFixed(1)),
    damaged: Number(((counts.damaged / total) * 100).toFixed(1)),
    rotten: Number(((counts.rotten / total) * 100).toFixed(1)),
    sprouted: Number(((counts.sprouted / total) * 100).toFixed(1)),
    undersized: Number(((counts.undersized / total) * 100).toFixed(1))
  };

  // Grade A calculation based on configured rules:
  // Pure good onions meet Grade A. Minor defects within tolerance may be accepted under condition.
  // Grade A % = Max(0, good% - penalties for exceeding defect limits)
  let defectPenalty = 0;
  if (percentages.damaged > config.gradeA.maxDamagedPercent) {
    defectPenalty += (percentages.damaged - config.gradeA.maxDamagedPercent);
  }
  if (percentages.rotten > config.gradeA.maxRottenPercent) {
    defectPenalty += (percentages.rotten * 1.5); // Rotten carries higher penalty
  }
  if (percentages.sprouted > config.gradeA.maxSproutedPercent) {
    defectPenalty += (percentages.sprouted - config.gradeA.maxSproutedPercent);
  }
  if (percentages.undersized > config.gradeA.maxUndersizedPercent) {
    defectPenalty += (percentages.undersized - config.gradeA.maxUndersizedPercent);
  }

  const calculatedGradeA = Math.max(0, Math.min(100, percentages.good - defectPenalty));
  percentages.gradeA = Number(calculatedGradeA.toFixed(1));

  // URS % (Under-grade / Reject Standard) based on weighted defects
  const ursSum = 
    (counts.rotten * config.urs.rottenWeightFactor) +
    (counts.damaged * config.urs.damagedWeightFactor) +
    (counts.sprouted * config.urs.sproutedWeightFactor) +
    (counts.undersized * config.urs.undersizedWeightFactor);
  
  const calculatedUrs = Math.min(100, Math.max(0, (ursSum / total) * 100));
  percentages.urs = Number(calculatedUrs.toFixed(1));

  // Recommended status
  let recommendedStatus = 'passed';
  if (percentages.gradeA < config.statusThresholds.conditionalMinGradeA || percentages.rotten > config.statusThresholds.maxPermissibleRottenForPass) {
    recommendedStatus = 'failed';
  } else if (percentages.gradeA < config.statusThresholds.passMinGradeA) {
    recommendedStatus = 'conditionally_passed';
  }

  return {
    total,
    totalDetected: total,
    counts,
    percentages,
    needsReviewCount,
    recommendedStatus,
    gradingRuleVersion: config.version,
    ruleNotice: 'Grade A / URS calculated using configured grading rules.'
  };
}

module.exports = {
  DEFAULT_GRADING_CONFIG,
  gradingConfig: DEFAULT_GRADING_CONFIG,
  calculateQualityMetrics
};
