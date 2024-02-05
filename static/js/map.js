initMap();

let stopLayer = L.markerClusterGroup().addTo(map);
let vehicleLayer = L.layerGroup().addTo(map);
let polylineLayer = L.layerGroup().addTo(map);
let markers = [];
let vehicle_markers = [];
let stopData = [];
let evalHistory = [];
let routes = [];
var searchbox;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

main();

async function initMap() {
    map = L.map('mapid', { zoomControl: false }).setView([45.812892, 15.9775658], 13);

    /*L.tileLayer('https://api.mapbox.com/styles/v1/{id}/tiles/{z}/{x}/{y}?access_token=pk.eyJ1IjoibWFwYm94IiwiYSI6ImNpejY4NXVycTA2emYycXBndHRqcmZ3N3gifQ.rJcFIG214AriISLbB6B5aw', {
        maxZoom: 20,
        attribution: ``,
        id: 'mapbox/light-v9',
        tileSize: 512, detectRetina: true,
        zoomOffset: -1
    }).addTo(map);*/
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '',
        maxZoom: 19
    }).addTo(map);

    L.control.zoom({
        position: 'topright'
    }).addTo(map);
    L.control.locate({ position: `topright` }).addTo(map);
}

async function main() {
    await delay(500);
    // fetch data from /stop/all
    let stops = await fetch('/stops');
    routes = await fetch('/routes').then(res => res.json());
    stops = await stops.json();
    stopData = stops.features;
    for (let stop of stops.features) {
        let i = stopData.indexOf(stop);
        markers[i] = await L.marker([stop.geometry.coordinates[1], stop.geometry.coordinates[0]], {
            icon: L.divIcon({
                className: 'icon-station',
                iconSize: [20, 20],
                iconAnchor: [10, 10],
                popupAnchor: [0, 0],
                html: ``
            }),
            title: `${stop.properties.id} ${stop.properties.name}`
        })
            .bindTooltip(`<b>${stop.properties.id}</b> ${stop.properties.name}`, {
            })
            .addTo(stopLayer);
        markers[i].data = {
            stop_id: stop.properties.id,
            stop_name: stop.properties.name,
            parent_station: stop.properties.parentId,
            index: i
        }
        markers[i].on('dblclick', async (e) => {
            // center slightly below the marker
            document.getElementById('sidebar').hidden = true;
            // add to eval history the following:
            evalHistory.push(`generateArrivals(${e.target.data}, false)`);
            generateArrivals(e.target.data, false);
        });

        markers[i].on('click', async (e) => {
            // close all other popups
            await markers.forEach(marker => {
                marker.closePopup();
            });
            // set popup active
            e.target.openPopup();
        });
    }
    generateVehicleMarkers();
}

