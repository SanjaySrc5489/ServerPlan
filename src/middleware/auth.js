/**
 * Authentication & Authorization Middleware
 * 
 * Provides comprehensive security middleware stack:
 * - JWT token verification
 * - Account expiration checking
 * - Role-based access control
 * - Feature permission checking
 * - Request signature validation (HMAC-SHA256)
 * - Audit logging
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const prisma = require('../lib/db');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-change-in-production';
const SIGNATURE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes for replay prevention

// Used nonces (in production, use Redis with TTL)
const usedNonces = new Map();

// Clean up old nonces periodically
setInterval(() => {
    const cutoff = Date.now() - SIGNATURE_WINDOW_MS * 2;
    for (const [nonce, timestamp] of usedNonces.entries()) {
        if (timestamp < cutoff) {
            usedNonces.delete(nonce);
        }
    }
}, 60000);

/**
 * Extract user info from JWT token
 */
function extractUserFromToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (error) {
        return null;
    }
}

/**
 * Hash a token for storage (don't store raw JWT)
 */
function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Generate HMAC-SHA256 signature
 */
function generateSignature(secret, method, path, timestamp, nonce, body = '') {
    const payload = `${method.toUpperCase()}:${path}:${timestamp}:${nonce}:${body}`;
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Verify JWT token and attach user to request
 * Required for all authenticated endpoints
 */
const verifyToken = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        const token = authHeader.split(' ')[1];
        const decoded = extractUserFromToken(token);

        if (!decoded) {
            return res.status(401).json({
                success: false,
                error: 'Invalid or expired token'
            });
        }

        // Check if token is still valid in database
        const tokenHash = hashToken(token);
        const session = await prisma.session.findUnique({
            where: { tokenHash },
            include: { user: true }
        });

        if (!session || !session.isValid) {
            return res.status(401).json({
                success: false,
                error: 'Session expired or revoked'
            });
        }

        if (new Date() > session.expiresAt) {
            // Mark session as invalid
            await prisma.session.update({
                where: { id: session.id },
                data: { isValid: false }
            });
            return res.status(401).json({
                success: false,
                error: 'Session expired'
            });
        }

        // Attach user to request
        req.user = session.user;
        req.session = session;
        req.tokenHash = tokenHash;

        next();
    } catch (error) {
        console.error('[AUTH] Token verification error:', error);
        return res.status(401).json({
            success: false,
            error: 'Authentication failed'
        });
    }
};

/**
 * Check if user account has expired
 */
const checkExpiration = async (req, res, next) => {
    try {
        const user = req.user;

        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'User not found'
            });
        }

        if (!user.isActive) {
            return res.status(403).json({
                success: false,
                error: 'Account is disabled'
            });
        }

        if (user.expiresAt && new Date() > user.expiresAt) {
            return res.status(403).json({
                success: false,
                error: 'Account has expired',
                expiredAt: user.expiresAt
            });
        }

        next();
    } catch (error) {
        console.error('[AUTH] Expiration check error:', error);
        return res.status(500).json({
            success: false,
            error: 'Authorization check failed'
        });
    }
};

/**
 * Require specific role(s) for access
 * Usage: requireRole('admin') or requireRole(['admin', 'moderator'])
 */
const requireRole = (roles) => {
    const allowedRoles = Array.isArray(roles) ? roles : [roles];

    return (req, res, next) => {
        const user = req.user;

        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        if (!allowedRoles.includes(user.role)) {
            return res.status(403).json({
                success: false,
                error: 'Insufficient permissions',
                required: allowedRoles,
                current: user.role
            });
        }

        next();
    };
};

/**
 * Check if user has specific feature permission
 * Usage: checkPermission('sms') or checkPermission(['sms', 'calls'])
 */
const checkPermission = (features) => {
    const requiredFeatures = Array.isArray(features) ? features : [features];

    return (req, res, next) => {
        const user = req.user;

        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        // Admin with "*" has all permissions
        let userPermissions = [];
        try {
            userPermissions = user.permissions ? JSON.parse(user.permissions) : [];
        } catch (e) {
            userPermissions = [];
        }

        // Check for wildcard permission
        if (userPermissions.includes('*')) {
            return next();
        }

        // Check if user has all required permissions
        const hasPermission = requiredFeatures.every(f => userPermissions.includes(f));

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                error: 'Feature access denied',
                required: requiredFeatures,
                granted: userPermissions
            });
        }

        next();
    };
};

/**
 * Validate request signature (HMAC-SHA256)
 * Prevents request tampering and replay attacks
 */
