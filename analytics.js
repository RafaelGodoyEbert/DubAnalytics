/* analytics.js - Standalone Analytics Engine */

const MONTH_NAMES = 'Jan Fev Mar Abr Mai Jun Jul Ago Set Out Nov Dez'.split(' ');

/**
 * Converts a string to ASCII-safe characters for jsPDF (Helvetica font only supports Latin-1).
 * jsPDF internally corrupts non-ASCII chars by inserting & between bytes.
 * This function is the definitive fix.
 */
function toSafePDF(str) {
  if (!str || typeof str !== 'string') return str || '';
  
  // Step 0: Remove ALL ampersands first (they are corruption artifacts)
  let result = str.replace(/&/g, '');
  
  // Step 1: Replace known non-ASCII / problematic characters with ASCII equivalents
  const charMap = {
    '\u2022': '-', '\u00b7': '-', '\u2019': "'", '\u2018': "'",
    '\u2014': '-', '\u2013': '-', '\u2026': '...', '\u00A0': ' ',
    '\u00e0': 'a', '\u00e1': 'a', '\u00e2': 'a', '\u00e3': 'a', '\u00e4': 'a',
    '\u00e9': 'e', '\u00ea': 'e', '\u00e8': 'e', '\u00eb': 'e',
    '\u00ed': 'i', '\u00ec': 'i', '\u00ee': 'i', '\u00ef': 'i',
    '\u00f3': 'o', '\u00f4': 'o', '\u00f5': 'o', '\u00f2': 'o', '\u00f6': 'o',
    '\u00fa': 'u', '\u00fb': 'u', '\u00f9': 'u', '\u00fc': 'u',
    '\u00e7': 'c', '\u00f1': 'n',
    '\u00c0': 'A', '\u00c1': 'A', '\u00c2': 'A', '\u00c3': 'A', '\u00c4': 'A',
    '\u00c9': 'E', '\u00ca': 'E', '\u00c8': 'E', '\u00cb': 'E',
    '\u00cd': 'I', '\u00cc': 'I', '\u00ce': 'I', '\u00cf': 'I',
    '\u00d3': 'O', '\u00d4': 'O', '\u00d5': 'O', '\u00d2': 'O', '\u00d6': 'O',
    '\u00da': 'U', '\u00db': 'U', '\u00d9': 'U', '\u00dc': 'U',
    '\u00c7': 'C', '\u00d1': 'N'
  };
  
  for (const [from, to] of Object.entries(charMap)) {
    result = result.split(from).join(to);
  }
  
  // Step 2: Aggressively strip ANY non-ASCII character (retaining only space up to ~)
  result = result.replace(/[^\x20-\x7E]/g, '');
  
  // Step 3: Final cleanup of extra spaces and ampersands
  return result.replace(/&/g, '').replace(/\s+/g, ' ').trim();
}

// Alias for backwards compatibility
const sanitize = toSafePDF;

/**
 * Parses a month label like "Jan 2024" into a sortable number (202400).
 */
function monthLabelToSortKey(label) {
  const parts = (label || '').split(' ');
  const monthName = parts[0];
  const year = parseInt(parts[1]) || 0;
  const monthIdx = MONTH_NAMES.indexOf(monthName);
  
  if (monthIdx === -1 || isNaN(year) || year === 0) return 999999;
  
  return year * 100 + monthIdx;
}

/**
 * Groups videos by criteria and calculates accurate earnings based on monthly configs.
 */
function groupData(videos, configs, timeframe) {
  timeframe = timeframe || 'month';
  const groups = {};
  
  videos.forEach(v => {
    let key;
    const label = (v.label || '').trim();
    const dateParts = label.split(' ');
    const month = dateParts[0] || '';
    const year = parseInt(dateParts[1]) || 0;
    const monthIdx = MONTH_NAMES.indexOf(month);

    if (timeframe === 'month' && (monthIdx === -1 || isNaN(year) || year === 0)) {
      return; 
    }
    
    if (timeframe === 'year') {
      key = String(year);
      if (isNaN(year) || year === 0) return;
    } else if (timeframe === 'quarter') {
      const q = monthIdx >= 0 ? Math.floor(monthIdx / 3) + 1 : 1;
      key = `Q${q} ${year}`;
      if (isNaN(year) || year === 0) return;
    } else if (timeframe === 'semester') {
      const s = monthIdx >= 0 && monthIdx < 6 ? 1 : 2;
      key = `S${s} ${year}`;
      if (isNaN(year) || year === 0) return;
    } else {
      key = label || 'Sem Mês';
    }

    if (!groups[key]) {
      groups[key] = { 
        label: key, 
        earnings: 0, 
        count: 0, 
        countTotal: 0, 
        chars: 0, 
        words: 0, 
        time: 0, 
        vTime: 0, 
        _monthIds: new Set(), 
        _sortKey: 0 
      };
    }

    const g = groups[key];
    g._monthIds.add(v.monthId);
    g.countTotal++;

    if (timeframe === 'year') {
      g._sortKey = year;
    } else if (timeframe === 'quarter') {
      g._sortKey = year * 10 + (monthIdx >= 0 ? Math.floor(monthIdx / 3) + 1 : 0);
    } else if (timeframe === 'semester') {
      g._sortKey = year * 10 + (monthIdx >= 0 && monthIdx < 6 ? 1 : 2);
    } else {
      g._sortKey = monthLabelToSortKey(label);
    }

    if (v.feito) {
      if (v.tipo_item === 'outros') return;

      g.count++;
      g.chars += parseInt(v.chars) || 0;
      g.words += parseInt(v.palavras) || 0;
      
      if (parseFloat(v.tempo_fazer) > 0) {
        g.time += parseFloat(v.tempo_fazer);
        g.vTime += parseFloat(v.tempo) || 0;
      }
    }
  });

  const finalGroups = Object.values(groups).filter(g => g._sortKey < 999999);
  
  if (timeframe === 'month') {
    finalGroups.sort((a, b) => a._sortKey - b._sortKey);
  }

  const clientBalances = {};

  finalGroups.forEach(g => {
    let groupEarnings = 0;
    
    const mIds = Array.from(g._monthIds).sort();

    mIds.forEach(mId => {
      const config = (configs || []).find(c => c.id === mId);
      const mVideos = videos.filter(v => v.monthId === mId);
      
      if (mVideos.length === 0) return;

      if (config) {
        const cid = config.clientId;

        if (!clientBalances[cid]) {
          clientBalances[cid] = {
            done: 0,
            base: 0,
            extraPaid: 0
          };
        }

        const bal = clientBalances[cid];

        let ppv = parseFloat(config.price_per_video);
        if (isNaN(ppv)) ppv = 40;

        let base = parseFloat(config.base_payment);
        if (isNaN(base)) base = 500;

        let baseVideos = parseFloat(config.base_videos);
        if (isNaN(baseVideos)) baseVideos = 15;

        let bonus = parseFloat(config.bonus);
        if (isNaN(bonus)) bonus = 0;

        const isCobrado = v => v.feito && v.cobrado !== false;

        const outrosEarnings = mVideos
          .filter(v => isCobrado(v) && v.tipo_item === 'outros')
          .reduce((s, v) => s + (parseFloat(v.valor_individual) || 0), 0);

        const mVideosCobradosNormal = mVideos.filter(
          v => isCobrado(v) && v.tipo_item !== 'outros'
        ).length;

        if (config.compensate) {
          bal.done += mVideosCobradosNormal;
          bal.base += baseVideos;

          const cumOverage = Math.max(0, bal.done - bal.base);
          const extraToPayThisMonth = Math.max(0, cumOverage - bal.extraPaid);
          
          groupEarnings +=
            base +
            extraToPayThisMonth * ppv +
            bonus +
            outrosEarnings;

          bal.extraPaid += extraToPayThisMonth;
        } else {
          const extraToPayThisMonth = Math.max(
            0,
            mVideosCobradosNormal - baseVideos
          );

          groupEarnings +=
            base +
            extraToPayThisMonth * ppv +
            bonus +
            outrosEarnings;
        }
      } else {
        groupEarnings += mVideos.filter(
          v => v.feito &&
            v.cobrado !== false &&
            v.tipo_item !== 'outros'
        ).length * 40;
      }
    });

    g.earnings = groupEarnings;
    g.ratio = g.vTime > 0 ? g.time / g.vTime : 0;
  });

  return finalGroups.sort((a, b) => a._sortKey - b._sortKey);
}