async function generateVehicleMarkers() {
    // fetch data from /vehicle/positions
    let vehicles = await fetch('/vehicles/locations');
    let processedVehicles = [];
    vehicles = await vehicles.json();
    vehicles = vehicles.features;
    for (let i in vehicles) {
        let schedule = vehicles[i].properties.tripId.split("_")[2];
        // ignore if coordinates are null
        if (vehicles[i].geometry.coordinates[0] == null || vehicles[i].geometry.coordinates[1] == null) {
            continue;
        }
        if (vehicle_markers[schedule] && !processedVehicles.includes(schedule)) {
            // if so, update its position
            vehicle_markers[schedule].setLatLng([vehicles[i].geometry.coordinates[1], vehicles[i].geometry.coordinates[0]]);
            // update its data as well
            vehicle_markers[schedule].data = await {
                trip_id: vehicles[i].properties.tripId,
                vehicle_id: vehicles[i].properties.vehicleId,
                stop_id: vehicles[i].properties.stopId,
                stop_name: vehicles[i].properties.stopName,
                route_id: vehicles[i].properties.routeId,
                route_name: vehicles[i].properties.routeLongName,
                vehicle_lat: vehicles[i].geometry.coordinates[1],
                vehicle_lon: vehicles[i].geometry.coordinates[0]
            }
            processedVehicles.push(schedule);
        } else if (!processedVehicles.includes(schedule)) {
            // create a marker
            vehicle_markers[schedule] = await L.marker([vehicles[i].geometry.coordinates[1], vehicles[i].geometry.coordinates[0]], {
                icon: L.divIcon({
                    className: 'icon-vehicle',
                    iconSize: [25, 25],
                    iconAnchor: [12, 12],
                    popupAnchor: [0, 0],
                    html: `<p class="icon">${vehicles[i].properties.routeShortName}</p> <div class="tooltip-vehicle">${vehicles[i].properties.vehicleId}</div>`
                })
            })
                .bindTooltip(`<b>${vehicles[i].properties.vehicleId}</b> - ${vehicles[i].properties.routeShortName} ${vehicles[i].properties.routeLongName}`, {
                })
                .addTo(vehicleLayer);
            vehicle_markers[schedule].data = await {
                trip_id: vehicles[i].properties.tripId,
                vehicle_id: vehicles[i].properties.vehicleId,
                stop_id: vehicles[i].properties.stopId,
                stop_name: vehicles[i].properties.stopName,
                route_id: vehicles[i].properties.routeId,
                route_name: vehicles[i].properties.routeLongName,
                vehicle_lat: vehicles[i].geometry.coordinates[1],
                vehicle_lon: vehicles[i].geometry.coordinates[0]
            }
            vehicle_markers[schedule].on('dblclick', async (e) => {
                // generate trip details for vehicle
                document.getElementById('sidebar').hidden = true;
                evalHistory.push(`generateTripDetails(${e.target.data.trip_id})`);
                generateTripDetails(e.target.data.trip_id);
            });
            processedVehicles.push(schedule);
        }
    }
    //console.log(vehicle_markers);
    // check again in 20s
    setTimeout(generateVehicleMarkers, 20000);
}

