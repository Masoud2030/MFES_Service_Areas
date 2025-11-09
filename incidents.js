// incidents.js — GitHub Pages–ready; no custom legend required
(function () {
    'use strict';

    /* ----------------------- Guards ----------------------- */
    if (!window.L) { console.error('[Incidents] Leaflet missing.'); return; }

    function waitFor(fn, timeout = 6000) {
        return new Promise(resolve => {
            const t0 = Date.now();
            (function tick() {
                const v = fn();
                if (v) return resolve(v);
                if (Date.now() - t0 > timeout) return resolve(null);
                setTimeout(tick, 50);
            })();
        });
    }

    /* ----------------------- Config ----------------------- */
    const NAME_SPREAD = 'Incidents – Spread';
    const URL_SPREAD = './data/Incidents_Spread.json';

    const NAME_HEAT = 'Incidents – Heat Map';
    const URL_HEAT = './data/Incidents_Heat_Map.json';

    const NAME_POINTS = 'Fire Stations';
    const URL_POINTS = './data/Fire_Stations.json';

    // Palette from app.js; fallback if not present
    const STATION_IDS = window.STATION_IDS || [101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 114, 115, 116, 117, 118, 119, 120, 121, 122];
    const PALETTE = window.PALETTE || [
        '#8dd3c7', '#ffffb3', '#bebada', '#fb8072', '#80b1d3',
        '#fdb462', '#b3de69', '#fccde5', '#d9d9d9', '#bc80bd',
        '#ccebc5', '#ffed6f', '#1b9e77', '#d95f02', '#7570b3',
        '#e7298a', '#66a61e', '#e6ab02', '#a6761d', '#666666', '#7fc97f'
    ];
    const STN_COLOR = Object.fromEntries(STATION_IDS.map((id, i) => [String(id), PALETTE[i % PALETTE.length]]));
    STN_COLOR['1CH'] = '#17becf'; // pseudo-station (Spread only)

    /* ----------------------- Utils ------------------------ */
    const ci = (o, ...keys) => {
        if (!o) return undefined;
        const m = Object.create(null);
        for (const k of Object.keys(o)) m[k.toLowerCase()] = k;
        for (const k of keys) {
            const real = m[String(k).toLowerCase()];
            if (real !== undefined) return o[real];
        }
    };

    const isWM = w => w === 3857 || w === 102100 || w === 102113;
    const merc2ll = (x, y) => {
        const R = 6378137;
        const lon = (x / R) * 180 / Math.PI;
        const lat = (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI;
        return [lat, lon];
    };
    const pt2ll = (pt, wkid) => {
        if (Array.isArray(pt)) return isWM(wkid) ? merc2ll(pt[0], pt[1]) : [pt[1], pt[0]];
        if (pt && 'x' in pt && 'y' in pt) return isWM(wkid) ? merc2ll(pt.x, pt.y) : [pt.y, pt.x];
        return null;
    };

    async function fetchJson(url) {
        const res = await fetch(url + (url.includes('?') ? '&' : '?') + 'cb=' + Date.now(), { cache: 'no-store' });
        const txt = await res.text();
        if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}\n${txt.slice(0, 200)}`);
        const clean = txt.charCodeAt(0) === 0xFEFF ? txt.slice(1) : txt;
        return JSON.parse(clean);
    }

    // Accepts ESRI JSON (features + spatialReference) or GeoJSON (FeatureCollection)
    function normalizeAny(data) {
        // GeoJSON?
        if (data && data.type === 'FeatureCollection' && Array.isArray(data.features)) {
            return { kind: 'geojson', wkid: 4326, features: data.features };
        }
        // ESRI JSON?
        let wkid = data?.spatialReference?.wkid ?? data?.spatialReference?.latestWkid;
        const features = Array.isArray(data?.features) ? data.features : [];
        if (!wkid && features.length) {
            wkid = features[0]?.geometry?.spatialReference?.wkid
                ?? features[0]?.geometry?.spatialReference?.latestWkid;
        }
        return { kind: 'esri', wkid, features };
    }

    /* ----------------- Styles & Builders ------------------ */
    function styleForStation(st) {
        if (st === 113 || st === '113') return null; // skip
        if (st == null || st === 0 || st === '0') return { color: '#999', weight: 0.8, fillOpacity: 0, fillColor: '#999' };
        return { color: '#333', weight: 0.6, fillOpacity: 0.55, fillColor: (STN_COLOR[String(st)] || '#999') };
    }

    // ---------- SPREAD (polygons) ----------
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
                return style || { opacity: 0, fillOpacity: 0 }; // skip 113 visually
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

    // ---------- HEAT (polygons with continuous fill) ----------
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
        return L.layerGroup(polys);
    }

    function buildHeat_GeoJSON(fc, name) {
        // Derive min/max from properties.Incidents
        const vals = (fc.features || [])
            .map(f => Number(ci(f.properties || {}, 'Incidents')))
            .filter(Number.isFinite);
        const min = vals.length ? Math.min(...vals) : 0;
        const max = vals.length ? Math.max(...vals) : 1;
        const span = (max - min) || 1;

        return L.geoJSON(fc, {
            style: f => {
                const v = Number(ci(f.properties || {}, 'Incidents'));
                const t = Number.isFinite(v) ? Math.max(0, Math.min(1, (v - min) / span)) : 0;
                return { color: '#333', weight: 0.4, fillOpacity: 0.55, fillColor: rampColor(t) };
            },
            onEachFeature: (feat, layer) => {
                const v = Number(ci(feat.properties || {}, 'Incidents'));
                layer.bindPopup(`
          <div class="layer-badge">${name}</div>
          <b>Incidents:</b> ${Number.isFinite(v) ? v : '—'}
        `);
            }
        });
    }

    // ---------- STATION POINTS ----------
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
        const fill = (STN_COLOR[String(st)] || '#e41a1c');
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

            // label near the point
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
                // label
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
                return null; // we've added to group ourselves
            }
        });
        return group;
    }

    /* ---------------------- Loader ------------------------ */
    (async () => {
        const map = await waitFor(() => window.map);
        if (!map) { console.error('[Incidents] Map not found. Ensure app.js loads first.'); return; }

        // Create (or reuse) a Leaflet layer control
        let lc = window.layerControl;
        if (!lc) {
            lc = L.control.layers({}, {}, { collapsed: true }).addTo(map);
            window.layerControl = lc;
        }

        // Spread
        try {
            const raw = await fetchJson(URL_SPREAD);
            const norm = normalizeAny(raw);
            const spread = (norm.kind === 'geojson')
                ? buildIncidentsSpread_GeoJSON({ type: 'FeatureCollection', features: norm.features }, NAME_SPREAD)
                : buildIncidentsSpread_ESRI(norm.features, norm.wkid, NAME_SPREAD);
            lc.addOverlay(spread, NAME_SPREAD);
        } catch (e) { console.error('[Incidents] Spread failed:', e); }

        // Heat
        try {
            const raw = await fetchJson(URL_HEAT);
            const norm = normalizeAny(raw);
            const heat = (norm.kind === 'geojson')
                ? buildHeat_GeoJSON({ type: 'FeatureCollection', features: norm.features }, NAME_HEAT)
                : buildHeat_ESRI(norm.features, norm.wkid, NAME_HEAT);
            lc.addOverlay(heat, NAME_HEAT);
        } catch (e) { console.error('[Incidents] Heat failed:', e); }

        // Points
        try {
            const raw = await fetchJson(URL_POINTS);
            const norm = normalizeAny(raw);
            const pts = (norm.kind === 'geojson')
                ? buildPoints_GeoJSON({ type: 'FeatureCollection', features: norm.features }, NAME_POINTS)
                : buildPoints_ESRI(norm.features, norm.wkid, NAME_POINTS);
            lc.addOverlay(pts, NAME_POINTS);
        } catch (e) { console.error('[Incidents] Points failed:', e); }
    })();
})();
