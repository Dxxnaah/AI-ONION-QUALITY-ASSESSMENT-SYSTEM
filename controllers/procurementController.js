const path = require('path');
const fs = require('fs');
const QueueToken = require('../models/QueueToken');
const Centre = require('../models/Centre');
const { broadcast } = require('../utils/socket');
const aiQualityService = require('../services/aiQualityService');
const { calculateQualityMetrics, DEFAULT_GRADING_CONFIG } = require('../utils/gradingRules');

// POST /api/procurement/:token/quality
// Preserved traditional quality endpoint (backward compatible)
// Body: { moisture, impurities, foreignMatter, status, remarks }
async function saveQuality(req, res) {
  const { moisture, impurities, foreignMatter, status, remarks, sampleWeight } = req.body;
  if (moisture == null || impurities == null || foreignMatter == null || !status) {
    return res.status(400).json({ error: 'moisture, impurities, foreignMatter and status are required' });
  }

  const existing = await QueueToken.findOne({ token: req.params.token });
  if (!existing) return res.status(404).json({ error: 'Token not found' });

  const qualityUpdate = {
    moisture: Number(moisture),
    impurities: Number(impurities),
    foreignMatter: Number(foreignMatter),
    status,
    remarks: remarks || '',
    checkedAt: new Date(),
    sampleWeight: sampleWeight ? Number(sampleWeight) : (existing.quality && existing.quality.sampleWeight) || null,
    // Preserve existing aiAssessment if any
    aiAssessment: (existing.quality && existing.quality.aiAssessment) || null
  };

  existing.quality = qualityUpdate;
  await existing.save();

  broadcast('queue:update', { reason: 'quality', token: existing.token, status: 'Quality Checked' });
  res.json(existing);
}

// POST /api/procurement/:token/quality/ai/analyze
// Handles image upload (via Multer file or base64 data URL) + sampleWeight
async function analyzeAIQuality(req, res) {
  const { token } = req.params;
  const sampleWeight = parseFloat(req.body.sampleWeight);

  if (isNaN(sampleWeight) || sampleWeight <= 0) {
    return res.status(400).json({ error: 'Please enter a valid sample weight in kg (greater than 0)' });
  }

  const tokenDoc = await QueueToken.findOne({ token }).populate('centre');
  if (!tokenDoc) {
    return res.status(404).json({ error: `Token ${token} not found` });
  }

  let imagePath = null;
  let imageUrl = null;

  if (req.file) {
    imagePath = req.file.path;
    imageUrl = `/uploads/quality/${path.basename(imagePath)}`;
  } else if (req.body.imageBase64) {
    // Decode base64 if sent directly
    const matches = req.body.imageBase64.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
    if (!matches) {
      return res.status(400).json({ error: 'Invalid image format. Must be a valid JPEG, PNG, or WEBP image.' });
    }
    const format = matches[1].toLowerCase();
    if (!['jpeg', 'jpg', 'png', 'webp'].includes(format)) {
      return res.status(400).json({ error: 'Unsupported image format. Allowed: jpg, jpeg, png, webp' });
    }

    const buffer = Buffer.from(matches[2], 'base64');
    if (buffer.length > 10 * 1024 * 1024) {
      return res.status(400).json({ error: 'Image size exceeds maximum limit of 10MB' });
    }

    const filename = `inspection_${token.replace(/[^a-zA-Z0-9_-]/g, '')}_${Date.now()}.${format === 'jpeg' ? 'jpg' : format}`;
    imagePath = path.join(__dirname, '..', 'uploads', 'quality', filename);
    fs.writeFileSync(imagePath, buffer);
    imageUrl = `/uploads/quality/${filename}`;
  } else {
    return res.status(400).json({ error: 'No image provided. Please capture or upload an onion sample image.' });
  }

  try {
    const aiResult = await aiQualityService.analyze({
      imagePath,
      imageUrl,
      sampleWeight
    });

    if (!tokenDoc.quality) {
      tokenDoc.quality = {};
    }

    tokenDoc.quality.sampleWeight = sampleWeight;
    tokenDoc.quality.aiAssessment = {
      enabled: true,
      mode: aiResult.mode,
      status: 'analyzed',
      imageUrl: aiResult.imageUrl,
      annotatedImageUrl: aiResult.imageUrl,
      totalDetected: aiResult.totalDetected,
      counts: aiResult.counts,
      percentages: aiResult.percentages,
      detections: aiResult.detections,
      modelVersion: aiResult.modelVersion,
      gradingRuleVersion: aiResult.gradingRuleVersion,
      analyzedAt: aiResult.analyzedAt,
      verifiedAt: null,
      verifiedBy: null,
      reportId: null
    };

    await tokenDoc.save();

    broadcast('queue:update', {
      reason: 'ai_quality_analyzed',
      token: tokenDoc.token,
      mode: aiResult.mode,
      gradeA: aiResult.percentages.gradeA,
      urs: aiResult.percentages.urs
    });

    res.json({
      success: true,
      token: tokenDoc.token,
      mode: aiResult.mode,
      modeLabel: aiResult.mode === 'demo' ? 'DEMO AI MODE' : 'REAL AI MODEL',
      totalLotWeight: tokenDoc.quantity,
      sampleWeight,
      aiAssessment: tokenDoc.quality.aiAssessment,
      recommendedStatus: aiResult.recommendedStatus
    });
  } catch (err) {
    console.error('[procurementController] AI analysis failed:', err);
    return res.status(500).json({
      error: `AI Service Error: ${err.message}`
    });
  }
}