async function generateArrivals(data, update) {
    // check if the popup is already open
    let is_open = document.getElementById(`bottom-data`).hidden;
    // stop any previous fetches
    let arrivals = await fetch(`/stops/${data.stop_id}/trips?current=true`);
    arrivals = await arrivals.json();
    // get arrivals
    let is_open2 = document.getElementById(`bottom-data`).hidden;
    // if the popup was open, and now is closed, return
    if (is_open != is_open2) {
        return;
    }
    let bottomData = document.getElementById('bottom-data');
    bottomData.innerHTML = '';
    // generate route_info
    let routeInfo = document.createElement('div');
    routeInfo.className = 'route-info container';
    routeInfo.innerHTML = `<div class="exit-button" onclick="document.getElementById('bottom-data').hidden = true; document.getElementById('bottom-data').innerHTML='';"><i class="bi bi-x-lg"></i></div>`;
    routeInfo.innerHTML += `<span style="font-weight: bold; font-size: 1.5rem;">${data.stop_name}</span> <span style="font-size:0.75rem">${data.stop_id}</span>`;
    routeInfo.id = data.stop_id;
    bottomData.appendChild(routeInfo);
    let select = document.createElement('select');
    select.className = 'form-select';
    select.id = `select-${data.stop_id}`;
    select.onchange = async (e) => {
        let selected = document.getElementById(`select-${data.stop_id}`).value;
        let selectedData = stopData.find(stop => stop.stop_id === selected);
        // center map slightly below marker with selected stop_id
        map.panTo([selectedData.stop_lat - 0.0003, selectedData.stop_lon], {
            animate: true
        });
        evalHistory.push(`generateArrivals(${selectedData}, false)`);
        generateArrivals(selectedData);
    }
    routeInfo.appendChild(select);
    // options listed should be all stations with same parent_Station
    let options = [];
    for (let i in stopData) {
        if (stopData[i].parent_station === data.parent_station && stopData[i].stop_id !== data.stop_id) {
            await options.push(`<option value="${stopData[i].stop_id}">${stopData[i].stop_name} (${stopData[i].stop_id})</option>`);
        }
    }
    // set the first option to be the current stop
    await options.unshift(`<option value="${data.stop_id}" selected>${data.stop_name} (${data.stop_id})</option>`);
    select.innerHTML = options.join('');
    // add hr
    let hr = document.createElement('hr');
    routeInfo.appendChild(hr);
    // if object is empty
    console.log(arrivals)
    if (Object.keys(arrivals).length === 0) {
        routeInfo.innerHTML += `<span style="font-size: 1.5rem;">Za danas više nema polazaka.</span>`;
        bottomData.hidden = false;

        setTimeout(() => {
            // check if there is a element with id stop_id
            if (document.getElementById(data.stop_id)) {
                // refresh
                generateArrivals(data);
            }
        }, 10000);
    }
    for (let i in arrivals) {
        for (let j in arrivals[i]) {
            let div_route = document.createElement('div');
            div_route.className = 'route';
            let div_route_name = document.createElement('div');
            div_route_name.className = 'route-name';
            div_route_name.innerHTML = `<span class="route_name_number">${i}</span> <span>${j}</span>`;
            div_route.appendChild(div_route_name);
            let div_route_arrivals = document.createElement('div');
            div_route_arrivals.className = 'route-arrivals';
            for (let k in arrivals[i][j]) {
                let div_arrival = document.createElement('div');
                div_arrival.className = 'arrival';
                let time = arrivals[i][j][k].departure_time.substring(0, 5);
                // if first two characters are > 23, remove 24h
                if (time.substring(0, 2) > '23') {
                    time_temp = parseInt(time.substring(0, 2)) - 24;
                    // if time_temp is less than 10, add 0 before
                    if (time_temp < 10) {
                        time_temp = '0' + time_temp;
                    }
                    time = time_temp + ":" + time.substring(3);

                }
                div_arrival.innerHTML = `<span style="pointer-events: none;">${time}</span>`;
                div_arrival.id = await arrivals[i][j][k].trip_id;
                // check if there is live parameter
                if (arrivals[i][j][k].live) {
                    // add <i class="bi bi-broadcast blink"></i>
                    div_arrival.innerHTML += ` <i class="bi bi-broadcast blink" style="pointer-events: none;"></i>`;
                    // in next line add font size 0.7rem params vehicle and trip_id[2]
                    div_arrival.innerHTML += `<br><span style="font-size: 0.7rem; pointer-events: none;">${arrivals[i][j][k].vehicle}/${arrivals[i][j][k].trip_id.split("_")[2]}</span>`;
                } else {
                    // add <i class="bi bi-clock"></i> and in next row trip_id[2]
                    div_arrival.innerHTML += ` <i class="bi bi-clock" style="pointer-events: none;"></i><br><span style="font-size: 0.7rem; pointer-events: none;">${arrivals[i][j][k].vehicle ? arrivals[i][j][k].vehicle : " - "}/${arrivals[i][j][k].trip_id.split("_")[2]}</span>`;
                }
                div_route_arrivals.appendChild(div_arrival);
                div_arrival.addEventListener('click', e => {
                    // add the following to the history
                    evalHistory.push(`generateTripDetails('${e.target.id}', true)`);
                    generateTripDetails(e.target.id, true)
                });
            }
            div_route.appendChild(div_route_arrivals);
            routeInfo.appendChild(div_route);
        }
    }
    bottomData.hidden = false;

    setTimeout(() => {
        // check if there is a element with id stop_id
        if (document.getElementById(data.stop_id)) {
            // refresh
            generateArrivals(data);
        }
    }, 10000);
}

