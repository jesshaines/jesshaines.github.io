/**
 * Colony Surf Cleaning — Cloudflare Worker
 * index.ts
 *
 * Endpoints:
 *   GET  /api/ping      → { ok: true }
 *   POST /api/bookings  → validates auth, forwards to Apps Script
 *
 * Required env vars / secrets:
 *   USER_TOKEN      — Bearer token clients must send
 *   WORKER_KEY      — Secret forwarded to Apps Script
 *   APPS_SCRIPT_URL — Google Apps Script web app URL
 *   ALLOWED_ORIGIN  — e.g. https://yourusername.github.io
 */

export interface Env {
  USER_TOKEN: string;
  WORKER_KEY: string;
  APPS_SCRIPT_URL: string;
  ALLOWED_ORIGIN: string;
}

// ---------- In-memory rate limiter (best-effort per instance) ----------
interface RateBucket {
  count: number;
  windowStart: number;
}
const rateLimitMap = new Map<string, RateBucket>();
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const bucket = rateLimitMap.get(ip);

  if (!bucket || now - bucket.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, { count: 1, windowStart: now });
    return true; // allowed
  }

  bucket.count++;
  if (bucket.count > RATE_LIMIT_MAX) return false; // exceeded
  return true;
}

// ---------- CORS helpers ----------
function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin':  origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age':       '86400',
  };
}

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
  });
}

// ---------- Main handler ----------
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = env.ALLOWED_ORIGIN || '*';
    const cors   = corsHeaders(origin);

    // --- CORS preflight ---
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    // --- CORS origin check (non-wildcard) ---
    if (origin !== '*') {
      const reqOrigin = request.headers.get('Origin') || '';
      if (reqOrigin && reqOrigin !== origin) {
        return json({ ok: false, error: 'Forbidden origin' }, 403, cors);
      }
    }

    const url = new URL(request.url);

    // ---- GET /api/ping ----
    if (request.method === 'GET' && url.pathname === '/api/ping') {
      // Still require auth on ping so Settings can verify the token
      const authErr = validateAuth(request, env);
      if (authErr) return json(authErr.body, authErr.status, cors);
      return json({ ok: true }, 200, cors);
    }

    // ---- POST /api/bookings ----
    if (request.method === 'POST' && url.pathname === '/api/bookings') {

      // 1. Auth
      const authErr = validateAuth(request, env);
      if (authErr) return json(authErr.body, authErr.status, cors);

      // 2. Content-Type
      const ct = request.headers.get('Content-Type') || '';
      if (!ct.includes('application/json')) {
        return json({ ok: false, error: 'Content-Type must be application/json' }, 415, cors);
      }

      // 3. Size limit (20 KB)
      const contentLength = parseInt(request.headers.get('Content-Length') || '0', 10);
      if (contentLength > 20_000) {
        return json({ ok: false, error: 'Request body too large (max 20 KB)' }, 413, cors);
      }

      // 4. Rate limit
      const ip = request.headers.get('CF-Connecting-IP') ||
                 request.headers.get('X-Forwarded-For') || 'unknown';
      if (!checkRateLimit(ip)) {
        return json({ ok: false, error: 'Rate limit exceeded. Try again later.' }, 429, cors);
      }

      // 5. Parse body (with size guard)
      let body: string;
      try {
        body = await request.text();
        if (body.length > 20_000) {
          return json({ ok: false, error: 'Request body too large (max 20 KB)' }, 413, cors);
        }
      } catch {
        return json({ ok: false, error: 'Could not read request body' }, 400, cors);
      }

      let payload: unknown;
      try {
        payload = JSON.parse(body);
      } catch {
        return json({ ok: false, error: 'Invalid JSON body' }, 400, cors);
      }

      // 6. Basic field validation
      const validationErr = validatePayload(payload);
      if (validationErr) {
        return json({ ok: false, error: validationErr }, 400, cors);
      }

      // 7. Forward to Apps Script
      if (!env.APPS_SCRIPT_URL) {
        return json({ ok: false, error: 'Worker misconfigured: APPS_SCRIPT_URL not set' }, 500, cors);
      }

      // Embed the worker key in the body because Apps Script cannot read
      // arbitrary HTTP headers. The Apps Script will strip _workerKey before writing.
      const payloadWithKey = { ...(payload as Record<string, unknown>), _workerKey: env.WORKER_KEY || '' };

      let scriptRes: Response;
      try {
        scriptRes = await fetch(env.APPS_SCRIPT_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-WORKER-KEY': env.WORKER_KEY || '',
          },
          body: JSON.stringify(payloadWithKey),
          // Follow redirects (Apps Script deployment uses a redirect)
          redirect: 'follow',
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return json({ ok: false, error: `Failed to reach Apps Script: ${msg}` }, 502, cors);
      }

      let scriptData: { ok?: boolean; error?: string };
      try {
        scriptData = await scriptRes.json() as { ok?: boolean; error?: string };
      } catch {
        return json({ ok: false, error: 'Apps Script returned invalid JSON' }, 502, cors);
      }

      if (!scriptData.ok) {
        return json({ ok: false, error: scriptData.error || 'Apps Script returned ok:false' }, 502, cors);
      }

      return json({ ok: true, message: 'Booking saved successfully' }, 200, cors);
    }

    // ---- 404 ----
    return json({ ok: false, error: 'Not found' }, 404, cors);
  },
};

// ---------- Validation helpers ----------
interface AuthError { body: { ok: false; error: string }; status: number; }

function validateAuth(request: Request, env: Env): AuthError | null {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token || token !== env.USER_TOKEN) {
    return { body: { ok: false, error: 'Unauthorized: invalid or missing token' }, status: 401 };
  }
  return null;
}

function validatePayload(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return 'Payload must be a JSON object';
  }
  const p = payload as Record<string, unknown>;
  if (!p.client_name || typeof p.client_name !== 'string') return 'client_name is required';
  if (!p.phone        || typeof p.phone !== 'string')        return 'phone is required';
  if (!p.address      || typeof p.address !== 'string')      return 'address is required';
  if (!p.service_date || typeof p.service_date !== 'string') return 'service_date is required';
  if (!p.property_size_category || typeof p.property_size_category !== 'string')
    return 'property_size_category is required';
  return null;
}