/**
 * Detects topic from video title.
 */
function detectTopic(title) {
  if (!title) return 'OUTROS';

  const t = title.toUpperCase();

  if (t.includes('GTA')) return 'GTA';
  if (
    t.includes('RED DEAD') ||
    t.includes('RDR') ||
    t.includes('ARTHUR')
  ) {
    return 'RDR';
  }

  if (
    t.includes('ENTREVISTA') ||
    t.includes('INTERVIEW')
  ) {
    return 'ENTREVISTA';
  }

  if (t.includes('REACT')) return 'REACT';

  return 'OUTROS';
}

/**
 * Calculates advanced metrics for a set of videos.
 */
function getAdvancedMetrics(videos) {
  const done = videos.filter(
    v => v.feito && v.tempo > 0 && v.tempo_fazer > 0
  );

  if (done.length === 0) return null;

  const totalV = done.reduce(
    (s, v) => s + v.tempo,
    0
  );

  const totalW = done.reduce(
    (s, v) => s + v.tempo_fazer,
    0
  );

  const totalChars = done.reduce(
    (s, v) => s + (parseInt(v.chars) || 0),
    0
  );

  const topics = {};
  const langs = {};

  done.forEach(v => {
    const topic = detectTopic(v.titulo);

    if (!topics[topic]) {
      topics[topic] = {
        time: 0,
        vTime: 0,
        count: 0
      };
    }

    topics[topic].time += v.tempo_fazer;
    topics[topic].vTime += v.tempo;
    topics[topic].count++;

    const languageCount = v.idiomas || 1;

    if (!langs[languageCount]) {
      langs[languageCount] = {
        time: 0,
        vTime: 0,
        count: 0
      };
    }

    langs[languageCount].time += v.tempo_fazer;
    langs[languageCount].vTime += v.tempo;
    langs[languageCount].count++;
  });

  return {
    globalRatio: totalW / totalV,

    charsPerHour:
      totalW > 0
        ? totalChars / (totalW / 3600)
        : 0,

    topics: Object.keys(topics).map(k => ({
      label: k,
      ratio: topics[k].time / topics[k].vTime,
      count: topics[k].count
    })),

    scaling: Object.keys(langs)
      .map(k => ({
        label: k + ' Idiomas',
        ratio: langs[k].time / langs[k].vTime,
        count: langs[k].count
      }))
      .sort(
        (a, b) => parseInt(a.label) - parseInt(b.label)
      )
  };
}

/**
 * Renders multiple charts for detailed analysis.
 */
function renderAdvancedCharts(containerId, metrics) {
  const container = document.getElementById(containerId);

  if (!container || !metrics) return;

  const prefix = containerId + '-';
  const idTopics = prefix + 'chart-topics';
  const idScaling = prefix + 'chart-scaling';

  container.innerHTML = `
    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin-top: 20px">
      <div class="card" style="min-height:300px">
        <h3 style="font-size:12px; color:var(--text-dim); margin-bottom:15px; text-transform:uppercase; letter-spacing:0.05em">
          Esforço por Tema (Ratio)
        </h3>
        <div class="chart-container" style="height:220px">
          <canvas id="${idTopics}"></canvas>
        </div>
      </div>

      <div class="card" style="min-height:300px">
        <h3 style="font-size:12px; color:var(--text-dim); margin-bottom:15px; text-transform:uppercase; letter-spacing:0.05em">
          Custo de Escala (Idiomas)
        </h3>
        <div class="chart-container" style="height:220px">
          <canvas id="${idScaling}"></canvas>
        </div>
      </div>
    </div>
  `;

  renderSimpleBar(
    idTopics,
    metrics.topics,
    'Ratio',
    '#10b981'
  );

  renderSimpleBar(
    idScaling,
    metrics.scaling,
    'Ratio',
    '#6366f1'
  );
}

function renderSimpleBar(id, data, label, color) {
  const element = document.getElementById(id);

  if (!element) return;

  const ctx = element.getContext('2d');

  const chartKey = '_chart_' + id;

  if (window[chartKey]) {
    window[chartKey].destroy();
  }

  window[chartKey] = new Chart(ctx, {
    type: 'bar',

    data: {
      labels: data.map(d => d.label),

      datasets: [{
        label: label,
        data: data.map(d => Number(d.ratio.toFixed(2))),
        backgroundColor: color + 'cc',
        borderColor: color,
        borderWidth: 1,
        borderRadius: 4
      }]
    },

    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,

      plugins: {
        legend: {
          display: false
        }
      },

      scales: {
        x: {
          beginAtZero: true,

          ticks: {
            color: '#94a3b8'
          },

          grid: {
            color: 'rgba(255,255,255,0.05)'
          }
        },

        y: {
          ticks: {
            color: '#94a3b8'
          },

          grid: {
            display: false
          }
        }
      }
    }
  });
}

function renderCharts(canvasId, dataset, type) {
  type = type || 'bar';

  const canvas = document.getElementById(canvasId);

  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const existingKey = '_chart_' + canvasId;

  if (window[existingKey]) {
    window[existingKey].destroy();
  }

  window[existingKey] = new Chart(ctx, {
    type: type,

    data: {
      labels: dataset.map(d => d.label),

      datasets: [
        {
          label: 'Ganhos (R$)',
          data: dataset.map(d => d.earnings),
          backgroundColor: 'rgba(245, 158, 11, 0.8)',
          borderColor: '#f59e0b',
          borderWidth: 1,
          borderRadius: 4
        },

        {
          label: 'Ratio Eficiência',
          data: dataset.map(d => Number(d.ratio.toFixed(2))),
          type: 'line',
          borderColor: '#10b981',
          borderWidth: 2,
          pointRadius: 4,
          backgroundColor: 'transparent',
          yAxisID: 'y1'
        }
      ]
    },

    options: {
      responsive: true,
      maintainAspectRatio: false,

      plugins: {
        legend: {
          labels: {
            color: '#e2e8f0',
            boxWidth: 12,
            font: {
              size: 11
            }
          }
        }
      },

      scales: {
        x: {
          ticks: {
            color: '#94a3b8'
          },

          grid: {
            color: 'rgba(255,255,255,0.05)'
          }
        },

        y: {
          ticks: {
            color: '#94a3b8'
          },

          grid: {
            color: 'rgba(255,255,255,0.05)'
          },

          title: {
            display: true,
            text: 'Ganhos (R$)',
            color: '#94a3b8',
            font: {
              size: 10
            }
          }
        },

        y1: {
          position: 'right',
          min: 0,
          suggestedMax: 15,

          ticks: {
            color: '#10b981',
            font: {
              bold: true
            }
          },

          grid: {
            drawOnChartArea: false
          },

          title: {
            display: true,
            text: 'Ratio de Esforço',
            color: '#10b981',
            font: {
              size: 10
            }
          }
        }
      }
    }
  });
}

