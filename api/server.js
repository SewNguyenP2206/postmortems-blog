require('dotenv').config();

const cors = require('cors');
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const helmet = require('helmet');
const { MongoClient } = require('mongodb');

const app = express();
const port = Number(process.env.PORT || 3000);
const allowedOrigins = new Set([
  'https://postmortems.sewtech.site',
  ...(process.env.ALLOWED_ORIGINS || '').split(',').map(origin => origin.trim()).filter(Boolean)
]);

app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin) || /^http:\/\/localhost:\d+$/.test(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error('Origin is not allowed'));
  },
  methods: ['GET', 'POST', 'PUT'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.json({ limit: '2kb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false }));

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
let database;

function validateSlug(req, res, next) {
  if (!slugPattern.test(req.params.slug)) {
    res.status(400).json({ error: 'Invalid post slug' });
    return;
  }
  next();
}

function validateViewerId(value, res) {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    res.status(400).json({ error: 'A valid viewerId is required' });
    return false;
  }
  return true;
}

async function getStats(slug, viewerId) {
  const [post, likes] = await Promise.all([
    database.collection('post_stats').findOne({ _id: slug }),
    database.collection('post_likes').countDocuments({ slug })
  ]);

  let liked = false;
  if (viewerId) {
    liked = Boolean(await database.collection('post_likes').findOne({ slug, viewerId }, { projection: { _id: 1 } }));
  }

  return { slug, views: post?.views || 0, likes, liked };
}

app.get('/api/health', async (req, res) => {
  await database.command({ ping: 1 });
  res.json({ status: 'ok' });
});

app.get('/api/posts/:slug/stats', validateSlug, async (req, res) => {
  const viewerId = req.query.viewerId;
  if (viewerId && !validateViewerId(viewerId, res)) return;
  res.json(await getStats(req.params.slug, viewerId));
});

app.post('/api/posts/:slug/views', validateSlug, async (req, res) => {
  if (!validateViewerId(req.body?.viewerId, res)) return;

  await database.collection('post_stats').updateOne(
    { _id: req.params.slug },
    { $inc: { views: 1 }, $setOnInsert: { createdAt: new Date() } },
    { upsert: true }
  );

  res.json(await getStats(req.params.slug, req.body.viewerId));
});

app.put('/api/posts/:slug/like', validateSlug, async (req, res) => {
  const { viewerId, liked } = req.body || {};
  if (!validateViewerId(viewerId, res)) return;
  if (typeof liked !== 'boolean') {
    res.status(400).json({ error: 'liked must be a boolean' });
    return;
  }

  const likes = database.collection('post_likes');
  if (liked) {
    try {
      await likes.insertOne({ slug: req.params.slug, viewerId, createdAt: new Date() });
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
  } else {
    await likes.deleteOne({ slug: req.params.slug, viewerId });
  }

  res.json(await getStats(req.params.slug, viewerId));
});

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  if (error.message === 'Origin is not allowed') {
    res.status(403).json({ error: error.message });
    return;
  }
  res.status(500).json({ error: 'Internal server error' });
});

async function start() {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is required');
  }

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  database = client.db(process.env.MONGODB_DB || 'postmortems');
  await database.collection('post_likes').createIndex({ slug: 1, viewerId: 1 }, { unique: true });
  app.listen(port, '0.0.0.0', () => console.log(`Engagement API listening on ${port}`));
}

if (require.main === module) {
  start().catch(error => {
    console.error('Could not start engagement API:', error.message);
    process.exit(1);
  });
}

module.exports = { app, start };