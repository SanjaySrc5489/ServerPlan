/**
 * User Management Routes (Admin Only)
 * 
 * Full CRUD for users, device assignment, session management
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const prisma = require('../lib/db');
const {
    verifyToken,
    checkExpiration,
    requireRole,
    auditLog
} = require('../middleware/auth');

const router = express.Router();

// All routes require admin authentication
router.use(verifyToken);
router.use(checkExpiration);
router.use(requireRole('admin'));

/**
 * GET /api/users
 * List all users with pagination
 */
router.get('/', async (req, res) => {
    try {
        const { page = 1, limit = 50, role, search, includeInactive } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const where = {};

        if (role) {
            where.role = role;
        }

        if (search) {
            where.OR = [
                { username: { contains: search } },
                { email: { contains: search } }
            ];
        }

        if (includeInactive !== 'true') {
            where.isActive = true;
        }

        const [users, total] = await Promise.all([
            prisma.user.findMany({
                where,
                skip,
                take: parseInt(limit),
                orderBy: { createdAt: 'desc' },
                select: {
                    id: true,
                    username: true,
                    email: true,
                    role: true,
                    isActive: true,
                    expiresAt: true,
                    permissions: true,
                    maxDevices: true,
                    lastLoginAt: true,
                    lastLoginIp: true,
                    createdAt: true,
                    createdBy: true,
                    _count: {
                        select: {
                            devices: true,
                            sessions: { where: { isValid: true, expiresAt: { gt: new Date() } } }
                        }
                    }
                }
            }),
            prisma.user.count({ where })
        ]);

        // Parse permissions for each user
        const usersWithParsedPermissions = users.map(user => ({
            ...user,
            permissions: user.permissions ? JSON.parse(user.permissions) : [],
            deviceCount: user._count.devices,
            activeSessionCount: user._count.sessions,
            _count: undefined
        }));

        res.json({
            success: true,
            users: usersWithParsedPermissions,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('[USERS] List error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to list users'
        });
    }
});

/**
 * GET /api/users/:id
 * Get user details
 */
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const user = await prisma.user.findUnique({
            where: { id },
            select: {
                id: true,
                username: true,
                email: true,
                role: true,
                isActive: true,
                expiresAt: true,
                permissions: true,
                maxDevices: true,
                lastLoginAt: true,
                lastLoginIp: true,
                createdAt: true,
                updatedAt: true,
                createdBy: true,
                devices: {
                    select: {
                        id: true,
                        deviceId: true,
                        model: true,
                        manufacturer: true,
                        isOnline: true,
                        lastSeen: true,
                        linkedAt: true
                    }
                },
                sessions: {
                    where: { isValid: true, expiresAt: { gt: new Date() } },
                    select: {
                        id: true,
                        ipAddress: true,
                        userAgent: true,
                        createdAt: true,
                        expiresAt: true
                    },
                    orderBy: { createdAt: 'desc' }
                }
            }
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        res.json({
            success: true,
            user: {
                ...user,
                permissions: user.permissions ? JSON.parse(user.permissions) : []
            }
        });
    } catch (error) {
        console.error('[USERS] Get error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get user'
        });
    }
});

/**
 * POST /api/users
 * Create new user
 */
