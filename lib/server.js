import { getDb } from './db.js';
import { createHandlers } from './handlers.js';

export const handlers = createHandlers(getDb);
