// app.bundle.js — MFES map, legend, right panel
(function () {
    'use strict';
    console.log('MFES bundle loaded ✅', new Date().toISOString());

    /* ========== Map ========== */
    const map = L.map('map', { preferCanvas: true }).setView([43.59, -79.64], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap'
    }).addTo(map);
    window.map = map;

    /* ========== Helpers ========== */
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
    const ci = getPropCI;

    async function fetchJson(url) {
        const res = await fetch(url + (url.includes('?') ? '&' : '?') + 'cb=' + Date.now(), { cache: 'no-store' });
        const txt = await res.text();
        if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}\n${txt.slice(0, 200)}`);
        const clean = txt.charCodeAt(0) === 0xFEFF ? txt.slice(1) : txt;
        return JSON.parse(clean);
    }

    /* ========== Station palette ========== */
    const STATION_IDS = [101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 114, 115, 116, 117, 118, 119, 120, 121, 122];
    const PALETTE = [
        '#8dd3c7', '#ffffb3', '#bebada', '#fb8072', '#80b1d3',
        '#fdb462', '#b3de69', '#fccde5', '#d9d9d9', '#bc80bd',
        '#ccebc5', '#ffed6f', '#1b9e77', '#d95f02', '#7570b3',
        '#e7298a', '#66a61e', '#e6ab02', '#a6761d', '#666666', '#7fc97f'
    ];
    const COLOR = Object.fromEntries(STATION_IDS.map((id, i) => [String(id), PALETTE[i % PALETTE.length]]));

    window.STATION_IDS = STATION_IDS;
    window.PALETTE = PALETTE;

    /* ========== Hidden Leaflet layers control ========== */
    let layerControl = L.control.layers(null, {}, { collapsed: true }).addTo(map);
    window.layerControl = layerControl;
    setTimeout(() => {
        const lcEl = document.querySelector('.leaflet-control-layers');
        if (lcEl) lcEl.style.display = 'none';
    }, 0);

    /* ========== Legend ========== */
    window.__legend = (function () {
        let ctrl, isOpen = false;
        const visibleKeys = new Set();
        let heatActive = false, heatMin = null, heatMax = null;

        const ORDER = [
            { type: 'label', key: 'stations', label: 'Fire Stations' },
            { type: 'label', key: 'spread', label: 'Incidents Spread' },
            { type: 'heat', key: 'heat', label: 'Incidents Heat Map' },
            { type: 'sa', key: 'existing', label: 'Existing Service Areas' },
            { type: 'sa', key: 'nfpa', label: 'Optimized NFPA Service Areas' },
            { type: 'sa', key: 'aug', label: 'Optimized Augmented Service Areas' },
            { type: 'sa', key: 'ful', label: 'Optimized Fulfilled Service Areas' },
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
                wrap.style.background = '#ffffff';
                wrap.style.border = '1px solid #aaa';
                wrap.style.minWidth = '200px';
                wrap.style.borderRadius = '4px';
                wrap.style.boxShadow = '0 0 5px rgba(0,0,0,.3)';

                const header = L.DomUtil.create('div', 'legend-header', wrap);
                header.style.display = 'flex';
                header.style.alignItems = 'center';
                header.style.justifyContent = 'space-between';
                header.style.cursor = 'pointer';
                header.style.padding = '6px 8px';
                header.style.fontWeight = '600';
                header.style.background = '#f0f0f0';
                header.innerHTML = `<span>Legend</span><span class="legend-caret" style="font-weight:700;user-select:none;">${isOpen ? '▾' : '▸'}</span>`;

                const body = L.DomUtil.create('div', 'legend-body', wrap);
                body.style.display = isOpen ? 'block' : 'none';
                body.style.maxHeight = '42vh';
                body.style.overflow = 'auto';
                body.style.padding = '6px 8px';
                body.style.background = '#fafafa';
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
            setCollapsed(v) {
                if (!ctrl) ensure();
                const h = ctrl.getContainer().querySelector('.legend-header');
                const body = h.nextSibling;
                const open = body.style.display === 'block';
                if (!!v === open) h.click();
            },
            addKey(key) { ensure(); visibleKeys.add(key); refresh(); },
            removeKey(key) { visibleKeys.delete(key); refresh(); },
            setHeatLegend(active, min, max) { ensure(); heatActive = !!active; heatMin = min ?? null; heatMax = max ?? null; refresh(); },
            setSectionVisible(key, v) { ensure(); if (v) visibleKeys.add(key); else visibleKeys.delete(key); refresh(); }
        };
    })();

    window.__legend.ensure();
    window.__legend.setCollapsed(true);

    /* ========== Station filter state ========== */
    window.__serviceAreaRegistry = [];
    const activeStations = new Set(STATION_IDS);

    function applyStationFilter() {
        for (const rec of window.__serviceAreaRegistry) {
            const grp = rec.parent;
            if (!map.hasLayer(grp)) continue;
            const wantOn = activeStations.has(rec.stationId);
            const hasIt = grp.hasLayer(rec.layer);
            if (wantOn && !hasIt) grp.addLayer(rec.layer);
            else if (!wantOn && hasIt) grp.removeLayer(rec.layer);
        }
    }

    /* ========== Styles ========== */
    function styleForStation(st) {
        if (st === 113 || st === '113') return null;
        if (st == null || st === 0 || st === '0') {
            return { color: '#999', weight: 0.8, fillOpacity: 0, fillColor: '#999' };
        }
        const c = COLOR[String(st)] ?? '#999';
        return { color: '#333', weight: 0.6, fillOpacity: 0.55, fillColor: c };
    }

    /* ========== Service areas (GeoJSON) ========== */
    function buildGeoJSONServiceArea(fc, layerLabel, stationKeyCandidates, layerKey) {
        const group = L.layerGroup();
        const gj = L.geoJSON(fc, {
            style: (feat) => {
                let stRaw = getPropCI(
                    feat?.properties || {},
                    ...stationKeyCandidates,
                    'Station', 'Fire Station', 'Fire_Station', 'Station_ID', 'STATION'
                );
                if (typeof stRaw === 'string' && /^\d+$/.test(stRaw)) stRaw = Number(stRaw);
                const style = styleForStation(stRaw);
                return style || { opacity: 0, fillOpacity: 0 };
            },
            onEachFeature: (feat, layer) => {
                let stRaw = getPropCI(
                    feat?.properties || {},
                    ...stationKeyCandidates,
                    'Station', 'Fire Station', 'Fire_Station', 'Station_ID', 'STATION'
                );
                if (typeof stRaw === 'string' && /^\d+$/.test(stRaw)) stRaw = Number(stRaw);
                layer.bindPopup(`
          <div class="layer-badge">${layerLabel}</div>
          <b>Station:</b> ${stRaw ?? '—'}
        `);
                window.__serviceAreaRegistry.push({
                    layer,
                    stationId: Number(stRaw),
                    parent: group,
                    baseStyle: layer.options
                });
            }
        });
        gj.eachLayer(l => group.addLayer(l));
        group.on('add', () => { window.__legend.addKey(layerKey); applyStationFilter(); });
        group.on('remove', () => { window.__legend.removeKey(layerKey); });
        return group;
    }

    /* ========== Incidents (spread / heat / points) ========== */
    function buildIncidentsSpread_GeoJSON(fc, name) {
        return L.geoJSON(fc, {
            style: f => {
                const raw = ci(f?.properties || {}, 'STATION');
                const st = (String(raw).toUpperCase() === '1CH') ? '1CH' : (Number.isFinite(+raw) ? +raw : raw);
                const style = styleForStation(st);
                return style || { opacity: 0, fillOpacity: 0 };
            },
            onEachFeature: (feat, layer) => {
                const st = ci(feat.properties || {}, 'STATION');
                layer.bindPopup(`
          <div class="layer-badge">${name}</div>
          <b>Station:</b> ${st ?? '—'}
        `);
            }
        });
    }

    const HEAT_LEFT = '#f7fbff';
    const HEAT_RIGHT = '#08306b';
    const lerp = (a, b, t) => a + (b - a) * t;
    const hexToRgb = hex => {
        const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
    };
    const rgbToHex = (r, g, b) => {
        const h = n => ('0' + n.toString(16)).slice(-2);
        return '#' + h(Math.round(Math.max(0, Math.min(255, r))))
            + h(Math.round(Math.max(0, Math.min(255, g))))
            + h(Math.round(Math.max(0, Math.min(255, b))));
    };
    function rampColor(t) {
        const a = hexToRgb(HEAT_LEFT), b = hexToRgb(HEAT_RIGHT);
        return rgbToHex(lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t));
    }

    function buildHeat_GeoJSON(fc, name) {
        const vals = (fc.features || []).map(f => Number(ci(f.properties || {}, 'Incidents'))).filter(Number.isFinite);
        const min = vals.length ? Math.min(...vals) : 0;
        const max = vals.length ? Math.max(...vals) : 1;
        const span = (max - min) || 1;

        const layer = L.geoJSON(fc, {
            style: f => {
                const v = Number(ci(f.properties || {}, 'Incidents'));
                const t = Number.isFinite(v) ? Math.max(0, Math.min(1, (v - min) / span)) : 0;
                return { color: '#333', weight: 0.4, fillOpacity: 0.55, fillColor: rampColor(t) };
            },
            onEachFeature: (feat, l) => {
                const v = Number(ci(feat.properties || {}, 'Incidents'));
                l.bindPopup(`
          <div class="layer-badge">${name}</div>
          <b>Incidents:</b> ${Number.isFinite(v) ? v : '—'}
        `);
            }
        });
        return { layer, min, max };
    }

    function parseStationIdFromName(a) {
        const nm = ci(a, 'STATION', 'Station', 'Station_ID', 'StationID', 'NAME', 'LANDMARKNA');
        if (nm != null) {
            const m = String(nm).match(/(\b1?\d{2,3}\b)/);
            if (m) {
                const n = Number(m[1]);
                return Number.isFinite(n) ? n : m[1];
            }
            return nm;
        }
        const oid = ci(a, 'OBJECTID', 'FID');
        const n = Number(oid);
        return Number.isFinite(n) ? n : (oid ?? null);
    }

    function stylePoint(st) {
        if (st === 113 || st === '113') return null;
        const fill = (COLOR[String(st)] || '#e41a1c');
        return { radius: 6, fillColor: fill, color: '#222', weight: 1, fillOpacity: 0.9 };
    }

    function buildPoints_GeoJSON(fc, name) {
        const group = L.layerGroup();
        const gj = L.geoJSON(fc, {
            pointToLayer: (feat, latlng) => {
                const a = feat.properties || {};
                const st = parseStationIdFromName(a);
                const style = stylePoint(st);

                if (!style) {
                    return L.circleMarker(latlng, { radius: 0, opacity: 0, fillOpacity: 0 });
                }

                const marker = L.circleMarker(latlng, style).bindPopup(`
          <div class="layer-badge">${name}</div>
          <b>Station:</b> ${st ?? '—'}<br>
          <b>Name:</b> ${ci(a, 'LANDMARKNA', 'NAME', 'STATION') ?? '—'}
        `);

                const label = L.marker(latlng, {
                    icon: L.divIcon({
                        className: 'stn-label',
                        html: `<div style="color:#000;font-weight:bold;text-shadow:1px 1px 2px #fff;font-size:12px;">${st}</div>`,
                        iconAnchor: [-10, -5]
                    }),
                    interactive: false
                });

                group.addLayer(marker);
                group.addLayer(label);
                return marker;
            }
        });

        group.addLayer(gj);
        return group;
    }

    /* ========== Config ========== */
    const SA_LAYERS = [
        { key: 'existing', label: 'Existing Service Areas', url: './data/Existing_Service_Areas.geojson', stationKeys: ['Low_Hazard1'] },
        { key: 'nfpa', label: 'Optimized NFPA Service Areas', url: './data/Optimized_NFPA_Service_Areas.geojson', stationKeys: ['Areas', 'Low_Hazard1'] },
        { key: 'aug', label: 'Optimized Augmented Service Areas', url: './data/Optimized_Augmented_Service_Areas.geojson', stationKeys: ['Low_Hazard1'] },
        { key: 'ful', label: 'Optimized Fulfilled Service Areas', url: './data/Optimized_Fulfilled_Service_Areas.geojson', stationKeys: ['Low_Hazard1'] },
        { key: 'bmed', label: 'Backups – Medium', url: './data/Service_Areas_Backups_Medium.geojson', stationKeys: ['Low_Hazard2'] },
        { key: 'bhigh', label: 'Backups – High', url: './data/Service_Areas_Backups_High.geojson', stationKeys: ['High_Hazard2'] }
    ];

    const NAME_SPREAD = 'Incidents – Spread';
    const URL_SPREAD = './data/Incidents_Spread.geojson';

    const NAME_HEAT = 'Incidents – Heat Map';
    const URL_HEAT = './data/Incidents_Heat_Map.geojson';

    const NAME_POINTS = 'Fire Stations';
    const URL_POINTS = './data/Fire_Stations.geojson';

    const NAME_BOUNDARY = 'City of Mississauga Boundary';
    const URL_BOUNDARY = './data/City Of Mississauag_Boundary.geojson';

    /* ========== Overlays registry ========== */
    const overlays = {};

    const LAYER_ORDER = [
        'Fire Stations',
        'City of Mississauga Boundary',
        'Incidents – Spread',
        'Incidents – Heat Map',
        'Existing Service Areas',
        'Optimized NFPA Service Areas',
        'Optimized Augmented Service Areas',
        'Optimized Fulfilled Service Areas',
        'Backups – Medium',
        'Backups – High'
    ];

    /* ========== Loaders ========== */
    const serviceAreasLoaded = Promise.all(SA_LAYERS.map(async cfg => {
        const fc = await fetchJson(cfg.url);
        if (!fc || fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) {
            throw new Error(`${cfg.label}: Not a valid GeoJSON FeatureCollection`);
        }
        const grp = buildGeoJSONServiceArea(fc, cfg.label, cfg.stationKeys, cfg.key);
        overlays[cfg.label] = grp;
        layerControl.addOverlay(grp, cfg.label);
        return grp;
    })).then(() => {
        const eg = overlays['Existing Service Areas'];
        if (eg) {
            const b = L.featureGroup(eg.getLayers()).getBounds();
            if (b.isValid()) map.fitBounds(b, { padding: [20, 20] });
        }
    }).catch(console.error);

    const incidentsLoaded = (async () => {
        try {
            const fc = await fetchJson(URL_SPREAD);
            const spread = buildIncidentsSpread_GeoJSON(fc, NAME_SPREAD);
            spread.on('add', () => window.__legend.setSectionVisible('spread', true));
            spread.on('remove', () => window.__legend.setSectionVisible('spread', false));
            overlays[NAME_SPREAD] = spread;
            layerControl.addOverlay(spread, NAME_SPREAD);
        } catch (e) { console.error('[Incidents] Spread failed:', e); }

        try {
            const fc = await fetchJson(URL_HEAT);
            const heatPack = buildHeat_GeoJSON(fc, NAME_HEAT);
            heatPack.layer.on('add', () => window.__legend.setHeatLegend(true, heatPack.min, heatPack.max));
            heatPack.layer.on('remove', () => window.__legend.setHeatLegend(false, null, null));
            overlays[NAME_HEAT] = heatPack.layer;
            layerControl.addOverlay(heatPack.layer, NAME_HEAT);
        } catch (e) { console.error('[Incidents] Heat failed:', e); }

        try {
            const fc = await fetchJson(URL_POINTS);
            const pts = buildPoints_GeoJSON(fc, NAME_POINTS);
            overlays[NAME_POINTS] = pts;
            layerControl.addOverlay(pts, NAME_POINTS);
        } catch (e) { console.error('[Incidents] Points failed:', e); }
    })();

    const boundaryLoaded = (async () => {
        try {
            const fc = await fetchJson(URL_BOUNDARY);
            const boundary = L.geoJSON(fc, {
                style: {
                    color: '#000000',
                    weight: 2,
                    fillOpacity: 0
                }
            });
            overlays[NAME_BOUNDARY] = boundary;
            layerControl.addOverlay(boundary, NAME_BOUNDARY);
        } catch (e) {
            console.error('[Boundary] failed:', e);
        }
    })();

    /* ========== Right panel (layers + filters + chart toggle) ========== */
    let rightPanelControl;

    function buildRightPanelControl() {
        if (rightPanelControl) return;
        rightPanelControl = L.control({ position: 'topright' });

        rightPanelControl.onAdd = function () {
            const wrap = L.DomUtil.create('div', 'leaflet-bar');
            wrap.style.background = '#f3f3f3';
            wrap.style.border = '1px solid #999';
            wrap.style.borderRadius = '4px';
            wrap.style.boxShadow = '0 0 5px rgba(0,0,0,.3)';
            wrap.style.minWidth = '260px';
            wrap.style.maxHeight = '60vh';
            wrap.style.overflow = 'hidden';
            wrap.style.display = 'flex';
            wrap.style.flexDirection = 'column';

            const header = L.DomUtil.create('div', '', wrap);
            header.style.display = 'flex';
            header.style.alignItems = 'center';
            header.style.justifyContent = 'space-between';
            header.style.cursor = 'pointer';
            header.style.padding = '6px 8px';
            header.style.fontWeight = '600';
            header.style.background = '#e0e0e0';
            header.innerHTML = `<span>Layers & Filters</span><span class="rp-caret" style="font-weight:700;user-select:none;">▾</span>`;

            const body = L.DomUtil.create('div', '', wrap);
            body.style.display = 'block';
            body.style.padding = '6px 8px';
            body.style.overflow = 'auto';
            body.style.background = '#f8f8f8';

            const layersSec = document.createElement('div');
            layersSec.innerHTML = `<div style="font-weight:600;margin-bottom:4px;">Layers</div>`;
            const layersList = document.createElement('div');
            layersList.style.display = 'flex';
            layersList.style.flexDirection = 'column';
            layersList.style.gap = '2px';

            LAYER_ORDER.forEach(name => {
                const lyr = overlays[name];
                if (!lyr) return;
                const lbl = document.createElement('label');
                lbl.style.display = 'flex';
                lbl.style.alignItems = 'center';
                lbl.style.gap = '4px';
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.dataset.layerName = name;
                cb.checked = map.hasLayer(lyr);
                lbl.appendChild(cb);
                const span = document.createElement('span');
                span.textContent = name;
                lbl.appendChild(span);
                layersList.appendChild(lbl);
            });

            layersSec.appendChild(layersList);
            body.appendChild(layersSec);

            const sfSec = document.createElement('div');
            sfSec.style.marginTop = '8px';
            sfSec.innerHTML = `<div style="font-weight:600;margin-bottom:4px;">Filter: Stations</div>`;

            const controls = document.createElement('div');
            controls.style.marginBottom = '6px';
            const btnAll = document.createElement('button');
            btnAll.type = 'button';
            btnAll.textContent = 'All';
            btnAll.style.marginRight = '4px';
            const btnNone = document.createElement('button');
            btnNone.type = 'button';
            btnNone.textContent = 'None';
            controls.appendChild(btnAll);
            controls.appendChild(btnNone);
            sfSec.appendChild(controls);

            const grid = document.createElement('div');
            grid.style.display = 'grid';
            grid.style.gridTemplateColumns = 'repeat(5, 1fr)';
            grid.style.columnGap = '6px';
            grid.style.rowGap = '4px';
            grid.style.fontSize = '12px';

            STATION_IDS.forEach(id => {
                const lbl = document.createElement('label');
                lbl.style.display = 'inline-flex';
                lbl.style.alignItems = 'center';
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.style.marginRight = '4px';
                cb.dataset.st = String(id);
                cb.checked = activeStations.has(id);
                lbl.appendChild(cb);
                lbl.appendChild(document.createTextNode(String(id)));
                grid.appendChild(lbl);
            });

            sfSec.appendChild(grid);
            body.appendChild(sfSec);

            const chartSec = document.createElement('div');
            chartSec.style.marginTop = '8px';
            chartSec.innerHTML = `<div style="font-weight:600;margin-bottom:4px;">Analogy of Existing and Optimized Response Times</div>`;
            const chartRow = document.createElement('label');
            chartRow.style.display = 'flex';
            chartRow.style.alignItems = 'center';
            chartRow.style.gap = '4px';
            const chartCb = document.createElement('input');
            chartCb.type = 'checkbox';
            chartCb.id = 'rt-chart-toggle';

            const chartPanel = document.getElementById('rt-chart-container');
            if (chartPanel) {
                chartPanel.style.display = 'none';
                chartCb.checked = false;
            } else {
                chartCb.checked = false;
            }

            chartRow.appendChild(chartCb);
            chartRow.appendChild(document.createTextNode('Show chart'));
            chartSec.appendChild(chartRow);
            body.appendChild(chartSec);

            header.addEventListener('click', () => {
                const isOpen = body.style.display !== 'none';
                body.style.display = isOpen ? 'none' : 'block';
                header.querySelector('.rp-caret').textContent = isOpen ? '▸' : '▾';
            });

            layersList.addEventListener('change', e => {
                const t = e.target;
                if (!t.matches('input[type="checkbox"][data-layer-name]')) return;
                const name = t.dataset.layerName;
                const lyr = overlays[name];
                if (!lyr) return;
                if (t.checked) map.addLayer(lyr);
                else map.removeLayer(lyr);
            });

            btnAll.onclick = () => {
                activeStations.clear();
                STATION_IDS.forEach(id => activeStations.add(id));
                grid.querySelectorAll('input[data-st]').forEach(cb => cb.checked = true);
                applyStationFilter();
            };
            btnNone.onclick = () => {
                activeStations.clear();
                grid.querySelectorAll('input[data-st]').forEach(cb => cb.checked = false);
                applyStationFilter();
            };

            grid.addEventListener('change', e => {
                const t = e.target;
                if (!t.matches('input[data-st]')) return;
                const id = Number(t.dataset.st);
                if (t.checked) activeStations.add(id);
                else activeStations.delete(id);
                applyStationFilter();
            });

            chartCb.addEventListener('change', () => {
                const panel = document.getElementById('rt-chart-container');
                if (!panel) return;
                panel.style.display = chartCb.checked ? 'block' : 'none';
            });

            L.DomEvent.disableClickPropagation(wrap);
            L.DomEvent.disableScrollPropagation(wrap);
            return wrap;
        };

        rightPanelControl.addTo(map);
    }

    /* ========== Init right panel after layers load ========== */
    Promise.all([serviceAreasLoaded, incidentsLoaded, boundaryLoaded]).then(() => {
        if (overlays[NAME_POINTS]) overlays[NAME_POINTS].addTo(map);
        if (overlays[NAME_BOUNDARY]) overlays[NAME_BOUNDARY].addTo(map);
        buildRightPanelControl();
    });

    /* ========== RT Chart ========== */
    window.addEventListener('load', function () {
        if (typeof Chart === 'undefined') {
            console.error('[RT Chart] Chart.js not loaded. Check <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>.');
            return;
        }

        const canvas = document.getElementById('rtChart');
        if (!canvas) {
            console.error('[RT Chart] Canvas with id="rtChart" not found in DOM.');
            return;
        }

        const ctx = canvas.getContext('2d');
        const labels = ["NFPA", "Augmented", "Fulfilled"];

        const existingValues = [276, 629, null];
        const optimizedValues = [230, 538, 541];

        new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    { label: "Existing", data: existingValues, borderWidth: 1 },
                    { label: "Optimized", data: optimizedValues, borderWidth: 1 }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        title: { display: true, text: "Seconds" }
                    }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: function (ctx) {
                                if (ctx.raw === null) return "Existing: NA";
                                return `${ctx.dataset.label}: ${ctx.raw} sec`;
                            }
                        }
                    }
                }
            }
        });

        console.log('[RT Chart] Response-time chart rendered ✅');
    });

})();  