function exportUnifiedPDF(title, dataset, summary, showTime = true) {
  const { jsPDF } = window.jspdf;

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();

  const originalAddPage = doc.addPage;

  doc.addPage = function() {
    originalAddPage.apply(this, arguments);

    doc.setFillColor(10, 18, 30);
    doc.rect(0, 0, W, H, 'F');

    return this;
  };

  const oldText = doc.text;

  doc.text = function(text, x, y, options) {
    if (typeof text === 'string') {
      text = toSafePDF(text);
    } else if (Array.isArray(text)) {
      text = text.map(
        t => typeof t === 'string'
          ? toSafePDF(t)
          : t
      );
    }

    return oldText.call(this, text, x, y, options);
  };

  doc.setFillColor(10, 18, 30);
  doc.rect(0, 0, W, H, 'F');

  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, W, 50, 'F');

  doc.setTextColor(245, 158, 11);
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.text('DubAnalytics Report', 15, 20);

  doc.setTextColor(100, 116, 139);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text(
    'BUSINESS & PERFORMANCE INTELLIGENCE',
    15,
    26
  );

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');

  const safeTitle = toSafePDF(title).toUpperCase();

  doc.text(safeTitle, 15, 38);

  doc.setTextColor(148, 163, 184);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(
    'Visao Consolidada de Performance',
    15,
    44
  );

  doc.setTextColor(245, 158, 11);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('PERFORMANCE SNAPSHOT', 15, 62);

  const activeCardsCount = showTime ? 3 : 2;
  const cardW = (W - 40) / activeCardsCount;
  const cardY = 66;
  const cardH = 26;
  const cardGap = 5;

  const drawKPICard = (
    x,
    cardTitle,
    value,
    unit,
    color
  ) => {
    doc.setFillColor(15, 23, 42);

    doc.roundedRect(
      x,
      cardY,
      cardW,
      cardH,
      3,
      3,
      'F'
    );

    doc.setTextColor(148, 163, 184);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');

    doc.text(
      cardTitle.toUpperCase(),
      x + 6,
      cardY + 8
    );

    const lines = String(value).split('\n');
    const mainValue = lines[0];
    const subValue = lines[1] || '';

    doc.setTextColor(
      color[0],
      color[1],
      color[2]
    );

    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');

    doc.text(
      mainValue,
      x + 6,
      cardY + 18
    );

    if (subValue) {
      doc.setFontSize(6);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);

      doc.text(
        subValue,
        x + 6,
        cardY + 23
      );
    }

    if (unit && !subValue) {
      const valW = doc.getTextWidth(mainValue);

      doc.setFontSize(7);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);

      doc.text(
        unit,
        x + 8 + valW,
        cardY + 18
      );
    }
  };

  let earnTxt = String(
    summary.earnings || 'R$ 0,00'
  );

  let countTxt = String(
    summary.count || '0'
  );

  let hoursTxt = String(
    summary.hours || '00:00:00'
  )
    .split('(')[0]
    .trim();

  earnTxt = earnTxt.replace('Ganhos: ', '');
  countTxt = countTxt.replace('Videos: ', '');
  hoursTxt = hoursTxt.replace('Horas: ', '');

  drawKPICard(
    15,
    'Faturamento Total',
    earnTxt,
    '',
    [16, 185, 129]
  );

  drawKPICard(
    15 + cardW + cardGap,
    'Vídeos Produzidos',
    countTxt,
    'TOTAL',
    [255, 255, 255]
  );

  if (showTime) {
    drawKPICard(
      15 + (cardW + cardGap) * 2,
      'Esforço Acumulado',
      hoursTxt,
      '',
      [245, 158, 11]
    );
  }

  const tableHead = showTime
    ? [[
        'PERÍODO',
        'VÍDEOS',
        'GANHOS (R$)',
        'RATIO',
        'CHARS',
        'TEMPO'
      ]]
    : [[
        'PERÍODO',
        'VÍDEOS',
        'GANHOS (R$)',
        'CHARS'
      ]];

  const tableBody = dataset.map(d => {
    const row = [
      toSafePDF(d.label || '').toUpperCase(),
      d.count,
      d.earnings.toLocaleString(
        'pt-BR',
        {
          minimumFractionDigits: 2
        }
      ),
      (parseInt(d.chars) || 0).toLocaleString(
        'pt-BR'
      )
    ];

    if (showTime) {
      row.splice(
        3,
        0,
        d.ratio.toFixed(2) + 'x'
      );

      row.push(
        window.ExcelParser.secondsToHMS(d.time)
      );
    }

    return row;
  });

  doc.autoTable({
    startY: 102,
    head: tableHead,
    body: tableBody,

    styles: {
      fontSize: 7.5,
      textColor: [203, 213, 225],
      fillColor: [10, 18, 30],
      cellPadding: 3.5,
      font: 'helvetica',
      lineWidth: 0,
      minCellHeight: 10,
      valign: 'middle'
    },

    headStyles: {
      fillColor: [15, 23, 42],
      textColor: [245, 158, 11],
      fontStyle: 'bold',
      fontSize: 7,
      halign: 'left',
      cellPadding: 4
    },

    alternateRowStyles: {
      fillColor: [15, 23, 42]
    },

    columnStyles: {
      0: {
        cellWidth: 32,
        fontStyle: 'bold'
      },

      1: {
        cellWidth: 20,
        halign: 'center'
      },

      2: {
        cellWidth: 'auto'
      },

      3: {
        cellWidth: 24,
        halign: showTime
          ? 'center'
          : 'right'
      },

      4: {
        cellWidth: 24,
        halign: 'right'
      },

      5: {
        cellWidth: 24,
        halign: 'center'
      }
    },

    didDrawCell: function(data) {
      if (
        data.row.index !== undefined &&
        data.section === 'body'
      ) {
        doc.setDrawColor(30, 41, 59);
        doc.setLineWidth(0.05);

        doc.line(
          data.cell.x,
          data.cell.y + data.cell.height,
          data.cell.x + data.cell.width,
          data.cell.y + data.cell.height
        );
      }
    },

    didParseCell: function(data) {
      if (
        data.section === 'body' &&
        data.column.index === 2
      ) {
        data.cell.styles.textColor = [
          16,
          185,
          129
        ];
      }
    },

    margin: {
      left: 15,
      right: 15
    }
  });

  const footerX = 15;
  const finalY = doc.lastAutoTable.finalY + 15;

  const footerLines = [
    'Este documento foi gerado pelo sistema DubAnalytics Premium v3.0 em ' +
      new Date().toLocaleDateString('pt-BR'),

    'desenvolvido por Rafael Godoy'
  ];

  const renderFooter = y => {
    doc.setFontSize(7);
    doc.setTextColor(71, 85, 105);
    doc.setFont('helvetica', 'italic');

    doc.text(
      footerLines,
      footerX,
      y
    );
  };

  if (finalY < H - 20) {
    renderFooter(finalY);
  } else {
    doc.addPage();
    renderFooter(15);
  }

  let filenameBase = 'Overview';

  if (title.startsWith('Cliente: ')) {
    filenameBase += '_' +
      title
        .replace('Cliente: ', '')
        .replace(/\s+/g, '_');
  } else {
    filenameBase += '_Global';
  }

  doc.save(
    filenameBase +
      '_' +
      new Date()
        .toISOString()
        .slice(0, 10) +
      '.pdf'
  );
}

