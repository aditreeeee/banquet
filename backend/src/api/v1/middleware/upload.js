/**
 * File upload middleware (multer) — local disk storage under /uploads/<folder>,
 * served back out via the static route already mounted in app.js.
 */
'use strict';

const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const ALLOWED_MIME = new Set([
    'application/pdf',
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
]);

const UPLOADS_ROOT = path.join(__dirname, '../../../../uploads');

const fileFilter = (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
        return cb(new Error('Only PDF, JPEG, PNG, WEBP and GIF files are allowed'));
    }
    cb(null, true);
};

/** Builds a multer instance scoped to uploads/<folder>/ — one per use case (campaigns,
    review photos, etc.) so each keeps its own directory without cross-contamination. */
const makeUploader = (folder) => {
    const dir = path.join(UPLOADS_ROOT, folder);
    fs.mkdirSync(dir, { recursive: true });
    const storage = multer.diskStorage({
        destination: (req, file, cb) => cb(null, dir),
        filename: (req, file, cb) => {
            const ext = path.extname(file.originalname).toLowerCase();
            cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
        },
    });
    return multer({ storage, fileFilter, limits: { fileSize: 10 * 1024 * 1024 } });
};

const upload = makeUploader('campaigns');
const reviewPhotoUpload = makeUploader('reviews');

/** In-memory CSV upload (Master Menu / Inventory bulk import) — never
    written to disk, parsed straight from the buffer, so there's nothing left
    over to clean up. */
const csvUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const isCsv = file.mimetype === 'text/csv' || file.mimetype === 'application/vnd.ms-excel' || file.originalname.toLowerCase().endsWith('.csv');
        if (!isCsv) return cb(new Error('Only CSV files are allowed'));
        cb(null, true);
    },
});

module.exports = { upload, reviewPhotoUpload, csvUpload };
