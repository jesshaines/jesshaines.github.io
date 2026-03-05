/* ============================================
   COLONY SURF CLEANING — app.js
   ============================================ */

'use strict';

// ---- PRICING TABLE ----
const PRICING = {
  'RV / tiny cabin':         { low:  90, high: 120 },
  'Small cabin / 1–2 bed':   { low: 130, high: 180 },
  'Medium home / 3 bed':     { low: 180, high: 240 },
  'Large home':              { low: 240, high: 320 },
};

// ---- STORAGE HELPERS ----
const LS_BOOKINGS = 'csc_bookings';
const LS_SETTINGS = 'csc_settings';

function getBookings() {
  try { return JSON.parse(localStorage.getItem(LS_BOOKINGS) || '[]'); }
  catch { return []; }
}

function saveBookings(arr) {
  localStorage.setItem(LS_BOOKINGS, JSON.stringify(arr));
}

function getSettings() {
  try { return JSON.parse(localStorage.getItem(LS_SETTINGS) || '{}'); }
  catch { return {}; }
}

function saveSettingsData(obj) {
  localStorage.setItem(LS_SETTINGS, JSON.stringify(obj));
}

// ---- PAGE NAVIGATION ----
function showPage(name) {
  document.querySelectorAll('.page-section').forEach(el => el.classList.add('d-none'));
  const target = document.getElementById('page-' + name);
  if (target) {
    target.classList.remove('d-none');
    // Re-trigger animation
    target.style.animation = 'none';
    target.offsetHeight; // reflow
    target.style.animation = '';
  }

  document.querySelectorAll('.nav-pill').forEach(a => {
    a.classList.toggle('active', a.dataset.page === name);
  });

  // Load page-specific data
  if (name === 'bookings') renderBookingsTable();
  if (name === 'schedule') renderSchedule();
  if (name === 'export')   renderExportInfo();
  if (name === 'settings') loadSettingsForm();
}

// ---- QUOTE ----
function updateQuote() {
  const cat = document.getElementById('property_size_category').value;
  const body = document.getElementById('quoteBody');

  if (!cat || !PRICING[cat]) {
    body.innerHTML = `
      <div class="quote-placeholder">
        <i class="bi bi-house-heart"></i>
        <p>Select a property size category to see your estimated quote.</p>
      </div>`;
    return;
  }

  const { low, high } = PRICING[cat];
  body.innerHTML = `
    <div class="quote-range">
      <div class="range-label">Estimated Range</div>
      <div class="range-value"><span>$</span>${low} – <span>$</span>${high}</div>
    </div>
    <div class="quote-meta">
      <i class="bi bi-info-circle me-1"></i>
      Final price may vary based on condition and extras.
    </div>`;
}

// ---- FORM SUBMISSION ----
document.getElementById('bookingForm').addEventListener('submit', async function (e) {
  e.preventDefault();
  e.stopPropagation();

  const form = e.target;
  form.classList.add('was-validated');

  if (!form.checkValidity()) {
    showFeedback('formFeedback', 'Please fill in all required fields.', 'error');
    return;
  }

  const cat = document.getElementById('property_size_category').value;
  const pricing = PRICING[cat] || { low: null, high: null };

  const payload = {
    id: crypto.randomUUID(),
    submitted_at: new Date().toISOString(),
    client_name:            getVal('client_name'),
    phone:                  getVal('phone'),
    address:                getVal('address'),
    beds_baths:             getVal('beds_baths'),
    property_type:          getVal('property_type'),
    approx_sq_ft:           getVal('approx_sq_ft'),
    property_size_category: cat,
    service_type:           getVal('service_type'),
    access:                 getVal('access'),
    pets:                   getVal('pets'),
    notes:                  getVal('notes'),
    service_date:           getVal('service_date'),
    arrival_time:           getVal('arrival_time'),
    suggested_price_low:    pricing.low,
    suggested_price_high:   pricing.high,
  };

  // Save locally first (works offline)
  const bookings = getBookings();
  bookings.push(payload);
  saveBookings(bookings);

  // Try to sync to Worker
  const settings = getSettings();
  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Saving…';

  let workerMsg = '';
  if (settings.workerUrl && settings.userToken) {
    try {
      const res = await fetch(settings.workerUrl + '/api/bookings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + settings.userToken,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        workerMsg = ' <i class="bi bi-cloud-check-fill text-success"></i> Synced to cloud.';
      } else {
        workerMsg = ` <i class="bi bi-cloud-slash text-warning"></i> Saved locally. Cloud sync failed: ${data.error || res.status}`;
      }
    } catch (err) {
      workerMsg = ` <i class="bi bi-cloud-slash text-warning"></i> Saved locally. Could not reach Worker: ${err.message}`;
    }
  } else {
    workerMsg = ' <small class="text-muted">(Configure Settings to enable cloud sync.)</small>';
  }

  btn.disabled = false;
  btn.innerHTML = '<i class="bi bi-cloud-upload me-2"></i>Save Booking';

  showFeedback('formFeedback', `<i class="bi bi-check-circle-fill me-1"></i>Booking saved!${workerMsg}`, 'success');
  resetForm();
});

