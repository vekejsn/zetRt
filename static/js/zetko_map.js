let stopsLoaded = false;

const map = new maplibregl.Map({
    container: 'map',
    style: 'json/mapstyle.json',
    center: [15.9775658, 45.812892],
    pitch: 0,
    maxPitch: 60,
    zoom: 13,
    minZoom: 10,
});

var routes = [];
var vehicleDetails = {};

map.addControl(new maplibregl.NavigationControl(), 'top-right');
// Add geolocate control to the map.
map.addControl(
    new maplibregl.GeolocateControl({
        positionOptions: {
            enableHighAccuracy: true
        },
        trackUserLocation: true
    })
);

async function loadRoutes() {
    routes = await fetch('/routes').then(res => res.json());
}

map.on('load', async () => {
    hideTransitLayers();
    await loadRoutes();
    await loadStops();
    setupVehicleSources();
    setupVehicleLayers();
    registerMapEvents();
    updateVehicles();
    setInterval(updateVehicles, 5000);
});

function hideTransitLayers() {
    map.getStyle().layers.forEach(layer => {
        if (layer.id.includes('transit')) {
            map.setLayoutProperty(layer.id, 'visibility', 'none');
        }
    });
}

async function loadStops() {
    if (stopsLoaded) return;
    const stops = JSON.parse(localStorage.getItem('zetkoStops')) || {
        type: 'FeatureCollection',
        features: []
    };

    map.addSource('stops', {
        type: 'geojson',
        data: stops,
        cluster: true,
        clusterMaxZoom: 13,
        clusterRadius: 15
    });
    map.addLayer({
        id: 'stops',
        type: 'symbol',
        source: 'stops',
        minzoom: 14,
        layout: {
            "icon-size": 0.375,
            "text-field": ["step", ["zoom"], "", 17, ["get", "name"]],
            "text-offset": [0, 0.8],
            "text-anchor": "top",
            'icon-allow-overlap': true,
            'text-allow-overlap': true,
            "text-font": [
                "Noto Sans Regular"
            ],
        },
        paint: {
            "text-color": [
                'case',
                ['==', ['get', 'stopType'], "1"], "#3070A1", // Tram
                ['==', ['get', 'stopType'], "2"], '#126400', // Bus
                "#3070A1" // Default color (Tram blue)
            ],
            "text-halo-color": "#ffffff",
            "text-halo-width": 1
        }
    });

    map.loadImage('images/tram.png', (error, image) => {
        if (error) throw error;
        if (!map.hasImage('stop-1')) {
            map.addImage('stop-1', image);
        }
        // Load the stop icon for bus
        map.loadImage('images/bus.png', (error, busImage) => {
            if (error) throw error;
            if (!map.hasImage('stop-2')) {
                map.addImage('stop-2', busImage);
            }
            // read from stopType to determine which icon to use
            map.setLayoutProperty('stops', 'icon-image', [
                'case',
                ['==', ['get', 'stopType'], "1"], 'stop-1', // Tram
                ['==', ['get', 'stopType'], "2"], 'stop-2', // Bus
                'stop-2' // Default to tram icon
            ]);
        });
    });

    const stopData = await fetch('/stops').then(res => res.json());
    map.getSource('stops').setData(stopData);
    localStorage.setItem('zetkoStops', JSON.stringify(stopData));
    stopsLoaded = true;
}

function setupVehicleSources() {
    map.addSource('vehicles', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        cluster: false
    });

    map.on('styleimagemissing', async e => {
        const id = e.id;
        if (!id.endsWith('-bg') && !id.endsWith('-fg')) return;

        const [routeShortName, routeTypeStr, realTimeStr] = id.split('-');
        const routeType = parseInt(routeTypeStr, 10);
        const realTime = realTimeStr === 'true';

        let color = '#121212';
        if (routeType == 3) {
            color = realTime ? '#126400' : '#727272'; // Green for bus
        } else if (routeType == 0) {
            color = realTime ? '#1264AB' : '#535353'; // Blue for tram
        }

        const imageData = id.endsWith('-bg')
            ? await generateVehicleBgMarker(color)
            : await generateVehicleFgMarker(color, 'white', routeShortName);

        if (map.hasImage(id)) {
            return;
        }
        map.addImage(id, { width: id.endsWith('-bg') ? 64 : 42, height: id.endsWith('-bg') ? 64 : 42, data: imageData });
    });
}

