import { handlers as h } from '../../../../../lib/server.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = (req, ctx) => h.libraryFile(req, ctx);
