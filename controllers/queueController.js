const QueueToken = require('../models/QueueToken');
const Centre = require('../models/Centre');
const { generateNextToken } = require('../utils/generateToken');
const { broadcast } = require('../utils/socket');

const AVG_PROCESS_MIN = Number(process.env.AVG_PROCESS_MIN || 9);

const SLOT_CONFIG = {
  morning: { label: 'Morning', timing: '8:00 AM - 12:00 PM', capacity: 80 },
  afternoon: { label: 'Afternoon', timing: '12:00 PM - 4:00 PM', capacity: 80 },
  evening: { label: 'Evening', timing: '4:00 PM - 8:00 PM', capacity: 80 }
};

async function waitingAheadCount(centreId, createdBefore) {
  return QueueToken.countDocuments({
    centre: centreId,
    status: 'waiting',
    createdAt: { $lt: createdBefore }
  });
}

async function estimateWaitMinutes(centreId, aheadCount) {
  const centre = await Centre.findById(centreId);
  const activeCounters = (centre && centre.activeCounters) || 5;
  return Math.ceil((aheadCount * AVG_PROCESS_MIN) / activeCounters);
}

const { isAadhaarVerified } = require('../services/otpService');

function getEarliestAllowedDate() {
  const d = new Date();
  d.setDate(d.getDate() + 2);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// GET /api/queue/slot-info?centreId=&date=&slot=
async function getSlotInfo(req, res) {
  const { centreId, date, slot } = req.query;
  if (!centreId || !date || !slot || !SLOT_CONFIG[slot]) {
    return res.status(400).json({ error: 'centreId, date and a valid slot are required' });
  }

  const earliestDate = getEarliestAllowedDate();
  if (date < earliestDate) {
    return res.status(400).json({
      error: `Preferred date must be at least 2 days from today. Earliest selectable date is ${earliestDate}. Today and tomorrow are not selectable.`
    });
  }

  const tokensInSlot = await QueueToken.countDocuments({
    centre: centreId,
    date,
    slot,
    status: { $in: ['waiting', 'serving'] }
  });

  const centre = await Centre.findById(centreId);
  const activeCounters = (centre && centre.activeCounters) || 5;
  const estWaitForSlot = Math.ceil((tokensInSlot * AVG_PROCESS_MIN) / activeCounters);

  res.json({
    slot,
    ...SLOT_CONFIG[slot],
    tokensInSlot,
    avgProcessMin: AVG_PROCESS_MIN,
    activeCounters,
    estWaitForSlot
  });
}

// POST /api/queue/join
// Body: { farmerName, farmerId, mobile, aadhaar, bankAccount, centreId, cropType, quantity, date, slot, type, verificationToken }
async function joinQueue(req, res) {
  const {
    farmerName, farmerId, mobile, aadhaar, bankAccount,
    centreId, cropType, quantity, date, slot, type, verificationToken
  } = req.body;

  if (!farmerName || !centreId || !cropType || !quantity || !date || !slot) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (!SLOT_CONFIG[slot]) return res.status(400).json({ error: 'Invalid slot' });

  const tokenType = type === 'kiosk' ? 'kiosk' : 'online';

  // Server-side validation: Preferred date must be at least 2 days from today
  if (tokenType === 'online') {
    const earliestDate = getEarliestAllowedDate();
    if (date < earliestDate) {
      return res.status(400).json({
        error: `Preferred date must be at least 2 days from today. Earliest selectable date is ${earliestDate}. Today and tomorrow are not selectable.`
      });
    }

    if (aadhaar && verificationToken) {
      if (!isAadhaarVerified(aadhaar, verificationToken)) {
        return res.status(400).json({ error: 'Aadhaar OTP verification is invalid or expired. Please verify Aadhaar via OTP.' });
      }
    }
  }

  const centre = await Centre.findById(centreId);
  if (!centre) return res.status(404).json({ error: 'Centre not found' });

  const tokenStr = await generateNextToken(centreId, date, tokenType);

  const doc = await QueueToken.create({
    token: tokenStr,
    type: tokenType,
    farmerName, farmerId, mobile, aadhaar, bankAccount,
    centre: centreId,
    cropType,
    quantity,
    date,
    slot,
    status: 'waiting'
  });

  const ahead = await waitingAheadCount(centreId, doc.createdAt);
  const etaMinutes = await estimateWaitMinutes(centreId, ahead);

  broadcast('queue:update', { reason: 'joined', token: doc.token });

  res.status(201).json({
    token: doc.token,
    id: doc._id,
    queuePosition: ahead + 1,
    estWaitMinutes: etaMinutes
  });
}

// GET /api/queue/status/:token
async function getStatus(req, res) {
  const doc = await QueueToken.findOne({ token: req.params.token }).populate('centre');
  if (!doc) return res.status(404).json({ error: 'Token not found' });

  let queuePosition = 0;
  let etaMinutes = 0;
  if (doc.status === 'waiting') {
    const ahead = await waitingAheadCount(doc.centre._id, doc.createdAt);
    queuePosition = ahead + 1;
    etaMinutes = await estimateWaitMinutes(doc.centre._id, ahead);
  }

  res.json({ ...doc.toObject(), queuePosition, estWaitMinutes: etaMinutes });
}

// DELETE /api/queue/:token   (farmer leaves the queue)
async function leaveQueue(req, res) {
  const doc = await QueueToken.findOneAndUpdate(
    { token: req.params.token, status: 'waiting' },
    { status: 'cancelled' },
    { new: true }
  );
  if (!doc) return res.status(404).json({ error: 'Waiting token not found' });

  broadcast('queue:update', { reason: 'left', token: doc.token });
  res.json({ ok: true, token: doc.token });
}

// GET /api/queue?centreId=&status=&type=&date=
async function listQueue(req, res) {
  const { centreId, status, type, date } = req.query;
  const filter = {};
  if (centreId) filter.centre = centreId;
  if (status) filter.status = status;
  if (type) filter.type = type;
  if (date) filter.date = date;

  const items = await QueueToken.find(filter).sort({ createdAt: 1 });
  res.json(items);
}

module.exports = { getSlotInfo, joinQueue, getStatus, leaveQueue, listQueue };
