import express from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, createReadStream } from 'fs';
import { join, extname, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const DATA_DIR     = process.env.DATA_DIR || '/data';
const MAPS_DIR     = join(DATA_DIR, 'maps');
const MODELS_DIR   = join(DATA_DIR, 'models');
const SESSION_FILE = join(DATA_DIR, 'session.json');
const MAPS_MANIFEST   = join(DATA_DIR, 'maps.json');
const MODELS_MANIFEST = join(DATA_DIR, 'models.json');
const PORT = process.env.PORT || 3000;

// ── Bootstrap data directories ───────────────────────────────────────────────
for (const dir of [DATA_DIR, MAPS_DIR, MODELS_DIR]) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}
if (!existsSync(MAPS_MANIFEST))   writeFileSync(MAPS_MANIFEST,   '[]', 'utf8');
if (!existsSync(MODELS_MANIFEST)) writeFileSync(MODELS_MANIFEST, '[]', 'utf8');

// ── Manifest helpers ──────────────────────────────────────────────────────────
function readManifest(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return []; }
}
function saveManifest(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
}

// ── Multer storage ────────────────────────────────────────────────────────────
function makeStorage(destDir) {
  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, destDir),
    filename: (_req, file, cb) => cb(null, uuidv4() + extname(file.originalname).toLowerCase()),
  });
}

const uploadMap   = multer({ storage: makeStorage(MAPS_DIR),   limits: { fileSize: 50 * 1024 * 1024 } });
const uploadModel = multer({ storage: makeStorage(MODELS_DIR), limits: { fileSize: 500 * 1024 * 1024 } });

// ── Express app ───────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '10mb' }));

// Static files — serve entire project root
app.use(express.static(PROJECT_ROOT));

// ── Maps API ──────────────────────────────────────────────────────────────────
app.get('/api/maps', (_req, res) => {
  res.json(readManifest(MAPS_MANIFEST));
});

app.post('/api/maps', uploadMap.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const entry = {
    id:         req.file.filename.replace(/\.[^.]+$/, ''),
    name:       req.body.name || req.file.originalname,
    filename:   req.file.filename,
    size:       req.file.size,
    uploadedAt: new Date().toISOString(),
  };
  const manifest = readManifest(MAPS_MANIFEST);
  manifest.push(entry);
  saveManifest(MAPS_MANIFEST, manifest);
  res.json(entry);
});

app.delete('/api/maps/:id', (req, res) => {
  const manifest = readManifest(MAPS_MANIFEST);
  const idx = manifest.findIndex(e => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const [entry] = manifest.splice(idx, 1);
  saveManifest(MAPS_MANIFEST, manifest);
  const filePath = join(MAPS_DIR, entry.filename);
  try { if (existsSync(filePath)) unlinkSync(filePath); } catch { /* ignore */ }
  res.json({ ok: true });
});

app.get('/api/maps/:id/file', (req, res) => {
  const manifest = readManifest(MAPS_MANIFEST);
  const entry = manifest.find(e => e.id === req.params.id);
  if (!entry) return res.status(404).json({ error: 'Not found' });
  const filePath = join(MAPS_DIR, entry.filename);
  if (!existsSync(filePath)) return res.status(404).json({ error: 'File missing' });
  res.setHeader('Content-Disposition', `inline; filename="${entry.name}"`);
  createReadStream(filePath).pipe(res);
});

// ── Models API ────────────────────────────────────────────────────────────────
app.get('/api/models', (_req, res) => {
  res.json(readManifest(MODELS_MANIFEST));
});

app.post('/api/models', uploadModel.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const entry = {
    id:         req.file.filename.replace(/\.[^.]+$/, ''),
    name:       req.body.name || req.file.originalname,
    filename:   req.file.filename,
    ext:        extname(req.file.originalname).toLowerCase().slice(1),
    size:       req.file.size,
    uploadedAt: new Date().toISOString(),
  };
  const manifest = readManifest(MODELS_MANIFEST);
  manifest.push(entry);
  saveManifest(MODELS_MANIFEST, manifest);
  res.json(entry);
});

app.delete('/api/models/:id', (req, res) => {
  const manifest = readManifest(MODELS_MANIFEST);
  const idx = manifest.findIndex(e => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const [entry] = manifest.splice(idx, 1);
  saveManifest(MODELS_MANIFEST, manifest);
  const filePath = join(MODELS_DIR, entry.filename);
  try { if (existsSync(filePath)) unlinkSync(filePath); } catch { /* ignore */ }
  res.json({ ok: true });
});

app.get('/api/models/:id/file', (req, res) => {
  const manifest = readManifest(MODELS_MANIFEST);
  const entry = manifest.find(e => e.id === req.params.id);
  if (!entry) return res.status(404).json({ error: 'Not found' });
  const filePath = join(MODELS_DIR, entry.filename);
  if (!existsSync(filePath)) return res.status(404).json({ error: 'File missing' });
  res.setHeader('Content-Disposition', `inline; filename="${entry.name}"`);
  createReadStream(filePath).pipe(res);
});

// ── Session API ───────────────────────────────────────────────────────────────
app.get('/api/session', (_req, res) => {
  if (!existsSync(SESSION_FILE)) return res.status(204).end();
  try {
    const data = JSON.parse(readFileSync(SESSION_FILE, 'utf8'));
    res.json(data);
  } catch {
    res.status(204).end();
  }
});

app.put('/api/session', (req, res) => {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'Invalid body' });
  }
  writeFileSync(SESSION_FILE, JSON.stringify(req.body, null, 2), 'utf8');
  res.json({ ok: true });
});

app.delete('/api/session', (_req, res) => {
  try { if (existsSync(SESSION_FILE)) unlinkSync(SESSION_FILE); } catch { /* ignore */ }
  res.json({ ok: true });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`stlTexturizer server running on port ${PORT}`);
});
