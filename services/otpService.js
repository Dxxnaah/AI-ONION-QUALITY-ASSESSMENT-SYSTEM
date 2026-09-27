const crypto = require('crypto');

// In-memory store for Aadhaar OTP sessions:
// Map<txnId, { aadhaar, mobile, otp, expiresAt, attempts, maxAttempts, used, verified, createdAt }>
const otpSessions = new Map();

// Map<aadhaar, lastSentAt> for rate limiting / cooldown (30 seconds)
const rateLimits = new Map();

// Map<verificationToken, { aadhaar, verifiedAt, expiresAt }>
const verifiedTokens = new Map();

const OTP_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const RESEND_COOLDOWN_MS = 30 * 1000; // 30 seconds
const MAX_ATTEMPTS = 3;
const TOKEN_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes verification session validity

/**
 * Provider interface placeholder for real SMS / UIDAI OTP integration
 */
async function sendOtpViaProvider(mobile, otp) {
  // In production, integrate with SMS Gateway (e.g., Twilio, CDAC, Fast2SMS, or UIDAI Authentication API)
  // Example:
  // await axios.post('https://api.sms-provider.com/send', { to: mobile, text: `Your AgriQueue Aadhaar OTP is ${otp}` });
  return { success: true };
}

function maskAadhaar(aadhaar) {
  const clean = String(aadhaar).replace(/\D/g, '');
  if (clean.length < 4) return clean;
  return 'XXXX-XXXX-' + clean.slice(-4);
}

function maskMobile(mobile) {
  const clean = String(mobile).replace(/\D/g, '');
  if (clean.length < 4) return clean;
  return 'XXXXXX' + clean.slice(-4);
}

/**
 * Generate a dynamic 6-digit numeric OTP and initiate verification session
 */
async function generateAadhaarOtp(aadhaar, mobile) {
  const cleanAadhaar = String(aadhaar || '').replace(/\D/g, '');
  const cleanMobile = String(mobile || '').replace(/\D/g, '');

  if (cleanAadhaar.length !== 12) {
    return { success: false, status: 400, message: 'Aadhaar number must be exactly 12 digits.' };
  }
  if (cleanMobile.length < 10) {
    return { success: false, status: 400, message: 'Valid registered mobile number is required.' };
  }

  // Check rate limit / resend cooldown
  const lastSent = rateLimits.get(cleanAadhaar);
  const now = Date.now();
  if (lastSent && now - lastSent < RESEND_COOLDOWN_MS) {
    const waitSec = Math.ceil((RESEND_COOLDOWN_MS - (now - lastSent)) / 1000);
    return {
      success: false,
      status: 429,
      message: `Please wait ${waitSec}s before requesting a new OTP.`
    };
  }

  // Dynamic 6-digit OTP (never hardcoded 123456)
  const otpNumber = crypto.randomInt(100000, 1000000);
  const otp = String(otpNumber);

  const txnId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
  const expiresAt = now + OTP_EXPIRY_MS;

  const session = {
    txnId,
    aadhaar: cleanAadhaar,
    mobile: cleanMobile,
    otp,
    expiresAt,
    attempts: 0,
    maxAttempts: MAX_ATTEMPTS,
    used: false,
    verified: false,
    createdAt: now
  };

  otpSessions.set(txnId, session);
  rateLimits.set(cleanAadhaar, now);

  // Dispatch via SMS provider hook
  await sendOtpViaProvider(cleanMobile, otp);

  // Structured console log for audit & development verification
  console.log(`[Aadhaar OTP Service] Dynamic OTP generated for Aadhaar ${maskAadhaar(cleanAadhaar)} (Mobile: +91 ${maskMobile(cleanMobile)}): ${otp} | Expires in 5 minutes | txnId: ${txnId}`);

  return {
    success: true,
    txnId,
    expiresInSeconds: Math.floor(OTP_EXPIRY_MS / 1000),
    maskedAadhaar: maskAadhaar(cleanAadhaar),
    maskedMobile: maskMobile(cleanMobile),
    // Dynamic OTP included for simulation / testing UI display
    simulatedOtp: otp,
    message: `OTP sent successfully to registered mobile ending in ${cleanMobile.slice(-4)}`
  };
}

