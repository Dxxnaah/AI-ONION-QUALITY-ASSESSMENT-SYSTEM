require('dotenv').config();
const path = require('path');
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const connectDB = require('./config/db');
const { initSocket } = require('./utils/socket');
const { errorHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/authRoutes');
const centreRoutes = require('./routes/centreRoutes');
const queueRoutes = require('./routes/queueRoutes');
const counterRoutes = require('./routes/counterRoutes');
const procurementRoutes = require('./routes/procurementRoutes');
const kioskRoutes = require('./routes/kioskRoutes');
const displayRoutes = require('./routes/displayRoutes');
const adminRoutes = require('./routes/adminRoutes');
const otpRoutes = require('./routes/otpRoutes');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: process.env.CLIENT_ORIGIN || '*' }
});
initSocket(io);

io.on('connection', (socket) => {
  console.log(`[socket] client connected: ${socket.id}`);
  socket.on('disconnect', () => console.log(`[socket] client disconnected: ${socket.id}`));
});

app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*' }));
app.use(express.json());

// Serve the frontend (built from the AgriQueue HTML/CSS/JS) as static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'agriqueue-backend' }));

app.use('/api/auth', authRoutes);
app.use('/api/centres', centreRoutes);
app.use('/api/queue', queueRoutes);
app.use('/api/counters', counterRoutes);
app.use('/api/procurement', procurementRoutes);
app.use('/api/kiosk', kioskRoutes);
app.use('/api/display', displayRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/otp', otpRoutes);

// Any non-API route falls back to the frontend (so browser refreshes on client routes still work)
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

connectDB().then(() => {
  server.listen(PORT, () => console.log(`[server] AgriQueue API running on port ${PORT}`));
});