function getVal(id) {
  return document.getElementById(id)?.value?.trim() || '';
}

function resetForm() {
  const form = document.getElementById('bookingForm');
  form.reset();
  form.classList.remove('was-validated');
  updateQuote();
  document.getElementById('formFeedback').innerHTML = '';
}

// ---- BOOKINGS TABLE ----
function renderBookingsTable() {
  const search = (document.getElementById('bookingSearch')?.value || '').toLowerCase();
  const sort = document.getElementById('bookingSort')?.value || 'date_asc';
  let bookings = getBookings();

  if (search) {
    bookings = bookings.filter(b =>
      (b.client_name || '').toLowerCase().includes(search) ||
      (b.phone || '').toLowerCase().includes(search) ||
      (b.address || '').toLowerCase().includes(search)
    );
  }

  bookings.sort((a, b) => {
    if (sort === 'date_asc')  return (a.service_date || '') < (b.service_date || '') ? -1 : 1;
    if (sort === 'date_desc') return (a.service_date || '') > (b.service_date || '') ? -1 : 1;
    if (sort === 'name_asc')  return (a.client_name || '') < (b.client_name || '') ? -1 : 1;
    return 0;
  });

  const tbody = document.getElementById('bookingsBody');
  const empty = document.getElementById('bookingsEmpty');
  const table = document.getElementById('bookingsTable');

  if (bookings.length === 0) {
    tbody.innerHTML = '';
    empty.classList.remove('d-none');
    table.classList.add('d-none');
    return;
  }

  empty.classList.add('d-none');
  table.classList.remove('d-none');

  tbody.innerHTML = bookings.map(b => `
    <tr>
      <td><strong>${b.service_date || '—'}</strong></td>
      <td>${esc(b.client_name)}</td>
      <td>${esc(b.phone)}</td>
      <td>${esc(b.address)}</td>
      <td>${esc(b.service_type) || '—'}</td>
      <td>${esc(b.property_size_category) || '—'}</td>
      <td>${b.suggested_price_low ? '$' + b.suggested_price_low + '–$' + b.suggested_price_high : '—'}</td>
      <td>
        <button class="btn-delete" onclick="deleteBooking('${b.id}')">
          <i class="bi bi-trash3"></i> Delete
        </button>
      </td>
    </tr>
  `).join('');
}

function deleteBooking(id) {
  if (!confirm('Delete this booking? This cannot be undone.')) return;
  const updated = getBookings().filter(b => b.id !== id);
  saveBookings(updated);
  renderBookingsTable();
}