// POST /api/procurement/:token/quality/ai/verify
// Submit human verification of AI detections and traditional quality parameters
async function verifyAIQuality(req, res) {
  const { token } = req.params;
  const {
    detections = [],
    moisture,
    impurities,
    foreignMatter,
    status,
    remarks = '',
    annotatedImageData
  } = req.body;

  if (moisture == null || impurities == null || foreignMatter == null || !status) {
    return res.status(400).json({
      error: 'Traditional quality parameters (moisture, impurities, foreignMatter) and status are required'
    });
  }

  const tokenDoc = await QueueToken.findOne({ token }).populate('centre');
  if (!tokenDoc) {
    return res.status(404).json({ error: `Token ${token} not found` });
  }

  if (!tokenDoc.quality || !tokenDoc.quality.aiAssessment) {
    return res.status(400).json({ error: 'AI analysis must be executed before human verification' });
  }

  const staffIdentifier = (req.staff && (req.staff.username || req.staff.id)) || 'staff-supervisor';

  // Process human verification without overwriting original AI predictions
  // Compare submitted detections with original
  const originalDetections = tokenDoc.quality.aiAssessment.detections || [];
  const verifiedDetections = detections.map((incoming, idx) => {
    const original = originalDetections.find(d => d.id === incoming.id) || originalDetections[idx] || {};

    const humanClass = incoming.humanVerifiedClass || original.humanVerifiedClass || null;
    const isVerified = incoming.humanVerified || humanClass !== null;

    return {
      id: original.id || (idx + 1),
      class: original.class || incoming.class || 'GOOD', // ORIGINAL AI CLASSIFICATION PRESERVED
      confidence: original.confidence || incoming.confidence || 0.9, // ORIGINAL CONFIDENCE PRESERVED
      bbox: original.bbox || incoming.bbox,
      notes: incoming.notes || original.notes || '',
      needsReview: original.needsReview,
      humanVerified: isVerified,
      humanVerifiedClass: humanClass // HUMAN OVERRIDE
    };
  });

  // Recalculate metrics with verified classifications
  const metrics = calculateQualityMetrics(verifiedDetections);

  // Generate unique report ID
  const reportId = `RPT-AGRI-${token.replace(/[^a-zA-Z0-9]/g, '')}-${Date.now().toString(36).toUpperCase()}`;

  // Optionally save annotated image if provided
  let annotatedImageUrl = tokenDoc.quality.aiAssessment.imageUrl;
  if (annotatedImageData && annotatedImageData.startsWith('data:image/')) {
    try {
      const matches = annotatedImageData.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
      if (matches) {
        const ext = matches[1].toLowerCase() === 'jpeg' ? 'jpg' : matches[1].toLowerCase();
        const fname = `annotated_${token.replace(/[^a-zA-Z0-9_-]/g, '')}_${Date.now()}.${ext}`;
        const fpath = path.join(__dirname, '..', 'uploads', 'quality', fname);
        fs.writeFileSync(fpath, Buffer.from(matches[2], 'base64'));
        annotatedImageUrl = `/uploads/quality/${fname}`;
      }
    } catch (saveErr) {
      console.warn('[procurementController] Could not save annotated image overlay:', saveErr);
    }
  }

  // Update token document
  tokenDoc.quality.moisture = Number(moisture);
  tokenDoc.quality.impurities = Number(impurities);
  tokenDoc.quality.foreignMatter = Number(foreignMatter);
  tokenDoc.quality.status = status;
  tokenDoc.quality.remarks = remarks;
  tokenDoc.quality.checkedAt = new Date();

  tokenDoc.quality.aiAssessment.status = 'verified';
  tokenDoc.quality.aiAssessment.verifiedAt = new Date();
  tokenDoc.quality.aiAssessment.verifiedBy = staffIdentifier;
  tokenDoc.quality.aiAssessment.reportId = reportId;
  tokenDoc.quality.aiAssessment.annotatedImageUrl = annotatedImageUrl;
  tokenDoc.quality.aiAssessment.detections = verifiedDetections;
  tokenDoc.quality.aiAssessment.counts = metrics.counts;
  tokenDoc.quality.aiAssessment.percentages = metrics.percentages;
  tokenDoc.quality.aiAssessment.totalDetected = metrics.total;

  await tokenDoc.save();

  broadcast('queue:update', {
    reason: 'quality_verified',
    token: tokenDoc.token,
    status: 'Quality Verified',
    gradeA: metrics.percentages.gradeA,
    urs: metrics.percentages.urs,
    reportId
  });

  res.json({
    success: true,
    token: tokenDoc.token,
    reportId,
    quality: tokenDoc.quality
  });
}

