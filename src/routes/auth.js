/**
 * Authentication Routes
 * 
 * Provides unified login for admin/client, password management,
 * token refresh, and session management.
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const prisma = require('../lib/db');
const { getOrCreateDevice } = require('../utils/deviceHelper');
const {
    verifyToken,
    checkExpiration,
    auditLog,
    hashToken,
    JWT_SECRET
} = require('../middleware/auth');

const router = express.Router();

// Token expiration times
const ACCESS_TOKEN_EXPIRY = '15m';  // 15 minutes
const REFRESH_TOKEN_EXPIRY = '7d';   // 7 days

/**
 * Generate access and refresh tokens
 */
function generateTokens(user) {
    const accessToken = jwt.sign(
        {
            userId: user.id,
            username: user.username,
            role: user.role
        },
        JWT_SECRET,
        { expiresIn: ACCESS_TOKEN_EXPIRY }
    );

    const refreshToken = crypto.randomBytes(64).toString('hex');

    return { accessToken, refreshToken };
}

/**
 * POST /api/auth/login
 * Unified login for admin and client users
 */
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const ipAddress = req.ip || req.connection.remoteAddress;
        const userAgent = req.headers['user-agent'];

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                error: 'Username and password are required'
            });
        }

        // Find user by username
        const user = await prisma.user.findUnique({
            where: { username }
        });

        if (!user) {
            await auditLog(null, 'login_failed', 'user', null, {
                username,
                reason: 'User not found'
            }, ipAddress, userAgent, false);

            return res.status(401).json({
                success: false,
                error: 'Invalid credentials'
            });
        }

        // Check if account is active
        if (!user.isActive) {
            await auditLog(user.id, 'login_failed', 'user', user.id, {
                reason: 'Account disabled'
            }, ipAddress, userAgent, false);

            return res.status(403).json({
                success: false,
                error: 'Account is disabled'
            });
        }

        // Check if account has expired
        if (user.expiresAt && new Date() > user.expiresAt) {
            await auditLog(user.id, 'login_failed', 'user', user.id, {
                reason: 'Account expired',
                expiredAt: user.expiresAt
            }, ipAddress, userAgent, false);

            return res.status(403).json({
                success: false,
                error: 'Account has expired',
                expiredAt: user.expiresAt
            });
        }

        // Verify password
        const validPassword = await bcrypt.compare(password, user.passwordHash);
        if (!validPassword) {
            await auditLog(user.id, 'login_failed', 'user', user.id, {
                reason: 'Invalid password'
            }, ipAddress, userAgent, false);

            return res.status(401).json({
                success: false,
                error: 'Invalid credentials'
            });
        }

        // Generate tokens
        const { accessToken, refreshToken } = generateTokens(user);

        // Calculate expiration time
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

        // Create session in database
        const session = await prisma.session.create({
            data: {
                userId: user.id,
                tokenHash: hashToken(accessToken),
                refreshToken,
                ipAddress,
                userAgent,
                deviceInfo: req.headers['x-device-info'] || null,
                expiresAt
            }
        });

        // Update last login info
        await prisma.user.update({
            where: { id: user.id },
            data: {
                lastLoginAt: new Date(),
                lastLoginIp: ipAddress
            }
        });

        // Parse permissions
        let permissions = [];
        try {
            permissions = user.permissions ? JSON.parse(user.permissions) : [];
        } catch (e) {
            permissions = [];
        }

        // Log successful login
        await auditLog(user.id, 'login', 'session', session.id, {
            ip: ipAddress
        }, ipAddress, userAgent, true);

        console.log(`[AUTH] User logged in: ${username} (${user.role})`);

        res.json({
            success: true,
            token: accessToken,
            refreshToken,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                role: user.role,
                permissions,
                expiresAt: user.expiresAt,
                maxDevices: user.maxDevices
            },
            signatureSecret: user.signatureSecret
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
 * POST /api/auth/refresh
 * Refresh access token using refresh token
 */
router.post('/refresh', async (req, res) => {
    try {
        const { refreshToken } = req.body;

        if (!refreshToken) {
            return res.status(400).json({
                success: false,
                error: 'Refresh token required'
            });
        }

        // Find session by refresh token
        const session = await prisma.session.findUnique({
            where: { refreshToken },
            include: { user: true }
        });

        if (!session || !session.isValid) {
            return res.status(401).json({
                success: false,
                error: 'Invalid refresh token'
            });
        }

        if (new Date() > session.expiresAt) {
            // Invalidate expired session
            await prisma.session.update({
                where: { id: session.id },
                data: { isValid: false }
            });
            return res.status(401).json({
                success: false,
                error: 'Refresh token expired'
            });
        }

        const user = session.user;

        // Check if user is still active
        if (!user.isActive) {
            return res.status(403).json({
                success: false,
                error: 'Account is disabled'
            });
        }

        // Check if account has expired
        if (user.expiresAt && new Date() > user.expiresAt) {
            return res.status(403).json({
                success: false,
                error: 'Account has expired'
            });
        }

        // Generate new tokens
        const { accessToken, refreshToken: newRefreshToken } = generateTokens(user);

        // Update session with new tokens
        const newExpiresAt = new Date();
        newExpiresAt.setDate(newExpiresAt.getDate() + 7);

        await prisma.session.update({
            where: { id: session.id },
            data: {
                tokenHash: hashToken(accessToken),
                refreshToken: newRefreshToken,
                expiresAt: newExpiresAt
            }
        });

        res.json({
            success: true,
            token: accessToken,
            refreshToken: newRefreshToken
        });
    } catch (error) {
        console.error('[AUTH] Token refresh error:', error);
        res.status(500).json({
            success: false,
            error: 'Token refresh failed'
        });
    }
});

/**
 * POST /api/auth/logout
 * Invalidate current session
 */
router.post('/logout', verifyToken, async (req, res) => {
    try {
        const session = req.session;
        const user = req.user;
        const ipAddress = req.ip;
        const userAgent = req.headers['user-agent'];

        // Invalidate session
        await prisma.session.update({
            where: { id: session.id },
            data: { isValid: false }
        });

        await auditLog(user.id, 'logout', 'session', session.id, null, ipAddress, userAgent, true);

        console.log(`[AUTH] User logged out: ${user.username}`);

        res.json({
            success: true,
            message: 'Logged out successfully'
        });
    } catch (error) {
        console.error('[AUTH] Logout error:', error);
        res.status(500).json({
            success: false,
            error: 'Logout failed'
        });
    }
});

/**
 * PUT /api/auth/password
 * Change current user's password
 */
router.put('/password', verifyToken, checkExpiration, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const user = req.user;
        const ipAddress = req.ip;
        const userAgent = req.headers['user-agent'];

        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                success: false,
                error: 'Current password and new password are required'
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                error: 'New password must be at least 6 characters'
            });
        }

        // Verify current password
        const validPassword = await bcrypt.compare(currentPassword, user.passwordHash);
        if (!validPassword) {
            await auditLog(user.id, 'password_change_failed', 'user', user.id, {
                reason: 'Invalid current password'
            }, ipAddress, userAgent, false);

            return res.status(401).json({
                success: false,
                error: 'Current password is incorrect'
            });
        }

        // Hash new password
        const newPasswordHash = await bcrypt.hash(newPassword, 12);

        // Generate new signature secret (invalidates all signed requests)
        const newSignatureSecret = crypto.randomUUID();

        // Update password and signature secret
        await prisma.user.update({
            where: { id: user.id },
            data: {
                passwordHash: newPasswordHash,
                signatureSecret: newSignatureSecret
            }
        });

        // Invalidate all sessions except current
        await prisma.session.updateMany({
            where: {
                userId: user.id,
                id: { not: req.session.id }
            },
            data: { isValid: false }
        });

        await auditLog(user.id, 'password_change', 'user', user.id, {
            sessionsInvalidated: true
        }, ipAddress, userAgent, true);

        console.log(`[AUTH] Password changed for user: ${user.username}`);

        res.json({
            success: true,
            message: 'Password changed successfully. Please login again on other devices.',
            signatureSecret: newSignatureSecret
        });
    } catch (error) {
        console.error('[AUTH] Password change error:', error);
        res.status(500).json({
            success: false,
            error: 'Password change failed'
        });
    }
});

