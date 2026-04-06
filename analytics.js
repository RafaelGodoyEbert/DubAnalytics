/* analytics.js - Standalone Analytics Engine */

const MONTH_NAMES = 'Jan Fev Mar Abr Mai Jun Jul Ago Set Out Nov Dez'.split(' ');

/**
 * Parses a month label like "Jan 2024" into a sortable number (202400).
 */
function monthLabelToSortKey(label) {
  const parts = (label || '').split(' ');
  const monthName = parts[0];
  const year = parseInt(parts[1]) || 0;
  const monthIdx = MONTH_NAMES.indexOf(monthName);
  
  // If either part is missing or invalid, return a "junk" key
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

    // Guard: Only process valid month/year labels if we're in monthly view
    // This removes "residues" like "Silva e Larie" that don't fit the data model
    if (timeframe === 'month' && (monthIdx === -1 || isNaN(year) || year === 0)) {
      return; 
    }
    
    if (timeframe === 'year') {
      key = String(year);
      if (isNaN(year) || year === 0) return; // Skip invalid years
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

    // Sort key
    if (timeframe === 'year') { g._sortKey = year; } 
    else if (timeframe === 'quarter') { g._sortKey = year * 10 + (monthIdx >= 0 ? Math.floor(monthIdx / 3) + 1 : 0); }
    else if (timeframe === 'semester') { g._sortKey = year * 10 + (monthIdx >= 0 && monthIdx < 6 ? 1 : 2); }
    else { g._sortKey = monthLabelToSortKey(label); }

    if (v.feito) {
      g.count++;
      g.chars += (parseInt(v.chars) || 0);
      g.words += (parseInt(v.palavras) || 0);
      
      // Only count for Ratio if we actually have effort data
      if (parseFloat(v.tempo_fazer) > 0) {
        g.time += parseFloat(v.tempo_fazer);
        g.vTime += parseFloat(v.tempo) || 0;
      }
    }
  });

  // Post-process groups
  const finalGroups = Object.values(groups).filter(g => g._sortKey < 999999);
  
  // Sort chronologically for correct cumulative balance if timeframe is month
  if (timeframe === 'month') {
    finalGroups.sort((a, b) => a._sortKey - b._sortKey);
  }

  const clientBalances = {}; // Track cumulative extra pay per client

  finalGroups.forEach(g => {
    let groupEarnings = 0;
    
    // Sort monthIds to ensure consistent processing within a group (e.g. multiple clients)
    const mIds = Array.from(g._monthIds).sort();

    mIds.forEach(mId => {
      const config = (configs || []).find(c => c.id === mId);
      const mVideos = videos.filter(v => v.monthId === mId);
      const mVideosDone = mVideos.filter(v => v.feito).length;
      
      if (mVideos.length === 0) return;

      if (config) {
        const cid = config.clientId;
        if (!clientBalances[cid]) clientBalances[cid] = { done: 0, base: 0, extraPaid: 0 };
        const bal = clientBalances[cid];

        var ppv = parseFloat(config.price_per_video); if (isNaN(ppv)) ppv = 40;
        var base = parseFloat(config.base_payment); if (isNaN(base)) base = 500;
        var baseVideos = parseFloat(config.base_videos); if (isNaN(baseVideos)) baseVideos = 15;
        var bonus = parseFloat(config.bonus); if (isNaN(bonus)) bonus = 0;

        if (config.compensate) {
          bal.done += mVideosDone;
          bal.base += baseVideos;

          const cumOverage = Math.max(0, bal.done - bal.base);
          const extraToPayThisMonth = Math.max(0, cumOverage - bal.extraPaid);
          
          groupEarnings += base + (extraToPayThisMonth * ppv) + bonus;
          bal.extraPaid += extraToPayThisMonth;
        } else {
          // Simple Independent Logic
          const extraToPayThisMonth = Math.max(0, mVideosDone - baseVideos);
          groupEarnings += base + (extraToPayThisMonth * ppv) + bonus;
          // We don't update 'bal' because this month doesn't participate in future compensations
        }
      } else {
        groupEarnings += mVideosDone * 40;
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
  if (t.includes('RED DEAD') || t.includes('RDR') || t.includes('ARTHUR')) return 'RDR';
  if (t.includes('ENTREVISTA') || t.includes('INTERVIEW')) return 'ENTREVISTA';
  if (t.includes('REACT')) return 'REACT';
  return 'OUTROS';
}

/**
 * Calculates advanced metrics for a set of videos.
 */
function getAdvancedMetrics(videos) {
  const done = videos.filter(v => v.feito && v.tempo > 0 && v.tempo_fazer > 0);
  if (done.length === 0) return null;

  const totalV = done.reduce((s, v) => s + v.tempo, 0);
  const totalW = done.reduce((s, v) => s + v.tempo_fazer, 0);
  const totalChars = done.reduce((s, v) => s + (parseInt(v.chars) || 0), 0);

  const topics = {};
  const langs = {};

  done.forEach(v => {
    const t = detectTopic(v.titulo);
    if (!topics[t]) topics[t] = { time: 0, vTime: 0, count: 0 };
    topics[t].time += v.tempo_fazer;
    topics[t].vTime += v.tempo;
    topics[t].count++;

    const l = v.idiomas || 1;
    if (!langs[l]) langs[l] = { time: 0, vTime: 0, count: 0 };
    langs[l].time += v.tempo_fazer;
    langs[l].vTime += v.tempo;
    langs[l].count++;
  });

  return {
    globalRatio: totalW / totalV,
    charsPerHour: totalW > 0 ? (totalChars / (totalW / 3600)) : 0,
    topics: Object.keys(topics).map(k => ({
      label: k,
      ratio: topics[k].time / topics[k].vTime,
      count: topics[k].count
    })),
    scaling: Object.keys(langs).map(k => ({
      label: k + ' Idiomas',
      ratio: langs[k].time / langs[k].vTime,
      count: langs[k].count
    })).sort((a,b) => parseInt(a.label) - parseInt(b.label))
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
        <h3 style="font-size:12px; color:var(--text-dim); margin-bottom:15px; text-transform:uppercase; letter-spacing:0.05em">Esforço por Tema (Ratio)</h3>
        <div class="chart-container" style="height:220px"><canvas id="${idTopics}"></canvas></div>
      </div>
      <div class="card" style="min-height:300px">
        <h3 style="font-size:12px; color:var(--text-dim); margin-bottom:15px; text-transform:uppercase; letter-spacing:0.05em">Custo de Escala (Idiomas)</h3>
        <div class="chart-container" style="height:220px"><canvas id="${idScaling}"></canvas></div>
      </div>
    </div>
  `;

  renderSimpleBar(idTopics, metrics.topics, 'Ratio', '#10b981');
  renderSimpleBar(idScaling, metrics.scaling, 'Ratio', '#6366f1');
}

function renderSimpleBar(id, data, label, color) {
  const ctx = document.getElementById(id).getContext('2d');
  
  // Cleanup
  const chartKey = '_chart_' + id;
  if (window[chartKey]) window[chartKey].destroy();

  window[chartKey] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.map(d => d.label),
      datasets: [{
        label: label,
        data: data.map(d => d.ratio.toFixed(2)),
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
      plugins: { legend: { display: false } },
      scales: {
        x: { 
          beginAtZero: true,
          ticks: { color: '#94a3b8' }, 
          grid: { color: 'rgba(255,255,255,0.05)' } 
        },
        y: { 
          ticks: { color: '#94a3b8' }, 
          grid: { display: false } 
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
  if (window[existingKey]) { window[existingKey].destroy(); }

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
          data: dataset.map(d => d.ratio.toFixed(2)),
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
        legend: { labels: { color: '#e2e8f0', boxWidth: 12, font: { size: 11 } } } 
      },
      scales: {
        x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { 
          ticks: { color: '#94a3b8' }, 
          grid: { color: 'rgba(255,255,255,0.05)' },
          title: { display: true, text: 'Ganhos (R$)', color: '#94a3b8', font: { size: 10 } }
        },
        y1: { 
          position: 'right', 
          min: 0, 
          suggestedMax: 15,
          ticks: { color: '#10b981', font: { bold: true } }, 
          grid: { drawOnChartArea: false },
          title: { display: true, text: 'Ratio de Esforço', color: '#10b981', font: { size: 10 } }
        }
      }
    }
  });
}

function exportUnifiedPDF(title, dataset, summary) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();

  // Override addPage to ensure dark background on all new pages
  const originalAddPage = doc.addPage;
  doc.addPage = function() {
    originalAddPage.apply(this, arguments);
    doc.setFillColor(10, 18, 30); 
    doc.rect(0, 0, W, H, 'F');
    return this;
  };

  // Background for first page
  doc.setFillColor(10, 18, 30); 
  doc.rect(0, 0, W, H, 'F');

  // Header Area
  doc.setFillColor(15, 23, 42); 
  doc.rect(0, 0, W, 50, 'F');
  
  // Brand Header
  doc.setTextColor(245, 158, 11);
  doc.setFontSize(22); doc.setFont('helvetica', 'bold');
  doc.text('DubAnalytics Report', 15, 20);
  
  doc.setTextColor(100, 116, 139);
  doc.setFontSize(8); doc.setFont('helvetica', 'normal');
  doc.text('BUSINESS & PERFORMANCE INTELLIGENCE', 15, 26);
  
  // Target/Client Detail
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14); doc.setFont('helvetica', 'bold');
  doc.text(title.toUpperCase(), 15, 38);
  
  doc.setTextColor(148, 163, 184);
  doc.setFontSize(10); doc.setFont('helvetica', 'normal');
  doc.text('Visão Consolidada de Performance', 15, 44);
  
  // KPI Section Marker
  doc.setTextColor(245, 158, 11);
  doc.setFontSize(8); doc.setFont('helvetica', 'bold');
  doc.text('PERFORMANCE SNAPSHOT', 15, 62);

  // KPI Cards
  const cardW = (W - 40) / 3;
  const cardY = 66;
  const cardH = 26;
  const cardGap = 5;

  const drawKPICard = (x, cardTitle, value, unit, color) => {
    doc.setFillColor(15, 23, 42); 
    doc.roundedRect(x, cardY, cardW, cardH, 3, 3, 'F');
    
    doc.setTextColor(148, 163, 184);
    doc.setFontSize(7); doc.setFont('helvetica', 'normal');
    doc.text(cardTitle.toUpperCase(), x + 6, cardY + 8);
    
    doc.setTextColor(color[0], color[1], color[2]);
    doc.setFontSize(13); doc.setFont('helvetica', 'bold');
    doc.text(value, x + 6, cardY + 18);
    
    if (unit) {
      const valW = doc.getTextWidth(value);
      doc.setFontSize(7); doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);
      doc.text(unit, x + 8 + valW, cardY + 18);
    }
  };

  let earnTxt = String(summary.earnings || 'R$ 0,00');
  let countTxt = String(summary.count || '0');
  let hoursTxt = String(summary.hours || '00:00:00').split('(')[0].trim();

  // Clean strings based on how they were passed in previous implementation
  earnTxt = earnTxt.replace('Ganhos: ', '');
  countTxt = countTxt.replace('Videos: ', '');
  hoursTxt = hoursTxt.replace('Horas: ', '');

  drawKPICard(15, 'Faturamento Total', earnTxt, '', [16, 185, 129]);
  drawKPICard(15 + cardW + cardGap, 'Vídeos Produzidos', countTxt, 'TOTAL', [255, 255, 255]);
  drawKPICard(15 + (cardW + cardGap) * 2, 'Esforço Acumulado', hoursTxt, '', [245, 158, 11]);

  // Listing Table
  doc.autoTable({
    startY: 102,
    head: [['PERÍODO', 'VÍDEOS', 'GANHOS (R$)', 'RATIO', 'CHARS', 'TEMPO']],
    body: dataset.map(d => [
      (d.label || '').toUpperCase(),
      d.count,
      d.earnings.toLocaleString('pt-BR', { minimumFractionDigits: 2 }),
      d.ratio.toFixed(2) + 'x',
      (parseInt(d.chars) || 0).toLocaleString('pt-BR'),
      window.ExcelParser.secondsToHMS(d.time)
    ]),
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
      0: { cellWidth: 32, fontStyle: 'bold' },
      1: { cellWidth: 20, halign: 'center' },
      2: { cellWidth: 'auto' }, 
      3: { cellWidth: 22, halign: 'center' }, 
      4: { cellWidth: 24, halign: 'right' },
      5: { cellWidth: 24, halign: 'center' }
    },
    didDrawCell: function(data) {
        if (data.row.index !== undefined && data.section === 'body') {
            doc.setDrawColor(30, 41, 59);
            doc.setLineWidth(0.05);
            doc.line(data.cell.x, data.cell.y + data.cell.height, data.cell.x + data.cell.width, data.cell.y + data.cell.height);
        }
    },
    didParseCell: function(data) {
        if (data.section === 'body' && data.column.index === 2) {
            data.cell.styles.textColor = [16, 185, 129];
        }
    },
    margin: { left: 15, right: 15 }
  });

  // Balanced Footer
  const finalY = doc.lastAutoTable.finalY + 15;
  
  if (finalY < H - 15) {
      doc.setFontSize(7); doc.setTextColor(71, 85, 105); doc.setFont('helvetica', 'italic');
      doc.text('Este documento foi gerado pelo sistema DubAnalytics Premium v3.0 em ' + new Date().toLocaleDateString('pt-BR'), 15, finalY);
  } else {
      doc.addPage();
      doc.setFontSize(7); doc.setTextColor(71, 85, 105); doc.setFont('helvetica', 'italic');
      doc.text('Este documento foi gerado pelo sistema DubAnalytics Premium v3.0 em ' + new Date().toLocaleDateString('pt-BR'), 15, 15);
  }

  let filenameBase = 'Overview';
  if (title.startsWith('Cliente: ')) {
      filenameBase += '_' + title.replace('Cliente: ', '').replace(/\s+/g, '_');
  } else {
      filenameBase += '_Global';
  }

  doc.save(filenameBase + '_' + new Date().toISOString().slice(0,10) + '.pdf');
}

function exportMonthlyReportPDF(clientName, monthLabel, monthPeriod, videos, summary) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();

  // Override addPage to ensure dark background on all new pages created by autoTable
  const originalAddPage = doc.addPage;
  doc.addPage = function() {
    originalAddPage.apply(this, arguments);
    doc.setFillColor(10, 18, 30); 
    doc.rect(0, 0, W, H, 'F');
    return this;
  };

  // Background for first page
  doc.setFillColor(10, 18, 30); 
  doc.rect(0, 0, W, H, 'F');

  // Header Area
  doc.setFillColor(15, 23, 42); 
  doc.rect(0, 0, W, 50, 'F');
  
  // Brand Header
  doc.setTextColor(245, 158, 11);
  doc.setFontSize(22); doc.setFont('helvetica', 'bold');
  doc.text('DubAnalytics Report', 15, 20);
  
  doc.setTextColor(100, 116, 139);
  doc.setFontSize(8); doc.setFont('helvetica', 'normal');
  doc.text('BUSINESS & PERFORMANCE INTELLIGENCE', 15, 26);
  
  // Client Detail
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14); doc.setFont('helvetica', 'bold');
  doc.text(clientName.toUpperCase(), 15, 38);
  
  doc.setTextColor(148, 163, 184);
  doc.setFontSize(10); doc.setFont('helvetica', 'normal');
  doc.text(monthLabel + (monthPeriod ? ' • ' + monthPeriod : ''), 15, 44);
  
  // KPI Section Marker
  doc.setTextColor(245, 158, 11);
  doc.setFontSize(8); doc.setFont('helvetica', 'bold');
  doc.text('PERFORMANCE SNAPSHOT', 15, 62);

  // KPI Cards
  const cardW = (W - 40) / 3;
  const cardY = 66;
  const cardH = 26;
  const cardGap = 5;

  const drawKPICard = (x, title, value, unit, color) => {
    doc.setFillColor(15, 23, 42); // slate-900 (solid)
    doc.roundedRect(x, cardY, cardW, cardH, 3, 3, 'F');
    
    doc.setTextColor(148, 163, 184);
    doc.setFontSize(7); doc.setFont('helvetica', 'normal');
    doc.text(title.toUpperCase(), x + 6, cardY + 8);
    
    doc.setTextColor(color[0], color[1], color[2]);
    doc.setFontSize(13); doc.setFont('helvetica', 'bold');
    doc.text(value, x + 6, cardY + 18);
    
    if (unit) {
      const valW = doc.getTextWidth(value); // Calc width before changing font size
      doc.setFontSize(7); doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);
      doc.text(unit, x + 8 + valW, cardY + 18);
    }
  };

  drawKPICard(15, 'Faturamento Estimado', summary.earnings || 'R$ 0,00', '', [16, 185, 129]);
  drawKPICard(15 + cardW + cardGap, 'Vídeos Entregues', summary.count || '0', 'TOTAL', [255, 255, 255]);
  drawKPICard(15 + (cardW + cardGap) * 2, 'Esforço Acumulado', (summary.hours || '00:00:00').split('(')[0].trim(), '', [245, 158, 11]);

  // Video Listing Table
  doc.autoTable({
    startY: 102,
    head: [['STATUS', 'DETALHES DO TRABALHO', 'IDIOMAS', 'CHARS', 'TEMPO', 'RATIO']],
    body: videos.map(v => {
      const ratio = (v.tempo > 0 && v.tempo_fazer > 0) ? (v.tempo_fazer / v.tempo).toFixed(1) + 'x' : '–';
      return [
        v.feito ? 'CONCLUIDO' : 'PENDENTE',
        (v.titulo || '–').toUpperCase(),
        v.idiomas || 7,
        (parseInt(v.chars) || 0).toLocaleString('pt-BR'),
        window.ExcelParser.secondsToHMS(v.tempo),
        ratio
      ];
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
      fillColor: [15, 23, 42] // solid slate-900 instead of RGBA
    },
    columnStyles: {
      0: { cellWidth: 26, fontStyle: 'bold' },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 24, halign: 'center' }, 
      3: { cellWidth: 20, halign: 'right' },
      4: { cellWidth: 22, halign: 'center' },
      5: { cellWidth: 20, halign: 'center' }
    },
    didDrawCell: function(data) {
        if (data.row.index !== undefined && data.section === 'body') {
            doc.setDrawColor(30, 41, 59);
            doc.setLineWidth(0.05);
            doc.line(data.cell.x, data.cell.y + data.cell.height, data.cell.x + data.cell.width, data.cell.y + data.cell.height);
        }
    },
    didParseCell: function(data) {
        if (data.section === 'body' && data.column.index === 0) {
            if (data.cell.raw === 'CONCLUIDO') data.cell.styles.textColor = [16, 185, 129];
            else data.cell.styles.textColor = [239, 68, 68];
        }
    },
    margin: { left: 15, right: 15 }
  });

  // Balanced Footer
  const finalY = doc.lastAutoTable.finalY + 15;
  
  if (finalY < H - 15) {
      doc.setFontSize(7); doc.setTextColor(71, 85, 105); doc.setFont('helvetica', 'italic');
      doc.text('Este documento foi gerado pelo sistema DubAnalytics Premium v3.0 em ' + new Date().toLocaleDateString('pt-BR'), 15, finalY);
  } else {
      doc.addPage();
      doc.setFontSize(7); doc.setTextColor(71, 85, 105); doc.setFont('helvetica', 'italic');
      doc.text('Este documento foi gerado pelo sistema DubAnalytics Premium v3.0 em ' + new Date().toLocaleDateString('pt-BR'), 15, 15);
  }

  doc.save('MonthlyReport_' + clientName.replace(/\s+/g, '_') + '_' + monthLabel.replace(/\s+/g, '_') + '.pdf');
}

function calculateSuggestedPrice(seconds, targetHourlyRate) {
  return (seconds / 3600) * targetHourlyRate;
}

function calculatePackagePrice(avgSeconds, count, rate) {
  return (avgSeconds / 3600) * count * rate;
}

function getBenchmarks(videos) {
  return videos.filter(v => v.isTest && v.feito)
    .sort((a,b) => b.id - a.id);
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
  getBenchmarks
};
