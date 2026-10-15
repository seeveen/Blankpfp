import { handlers as h } from '../../../../lib/server.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = (req, ctx) => h.libraryGet(req, ctx);
export const PATCH = (req, ctx) => h.libraryRename(req, ctx);
export const DELETE = (req, ctx) => h.libraryDelete(req, ctx);