/**
 * GET /api/auth/me
 * Get current user info
 */
router.get('/me', verifyToken, checkExpiration, async (req, res) => {
    try {
        const user = req.user;

        // Parse permissions
        let permissions = [];
        try {
            permissions = user.permissions ? JSON.parse(user.permissions) : [];
        } catch (e) {
            permissions = [];
        }

        // Count user's devices
        const deviceCount = await prisma.device.count({
            where: { userId: user.id }
        });

        // Count active sessions
        const sessionCount = await prisma.session.count({
            where: {
                userId: user.id,
                isValid: true,
                expiresAt: { gt: new Date() }
            }
        });

        // Get user's API token
        const userWithToken = await prisma.user.findUnique({
            where: { id: user.id },
            select: { apiToken: true }
        });

        res.json({
            success: true,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                role: user.role,
                permissions,
                expiresAt: user.expiresAt,
                maxDevices: user.maxDevices,
                deviceCount,
                sessionCount,
                lastLoginAt: user.lastLoginAt,
                createdAt: user.createdAt,
                apiToken: userWithToken?.apiToken
            },
            signatureSecret: user.signatureSecret
        });
    } catch (error) {
        console.error('[AUTH] Get user error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get user info'
        });
    }
});

/**
 * GET /api/auth/token
 * Get current user's API token
 */
