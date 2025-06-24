let currentTripId = null;
let tripRefreshInterval = null;

function getCurrentTimeInSeconds() {
  const now = new Date();
  return now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
}

async function generateTripDetails(tripId, initialRender = true) {
  currentTripId = tripId;
  const trip = await fetch(`/trips/${tripId}`).then(res => res.json());

  const currentTime = getCurrentTimeInSeconds();
  const isLate = (delay) => delay > 60;
  const delayText = (delay) => {
    const min = Math.abs(Math.round(delay / 60));
    return (delay > 0 ? `kasni ${min}` : `rani ${min}`) + " min";
  };

  let vehicleMarker = await map.getSource('vehicles')?._data?.features?.find(f => f.properties.tripId === tripId);
  // if it's not found, wait for 1s and try again
  if (!vehicleMarker && initialRender && !map.getSource('vehicles')) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    vehicleMarker = await map.getSource('vehicles')?._data?.features?.find(f => f.properties.tripId === tripId);
  }
  let locationStatus = '';
  if (trip.realTime && vehicleMarker && !vehicleMarker?.properties?.interpolated) {
    locationStatus = 'Prikazana je stvarna lokacija.';
  } else if (
    (trip.realTime && vehicleMarker && vehicleMarker?.properties?.interpolated) ||
    (!trip.realTime && vehicleMarker && vehicleMarker?.properties?.interpolated)
  ) {
    locationStatus = 'Prikazana je predviđena lokacija.';
  } else if (trip.realTime && !vehicleMarker) {
    locationStatus = 'Lokaciju vozila nije moguće prikazati.';
  }

  console.log(vehicleDetails[trip.vehicleId])

  let content = `
<div class="h-[50vh] md:h-[70vh] flex flex-col"> <!-- Or h-[600px] if not full screen -->
  <div class="flex justify-between items-start mb-2">
    <div>
      <h2 class="text-l font-semibold break-words" onclick="location.hash = '#route/${trip.routeId}';">
        <span class="badge" style="color: white; background-color: #1264AB; font-weight: bold;">
          ${trip.routeShortName}
        </span> → ${trip.tripHeadsign}
        ${trip.realTime ? '<i class="bi bi-broadcast blinker" title="U stvarnom vremenu"></i>' : '<i class="bi bi-clock text-gray-400" title="Po voznom redu"></i>'}
      </h2>
      <p class="text-sm text-gray-500">
        Vozilo: ${trip.vehicleId || '-'} / VR: ${trip.blockId || '-'}<br/>
        ${locationStatus}
        <br/>
        ${vehicleDetails[trip.vehicleId] ?
        `
        ${vehicleDetails[trip.vehicleId].airCondition
            ? `<span style="background:#1264AB; border-radius:50%; padding:2px 6px; display:inline-block;"><i class="bi bi-snow" style="color:white;" title="Klima uređaj"></i></span> `
            : '<span style="background:#DBDBDB; border-radius:50%; padding:2px 6px; display:inline-block;"><i class="bi bi-snow" style="color:white;" title="Nema klima uređaja"></i></span> '
          }
          ${vehicleDetails[trip.vehicleId].accessible
            ? `<span style="background:#1264AB; border-radius:50%; padding:2px 6px; display:inline-block;"><i class="bi bi-person-wheelchair" style="color:white;" title="Pristupačno vozilo"></i></span> `
            : `<span style="background:#DBDBDB; border-radius:50%; padding:2px 6px; display:inline-block;"><i class="bi bi-person-wheelchair" style="color:white;" title="Nije pristupačno vozilo"></i></span> `
          }
          <span class="text-gray-500">${`${vehicleDetails[trip.vehicleId].model.trim()} ${vehicleDetails[trip.vehicleId].registrationNumber ? `(${vehicleDetails[trip.vehicleId].registrationNumber.trim()})` : ''}`.trim()}</span>
          ` : ''
        }
      </p>
    </div>
    <button class="delete" onclick="closeInfoPanel()"></button>
  </div>

  <hr class="mb-4" />

  <!-- This wrapper ensures trip-stop-list fills remaining space -->
  <div class="flex-1 overflow-hidden">
    <div id="trip-stop-list" class="space-y-2 overflow-y-auto h-full pb-6 overflow-x-hidden">
    `;

  let nextStopId = null;

  for (const stop of trip.stopTimes) {
    const dep = stop.departureTime;
    const sched = dep - (stop.departureDelay || 0);
    const delay = stop.departureDelay || 0;
    const passed = currentTime > dep;

    const isDelayed = Math.abs(delay) > 60;
    const isRealtime = stop.realTime;

    if (!passed && !nextStopId) {
      nextStopId = `stop-${stop.stopId}`;
    }

    const stopObj = {
      stop_id: stop.stopId,
      stop_name: stop.stopName,
      parent_station: null
    };

    content += `
      <div id="stop-${stop.stopId}" class="p-3 rounded-lg shadow-md transition cursor-pointer hover:scale-[1.01] ${passed ? 'bg-gray-100 dark:bg-base-300' : 'bg-white dark:bg-base-200'}"
           onclick='location.hash = "#stop/${stop.stopId}";'>
        <div class="flex justify-between items-center">
          <div>
            <p class="font-semibold ${passed ? 'line-through text-gray-500' : ''}">${stop.stopName}</p>
            <p class="text-xs text-gray-500">(${stop.stopId})</p>
          </div>
          <div class="text-right text-sm leading-tight">
            ${isRealtime && !passed
        ? `<i class="bi bi-broadcast blinker" title="Real-time"></i>`
        : `<i class="bi bi-clock text-gray-400" title="Scheduled"></i>`}
            ${isDelayed && !passed ? `<span class="text-gray-400 line-through ml-1">${formatTime(sched)}</span>` : ''}
            <span class="ml-1 font-medium">${formatTime(dep)}</span>
            ${isDelayed && !passed ? `<div class="text-xs ${isLate(delay) ? 'text-red-500' : 'text-yellow-500'}">${delayText(delay)}</div>` : ''}
          </div>
        </div>
      </div>`;
  }

  content += `</div></div>`;

  openInfoPanel(content);

  if (initialRender) {
    // Find vehicle on map
    if (vehicleMarker) {
      const vehicleCoords = vehicleMarker.geometry.coordinates;
      map.flyTo({ center: vehicleCoords, zoom: 16, speed: 3 });
    }
    // Fetch and display vehicle track
    const tripShape = await fetch(`/trips/${tripId}/shape`).then(res => res.json());
    // This is a single feature GeoJSON
    if (tripShape && tripShape.geometry && tripShape.geometry.type === 'LineString') {
      // Depending on route type, set the color
      const routeColor = trip.routeType == 3 ? '#126400' : '#3070A1';
      map.setPaintProperty('trip-shape', 'line-color', routeColor);
      map.getSource('trip-shape').setData({
        type: 'FeatureCollection',
        features: [tripShape]
      });
      map.setLayoutProperty('trip-shape', 'visibility', 'visible');
    }
  }

  if (nextStopId) {
    // Scroll to next stop
    const nextStopElement = document.getElementById(nextStopId);
    if (nextStopElement && initialRender) {
      nextStopElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (nextStopElement) {
      // If not initial render, just ensure it's visible
      nextStopElement.scrollIntoView({ behavior: 'instant', block: 'start' });
    }
  }

  // Clear previous interval
  if (tripRefreshInterval) clearInterval(tripRefreshInterval);

  // Set up periodic update
  tripRefreshInterval = setInterval(async () => {
    if (location.hash !== `#trip/${currentTripId}`) {
      clearInterval(tripRefreshInterval);
      tripRefreshInterval = null;
      return;
    }
    generateTripDetails(currentTripId, false);
  }, 10000);
}