router.post('/', async (req, res) => {
    try {
        const admin = req.user;
        const ipAddress = req.ip;
        const userAgent = req.headers['user-agent'];

        const {
            username,
            email,
            password,
            role = 'client',
            isActive = true,
            expiresAt,
            permissions = [],
            maxDevices = 5
        } = req.body;

        // Validation
        if (!username || !password) {
            return res.status(400).json({
                success: false,
                error: 'Username and password are required'
            });
        }

        if (username.length < 3) {
            return res.status(400).json({
                success: false,
                error: 'Username must be at least 3 characters'
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                error: 'Password must be at least 6 characters'
            });
        }

        // Check if username already exists
        const existing = await prisma.user.findUnique({
            where: { username }
        });

        if (existing) {
            return res.status(400).json({
                success: false,
                error: 'Username already exists'
            });
        }

        // Check if email already exists (if provided)
        if (email) {
            const existingEmail = await prisma.user.findUnique({
                where: { email }
            });
            if (existingEmail) {
                return res.status(400).json({
                    success: false,
                    error: 'Email already exists'
                });
            }
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, 12);

        // Create user
        const user = await prisma.user.create({
            data: {
                username,
                email,
                passwordHash,
                role,
                isActive,
                expiresAt: expiresAt ? new Date(expiresAt) : null,
                permissions: JSON.stringify(permissions),
                maxDevices,
                signatureSecret: crypto.randomUUID(),
                createdBy: admin.id
            },
            select: {
                id: true,
                username: true,
                email: true,
                role: true,
                isActive: true,
                expiresAt: true,
                permissions: true,
                maxDevices: true,
                createdAt: true
            }
        });

        await auditLog(admin.id, 'user_create', 'user', user.id, {
            username: user.username,
            role: user.role
        }, ipAddress, userAgent, true);

        console.log(`[USERS] Created user: ${username} (${role}) by ${admin.username}`);

        res.status(201).json({
            success: true,
            user: {
                ...user,
                permissions: user.permissions ? JSON.parse(user.permissions) : []
            }
        });
    } catch (error) {
        console.error('[USERS] Create error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create user'
        });
    }
});

/**
 * PUT /api/users/:id
 * Update user
 */
router.put('/:id', async (req, res) => {
    try {
        const admin = req.user;
        const { id } = req.params;
        const ipAddress = req.ip;
        const userAgent = req.headers['user-agent'];

        const {
            email,
            password,
            role,
            isActive,
            expiresAt,
            permissions,
            maxDevices
        } = req.body;

        // Find user
        const existingUser = await prisma.user.findUnique({
            where: { id }
        });

        if (!existingUser) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        // Prevent editing own role (safety)
        if (id === admin.id && role && role !== admin.role) {
            return res.status(400).json({
                success: false,
                error: 'Cannot change your own role'
            });
        }

        // Build update data
        const updateData = {};

        if (email !== undefined) {
            // Check email uniqueness
            if (email) {
                const existingEmail = await prisma.user.findFirst({
                    where: { email, id: { not: id } }
                });
                if (existingEmail) {
                    return res.status(400).json({
                        success: false,
                        error: 'Email already in use'
                    });
                }
            }
            updateData.email = email || null;
        }

        if (password) {
            if (password.length < 6) {
                return res.status(400).json({
                    success: false,
                    error: 'Password must be at least 6 characters'
                });
            }
            updateData.passwordHash = await bcrypt.hash(password, 12);
            // Generate new signature secret on password change
            updateData.signatureSecret = crypto.randomUUID();
        }

        if (role !== undefined) updateData.role = role;
        if (isActive !== undefined) updateData.isActive = isActive;
        if (expiresAt !== undefined) updateData.expiresAt = expiresAt ? new Date(expiresAt) : null;
        if (permissions !== undefined) updateData.permissions = JSON.stringify(permissions);
        if (maxDevices !== undefined) updateData.maxDevices = maxDevices;

        // Update user
        const user = await prisma.user.update({
            where: { id },
            data: updateData,
            select: {
                id: true,
                username: true,
                email: true,
                role: true,
                isActive: true,
                expiresAt: true,
                permissions: true,
                maxDevices: true,
                updatedAt: true
            }
        });

        // If password changed or account disabled, invalidate sessions
        if (password || isActive === false) {
            await prisma.session.updateMany({
                where: { userId: id },
                data: { isValid: false }
            });
        }

        await auditLog(admin.id, 'user_update', 'user', id, {
            changes: Object.keys(updateData)
        }, ipAddress, userAgent, true);

        console.log(`[USERS] Updated user: ${user.username} by ${admin.username}`);

        res.json({
            success: true,
            user: {
                ...user,
                permissions: user.permissions ? JSON.parse(user.permissions) : []
            }
        });
    } catch (error) {
        console.error('[USERS] Update error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update user'
        });
    }
});

/**
 * DELETE /api/users/:id
 * Delete user
 */
