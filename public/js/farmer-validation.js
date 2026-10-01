/**
 * AgriQueue – Farmer Portal field validation (add-on).
 *
 * Plugs into the existing #joinQueueForm without changing script.js.
 * Load order in index.html (all after js/script.js):
 *     <script src="js/validation.js"></script>
 *     <script src="js/farmer-validation.js"></script>
 *
 * What it does
 *  - Validates every field on blur, and again on each keystroke once touched.
 *  - Blocks characters that can never be valid (digits in a name, letters in a number).
 *  - Blocks "Book Slot & Get Token" until every field is valid.
 *  - Blocks "Verify Aadhaar" until the Aadhaar (checksum) and mobile are valid,
 *    so no OTP is sent for a mistyped number.
 */
(function () {
  'use strict';

  var V = window.AgriValidation;
  var form = document.getElementById('joinQueueForm');
  if (!V) { console.error('[farmer-validation] js/validation.js must load first.'); return; }
  if (!form) return;

  // Show our messages instead of the browser's own "Please fill out this field" bubbles.
  form.noValidate = true;

  /* ---------- rules ---------- */
  var MIN_DAYS_AHEAD = 2;   // matches the existing rule: today and tomorrow are disabled
  var MAX_DAYS_AHEAD = 30;

  function minDate() {
    return typeof getMinPreferredDate === 'function'
      ? getMinPreferredDate(MIN_DAYS_AHEAD)
      : V.addDays(V.nowInIndia().date, MIN_DAYS_AHEAD);
  }
  function maxDate() { return V.addDays(minDate(), MAX_DAYS_AHEAD - MIN_DAYS_AHEAD); }
  function niceDate(ymd) {
    var p = ymd.split('-').map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2])).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }

  function farmerId(raw) {
    var v = String(raw == null ? '' : raw).trim();
    if (!v) return { ok: false, error: 'Enter your Farmer ID.' };
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{3,19}$/.test(v)) {
      return { ok: false, error: 'Farmer ID must be 4 to 20 letters, digits or hyphens, like FMR-8921.' };
    }
    return { ok: true, value: v };
  }
  function preferredDate(raw) {
    var v = String(raw || '').trim();
    if (!v) return { ok: false, error: 'Choose a preferred date.' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return { ok: false, error: 'That is not a valid date.' };
    if (v < minDate()) return { ok: false, error: 'Earliest date is ' + niceDate(minDate()) + '. Today and tomorrow are not available.' };
    if (v > maxDate()) return { ok: false, error: 'You can book up to ' + MAX_DAYS_AHEAD + ' days ahead (latest ' + niceDate(maxDate()) + ').' };
    return { ok: true, value: v };
  }

  // field id (in index.html)  ->  check function
  var RULES = {
    farmerName:        function (v) { return V.farmerName(v); },
    farmerId:          farmerId,
    farmerMobile:      function (v) { return V.mobile(v); },
    farmerAadhaar:     function (v) { return V.aadhaar(v); },
    farmerBank:        function (v) { return V.bankAccount(v); },
    procurementCentre: function (v) { return V.centre(v); },
    cropType:          function (v) { return V.cropType(v); },
    estimatedQuantity: function (v) { return V.quantity(v); },
    preferredDate:     preferredDate,
    timeSlot:          function (v) { return V.slot(v, null); }
  };
  var ORDER = Object.keys(RULES);
  var touched = {};

  /* ---------- message element under each field ---------- */
  function el(id) { return document.getElementById(id); }
  function msgFor(id) {
    var mid = id + '-fv';
    var m = el(mid);
    if (m) return m;
    var input = el(id);
    m = document.createElement('div');
    m.id = mid;
    m.setAttribute('role', 'alert');
    m.style.cssText = 'display:none;color:#dc3545;font-size:.85rem;margin-top:.25rem;';
    var anchor = input.closest('.input-group') || input;
    anchor.parentNode.insertBefore(m, anchor.nextSibling);
    var d = (input.getAttribute('aria-describedby') || '').trim();
    input.setAttribute('aria-describedby', (d ? d + ' ' : '') + mid);
    return m;
  }

  function paint(id, r) {
    var input = el(id);
    if (!input) return;
    var m = msgFor(id);
    var hasValue = String(input.value || '').trim() !== '';
    input.classList.toggle('is-invalid', !r.ok);
    input.classList.toggle('is-valid', r.ok && hasValue);
    input.setAttribute('aria-invalid', r.ok ? 'false' : 'true');
    m.textContent = r.ok ? '' : r.error;
    m.style.display = r.ok ? 'none' : 'block';
  }
  function validate(id) {
    var input = el(id);
    if (!input) return { ok: true };
    var r = RULES[id](input.value);
    paint(id, r);
    return r;
  }
  function validateAll() {
    var bad = [];
    ORDER.forEach(function (id) {
      if (!el(id)) return;
      touched[id] = true;
      if (!validate(id).ok) bad.push(id);
    });
    return bad;
  }
  function focusFirst(ids) {
    var first = el(ids[0]);
    if (!first) return;
    first.scrollIntoView({ block: 'center', behavior: 'smooth' });
    first.focus({ preventScroll: true });
  }
  function notify(count) {
    if (typeof showNotification === 'function') {
      showNotification('Check your details', count === 1 ? '1 field needs fixing before you can continue.' : count + ' fields need fixing before you can continue.');
    }
  }

  /* ---------- per-field events + input filters ---------- */
  ORDER.forEach(function (id) {
    var input = el(id);
    if (!input) return;
    input.addEventListener('blur', function () { touched[id] = true; validate(id); });
    input.addEventListener('input', function () { if (touched[id]) validate(id); });
    input.addEventListener('change', function () { touched[id] = true; validate(id); });
  });

  // Digits can never appear in a name.
  var nameEl = el('farmerName');
  if (nameEl) {
    nameEl.setAttribute('maxlength', '60');
    nameEl.addEventListener('input', function () {
      var v = this.value.replace(/[0-9]/g, '');
      if (v !== this.value) this.value = v;
    });
  }
  // Mobile: digits, spaces, an optional leading +91.
  var mobEl = el('farmerMobile');
  if (mobEl) {
    mobEl.setAttribute('maxlength', '16');
    mobEl.setAttribute('inputmode', 'numeric');
    mobEl.setAttribute('placeholder', '98765 43210');
    mobEl.addEventListener('input', function () {
      var v = this.value.replace(/[^\d+\s-]/g, '');
      if (v !== this.value) this.value = v;
    });
  }
  // Bank account: digits only, 18 max.
  var bankEl = el('farmerBank');
  if (bankEl) {
    bankEl.setAttribute('maxlength', '18');
    bankEl.setAttribute('inputmode', 'numeric');
    bankEl.addEventListener('input', function () {
      var v = this.value.replace(/\D/g, '').slice(0, 18);
      if (v !== this.value) this.value = v;
    });
  }
  // Quantity: no e / + / - in the number box; show the allowed range.
  var qtyEl = el('estimatedQuantity');
  if (qtyEl) {
    qtyEl.setAttribute('min', V.LIMITS.qtyMin);
    qtyEl.setAttribute('max', V.LIMITS.qtyMax);
    qtyEl.setAttribute('placeholder', V.LIMITS.qtyMin + ' to ' + V.LIMITS.qtyMax.toLocaleString('en-IN') + ' kg');
    qtyEl.addEventListener('keydown', function (e) {
      if (['e', 'E', '+', '-'].indexOf(e.key) !== -1) e.preventDefault();
    });
  }
  // Date picker: also cap the far end.
  var dateEl = el('preferredDate');
  if (dateEl) dateEl.setAttribute('max', maxDate());

  /* ---------- gates ---------- */
  // Registered on `document` in the capture phase so they always run BEFORE the
  // handlers script.js attached to the form / button, whatever the browser.

  // 1) Book Slot & Get Token
  document.addEventListener('submit', function (e) {
    if (e.target !== form) return;
    var bad = validateAll();
    if (bad.length) {
      e.preventDefault();
      e.stopImmediatePropagation();
      notify(bad.length);
      focusFirst(bad);
    }
  }, true);

  // 2) Verify Aadhaar: don't send an OTP for a mistyped Aadhaar or mobile.
  document.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('#btnSendAadhaarOtp') : null;
    if (!btn) return;
    var bad = ['farmerAadhaar', 'farmerMobile'].filter(function (id) {
      touched[id] = true;
      return !validate(id).ok;
    });
    if (bad.length) {
      e.preventDefault();
      e.stopImmediatePropagation();
      notify(bad.length);
      focusFirst(bad);
    }
  }, true);

  // Re-validate after the form is reset or the page re-fills fields from code.
  window.FarmerFormValidation = { validateAll: validateAll, validate: validate };
})();