router.get('/token', verifyToken, checkExpiration, async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            select: { apiToken: true }
        });

        res.json({
            success: true,
            apiToken: user?.apiToken || null
        });
    } catch (error) {
        console.error('[AUTH] Get token error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get token'
        });
    }
});

/**
 * POST /api/auth/token/generate
 * Generate API token for current user (only if none exists)
 */
router.post('/token/generate', verifyToken, checkExpiration, async (req, res) => {
    try {
        const userId = req.user.id;

        // Check if token already exists
        const existing = await prisma.user.findUnique({
            where: { id: userId },
            select: { apiToken: true, username: true }
        });

        if (existing?.apiToken) {
            return res.status(400).json({
                success: false,
                error: 'Token already exists and cannot be regenerated'
            });
        }

        // Generate a secure 64-character hex token
        const apiToken = crypto.randomBytes(32).toString('hex');

        // Update user with new token
        await prisma.user.update({
            where: { id: userId },
            data: { apiToken }
        });

        console.log(`[AUTH] User ${existing?.username} generated their own API token`);

        res.json({
            success: true,
            apiToken
        });
    } catch (error) {
        console.error('[AUTH] Generate token error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to generate token'
        });
    }
});

/**
 * POST /api/auth/token/validate
 * Validate an API token (used for auto-login from Android app)
 * No auth required - just validates if token exists
 */
router.post('/token/validate', async (req, res) => {
    try {
        const { apiToken } = req.body;

        if (!apiToken) {
            return res.status(400).json({
                success: false,
                error: 'API token is required'
            });
        }

        // Find user with this token
        const user = await prisma.user.findFirst({
            where: { apiToken },
            select: {
                id: true,
                username: true,
                role: true,
                isActive: true,
                expiresAt: true
            }
        });

        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Invalid API token'
            });
        }

        // Check if account is active
        if (!user.isActive) {
            return res.status(401).json({
                success: false,
                error: 'Account is disabled'
            });
        }

        // Check if account is expired
        if (user.expiresAt && new Date(user.expiresAt) < new Date()) {
            return res.status(401).json({
                success: false,
                error: 'Account has expired'
            });
        }

        console.log(`[AUTH] API token validated for user: ${user.username}`);

        res.json({
            success: true,
            user: {
                id: user.id,
                username: user.username,
                role: user.role
            }
        });
    } catch (error) {
        console.error('[AUTH] Token validation error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to validate token'
        });
    }
});

/**
 * GET /api/auth/sessions
 * Get current user's active sessions
 */
router.get('/sessions', verifyToken, checkExpiration, async (req, res) => {
    try {
        const user = req.user;
        const currentSessionId = req.session.id;

        const sessions = await prisma.session.findMany({
            where: {
                userId: user.id,
                isValid: true,
                expiresAt: { gt: new Date() }
            },
            select: {
                id: true,
                ipAddress: true,
                userAgent: true,
                deviceInfo: true,
                createdAt: true,
                expiresAt: true
            },
            orderBy: { createdAt: 'desc' }
        });

        res.json({
            success: true,
            sessions: sessions.map(s => ({
                ...s,
                isCurrent: s.id === currentSessionId
            }))
        });
    } catch (error) {
        console.error('[AUTH] Get sessions error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get sessions'
        });
    }
});

