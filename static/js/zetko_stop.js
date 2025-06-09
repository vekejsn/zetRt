const expandedRouteGroups = new Set();
const savedStops = new Set(JSON.parse(localStorage.getItem('savedStops') || '[]'));

function saveSavedStops() {
    localStorage.setItem('savedStops', JSON.stringify([...savedStops]));
}


function groupArrivalsByRoute(arrivals) {
    const groups = {};
    for (const a of arrivals) {
        const key = a.routeId + a.tripHeadsign;
        groups[key] = groups[key] || [];
        groups[key].push(a);
    }
    return groups;
}

function renderArrivalCard(arr, onClick) {
    const time = formatTime(arr.departureTime);
    const original = formatTime(arr.departureTime - (arr.departureDelay || 0));
    const late = original !== time;
    const realTimeIcon = arr.realTime
        ? `<i class="bi bi-broadcast blinker mr-1" title="Real-time"></i>`
        : `<i class="bi bi-clock mr-1" title="Scheduled"></i>`;

    return `
    <div onclick="${onClick}"
         class="cursor-pointer transition transform hover:scale-105 bg-white dark:bg-base-200 rounded-lg shadow-md p-3 w-full sm:w-28 md:w-32 text-center">
      <div class="flex items-center justify-center mb-1 gap-1">
        ${realTimeIcon}
        ${late ? `<span class="text-gray-400 line-through">${original}</span>` : ''}
        <span class="font-semibold">${time}</span>
      </div>
      <div class="text-xs text-gray-500">VR ${arr.blockId} / ${arr.vehicleId}</div>
    </div>`;
}

function renderRouteGroup(group) {
    const sample = group[0];
    const groupId = `group-${sample.routeId}-${sample.tripHeadsign.replace(/\s+/g, '-')}`.toLowerCase();
    const isExpanded = expandedRouteGroups.has(groupId);

    let html = `
    <div class="mb-6" id="${groupId}-wrapper">
      <div class="flex items-center gap-2 mb-2">
        <span class="badge" style="color: white; background-color: #1264AB; font-weight: bold;">${sample.routeShortName}</span>
        <span class="text-sm text-gray-600">${sample.tripHeadsign}</span>
      </div>
      <div class="grid grid-cols-2 gap-3" id="${groupId}">`;

    group.slice(0, 4).forEach(arr => {
        html += renderArrivalCard(arr, `location.hash = 'trip/${arr.tripId}'`);
    });

    html += `</div>`;

    if (group.length > 4) {
        html += `
      <div id="${groupId}-extra" class="grid grid-cols-2 gap-3 mt-3 ${isExpanded ? '' : 'hidden'}">`;

        group.slice(4).forEach(arr => {
            html += renderArrivalCard(arr, `location.hash = 'trip/${arr.tripId}'`);
        });

        html += `</div>
      <div class="mt-2">
        <button class="btn btn-sm btn-outline w-full" onclick="
          const extra = document.getElementById('${groupId}-extra');
          const btn = this;
          if (extra.classList.contains('hidden')) {
            extra.classList.remove('hidden');
            expandedRouteGroups.add('${groupId}');
            btn.textContent = 'Sakrij';
          } else {
            extra.classList.add('hidden');
            expandedRouteGroups.delete('${groupId}');
            btn.textContent = 'Prikaži sve';
          }
        ">
          ${isExpanded ? 'Sakrij' : 'Prikaži sve'}
        </button>
      </div>`;
    }

    html += `</div>`;
    return html;
}

async function generateArrivals(data, update = false, refreshTime = 10000) {
    const stopId = data.stop_id;
    const stopName = data.stop_name;
    const parentStation = data.parent_station;

    const arrivals = await fetch(`/stops/${stopId}/trips?current=true`).then(res => res.json());

    const isSavedStop = savedStops.has(stopId);

    let content = `
  <div class="flex justify-start items-start mb-2">
    <div class="flex items-center justify-center w-8 h-8">
      <button
        class="text-xl ${isSavedStop ? 'text-yellow-400' : ''}"
        title="Spremi stajalište"
        onclick="
          const stopSet = savedStops;
          const el = this;
          const id = '${stopId}';
          if (stopSet.has(id)) {
            stopSet.delete(id);
            el.classList.remove('text-yellow-400');
            el.innerHTML = '<i class=\\'bi bi-star\\'></i>';
          } else {
            stopSet.add(id);
            el.classList.add('text-yellow-400');
            el.innerHTML = '<i class=\\'bi bi-star-fill\\'></i>';
          }
          saveSavedStops();
        ">
        <i class="bi ${isSavedStop ? 'bi-star-fill' : 'bi-star'}"></i>
      </button>
    </div>
    <div>
      <h2 class="text-xl font-semibold break-words">${stopName}</h2>
      <p class="text-sm text-gray-500">(${stopId})</p>
    </div>
  </div>
  <hr class="mb-4" />
`;


    const siblingStops = map.getSource('stops')._data.features.filter(s => s.properties.parentId === parentStation);
    if (siblingStops.length > 1) {
        content += `
      <div class="mb-4">
        <select class="select select-bordered w-full" onchange="location.hash = 'stop/' + this.value">`;
        for (const s of siblingStops) {
            content += `<option value="${s.properties.id}" ${s.properties.id === stopId ? 'selected' : ''}>
        ${s.properties.name} (${s.properties.id})
      </option>`;
        }
        content += `</select></div>`;
    }

    if (!arrivals.length) {
        content += `<p class="text-gray-500">Za danas više nema polazaka.</p>`;
        openInfoPanel(content);
        setTimeout(() => {
            if (location.hash === `#stop/${stopId}`) generateArrivals(data, false);
        }, refreshTime);
        return;
    }

    const routeGroups = groupArrivalsByRoute(arrivals);
    for (const groupKey in routeGroups) {
        content += renderRouteGroup(routeGroups[groupKey]);
    }

    openInfoPanel(content);

    // Find stop on map
    const stopFeature = map.getSource('stops')?._data?.features?.find(f => f.properties.id === stopId);
    if (stopFeature) {
        const coords = stopFeature.geometry.coordinates;
        map.flyTo({
            center: coords,
            zoom: 16,
            speed: 3,
            essential: true
        });
    }

    setTimeout(() => {
        if (location.hash === `#stop/${stopId}`) generateArrivals(data, false);
    }, refreshTime);
}