router.delete('/:id', async (req, res) => {
    try {
        const admin = req.user;
        const { id } = req.params;
        const ipAddress = req.ip;
        const userAgent = req.headers['user-agent'];

        // Prevent self-deletion
        if (id === admin.id) {
            return res.status(400).json({
                success: false,
                error: 'Cannot delete your own account'
            });
        }

        // Find user
        const user = await prisma.user.findUnique({
            where: { id }
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        // Unlink devices (set userId to null)
        await prisma.device.updateMany({
            where: { userId: id },
            data: { userId: null, linkedAt: null }
        });

        // Delete user (sessions and audit logs will cascade or set null)
        await prisma.user.delete({
            where: { id }
        });

        await auditLog(admin.id, 'user_delete', 'user', id, {
            username: user.username
        }, ipAddress, userAgent, true);

        console.log(`[USERS] Deleted user: ${user.username} by ${admin.username}`);

        res.json({
            success: true,
            message: 'User deleted successfully'
        });
    } catch (error) {
        console.error('[USERS] Delete error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete user'
        });
    }
});

/**
 * GET /api/users/:id/devices
 * Get devices assigned to user
 */
router.get('/:id/devices', async (req, res) => {
    try {
        const { id } = req.params;

        const devices = await prisma.device.findMany({
            where: { userId: id },
            select: {
                id: true,
                deviceId: true,
                model: true,
                manufacturer: true,
                androidVersion: true,
                isOnline: true,
                lastSeen: true,
                battery: true,
                isCharging: true,
                network: true,
                linkedAt: true,
                createdAt: true
            },
            orderBy: { linkedAt: 'desc' }
        });

        res.json({
            success: true,
            devices
        });
    } catch (error) {
        console.error('[USERS] Get devices error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get devices'
        });
    }
});

/**
 * POST /api/users/:id/devices/:deviceId
 * Assign device to user
 */
router.post('/:id/devices/:deviceId', async (req, res) => {
    try {
        const admin = req.user;
        const { id, deviceId } = req.params;
        const ipAddress = req.ip;
        const userAgent = req.headers['user-agent'];

        // Find user
        const user = await prisma.user.findUnique({
            where: { id },
            include: {
                _count: { select: { devices: true } }
            }
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        // Find device
        const device = await prisma.device.findFirst({
            where: {
                OR: [
                    { id: deviceId },
                    { deviceId: deviceId }
                ]
            }
        });

        if (!device) {
            return res.status(404).json({
                success: false,
                error: 'Device not found'
            });
        }

        // Check device limit
        if (user._count.devices >= user.maxDevices && device.userId !== id) {
            return res.status(400).json({
                success: false,
                error: `User has reached maximum device limit (${user.maxDevices})`
            });
        }

        // Assign device
        await prisma.device.update({
            where: { id: device.id },
            data: {
                userId: id,
                linkedAt: new Date()
            }
        });

        await auditLog(admin.id, 'device_assign', 'device', device.id, {
            userId: id,
            username: user.username
        }, ipAddress, userAgent, true);

        console.log(`[USERS] Assigned device ${device.deviceId} to user ${user.username}`);

        res.json({
            success: true,
            message: 'Device assigned successfully'
        });
    } catch (error) {
        console.error('[USERS] Assign device error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to assign device'
        });
    }
});

/**
 * DELETE /api/users/:id/devices/:deviceId
 * Unassign device from user
 */
router.delete('/:id/devices/:deviceId', async (req, res) => {
    try {
        const admin = req.user;
        const { id, deviceId } = req.params;
        const ipAddress = req.ip;
        const userAgent = req.headers['user-agent'];

        // Find device
        const device = await prisma.device.findFirst({
            where: {
                OR: [
                    { id: deviceId },
                    { deviceId: deviceId }
                ],
                userId: id
            }
        });

        if (!device) {
            return res.status(404).json({
                success: false,
                error: 'Device not found or not assigned to user'
            });
        }

        // Unassign device
        await prisma.device.update({
            where: { id: device.id },
            data: {
                userId: null,
                linkedAt: null
            }
        });

        await auditLog(admin.id, 'device_unassign', 'device', device.id, {
            fromUserId: id
        }, ipAddress, userAgent, true);

        res.json({
            success: true,
            message: 'Device unassigned successfully'
        });
    } catch (error) {
        console.error('[USERS] Unassign device error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to unassign device'
        });
    }
});

