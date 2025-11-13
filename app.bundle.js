// app.bundle.js — unified map, ONE collapsible legend, collapsible station filter
(function () {
    'use strict';
    console.log('MFES bundle loaded ✅', new Date().toISOString());

    /* ===================== Map ===================== */
    const map = L.map('map', { preferCanvas: true }).setView([43.59, -79.64], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '&copy; OpenStreetMap'
    }).addTo(map);
    window.map = map;

    /* ===================== Helpers ====================== */
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

    async function fetchJson(url) {
        const res = await fetch(url + (url.includes('?') ? '&' : '?') + 'cb=' + Date.now(), { cache: 'no-store' });
        const txt = await res.text();
        if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}\n${txt.slice(0, 200)}`);
        const clean = txt.charCodeAt(0) === 0xFEFF ? txt.slice(1) : txt;
        return JSON.parse(clean);
    }

    // Accept ESRI FeatureSet, GeoJSON FC, or ArcGIS layers wrapper
    function normalizeAny(data) {
        if (data?.type === 'FeatureCollection' && Array.isArray(data.features)) {
            return { kind: 'geojson', wkid: 4326, features: data.features };
        }
        let wkid = data?.spatialReference?.wkid ?? data?.spatialReference?.latestWkid;
        if (Array.isArray(data?.features)) {
            if (!wkid && data.features.length) {
                wkid = data.features[0]?.geometry?.spatialReference?.wkid
                    ?? data.features[0]?.geometry?.spatialReference?.latestWkid;
            }
            return { kind: 'esri', wkid, features: data.features };
        }
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

    /* ===================== Station palette ====================== */
    const STATION_IDS = [101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 114, 115, 116, 117, 118, 119, 120, 121, 122]; // 113 skipped
    const PALETTE = [
        '#8dd3c7', '#ffffb3', '#bebada', '#fb8072', '#80b1d3',
        '#fdb462', '#b3de69', '#fccde5', '#d9d9d9', '#bc80bd',
        '#ccebc5', '#ffed6f', '#1b9e77', '#d95f02', '#7570b3',
        '#e7298a', '#66a61e', '#e6ab02', '#a6761d', '#666666', '#7fc97f'
    ];
    const COLOR = Object.fromEntries(STATION_IDS.map((id, i) => [String(id), PALETTE[i % PALETTE.length]]));

    window.STATION_IDS = STATION_IDS; // expose for debugging
    window.PALETTE = PALETTE;

    /* ===================== ONE Layers control ====================== */
    const layerControl = L.control.layers(null, {}, { collapsed: true }).addTo(map);
    window.layerControl = layerControl;

    /* ===================== Collapsible unified legend ====================== */
    window.__legend = (function () {
        let ctrl, isOpen = false;
        const visibleKeys = new Set();   // which keyed sections are visible
        let heatActive = false, heatMin = null, heatMax = null;

        // EXACT ORDER requested
        const ORDER = [
            { type: 'label', key: 'stations', label: 'Fire Stations' },
            { type: 'label', key: 'spread', label: 'Incidents Spread' },
            { type: 'heat', key: 'heat', label: 'Incidents Heat Map' },
            { type: 'sa', key: 'aug', label: 'Optimized Augmented Service Areas' },
            { type: 'sa', key: 'ful', label: 'Optimized Fulfilled Service Areas' },
            { type: 'sa', key: 'nfpa', label: 'Optimized NFPA Service Areas' },
            { type: 'sa', key: 'existing', label: 'Existing Service Areas' },
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

            // Service-area & spread sections only when visible
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
            setCollapsed(v) {
                if (!ctrl) ensure();
                const h = ctrl.getContainer().querySelector('.legend-header');
                const body = h.nextSibling;
                const currentlyOpen = body.style.display === 'block';
                if (!!v === currentlyOpen) h.click(); // toggle if needed
            },
            addKey(key) { ensure(); visibleKeys.add(key); refresh(); },
            removeKey(key) { visibleKeys.delete(key); refresh(); },
            setHeatLegend(active, min, max) { ensure(); heatActive = !!active; heatMin = min ?? null; heatMax = max ?? null; refresh(); },
            setSectionVisible(key, v) { ensure(); if (v) visibleKeys.add(key); else visibleKeys.delete(key); refresh(); }
        };
    })();

    window.__legend.ensure();
    window.__legend.setCollapsed(true); // start collapsed

    /* ===================== Collapsible Station filter ====================== */
    window.__serviceAreaRegistry = []; // {layer, stationId, parent, baseStyle}
    window.__stationFilter = (function () {
        let ctrl, isOpen = false; // start collapsed
        const selected = new Set(STATION_IDS);

        function apply() {
            for (const rec of window.__serviceAreaRegistry) {
                const grp = rec.parent;
                if (!map.hasLayer(grp)) continue;
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
                const wrap = L.DomUtil.create('div', 'leaflet-bar');
                wrap.style.background = 'white';
                wrap.style.border = '1px solid #999';
                wrap.style.borderRadius = '4px';
                wrap.style.boxShadow = '0 0 5px rgba(0,0,0,.3)';
                wrap.style.minWidth = '220px';

                const header = L.DomUtil.create('div', 'sf-header', wrap);
                header.style.display = 'flex';
                header.style.alignItems = 'center';
                header.style.justifyContent = 'space-between';
                header.style.cursor = 'pointer';
                header.style.padding = '6px 8px';
                header.style.fontWeight = '600';
                header.innerHTML = `<span>Filter: Stations</span><span class="sf-caret" style="font-weight:700;user-select:none;">${isOpen ? '▾' : '▸'}</span>`;

                const body = L.DomUtil.create('div', 'sf-body', wrap);
                body.style.display = isOpen ? 'block' : 'none';
                body.style.maxHeight = '46vh';
                body.style.overflow = 'auto';
                body.style.padding = '6px 8px';

                const controls = document.createElement('div');
                controls.style.marginBottom = '6px';
                controls.innerHTML = `<button type="button" class="sf-all">All</button> <button type="button" class="sf-none">None</button>`;
                body.appendChild(controls);

                const grid = document.createElement('div');
                grid.style.display = 'flex';
                grid.style.flexWrap = 'wrap';
                grid.style.gap = '4px 8px';
                STATION_IDS.forEach(id => {
                    const lbl = document.createElement('label');
                    lbl.style.display = 'inline-flex';
                    lbl.style.alignItems = 'center';
                    lbl.innerHTML = `<input type="checkbox" data-st="${id}" checked style="margin-right:4px;">${id}`;
                    grid.appendChild(lbl);
                });
                body.appendChild(grid);

                function toggle() {
                    isOpen = !isOpen;
                    body.style.display = isOpen ? 'block' : 'none';
                    header.querySelector('.sf-caret').textContent = isOpen ? '▾' : '▸';
                }
                header.addEventListener('click', toggle);

                L.DomEvent.disableClickPropagation(wrap);
                L.DomEvent.disableScrollPropagation(wrap);

                controls.querySelector('.sf-all').onclick = () => {
                    selected.clear(); STATION_IDS.forEach(i => selected.add(i));
                    body.querySelectorAll('input[data-st]').forEach(cb => cb.checked = true);
                    apply();
                };
                controls.querySelector('.sf-none').onclick = () => {
                    selected.clear();
                    body.querySelectorAll('input[data-st]').forEach(cb => cb.checked = false);
                    apply();
                };
                body.addEventListener('change', e => {
                    const t = e.target; if (!t.matches('input[data-st]')) return;
                    const id = Number(t.getAttribute('data-st'));
                    if (t.checked) selected.add(id); else selected.delete(id);
                    apply();
                });

                return wrap;
            };
            ctrl.addTo(map);
            map.on('overlayadd overlayremove', () => apply());
            return ctrl;
        }
        return { ensure, apply };
    })();
    window.__stationFilter.ensure();

    /* ===================== Styles ====================== */
    function styleForStation(st) {
        if (st === 113 || st === '113') return null; // skip 113
        if (st == null || st === 0 || st === '0') return { color: '#999', weight: 0.8, fillOpacity: 0, fillColor: '#999' };
        const c = COLOR[String(st)] ?? '#999';
        return { color: '#333', weight: 0.6, fillOpacity: 0.55, fillColor: c };
    }

    /* ===================== Service-area builders ====================== */
    function buildEsriServiceArea(features, wkid, layerLabel, stationKeyCandidates, layerKey) {
        const group = L.layerGroup();
        for (const f of features) {
            const g = f?.geometry; if (!g) continue;
            const rings = g.rings || g.curveRings; if (!Array.isArray(rings)) continue;

            let stRaw = getPropCI(f?.attributes || {}, ...stationKeyCandidates, 'Station', 'Fire Station', 'Fire_Station', 'Station_ID', 'STATION');
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

    function buildGeoJSONServiceArea(fc, layerLabel, stationKeyCandidates, layerKey) {
        const group = L.layerGroup();
        const gj = L.geoJSON(fc, {
            style: (feat) => {
                let stRaw = getPropCI(feat?.properties || {}, ...stationKeyCandidates, 'Station', 'Fire Station', 'Fire_Station', 'Station_ID', 'STATION');
                if (typeof stRaw === 'string' && /^\d+$/.test(stRaw)) stRaw = Number(stRaw);
                const style = styleForStation(stRaw);
                return style || { opacity: 0, fillOpacity: 0 };
            },
            onEachFeature: (feat, layer) => {
                let stRaw = getPropCI(feat?.properties || {}, ...stationKeyCandidates, 'Station', 'Fire Station', 'Fire_Station', 'Station_ID', 'STATION');
                if (typeof stRaw === 'string' && /^\d+$/.test(stRaw)) stRaw = Number(stRaw);
                layer.bindPopup(`
          <div class="layer-badge">${layerLabel}</div>
          <b>Station:</b> ${stRaw ?? '—'}
        `);
                window.__serviceAreaRegistry.push({ layer, stationId: Number(stRaw), parent: group, baseStyle: layer.options });
            }
        });
        gj.eachLayer(l => group.addLayer(l));
        group.on('add', () => { window.__legend.addKey(layerKey); window.__stationFilter.apply(); });
        group.on('remove', () => { window.__legend.removeKey(layerKey); });
        return group;
    }

    /* ===================== Incidents: Spread / Heat / Points ====================== */
    const ci = getPropCI; // alias

    // Spread
    function buildIncidentsSpread_ESRI(features, wkid, name) {
        const polys = [];
        for (const f of features) {
            const g = f?.geometry; if (!g) continue;
            const rings = g.rings || g.curveRings; if (!Array.isArray(rings)) continue;

            const raw = ci(f.attributes || {}, 'STATION');
            const st = (String(raw).toUpperCase() === '1CH') ? '1CH' : (Number.isFinite(+raw) ? +raw : raw);
            const style = styleForStation(st); if (!style) continue;

            const latlng = rings.map(r => r.map(pt => pt2ll(pt, wkid)).filter(Boolean)).filter(r => r.length >= 3);
            if (!latlng.length) continue;

            polys.push(
                L.polygon(latlng, style).bindPopup(`
          <div class="layer-badge">${name}</div>
          <b>Station:</b> ${st ?? '—'}<br>
          <b>Area:</b> ${ci(f.attributes, 'Shape__Area', 'Shape_Area') ?? '—'}<br>
          <b>Perimeter:</b> ${ci(f.attributes, 'Shape__Length', 'Shape_Length') ?? '—'}
        `)
            );
        }
        return L.layerGroup(polys);
    }

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

    // Heat
    const HEAT_LEFT = '#f7fbff';
    const HEAT_RIGHT = '#08306b';
    const lerp = (a, b, t) => a + (b - a) * t;
    const hexToRgb = hex => { const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex); return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0]; };
    const rgbToHex = (r, g, b) => { const h = n => ('0' + n.toString(16)).slice(-2); return '#' + h(Math.round(Math.max(0, Math.min(255, r)))) + h(Math.round(Math.max(0, Math.min(255, g)))) + h(Math.round(Math.max(0, Math.min(255, b)))); };
    function rampColor(t) { const a = hexToRgb(HEAT_LEFT), b = hexToRgb(HEAT_RIGHT); return rgbToHex(lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)); }

    function buildHeat_ESRI(features, wkid, name) {
        const vals = features.map(f => Number(ci(f?.attributes || {}, 'Incidents'))).filter(Number.isFinite);
        const min = vals.length ? Math.min(...vals) : 0;
        const max = vals.length ? Math.max(...vals) : 1;
        const span = (max - min) || 1;

        const polys = [];
        for (const f of features) {
            const g = f?.geometry; if (!g) continue;
            const rings = g.rings || g.curveRings; if (!Array.isArray(rings)) continue;

            const v = Number(ci(f.attributes, 'Incidents'));
            const t = Number.isFinite(v) ? Math.max(0, Math.min(1, (v - min) / span)) : 0;
            const style = { color: '#333', weight: 0.4, fillOpacity: 0.55, fillColor: rampColor(t) };

            const latlng = rings.map(r => r.map(pt => pt2ll(pt, wkid)).filter(Boolean)).filter(r => r.length >= 3);
            if (!latlng.length) continue;

            polys.push(
                L.polygon(latlng, style).bindPopup(`
          <div class="layer-badge">${name}</div>
          <b>Incidents:</b> ${Number.isFinite(v) ? v : '—'}<br>
          <b>Area:</b> ${ci(f.attributes, 'Shape__Area', 'Shape_Area') ?? '—'}<br>
          <b>Perimeter:</b> ${ci(f.attributes, 'Shape__Length', 'Shape_Length') ?? '—'}
        `)
            );
        }
        return { layer: L.layerGroup(polys), min, max };
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

    // Points
    function parseStationIdFromName(a) {
        const nm = ci(a, 'LANDMARKNA', 'NAME', 'STATION');
        if (nm) {
            const m = String(nm).match(/(\b1?\d{2,3}\b)/);
            if (m) { const n = Number(m[1]); return Number.isFinite(n) ? n : m[1]; }
        }
        const oid = ci(a, 'OBJECTID', 'FID'); const n = Number(oid);
        return Number.isFinite(n) ? n : (oid ?? null);
    }

    function stylePoint(st) {
        if (st === 113 || st === '113') return null;
        const fill = (COLOR[String(st)] || '#e41a1c');
        return { radius: 6, fillColor: fill, color: '#222', weight: 1, fillOpacity: 0.9 };
    }

    function buildPoints_ESRI(features, wkid, name) {
        const layers = [];
        for (const f of features) {
            const a = f?.attributes || {};
            let latlng = null;

            if (f?.geometry && ('x' in f.geometry) && ('y' in f.geometry)) {
                latlng = pt2ll({ x: f.geometry.x, y: f.geometry.y }, wkid);
            } else {
                const x385 = Number(ci(a, 'CENT_X_385')), y385 = Number(ci(a, 'CENT_Y_385'));
                const x4326 = Number(ci(a, 'CENT_X')), y4326 = Number(ci(a, 'CENT_Y'));
                if (Number.isFinite(x385) && Number.isFinite(y385)) latlng = pt2ll({ x: x385, y: y385 }, 3857);
                else if (Number.isFinite(x4326) && Number.isFinite(y4326)) latlng = [y4326, x4326];
            }
            if (!latlng) continue;

            const st = parseStationIdFromName(a);
            const style = stylePoint(st); if (!style) continue;

            const m = L.circleMarker(latlng, style).bindPopup(`
        <div class="layer-badge">${name}</div>
        <b>Station:</b> ${st ?? '—'}<br>
        <b>Name:</b> ${ci(a, 'LANDMARKNA') ?? '—'}<br>
        <b>Type:</b> ${ci(a, 'LANDMARKTY') ?? '—'}
      `);
            layers.push(m);

            layers.push(L.marker(latlng, {
                icon: L.divIcon({
                    className: 'stn-label',
                    html: `<div style="color:#000;font-weight:bold;text-shadow:1px 1px 2px #fff;font-size:12px;">${st}</div>`,
                    iconAnchor: [-10, -5]
                }),
                interactive: false
            }));
        }
        return L.layerGroup(layers);
    }

    function buildPoints_GeoJSON(fc, name) {
        const group = L.layerGroup();
        L.geoJSON(fc, {
            pointToLayer: (feat, latlng) => {
                const a = feat.properties || {};
                const st = parseStationIdFromName(a);
                const style = stylePoint(st);
                if (!style) return null;
                const marker = L.circleMarker(latlng, style).bindPopup(`
          <div class="layer-badge">${name}</div>
          <b>Station:</b> ${st ?? '—'}<br>
          <b>Name:</b> ${ci(a, 'LANDMARKNA') ?? '—'}
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
                return null;
            }
        });
        return group;
    }

    /* ===================== Config ====================== */
    const SA_LAYERS = [
        { key: 'existing', label: 'Existing Service Areas', url: './data/Existing_Service_Areas.json', stationKeys: ['Low_Hazard1'] },
        { key: 'nfpa', label: 'Optimized NFPA Service Areas', url: './data/Optimized_NFPA_Service_Areas.json', stationKeys: ['Areas', 'Low_Hazard1'] },
        { key: 'aug', label: 'Optimized Augmented Service Areas', url: './data/Optimized_Augmented_Service_Areas.json', stationKeys: ['Low_Hazard1'] },
        { key: 'ful', label: 'Optimized Fulfilled Service Areas', url: './data/Optimized_Fulfilled_Service_Areas.json', stationKeys: ['Low_Hazard1'] },
        { key: 'bmed', label: 'Backups – Medium', url: './data/Service_Areas_Backups_Medium.json', stationKeys: ['Low_Hazard2'] },
        { key: 'bhigh', label: 'Backups – High', url: './data/Service_Areas_Backups_High.json', stationKeys: ['High_Hazard2'] }
    ];

    // Incidents (labels only; directories unchanged)
    const NAME_SPREAD = 'Incidents – Spread';
    const URL_SPREAD = './data/Incidents_Spread.json';

    const NAME_HEAT = 'Incidents – Heat Map';
    const URL_HEAT = './data/Incidents_Heat_Map.json';

    const NAME_POINTS = 'Fire Stations';
    const URL_POINTS = './data/Fire_Stations.json';

    /* ===================== Loaders & ordered rebuild ====================== */
    const overlays = {};

    function rebuildLayersControlInDesiredOrder() {
        if (window.layerControl) {
            try { map.removeControl(window.layerControl); } catch (_) { /* ignore */ }
        }
        const lc = L.control.layers(null, {}, { collapsed: true }).addTo(map);
        window.layerControl = lc;

        const desired = [
            'Fire Stations',
            'Incidents – Spread',
            'Incidents – Heat Map',
            'Optimized Augmented Service Areas',
            'Optimized Fulfilled Service Areas',
            'Optimized NFPA Service Areas',
            'Existing Service Areas',
            'Backups – Medium',
            'Backups – High'
        ];
        for (const name of desired) {
            if (overlays[name]) lc.addOverlay(overlays[name], name);
        }
    }

    // 1) Service areas
    const serviceAreasLoaded = Promise.all(SA_LAYERS.map(async cfg => {
        const raw = await fetchJson(cfg.url);
        const norm = normalizeAny(raw);
        let grp;
        if (norm.kind === 'esri') {
            grp = buildEsriServiceArea(norm.features, norm.wkid, cfg.label, cfg.stationKeys, cfg.key);
        } else if (norm.kind === 'geojson') {
            grp = buildGeoJSONServiceArea({ type: 'FeatureCollection', features: norm.features }, cfg.label, cfg.stationKeys, cfg.key);
        } else {
            throw new Error(`${cfg.label}: unsupported data format`);
        }
        overlays[cfg.label] = grp;
        layerControl.addOverlay(grp, cfg.label); // interim add
        return grp;
    })).then(() => {
        overlays['Existing Service Areas']?.addTo(map);
        const eg = overlays['Existing Service Areas'];
        if (eg) {
            const b = L.featureGroup(eg.getLayers()).getBounds();
            if (b.isValid()) map.fitBounds(b, { padding: [20, 20] });
        }
    }).catch(console.error);

    // 2) Incidents (Spread / Heat / Points)
    const incidentsLoaded = (async () => {
        try {
            const raw = await fetchJson(URL_SPREAD);
            const norm = normalizeAny(raw);
            const spread = (norm.kind === 'geojson')
                ? buildIncidentsSpread_GeoJSON({ type: 'FeatureCollection', features: norm.features }, NAME_SPREAD)
                : buildIncidentsSpread_ESRI(norm.features, norm.wkid, NAME_SPREAD);
            spread.on('add', () => window.__legend.setSectionVisible('spread', true));
            spread.on('remove', () => window.__legend.setSectionVisible('spread', false));
            overlays[NAME_SPREAD] = spread;
            layerControl.addOverlay(spread, NAME_SPREAD);
        } catch (e) { console.error('[Incidents] Spread failed:', e); }

        try {
            const raw = await fetchJson(URL_HEAT);
            const norm = normalizeAny(raw);
            const heatPack = (norm.kind === 'geojson')
                ? buildHeat_GeoJSON({ type: 'FeatureCollection', features: norm.features }, NAME_HEAT)
                : buildHeat_ESRI(norm.features, norm.wkid, NAME_HEAT);
            heatPack.layer.on('add', () => window.__legend.setHeatLegend(true, heatPack.min, heatPack.max));
            heatPack.layer.on('remove', () => window.__legend.setHeatLegend(false, null, null));
            overlays[NAME_HEAT] = heatPack.layer;
            layerControl.addOverlay(heatPack.layer, NAME_HEAT);
        } catch (e) { console.error('[Incidents] Heat failed:', e); }

        try {
            const raw = await fetchJson(URL_POINTS);
            const norm = normalizeAny(raw);
            const pts = (norm.kind === 'geojson')
                ? buildPoints_GeoJSON({ type: 'FeatureCollection', features: norm.features }, NAME_POINTS)
                : buildPoints_ESRI(norm.features, norm.wkid, NAME_POINTS);
            overlays[NAME_POINTS] = pts;
            layerControl.addOverlay(pts, NAME_POINTS);
        } catch (e) { console.error('[Incidents] Points failed:', e); }
    })(); // closes incidentsLoaded IIFE

    // 3) After BOTH loaders finish, rebuild in the requested order
    Promise.all([serviceAreasLoaded, incidentsLoaded]).then(() => {
        rebuildLayersControlInDesiredOrder();
    });

    /* ============================================================
   GROUPED RESPONSE TIME CHART
   ============================================================ */

    // ================== RESPONSE TIME CHART (GROUPED) ==================
    window.addEventListener('load', function () {
        // 1) Check that Chart.js is loaded
        if (typeof Chart === 'undefined') {
            console.error('[RT Chart] Chart.js not loaded. Check <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>.');
            return;
        }

        // 2) Get canvas
        const canvas = document.getElementById('rtChart');
        if (!canvas) {
            console.error('[RT Chart] Canvas with id="rtChart" not found in DOM.');
            return;
        }

        const ctx = canvas.getContext('2d');

        // 3) Data
        const labels = ["NFPA", "Augmented", "Fulfilled"];

        // Existing values (null = NA)
        const existingValues = [
            276,   // NFPA Existing
            629,   // Augmented Existing
            null   // Fulfilled Existing (NA)
        ];

        // Optimized values
        const optimizedValues = [
            230,   // NFPA Optimized
            538,   // Augmented Optimized
            541    // Fulfilled Optimized
        ];

        // 4) Build chart
        new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: "Existing",
                        data: existingValues,
                        borderWidth: 1
                    },
                    {
                        label: "Optimized",
                        data: optimizedValues,
                        borderWidth: 1
                    }
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

    /* ===================== RT Chart toggle control ====================== */
    const rtToggleControl = L.control({ position: 'topleft' });

    rtToggleControl.onAdd = function (map) {
        const container = L.DomUtil.create('div', 'leaflet-bar');

        const button = L.DomUtil.create('a', '', container);
        button.href = '#';
        button.title = 'Toggle response-time chart';
        button.innerHTML = 'RT';
        button.style.width = '30px';
        button.style.textAlign = 'center';
        button.style.lineHeight = '30px';
        button.style.display = 'inline-block';

        // Prevent map from dragging/zooming when interacting with the button
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);

        L.DomEvent.on(button, 'click', function (e) {
            L.DomEvent.preventDefault(e);
            const panel = document.getElementById('rt-chart-container');
            if (!panel) return;

            const isHidden = panel.style.display === 'none';
            panel.style.display = isHidden ? 'block' : 'none';
        });

        return container;
    };

    rtToggleControl.addTo(map);
    });

})(); // closes OUTER file-wrapper IIFE
