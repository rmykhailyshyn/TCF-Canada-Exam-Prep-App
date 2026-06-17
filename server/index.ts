import express from 'express';
import { getPort } from './config/env';
import { fail } from './lib/envelope';
import { healthRouter } from './routes/health';
import { questionsRouter } from './routes/questions';
import { sessionsRouter } from './routes/sessions';
import { writingRouter } from './routes/writing';

const app = express();
// Writing responses are short essays; allow a generous JSON body.
app.use(express.json({ limit: '1mb' }));

app.use('/api/health', healthRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/api/questions', questionsRouter);
app.use('/api/writing', writingRouter);

// Fallback 404 in the standard envelope shape for unknown API routes.
app.use('/api', (_req, res) => {
  res.status(404).json(fail('NOT_FOUND', 'Route not found'));
});

const port = getPort();
app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
