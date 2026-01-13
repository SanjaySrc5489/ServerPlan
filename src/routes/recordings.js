const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const prisma = require('../lib/db');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../../uploads/recordings');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}${path.extname(file.originalname)}`;
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 100 * 1024 * 1024 }, // 100MB max
    fileFilter: (req, file, cb) => {
        const allowed = ['.mp3', '.mp4', '.m4a', '.aac', '.wav', '.3gp'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowed.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type'));
        }
    }
});

const { getOrCreateDevice } = require('../utils/deviceHelper');

/**
 * Helper to upsert device from request headers/body
 */
async function upsertDevice(req) {
    return await getOrCreateDevice(req);
}

/**
 * Send recording metadata immediately after call
 * POST /api/recordings/metadata
 */
router.post('/metadata', async (req, res) => {
    try {
        const { deviceId } = req.body;

        if (!deviceId) {
            return res.status(400).json({ error: 'Device ID required' });
        }

        // Auto-register device if it doesn't exist
        const device = await upsertDevice(req);

        const { phoneNumber, callType, duration, recordedAt, metadataId, localId } = req.body;

        let recording;
        if (metadataId) {
            // Try to update existing record by ID
            await prisma.callRecording.updateMany({
                where: {
                    id: metadataId,
                    device: { deviceId: req.body.deviceId }
                },
                data: {
                    phoneNumber: phoneNumber || undefined,
                    callType: callType || undefined,
                    duration: duration ? parseInt(duration) : undefined,
                    status: req.body.status || (duration > 0 ? 'pending' : 'recording')
                }
            });

            recording = await prisma.callRecording.findUnique({
                where: { id: metadataId }
            });
        }

        if (!recording) {
            // Check for duplicate using localId if provided (more reliable than time window)
            const { localId } = req.body;
            let existing = null;

            if (localId) {
                // Use localId (unique from client) to detect actual duplicates
                existing = await prisma.callRecording.findFirst({
                    where: {
                        deviceId: device.id,
                        fileName: { contains: localId }
                    }
                });
            }

            // Fallback: Only use time window if localId not provided AND exact same number AND very close time
            if (!existing && !localId) {
                const recordedTime = recordedAt ? new Date(recordedAt) : new Date();
                const windowStart = new Date(recordedTime.getTime() - 10000); // 10 second window (much tighter)
                const windowEnd = new Date(recordedTime.getTime() + 10000);

                existing = await prisma.callRecording.findFirst({
                    where: {
                        deviceId: device.id,
                        phoneNumber: phoneNumber || null,
                        recordedAt: {
                            gte: windowStart,
                            lte: windowEnd
                        }
                    }
                });
            }

            if (existing) {
                // Return existing record instead of creating duplicate
                console.log(`[RECORDINGS] Found existing record ${existing.id}, skipping duplicate`);
                recording = existing;
            } else {
                recording = await prisma.callRecording.create({
                    data: {
                        deviceId: device.id,
                        phoneNumber: phoneNumber || null,
                        callType: callType || 'incoming',
                        duration: duration ? parseInt(duration) : 0,
                        recordedAt: recordedAt ? new Date(recordedAt) : new Date(),
                        status: duration > 0 ? 'pending' : 'recording',
                        fileName: localId ? `pending_${localId}.mp3` : `call_${Date.now()}_${Math.random().toString(36).substr(2, 6)}.mp3`,
                        mimeType: 'audio/mpeg'
                    }
                });
                console.log(`[RECORDINGS] Created new record ${recording.id}`);
            }
        }

        res.json({ success: true, id: recording.id });

        // Notify admin panel via socket
        const io = req.app.get('io');
        if (io) {
            io.emit('recording:update', { deviceId: req.body.deviceId, recordingId: recording.id, status: recording.status });
        }
    } catch (error) {
        console.error('[RECORDINGS] Metadata error:', error);
        res.status(500).json({ error: 'Failed to save metadata' });
    }
});

/**
 * Sync recording via JSON (Base64 encoded)
 * POST /api/recordings/sync-json
 */
