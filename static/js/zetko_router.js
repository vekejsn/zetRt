function openInfoPanel(contentHtml) {
    const panel = document.getElementById('info-panel');
    const content = document.getElementById('info-panel-content');
    content.innerHTML = contentHtml;
    panel.style.display = 'block';
}

function closeInfoPanel() {
    document.getElementById('info-panel').style.display = 'none';
    document.getElementById('info-panel-content').innerHTML = '';
    location.hash = '';  // optional: reset hash
}

// Dispatch router based on URL hash
window.addEventListener('hashchange', handleHashRoute);

async function handleHashRoute() {
    const hash = location.hash.slice(1);
    const [type, id] = hash.split('/');

    if (!type || !id) return;

    switch (type) {
        case 'stop':
            await handleStopRoute(id);
            break;
        case 'trip':
            generateTripDetails(id, true);
            break;
        case 'route':
            generateRouteSchedule(id, false);
            break;
    }
}

async function handleStopRoute(id) {
    while (true) {
        try {
            const stops = JSON.parse(localStorage.getItem('zetkoStops'));
            const stop = stops?.features?.find(s => s.properties.id === id);
            if (!stop) {
                console.warn(`Stop with ID ${id} not found in local storage.`);
                await new Promise(resolve => setTimeout(resolve, 1000));
                continue;
            }
            generateArrivals({
                stop_id: stop.properties.id,
                stop_name: stop.properties.name,
                parent_station: stop.properties.parentId
            }, false);
            break;
        } catch (e) {
            console.error('Error fetching stop data:', e);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
}

// Call on first load
window.addEventListener('load', () => {
    handleHashRoute();
});

function goToStop(stop) {
    location.hash = `stop/${stop.stop_id}`;
}

function goToTrip(trip_id) {
    location.hash = `trip/${trip_id}`;
}

function goToRoute(route_id) {
    location.hash = `route/${route_id}`;
}

// Example usage:
// goToStop({ stop_id: '1002' })
// goToTrip('ZET_1234')
// goToRoute('32')

function clearPanel() {
    location.hash = '';
}


// Trigger on document load
window.addEventListener('load', () => {
    handleHashRoute();
});
