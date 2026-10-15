import { handlers as h } from '../../../../lib/server.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = (req, ctx) => h.avatarSet(req, ctx);
export const DELETE = (req, ctx) => h.avatarDelete(req, ctx);
