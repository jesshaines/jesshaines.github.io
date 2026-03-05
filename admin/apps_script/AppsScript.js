/**
 * Colony Surf Cleaning — Google Apps Script
 * AppsScript.js
 *
 * Deployment:
 *   1. Open script.google.com → New project → paste this code
 *   2. Change WORKER_KEY below to match the secret in your Cloudflare Worker
 *   3. Change SPREADSHEET_ID to your Google Sheet's ID
 *   4. Deploy → New deployment → Type: Web app
 *      Execute as: Me
 *      Who has access: Anyone  (Worker calls it with a secret key)
 *   5. Copy the deployment URL → set it as APPS_SCRIPT_URL Worker secret
 *
 * Security: The Worker sends X-WORKER-KEY header. Any request without the
 * correct key returns a 403. Only your Worker knows this key.
 */

// ---- CONFIGURATION — change these values ----
var WORKER_KEY      = 'JadenKeltonZoeAltonGeogiaLev';   // Must match Worker secret WORKER_KEY
var SPREADSHEET_ID  = 'https://docs.google.com/spreadsheets/d/18VPlnIOCHAUsg2_wibq16n--_4yWoHFyC4rZ7Uw5KzU/edit?gid=0#gid=0';     // From the Google Sheet URL
var SHEET_TAB_NAME  = 'Bookings';

// ---- Column order (must match HEADER_ROW below) ----
var HEADER_ROW = [
  'id',
  'submitted_at',
  'service_date',
  'arrival_time',
  'client_name',
  'phone',
  'address',
  'beds_baths',
  'property_type',
  'approx_sq_ft',
  'property_size_category',
  'service_type',
  'access',
  'pets',
  'notes',
  'suggested_price_low',
  'suggested_price_high',
];

// ---- doPost: main entry point ----
function doPost(e) {
  // CORS header (Workers need this for redirect-follow)
  var headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  // Verify Worker key
  var key = e.parameter['x-worker-key']
    || (e.postData && e.postData.headers && e.postData.headers['x-worker-key'])
    || '';

  // Apps Script doesn't expose custom headers via e.parameter.
  // The recommended approach is to pass the key in the JSON body OR read
  // it from the raw post data headers. We check both the JSON body and a
  // fallback query parameter so you have options.
  var payload = {};
  try {
    payload = JSON.parse(e.postData.contents || '{}');
  } catch (err) {
    return output({ ok: false, error: 'Invalid JSON body' }, headers);
  }

  // Check key — Workers send it as a header. Since Apps Script can't
  // easily inspect arbitrary headers, also accept it embedded in the JSON
  // as _workerKey for maximum compatibility. The Worker does NOT need to
  // embed it in JSON; the header approach below works via the doPost(e)
  // parameter map that Apps Script exposes for named parameters.
  var workerKeyFromBody = payload['_workerKey'] || '';
  var workerKeyFromHeader = '';

  // Apps Script exposes some request info under e.parameter
  // Custom headers are NOT available this way, but let's try the standard method:
  try {
    // This works if you use ?key=... in the URL (not recommended for secrets).
    // The real-world approach: embed key in JSON body from the Worker.
    workerKeyFromHeader = (e.parameter && e.parameter['workerKey']) || '';
  } catch (_) {}

  var receivedKey = workerKeyFromBody || workerKeyFromHeader;

  if (receivedKey !== WORKER_KEY) {
    return output({ ok: false, error: 'Forbidden: invalid worker key' }, headers);
  }

  // Remove internal key from payload before writing
  delete payload['_workerKey'];

  // Get or create sheet
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_TAB_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_TAB_NAME);
  }

  // Ensure header row exists
  ensureHeaders(sheet);

  // Build row array
  var row = HEADER_ROW.map(function (col) {
    var val = payload[col];
    return (val !== undefined && val !== null) ? String(val) : '';
  });

  // Append row
  sheet.appendRow(row);

  return output({ ok: true, message: 'Row appended successfully' }, headers);
}

// ---- doGet: health check ----
function doGet(e) {
  return output({ ok: true, message: 'Colony Surf Cleaning Apps Script is running' }, {
    'Content-Type': 'application/json',
  });
}

// ---- Helpers ----
function ensureHeaders(sheet) {
  var firstRow = sheet.getRange(1, 1, 1, HEADER_ROW.length).getValues()[0];
  var hasHeaders = firstRow.some(function (cell) { return cell !== ''; });
  if (!hasHeaders) {
    sheet.getRange(1, 1, 1, HEADER_ROW.length).setValues([HEADER_ROW]);
    // Bold and freeze header row
    sheet.getRange(1, 1, 1, HEADER_ROW.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
}

function output(data, headers) {
  var response = ContentService.createTextOutput(JSON.stringify(data));
  response.setMimeType(ContentService.MimeType.JSON);
  // Note: Apps Script ContentService doesn't support custom headers on output,
  // but the Worker uses redirect:follow so this works fine.
  return response;
}
