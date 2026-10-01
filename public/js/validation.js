/**
 * AgriQueue – shared field validation.
 *
 * One file, two homes:
 *   - Browser:  <script src="/js/validation.js"></script>   -> window.AgriValidation
 *   - Server:   require('../public/js/validation')           -> same rules, so the API
 *               can never accept something the form would have rejected.
 *
 * Every validator takes the raw input and returns:
 *   { ok: true,  value: <cleaned value> }
 *   { ok: false, error: '<plain-language message>' }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AgriValidation = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CROPS = ['Onion', 'Paddy', 'Wheat', 'Rice'];
  const SLOTS = {
    morning: { label: 'Morning', timing: '8:00 AM - 12:00 PM', startH: 8, endH: 12 },
    afternoon: { label: 'Afternoon', timing: '12:00 PM - 4:00 PM', startH: 12, endH: 16 },
    evening: { label: 'Evening', timing: '4:00 PM - 8:00 PM', startH: 16, endH: 20 }
  };
  const LIMITS = {
    nameMin: 2,
    nameMax: 60,
    qtyMin: 50, // kg
    qtyMax: 10000, // kg
    bookAheadDays: 14
  };

  const fail = (error) => ({ ok: false, error });
  const pass = (value) => ({ ok: true, value });

  // ---------- Verhoeff checksum (the algorithm Aadhaar numbers use) ----------
  const D = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6], [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4], [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
  ];
  const P = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2], [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]
  ];
  function verhoeffValid(num) {
    let c = 0;
    const digits = String(num).split('').reverse();
    for (let i = 0; i < digits.length; i++) c = D[c][P[i % 8][Number(digits[i])]];
    return c === 0;
  }

  // ---------- Date helpers (Asia/Kolkata – the centres are in Tamil Nadu) ----------
  // Using a fixed zone matters: a server on UTC would otherwise think it is
  // still "yesterday" for the first 5.5 hours of an Indian morning.
  function nowInIndia(now) {
    const d = now || new Date();
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', hourCycle: 'h23'
    }).formatToParts(d);
    const get = (t) => parts.find((p) => p.type === t).value;
    return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
  }
  function addDays(ymd, n) {
    const [y, m, d] = ymd.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + n));
    return dt.toISOString().slice(0, 10);
  }
  function isRealDate(ymd) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
    const [y, m, d] = ymd.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }

  // ---------- Field validators ----------
  function farmerName(raw) {
    const v = String(raw == null ? '' : raw).trim().replace(/\s+/g, ' ');
    if (!v) return fail('Enter the farmer’s name.');
    if (v.length < LIMITS.nameMin) return fail('Name must be at least 2 characters.');
    if (v.length > LIMITS.nameMax) return fail('Name must be 60 characters or fewer.');
    // Letters from any script (Tamil, Hindi, English…), spaces, dot, apostrophe, hyphen.
    if (!/^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u.test(v)) {
      return fail('Use letters only. Digits and symbols are not allowed in a name.');
    }
    return pass(v);
  }

  function mobile(raw) {
    let v = String(raw == null ? '' : raw).replace(/[\s-]/g, '');
    if (!v) return fail('Enter a mobile number.');
    if (!/^\+?\d+$/.test(v)) return fail('Mobile number can only contain digits.');
    v = v.replace(/^\+?91(?=\d{10}$)/, '').replace(/^0(?=\d{10}$)/, '');
    if (v.length !== 10) return fail('Mobile number must be exactly 10 digits.');
    if (!/^[6-9]/.test(v)) return fail('Indian mobile numbers start with 6, 7, 8 or 9.');
    if (/^(\d)\1{9}$/.test(v)) return fail('That mobile number does not look real.');
    return pass(v);
  }

  function aadhaar(raw) {
    const v = String(raw == null ? '' : raw).replace(/[\s-]/g, '');
    if (!v) return fail('Enter the Aadhaar number.');
    if (!/^\d+$/.test(v)) return fail('Aadhaar can only contain digits.');
    if (v.length !== 12) return fail('Aadhaar must be exactly 12 digits (' + v.length + ' entered).');
    if (/^[01]/.test(v)) return fail('Aadhaar numbers never start with 0 or 1.');
    if (!verhoeffValid(v)) return fail('This Aadhaar number is not valid. Check for a typing mistake.');
    return pass(v);
  }

  function bankAccount(raw) {
    const v = String(raw == null ? '' : raw).replace(/[\s-]/g, '');
    if (!v) return fail('Enter the bank account number.');
    if (!/^\d+$/.test(v)) return fail('Account number can only contain digits.');
    if (v.length < 9 || v.length > 18) return fail('Account number must be 9 to 18 digits (' + v.length + ' entered).');
    if (/^(\d)\1+$/.test(v)) return fail('That account number does not look real.');
    return pass(v);
  }

  function centre(raw) {
    const v = String(raw == null ? '' : raw).trim();
    if (!v) return fail('Choose a procurement centre.');
    return pass(v);
  }

  function cropType(raw) {
    const v = String(raw == null ? '' : raw).trim().toLowerCase();
    if (!v) return fail('Choose a crop.');
    const match = CROPS.find((c) => c.toLowerCase() === v);
    if (!match) return fail('Crop must be one of: ' + CROPS.join(', ') + '.');
    return pass(match);
  }

  function quantity(raw) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s) return fail('Enter the estimated quantity in kg.');
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return fail('Quantity must be a positive number, like 2500.');
    const n = Number(s);
    if (n < LIMITS.qtyMin) return fail('Minimum quantity is ' + LIMITS.qtyMin + ' kg.');
    if (n > LIMITS.qtyMax) return fail('Maximum per booking is ' + LIMITS.qtyMax.toLocaleString('en-IN') + ' kg. Split larger lots into two bookings.');
    return pass(n);
  }

  function date(raw, now) {
    const v = String(raw == null ? '' : raw).trim();
    if (!v) return fail('Choose a date.');
    if (!isRealDate(v)) return fail('That is not a valid date.');
    const today = nowInIndia(now).date;
    const last = addDays(today, LIMITS.bookAheadDays);
    if (v < today) return fail('That date has already passed.');
    if (v > last) return fail('You can book up to ' + LIMITS.bookAheadDays + ' days ahead.');
    return pass(v);
  }

  // Slot depends on the date: a morning slot is no use at 3 pm today.
  function slot(raw, dateStr, now) {
    const v = String(raw == null ? '' : raw).trim().toLowerCase();
    if (!v) return fail('Choose a time slot.');
    if (!SLOTS[v]) return fail('Choose morning, afternoon or evening.');
    const t = nowInIndia(now);
    if (dateStr && dateStr === t.date && t.hour >= SLOTS[v].endH) {
      return fail('The ' + SLOTS[v].label.toLowerCase() + ' slot has already ended today. Pick a later slot or another day.');
    }
    return pass(v);
  }

  /**
   * Validate a whole booking at once.
   * Returns { ok, errors: {field: message}, values: {cleaned fields} }
   */
  function booking(input, now) {
    const i = input || {};
    const checks = {
      farmerName: farmerName(i.farmerName),
      mobile: mobile(i.mobile),
      aadhaar: aadhaar(i.aadhaar),
      bankAccount: bankAccount(i.bankAccount),
      centreId: centre(i.centreId),
      cropType: cropType(i.cropType),
      quantity: quantity(i.quantity),
      date: date(i.date, now)
    };
    // Only check the slot against "today" once the date itself is valid.
    checks.slot = slot(i.slot, checks.date.ok ? checks.date.value : null, now);

    const errors = {};
    const values = {};
    Object.keys(checks).forEach((k) => {
      if (checks[k].ok) values[k] = checks[k].value;
      else errors[k] = checks[k].error;
    });
    return { ok: Object.keys(errors).length === 0, errors, values };
  }

  return {
    CROPS, SLOTS, LIMITS,
    farmerName, mobile, aadhaar, bankAccount, centre, cropType, quantity, date, slot,
    booking, verhoeffValid, nowInIndia, addDays
  };
});