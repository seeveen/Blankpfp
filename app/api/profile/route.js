import { handlers as h } from '../../../lib/server.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = (req, ctx) => h.profileGet(req, ctx);
export const POST = (req, ctx) => h.profileUpdate(req, ctx);