function exportMonthlyReportPDF(
  clientName,
  monthLabel,
  monthPeriod,
  videos,
  summary,
  showTime = true
) {
  const { jsPDF } = window.jspdf;

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();

  const oldText = doc.text;

  doc.text = function(text, x, y, options) {
    if (typeof text === 'string') {
      text = toSafePDF(text);
    } else if (Array.isArray(text)) {
      text = text.map(
        t => typeof t === 'string'
          ? toSafePDF(t)
          : t
      );
    }

    return oldText.call(
      this,
      text,
      x,
      y,
      options
    );
  };

  const originalAddPage = doc.addPage;

  doc.addPage = function() {
    originalAddPage.apply(
      this,
      arguments
    );

    doc.setFillColor(10, 18, 30);
    doc.rect(0, 0, W, H, 'F');

    return this;
  };

  doc.setFillColor(10, 18, 30);
  doc.rect(0, 0, W, H, 'F');

  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, W, 50, 'F');

  doc.setTextColor(245, 158, 11);
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');

  doc.text(
    'DubAnalytics Report',
    15,
    20
  );

  doc.setTextColor(100, 116, 139);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');

  doc.text(
    'BUSINESS & PERFORMANCE INTELLIGENCE',
    15,
    26
  );

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');

  doc.text(
    toSafePDF(clientName).toUpperCase(),
    15,
    38
  );

  doc.setTextColor(148, 163, 184);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');

  const safePeriod = toSafePDF(
    monthPeriod || ''
  );

  const headerSubText =
    toSafePDF(monthLabel) +
    (
      safePeriod
        ? ' | ' + safePeriod
        : ''
    );

  doc.text(
    headerSubText,
    15,
    44
  );

  doc.setTextColor(245, 158, 11);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');

  doc.text(
    'PERFORMANCE SNAPSHOT',
    15,
    62
  );

  const activeCardsCount = showTime ? 3 : 2;
  const cardW = (W - 40) / activeCardsCount;
  const cardY = 66;
  const cardH = 26;
  const cardGap = 5;

  const drawKPICard = (
    x,
    title,
    value,
    unit,
    color
  ) => {
    doc.setFillColor(15, 23, 42);

    doc.roundedRect(
      x,
      cardY,
      cardW,
      cardH,
      3,
      3,
      'F'
    );

    doc.setTextColor(148, 163, 184);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');

    doc.text(
      title.toUpperCase(),
      x + 6,
      cardY + 8
    );

    const lines = String(value).split('\n');
    const mainValue = lines[0];
    const subValue = lines[1] || '';

    doc.setTextColor(
      color[0],
      color[1],
      color[2]
    );

    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');

    doc.text(
      mainValue,
      x + 6,
      cardY + 18
    );

    if (subValue) {
      doc.setFontSize(6);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);

      doc.text(
        subValue,
        x + 6,
        cardY + 23
      );
    }

    if (unit && !subValue) {
      const valW = doc.getTextWidth(mainValue);

      doc.setFontSize(7);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);

      doc.text(
        unit,
        x + 8 + valW,
        cardY + 18
      );
    }
  };

  drawKPICard(
    15,
    'Faturamento Estimado',
    summary.earnings || 'R$ 0,00',
    '',
    [16, 185, 129]
  );

  drawKPICard(
    15 + cardW + cardGap,
    'Vídeos Entregues',
    summary.count || '0',
    'TOTAL',
    [255, 255, 255]
  );

  if (showTime) {
    drawKPICard(
      15 + (cardW + cardGap) * 2,
      'Esforço Acumulado',
      (
        summary.hours || '00:00:00'
      )
        .split('(')[0]
        .trim(),
      '',
      [245, 158, 11]
    );
  }

  const outrosVideos = videos.filter(
    v => v.tipo_item === 'outros' &&
      v.feito
  );

  const tableHead = showTime
    ? [[
        'STATUS',
        'DETALHES DO TRABALHO',
        'IDIOMAS',
        'CHARS',
        'TEMPO',
        'RATIO'
      ]]
    : [[
        'STATUS',
        'DETALHES DO TRABALHO',
        'IDIOMAS',
        'CHARS'
      ]];

  doc.autoTable({
    startY: 102,
    head: tableHead,

    body: videos
      .filter(v => v.tipo_item !== 'outros')
      .map(v => {
        let status;

        if (!v.feito) {
          status = 'PENDENTE';
        } else if (v.cobrado === false) {
          status = 'CORTESIA';
        } else {
          status = '';
        }

        const row = [
          status,
          toSafePDF(
            v.titulo || '–'
          ).toUpperCase(),
          v.idiomas || 7,
          toSafePDF(
            (
              parseInt(v.chars) || 0
            ).toLocaleString('pt-BR')
          )
        ];

        if (showTime) {
          const ratio =
            v.tempo > 0 &&
            v.tempo_fazer > 0
              ? (
                  v.tempo_fazer /
                  v.tempo
                ).toFixed(1) + 'x'
              : '–';

          row.push(
            toSafePDF(
              window.ExcelParser.secondsToHMS(
                v.tempo
              )
            )
          );

          row.push(
            toSafePDF(ratio)
          );
        }

        return row;
      }),

    styles: {
      fontSize: 7.5,
      textColor: [203, 213, 225],
      fillColor: [10, 18, 30],
      cellPadding: 3.5,
      font: 'helvetica',
      lineWidth: 0,
      minCellHeight: 10,
      valign: 'middle'
    },

    headStyles: {
      fillColor: [15, 23, 42],
      textColor: [245, 158, 11],
      fontStyle: 'bold',
      fontSize: 7,
      halign: 'left',
      cellPadding: 4
    },

    alternateRowStyles: {
      fillColor: [15, 23, 42]
    },

    columnStyles: {
      0: {
        cellWidth: 26,
        fontStyle: 'bold'
      },

      1: {
        cellWidth: 'auto'
      },

      2: {
        cellWidth: 24,
        halign: 'center'
      },

      3: {
        cellWidth: 20,
        halign: 'right'
      },

      4: {
        cellWidth: 22,
        halign: 'center'
      },

      5: {
        cellWidth: 20,
        halign: 'center'
      }
    },

    didDrawCell: function(data) {
      if (
        data.row.index !== undefined &&
        data.section === 'body'
      ) {
        doc.setDrawColor(30, 41, 59);
        doc.setLineWidth(0.05);

        doc.line(
          data.cell.x,
          data.cell.y + data.cell.height,
          data.cell.x + data.cell.width,
          data.cell.y + data.cell.height
        );
      }
    },

    didParseCell: function(data) {
      if (
        data.section === 'body' &&
        data.column.index === 0
      ) {
        if (data.cell.raw === 'CORTESIA') {
          data.cell.styles.textColor = [
            96,
            165,
            250
          ];
        } else if (
          data.cell.raw === 'PENDENTE'
        ) {
          data.cell.styles.textColor = [
            239,
            68,
            68
          ];
        }
      }
    },

    margin: {
      left: 15,
      right: 15
    }
  });

  if (outrosVideos.length > 0) {
    const outrosStartY =
      doc.lastAutoTable.finalY + 10;

    doc.setTextColor(16, 185, 129);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');

    doc.text(
      'TAREFAS AVULSAS',
      15,
      outrosStartY + 5
    );

    doc.autoTable({
      startY: outrosStartY + 8,

      head: [[
        'DESCRICAO',
        'VALOR (R$)'
      ]],

      body: outrosVideos.map(v => [
        toSafePDF(
          v.titulo || '–'
        ).toUpperCase(),

        (
          parseFloat(v.valor_individual) ||
          0
        ).toLocaleString(
          'pt-BR',
          {
            minimumFractionDigits: 2
          }
        )
      ]),

      styles: {
        fontSize: 7.5,
        textColor: [203, 213, 225],
        fillColor: [10, 18, 30],
        cellPadding: 3,
        font: 'helvetica',
        lineWidth: 0,
        minCellHeight: 9,
        valign: 'middle'
      },

      headStyles: {
        fillColor: [5, 46, 22],
        textColor: [16, 185, 129],
        fontStyle: 'bold',
        fontSize: 7,
        halign: 'left',
        cellPadding: 3
      },

      alternateRowStyles: {
        fillColor: [10, 30, 20]
      },

      columnStyles: {
        0: {
          cellWidth: 'auto'
        },

        1: {
          cellWidth: 32,
          halign: 'right',
          textColor: [16, 185, 129],
          fontStyle: 'bold'
        }
      },

      margin: {
        left: 15,
        right: 15
      }
    });

    const totalOutros =
      outrosVideos.reduce(
        (s, v) =>
          s +
          (
            parseFloat(v.valor_individual) ||
            0
          ),
        0
      );

    const totY =
      doc.lastAutoTable.finalY + 5;

    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(16, 185, 129);

    doc.text(
      'Total Tarefas Avulsas: R$ ' +
        totalOutros.toLocaleString(
          'pt-BR',
          {
            minimumFractionDigits: 2
          }
        ),
      W - 15,
      totY,
      {
        align: 'right'
      }
    );
  }

  const footerX = 15;
  const finalY =
    doc.lastAutoTable.finalY + 15;

  const footerLines = [
    'Este documento foi gerado pelo sistema DubAnalytics Premium v3.0 em ' +
      new Date().toLocaleDateString('pt-BR'),

    'desenvolvido por Rafael Godoy'
  ];

  const renderFooter = y => {
    doc.setFontSize(7);
    doc.setTextColor(71, 85, 105);
    doc.setFont('helvetica', 'italic');

    doc.text(
      footerLines,
      footerX,
      y
    );
  };

  if (finalY < H - 20) {
    renderFooter(finalY);
  } else {
    doc.addPage();
    renderFooter(15);
  }

  doc.save(
    'MonthlyReport_' +
      clientName.replace(/\s+/g, '_') +
      '_' +
      monthLabel.replace(/\s+/g, '_') +
      '.pdf'
  );
}

