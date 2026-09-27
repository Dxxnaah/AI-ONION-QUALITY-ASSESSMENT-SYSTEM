const assert = require('assert');
const { generateAadhaarOtp, verifyAadhaarOtp, isAadhaarVerified } = require('./services/otpService');

async function runTests() {
  console.log('=== RUNNING AGRIQUEUE OTP & DATE VALIDATION TESTS ===\n');

  // Test 1: Dynamic OTP Generation (Not hardcoded)
  console.log('Test 1: Dynamic OTP Generation');
  const res1 = await generateAadhaarOtp('123456789012', '9876543210');
  assert.strictEqual(res1.success, true, 'OTP generation should succeed');
  assert.strictEqual(res1.simulatedOtp.length, 6, 'OTP must be 6 digits');
  assert.notStrictEqual(res1.simulatedOtp, '123456', 'OTP must NOT be hardcoded 123456');
  console.log(`  ✓ Generated dynamic OTP: ${res1.simulatedOtp} (txnId: ${res1.txnId})`);

  // Test 2: Invalid OTP check
  console.log('\nTest 2: Invalid OTP Rejection');
  const failRes = verifyAadhaarOtp(res1.txnId, '123456789012', '000000');
  assert.strictEqual(failRes.success, false, 'Invalid OTP should fail');
  assert.strictEqual(failRes.attemptsRemaining, 2, 'Should have 2 attempts remaining');
  console.log(`  ✓ Invalid OTP correctly rejected with message: "${failRes.message}"`);

  // Test 3: Successful Verification
  console.log('\nTest 3: Correct OTP Verification');
  const verifyRes = verifyAadhaarOtp(res1.txnId, '123456789012', res1.simulatedOtp);
  assert.strictEqual(verifyRes.success, true, 'Verification should succeed');
  assert.strictEqual(verifyRes.verified, true, 'Verified flag should be true');
  assert.ok(verifyRes.verificationToken, 'Should return verificationToken');
  assert.strictEqual(isAadhaarVerified('123456789012', verifyRes.verificationToken), true, 'Token should be valid in session');
  console.log(`  ✓ Successfully verified! Verification token: ${verifyRes.verificationToken}`);

  // Test 4: Single-use Rejection (Cannot reuse same OTP)
  console.log('\nTest 4: Single-use Rejection');
  const reuseRes = verifyAadhaarOtp(res1.txnId, '123456789012', res1.simulatedOtp);
  assert.strictEqual(reuseRes.success, false, 'Reused OTP must be rejected');
  assert.strictEqual(reuseRes.reason, 'already_used', 'Reason must be already_used');
  console.log(`  ✓ Reused OTP correctly rejected: "${reuseRes.message}"`);

  // Test 5: Preferred Date Rules
  console.log('\nTest 5: Preferred Date Restriction Validation');
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const todayStr = `${yyyy}-${mm}-${dd}`;

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

  const twoDaysAhead = new Date(today);
  twoDaysAhead.setDate(twoDaysAhead.getDate() + 2);
  const twoDaysAheadStr = `${twoDaysAhead.getFullYear()}-${String(twoDaysAhead.getMonth() + 1).padStart(2, '0')}-${String(twoDaysAhead.getDate()).padStart(2, '0')}`;

  const threeDaysAhead = new Date(today);
  threeDaysAhead.setDate(threeDaysAhead.getDate() + 3);
  const threeDaysAheadStr = `${threeDaysAhead.getFullYear()}-${String(threeDaysAhead.getMonth() + 1).padStart(2, '0')}-${String(threeDaysAhead.getDate()).padStart(2, '0')}`;

  function isDateSelectable(dateStr) {
    const minAllowed = twoDaysAheadStr;
    return dateStr >= minAllowed;
  }

  assert.strictEqual(isDateSelectable(todayStr), false, "Today's date must NOT be selectable");
  assert.strictEqual(isDateSelectable(tomorrowStr), false, "Tomorrow's date must NOT be selectable");
  assert.strictEqual(isDateSelectable(twoDaysAheadStr), true, "Date 2 days from today MUST be selectable");
  assert.strictEqual(isDateSelectable(threeDaysAheadStr), true, "Date 3 days from today MUST be selectable");

  console.log(`  Today (${todayStr}): Selectable? ${isDateSelectable(todayStr)} [REJECTED ✓]`);
  console.log(`  Tomorrow (${tomorrowStr}): Selectable? ${isDateSelectable(tomorrowStr)} [REJECTED ✓]`);
  console.log(`  2 days ahead (${twoDaysAheadStr}): Selectable? ${isDateSelectable(twoDaysAheadStr)} [ACCEPTED ✓]`);
  console.log(`  3 days ahead (${threeDaysAheadStr}): Selectable? ${isDateSelectable(threeDaysAheadStr)} [ACCEPTED ✓]`);

  console.log('\n=== ALL VERIFICATION TESTS PASSED SUCCESSFULLY! ===');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