// GET /api/procurement/:token/quality
async function getQuality(req, res) {
  const tokenDoc = await QueueToken.findOne({ token: req.params.token }).populate('centre');
  if (!tokenDoc) return res.status(404).json({ error: 'Token not found' });
  res.json({
    token: tokenDoc.token,
    farmerName: tokenDoc.farmerName,
    cropType: tokenDoc.cropType,
    totalLotWeight: tokenDoc.quantity,
    quality: tokenDoc.quality || null
  });
}

// GET /api/procurement/:token/quality/report
// Structured Digital Quality Report
async function getQualityReport(req, res) {
  const tokenDoc = await QueueToken.findOne({ token: req.params.token }).populate('centre');
  if (!tokenDoc) return res.status(404).json({ error: 'Token not found' });

  if (!tokenDoc.quality) {
    return res.status(400).json({ error: 'Quality inspection has not been performed for this token' });
  }

  const ai = tokenDoc.quality.aiAssessment || null;
  const reportData = {
    header: {
      system: 'AgriQueue - Smart Farmer Procurement System',
      title: 'ONION QUALITY ASSESSMENT REPORT',
      inspectionId: ai ? `INSP-${tokenDoc.token}-${(ai.analyzedAt || new Date()).getTime()}` : `INSP-${tokenDoc.token}`,
      reportId: (ai && ai.reportId) || `RPT-${tokenDoc.token}`,
      generatedAt: new Date().toISOString()
    },
    procurementDetails: {
      tokenNumber: tokenDoc.token,
      farmerName: tokenDoc.farmerName,
      farmerId: tokenDoc.farmerId || tokenDoc.aadhaar ? `FMR-${(tokenDoc.aadhaar || '').slice(-4)}` : 'N/A',
      centreName: (tokenDoc.centre && tokenDoc.centre.name) || 'Tamil Nadu Procurement Centre',
      centreLocation: (tokenDoc.centre && tokenDoc.centre.location) || 'Tamil Nadu',
      date: tokenDoc.date,
      slot: tokenDoc.slot,
      crop: tokenDoc.cropType
    },
    lotInformation: {
      totalLotWeight: tokenDoc.quantity, // kg
      sampleWeight: tokenDoc.quality.sampleWeight || 2.0, // kg
      numberOfImages: 1,
      totalOnionsAnalyzed: (ai && ai.totalDetected) || 0
    },
    aiQualityAssessment: ai ? {
      enabled: true,
      mode: ai.mode,
      modelVersion: ai.modelVersion,
      imageUrl: ai.imageUrl,
      annotatedImageUrl: ai.annotatedImageUrl || ai.imageUrl,
      percentages: ai.percentages,
      counts: ai.counts,
      disclaimer: 'AI assessment is based on the analyzed sample and configured grading rules. The AI does not inspect onions not present in the captured representative sample.'
    } : null,
    traditionalParameters: {
      moisture: tokenDoc.quality.moisture,
      impurities: tokenDoc.quality.impurities,
      foreignMatter: tokenDoc.quality.foreignMatter
    },
    verification: {
      status: tokenDoc.quality.status,
      remarks: tokenDoc.quality.remarks,
      aiAnalysisCompleted: !!ai,
      humanVerificationCompleted: ai ? ai.status === 'verified' : true,
      verifiedBy: (ai && ai.verifiedBy) || 'Supervisor',
      verifiedAt: (ai && ai.verifiedAt) || tokenDoc.quality.checkedAt
    },
    auditTrail: ai && ai.detections ? ai.detections.map(d => ({
      id: d.id,
      originalClass: d.class,
      confidence: d.confidence,
      humanVerifiedClass: d.humanVerifiedClass || d.class,
      wasCorrected: d.humanVerifiedClass && d.humanVerifiedClass !== d.class,
      notes: d.notes || ''
    })) : []
  };

  res.json(reportData);
}