/**
 * Calculates the price required to hit a target hourly rate.
 * `seconds` must be the effective work time (tempo_fazer),
 * not source-video duration.
 */
function calculateSuggestedPrice(
  seconds,
  targetHourlyRate
) {
  const workSeconds = Math.max(
    0,
    parseFloat(seconds) || 0
  );

  const rate = Math.max(
    0,
    parseFloat(targetHourlyRate) || 0
  );

  return (
    workSeconds / 3600
  ) * rate;
}

/**
 * Calculates a package price from average effective work time per item.
 */
function calculatePackagePrice(
  avgSeconds,
  count,
  rate
) {
  const average = Math.max(
    0,
    parseFloat(avgSeconds) || 0
  );

  const amount = Math.max(
    0,
    parseInt(count, 10) || 0
  );

  return calculateSuggestedPrice(
    average * amount,
    rate
  );
}

/**
 * Converts source-video seconds into estimated work seconds
 * using an internal ratio.
 */
function estimateWorkSeconds(
  sourceSeconds,
  ratio
) {
  return (
    Math.max(
      0,
      parseFloat(sourceSeconds) || 0
    ) *
    Math.max(
      0,
      parseFloat(ratio) || 0
    )
  );
}

/**
 * Suggested client-facing price per source minute,
 * inferred from internal productivity.
 */
function calculatePricePerSourceMinute(
  ratio,
  targetHourlyRate
) {
  const safeRatio = Math.max(
    0,
    parseFloat(ratio) || 0
  );

  const safeRate = Math.max(
    0,
    parseFloat(targetHourlyRate) || 0
  );

  return (
    safeRatio / 60
  ) * safeRate;
}

/**
 * Summarizes the commercial and operational health of a client/month.
 *
 * Expected video fields:
 * - feito
 * - cobrado
 * - tipo_item
 * - tempo: source-video duration in seconds
 * - tempo_fazer: effective work time in seconds
 * - chars
 * - palavras
 * - idiomas
 *
 * Options:
 * - contractedVideos
 * - contractedMinutes
 * - currentRevenue
 * - targetHourlyRate
 * - overagePricePerMinute
 * - includeCourtesy
 */
function getPricingHealth(
  videos,
  config,
  options
) {
  videos = Array.isArray(videos)
    ? videos
    : [];

  config = config || {};
  options = options || {};

  const contractedVideos = Math.max(
    0,
    parseInt(
      options.contractedVideos ??
        config.base_videos ??
        15,
      10
    ) || 0
  );

  const contractedMinutes = Math.max(
    0,
    parseFloat(
      options.contractedMinutes ??
        config.base_minutes ??
        contractedVideos * 15
    ) || 0
  );

  const targetHourlyRate = Math.max(
    0,
    parseFloat(
      options.targetHourlyRate ??
        config.target_hourly_rate ??
        50
    ) || 0
  );

  const includeCourtesy =
    options.includeCourtesy !== false;

  const normalDone = videos.filter(v => {
    if (
      !v ||
      !v.feito ||
      v.tipo_item === 'outros'
    ) {
      return false;
    }

    if (
      !includeCourtesy &&
      v.cobrado === false
    ) {
      return false;
    }

    return true;
  });

  const chargedNormal = normalDone.filter(
    v => v.cobrado !== false
  );

  const completedWithEffort =
    normalDone.filter(
      v =>
        (parseFloat(v.tempo) || 0) > 0 &&
        (
          parseFloat(v.tempo_fazer) ||
          0
        ) > 0
    );

  const sourceSeconds =
    normalDone.reduce(
      (sum, v) =>
        sum +
        (
          parseFloat(v.tempo) ||
          0
        ),
      0
    );

  const workSeconds =
    normalDone.reduce(
      (sum, v) =>
        sum +
        (
          parseFloat(v.tempo_fazer) ||
          0
        ),
      0
    );

  const ratioSourceSeconds =
    completedWithEffort.reduce(
      (sum, v) =>
        sum +
        (
          parseFloat(v.tempo) ||
          0
        ),
      0
    );

  const ratioWorkSeconds =
    completedWithEffort.reduce(
      (sum, v) =>
        sum +
        (
          parseFloat(v.tempo_fazer) ||
          0
        ),
      0
    );

  const ratio =
    ratioSourceSeconds > 0
      ? ratioWorkSeconds /
        ratioSourceSeconds
      : 0;

  const sourceMinutes =
    sourceSeconds / 60;

  const workHours =
    workSeconds / 3600;

  const overageMinutes = Math.max(
    0,
    sourceMinutes - contractedMinutes
  );

  const utilization =
    contractedMinutes > 0
      ? sourceMinutes /
        contractedMinutes
      : 0;

  const extrasRevenue = videos
    .filter(
      v =>
        v &&
        v.feito &&
        v.cobrado !== false &&
        v.tipo_item === 'outros'
    )
    .reduce(
      (sum, v) =>
        sum +
        (
          parseFloat(
            v.valor_individual
          ) || 0
        ),
      0
    );

  const configuredRevenue =
    parseFloat(
      options.currentRevenue ??
        config.base_payment ??
        0
    ) || 0;

  const currentRevenue =
    configuredRevenue +
    extrasRevenue;

  const currentHourlyRate =
    workHours > 0
      ? currentRevenue /
        workHours
      : 0;

  const inferredPricePerMinute =
    calculatePricePerSourceMinute(
      ratio,
      targetHourlyRate
    );

  const overagePricePerMinute =
    Math.max(
      0,
      parseFloat(
        options.overagePricePerMinute ??
          config.overage_price_per_minute ??
          inferredPricePerMinute
      ) || 0
    );

  const suggestedBasePrice =
    calculateSuggestedPrice(
      workSeconds,
      targetHourlyRate
    );

  const suggestedPackagePrice =
    contractedMinutes *
    inferredPricePerMinute;

  const suggestedOverageCharge =
    overageMinutes *
    overagePricePerMinute;

  const revenueGap =
    suggestedBasePrice -
    currentRevenue;

  const adjustmentPercent =
    currentRevenue > 0
      ? (
          revenueGap /
          currentRevenue
        ) * 100
      : 0;

  let status = 'sem_dados';

  if (workHours > 0) {
    if (
      currentHourlyRate >=
      targetHourlyRate
    ) {
      status = 'saudavel';
    } else if (
      currentHourlyRate >=
      targetHourlyRate * 0.8
    ) {
      status = 'atencao';
    } else {
      status = 'critico';
    }
  }

  const completeness =
    normalDone.length > 0
      ? completedWithEffort.length /
        normalDone.length
      : 0;

  return {
    status,

    contractedVideos,
    contractedMinutes,

    completedVideos:
      normalDone.length,

    chargedVideos:
      chargedNormal.length,

    sourceSeconds,
    sourceMinutes,

    workSeconds,
    workHours,

    ratio,
    utilization,
    overageMinutes,

    currentRevenue,
    extrasRevenue,
    currentHourlyRate,

    targetHourlyRate,

    inferredPricePerMinute,
    overagePricePerMinute,

    suggestedBasePrice,
    suggestedPackagePrice,
    suggestedOverageCharge,

    revenueGap,
    adjustmentPercent,

    dataCompleteness:
      completeness,

    missingEffortCount:
      Math.max(
        0,
        normalDone.length -
          completedWithEffort.length
      ),

    totals: {
      chars: normalDone.reduce(
        (sum, v) =>
          sum +
          (
            parseInt(
              v.chars,
              10
            ) || 0
          ),
        0
      ),

      words: normalDone.reduce(
        (sum, v) =>
          sum +
          (
            parseInt(
              v.palavras,
              10
            ) || 0
          ),
        0
      )
    }
  };
}

/**
 * Builds a client-facing usage summary
 * without exposing internal ratio/work-time data.
 */