const validateSignature = async (req, res, next) => {
    try {
        const user = req.user;

        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required for signature validation'
            });
        }

        const timestamp = req.headers['x-timestamp'];
        const nonce = req.headers['x-nonce'];
        const signature = req.headers['x-signature'];

        // Skip signature validation in development if not provided
        if (process.env.NODE_ENV !== 'production' && !signature) {
            return next();
        }

        if (!timestamp || !nonce || !signature) {
            return res.status(400).json({
                success: false,
                error: 'Missing signature headers'
            });
        }

        // Check timestamp is within acceptable window
        const requestTime = parseInt(timestamp, 10);
        const now = Date.now();

        if (Math.abs(now - requestTime) > SIGNATURE_WINDOW_MS) {
            return res.status(400).json({
                success: false,
                error: 'Request timestamp out of range'
            });
        }

        // Check for replay attack (nonce reuse)
        if (usedNonces.has(nonce)) {
            await auditLog(user.id, 'signature_replay', null, null, {
                nonce,
                ip: req.ip
            }, req.ip, req.headers['user-agent'], false);

            return res.status(400).json({
                success: false,
                error: 'Replay attack detected'
            });
        }

        // Mark nonce as used
        usedNonces.set(nonce, now);

        // Generate expected signature
        const body = req.method !== 'GET' ? JSON.stringify(req.body) : '';
        const path = req.originalUrl || req.url;
        const expectedSignature = generateSignature(
            user.signatureSecret,
            req.method,
            path,
            timestamp,
            nonce,
            body
        );

        // Constant-time comparison to prevent timing attacks
        const isValid = crypto.timingSafeEqual(
            Buffer.from(signature),
            Buffer.from(expectedSignature)
        );

        if (!isValid) {
            await auditLog(user.id, 'signature_invalid', null, null, {
                path,
                method: req.method,
                ip: req.ip
            }, req.ip, req.headers['user-agent'], false);

            return res.status(400).json({
                success: false,
                error: 'Invalid request signature - request may have been tampered'
            });
        }

        next();
    } catch (error) {
        console.error('[AUTH] Signature validation error:', error);
        return res.status(500).json({
            success: false,
            error: 'Signature validation failed'
        });
    }
};

/**
 * Log security-related action to audit log
 */
const auditLog = async (userId, action, targetType, targetId, details, ipAddress, userAgent, success = true) => {
    try {
        await prisma.auditLog.create({
            data: {
                userId,
                action,
                targetType,
                targetId,
                details: details ? JSON.stringify(details) : null,
                ipAddress,
                userAgent,
                success
            }
        });
    } catch (error) {
        console.error('[AUDIT] Failed to log action:', error);
    }
};

/**
 * Middleware to automatically log requests
 */
const auditLogMiddleware = (action, getTarget = null) => {
    return async (req, res, next) => {
        // Store original json method to intercept response
        const originalJson = res.json;
        res.json = function (data) {
            // Log after response is sent
            const success = data?.success !== false;
            const targetType = getTarget ? getTarget(req)?.type : null;
            const targetId = getTarget ? getTarget(req)?.id : null;

            auditLog(
                req.user?.id,
                action,
                targetType,
                targetId,
                { path: req.path, method: req.method },
                req.ip,
                req.headers['user-agent'],
                success
            );

            return originalJson.call(this, data);
        };
        next();
    };
};

/**
 * Filter devices based on user ownership
 * Admin sees all, clients see only their devices
 */
const filterDevices = async (req, res, next) => {
    const user = req.user;

    if (!user) {
        return res.status(401).json({
            success: false,
            error: 'Authentication required'
        });
    }

    // Admin sees all devices
    if (user.role === 'admin') {
        req.deviceFilter = {}; // No filter
    } else {
        // Client only sees their own devices
        req.deviceFilter = { userId: user.id };
    }

    next();
};

/**
 * Check if user owns a specific device
 */
const checkDeviceOwnership = async (req, res, next) => {
    const user = req.user;
    const deviceId = req.params.deviceId || req.params.id;

    if (!user) {
        return res.status(401).json({
            success: false,
            error: 'Authentication required'
        });
    }

    if (!deviceId) {
        return res.status(400).json({
            success: false,
            error: 'Device ID required'
        });
    }

    // Admin can access any device
    if (user.role === 'admin') {
        return next();
    }

    // Check ownership for clients
    const device = await prisma.device.findFirst({
        where: {
            OR: [
                { id: deviceId },
                { deviceId: deviceId }
            ],
            userId: user.id
        }
    });

    if (!device) {
        return res.status(403).json({
            success: false,
            error: 'Access denied to this device'
        });
    }

    req.device = device;
    next();
};

/**
 * Legacy middleware for backwards compatibility
 * Verifies admin from env vars (deprecated, use verifyToken)
 */
const verifyAdmin = async (req, res, next) => {
    // First try new token-based auth
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        return verifyToken(req, res, async (err) => {
            if (err) return next(err);
            // After token verification, check expiration
            return checkExpiration(req, res, next);
        });
    }

    // Fallback to legacy env-based auth (will be removed)
    return res.status(401).json({
        success: false,
        error: 'Authentication required'
    });
};

module.exports = {
    verifyToken,
    checkExpiration,
    requireRole,
    checkPermission,
    validateSignature,
    auditLog,
    auditLogMiddleware,
    filterDevices,
    checkDeviceOwnership,
    verifyAdmin, // Legacy
    extractUserFromToken,
    hashToken,
    generateSignature,
    JWT_SECRET
};
