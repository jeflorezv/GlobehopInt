import express from 'express';
import fs from 'fs';
import path from 'path';
import { runPipeline }           from './pipeline.js';
import { postToInstagram }       from './post-to-instagram.js';
import { postReel }              from './post-reel.js';
import { fetchRecord, markEnCola, markPublished } from './save-to-airtable.js';
import { sendPublishConfirmation } from './send-alert.js';

const app  = express();
const PORT = process.env.PORT ?? 3000;

app.use(express.json());

function requireSecret(req, res, next) {
  const provided = req.headers['x-webhook-secret'] ?? req.query.secret;
  if (!provided || provided !== process.env.WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/generate', requireSecret, async (req, res) => {
  const { recordId } = req.body;
  if (!recordId) return res.status(400).json({ error: 'recordId required' });

  try {
    const result = await runPipeline(recordId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/publish', requireSecret, async (req, res) => {
  const { recordId } = req.body;
  if (!recordId) return res.status(400).json({ error: 'recordId required' });

  let record;
  try {
    record = await fetchRecord(recordId);
  } catch (err) {
    return res.status(500).json({ error: `Failed to fetch record: ${err.message}` });
  }

  if (record['Estado'] !== 'Aprobado') {
    return res.status(400).json({
      error: `Record must be Aprobado to publish, current Estado: ${record['Estado']}`,
    });
  }

  try {
    const tipo = record['Tipo de post'];
    const { postUrl } = tipo === 'reel'
      ? await postReel(record)
      : await postToInstagram(record);

    await markPublished(recordId, postUrl);
    await sendPublishConfirmation({ recordId, tipo, postUrl }).catch(() => {});

    // Clean up branded image from /tmp after successful publish
    const imageUrl = record['URL imagen'];
    if (imageUrl) {
      const filename = imageUrl.split('/images/').pop();
      if (filename?.match(/^branded-[\w-]+\.jpg$/)) {
        fs.unlink(path.join('/tmp', filename), () => {});
      }
    }

    res.json({ ok: true, postUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/retry/:recordId', requireSecret, async (req, res) => {
  const { recordId } = req.params;

  try {
    await markEnCola(recordId);
    const result = await runPipeline(recordId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/images/:filename', (req, res) => {
  const { filename } = req.params;

  if (!filename.match(/^branded-[\w-]+\.jpg$/)) {
    return res.status(400).end();
  }

  const filePath = path.join('/tmp', filename);

  res.sendFile(filePath, err => {
    if (err && !res.headersSent) return res.status(404).end();
  });
});

app.listen(PORT, () => {
  console.log(`GlobeHop automation server listening on port ${PORT}`);
});

export default app;
