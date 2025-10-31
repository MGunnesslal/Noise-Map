// Initialize the Leaflet map - MEEP MEEP :)
const map = L.map('map', {
  zoomControl: true,
});

// === Basemaps (Esristreet and Google [openstreetmap was considered but ran into some render issues that I didn't want to spend extra time sorting out) ===
const esriStreets = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 18, //above this number causes render issues with the esristreet
  attribution: 'Tiles &copy; Esri — Source: Esri, HERE, Garmin, FAO, NOAA, USGS, © OpenStreetMap contributors, and the GIS User Community'
}).addTo(map);

  const esriImagery = L.tileLayer('https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
    attribution: 'Google', // need to figure out the proper attribution to allow for imagery date display etc.
    maxZoom: 20 
  });

// Initial view — centered roughly on Trinidad & Tobago (should be good enough for our Noise Purposes)
map.setView([10.5, -61.3], 10);

// Scale bar (this will be used for alot of the functions including the buffers to be added)
L.control.scale({ imperial: false }).addTo(map);

// Ensure proper sizing on load/resize
const invalidate = () => map.invalidateSize();
window.addEventListener('load', invalidate);
window.addEventListener('resize', invalidate);

let searchMarker = null;

function clearGeocoderResult(geocoderInputEl) {
  if (searchMarker) {
    map.removeLayer(searchMarker);
    searchMarker = null;
  }
  map.closePopup();

  if (geocoderInputEl) geocoderInputEl.value = '';

  if (geocoder && geocoder._results && geocoder._results.style) {
    geocoder._results.style.display = 'none';
  }
}

// ---- Basemap toggle button (top-right personal preference but can be moved) ----
let currentBase = 'streets'; // default is esristreets but this is my pesonal preference

function toggleBase(buttonEl) {
  if (currentBase === 'streets') {
    map.removeLayer(esriStreets);
    esriImagery.addTo(map);
    currentBase = 'imagery';
    if (buttonEl) buttonEl.textContent = 'Streets';
  } else {
    map.removeLayer(esriImagery);
    esriStreets.addTo(map);
    currentBase = 'streets';
    if (buttonEl) buttonEl.textContent = 'Satellite';
  }
}

// Custom Leaflet control for switching basemap
const BaseSwitcher = L.Control.extend({
  options: { position: 'topright' },
  onAdd: function () {
    const container = L.DomUtil.create('div', 'leaflet-control basemap-toggle');
    const btn = L.DomUtil.create('button', 'basemap-btn', container);
    btn.type = 'button';
    btn.title = 'Switch base layer: Streets ↔ Satellite';
    btn.setAttribute('aria-label', 'Switch base layer');
    btn.textContent = 'Satellite'; // shows the *next* layer you can switch to

// Prevent map drag/zoom when clicking the button
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.on(btn, 'click', function (e) {
      L.DomEvent.stop(e);
      toggleBase(btn);
    });

    return container;
  }
});

const SHEET_URLS = [
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSBI-NgdiQKH_HxbEl9ej74hF79sXYflXnSmgi2E9vR27v06cC2WjPqv_Ofkm9Faj9KeqGLM_eijfik/pub?output=csv",
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vS1PgZnGD-BtF4dIkKCc3fWxGSYWzl8I9OrOJoMdDwJaUI9gdXrdTUON2f357oiKF4NGAOIo-bsiIK0/pub?output=csv",
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vR5srTByQSZu7tQIhE04ZqH-EAK7PC-ZmIj6GhBscK6zFZbyrpjlnGbijXONBubkmjFLKfhocdJc8Bc/pub?output=csv"
];

const EPSG32620 =
  "+proj=utm +zone=20 +datum=WGS84 +units=m +no_defs +type=crs";

function utm32620ToLatLng(easting, northing) {
  // proj4 returns [lng, lat]
  const [lng, lat] = proj4(EPSG32620, "EPSG:4326", [easting, northing]);
  return { lat, lng };
}

const clusterLayer = L.markerClusterGroup({
  // You can tune these if needed:
  // maxClusterRadius: 80,
  // disableClusteringAtZoom: 18,
});
map.addLayer(clusterLayer);