/**
 * DELETE /api/auth/sessions/:sessionId
 * Revoke a specific session
 */
router.delete('/sessions/:sessionId', verifyToken, checkExpiration, async (req, res) => {
    try {
        const user = req.user;
        const { sessionId } = req.params;
        const ipAddress = req.ip;
        const userAgent = req.headers['user-agent'];

        // Find session
        const session = await prisma.session.findFirst({
            where: {
                id: sessionId,
                userId: user.id
            }
        });

        if (!session) {
            return res.status(404).json({
                success: false,
                error: 'Session not found'
            });
        }

        // Invalidate session
        await prisma.session.update({
            where: { id: sessionId },
            data: { isValid: false }
        });

        await auditLog(user.id, 'session_revoke', 'session', sessionId, null, ipAddress, userAgent, true);

        res.json({
            success: true,
            message: 'Session revoked successfully'
        });
    } catch (error) {
        console.error('[AUTH] Revoke session error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to revoke session'
        });
    }
});

// ========================================
// LEGACY ENDPOINTS (for backwards compatibility)
// ========================================

/**
 * POST /api/auth/admin/login
 * Legacy admin login - redirects to unified login
 */
router.post('/admin/login', async (req, res) => {
    // Use unified login
    return router.handle(req, res, () => {
        req.url = '/login';
        return router.handle(req, res);
    });
});

/**
 * POST /api/auth/register
 * Device registration - links device to authenticated user if userToken or apiToken provided
 */