function getClientUsageSummary(
  videos,
  config,
  options
) {
  const health =
    getPricingHealth(
      videos,
      config,
      options
    );

  return {
    contractedMinutes:
      health.contractedMinutes,

    deliveredMinutes:
      health.sourceMinutes,

    utilizationPercent:
      health.utilization * 100,

    overageMinutes:
      health.overageMinutes,

    completedVideos:
      health.completedVideos,

    chargedVideos:
      health.chargedVideos,

    overagePricePerMinute:
      health.overagePricePerMinute,

    estimatedOverageCharge:
      health.suggestedOverageCharge
  };
}

/**
 * Projects future workload and price
 * using a historical internal ratio.
 */
function projectPackagePricing(
  sourceMinutes,
  ratio,
  targetHourlyRate,
  count
) {
  const minutes = Math.max(
    0,
    parseFloat(sourceMinutes) || 0
  );

  const safeCount = Math.max(
    1,
    parseInt(count, 10) || 1
  );

  const sourceSeconds =
    minutes * 60;

  const workSeconds =
    estimateWorkSeconds(
      sourceSeconds,
      ratio
    );

  const totalPrice =
    calculateSuggestedPrice(
      workSeconds,
      targetHourlyRate
    );

  return {
    sourceMinutes: minutes,
    sourceSeconds,

    estimatedWorkSeconds:
      workSeconds,

    estimatedWorkHours:
      workSeconds / 3600,

    targetHourlyRate:
      Math.max(
        0,
        parseFloat(
          targetHourlyRate
        ) || 0
      ),

    pricePerSourceMinute:
      calculatePricePerSourceMinute(
        ratio,
        targetHourlyRate
      ),

    totalPrice,

    averagePricePerItem:
      totalPrice / safeCount,

    count:
      safeCount
  };
}

/**
 * Aggregates health by monthId.
 * Useful for a "Saúde do Cliente" dashboard.
 */
function getPricingHealthByMonth(
  videos,
  configs,
  options
) {
  videos = Array.isArray(videos)
    ? videos
    : [];

  configs = Array.isArray(configs)
    ? configs
    : [];

  options = options || {};

  const ids = Array.from(
    new Set(
      videos
        .map(v => v && v.monthId)
        .filter(Boolean)
    )
  );

  return ids
    .map(monthId => {
      const config =
        configs.find(
          c => c.id === monthId
        ) || {};

      const monthVideos =
        videos.filter(
          v =>
            v &&
            v.monthId === monthId
        );

      const health =
        getPricingHealth(
          monthVideos,
          config,
          options
        );

      const firstVideo =
        monthVideos.find(
          v => v && v.label
        );

      return {
        monthId,

        label:
          firstVideo?.label ||
          config.label ||
          String(monthId),

        clientId:
          config.clientId,

        ...health
      };
    })
    .sort(
      (a, b) =>
        monthLabelToSortKey(a.label) -
        monthLabelToSortKey(b.label)
    );
}

function getBenchmarks(videos) {
  return videos
    .filter(
      v =>
        v.isTest &&
        v.feito
    )
    .sort(
      (a, b) =>
        b.id - a.id
    );
}

function parseDurationSec(val) {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  if (typeof val === 'string') {
    val = val.trim();
    if (val.includes(':')) {
      var parts = val.split(':').map(Number);
      if (parts.some(isNaN)) return 0;
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      if (parts.length === 2) return parts[0] * 60 + parts[1];
    }
    var num = parseFloat(val);
    return isNaN(num) ? 0 : num;
  }
  return 0;
}

/**
 * Calculates minute analytics, surplus minutes, video equivalence, and effort growth (Proof by A + B).
 * Supports specific month target analysis and custom monthly minute thresholds.
 */
function getMinuteAnalytics(videos, configs, targetMinPerVid, targetBaseVideos, targetMonthlyMinInput, selectedMonthId) {
  videos = Array.isArray(videos) ? videos : [];
  configs = Array.isArray(configs) ? configs : [];
  targetMinPerVid = parseFloat(targetMinPerVid) || 15;
  targetBaseVideos = parseFloat(targetBaseVideos) || 15;

  const targetMonthlyMin = parseFloat(targetMonthlyMinInput) > 0
    ? parseFloat(targetMonthlyMinInput)
    : (targetMinPerVid * targetBaseVideos);

  const doneVideos = videos.filter(
    v => v && v.feito && v.tipo_item !== 'outros' && parseDurationSec(v.tempo) > 0
  );

  if (doneVideos.length === 0) {
    return {
      hasData: false,
      targetMinPerVid,
      targetBaseVideos,
      targetMonthlyMin,
      overallAvgVideoMin: 0,
      recentAvgVideoMin: 0,
      recentAvgMonthlyMin: 0,
      recentAvgWorkHours: 0,
      baselineExpectedWorkHours: 0,
      durationIncreasePct: 0,
      volumeIncreasePct: 0,
      effortIncreasePct: 0,
      surplusMin: 0,
      equivalentVideos: 0,
      monthlyBreakdown: [],
      selectedMonthLabel: null
    };
  }

  const monthMap = {};
  doneVideos.forEach(v => {
    const label = (v.label || 'Sem Mês').trim();
    if (!monthMap[label]) {
      monthMap[label] = {
        label,
        monthId: v.monthId,
        count: 0,
        videoSec: 0,
        workSec: 0,
        sortKey: monthLabelToSortKey(label)
      };
    }
    monthMap[label].count++;
    monthMap[label].videoSec += parseDurationSec(v.tempo);
    monthMap[label].workSec += parseDurationSec(v.tempo_fazer);
  });

  const monthlyList = Object.values(monthMap).sort((a, b) => a.sortKey - b.sortKey);

  monthlyList.forEach(m => {
    m.videoMin = m.videoSec / 60;
    m.avgVideoMin = m.count > 0 ? m.videoMin / m.count : 0;
    m.workHours = m.workSec / 3600;
    m.surplusMin = Math.max(0, m.videoMin - targetMonthlyMin);
    m.equivalentVideos = targetMinPerVid > 0 ? m.videoMin / targetMinPerVid : 0;
    m.durationOverPct = targetMinPerVid > 0 ? ((m.avgVideoMin - targetMinPerVid) / targetMinPerVid) * 100 : 0;
  });

  const totalVideoSec = doneVideos.reduce((s, v) => s + parseDurationSec(v.tempo), 0);
  const totalWorkSec = doneVideos.reduce((s, v) => s + parseDurationSec(v.tempo_fazer), 0);
  const totalVideoMin = totalVideoSec / 60;
  const overallAvgVideoMin = doneVideos.length > 0 ? totalVideoMin / doneVideos.length : 0;
  const globalRatio = totalVideoSec > 0 ? totalWorkSec / totalVideoSec : 6.2;
  const baselineExpectedWorkHours = (targetMonthlyMin * 60 * globalRatio) / 3600;

  let activeVideoMin = 0;
  let activeMonthlyMin = 0;
  let activeWorkHours = 0;
  let selectedMonthLabel = null;

  if (selectedMonthId) {
    const targetMonthObj = monthlyList.find(m => m.monthId === selectedMonthId);
    if (targetMonthObj) {
      activeVideoMin = targetMonthObj.avgVideoMin;
      activeMonthlyMin = targetMonthObj.videoMin;
      activeWorkHours = targetMonthObj.workHours;
      selectedMonthLabel = targetMonthObj.label;
    } else {
      const monthVideos = doneVideos.filter(v => v.monthId === selectedMonthId);
      const mVidSec = monthVideos.reduce((s, v) => s + parseDurationSec(v.tempo), 0);
      const mWorkSec = monthVideos.reduce((s, v) => s + parseDurationSec(v.tempo_fazer), 0);
      activeMonthlyMin = mVidSec / 60;
      activeVideoMin = monthVideos.length > 0 ? activeMonthlyMin / monthVideos.length : 0;
      activeWorkHours = mWorkSec / 3600;
    }
  } else {
    const recentMonths = monthlyList.slice(-3);
    activeVideoMin = recentMonths.length > 0
      ? (recentMonths.reduce((s, m) => s + m.videoMin, 0) / recentMonths.reduce((s, m) => s + m.count, 0))
      : overallAvgVideoMin;

    activeMonthlyMin = recentMonths.length > 0
      ? (recentMonths.reduce((s, m) => s + m.videoMin, 0) / recentMonths.length)
      : (monthlyList.length > 0 ? totalVideoMin / monthlyList.length : targetMonthlyMin);

    activeWorkHours = recentMonths.length > 0
      ? (recentMonths.reduce((s, m) => s + m.workHours, 0) / recentMonths.length)
      : (totalWorkSec / 3600 / (monthlyList.length || 1));
  }

  const durationIncreasePct = targetMinPerVid > 0 ? ((activeVideoMin - targetMinPerVid) / targetMinPerVid) * 100 : 0;
  const volumeIncreasePct = targetMonthlyMin > 0 ? ((activeMonthlyMin - targetMonthlyMin) / targetMonthlyMin) * 100 : 0;
  const effortIncreasePct = baselineExpectedWorkHours > 0 ? ((activeWorkHours - baselineExpectedWorkHours) / baselineExpectedWorkHours) * 100 : 0;

  const equivalentVideos = targetMinPerVid > 0 ? activeMonthlyMin / targetMinPerVid : 0;
  const surplusMin = Math.max(0, activeMonthlyMin - targetMonthlyMin);

  return {
    hasData: true,
    targetMinPerVid,
    targetBaseVideos,
    targetMonthlyMin,
    overallAvgVideoMin,
    recentAvgVideoMin: activeVideoMin,
    recentAvgMonthlyMin: activeMonthlyMin,
    recentAvgWorkHours: activeWorkHours,
    baselineExpectedWorkHours,
    durationIncreasePct,
    volumeIncreasePct,
    effortIncreasePct,
    surplusMin,
    equivalentVideos,
    monthlyBreakdown: monthlyList,
    totalVideosCount: doneVideos.length,
    selectedMonthLabel
  };
}