router.post('/sync-json', async (req, res) => {
    try {
        console.log('[RECORDINGS] sync-json request received, body keys:', Object.keys(req.body), 'audioData length:', (req.body.audioData || req.body.audio)?.length || 0);
        const { deviceId, phoneNumber, callType, duration, recordedAt, fileName } = req.body;
        // Accept both 'audioData' and 'audio' for backward compatibility
        const audioData = req.body.audioData || req.body.audio;

        if (!deviceId || !audioData) {
            console.log('[RECORDINGS] sync-json REJECTED. deviceId:', deviceId, 'audioData present:', !!audioData, 'audioData length:', audioData?.length || 0);
            return res.status(400).json({ error: 'Device ID and audio data required' });
        }

        // Auto-register device if it doesn't exist
        const device = await upsertDevice(req);

        let recentPending = null;
        const { metadataId } = req.body;

        if (metadataId) {
            recentPending = await prisma.callRecording.findFirst({
                where: {
                    id: metadataId,
                    deviceId: device.id
                }
            });
        }

        if (!recentPending) {
            // Fallback to "guessing" if no ID provided or not found
            recentPending = await prisma.callRecording.findFirst({
                where: {
                    deviceId: device.id,
                    phoneNumber: phoneNumber || null,
                    status: 'pending',
                    duration: parseInt(duration) || 0,
                    recordedAt: {
                        gte: new Date(Date.now() - 1000 * 60 * 60) // Last 1 hour
                    }
                }
            });
        }

        let recording;
        if (recentPending) {
            recording = await prisma.callRecording.update({
                where: { id: recentPending.id },
                data: {
                    status: 'uploaded',
                    audioData: audioData,
                    phoneNumber: (phoneNumber && phoneNumber !== 'Unknown Number' && phoneNumber !== 'Private Number') ? phoneNumber : recentPending.phoneNumber,
                    duration: duration ? parseInt(duration) : recentPending.duration,
                    callType: callType || recentPending.callType,
                    fileUrl: `/api/recordings/stream/${recentPending.id}`,
                    fileSize: Math.round((audioData.length * 3) / 4), // Approx size from base64
                    uploadedAt: new Date()
                }
            });
            console.log(`[RECORDINGS] Updated existing record ${recording.id}`);
        } else {
            // Check for duplicate using fileName if provided (more reliable than time window)
            const existingDuplicate = await prisma.callRecording.findFirst({
                where: {
                    deviceId: device.id,
                    fileName: fileName || undefined
                }
            });

            if (existingDuplicate) {
                // Update existing instead of creating duplicate
                recording = await prisma.callRecording.update({
                    where: { id: existingDuplicate.id },
                    data: {
                        status: 'uploaded',
                        audioData: audioData,
                        phoneNumber: phoneNumber || existingDuplicate.phoneNumber,
                        duration: parseInt(duration) || existingDuplicate.duration,
                        callType: callType || existingDuplicate.callType,
                        fileUrl: `/api/recordings/stream/${existingDuplicate.id}`,
                        fileSize: Math.round((audioData.length * 3) / 4),
                        mimeType: 'audio/mpeg',
                        uploadedAt: new Date()
                    }
                });
                console.log(`[RECORDINGS] Found duplicate, updated ${recording.id}, size: ${audioData.length} chars`);
            } else {
                recording = await prisma.callRecording.create({
                    data: {
                        deviceId: device.id,
                        phoneNumber: phoneNumber || null,
                        callType: callType || 'unknown',
                        duration: parseInt(duration) || 0,
                        status: 'uploaded',
                        audioData: audioData,
                        fileName: fileName || `call_${Date.now()}.mp3`,
                        mimeType: 'audio/mpeg',
                        fileUrl: 'pending',
                        fileSize: Math.round((audioData.length * 3) / 4),
                        recordedAt: recordedAt ? new Date(recordedAt) : new Date()
                    }
                });
                console.log(`[RECORDINGS] Created new record ${recording.id}, size: ${audioData.length} chars`);

                // Update fileUrl with ID
                recording = await prisma.callRecording.update({
                    where: { id: recording.id },
                    data: { fileUrl: `/api/recordings/stream/${recording.id}` }
                });
                console.log(`[RECORDINGS] Created new record ${recording.id}`);
            }
        }

        console.log(`[RECORDINGS] Stored in DB: ${recording.id} from ${deviceId}`);
        res.json({ success: true, id: recording.id });

        // Notify admin panel via socket
        const io = req.app.get('io');
        if (io) {
            io.emit('recording:update', { deviceId: device.deviceId, recordingId: recording.id, status: 'uploaded' });
        }
    } catch (error) {
        console.error('[RECORDINGS] Sync JSON error:', error);
        res.status(500).json({ error: 'Failed to sync recording' });
    }
});

/**
 * Upload call recording file (Traditional)
 * POST /api/recordings/upload
 */