async function generateRouteSchedule(route_id, bool) {
    console.log(bool);
    if (bool == true) {
        // check if there is a element with id route-info-${route_id}, if no, return
        if (!document.getElementById(`route-info-${route_id}`)) {
            return;
        }
    } else {
        // remove all elements with class route-info
        let routeInfos = document.getElementsByClassName('route-info');
        for (let i = 0; i < routeInfos.length; i++) {
            routeInfos[i].remove();
        }
        let bottomData = document.getElementById('bottom-data');
        bottomData.hidden = false;
        // add spinner so the user knows that something is happening
        let spinner = document.createElement('div');
        spinner.className = 'spinner-border text-primary';
        spinner.innerHTML = `<span class="sr-only">Loading...</span>`;
        bottomData.innerHTML = spinner.outerHTML + ' <span style="font-size:1.2rem">Generiranje prikaza... molimo sačekajte.</span>';

    }
    // fetch /lines/schedules/route_id
    let response = await fetch(`/lines/schedules/${route_id}`).then(res => res.json());
    if (bool == true) {
        // check if there is a element with id route-info-${route_id}, if no, return
        if (!document.getElementById(`route-info-${route_id}`)) {
            return;
        }
    }
    let data = response.data.trips;
    let route = routes.find(route => route.route_id == route_id);
    //console.log(data);
    // group response by response[].trip_headsign
    let grouped = data.reduce((acc, cur) => {
        acc[cur.trip_headsign] = acc[cur.trip_headsign] || [];
        acc[cur.trip_headsign].push(cur);
        return acc;
    }, {});
    //console.log(grouped);
    let routeInfo = document.createElement('div');
    routeInfo.className = 'route-info';
    routeInfo.id = `route-info-${route_id}`;
    routeInfo.innerHTML = `<div class="exit-button" onclick="document.getElementById('bottom-data').hidden = true; document.getElementById('bottom-data').innerHTML='';"><i class="bi bi-x-lg"></i></div>`;
    routeInfo.innerHTML += `<span style="color:darkgrey; font-size:0.75rem">Vozni red za liniju ${route_id}</span><br>`
    routeInfo.innerHTML += `<span style="font-size:1.2rem"><span class="route_name_number">${route_id}</span> ${route.route_long_name}</span>`;
    routeInfo.innerHTML += `<hr>`;
    // create three tabs for the schedule
    //let ul = document.createElement('ul');
    let div = document.createElement('div');
    div.className = 'tab-content';
    div.id = `tab-content-${route_id}`;
    //ul.className = "nav nav-tabs";
    //ul.id = "schedule-tabs";
    for (let i in grouped) {
        /*let li = document.createElement('li');
        li.className = "nav-item";
        let button = document.createElement('button');
        button.className = "nav-link";
        button.id = `schedule-tab-${i}`;
        button.data = {
            direction: i,
        }
        button.innerHTML = `${i}`;
        button.setAttribute('aria-controls', `schedule-tab-content-${i}`);
        button.addEventListener('click', e => {
            // hide all #schedule-tab-content-*
            console.log(e.target);
            let tabContents = document.getElementsByClassName('schedule-tab-content');
            for (let i = 0; i < tabContents.length; i++) {
                tabContents[i].hidden = true;
            }
            // remove active from all #schedule-tab-*
            let tabButtons = document.getElementsByClassName('nav-link');
            for (let i = 0; i < tabButtons.length; i++) {
                tabButtons[i].classList.remove('active');
            }
            // show the clicked #schedule-tab-content-*
            document.getElementById(`schedule-tab-content-${e.target.data.direction}`).hidden = false;
            // add class active to this button
            let button = document.getElementById(`schedule-tab-${e.target.data.direction}`);
            button.className = "nav-link active";
        })
        li.appendChild(button);
        ul.appendChild(li);*/
        let div_tab = document.createElement('div');
        div_tab.id = `schedule-tab-content-${i}`;
        div_tab.innerHTML = `<span style="font-size:1.2rem">Vozni red za smjer <b>${i}</b></span>`;
        // group grouped[i] by grouped[i][].departure_time.split(":")[0]
        let grouped_i = grouped[i];
        //console.log(grouped_i);
        let grouped_by_hour = {};
        for (let i in grouped_i) {
            grouped_by_hour[grouped_i[i].departure_time.split(":")[0]] = grouped_by_hour[grouped_i[i].departure_time.split(":")[0]] || [];
            grouped_by_hour[grouped_i[i].departure_time.split(":")[0]].push(grouped_i[i]);
        }
        //console.log(grouped_by_hour);
        // create a table
        let table = document.createElement('table');
        table.className = 'table';
        table.id = `schedule-table-${i}-${route_id}`;
        let thead = document.createElement('thead');
        let tr = document.createElement('tr');
        let th = document.createElement('th');
        th.innerHTML = "h";
        th.style.width = '3rem';
        tr.appendChild(th);
        let th2 = document.createElement('th');
        th2.innerHTML = `m <span style="font-size:0.75rem">vr</span>`;
        th2.style.width = 'auto';
        tr.appendChild(th2);
        thead.appendChild(tr);
        table.appendChild(thead);
        // order grouped_by_hour by int value
        let ordered_grouped_by_hour = {};
        for (let i in grouped_by_hour) {
            ordered_grouped_by_hour[parseInt(i) - 24 < 0 ? parseInt(i) : parseInt(i) - 24] = grouped_by_hour[i];
        }
        grouped_by_hour = ordered_grouped_by_hour;
        //console.log(ordered_grouped_by_hour);
        for (let j in grouped_by_hour) {
            //console.log(grouped_by_hour,grouped_by_hour[j]);
            let tr = document.createElement('tr');
            let td = document.createElement('td');
            td.innerHTML = j;
            td.style.width = '3rem';
            let td2 = document.createElement('td');
            td2.style.width = 'auto';
            td2.style.display = "flex";
            td2.style.flexDirection = "row";
            td2.style.flexWrap = "wrap";
            for (let k in grouped_by_hour[j]) {
                if (grouped_by_hour[j][k].gtfs_rt_trip) {
                    td2.innerHTML += `<ar class="arrivalar" id="${grouped_by_hour[j][k].trip_id}" onclick="generateTripDetails('${grouped_by_hour[j][k].trip_id}')"><time>&nbsp;${grouped_by_hour[j][k].departure_time.split(":")[1]}&nbsp</time>
                    <span class="blink" style="font-size:0.75rem">${grouped_by_hour[j][k].block_id}</span></ar>`;
                } else {
                    td2.innerHTML += `<ar class="arrivalar" id="${grouped_by_hour[j][k].trip_id}" onclick="generateTripDetails('${grouped_by_hour[j][k].trip_id}')"><time>&nbsp;${grouped_by_hour[j][k].departure_time.split(":")[1]}&nbsp</time>
                    <span style="font-size:0.75rem">${grouped_by_hour[j][k].block_id}</span></ar>`;
                }
            }
            tr.appendChild(td);
            tr.appendChild(td2);
            table.appendChild(tr);
        }
        div_tab.appendChild(table);
        div.appendChild(div_tab);
    }
    //routeInfo.appendChild(ul);
    routeInfo.appendChild(div);
    // click the first button
    /*`<ul class="nav nav-tabs" id="myTab" role="tablist">
                    <li class="nav-item" role="presentation">
                        <button class="nav-link active" id="A-tab" data-bs-toggle="tab" data-bs-target="#atab" type="button" role="tab" aria-controls="home" aria-selected="true">Smjer ${'A'}</button>
                    </li>
                    <li class="nav-item" role="presentation">
                        <button class="nav-link" id="B-tab" data-bs-toggle="tab" data-bs-target="#btab" type="button" role="tab" aria-controls="profile" aria-selected="false">Smjer ${'B'}</button>
                    </li>
                    <li class="nav-item" role="presentation">
                        <button class="nav-link" id="stops-tab" data-bs-toggle="tab" data-bs-target="#stops" type="button" role="tab" aria-controls="contact" aria-selected="false">Stanice</button>
                    </li>
                    </ul>`*/

    let bottomData = document.getElementById('bottom-data');
    bottomData.hidden = false;
    bottomData.innerHTML = routeInfo.outerHTML;
}

