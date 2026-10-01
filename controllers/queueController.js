const mongoose = require('mongoose');
const QueueToken = require('../models/QueueToken');
const Centre = require('../models/Centre');
const V = require('../public/js/validation'); // same rules the farmer form uses
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

// GET /api/queue/slot-info?centreId=&date=&slot=
async function getSlotInfo(req, res) {
  const { centreId, date, slot } = req.query;
  if (!centreId || !date || !slot || !SLOT_CONFIG[slot]) {
    return res.status(400).json({ error: 'centreId, date and a valid slot are required' });
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
// Body: { farmerName, farmerId, mobile, aadhaar, bankAccount, centreId, cropType, quantity, date, slot, type }
async function joinQueue(req, res) {
  // Validate every field with the shared rules. Never trust the browser: someone
  // can call this API directly and skip the form entirely.
  const result = V.booking({
    farmerName: req.body.farmerName,
    mobile: req.body.mobile,
    aadhaar: req.body.aadhaar,
    bankAccount: req.body.bankAccount,
    centreId: req.body.centreId,
    cropType: req.body.cropType,
    quantity: req.body.quantity,
    date: req.body.date,
    slot: req.body.slot
  });
  if (!result.ok) {
    return res.status(400).json({
      error: 'Please correct the highlighted fields.',
      fields: result.errors
    });
  }

  const { farmerName, mobile, aadhaar, bankAccount, centreId, cropType, quantity, date, slot } = result.values;
  const { farmerId, type } = req.body;

  if (!mongoose.isValidObjectId(centreId)) {
    return res.status(400).json({ error: 'Please correct the highlighted fields.', fields: { centreId: 'Choose a valid procurement centre.' } });
  }

  const centre = await Centre.findById(centreId);
  if (!centre) return res.status(404).json({ error: 'Centre not found', fields: { centreId: 'This centre no longer exists. Pick another.' } });

  // One active booking per farmer per day (matched on Aadhaar).
  const duplicate = await QueueToken.findOne({
    aadhaar, date, status: { $in: ['waiting', 'serving'] }
  });
  if (duplicate) {
    return res.status(409).json({
      error: `This Aadhaar already has an active token (${duplicate.token}) for ${date}.`,
      fields: { aadhaar: `Already booked for this date: token ${duplicate.token}.` }
    });
  }

  // Slot capacity.
  const booked = await QueueToken.countDocuments({
    centre: centreId, date, slot, status: { $in: ['waiting', 'serving'] }
  });
  if (booked >= SLOT_CONFIG[slot].capacity) {
    return res.status(409).json({
      error: `The ${SLOT_CONFIG[slot].label.toLowerCase()} slot on ${date} is full.`,
      fields: { slot: 'This slot is full. Choose another slot or date.' }
    });
  }

  const tokenType = type === 'kiosk' ? 'kiosk' : 'online';
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