/* Lightweight dependency-free SVG charts */

export function lineChart({ labels = [], series = [], height = 200, showLegend = true } = {}) {
  const width = 640;
  const pad = { top: 14, right: 12, bottom: 24, left: 32 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const all = series.flatMap((s) => s.values);
  const max = Math.max(1, ...all);
  const niceMax = Math.max(4, Math.ceil(max / 4) * 4);
  const x = (i) => pad.left + (labels.length <= 1 ? innerW / 2 : (i / (labels.length - 1)) * innerW);
  const y = (v) => pad.top + innerH - (v / niceMax) * innerH;
  const gridCount = 4;
  let grid = '';
  for (let i = 0; i <= gridCount; i++) {
    const gy = pad.top + (innerH / gridCount) * i;
    const value = Math.round(niceMax - (niceMax / gridCount) * i);
    grid += `<line class="grid-line" x1="${pad.left}" y1="${gy}" x2="${width - pad.right}" y2="${gy}"/>`;
    grid += `<text x="${pad.left - 6}" y="${gy + 3}" text-anchor="end">${value}</text>`;
  }
  const step = Math.max(1, Math.ceil(labels.length / 7));
  const xLabels = labels
    .map((label, i) =>
      i % step === 0 || i === labels.length - 1
        ? `<text x="${x(i)}" y="${height - 6}" text-anchor="middle">${escapeXml(label)}</text>`
        : ''
    )
    .join('');

  const paths = series
    .map((s) => {
      const pts = s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
      const area = `M ${x(0)},${pad.top + innerH} L ${s.values.map((v, i) => `${x(i)},${y(v)}`).join(' L ')} L ${x(s.values.length - 1)},${pad.top + innerH} Z`;
      return `<path d="${area}" fill="${s.color}" opacity="0.08"/>
        <polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
        ${s.values
          .map((v, i) => (i === s.values.length - 1 ? `<circle cx="${x(i)}" cy="${y(v)}" r="3.5" fill="#fff" stroke="${s.color}" stroke-width="2"/>` : ''))
          .join('')}`;
    })
    .join('');

  const legend = showLegend
    ? `<div class="chart-legend" style="margin-top:8px">${series
        .map((s) => `<span><i style="background:${s.color}"></i>${escapeXml(s.name)}</span>`)
        .join('')}</div>`
    : '';

  return `<div class="chart-box">
    <svg class="chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Trend chart">
      ${grid}${paths}${xLabels}
    </svg>
    ${legend}
  </div>`;
}

export function barChart({ items = [], valueKey = 'value', labelKey = 'date', color = '#6152f4', height = 160 } = {}) {
  if (!items.length) return '<p class="text-sm text-muted">No data yet.</p>';
  const max = Math.max(1, ...items.map((i) => Number(i[valueKey]) || 0));
  return `<div class="bar-chart" style="height:${height}px">${items
    .map((item) => {
      const value = Number(item[valueKey]) || 0;
      const h = Math.max(3, Math.round((value / max) * 100));
      return `<div class="bar-col" title="${escapeXml(String(item[labelKey]))}: ${value}">
        <div class="bar" style="height:${h}%;background:linear-gradient(180deg,${color},${color}99)"></div>
        <span class="bar-label">${escapeXml(String(item[labelKey]).slice(5))}</span>
      </div>`;
    })
    .join('')}</div>`;
}

function escapeXml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
}