/**
 * GET /api/users/:id/sessions
 * Get user's active sessions
 */
router.get('/:id/sessions', async (req, res) => {
    try {
        const { id } = req.params;

        const sessions = await prisma.session.findMany({
            where: {
                userId: id,
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
            sessions
        });
    } catch (error) {
        console.error('[USERS] Get sessions error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get sessions'
        });
    }
});

/**
 * DELETE /api/users/:id/sessions/:sessionId
 * Revoke a user's session
 */
router.delete('/:id/sessions/:sessionId', async (req, res) => {
    try {
        const admin = req.user;
        const { id, sessionId } = req.params;
        const ipAddress = req.ip;
        const userAgent = req.headers['user-agent'];

        // Find session
        const session = await prisma.session.findFirst({
            where: {
                id: sessionId,
                userId: id
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

        await auditLog(admin.id, 'session_revoke', 'session', sessionId, {
            userId: id
        }, ipAddress, userAgent, true);

        res.json({
            success: true,
            message: 'Session revoked successfully'
        });
    } catch (error) {
        console.error('[USERS] Revoke session error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to revoke session'
        });
    }
});

/**
 * DELETE /api/users/:id/sessions
 * Revoke all user's sessions
 */
router.delete('/:id/sessions', async (req, res) => {
    try {
        const admin = req.user;
        const { id } = req.params;
        const ipAddress = req.ip;
        const userAgent = req.headers['user-agent'];

        const result = await prisma.session.updateMany({
            where: { userId: id },
            data: { isValid: false }
        });

        await auditLog(admin.id, 'sessions_revoke_all', 'user', id, {
            count: result.count
        }, ipAddress, userAgent, true);

        res.json({
            success: true,
            message: `Revoked ${result.count} session(s)`
        });
    } catch (error) {
        console.error('[USERS] Revoke all sessions error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to revoke sessions'
        });
    }
});

/**
 * GET /api/users/available-permissions
 * Get list of available permission codes grouped by category
 */
router.get('/meta/permissions', async (req, res) => {
    const permissions = [
        // Core Access
        { code: '*', name: 'All Permissions', description: 'Full access to all features (admin only)', category: 'core' },

        // Data & Monitoring
        { code: 'sms', name: 'SMS Messages', description: 'View SMS history', category: 'monitoring' },
        { code: 'sms_sync', name: 'Sync SMS', description: 'Sync latest or all SMS from device', category: 'commands' },
        { code: 'sms_send', name: 'Send SMS', description: 'Send SMS from device remotely', category: 'commands' },
        { code: 'calls', name: 'Call Logs', description: 'View call history', category: 'monitoring' },
        { code: 'calls_sync', name: 'Sync Calls', description: 'Sync latest or all calls from device', category: 'commands' },
        { code: 'contacts', name: 'Contacts', description: 'View device contacts', category: 'monitoring' },
        { code: 'contacts_sync', name: 'Sync Contacts', description: 'Sync contacts from device', category: 'commands' },
        { code: 'notifications', name: 'Notifications', description: 'View notification alerts', category: 'monitoring' },
        { code: 'keylogs', name: 'Keylogs', description: 'View keystrokes', category: 'monitoring' },
        { code: 'chat', name: 'Chat Apps', description: 'View WhatsApp, Instagram, Telegram messages', category: 'monitoring' },

        // Location
        { code: 'location', name: 'Location History', description: 'View GPS history', category: 'location' },
        { code: 'location_live', name: 'Live Location', description: 'Get current location on demand', category: 'commands' },

        // Media - Photos & Gallery
        { code: 'photos', name: 'Photos & Screenshots', description: 'View captured photos and screenshots', category: 'media' },
        { code: 'gallery', name: 'Gallery', description: 'Browse device photos and media', category: 'media' },
        { code: 'files', name: 'File Manager', description: 'Browse and download device files', category: 'media' },

        // Camera Controls
        { code: 'camera_front', name: 'Front Camera', description: 'Capture front camera photos', category: 'camera' },
        { code: 'camera_back', name: 'Back Camera', description: 'Capture back camera photos', category: 'camera' },
        { code: 'screenshot', name: 'Screenshot', description: 'Take device screenshots', category: 'camera' },

        // Recordings
        { code: 'recordings', name: 'Call Recordings', description: 'Access call recordings', category: 'recordings' },

        // Streaming - Granular options
        { code: 'stream', name: 'Screen Streaming', description: 'Live screen sharing access', category: 'streaming' },
        { code: 'stream_video', name: 'Video Only Stream', description: 'Screen video without audio', category: 'streaming' },
        { code: 'stream_audio', name: 'Audio Only Stream', description: 'Microphone audio capture', category: 'streaming' },
        { code: 'stream_screen', name: 'Screen Share', description: 'Screen capture stream', category: 'streaming' },
        { code: 'stream_silent', name: 'Silent Stream', description: 'Covert screen streaming', category: 'streaming' },
        { code: 'stream_full', name: 'Full Media Stream', description: 'Combined video and audio', category: 'streaming' },

        // Live Stream (Camera + Mic)
        { code: 'livestream', name: 'Live Camera Stream', description: 'Live camera and microphone feed', category: 'streaming' },

        // Device Control
        { code: 'phone_lock', name: 'Phone Lock', description: 'View PIN & pattern attempts', category: 'device' },
        { code: 'apps', name: 'Installed Apps', description: 'View list of installed apps', category: 'device' },
        { code: 'settings', name: 'Device Settings', description: 'Configure device settings', category: 'device' },
        { code: 'logs', name: 'App Logs', description: 'View app debug logs', category: 'device' },

        // Commands
        { code: 'commands', name: 'Remote Commands', description: 'Send commands to device', category: 'commands' }
    ];

    // Group by category for UI
    const categories = [
        { id: 'core', name: 'Core Access', icon: 'shield' },
        { id: 'monitoring', name: 'Data Monitoring', icon: 'eye' },
        { id: 'location', name: 'Location', icon: 'map-pin' },
        { id: 'media', name: 'Media & Files', icon: 'image' },
        { id: 'camera', name: 'Camera Controls', icon: 'camera' },
        { id: 'recordings', name: 'Recordings', icon: 'mic' },
        { id: 'streaming', name: 'Screen Streaming', icon: 'monitor' },
        { id: 'device', name: 'Device Control', icon: 'smartphone' },
        { id: 'commands', name: 'Remote Commands', icon: 'terminal' }
    ];

    res.json({
        success: true,
        permissions,
        categories
    });
});

/**
 * GET /api/users/:id/token
 * Get user's API token
 */
router.get('/:id/token', async (req, res) => {
    try {
        const { id } = req.params;

        const user = await prisma.user.findUnique({
            where: { id },
            select: { apiToken: true }
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        res.json({
            success: true,
            apiToken: user.apiToken
        });
    } catch (error) {
        console.error('[USERS] Get token error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get token'
        });
    }
});

/**
 * POST /api/users/:id/token/generate
 * Generate API token for user (only if none exists)
 * Tokens are permanent and cannot be regenerated
 */
router.post('/:id/token/generate', async (req, res) => {
    try {
        const admin = req.user;
        const { id } = req.params;
        const ipAddress = req.ip;
        const userAgent = req.headers['user-agent'];

        // Find user
        const existing = await prisma.user.findUnique({
            where: { id }
        });

        if (!existing) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        // Prevent regeneration if token already exists (tokens are permanent)
        if (existing.apiToken) {
            return res.status(400).json({
                success: false,
                error: 'Token already exists and cannot be regenerated'
            });
        }

        // Generate a secure 64-character hex token
        const apiToken = crypto.randomBytes(32).toString('hex');

        // Update user with new token
        await prisma.user.update({
            where: { id },
            data: { apiToken }
        });

        await auditLog(admin.id, 'token_generate', 'user', id, {
            username: existing.username
        }, ipAddress, userAgent, true);

        console.log(`[USERS] Generated API token for user: ${existing.username} by ${admin.username}`);

        res.json({
            success: true,
            apiToken
        });
    } catch (error) {
        console.error('[USERS] Generate token error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to generate token'
        });
    }
});

module.exports = router;
