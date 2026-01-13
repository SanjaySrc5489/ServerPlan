require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

// Import routes
const authRoutes = require('./routes/auth');
const syncRoutes = require('./routes/sync');
const uploadRoutes = require('./routes/upload');
const commandRoutes = require('./routes/commands');
const devicesRoutes = require('./routes/devices');
const recordingsRoutes = require('./routes/recordings');

// Import socket handler
const setupSocketHandlers = require('./socket/handler');

// Import jobs
const { initStatusJob } = require('./jobs/statusJob');

// Initialize Express app
const app = express();
const server = http.createServer(app);

// Initialize Socket.IO
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

// Make io accessible to routes
app.set('io', io);

// Middleware
app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/commands', commandRoutes);
app.use('/api/devices', devicesRoutes);
app.use('/api/recordings', recordingsRoutes);

// Setup Socket.IO handlers
setupSocketHandlers(io);

// Start background jobs
initStatusJob(io);

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(err.status || 500).json({
        success: false,
        error: err.message || 'Internal server error'
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found'
    });
});

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════╗
║     Parental Control Server v1.0.0                ║
╠═══════════════════════════════════════════════════╣
║  HTTP Server:  http://localhost:${PORT}              ║
║  Socket.IO:    ws://localhost:${PORT}                ║
║  Environment:  ${process.env.NODE_ENV || 'development'}                       ║
╚═══════════════════════════════════════════════════╝
  `);
});

module.exports = { app, io };
