const express = require('express');
const router = express.Router();
const { wrapAll } = require('../middleware/errorHandler');
const { sendOtp, verifyOtp } = wrapAll(require('../controllers/otpController'));

router.post('/send-aadhaar-otp', sendOtp);
router.post('/verify-aadhaar-otp', verifyOtp);

module.exports = router;
