// Fetch all routes and cache them
async function loadRoutes() {
    routes = await fetch('/routes').then(res => res.json());
}

// Find a route by ID
function getRouteById(routeId) {
    return routes.find(r => r.routeId == routeId);
}

// Render the route header
function renderRouteHeader(route) {
    return `
        <div class="mb-4">
            <h2 class="text-l font-semibold">
                <span class="badge" style="color: white; background-color: #1264AB; font-weight: bold;">
                    ${route.routeShortName}
                </span> ${route.routeLongName}
            </h2>
        </div>
    `;
}

// Render a table of trips grouped by hour
function renderRouteScheduleTable(trips) {
    const groupedByHour = {};

    for (const trip of trips) {
        const midnight = luxon.DateTime.now().setZone('Europe/Zagreb').startOf('day');
        const time = midnight.plus({ seconds: trip.startTime }).toFormat('HH:mm');
        const hour = time.split(':')[0];
        trip.formattedTime = time;
        groupedByHour[hour] = groupedByHour[hour] || [];
        groupedByHour[hour].push(trip);
    }

    const orderedHours = Object.keys(groupedByHour).sort((a, b) => a - b);
    let html = `<table class="table w-full text-sm">
        <thead>
            <tr>
                <th class="w-6 text-right">h</th>
                <th>m<br/><sup>VR</sup><sub>Vozilo</sub></th>
            </tr>
        </thead>
        <tbody>`;

    for (const hour of orderedHours) {
        html += `<tr>
            <td class="text-right text-lg font-semibold w-6">${hour}</td>
            <td class="flex flex-wrap gap-2">`;
        for (const trip of groupedByHour[hour]) {
            const mins = trip.formattedTime.split(':')[1];
            html += `
                <div onclick="goToTrip('${trip.tripId}')"
                    class="arrivalar cursor-pointer flex flex-col items-center justify-center px-1 rounded"
                    title="VR ${trip.blockId}">
                    <div class="flex flex-col justify-center items-center mr-1" style="line-height:1.1;">
                        <span class="text-lg font-semibold ${trip.realTime ? 'blinker' : ''}" style="line-height:1.2;">
                        ${mins}</span>
                    </div>
                    <div class="flex flex-col items-center text-[0.6rem] leading-tight justify-center">
                        <span>VR ${trip.blockId}</span>
                        <span>${trip.vehicleId}</span>
                    </div>
                </div>
            `;
        }
        html += `</td></tr>`;
    }

    html += `</tbody></table>`;
    return html;
}

// Group arrivals by tripHeadsign
async function groupArrivalsByRoute(arrivals) {
    return await arrivals.reduce((acc, cur) => {
        const key = cur.tripHeadsign || 'Nepoznato';
        acc[key] = acc[key] || [];
        acc[key].push(cur);
        return acc;
    }, {});
}

// Generate arrivals for a route
async function generateRouteArrivals(routeId) {
    console.log('Generating arrivals for route:', routeId);
    while (!routes || !routes.length) {
        try {
            await loadRoutes();
            break;
        } catch (e) {
            console.error('Error loading routes:', e);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    const route = getRouteById(routeId);

    if (!route || !route.routeId) {
        openInfoPanel(`<p class="text-red-500">Linija ${routeId} nije pronađena.</p>`);
        return;
    }

    openInfoPanel(`${renderRouteHeader(route)}<p class="text-gray-500 mt-2">Učitavanje polazaka...</p>`);

    const arrivals = await fetch(`/routes/${routeId}/trips`).then(res => res.json());

    let content = `
    <div class="h-[50vh] md:h-[70vh] flex flex-col overflow-hidden">
        ${renderRouteHeader(route)}
        <div id="trip-stop-list" class="flex-1 overflow-y-auto space-y-4 pb-6 mt-2">
    `;
    if (!arrivals.length) {
        content += `<p class="text-gray-500">Za danas više nema polazaka.</p>`;
    } else {
        const grouped = await groupArrivalsByRoute(arrivals);
        for (const groupKey in grouped) {
            content += `
                <div class="mb-6">
                    <h3 class="text-xl font-semibold mb-1">Vozni red za smjer: ${groupKey}</h3>
                    ${renderRouteScheduleTable(grouped[groupKey])}
                </div>
            `;
        }
    }

    openInfoPanel(content);
}