// ---- SCHEDULE ----
function renderSchedule() {
  const today = new Date().toISOString().slice(0, 10);
  let bookings = getBookings()
    .filter(b => b.service_date && b.service_date >= today)
    .sort((a, b) => a.service_date < b.service_date ? -1 : 1);

  const container = document.getElementById('scheduleList');

  if (bookings.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="bi bi-calendar-x"></i>
        <p>No upcoming bookings.</p>
      </div>`;
    return;
  }

  // Group by date
  const groups = {};
  bookings.forEach(b => {
    if (!groups[b.service_date]) groups[b.service_date] = [];
    groups[b.service_date].push(b);
  });

  container.innerHTML = Object.entries(groups).map(([date, items]) => `
    <div class="schedule-day">
      <div class="schedule-day-label">
        <i class="bi bi-calendar3 text-teal"></i>
        ${formatDate(date)}
      </div>
      ${items.map(b => `
        <div class="schedule-item">
          <div class="schedule-time">${b.arrival_time ? formatTime(b.arrival_time) : 'TBD'}</div>
          <div class="schedule-info">
            <strong>${esc(b.client_name)}</strong>
            <span>${esc(b.address)}</span><br>
            <span class="badge-type">${esc(b.service_type) || 'Cleaning'}</span>
            ${b.suggested_price_low ? `<span class="badge-type ms-1">$${b.suggested_price_low}–$${b.suggested_price_high}</span>` : ''}
          </div>
        </div>
      `).join('')}
    </div>
  `).join('');
}

// ---- EXPORT ----
function renderExportInfo() {
  const count = getBookings().length;
  document.getElementById('exportFeedback').innerHTML =
    `<p class="text-muted mb-0"><i class="bi bi-database me-1"></i>${count} booking(s) stored locally.</p>`;
}

function exportCSV() {
  const bookings = getBookings();
  if (bookings.length === 0) {
    showFeedback('exportFeedback', 'No bookings to export.', 'error');
    return;
  }

  const cols = [
    'id','submitted_at','service_date','arrival_time',
    'client_name','phone','address',
    'beds_baths','property_type','approx_sq_ft','property_size_category',
    'service_type','access','pets','notes',
    'suggested_price_low','suggested_price_high'
  ];

  const rows = [cols.join(',')];
  bookings.forEach(b => {
    rows.push(cols.map(c => csvCell(b[c] ?? '')).join(','));
  });

  const blob = new Blob([rows.join('\r\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `colony-surf-bookings-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showFeedback('exportFeedback', `<i class="bi bi-check-circle-fill me-1"></i>Exported ${bookings.length} booking(s).`, 'success');
}

// ---- SETTINGS ----
function loadSettingsForm() {
  const s = getSettings();
  document.getElementById('workerUrl').value = s.workerUrl || '';
  document.getElementById('userToken').value = s.userToken || '';
}

function saveSettings() {
  const url = document.getElementById('workerUrl').value.trim().replace(/\/$/, '');
  const token = document.getElementById('userToken').value.trim();
  saveSettingsData({ workerUrl: url, userToken: token });
  showFeedback('settingsFeedback', '<i class="bi bi-check-circle-fill me-1"></i>Settings saved!', 'success');
}

async function testConnection() {
  const url = document.getElementById('workerUrl').value.trim().replace(/\/$/, '');
  const token = document.getElementById('userToken').value.trim();

  if (!url) {
    showFeedback('settingsFeedback', 'Please enter a Worker Base URL first.', 'error');
    return;
  }

  showFeedback('settingsFeedback', '<span class="spinner-border spinner-border-sm me-2"></span>Testing…', 'success');

  try {
    const res = await fetch(url + '/api/ping', {
      headers: { 'Authorization': 'Bearer ' + token },
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      showFeedback('settingsFeedback', '<i class="bi bi-wifi me-1"></i>Connection successful! Worker is reachable.', 'success');
    } else {
      showFeedback('settingsFeedback', `Worker responded with: ${JSON.stringify(data)}`, 'error');
    }
  } catch (err) {
    showFeedback('settingsFeedback', `Could not reach Worker: ${err.message}`, 'error');
  }
}

function toggleTokenVis() {
  const input = document.getElementById('userToken');
  const icon = document.getElementById('tokenEyeIcon');
  if (input.type === 'password') {
    input.type = 'text';
    icon.className = 'bi bi-eye-slash';
  } else {
    input.type = 'password';
    icon.className = 'bi bi-eye';
  }
}

// ---- HELPERS ----
function showFeedback(elId, msg, type) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.className = type === 'success' ? 'feedback-success' : 'feedback-error';
  el.innerHTML = msg;
}

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function csvCell(val) {
  const str = String(val).replace(/"/g, '""');
  return /[,"\n\r]/.test(str) ? `"${str}"` : str;
}

function formatDate(iso) {
  const [y, m, d] = iso.split('-');
  const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const days  = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const dt = new Date(Number(y), Number(m) - 1, Number(d));
  return `${days[dt.getDay()]}, ${names[Number(m) - 1]} ${Number(d)}, ${y}`;
}

function formatTime(t) {
  if (!t) return 'TBD';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${ampm}`;
}

// ---- INIT ----
document.addEventListener('DOMContentLoaded', () => {
  showPage('booking');
});