function setupVehicleLayers() {
    map.addSource('trip-shape', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
    });
    map.addLayer({
        id: 'trip-shape',
        type: 'line',
        source: 'trip-shape',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#1264AB', 'line-width': 6, 'line-opacity': 0.75 }
    });

    ['bg', 'fg'].forEach(suffix => {
        map.addLayer({
            id: `vehicles-${suffix}`,
            type: 'symbol',
            source: 'vehicles',
            layout: {
                'icon-image': [
                    'concat',
                    ['get', 'routeShortName'], '-',
                    ['get', 'routeType'], '-',
                    ['to-string', ['get', 'realTime']],
                    `-${suffix}`
                ],
                "text-font": [
                    "Noto Sans Regular"
                ],
                'icon-size': 0.65,
                'icon-allow-overlap': true,
                'text-allow-overlap': true,
                'symbol-sort-key': ['*', ['get', 'id'], 2],
                'symbol-z-order': suffix === 'bg' ? 'auto' : 'source',
                ...(suffix === 'bg' && { 'icon-ignore-placement': true, 'icon-rotation-alignment': 'map', 'icon-rotate': ['get', 'bearing'] })
            }
        });
    });
    // Force the stops layer to be below the trip shapes
    map.moveLayer('stops', 'trip-shape');

    map.addLayer({
        id: 'vehicle-details',
        type: 'symbol',
        source: 'vehicles',
        minzoom: 15,
        layout: {
            'text-field': [
                'concat',
                ['literal', 'VR: '], ['get', 'blockId'],
                ['literal', '\nGB: '], ['get', 'vehicleId']
            ],
            "text-font": [
                "Noto Sans Regular"
            ],
            'text-size': 12,
            'text-anchor': 'left',
            'text-offset': [2, 0],
            'text-justify': 'left',
            'symbol-z-order': 'source',
            'icon-allow-overlap': true,
            'text-allow-overlap': true
        },
        paint: {
            'text-color': '#000',
            'text-halo-color': '#fff',
            'text-halo-width': 12
        }
    });

    map.moveLayer('stops', 'vehicles-bg');
}

function registerMapEvents() {
    ['stops', 'vehicles-fg', 'vehicles-bg'].forEach(layer => {
        map.on('click', layer, onFeatureClick);
        map.on('mouseenter', layer, () => map.getCanvas().style.cursor = 'pointer');
        map.on('mouseleave', layer, () => map.getCanvas().style.cursor = '');
    });
}

function onFeatureClick(e) {
    const feature = e.features[0];
    if (!feature.properties) return;
    switch (feature.source) {
        case 'stops':
            location.hash = `stop/${feature.properties.id}`;
            break;
        case 'vehicles':
            location.hash = `trip/${feature.properties.tripId}`;
            break;
        default:
            console.warn('Unknown feature source:', feature.source);
    }
}

function generateVehicleBgMarker(color) {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');

    const center = canvas.width / 2;
    const arrowHeight = 20;
    ctx.fillStyle = darkenColor(color, 0.8);
    ctx.beginPath();
    ctx.moveTo(center, 0);
    ctx.lineTo(center - 18, arrowHeight);
    ctx.lineTo(center + 18, arrowHeight);
    ctx.closePath();
    ctx.fill();

    return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
}

async function generateVehicleFgMarker(bg, fg, text) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 42;
    const ctx = canvas.getContext('2d');
    const center = 21;

    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(center, center, 20, 0, Math.PI * 2);
    ctx.fill();

    ctx.lineWidth = 2;
    ctx.strokeStyle = darkenColor(bg, 0.8);
    ctx.stroke();

    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    await Promise.all([
        document.fonts.load('bold 24px "Noto Sans"'),
        document.fonts.load('bold 20px "Noto Sans"'),
        document.fonts.load('bold 18px "Noto Sans"')
    ]);

    ctx.font = text.length > 3 ? 'bold 18px Noto Sans, sans-serif' : text.length > 2 ? 'bold 20px Noto Sans, sans-serif' : 'bold 24px Noto Sans, sans-serif';
    ctx.fillText(text, center, center);

    return ctx.getImageData(0, 0, 42, 42).data;
}

function darkenColor(hex, factor = 0.8) {
    const r = Math.floor(parseInt(hex.slice(1, 3), 16) * factor);
    const g = Math.floor(parseInt(hex.slice(3, 5), 16) * factor);
    const b = Math.floor(parseInt(hex.slice(5, 7), 16) * factor);
    return `rgb(${r},${g},${b})`;
}

async function updateVehicles() {
    const response = await fetch('/vehicles/locations')
        .then(res => res.json());

    response.features.forEach(f => {
        f.properties.blockId = f.properties.tripId.split('_')[2];
    });

    map.getSource('vehicles').setData({
        type: 'FeatureCollection',
        features: response.features
    });
}

function formatTime(unixTimestamp) {
    const date = new Date(unixTimestamp * 1000);
    return date.toISOString().substr(11, 5);  // HH:MM
}

function getVehicleData() {
    // load vehicle data from the server and store in localStorage
    vehicleDetails = JSON.parse(localStorage.getItem('zetkoVehicles')) || {};
    return fetch('https://cors.proxy.prometko.si/https://gitlab.com/api/v4/projects/vekejsn%2Fvoznipark-data/packages/generic/zet-vehicles/latest/zet/output.json')
        .then(res => res.json())
        .then(async data => {
            dict_data = {}
            for (let vehicle of data) {
                dict_data[vehicle.internalNo] = vehicle;
            }
            localStorage.setItem('zetkoVehicles', JSON.stringify(dict_data));
            return dict_data;
        })
        .catch(err => {
            console.error('Error loading vehicle data:', err);
            return JSON.parse(localStorage.getItem('zetkoVehicles')) || {};
        });
}

getVehicleData()