/**
 * Renders the Minute Impact Card & Proof by A + B in the client dashboard.
 */
function renderMinuteImpactSection(containerId, minuteData) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!minuteData || !minuteData.hasData) {
    container.innerHTML = '';
    return;
  }

  const {
    targetMinPerVid,
    targetBaseVideos,
    targetMonthlyMin,
    recentAvgVideoMin,
    recentAvgMonthlyMin,
    durationIncreasePct,
    volumeIncreasePct,
    effortIncreasePct,
    surplusMin,
    equivalentVideos,
    recentAvgWorkHours,
    baselineExpectedWorkHours,
    selectedMonthLabel
  } = minuteData;

  const isOver = durationIncreasePct > 0 || volumeIncreasePct > 0;
  const badgeColor = isOver ? '#ef4444' : '#10b981';
  const badgeBg = isOver ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)';
  const icon = isOver ? '⚠️' : '✅';

  const durationDiff = recentAvgVideoMin - targetMinPerVid;
  const extraWorkHours = Math.max(0, recentAvgWorkHours - baselineExpectedWorkHours);
  const periodLabel = selectedMonthLabel ? `Mês de ${selectedMonthLabel}` : 'Média Recente';

  window._currentMinuteData = minuteData;

  let html = `
    <div class="card minute-impact-card" style="padding:22px; margin-top:20px; border:1px solid ${isOver ? 'rgba(239,68,68,0.3)' : 'var(--border)'}; background: radial-gradient(circle at top right, rgba(139, 92, 246, 0.08), transparent 70%), var(--panel)">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:15px; margin-bottom:18px">
        <div>
          <div style="display:flex; align-items:center; gap:8px">
            <span style="font-size:18px">⏱️</span>
            <h2 style="font-size:16px; margin:0; color:#fff">Demonstrativo Comercial de Minutos & Impacto de Carga (A + B) ${selectedMonthLabel ? '• ' + selectedMonthLabel : ''}</h2>
          </div>
          <p style="font-size:11px; color:var(--text-dim); margin:4px 0 0 26px">
            Análise do volume entregue (${periodLabel}) vs. Franquia Combinada (${targetMonthlyMin} min/mês • ${targetBaseVideos} vids de ${targetMinPerVid} min)
          </p>
        </div>
        <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap">
          <span style="background:${badgeBg}; color:${badgeColor}; border:1px solid ${badgeColor}; padding:6px 12px; border-radius:20px; font-size:11px; font-weight:700">
            ${icon} ${isOver ? '+' + (durationIncreasePct > 0 ? durationIncreasePct.toFixed(1) + '% na Duração' : volumeIncreasePct.toFixed(1) + '% no Volume') : 'Dentro da Franquia'}
          </span>
          <button onclick="exportDossierPDF()" class="btn-accent" style="background:#8b5cf6; border-color:#8b5cf6; padding:6px 14px; font-size:11px">
            📄 Exportar Dossiê por A + B (PDF)
          </button>
        </div>
      </div>

      <div class="stats-grid" style="grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap:12px; margin-bottom:20px">
        <div class="card" style="background:rgba(255,255,255,0.02); padding:12px 16px">
          <small style="color:var(--text-dim); font-size:10px; text-transform:uppercase">Duração Média (${selectedMonthLabel || 'Recente'})</small>
          <div style="font-size:20px; font-weight:800; color:${durationIncreasePct > 0 ? '#ef4444' : '#fff'}; margin-top:2px">
            ${recentAvgVideoMin.toFixed(1)} min
            <span style="font-size:11px; font-weight:normal; color:var(--text-dim)">/ meta ${targetMinPerVid}m</span>
          </div>
          <div style="font-size:10px; color:${durationIncreasePct > 0 ? '#ef4444' : '#10b981'}; margin-top:2px">
            ${durationIncreasePct > 0 ? '▲ +' + durationDiff.toFixed(1) + ' min/vídeo (+' + durationIncreasePct.toFixed(1) + '%)' : '✓ Dentro da meta'}
          </div>
        </div>

        <div class="card" style="background:rgba(255,255,255,0.02); padding:12px 16px">
          <small style="color:var(--text-dim); font-size:10px; text-transform:uppercase">Volume de Minutos (${selectedMonthLabel || 'Mês'})</small>
          <div style="font-size:20px; font-weight:800; color:${volumeIncreasePct > 0 ? '#ef4444' : '#fff'}; margin-top:2px">
            ${recentAvgMonthlyMin.toFixed(0)} min
            <span style="font-size:11px; font-weight:normal; color:var(--text-dim)">/ meta ${targetMonthlyMin}m</span>
          </div>
          <div style="font-size:10px; color:${volumeIncreasePct > 0 ? '#ef4444' : '#10b981'}; margin-top:2px">
            ${volumeIncreasePct > 0 ? '▲ +' + surplusMin.toFixed(0) + ' min excedentes (+' + volumeIncreasePct.toFixed(1) + '%)' : '✓ Dentro da franquia'}
          </div>
        </div>

        <div class="card" style="background:rgba(255,255,255,0.02); padding:12px 16px">
          <small style="color:var(--text-dim); font-size:10px; text-transform:uppercase">Vídeos Equivalentes</small>
          <div style="font-size:20px; font-weight:800; color:var(--accent); margin-top:2px">
            ${equivalentVideos.toFixed(1)} vídeos
          </div>
          <div style="font-size:10px; color:var(--text-dim); margin-top:2px">
            Equivale a ${equivalentVideos.toFixed(1)} vids de ${targetMinPerVid} min (contrato: ${targetBaseVideos})
          </div>
        </div>

        <div class="card" style="background:rgba(255,255,255,0.02); padding:12px 16px">
          <small style="color:var(--text-dim); font-size:10px; text-transform:uppercase">Carga de Trabalho (Esforço)</small>
          <div style="font-size:20px; font-weight:800; color:${effortIncreasePct > 0 ? '#ef4444' : '#10b981'}; margin-top:2px">
            ${recentAvgWorkHours.toFixed(1)} h
          </div>
          <div style="font-size:10px; color:${effortIncreasePct > 0 ? '#ef4444' : '#10b981'}; margin-top:2px">
            ${effortIncreasePct > 0 ? '▲ +' + extraWorkHours.toFixed(1) + 'h extras de produção (+' + effortIncreasePct.toFixed(1) + '%)' : '✓ Dentro do previsto'}
          </div>
        </div>
      </div>

      <div style="background:rgba(139, 92, 246, 0.08); border:1px solid rgba(139, 92, 246, 0.2); border-radius:10px; padding:15px">
        <h4 style="margin:0 0 8px 0; font-size:12px; color:#c4b5fd; text-transform:uppercase; letter-spacing:0.05em">📌 Comprovação Comercial por A + B (Para Negociação):</h4>
        <div style="font-size:12px; color:var(--text); line-height:1.6">
          1. <b>Premissa Comercial (A):</b> O pacote contratado estabelece a franquia mensal de <b>${targetMonthlyMin} minutos</b> (${targetBaseVideos} vídeos com meta de ${targetMinPerVid} min/vídeo).<br>
          2. <b>Realidade Produzida (B):</b> ${selectedMonthLabel ? `Em <b>${selectedMonthLabel}</b>` : 'Nos últimos meses'}, a duração média por vídeo atingiu <b>${recentAvgVideoMin.toFixed(1)} min/vídeo</b> (${durationIncreasePct > 0 ? '+' + durationIncreasePct.toFixed(1) + '%' : 'estável'}). O volume mensal entregue foi de <b>${recentAvgMonthlyMin.toFixed(0)} minutos</b>.<br>
          3. <b>Equivalência Efetiva:</b> O tempo de vídeo entregue equivale a <b>${equivalentVideos.toFixed(1)} vídeos</b> no padrão combinado de ${targetMinPerVid} min (${volumeIncreasePct > 0 ? 'um acréscimo equivalente a +' + (equivalentVideos - targetBaseVideos).toFixed(1) + ' vídeos extras' : 'dentro da franquia'}).<br>
          4. <b>Impacto em Esforço:</b> Seu tempo de trabalho líquido dedicado à produção foi de <b>${recentAvgWorkHours.toFixed(1)}h</b> (${extraWorkHours > 0 ? '+' + extraWorkHours.toFixed(1) + ' horas extras de dublagem' : 'sem variação'}).
        </div>
      </div>
    </div>
  `;

  container.innerHTML = html;
}

