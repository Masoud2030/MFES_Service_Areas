// app.js — GitHub Pages–ready: keyed legend + station filter, ESRI+GeoJSON support
console.log("Leaflet app (Pages-safe): keyed legend, station filter, Existing on by default");

/* ===================== Map ===================== */
const map = L.map('map', { preferCanvas: true }).setView([43.59, -79.64], 11);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap'
}).addTo(map);
window.map = map;

/* ===================== Helpers ====================== */
function getPropCI(obj, ...cands) {
    if (!obj) return undefined;
    const lower = Object.create(null);
    for (const k of Object.keys(obj)) lower[k.toLowerCase()] = k;
    for (const c of cands) {
        const real = lower[String(c).toLowerCase()];
        if (real !== undefined) return obj[real];
    }
    return undefined;
}
const isWM = w => w === 3857 || w === 102100 || w === 102113;
function merc2ll(x, y) {
    const R = 6378137;
    const lon = (x / R) * 180 / Math.PI;
    const lat = (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI;
    return [lat, lon];
}
function pt2ll(pt, wkid) {
    if (Array.isArray(pt)) return isWM(wkid) ? merc2ll(pt[0], pt[1]) : [pt[1], pt[0]];
    if (pt && 'x' in pt && 'y' in pt) return isWM(wkid) ? merc2ll(pt.x, pt.y) : [pt.y, pt.x];
    return null;
}
async function fetchJson(url) {
    const res = await fetch(url + (url.includes('?') ? '&' : '?') + 'cb=' + Date.now(), { cache: 'no-store' });
    const txt = await res.text();
    if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}\n${txt.slice(0, 200)}`);
    const clean = txt.charCodeAt(0) === 0xFEFF ? txt.slice(1) : txt;
    return JSON.parse(clean);
}

// Accept ESRI JSON, GeoJSON FeatureCollection, or ArcGIS "layers" wrapper
function normalizeAny(data) {
    // GeoJSON?
    if (data?.type === 'FeatureCollection' && Array.isArray(data.features)) {
        return { kind: 'geojson', wkid: 4326, features: data.features };
    }
    // ESRI FeatureSet?
    let wkid = data?.spatialReference?.wkid ?? data?.spatialReference?.latestWkid;
    if (Array.isArray(data?.features)) {
        if (!wkid && data.features.length) wkid = data.features[0]?.geometry?.spatialReference?.wkid
            ?? data.features[0]?.geometry?.spatialReference?.latestWkid;
        return { kind: 'esri', wkid, features: data.features };
    }
    // ArcGIS webmap-ish wrapper
    const collect = (layers) => {
        const merged = [];
        for (const lyr of layers) {
            const fs = lyr?.featureSet?.features || lyr?.features;
            if (Array.isArray(fs)) merged.push(...fs);
            if (!wkid) wkid = lyr?.layerDefinition?.spatialReference?.wkid ?? lyr?.spatialReference?.wkid;
        }
        return merged.length ? { kind: 'esri', wkid, features: merged } : { kind: 'unknown' };
    };
    if (Array.isArray(data?.layers)) return collect(data.layers);
    if (Array.isArray(data?.featureCollection?.layers)) return collect(data.featureCollection.layers);
    return { kind: 'unknown' };
}

// Create a single Layers control up-front (collapsed UI)
const lc = L.control.layers(null, {}, { collapsed: true }).addTo(map);
window.layerControl = lc;

/* ===================== Station palette ====================== */
const STATION_IDS = [101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 114, 115, 116, 117, 118, 119, 120, 121, 122]; // 113 skipped
const PALETTE = [
    '#8dd3c7', '#ffffb3', '#bebada', '#fb8072', '#80b1d3',
    '#fdb462', '#b3de69', '#fccde5', '#d9d9d9', '#bc80bd',
    '#ccebc5', '#ffed6f', '#1b9e77', '#d95f02', '#7570b3',
    '#e7298a', '#66a61e', '#e6ab02', '#a6761d', '#666666', '#7fc97f'
];
const COLOR = Object.fromEntries(STATION_IDS.map((id, i) => [String(id), PALETTE[i % PALETTE.length]]));

// expose for incidents.js
window.STATION_IDS = STATION_IDS;
window.PALETTE = PALETTE;

/* ===================== Registries ====================== */
window.__serviceAreaRegistry = window.__serviceAreaRegistry || []; // {layer, stationId, parent, baseStyle}

/* ===================== Unified legend (keyed, self-contained) ====================== */
/* ===================== Unified legend (keyed, collapsible) ====================== */
window.__legend = window.__legend || (function () {
    let ctrl, isOpen = false;          // start collapsed
    const visibleKeys = new Set();     // which keyed sections are on
    let heatActive = false, heatMin = null, heatMax = null;

    const ORDER = [
        { type: 'label', key: 'stations', label: 'Fire Stations' },
        { type: 'heat', key: 'heat', label: 'Incidents – Heat Map' },
        { type: 'label', key: 'spread', label: 'Incidents – Spread' },
        { type: 'sa', key: 'existing', label: 'Existing Service Areas' },
        { type: 'sa', key: 'nfpa', label: 'Optimized – NFPA Service Areas' },
        { type: 'sa', key: 'aug', label: 'Optimized – Augmented Service Areas' },
        { type: 'sa', key: 'ful', label: 'Optimized – Fulfilled Service Areas' },
        { type: 'sa', key: 'bmed', label: 'Backups – Medium' },
        { type: 'sa', key: 'bhigh', label: 'Backups – High' }
    ];

    const HEAT_LEFT = '#f7fbff';
    const HEAT_RIGHT = '#08306b';

    function sectionHTML(entry) {
        const { key, label } = entry;

        if (key === 'stations') {
            let s = `<div style="margin-top:6px;"><b>${label}</b></div>`;
            for (const id of STATION_IDS) {
                s += `<div><span style="display:inline-block;width:16px;height:12px;border:1px solid #999;margin-right:4px;background:${COLOR[String(id)]}"></span>${id}</div>`;
            }
            return s;
        }
        if (key === 'heat') {
            if (heatActive && Number.isFinite(heatMin) && Number.isFinite(heatMax)) {
                return `<div style="margin-top:6px;"><b>${label}</b></div>
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="font-size:12px;">${heatMin.toFixed(1)}</span>
            <div style="height:12px;flex:1;border:1px solid #999;background:linear-gradient(90deg, ${HEAT_LEFT}, ${HEAT_RIGHT});"></div>
            <span style="font-size:12px;">${heatMax.toFixed(1)}</span>
          </div>`;
            }
            return '';
        }
        return visibleKeys.has(key) ? `<div style="margin-top:6px;"><b>${label}</b></div>` : '';
    }

    function innerHTML() {
        let html = '';
        for (const entry of ORDER) html += sectionHTML(entry);
        return html;
    }

    function ensure() {
        if (ctrl) return ctrl;
        ctrl = L.control({ position: 'bottomleft' });
        ctrl.onAdd = () => {
            const wrap = L.DomUtil.create('div', 'legend leaflet-bar');
            wrap.style.background = '#fff';
            wrap.style.border = '1px solid #999';
            wrap.style.minWidth = '180px';

            const header = L.DomUtil.create('div', 'legend-header', wrap);
            header.style.display = 'flex';
            header.style.alignItems = 'center';
            header.style.justifyContent = 'space-between';
            header.style.cursor = 'pointer';
            header.style.padding = '6px 8px';
            header.style.fontWeight = '600';
            header.innerHTML = `<span>Legend</span><span class="legend-caret" style="font-weight:700;user-select:none;">${isOpen ? '▾' : '▸'}</span>`;

            const body = L.DomUtil.create('div', 'legend-body', wrap);
            body.style.display = isOpen ? 'block' : 'none';
            body.style.maxHeight = '42vh';
            body.style.overflow = 'auto';
            body.style.padding = '6px 8px';
            body.innerHTML = innerHTML();

            function toggle() {
                isOpen = !isOpen;
                body.style.display = isOpen ? 'block' : 'none';
                header.querySelector('.legend-caret').textContent = isOpen ? '▾' : '▸';
            }
            header.addEventListener('click', toggle);
            L.DomEvent.disableClickPropagation(wrap);
            L.DomEvent.disableScrollPropagation(wrap);

            return wrap;
        };
        ctrl.addTo(map);
        return ctrl;
    }

    function refresh() {
        const body = ctrl?.getContainer()?.querySelector('.legend-body');
        if (body) body.innerHTML = innerHTML();
    }

    return {
        ensure,
        setCollapsed(v) { isOpen = !v; const c = ctrl?.getContainer(); if (c) c.querySelector('.legend-header')?.click(); },
        addKey(key) { ensure(); visibleKeys.add(key); refresh(); },
        removeKey(key) { visibleKeys.delete(key); refresh(); },
        setHeatLegend(active, min, max) { ensure(); heatActive = !!active; heatMin = min ?? null; heatMax = max ?? null; refresh(); },
        setSectionVisible(key, visible) { ensure(); if (visible) visibleKeys.add(key); else visibleKeys.delete(key); refresh(); }
    };
})();


/* ===================== Station filter (service areas only) ====================== */
window.__stationFilter = window.__stationFilter || (function () {
    let ctrl;
    const selected = new Set(STATION_IDS);
    function apply() {
        for (const rec of window.__serviceAreaRegistry) {
            const grp = rec.parent;
            if (!map.hasLayer(grp)) continue; // only adjust visible group
            const wantOn = selected.has(rec.stationId);
            const hasIt = grp.hasLayer(rec.layer);
            if (wantOn && !hasIt) grp.addLayer(rec.layer);
            else if (!wantOn && hasIt) grp.removeLayer(rec.layer);
        }
    }
    function ensure() {
        if (ctrl) return ctrl;
        ctrl = L.control({ position: 'topright' });
        ctrl.onAdd = () => {
            const div = L.DomUtil.create('div', 'leaflet-bar');
            div.style.padding = '6px';
            div.style.background = 'white';
            div.style.maxHeight = '46vh';
            div.style.overflow = 'auto';
            const mk = id => `<label style="display:inline-flex;align-items:center;margin:2px 6px 2px 0;">
        <input type="checkbox" data-st="${id}" checked style="margin-right:4px;">${id}</label>`;
            div.innerHTML = `<div style="font-weight:600;margin-bottom:4px;">Filter: Stations</div>
        <div style="margin-bottom:4px;"><button type="button" class="sf-all">All</button>
        <button type="button" class="sf-none">None</button></div>
        <div style="display:flex;flex-wrap:wrap;max-width:220px;">${STATION_IDS.map(mk).join('')}</div>`;
            L.DomEvent.disableClickPropagation(div); L.DomEvent.disableScrollPropagation(div);
            div.querySelector('.sf-all').onclick = () => {
                selected.clear(); STATION_IDS.forEach(i => selected.add(i));
                div.querySelectorAll('input[data-st]').forEach(cb => cb.checked = true); apply();
            };
            div.querySelector('.sf-none').onclick = () => {
                selected.clear(); div.querySelectorAll('input[data-st]').forEach(cb => cb.checked = false); apply();
            };
            div.addEventListener('change', e => {
                const t = e.target; if (!t.matches('input[data-st]')) return;
                const id = Number(t.getAttribute('data-st'));
                if (t.checked) selected.add(id); else selected.delete(id);
                apply();
            });
            return div;
        };
        ctrl.addTo(map);
        map.on('overlayadd overlayremove', () => apply());
        return ctrl;
    }
    return { ensure, apply };
})();

/* ===================== Styles & builders ====================== */
function styleForStation(st) {
    if (st === 113 || st === '113') return null; // skip 113
    if (st == null || st === 0 || st === '0') {
        return { color: '#999', weight: 0.8, fillOpacity: 0, fillColor: '#999' };
    }
    const c = COLOR[String(st)] ?? '#999';
    return { color: '#333', weight: 0.6, fillOpacity: 0.55, fillColor: c };
}

// ESRI polygons (rings)
function buildEsriLayer(features, wkid, layerLabel, stationKeyCandidates, layerKey) {
    const group = L.layerGroup();
    for (const f of features) {
        const g = f?.geometry; if (!g) continue;
        const rings = g.rings || g.curveRings; if (!Array.isArray(rings)) continue;

        let stRaw = getPropCI(f?.attributes || {}, ...stationKeyCandidates, 'Station', 'Fire Station', 'Fire_Station', 'Station_ID');
        if (typeof stRaw === 'string' && /^\d+$/.test(stRaw)) stRaw = Number(stRaw);
        const st = stRaw;

        const style = styleForStation(st); if (!style) continue;

        const latlng = rings.map(r => r.map(pt => pt2ll(pt, wkid)).filter(Boolean)).filter(r => r.length >= 3);
        if (!latlng.length) continue;

        const poly = L.polygon(latlng, style).bindPopup(`
      <div class="layer-badge">${layerLabel}</div>
      <b>Station:</b> ${st ?? '—'}<br>
      <b>Area:</b> ${getPropCI(f.attributes, 'Shape__Area', 'Shape_Area') ?? '—'}<br>
      <b>Perimeter:</b> ${getPropCI(f.attributes, 'Shape__Length', 'Shape_Length') ?? '—'}
    `);
        group.addLayer(poly);
        window.__serviceAreaRegistry.push({ layer: poly, stationId: Number(st), parent: group, baseStyle: style });
    }
    group.on('add', () => { window.__legend.addKey(layerKey); window.__stationFilter.apply(); });
    group.on('remove', () => { window.__legend.removeKey(layerKey); });
    return group;
}

// GeoJSON polygons/multipolygons
function buildGeoJSONLayer(fc, layerLabel, stationKeyCandidates, layerKey) {
    const group = L.layerGroup();
    const gj = L.geoJSON(fc, {
        style: (feat) => {
            let stRaw = getPropCI(feat?.properties || {}, ...stationKeyCandidates, 'Station', 'Fire Station', 'Fire_Station', 'Station_ID');
            if (typeof stRaw === 'string' && /^\d+$/.test(stRaw)) stRaw = Number(stRaw);
            const style = styleForStation(stRaw);
            return style || { opacity: 0, fillOpacity: 0 }; // hide if skipped (e.g., 113)
        },
        onEachFeature: (feat, layer) => {
            let stRaw = getPropCI(feat?.properties || {}, ...stationKeyCandidates, 'Station', 'Fire Station', 'Fire_Station', 'Station_ID');
            if (typeof stRaw === 'string' && /^\d+$/.test(stRaw)) stRaw = Number(stRaw);
            const st = stRaw;
            layer.bindPopup(`
        <div class="layer-badge">${layerLabel}</div>
        <b>Station:</b> ${st ?? '—'}
      `);
            // register for station filter, but only polygon layers
            window.__serviceAreaRegistry.push({ layer, stationId: Number(st), parent: group, baseStyle: layer.options });
        }
    });
    gj.eachLayer(l => group.addLayer(l));
    group.on('add', () => { window.__legend.addKey(layerKey); window.__stationFilter.apply(); });
    group.on('remove', () => { window.__legend.removeKey(layerKey); });
    return group;
}

/* ===================== Config & load (KEYED) ====================== */
const LAYERS = [
    { key: 'existing', label: 'Existing Service Areas', url: './data/Existing_Service_Areas.json', stationKeys: ['Low_Hazard1'] },
    { key: 'nfpa', label: 'Optimized – NFPA Service Areas', url: './data/Optimized_NFPA_Service_Areas.json', stationKeys: ['Areas', 'Low_Hazard1'] },
    { key: 'aug', label: 'Optimized – Augmented Service Areas', url: './data/Optimized_Augmented_Service_Areas.json', stationKeys: ['Low_Hazard1'] },
    { key: 'ful', label: 'Optimized – Fulfilled Service Areas', url: './data/Optimized_Fulfilled_Service_Areas.json', stationKeys: ['Low_Hazard1'] },
    { key: 'bmed', label: 'Backups – Medium', url: './data/Service_Areas_Backups_Medium.json', stationKeys: ['Low_Hazard2'] },
    { key: 'bhigh', label: 'Backups – High', url: './data/Service_Areas_Backups_High.json', stationKeys: ['High_Hazard2'] }
];

const overlays = {};
Promise.all(LAYERS.map(async cfg => {
    const raw = await fetchJson(cfg.url);
    const norm = normalizeAny(raw);
    let grp;
    if (norm.kind === 'esri') {
        grp = buildEsriLayer(norm.features, norm.wkid, cfg.label, cfg.stationKeys, cfg.key);
    } else if (norm.kind === 'geojson') {
        grp = buildGeoJSONLayer({ type: 'FeatureCollection', features: norm.features }, cfg.label, cfg.stationKeys, cfg.key);
    } else {
        throw new Error(`${cfg.label}: unsupported data format`);
    }
    overlays[cfg.label] = grp;      // label shown in Layers control
    return grp;
})).then(() => {
    const lc = L.control.layers(null, overlays, { collapsed: false }).addTo(map);
    window.layerControl = lc;

    window.__legend.ensure();
    window.__stationFilter.ensure();

    // Start with ONLY Existing on
    overlays['Existing Service Areas']?.addTo(map);

    // Fit map to Existing
    const eg = overlays['Existing Service Areas'];
    if (eg) {
        const b = L.featureGroup(eg.getLayers()).getBounds();
        if (b.isValid()) map.fitBounds(b, { padding: [20, 20] });
    }
}).catch(console.error);