function renderFeaturesToMap(featureList) {
  clusterLayer.clearLayers();

  featureList.forEach(f => {
    if (!Number.isFinite(f.lat) || !Number.isFinite(f.lng)) return;

    const marker = makeCircleMarker(f.lat, f.lng, f.determination)
      .bindPopup(popupHtmlForFeature(f));

    // attach data for future searches (like radius query)
    marker.featureData = f;

    clusterLayer.addLayer(marker);
  });
}

/****************************************************
 * DATA LOADING AND MERGING FROM GOOGLE SHEETS
 ****************************************************/

let allDataRows = [];

function loadSheet(url) {
  return new Promise((resolve, reject) => {
    Papa.parse(url, {
      download: true,
      header: true,     
      dynamicTyping: false,
      complete: function (results) {
        // Filter out totally empty rows that the PapaParse function can produce at the end.
        const rows = results.data.filter(
          r => r["Easting"] && r["Northing"]
        );
        resolve(rows);
      },
      error: function (err) {
        reject(err);
      }
    });
  });
}

/*
 Load ALL sheets, merge, store in allDataRows
 */
async function loadAllSheets() {
  const promises = SHEET_URLS.map(u => loadSheet(u));
  const sheetsArrays = await Promise.all(promises);

  // Flatten the array-of-arrays into one array
  allDataRows = sheetsArrays.flat();

  console.log("Loaded rows:", allDataRows.length, allDataRows);
}

function normalizeRow(row) {
  const easting = parseFloat(row["Easting"]);
  const northing = parseFloat(row["Northing"]);

  if (!Number.isFinite(easting) || !Number.isFinite(northing)) {
    return null;
  }

  const { lat, lng } = utm32620ToLatLng(easting, northing);

  return {
    lat,
    lng,
    easting,
    northing,

    reference: row["Reference No."],
    year: row["Year"],
    applicant: row["Applicant"],
    eventLocation: row["Event Location"],
    description: row["Event Description"],
    startDate: row["Start date"],
    endDate: row["End date"],
    startTime: row["Start time"],
    endTime: row["End time"],
    host: row["Host"],
    vrType: row["VR type"],
    determination: row["Determination"]
  };
}

function buildFeatures() {
  const features = [];

  allDataRows.forEach((row) => {
    const f = normalizeRow(row);
    if (f) features.push(f);
  });

  return features;
}

//-----------------------------------------------------------------------------------------
//-----------------------------------------------------------------------------------------
async function initDataPipeline() {
  await loadAllSheets();

  const features = buildFeatures();

  console.log("Features ready for map:", features);

}

initDataPipeline();

//-----------------------------------------------------------------------------------------
//-----------------------------------------------------------------------------------------

function colorForDetermination(det) {
  if (!det) return "#ff8c00"; // fallback orange
  const d = det.toLowerCase().trim();

  if (d === "issued")   return "#1dbb3b"; // green
  if (d === "pending")  return "#ffd500"; // yellow
  if (d === "cancelled")return "#9e9e9e"; // grey
  if (d === "refused")  return "#ff2b2b"; // red

  return "#ff8c00";      // orange default for any determination status not defined
}

function makeCircleMarker(lat, lng, determination) {
  const fill = colorForDetermination(determination);

  return L.circleMarker([lat, lng], {
    radius: 7,
    color: "#000000",
    weight: 1,
    fillColor: fill,
    fillOpacity: 0.9
  });
}

function popupHtmlForFeature(f) {
  return `
    <div style="font-size:13px; line-height:1.4;">
      <div><strong>${f.reference || "No Ref"}</strong></div>
      <div><strong>Description:</strong> ${f.description || ""}</div>
      <div><strong>Location:</strong> ${f.eventLocation || ""}</div>
      <div><strong>Applicant:</strong> ${f.applicant || ""}</div>
      <div><strong>Host:</strong> ${f.host || ""}</div>
      <div><strong>VR type:</strong> ${f.vrType || ""}</div>
      <div><strong>Determination:</strong> ${f.determination || ""}</div>
      <div><strong>Start:</strong> ${f.startDate || ""} ${f.startTime || ""}</div>
      <div><strong>End:</strong> ${f.endDate || ""} ${f.endTime || ""}</div>
      <div><strong>UTM (E,N):</strong> ${f.easting}, ${f.northing}</div>
    </div>
  `;
}