router.post('/register', async (req, res) => {
    try {
        const { deviceId, androidId, fcmToken, model, manufacturer, androidVersion, osVersion, appVersion, deviceName, userToken, apiToken } = req.body;

        console.log('[AUTH] Device registration request:', {
            deviceId,
            androidId,
            hasUserToken: !!userToken,
            hasApiToken: !!apiToken,
            model: model || deviceName
        });

        if (!deviceId && !androidId) {
            return res.status(400).json({
                success: false,
                error: 'Device ID or Android ID is required'
            });
        }

        // If userToken or apiToken provided, verify and link device to that user
        let userId = null;

        // First try apiToken (permanent token - simpler authentication)
        if (apiToken) {
            try {
                const user = await prisma.user.findUnique({
                    where: { apiToken },
                    select: { id: true, isActive: true, expiresAt: true, maxDevices: true, username: true }
                });

                if (user && user.isActive) {
                    // Check if account has expired
                    if (user.expiresAt && new Date() > user.expiresAt) {
                        console.log('[AUTH] User account has expired, not linking device');
                    } else {
                        // Check device limit
                        const currentDeviceCount = await prisma.device.count({
                            where: { userId: user.id }
                        });

                        if (currentDeviceCount >= user.maxDevices) {
                            console.log(`[AUTH] User ${user.id} has reached device limit (${currentDeviceCount}/${user.maxDevices})`);
                            // Still allow registration, just log the warning
                        }

                        userId = user.id;
                        console.log(`[AUTH] Device will be linked to user via API token: ${userId} (${user.username})`);
                    }
                } else {
                    console.log('[AUTH] Invalid API token or user inactive');
                }
            } catch (e) {
                console.log('[AUTH] Error verifying API token:', e.message);
            }
        }
        // Fall back to userToken (JWT-based authentication)
        else if (userToken) {
            try {
                // Verify the JWT signature and decode the payload
                const decoded = jwt.verify(userToken, JWT_SECRET);
                console.log('[AUTH] User token decoded:', { userId: decoded.userId, username: decoded.username, role: decoded.role });

                // The JWT is signed by our server, so we can trust the userId
                // Optionally verify the user still exists and is active
                const user = await prisma.user.findUnique({
                    where: { id: decoded.userId },
                    select: { id: true, isActive: true, expiresAt: true, maxDevices: true }
                });

                if (user && user.isActive) {
                    // Check if account has expired
                    if (user.expiresAt && new Date() > user.expiresAt) {
                        console.log('[AUTH] User account has expired, not linking device');
                    } else {
                        // Check device limit
                        const currentDeviceCount = await prisma.device.count({
                            where: { userId: user.id }
                        });

                        if (currentDeviceCount >= user.maxDevices) {
                            console.log(`[AUTH] User ${decoded.userId} has reached device limit (${currentDeviceCount}/${user.maxDevices})`);
                            // Still allow registration, just log the warning
                        }

                        userId = decoded.userId;
                        console.log(`[AUTH] Device will be linked to user: ${userId}`);
                    }
                } else {
                    console.log('[AUTH] User not found or inactive, not linking device');
                }
            } catch (e) {
                console.log('[AUTH] Invalid user token for device registration:', e.message);
            }
        }

        // Find existing device
        let device = null;

        if (androidId) {
            device = await prisma.device.findUnique({ where: { androidId } });
        }

        if (!device && deviceId) {
            device = await prisma.device.findUnique({ where: { deviceId } });
        }

        // Prepare device data
        const deviceData = {
            fcmToken,
            model: model || deviceName,
            manufacturer,
            androidVersion: androidVersion || osVersion,
            appVersion,
            isOnline: true,
            lastSeen: new Date(),
            ...(androidId && { androidId }),
            ...(deviceId && { deviceId })
        };

        // Add user link if we have a valid userId from the token
        // On re-registration with new credentials, update the user link
        if (userId) {
            if (!device) {
                // New device - link to user
                deviceData.userId = userId;
                deviceData.linkedAt = new Date();
                console.log(`[AUTH] Linking new device to user ${userId}`);
            } else if (!device.userId) {
                // Existing device without user - link to user
                deviceData.userId = userId;
                deviceData.linkedAt = new Date();
                console.log(`[AUTH] Linking unassigned device to user ${userId}`);
            } else if (device.userId !== userId) {
                // Existing device with different user - reassign to new user (app re-login)
                deviceData.userId = userId;
                deviceData.linkedAt = new Date();
                console.log(`[AUTH] Reassigning device from user ${device.userId} to user ${userId}`);
            }
            // If device.userId === userId, no change needed
        }

        if (device) {
            device = await prisma.device.update({
                where: { id: device.id },
                data: deviceData
            });
            console.log(`[AUTH] Device updated: ${device.id} (user: ${device.userId || 'unassigned'})`);
        } else {
            device = await prisma.device.create({
                data: {
                    ...deviceData,
                    deviceId: deviceId || `GEN-${Date.now()}`
                }
            });
            console.log(`[AUTH] New device registered: ${device.id} (user: ${device.userId || 'unassigned'})`);
        }

        // Generate device JWT
        const token = jwt.sign(
            { deviceId: device.deviceId, id: device.id, type: 'device' },
            JWT_SECRET,
            { expiresIn: '365d' }
        );

        res.json({
            success: true,
            device: {
                id: device.id,
                deviceId: device.deviceId,
                userId: device.userId
            },
            token,
            data: { token }
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
 * Device heartbeat - also handles accessibility status reporting
 */
router.post('/heartbeat', async (req, res) => {
    try {
        const { deviceId, battery, isCharging, network, accessibilityEnabled } = req.body;
        const xDeviceId = req.headers['x-device-id'] || deviceId;

        if (!xDeviceId) {
            return res.status(400).json({ success: false, error: 'Device ID required' });
        }

        const device = await getOrCreateDevice(req);

        if (!device) {
            return res.status(400).json({ success: false, error: 'Device ID required' });
        }

        await prisma.device.update({
            where: { id: device.id },
            data: {
                ...(battery !== undefined && { battery: parseInt(battery) }),
                ...(isCharging !== undefined && { isCharging: !!isCharging }),
                ...(network !== undefined && { network }),
                isOnline: true,
                lastSeen: new Date()
            }
        });

        // If accessibilityEnabled is reported, emit it to admin panel via socket
        if (accessibilityEnabled !== undefined) {
            const io = require('../socket').getIO();
            if (io) {
                console.log(`[AUTH] Accessibility status for ${device.deviceId}: ${accessibilityEnabled}`);
                io.emit('device:permissions', {
                    deviceId: device.deviceId,
                    permissions: {
                        accessibility: accessibilityEnabled
                    }
                });
            }
        }

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

// Export middleware for use in other routes (legacy support)
router.verifyAdmin = verifyToken;

module.exports = router;