async function generateTripDetails(trip_id, location_bool) {
    // check if there is a marker with same trip_id
    if (location_bool) {
        for (let i in vehicle_markers) {
            if (vehicle_markers[i].data.trip_id == trip_id) {
                // center to this marker
                let location = await vehicle_markers[i].getLatLng();
                map.panTo([location.lat - 0.0003, location.lng], {
                    animate: true
                });
            }
        }
    }
    let response = await fetch(`/trips/${trip_id}`);
    let polyline = await fetch(`/trips/${trip_id}/shape`).then(res => res.json());

    polylineLayer.clearLayers();
    let polylineData = polyline.geometry.coordinates;
    let polylineArray = [];
    for (let i in polylineData) {
        polylineArray.push([polylineData[i][1], polylineData[i][0]]);
    }

    let polylineObject = L.polyline(polylineArray, { color: 'blue' }).addTo(polylineLayer);

    let data = await response.json();
    //(data);
    // clear bottomData
    let bottomData = document.getElementById('bottom-data');
    bottomData.innerHTML = '';
    // routeInfo
    let routeInfo = document.createElement('div');
    routeInfo.id = `route-info-${trip_id}`;
    bottomData.appendChild(routeInfo);
    routeInfo.innerHTML = `<div class="exit-button" onclick="document.getElementById('bottom-data').hidden = true; document.getElementById('bottom-data').innerHTML='';"><i class="bi bi-x-lg"></i></div>`;
    routeInfo.innerHTML += `<span style="color:darkgrey; font-size:0.75rem">Linija ${data.routeShortName} / VR ${data.tripId.split("_")[2]} / Polazak ${data.tripId.split("_").pop()}</span><br>`
    routeInfo.innerHTML += `<span style="font-size:1.2rem"><span class="route_name_number">${data.routeShortName}</span> <span>${data.tripHeadsign}</span></span>`;
    routeInfo.innerHTML += `<br>`;
    let routeScheduleDiv = `<button class="route-schedule" onclick="generateRouteSchedule('${data.routeShortName}', false)"><span style="font-size:0.8rem">Pogledaj VR </span> <i class="bi bi-calendar-event"></i></button>`;
    /*routeScheduleDiv.data = {   
        trip_id: data.trip.trip_id,
        route_id: data.trip.route_id
    }*/
    //console.log(routeScheduleDiv); 
    // add event listener
    if (data.realTime) {
        // if the trip has live info, note it down  
        routeInfo.innerHTML += `<i class="bi bi-broadcast blink" style="pointer-events: none;"></i><small> Podaci se ažuriraju u stvarnom vremenu.</small>`;
        routeInfo.innerHTML += `<span style="font-size: 0.7rem; pointer-events: none;"> Lokacija vozila je aproksimirana.</span>`;
    } else {
        // if the trip has no live info, note it down
        routeInfo.innerHTML += `<i class="bi bi-clock" style="pointer-events: none;"></i><small> Podaci za polazak su statičnog tipa.</small>`;
    }
    routeInfo.innerHTML += routeScheduleDiv;
    routeInfo.innerHTML += `<hr>`;
    // iterate through the stations
    let stationInfo = document.createElement('div');
    stationInfo.id = 'station-info';
    bottomData.appendChild(stationInfo);
    // check if there is a data.live.stopTimeUpdate[0].stopSequence
    let current_stop = 0;
    let currentSecondsFromMidnight = new Date().getHours() * 60 * 60 + new Date().getMinutes() * 60 + new Date().getSeconds();
    for (let stopTime of data.stopTimes) {
        if (stopTime.departureTime <= currentSecondsFromMidnight) {
            current_stop = stopTime.stopSequence;
        }
    }
    //console.log(current_stop);
    let isCurrent = false;
    for (let i in data.stopTimes) {
        // make a new div for each stop, which displays the station name, station_id, and the time of arrival
        let div_station = document.createElement('div');
        div_station.className = 'station-element';
        div_station.id = `arrival-stop-${data.stopTimes[i].stopId}`;
        div_station.data = {
            stop_id: data.stopTimes[i].stopId,
            stop_name: data.stopTimes[i].stopName,
            parent_station: data.stopTimes[i].stopId.split("_")[0]
        }
        // hh mm
        let departure = new Date(data.stopTimes[i].departureTime * 1000).toISOString().substr(11, 5);
        let originalDeparture = new Date((data.stopTimes[i].departureTime - data.stopTimes[i].departureDelay) * 1000).toISOString().substr(11, 5);
        div_station.innerHTML = `<t style="pointer-events: none;"><span style="font-weight:bold;">${data.stopTimes[i].stopName}</span> <small>(${data.stopTimes[i].stopId})</small></t> `;
        div_station.innerHTML += `<span class="station-departure" style="pointer-events: none;">${originalDeparture != departure ? `<span class="crossed-out">${originalDeparture}</span> ${departure}` : departure}</span>`;
        // if the stopSequence is lower than current_stop, make it grey
        if (data.stopTimes[i].stopSequence < current_stop) {
            div_station.style.color = 'grey';
        } else if (data.stopTimes[i].stopSequence == current_stop) {
            // if the stop is the current stop, make it current
            div_station.classList.add('station-current');
        }
        // console.log(data.stops[i].stop_sequence,current_stop);
        // make each stop clickable
        div_station.addEventListener('click', e => {
            // generate station table from id and add to history
            evalHistory.push(`generateArrivals(${e.target.data}, false)`);
            // center on stop (find it as a marker
            let marker = markers.find(marker => marker.data.stop_id == e.target.data.stop_id);
            let mp = marker.getLatLng();
            map.panTo([mp.lat - 0.0003, mp.lng], {
                animate: true
            }, 19);
            generateArrivals(e.target.data);
        });
        // add
        stationInfo.appendChild(div_station);
    }
    document.getElementById('bottom-data').hidden = false;
    routeScheduleDiv.onclick = async (e) => {
        console.log(e.target.data);
        generateRouteSchedule(e.target.data.route_id, false);
    }
    // after 10s check if there is a element with id stop_id
    setTimeout(() => {
        // check if there is a element with id stop_id
        if (document.getElementById(`route-info-${trip_id}`)) {
            // refresh
            generateTripDetails(trip_id);
        }
    }, 10000);

}

