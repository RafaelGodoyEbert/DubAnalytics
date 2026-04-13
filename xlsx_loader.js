/* xlsx_loader.js - Excel Parsing & Duration Utilities */

var MONTH_ORDER = { 'Jan':0,'Fev':1,'Mar':2,'Abr':3,'Mai':4,'Jun':5,'Jul':6,'Ago':7,'Set':8,'Out':9,'Nov':10,'Dez':11 };

/**
 * Normalizes duration values to seconds.
 * Handles Excel serial time (fractions of a day), HH:MM:SS strings, Date objects.
 * Caps at 24 hours per single video (sanity guard).
 */
function durationToSeconds(val) {
  if (val === null || val === undefined || val === '' || val === false) return 0;
  
  // Date object (from cellDates:true) — extract time-of-day only
  if (val instanceof Date) {
    var h = val.getUTCHours();
    var m = val.getUTCMinutes();
    var s = val.getUTCSeconds();
    return h * 3600 + m * 60 + s;
  }
  
  // Number — Excel stores durations as fractional days (0.5 = 12 hours)
  if (typeof val === 'number') {
    // If it looks like an Excel serial fraction (0 to ~2 range), convert
    if (val >= 0 && val < 2) {
      return Math.round(val * 86400);
    }
    // If it's a small-ish number, could already be seconds or minutes
    // Cap at reasonable per-video value (86400 = 24 hours)
    if (val > 0 && val <= 86400) {
      return Math.round(val);
    }
    // Anything bigger is likely garbage data; return 0
    return 0;
  }
  
  // String — try HH:MM:SS or MM:SS
  var str = String(val).trim();
  if (!str) return 0;
  var parts = str.split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

/**
 * Converts seconds to HH:MM:SS string. Guards against NaN/Infinity.
 */
function secondsToHMS(s) {
  if (!s || isNaN(s) || !isFinite(s)) return '00:00:00';
  s = Math.abs(Math.round(s));
  var h = Math.floor(s / 3600);
  var m = Math.floor((s % 3600) / 60);
  var sec = s % 60;
  return pad2(h) + ':' + pad2(m) + ':' + pad2(sec);
}

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

/**
 * Sorts month labels chronologically. Newest first (descending).
 */
function sortMonthLabelDesc(a, b) {
  var pa = a.split(' '), pb = b.split(' ');
  var ya = parseInt(pa[1]) || 0, yb = parseInt(pb[1]) || 0;
  var ma = MONTH_ORDER[pa[0]], mb = MONTH_ORDER[pb[0]];
  
  // Penalize invalid labels
  var ka = (ma === undefined || ya === 0) ? 0 : ya * 100 + ma;
  var kb = (mb === undefined || yb === 0) ? 0 : yb * 100 + mb;
  
  return kb - ka; // Descending
}

/**
 * Sorts month labels chronologically. Oldest first (ascending) — for charts.
 */
function sortMonthLabelAsc(a, b) {
  var pa = a.split(' '), pb = b.split(' ');
  var ya = parseInt(pa[1]) || 0, yb = parseInt(pb[1]) || 0;
  var ma = MONTH_ORDER[pa[0]], mb = MONTH_ORDER[pb[0]];
  
  // Penalize invalid labels
  var ka = (ma === undefined || ya === 0) ? 999999 : ya * 100 + ma;
  var kb = (mb === undefined || yb === 0) ? 999999 : yb * 100 + mb;
  
  return ka - kb; // Ascending
}

/**
 * Parses the provided Excel file object.
 * Uses raw mode (no cellDates) so times stay as fractional numbers.
 */
async function parseExcelFile(file, clientName) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function(e) {
      var data = new Uint8Array(e.target.result);
      // NO cellDates — keep times as raw numbers
      var workbook = XLSX.read(data, { type: 'array', cellDates: false, cellNF: false, cellText: false });
      
      var clientId = clientName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+$/, '');
      var monthlyData = [];
      var videoRecords = [];

      var VALID_MONTH_PREFIXES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

      workbook.SheetNames.forEach(function(sheetName) {
        if (['Resumo', 'Calculo', 'Cópia de Calculo'].indexOf(sheetName) >= 0) return;
        
        // Strict Filter: Sheet name MUST start with a valid month code and follow by space then year
        // This avoids "residues" like "Silva e Larie" being treated as months
        var isMonthSheet = VALID_MONTH_PREFIXES.some(m => sheetName.startsWith(m + ' '));
        if (!isMonthSheet) {
          console.log('Skipping non-month sheet:', sheetName);
          return;
        }

        var sheet = workbook.Sheets[sheetName];
        var rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        
        var monthLabel = sheetName;
        var monthId = clientId + '_' + sheetName.replace(/\s+/g, '_');

        var pricePerVideo = 40;
        var basePay = 500;
        var baseVideos = 15;
        var bonus = 0;
        var compensate = false;

        rows.forEach(function(row, idx) {
          if (idx === 0) return; // Skip header
          
          var transcript = !!row[0];
          var done = !!row[1];
          var title = row[2];
          var idiomas = parseInt(row[3]) || 7;
          var chars = parseInt(row[4]) || 0;
          var words = parseInt(row[5]) || 0;
          var timeVideo = row[6];
          var timeDub = row[7];
          var timeWork = row[10];

          if (title !== undefined && title !== null && String(title).trim()) {
            title = String(title).trim();
            videoRecords.push({
              id: monthId + '_' + idx,
              rowIndex: idx,
              clientId: clientId,
              monthId: monthId,
              label: String(monthLabel).replace(/&/g, ''),
              titulo: title.trim(),
              feito: done,
              transcrito: transcript,
              idiomas: idiomas,
              chars: chars,
              palavras: words,
              tempo: durationToSeconds(timeVideo),
              tempo_dub: durationToSeconds(timeDub),
              tempo_fazer: durationToSeconds(timeWork),
              year: parseInt(monthLabel.split(' ')[1]) || new Date().getFullYear()
            });
          }
        });
        
        monthlyData.push({
          id: monthId,
          clientId: clientId,
          label: String(monthLabel).replace(/&/g, ''),
          price_per_video: pricePerVideo,
          base_payment: basePay,
          base_videos: baseVideos,
          bonus: bonus,
          compensate: compensate
        });
      });

      resolve({
        client: { id: clientId, name: clientName },
        configs: monthlyData,
        videos: videoRecords
      });
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

window.ExcelParser = {
  parseExcelFile: parseExcelFile,
  durationToSeconds: durationToSeconds,
  secondsToHMS: secondsToHMS,
  sortMonthLabelDesc: sortMonthLabelDesc,
  sortMonthLabelAsc: sortMonthLabelAsc,
  MONTH_ORDER: MONTH_ORDER
};