/**
 * Verify submitted OTP against active session
 */
function verifyAadhaarOtp(txnId, aadhaar, otp) {
  const cleanAadhaar = String(aadhaar || '').replace(/\D/g, '');
  const cleanOtp = String(otp || '').trim();

  if (!cleanOtp) {
    return { success: false, status: 400, message: 'OTP is required.' };
  }

  // Locate session by txnId, or find latest for this Aadhaar
  let session = txnId ? otpSessions.get(txnId) : null;
  if (!session && cleanAadhaar) {
    for (const s of otpSessions.values()) {
      if (s.aadhaar === cleanAadhaar && !s.used) {
        if (!session || s.createdAt > session.createdAt) {
          session = s;
        }
      }
    }
  }

  if (!session) {
    return {
      success: false,
      status: 404,
      message: 'No active OTP verification session found. Please request an OTP.'
    };
  }

  // Aadhaar mismatch check
  if (cleanAadhaar && session.aadhaar !== cleanAadhaar) {
    return {
      success: false,
      status: 400,
      message: 'Aadhaar number does not match the active OTP session.'
    };
  }

  const now = Date.now();

  // Expiry check
  if (now > session.expiresAt) {
    return {
      success: false,
      status: 400,
      reason: 'expired',
      message: 'OTP has expired. Please request a new OTP.'
    };
  }

  // Single-use check: OTP cannot be reused
  if (session.used) {
    return {
      success: false,
      status: 400,
      reason: 'already_used',
      message: 'This OTP has already been verified and cannot be reused.'
    };
  }

  // Attempt limit check
  if (session.attempts >= session.maxAttempts) {
    return {
      success: false,
      status: 400,
      reason: 'max_attempts_exceeded',
      message: 'Maximum OTP verification attempts exceeded. Please request a new OTP.'
    };
  }

  // Validate OTP value
  if (session.otp !== cleanOtp) {
    session.attempts += 1;
    const remaining = session.maxAttempts - session.attempts;
    return {
      success: false,
      status: 400,
      reason: 'invalid_otp',
      attemptsRemaining: Math.max(0, remaining),
      message: remaining > 0
        ? `Incorrect OTP. ${remaining} attempt(s) remaining.`
        : 'Incorrect OTP. Maximum attempts reached. Please request a new OTP.'
    };
  }

  // Successfully verified: mark session used
  session.used = true;
  session.verified = true;

  const verificationToken = 'vtok_' + crypto.randomBytes(16).toString('hex');
  verifiedTokens.set(verificationToken, {
    aadhaar: session.aadhaar,
    mobile: session.mobile,
    verifiedAt: now,
    expiresAt: now + TOKEN_EXPIRY_MS
  });

  console.log(`[Aadhaar OTP Service] Verification SUCCESS for Aadhaar ${maskAadhaar(session.aadhaar)} | Token: ${verificationToken}`);

  return {
    success: true,
    status: 200,
    verified: true,
    verificationToken,
    aadhaar: maskAadhaar(session.aadhaar),
    message: 'Aadhaar verified successfully.'
  };
}

/**
 * Validate whether an Aadhaar number was verified within valid session
 */
function isAadhaarVerified(aadhaar, verificationToken) {
  if (!verificationToken) return false;
  const entry = verifiedTokens.get(verificationToken);
  if (!entry) return false;

  const cleanAadhaar = String(aadhaar || '').replace(/\D/g, '');
  if (entry.aadhaar !== cleanAadhaar) return false;
  if (Date.now() > entry.expiresAt) {
    verifiedTokens.delete(verificationToken);
    return false;
  }
  return true;
}

module.exports = {
  generateAadhaarOtp,
  verifyAadhaarOtp,
  isAadhaarVerified,
  maskAadhaar,
  maskMobile
};