document.getElementById('search-input').addEventListener('keyup', async (e) => {
    document.getElementById('sidebar').hidden = true;
    // replace all chars ŠĐČĆŽ with SDCZ
    let search = document.getElementById('search-input').value.toUpperCase().replace(/Š/g, 'S').replace(/Đ/g, 'D').replace(/Č/g, 'C').replace(/Ć/g, 'C').replace(/Ž/g, 'Z');
    // remove spaces and make uppercase
    search = search.replace(/\s/g, '').toUpperCase();
    // if search is empty, show nothing
    // if term is shorter than 2 chars, show nothing
    if (search === '' || search.length < 2) {
        document.getElementById('search-results').innerHTML = '';
        return;
    } else {
        //console.log(search);
        // check if stop_id or stop_name contains search
        let results = await stopData.filter(stop => {
            // replace all chars ŠĐČĆŽ with SDCZ
            let stop_name = stop.stop_name.toUpperCase().replace(/Š/g, 'S').replace(/Đ/g, 'D').replace(/Č/g, 'C').replace(/Ć/g, 'C').replace(/Ž/g, 'Z');
            // remove spaces and make uppercase
            stop_name = stop_name.replace(/\s/g, '').toUpperCase();
            // if stop_id or stop_name contains search, return true
            return stop_name.includes(search) || stop.stop_id.includes(search);
        });
        // also add to results, vehicle_id's
        let vehicle_results = await vehicle_markers.filter(vehicle => {
            // no need to replace anything
            return vehicle.data.vehicle_id.includes(search) || vehicle.data.vehicle_id == search;
        });
        // also add to results, route_id's, and route_long_name's
        let route_results = await routes.filter(route => {
            // replace all chars ŠĐČĆŽ with SDCZ
            let route_long_name = route.route_long_name.toUpperCase().replace(/Š/g, 'S').replace(/Đ/g, 'D').replace(/Č/g, 'C').replace(/Ć/g, 'C').replace(/Ž/g, 'Z');
            // remove spaces and make uppercase
            route_long_name = route_long_name.replace(/\s/g, '').toUpperCase();
            // if route_id or route_long_name contains search, return true
            return route_long_name.includes(search) || route.route_id.toString().includes(search);
        });
        //console.log(stopData, results)
        // if there is no results, show nothing
        //console.log(results,vehicle_results);
        if (results.length === 0 && vehicle_results.length === 0) {
            document.getElementById('search-results').innerHTML = '';
            return;
        }
        // if there is results, show them - make UL
        let ul = document.createElement('ul');
        // list-group
        ul.className = 'list-group';
        // iterate through results
        for (let i in results) {
            // create li
            let li = document.createElement('li');
            li.className = 'list-group-item';
            li.innerHTML = `<span>${results[i].stop_name} <small>${results[i].stop_id}</small></span>`;
            li.data = {
                stop_id: results[i].stop_id,
                stop_name: results[i].stop_name,
                parent_station: results[i].parent_station,
                stop_lat: results[i].stop_lat,
                stop_lon: results[i].stop_lon
            }
            // add event listener to li
            li.addEventListener('click', async () => {
                // set search input to empty
                document.getElementById('search-results').innerHTML = '';
                // set search input to empty
                document.getElementById('search-input').value = '';
                // center on stop
                map.setView([results[i].stop_lat - 0.0003, results[i].stop_lon], 19);
                // generate arrivals
                evalHistory.push(`generateArrivals(${li.data}, false)`);
                generateArrivals(li.data);
            });
            // add li to ul
            ul.appendChild(li);
        }

        for (let i in vehicle_results) {
            // create li
            let li = document.createElement('li');
            li.className = 'list-group-item';
            li.innerHTML = `<span style="pointer-events: none;">${vehicle_results[i].data.vehicle_id} <span class="route_name_number">${vehicle_results[i].data.route_id}</span> <span>${vehicle_results[i].data.route_name}</span></span><br>`;
            li.data = await vehicle_results[i].data;
            // add event listener to li
            li.addEventListener('click', async (e) => {
                // set search input to empty
                document.getElementById('search-results').innerHTML = '';
                // set search input to empty
                document.getElementById('search-input').value = '';
                // center on vehicle
                //console.log(e.target.data);
                map.setView(vehicle_markers[e.target.data.vehicle_id].getLatLng(), 19);
                // generate arrivals
                evalHistory.push(`generateTripDetails(${li.data.trip_id}, true)`);
                generateTripDetails(li.data.trip_id, true);
            });
            // add li to ul
            ul.appendChild(li);
        }

        for (let i in route_results) {
            // create li
            let li = document.createElement('li');
            li.className = 'list-group-item';
            li.innerHTML = `<span style="pointer-events: none;"><span class="route_name_number">${route_results[i].route_id}</span> ${route_results[i].route_long_name}</span><br>`;
            li.data = await route_results[i];
            // add event listener to li
            li.addEventListener('click', async (e) => {
                // set search input to empty
                document.getElementById('search-results').innerHTML = '';
                // set search input to empty
                document.getElementById('search-input').value = '';
                // generate arrivals
                evalHistory.push(`generateRouteSchedule(${li.data.route_id}, false)`);
                generateRouteSchedule(li.data.route_id, false);
            });
            // add li to ul
            ul.appendChild(li);
        }
        // add ul to search results
        document.getElementById('search-results').innerHTML = '';
        document.getElementById('search-results').appendChild(ul);
    }
})

document.getElementById('button-addon2').addEventListener('click', async () => {
    // create sidebar
    document.getElementById('sidebar').hidden = false;
});

window.addEventListener('backbutton, popstate', () => {
    // if there is something in evalHistory, go back
    console.log(evalHistory);
    if (evalHistory.length > 0) {
        eval(evalHistory.pop());
    } else {
        // if there is nothing in evalHistory, exit app
        navigator.app.exitApp();
    }
})