function parseDateSmart(str) {
  if (!str) return null;

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str.trim());
  if (isoMatch) {
    const [_, y, m, d] = isoMatch;
    return new Date(+y, +m - 1, +d);
  }

  const dmyMatch = /^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/.exec(str.trim());
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const monStr = dmyMatch[2].toLowerCase();
    const yr2 = parseInt(dmyMatch[3], 10);

    const MONTHS = {
      jan:0,feb:1,mar:2,apr:3,may:4,jun:5,
      jul:6,aug:7,sep:8,oct:9,nov:10,dec:11
    };
    const month = MONTHS[monStr];

    let fullYear;
    if (yr2 <= 79) {
      fullYear = 2000 + yr2;
    } else {
      fullYear = 1900 + yr2;
    }

    if (month !== undefined) {
      return new Date(fullYear, month, day);
    }
  }

  const fallback = new Date(str);
  return isNaN(fallback.getTime()) ? null : fallback;
}

function buildFilterCheckboxes(features) {

  const determinations = [...new Set(
    features.map(f => (f.determination || "").trim()).filter(x => x !== "")
  )].sort((a,b)=>a.localeCompare(b));

  const vrtypes = [...new Set(
    features.map(f => (f.vrType || "").trim()).filter(x => x !== "")
  )].sort((a,b)=>a.localeCompare(b));

  const detContainer = document.getElementById("filter-determination");
  const vrContainer  = document.getElementById("filter-vrtype");

  detContainer.innerHTML = "";
  determinations.forEach(det => {
    const id = "det-" + det.replace(/\W+/g,"_");
    detContainer.innerHTML += `
      <label style="display:flex;align-items:center;gap:6px;">
        <input type="checkbox" id="${id}" data-det="${det}" checked>
        <span>${det}</span>
      </label>`;
  });

  vrContainer.innerHTML = "";
  vrtypes.forEach(vr => {
    const id = "vr-" + vr.replace(/\W+/g,"_");
    vrContainer.innerHTML += `
      <label style="display:flex;align-items:center;gap:6px;">
        <input type="checkbox" id="${id}" data-vrtype="${vr}" checked>
        <span>${vr}</span>
      </label>`;
  });
}

function getFilteredFeatures(allFeats) {

  const startInput = document.getElementById("filter-date-start").value;
  const endInput   = document.getElementById("filter-date-end").value;

  const startDateFilter = startInput ? new Date(startInput + "T00:00:00") : null;
  const endDateFilter   = endInput   ? new Date(endInput   + "T23:59:59") : null;

  const detChecked = Array.from(
    document.querySelectorAll('#filter-determination input[type=checkbox]')
  ).filter(cb => cb.checked)
   .map(cb => cb.getAttribute("data-det"));

  const vrChecked = Array.from(
    document.querySelectorAll('#filter-vrtype input[type=checkbox]')
  ).filter(cb => cb.checked)
   .map(cb => cb.getAttribute("data-vrtype"));

  return allFeats.filter(f => {

    const rowDate = parseDateSmart(f.startDate);

    if (startDateFilter && rowDate && rowDate < startDateFilter) {
      return false;
    }
    if (endDateFilter && rowDate && rowDate > endDateFilter) {
      return false;
    }

    if (detChecked.length > 0) {
      if (!detChecked.includes((f.determination || "").trim())) {
        return false;
      }
    }

    if (vrChecked.length > 0) {
      if (!vrChecked.includes((f.vrType || "").trim())) {
        return false;
      }
    }

    return true;
  });
}

function hookMainFilterButton(allFeats) {
  const btn = document.getElementById("apply-main-filters");
  btn.addEventListener("click", () => {
    const filtered = getFilteredFeatures(allFeats);
    renderFeaturesToMap(filtered);
  });
}