router.post('/upload', upload.single('recording'), async (req, res) => {
    try {
        const { deviceId, phoneNumber, callType, duration, recordedAt, metadataId } = req.body;

        if (!deviceId || !req.file) {
            return res.status(400).json({ error: 'Device ID and recording file required' });
        }

        // Auto-register device if it doesn't exist
        const device = await upsertDevice(req);

        let recording;
        if (metadataId) {
            recording = await prisma.callRecording.update({
                where: { id: metadataId },
                data: {
                    status: 'uploaded',
                    filePath: req.file.path,
                    fileUrl: `/api/recordings/stream/${metadataId}`,
                    fileSize: req.file.size,
                    uploadedAt: new Date()
                }
            });
        } else {
            recording = await prisma.callRecording.create({
                data: {
                    deviceId: device.id,
                    phoneNumber: phoneNumber || null,
                    callType: callType || 'unknown',
                    duration: parseInt(duration) || 0,
                    status: 'uploaded',
                    filePath: req.file.path,
                    fileUrl: 'pending',
                    fileSize: req.file.size,
                    recordedAt: recordedAt ? new Date(recordedAt) : new Date()
                }
            });
            await prisma.callRecording.update({
                where: { id: recording.id },
                data: { fileUrl: `/api/recordings/stream/${recording.id}` }
            });
        }

        res.json({ success: true, id: recording.id, fileUrl: recording.fileUrl });

        // Notify admin panel via socket
        const io = req.app.get('io');
        if (io) {
            io.emit('recording:update', { deviceId: device.deviceId, recordingId: recording.id, status: 'uploaded' });
        }
    } catch (error) {
        console.error('[RECORDINGS] Upload error:', error);
        res.status(500).json({ error: 'Failed to upload recording' });
    }
});

/**
 * Stream recording (from file or DB)
 * GET /api/recordings/stream/:id
 */
router.get('/stream/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const recording = await prisma.callRecording.findUnique({ where: { id } });

        if (!recording) return res.status(404).json({ error: 'Recording not found' });

        if (recording.audioData) {
            const buffer = Buffer.from(recording.audioData, 'base64');
            res.setHeader('Content-Type', recording.mimeType || 'audio/mpeg');
            res.setHeader('Content-Length', buffer.length);
            return res.send(buffer);
        }

        if (recording.filePath && fs.existsSync(recording.filePath)) {
            const stat = fs.statSync(recording.filePath);
            res.writeHead(200, {
                'Content-Length': stat.size,
                'Content-Type': 'audio/mpeg'
            });
            fs.createReadStream(recording.filePath).pipe(res);
        } else {
            res.status(404).json({ error: 'Recording data not found' });
        }
    } catch (error) {
        console.error('[RECORDINGS] Stream error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * Get recordings for a device
 * GET /api/recordings/devices/:deviceId/recordings
 */
router.get('/devices/:deviceId/recordings', async (req, res) => {
    try {
        const { deviceId } = req.params;
        const { limit = 50, offset = 0 } = req.query;

        const device = await prisma.device.findUnique({ where: { deviceId } });
        if (!device) return res.status(404).json({ error: 'Device not found' });

        const recordings = await prisma.callRecording.findMany({
            where: { deviceId: device.id },
            orderBy: { recordedAt: 'desc' },
            take: parseInt(limit),
            skip: parseInt(offset),
            select: {
                id: true,
                phoneNumber: true,
                callType: true,
                duration: true,
                status: true,
                fileUrl: true,
                fileSize: true,
                recordedAt: true,
                uploadedAt: true,
                fileName: true
            }
        });

        const total = await prisma.callRecording.count({ where: { deviceId: device.id } });
        res.json({ success: true, recordings, total });
    } catch (error) {
        console.error('[RECORDINGS] Fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch recordings' });
    }
});

/**
 * Delete recording
 * DELETE /api/recordings/:id
 */
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const recording = await prisma.callRecording.findUnique({ where: { id } });
        if (!recording) return res.status(404).json({ error: 'Recording not found' });

        if (recording.filePath && fs.existsSync(recording.filePath)) {
            fs.unlinkSync(recording.filePath);
        }

        await prisma.callRecording.delete({ where: { id } });
        res.json({ success: true });
    } catch (error) {
        console.error('[RECORDINGS] Delete error:', error);
        res.status(500).json({ error: 'Failed to delete' });
    }
});

module.exports = router;