// POST /api/procurement/:token/weight
// Body: { grossWeight, tareWeight, moistureDeduction }
async function saveWeight(req, res) {
  const { grossWeight, tareWeight, moistureDeduction = 0 } = req.body;
  if (grossWeight == null || tareWeight == null) {
    return res.status(400).json({ error: 'grossWeight and tareWeight are required' });
  }

  // Ensure quality verification is completed first
  const existing = await QueueToken.findOne({ token: req.params.token });
  if (!existing) return res.status(404).json({ error: 'Token not found' });
  if (!existing.quality || !existing.quality.status) {
    return res.status(400).json({ error: 'Quality check must be verified before proceeding to weight measurement' });
  }

  const netWeight = Number(grossWeight) - Number(tareWeight);
  const finalWeight = netWeight - (netWeight * Number(moistureDeduction)) / 100;

  existing.weight = {
    grossWeight,
    tareWeight,
    netWeight,
    moistureDeduction,
    finalWeight,
    measuredAt: new Date()
  };
  await existing.save();

  broadcast('queue:update', { reason: 'weight', token: existing.token, finalWeight });
  res.json(existing);
}

// POST /api/procurement/:token/payment
// Body: { method, reference }
// Amount is computed server-side from final weight * centre MSP rate — never trust a client-sent amount.
async function processPayment(req, res) {
  const { method, reference } = req.body;
  if (!method) return res.status(400).json({ error: 'method is required' });

  const doc = await QueueToken.findOne({ token: req.params.token }).populate('centre');
  if (!doc) return res.status(404).json({ error: 'Token not found' });
  if (!doc.weight || doc.weight.finalWeight == null) {
    return res.status(400).json({ error: 'Weight measurement must be completed before payment' });
  }

  const cropKey = String(doc.cropType).toLowerCase();
  const mspRate = (doc.centre && doc.centre.mspRates && doc.centre.mspRates[cropKey]) || 25.00;
  const amount = Math.round(doc.weight.finalWeight * mspRate * 100) / 100;

  doc.payment = {
    amount,
    mspRate,
    method,
    reference,
    status: 'paid',
    paidAt: new Date()
  };
  await doc.save();

  broadcast('queue:update', { reason: 'payment', token: doc.token, amount });
  res.json(doc);
}

module.exports = {
  saveQuality,
  analyzeAIQuality,
  verifyAIQuality,
  getQuality,
  getQualityReport,
  saveWeight,
  processPayment
};
