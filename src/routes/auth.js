const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/db');
const { getOrCreateDevice } = require('../utils/deviceHelper');

const router = express.Router();

/**
 * POST /api/auth/register
 * Register a new device
 */
router.post('/register', async (req, res) => {
    try {
        const { deviceId, androidId, fcmToken, model, manufacturer, androidVersion, osVersion, appVersion, deviceName } = req.body;

        if (!deviceId && !androidId) {
            return res.status(400).json({
                success: false,
                error: 'Device ID or Android ID is required'
            });
        }

        // Strategy to prevent duplicates:
        // 1. If androidId is provided, try to find by it first (most reliable across reinstalls)
        // 2. If not found or androidId not provided, try find by deviceId (the app's UUID)

        let device = null;

        if (androidId) {
            device = await prisma.device.findUnique({ where: { androidId } });
        }

        if (!device && deviceId) {
            device = await prisma.device.findUnique({ where: { deviceId } });
        }

        const deviceData = {
            fcmToken,
            model: model || deviceName,
            manufacturer,
            androidVersion: androidVersion || osVersion,
            appVersion,
            isOnline: true,
            lastSeen: new Date(),
            // If we found a device but it didn't have androidId or deviceId set correctly, update them
            ...(androidId && { androidId }),
            ...(deviceId && { deviceId })
        };

        if (device) {
            // Update existing
            device = await prisma.device.update({
                where: { id: device.id },
                data: deviceData
            });
            console.log(`[AUTH] Device updated: ${device.id} (androidId: ${androidId}, deviceId: ${deviceId})`);
        } else {
            // Create new
            device = await prisma.device.create({
                data: {
                    ...deviceData,
                    deviceId: deviceId || `GEN-${Date.now()}` // Fallback if no deviceId
                }
            });
            console.log(`[AUTH] New device registered: ${device.id}`);
        }

        // Generate JWT token for device authentication
        const token = jwt.sign(
            { deviceId: device.deviceId, id: device.id, type: 'device' },
            process.env.JWT_SECRET || 'fallback-secret',
            { expiresIn: '365d' }
        );

        console.log(`[AUTH] Device registered/updated: ${deviceId} (${model})`);

        res.json({
            success: true,
            device: {
                id: device.id,
                deviceId: device.deviceId
            },
            token,
            data: { token } // Also in data for backwards compatibility
        });
    } catch (error) {
        console.error('[AUTH] Registration error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to register device'
        });
    }
});

/**
 * POST /api/auth/heartbeat
 * Update device online status and battery
 */
router.post('/heartbeat', async (req, res) => {
    try {
        const { deviceId, battery, isCharging, network } = req.body;
        const xDeviceId = req.headers['x-device-id'] || deviceId;

        if (!xDeviceId) {
            return res.status(400).json({ success: false, error: 'Device ID required' });
        }

        // Upsert device to ensure it exists and update status
        const device = await getOrCreateDevice(req);

        if (!device) {
            return res.status(400).json({ success: false, error: 'Device ID required' });
        }

        // Update additional fields (battery, etc.) if provided
        await prisma.device.update({
            where: { id: device.id },
            data: {
                ...(battery !== undefined && { battery: parseInt(battery) }),
                ...(isCharging !== undefined && { isCharging: !!isCharging }),
                ...(network !== undefined && { network })
            }
        });

        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            deviceId: device.deviceId
        });
    } catch (error) {
        console.error('[AUTH] Heartbeat error:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

/**
 * POST /api/auth/admin/login
 * Admin panel authentication
 */
router.post('/admin/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        // Check against environment variables
        const adminUsername = process.env.ADMIN_USERNAME || 'admin';
        const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

        if (username !== adminUsername || password !== adminPassword) {
            return res.status(401).json({
                success: false,
                error: 'Invalid credentials'
            });
        }

        // Generate JWT token
        const token = jwt.sign(
            { username, role: 'admin' },
            process.env.JWT_SECRET || 'fallback-secret',
            { expiresIn: '7d' }
        );

        res.json({
            success: true,
            token,
            user: { username, role: 'admin' }
        });
    } catch (error) {
        console.error('[AUTH] Login error:', error);
        res.status(500).json({
            success: false,
            error: 'Login failed'
        });
    }
});

/**
 * Middleware to verify admin JWT token
 */
const verifyAdmin = (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            success: false,
            error: 'No token provided'
        });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret');
        req.admin = decoded;
        next();
    } catch (error) {
        return res.status(401).json({
            success: false,
            error: 'Invalid token'
        });
    }
};

// Export middleware for use in other routes
router.verifyAdmin = verifyAdmin;

module.exports = router;
