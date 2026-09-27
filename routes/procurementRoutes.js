const express = require('express');
const router = express.Router();
const { wrapAll } = require('../middleware/errorHandler');
const procurementController = require('../controllers/procurementController');
const { requireAuth } = require('../middleware/auth');
const uploadQualityImage = require('../middleware/uploadQualityImage');

const {
  saveQuality,
  analyzeAIQuality,
  verifyAIQuality,
  getQuality,
  getQualityReport,
  saveWeight,
  processPayment
} = wrapAll(procurementController);

// All procurement routes require authentication
router.use(requireAuth);

// Traditional quality endpoint (preserved)
router.post('/:token/quality', saveQuality);

// AI Onion Quality Assessment endpoints
router.post('/:token/quality/ai/analyze', uploadQualityImage.single('image'), analyzeAIQuality);
router.post('/:token/quality/ai/verify', verifyAIQuality);
router.get('/:token/quality', getQuality);
router.get('/:token/quality/report', getQualityReport);

// Weight & Payment endpoints
router.post('/:token/weight', saveWeight);
router.post('/:token/payment', processPayment);

module.exports = router;
