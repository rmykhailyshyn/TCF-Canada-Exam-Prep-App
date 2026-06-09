import express from 'express';
import { getPort } from './config/env';
import { fail } from './lib/envelope';
import { healthRouter } from './routes/health';
import { questionsRouter } from './routes/questions';
import { sessionsRouter } from './routes/sessions';

const app = express();
app.use(express.json());

app.use('/api/health', healthRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/api/questions', questionsRouter);

// Fallback 404 in the standard envelope shape for unknown API routes.
app.use('/api', (_req, res) => {
  res.status(404).json(fail('NOT_FOUND', 'Route not found'));
});

const port = getPort();
app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
