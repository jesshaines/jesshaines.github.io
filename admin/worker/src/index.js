export default {
  async fetch(request, env, ctx) {
    const corsHeaders = getCorsHeaders(env, request);
    const url = new URL(request.url);

    // Handle browser preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    try {
      // Simple origin check
      const origin = request.headers.get("Origin");
      if (origin && origin !== env.ALLOWED_ORIGIN) {
        return json(
          { ok: false, error: "Origin not allowed" },
          403,
          corsHeaders
        );
      }

      if (url.pathname === "/api/ping" && request.method === "GET") {
        return json({ ok: true, message: "pong" }, 200, corsHeaders);
      }

      if (url.pathname === "/api/bookings" && request.method === "POST") {
        // Require JSON
        const contentType = request.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) {
          return json(
            { ok: false, error: "Content-Type must be application/json" },
            415,
            corsHeaders
          );
        }

        // Size check
        const contentLength = parseInt(
          request.headers.get("content-length") || "0",
          10
        );
        if (contentLength > 20 * 1024) {
          return json(
            { ok: false, error: "Request too large" },
            413,
            corsHeaders
          );
        }

        // Bearer token auth
        const authHeader = request.headers.get("Authorization") || "";
        const expected = `Bearer ${env.USER_TOKEN}`;
        if (authHeader !== expected) {
          return json(
            { ok: false, error: "Unauthorized" },
            401,
            corsHeaders
          );
        }

        const body = await request.json();

        // Basic validation
        const requiredFields = [
          "client_name",
          "phone",
          "address",
          "property_size_category",
          "service_date",
        ];

        for (const field of requiredFields) {
          if (!body[field] || String(body[field]).trim() === "") {
            return json(
              { ok: false, error: `Missing required field: ${field}` },
              400,
              corsHeaders
            );
          }
        }

        // Normalize outgoing payload
        const payload = {
          worker_key: env.WORKER_KEY,
          client_name: body.client_name || "",
          phone: body.phone || "",
          address: body.address || "",
          beds_baths: body.beds_baths || "",
          property_type: body.property_type || "",
          approx_sq_ft: body.approx_sq_ft || "",
          property_size_category: body.property_size_category || "",
          service_type: body.service_type || "",
          access: body.access || "",
          pets: body.pets || "",
          service_date: body.service_date || "",
          arrival_time: body.arrival_time || "",
          notes: body.notes || "",
          suggested_price_low: body.suggested_price_low || "",
          suggested_price_high: body.suggested_price_high || "",
        };

        // Forward to Apps Script
        const upstream = await fetch(env.APPS_SCRIPT_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-WORKER-KEY": env.WORKER_KEY,
          },
          body: JSON.stringify(payload),
        });

        const text = await upstream.text();

        let upstreamJson;
        try {
          upstreamJson = JSON.parse(text);
        } catch {
          upstreamJson = { ok: false, error: "Invalid response from Apps Script", raw: text };
        }

        if (!upstream.ok || upstreamJson.ok !== true) {
          return json(
            {
              ok: false,
              error: upstreamJson.error || "Apps Script write failed",
            },
            502,
            corsHeaders
          );
        }

        return json(
          { ok: true, message: "Booking saved successfully" },
          200,
          corsHeaders
        );
      }

      return json({ ok: false, error: "Not found" }, 404, corsHeaders);
    } catch (err) {
      return json(
        { ok: false, error: err instanceof Error ? err.message : String(err) },
        500,
        corsHeaders
      );
    }
  },
};

function getCorsHeaders(env, request) {
  const origin = request.headers.get("Origin");
  const allowedOrigin =
    origin && origin === env.ALLOWED_ORIGIN ? origin : env.ALLOWED_ORIGIN;

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "Content-Type": "application/json",
  };
}

function json(data, status = 200, corsHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders,
  });
}