function clearAllFiltersAndReset(allFeats) {
  document.getElementById("filter-date-start").value = "";
  document.getElementById("filter-date-end").value = "";

  document.querySelectorAll('#filter-determination input[type=checkbox]')
    .forEach(cb => { cb.checked = true; });

  document.querySelectorAll('#filter-vrtype input[type=checkbox]')
    .forEach(cb => { cb.checked = true; });

  renderFeaturesToMap(allFeats);
}

function hookMainFilterButton(allFeats) {
  const applyBtn = document.getElementById("apply-main-filters");
  applyBtn.addEventListener("click", () => {
    const filtered = getFilteredFeatures(allFeats);
    renderFeaturesToMap(filtered);
  });

  const clearBtn = document.getElementById("clear-main-filters");
  clearBtn.addEventListener("click", () => {
    clearAllFiltersAndReset(allFeats);
  });
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = deg => deg * Math.PI/180;
  const dLat = toRad(lat2-lat1);
  const dLon = toRad(lon2-lon1);
  const a = Math.sin(dLat/2)**2 +
            Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*
            Math.sin(dLon/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function runReferenceSearch(allFeats) {
  const refInput = document.getElementById("ref-search-input");
  const refValRaw = (refInput.value || "").trim().toLowerCase();
  if (!refValRaw) {
    alert("Please enter a Reference No.");
    return;
  }

  const mainFeature = allFeats.find(f =>
    (f.reference || "").trim().toLowerCase() === refValRaw
  );

  if (!mainFeature) {
    alert("Reference not found.");
    return;
  }

  const baseLat = mainFeature.lat;
  const baseLng = mainFeature.lng;
  const baseDate = parseDateSmart(mainFeature.startDate);
  if (!baseDate || !Number.isFinite(baseLat) || !Number.isFinite(baseLng)) {
    alert("Selected reference is missing date or coordinates.");
    return;
  }

  const MS_PER_DAY = 24*60*60*1000;
  const windowStart = new Date(baseDate.getTime() - 14*MS_PER_DAY);
  const windowEnd   = new Date(baseDate.getTime() + 14*MS_PER_DAY);

  const related = allFeats.filter(f => {
    if (f === mainFeature) return false;

    const d = parseDateSmart(f.startDate);
    if (!d) return false;
    if (d < windowStart || d > windowEnd) return false;

    if (!Number.isFinite(f.lat) || !Number.isFinite(f.lng)) return false;
    const distKm = haversineKm(baseLat, baseLng, f.lat, f.lng);
    if (distKm > 1.0) return false;

    return true;
  });

  const resultForMap = [mainFeature, ...related];
  renderFeaturesToMap(resultForMap);

  if (resultForMap.length > 0) {
    map.fitBounds(L.latLngBounds(resultForMap.map(r => [r.lat, r.lng])), {
      maxZoom: 18,
      padding: [20,20]
    });
  }

  renderRefTablePreview(mainFeature, related);

  lastRefSearch = { mainFeature, related };
}

let lastRefSearch = { mainFeature: null, related: [] };

function renderRefTablePreview(mainFeature, relatedList) {
  const div = document.getElementById("ref-results-table");

  function rowHtml(f) {
    return `
      <tr>
        <td>${f.reference || ""}</td>
        <td>${f.eventLocation || ""}</td>
        <td>${f.startDate || ""} ${f.startTime || ""}</td>
        <td>${f.vrType || ""}</td>
        <td>${f.determination || ""}</td>
        <td>${f.description || ""}</td>
      </tr>
    `;
  }

  div.innerHTML = `
    <table style="width:100%; border-collapse:collapse;">
      <thead style="position:sticky; top:0; background:#f8f8f8;">
        <tr>
          <th style="border-bottom:1px solid var(--border); text-align:left; padding:4px;">Ref</th>
          <th style="border-bottom:1px solid var(--border); text-align:left; padding:4px;">Loc</th>
          <th style="border-bottom:1px solid var(--border); text-align:left; padding:4px;">Start</th>
          <th style="border-bottom:1px solid var(--border); text-align:left; padding:4px;">VR</th>
          <th style="border-bottom:1px solid var(--border); text-align:left; padding:4px;">Det.</th>
          <th style="border-bottom:1px solid var(--border); text-align:left; padding:4px;">Desc</th>
        </tr>
      </thead>
      <tbody>
        ${rowHtml(mainFeature)}
        ${relatedList.map(r => rowHtml(r)).join("")}
      </tbody>
    </table>
  `;
}

function openFullDetailsModal() {
  const { mainFeature, related } = lastRefSearch;
  if (!mainFeature) {
    return;
  }

  const allRows = related;
  if (!allRows || allRows.length === 0) {
    return;
  }

  const tableRows = allRows.map(f => `
    <tr>
      <td>${f.reference || ""}</td>
      <td>${f.startDate || ""} ${f.startTime || ""}</td>
      <td>${f.endDate || ""} ${f.endTime || ""}</td>
      <td>${f.vrType || ""}</td>
      <td>${f.determination || ""}</td>
      <td>${f.applicant || ""}</td>
      <td>${f.host || ""}</td>
      <td>${f.eventLocation || ""}</td>
      <td>${f.description || ""}</td>
      <td>${f.easting}, ${f.northing}</td>
    </tr>
  `).join("");

  const modalHtml = `
    <div id="refModalBackdrop"></div>
    <div id="refModal">
      <div class="refModalHeader">
        <div class="refModalTitle">
          Related Events (14 calendar days / 1 km)
        </div>
        <button id="refModalClose" class="refModalCloseBtn">Close</button>
      </div>

      <div class="refModalTableWrapper">
        <table class="refModalTable">
          <thead>
            <tr>
              <th>Ref</th>
              <th>Start</th>
              <th>End</th>
              <th>VR Type</th>
              <th>Determination</th>
              <th>Applicant</th>
              <th>Host</th>
              <th>Location</th>
              <th>Description</th>
              <th>UTM (E,N)</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
      </div>
    </div>
  `;

  // nuke any existing modal instance first
  closeFullDetailsModal();

  const wrapper = document.createElement("div");
  wrapper.setAttribute("id", "refModalWrapper");
  wrapper.innerHTML = modalHtml;
  document.body.appendChild(wrapper);

  // hook up close behavior
  document.getElementById("refModalClose").addEventListener("click", closeFullDetailsModal);
  document.getElementById("refModalBackdrop").addEventListener("click", closeFullDetailsModal);
}

function closeFullDetailsModal() {
  const w = document.getElementById("refModalWrapper");
  if (w) w.remove();
}

function hookRefSearchButtons(allFeats) {
  const runBtn = document.getElementById("run-ref-search");
  runBtn.addEventListener("click", () => runReferenceSearch(allFeats));

  const openBtn = document.getElementById("open-ref-details");
  openBtn.addEventListener("click", () => openFullDetailsModal());
}

async function initDataPipeline() {
  await loadAllSheets();
  const features = buildFeatures();

  console.log("Features ready for map:", features);

  buildFilterCheckboxes(features);

  hookMainFilterButton(features);

  hookRefSearchButtons(features);

  renderFeaturesToMap(features);

  if (features.length > 0) {
    map.fitBounds(L.latLngBounds(
      features
        .filter(f => Number.isFinite(f.lat) && Number.isFinite(f.lng))
        .map(f => [f.lat, f.lng])
    ), { padding: [20,20] });
  }
}

initDataPipeline();


// ---- OpenStreetMap Geocoder i.e. location finder and behaviours(restricted to T&T) ----
const TT_BBOX = [-61.95, 10.0, -60.5, 11.5];
const geocoder = L.Control.geocoder({
  defaultMarkGeocode: false,
  geocoder: L.Control.Geocoder.nominatim({
    geocodingQueryParams: {
      countrycodes: 'tt',
      viewbox: `${TT_BBOX[0]},${TT_BBOX[3]},${TT_BBOX[2]},${TT_BBOX[1]}`,
      bounded: 1
    }
  })
})
.on('markgeocode', e => {
  const { center, bbox, name } = e.geocode;

  if (searchMarker) {
    map.removeLayer(searchMarker);
  }

  searchMarker = L.marker(center).addTo(map).bindPopup(`<strong>${name}</strong>`).openPopup();

  map.fitBounds(bbox);
})

.addTo(map);

const geocoderContainer = geocoder._container;
const geocoderInput = geocoderContainer.querySelector('.leaflet-control-geocoder-form input');

if (geocoderInput) {
  geocoderInput.setAttribute('type', 'search');
  geocoderInput.setAttribute('placeholder', 'Search for a place...');

  geocoderInput.addEventListener('search', () => {
    if (geocoderInput.value === '') {
      clearGeocoderResult(geocoderInput);
    }
  });

  geocoderInput.addEventListener('input', () => {
    if (geocoderInput.value.trim() === '') {
      clearGeocoderResult(geocoderInput);
    }
  });
}

const customClearBtn = document.createElement('button');
customClearBtn.type = 'button';
customClearBtn.className = 'geocoder-clear-btn';
customClearBtn.setAttribute('aria-label', 'Clear search and remove marker');
customClearBtn.textContent = '×';

const formEl = geocoderContainer.querySelector('.leaflet-control-geocoder-form');
if (formEl) {
  formEl.style.position = 'relative'; 
  formEl.appendChild(customClearBtn);
  customClearBtn.addEventListener('click', (e) => {
    e.preventDefault();
    clearGeocoderResult(geocoderInput);
    geocoderInput.focus();
  });
}

map.addControl(new BaseSwitcher());

/**********************
 * INSET MAP SECTION
 **********************/

// Helper function to ensure location sqaure does not zoom in too much.
function boundsAtZoom(center, zoom) {
  const size = map.getSize();              
  const half = size.divideBy(2);          
  const centerPx = map.project(center, zoom);
  const sw = map.unproject(centerPx.subtract(half), zoom);  
  const ne = map.unproject(centerPx.add(half), zoom);      
  return L.latLngBounds(sw, ne);
}

//boundaries when Trinidad is displayed
const BOUNDS_TRINIDAD = L.latLngBounds(
  [9.95, -61.95],  
  [10.95, -60.45]   
);

//boundaries when Tobago is displayed
const BOUNDS_TOBAGO = L.latLngBounds(
  [11.05, -60.95],  
  [11.40, -60.40]   
);

//Leaflet control for the inset map in a widget-style.
const InsetControl = L.Control.extend({
  options: { position: 'bottomright' },

  onAdd: function () {
    const container = L.DomUtil.create('div', 'inset-container leaflet-bar');
    container.innerHTML = '<div id="insetMap" class="inset-map"></div>';

    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);

    return container;
  },

  onRemove: function () {

  }
});

map.addControl(new InsetControl());

//Inset map behaviours
const insetMap = L.map('insetMap', {
  attributionControl: false,
  zoomControl: false,
  dragging: false,
  scrollWheelZoom: false,
  touchZoom: false,
  doubleClickZoom: false,
  boxZoom: false,
  keyboard: false,
  zoomSnap: 0,
  inertia: false,
});

// Inset map basemap (greymap similar to Esri grey maps)
const insetTiles = L.tileLayer(
  'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',
  { subdomains: 'abcd', maxZoom: 19 }
).addTo(insetMap);

//code for the red square around the map view area
const viewRect = L.rectangle(map.getBounds(), {
  color: 'red',
  weight: 2,
  fill: false,
  className: 'inset-viewport-rect'
}).addTo(insetMap);

//Code for determining which of the islands are displayed
function islandForCenter(centerLatLng) {
  return BOUNDS_TOBAGO.contains(centerLatLng) ? 'TOBAGO' : 'TRINIDAD';
}

//code for inset map live updating
function updateInset() {
  const center = map.getCenter();
  const currentZoom = map.getZoom();

  const island = islandForCenter(center);
  const targetBounds = island === 'TOBAGO' ? BOUNDS_TOBAGO : BOUNDS_TRINIDAD;

  insetMap.fitBounds(targetBounds, { animate: false, padding: [0, 0] });

  // To determine the rectangle to draw (more than 14 looks too small)
  let rectBounds;
  if (currentZoom <= 14) {
    rectBounds = map.getBounds();
  } else {
    rectBounds = boundsAtZoom(center, 14);
  }

  viewRect.setBounds(rectBounds);
}

map.whenReady(updateInset);
map.on('moveend zoomend', updateInset);

