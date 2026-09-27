const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Destination folder
const uploadDir = path.join(__dirname, '..', 'uploads', 'quality');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Storage configuration with sanitized naming
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const rawToken = req.params.token || 'token';
    const sanitizedToken = rawToken.replace(/[^a-zA-Z0-9_-]/g, '');
    const timestamp = Date.now();
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `inspection_${sanitizedToken}_${timestamp}${ext}`);
  }
});

// File filter for security
const fileFilter = (req, file, cb) => {
  const allowedExtensions = /jpeg|jpg|png|webp/;
  const extname = allowedExtensions.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedExtensions.test(file.mimetype);

  if (extname && mimetype) {
    return cb(null, true);
  }
  return cb(new Error('Only image files (jpg, jpeg, png, webp) are permitted for AI quality inspection'));
};

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: fileFilter
});

module.exports = upload;