/**
 * Exports a PDF specifically designed as proof of increased video minutes & effort (Proof by A + B).
 */
function exportMinuteImpactPDF(client, videos, minuteData) {
  try {
    if (!client || !minuteData) {
      alert("Erro: Dados do cliente ou de minutos não disponíveis.");
      return;
    }

    var jsPDFClass = (window.jspdf && window.jspdf.jsPDF) ? window.jspdf.jsPDF : (window.jsPDF || window.jspdf);
    if (!jsPDFClass) {
      alert("Erro: Biblioteca jsPDF não foi carregada corretamente.");
      return;
    }

    const doc = new jsPDFClass({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();

    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, W, H, 'F');

    doc.setFillColor(30, 41, 59);
    doc.rect(0, 0, W, 45, 'F');

    doc.setTextColor(245, 158, 11);
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text(toSafePDF('DubAnalytics - Relatorio de Impacto Comercial'), 15, 18);

    doc.setTextColor(148, 163, 184);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(toSafePDF('DEMONSTRATIVO DE EVOLUCAO DE MINUTOS E CARGA DE TRABALHO (PROVA POR A + B)'), 15, 24);

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text(toSafePDF('CLIENTE: ' + (client.name || '').toUpperCase() + (minuteData.selectedMonthLabel ? ' - ' + minuteData.selectedMonthLabel.toUpperCase() : '')), 15, 36);

    let y = 55;
    doc.setFillColor(30, 41, 59);
    doc.roundedRect(15, y, W - 30, 38, 3, 3, 'F');

    doc.setTextColor(245, 158, 11);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(toSafePDF('1. RESUMO DA FRANQUIA COMBINADA VS REALIZADO'), 20, y + 10);

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9.5);
    doc.setFont('helvetica', 'normal');
    doc.text(toSafePDF(`- Franquia Base: ${minuteData.targetMonthlyMin} minutos/mes (${minuteData.targetBaseVideos} vids de ${minuteData.targetMinPerVid} min)`), 20, y + 18);
    doc.text(toSafePDF(`- Duracao Media Entregue: ${minuteData.recentAvgVideoMin.toFixed(1)} min/video (${minuteData.durationIncreasePct > 0 ? '+' + minuteData.durationIncreasePct.toFixed(1) + '% por video' : 'dentro da meta'})`), 20, y + 25);
    doc.text(toSafePDF(`- Volume Mensal de Video: ${minuteData.recentAvgMonthlyMin.toFixed(0)} minutos (+${minuteData.surplusMin.toFixed(0)} min excedentes)`), 20, y + 32);

    y += 45;
    doc.setFillColor(30, 41, 59);
    doc.roundedRect(15, y, W - 30, 55, 3, 3, 'F');

    doc.setTextColor(245, 158, 11);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(toSafePDF('2. COMPROVACAO DE ESFORCO E EQUIVALENCIA (A + B)'), 20, y + 10);

    doc.setTextColor(226, 232, 240);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');

    const extraVids = (minuteData.equivalentVideos - minuteData.targetBaseVideos).toFixed(1);
    const textLines = [
      `* Equivalencia de Conteudo: O volume total de ${minuteData.recentAvgMonthlyMin.toFixed(0)} minutos entregues equivale`,
      `  a ${minuteData.equivalentVideos.toFixed(1)} videos no padrao combinado de ${minuteData.targetMinPerVid} min (acrescimo de +${extraVids} videos/mes).`,
      ``,
      `* Esforco de Dublagem & Producao: Para manter a qualidade do audio no tempo estendido,`,
      `  o tempo de trabalho liquido dedicado subiu de ~${minuteData.baselineExpectedWorkHours.toFixed(1)}h para ${minuteData.recentAvgWorkHours.toFixed(1)}h/mes.`,
      ``,
      `* Variacao da Carga Efetiva: +${minuteData.effortIncreasePct.toFixed(1)}% de esforco operacional adicional em relacao ao combinado.`
    ];

    let lineY = y + 18;
    textLines.forEach(line => {
      doc.text(toSafePDF(line), 20, lineY);
      lineY += 5;
    });

    y += 63;
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(toSafePDF('3. HISTORICO MENSAL DE DURACAO DE VIDEO'), 15, y);

    y += 5;
    const tableBody = (minuteData.monthlyBreakdown || []).map(m => [
      toSafePDF(m.label),
      m.count + ' vids',
      m.avgVideoMin.toFixed(1) + ' min',
      m.videoMin.toFixed(0) + ' min',
      m.equivalentVideos.toFixed(1) + ' vids',
      m.workHours.toFixed(1) + ' hrs'
    ]);

    if (doc.autoTable) {
      doc.autoTable({
        startY: y,
        head: [['Mes', 'Videos', 'Duracao Media', 'Total Minutos', 'Videos Equiv.', 'Horas Esforco']],
        body: tableBody,
        styles: { fillColor: [15, 23, 42], textColor: [226, 232, 240], fontSize: 9 },
        headStyles: { fillColor: [30, 41, 59], textColor: [245, 158, 11], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [21, 28, 41] },
        margin: { left: 15, right: 15 }
      });
    }

    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(toSafePDF(`DubAnalytics - Gerado em ${new Date().toLocaleDateString('pt-BR')} - Pagina ${i} de ${pageCount}`), 15, H - 10);
    }

    doc.save(`Relatorio_Impacto_Minutos_${(client.name || 'Cliente').replace(/\s+/g, '_')}.pdf`);
  } catch (err) {
    console.error('Erro ao gerar PDF de minutos:', err);
    alert('Erro ao gerar PDF: ' + err.message);
  }
}

window.Analytics = {
  groupData,
  renderCharts,
  renderAdvancedCharts,
  getAdvancedMetrics,

  exportUnifiedPDF,
  exportMonthlyReportPDF,

  monthLabelToSortKey,
  detectTopic,

  calculateSuggestedPrice,
  calculatePackagePrice,

  estimateWorkSeconds,
  calculatePricePerSourceMinute,

  getPricingHealth,
  getClientUsageSummary,
  projectPackagePricing,
  getPricingHealthByMonth,

  getBenchmarks,

  getMinuteAnalytics,
  renderMinuteImpactSection,
  exportMinuteImpactPDF
};