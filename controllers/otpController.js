const { generateAadhaarOtp, verifyAadhaarOtp } = require('../services/otpService');

async function sendOtp(req, res) {
  const { aadhaar, mobile } = req.body;
  const result = await generateAadhaarOtp(aadhaar, mobile);
  if (!result.success) {
    return res.status(result.status || 400).json({ error: result.message });
  }
  return res.json(result);
}

async function verifyOtp(req, res) {
  const { txnId, aadhaar, otp } = req.body;
  const result = verifyAadhaarOtp(txnId, aadhaar, otp);
  if (!result.success) {
    return res.status(result.status || 400).json({
      error: result.message,
      reason: result.reason,
      attemptsRemaining: result.attemptsRemaining
    });
  }
  return res.json(result);
}

module.exports = {
  sendOtp,
  verifyOtp
};
