const SHEET_ID = "https://docs.google.com/spreadsheets/d/18VPlnIOCHAUsg2_wibq16n--_4yWoHFyC4rZ7Uw5KzU/edit?gid=0#gid=0";
const TAB_NAME = "Bookings";
const WORKER_KEY = "LevGeorgiaAltonZoeKeltonJaden";

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || "{}");

    // Apps Script may not expose custom headers reliably in every deployment mode,
    // so if needed we can also pass worker_key in the JSON body later.
    // For now, expect it from the body as fallback.
    const providedKey = body.worker_key || "";

    if (providedKey !== WORKER_KEY) {
      return jsonResponse({ ok: false, error: "Unauthorized" });
    }

    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName(TAB_NAME) || ss.insertSheet(TAB_NAME);

    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        "Client Name",
        "Phone",
        "Address",
        "Beds/Baths",
        "Property Type",
        "Approx Sq Ft",
        "Property Size Category",
        "Service Type",
        "Access",
        "Pets?",
        "Service Date",
        "Arrival Time",
        "Notes",
        "Suggested Price Low ($)",
        "Suggested Price High ($)",
        "Created At"
      ]);
    }

    sheet.appendRow([
      body.client_name || "",
      body.phone || "",
      body.address || "",
      body.beds_baths || "",
      body.property_type || "",
      body.approx_sq_ft || "",
      body.property_size_category || "",
      body.service_type || "",
      body.access || "",
      body.pets || "",
      body.service_date || "",
      body.arrival_time || "",
      body.notes || "",
      body.suggested_price_low || "",
      body.suggested_price_high || "",
      new Date()
    ]);

    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  }
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
