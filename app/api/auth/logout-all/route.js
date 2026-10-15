import { handlers as h } from '../../../../lib/server.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = (req, ctx) => h.logoutAll(req, ctx);
