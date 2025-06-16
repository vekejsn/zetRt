let routes = [];
let expandedRouteGroups = new Set();

async function loadRoutes() {
    routes = await fetch('/routes').then(res => res.json());
}

async function showRouteSchedulePanel(routeId) {
    expandedRouteGroups = new Set();
    const route = routes.find(r => r.routeId == routeId);

    if (!route) {
        openInfoPanel(`<p class="text-red-500">Linija ${routeId} nije pronađena.</p>`);
        return;
    }

    openInfoPanel(`
        <div class="mb-4">
            <h2 class="text-xl font-semibold">
                <span class="badge" style="color: white; background-color: #1264AB; font-weight: bold;">
                    ${route.routeShortName}
                </span> ${route.routeLongName}
            </h2>
            <p class="text-sm text-gray-500">(${route.routeId})</p>
        </div>
        <div class="text-sm text-gray-500">Učitavanje voznog reda...</div>
    `);

    const response = await fetch(`/routes/${routeId}/trips`).then(res => res.json());
    const grouped = response.reduce((acc, cur) => {
        acc[cur.tripHeadsign] = acc[cur.tripHeadsign] || [];
        acc[cur.tripHeadsign].push(cur);
        return acc;
    }, {});

    let content = '';
    for (const direction in grouped) {
        content += `
            <div class="mb-6">
                <h3 class="text-md font-semibold mb-1">${direction}</h3>
                ${renderRouteScheduleTable(grouped[direction])}
            </div>`;
    }

    openInfoPanel(`
        <div class="mb-4">
            <h2 class="text-xl font-semibold">
                <span class="badge" style="color: white; background-color: #1264AB; font-weight: bold;">
                    ${route.routeShortName}
                </span> ${route.routeLongName}
            </h2>
            <p class="text-sm text-gray-500">(${route.routeId})</p>
        </div>
        ${content}
    `);
}

function renderRouteScheduleTable(trips) {
    const groupedByHour = {};

    for (const trip of trips) {
        const time = new Date(trip.startTime * 1000).toISOString().substr(11, 5);
        const hour = time.split(':')[0];
        trip.formattedTime = time;
        groupedByHour[hour] = groupedByHour[hour] || [];
        groupedByHour[hour].push(trip);
    }

    const orderedHours = Object.keys(groupedByHour).sort((a, b) => a - b);
    let html = `<table class="table w-full text-sm"><thead><tr><th class="w-12">h</th><th>Minuti</th></tr></thead><tbody>`;

    for (const hour of orderedHours) {
        html += `<tr><td class="text-right">${hour}</td><td class="flex flex-wrap gap-2">`;

        for (const trip of groupedByHour[hour]) {
            const mins = trip.formattedTime.split(':')[1];
            html += `<span onclick="goToTrip('${trip.tripId}')"
                class="arrivalar cursor-pointer px-1 rounded ${trip.realTime ? 'bg-blue-100 text-blue-800 blinker' : 'bg-gray-100 text-gray-800'}"
                title="VR ${trip.blockId}">
                ${mins}
            </span>`;
        }

        html += `</td></tr>`;
    }

    html += `</tbody></table>`;
    return html;
}

// Helper function to group arrivals by route (added for completeness)
function groupArrivalsByRoute(arrivals) {
    return arrivals.reduce((acc, cur) => {
        const key = cur.tripHeadsign || 'Ostalo';
        acc[key] = acc[key] || [];
        acc[key].push(cur);
        return acc;
    }, {});
}

// Helper function to render a group of arrivals (added for completeness)
function renderRouteGroup(arrivals) {
    if (!arrivals.length) return '';
    const direction = arrivals[0].tripHeadsign || '';
    let html = `<div class="mb-6"><h3 class="text-md font-semibold mb-1">${direction}</h3>`;
    html += renderRouteScheduleTable(arrivals);
    html += `</div>`;
    return html;
}

async function generateRouteArrivals(routeId) {
    expandedRouteGroups = new Set();

    const route = routes.find(r => r.routeId == routeId);

    if (!route || !route.routeId) {
        openInfoPanel(`<p class="text-red-500">Linija ${routeId} nije pronađena.</p>`);
        return;
    }

    openInfoPanel(`
        <div class="mb-4">
            <h2 class="text-xl font-semibold">
                <span class="badge" style="color: white; background-color: #1264AB; font-weight: bold;">
                    ${route.routeShortName}
                </span> ${route.routeLongName}
            </h2>
            <p class="text-sm text-gray-500">(${route.routeId})</p>
            <p class="text-gray-500 mt-2">Učitavanje polazaka...</p>
        </div>
    `);

    const arrivals = await fetch(`/routes/${routeId}/trips?current=true`).then(res => res.json());

    let content = `
        <div class="mb-4">
            <h2 class="text-xl font-semibold">
                <span class="badge" style="color: white; background-color: #1264AB; font-weight: bold;">
                    ${route.routeShortName}
                </span> ${route.routeLongName}
            </h2>
            <p class="text-sm text-gray-500">(${route.routeId})</p>
        </div>
    `;

    if (!arrivals.length) {
        content += `<p class="text-gray-500">Za danas više nema polazaka.</p>`;
    } else {
        const grouped = groupArrivalsByRoute(arrivals);
        for (const groupKey in grouped) {
            content += renderRouteGroup(grouped[groupKey]);
        }
    }

    openInfoPanel(content);
}
