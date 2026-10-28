'use strict';
// Disposable local preview. Never reads the project's .env or production database.
const crypto = require('node:crypto');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.BIOS_DOTENV_PATH = path.join(os.tmpdir(), 'bios-no-dotenv');
process.env.DATABASE_URL = '';
process.env.NODE_ENV = 'development';
process.env.PORT = '4173';
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bios-preview-')), 'preview.sqlite');
process.env.JWT_SECRET = crypto.randomBytes(40).toString('hex');
process.env.SITE_URL = 'http://terminal.local:4173';
process.env.COOKIE_SECURE = 'false';
process.env.ADMIN_USERNAME = 'preview';
process.env.ADMIN_PASSWORD = 'BiosPreview-local-2026';
require('../server');
