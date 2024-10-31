import { createRequire } from 'module';

import fetch from 'node-fetch';
import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import Papa from 'papaparse';

const require = createRequire(import.meta.url);

const fs = require('fs');
const sqlite3 = require('better-sqlite3')('zet.sqlite3');
const express = require('express');
const apicache = require('apicache');
const luxon = require('luxon');
const AdmZip = require('adm-zip');

const app = express();

let cache = apicache.middleware;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/*
CREATE TABLE IF NOT EXISTS Calendar(
    service_id TEXT,
    monday INTEGER,
    tuesday INTEGER,
    wednesday INTEGER,
    thursday INTEGER,
    friday INTEGER,
    saturday INTEGER,
    sunday INTEGER,
    start_date TEXT,
    end_date TEXT
);

CREATE TABLE IF NOT EXISTS CalendarDates(
    service_id TEXT,
    date TEXT,
    exception_type INTEGER
);

CREATE TABLE IF NOT EXISTS Routes(
    route_id TEXT,
    route_short_name TEXT,
    route_long_name TEXT,
    route_type INTEGER,
    route_color TEXT,
    route_text_color TEXT
);

CREATE TABLE IF NOT EXISTS Shapes(
    shape_id TEXT,
    shape_pt_lat REAL,
    shape_pt_lon REAL,
    shape_pt_sequence INTEGER,
    shape_dist_traveled REAL
);

CREATE TABLE IF NOT EXISTS Trips(
    route_id TEXT,
    service_id TEXT,
    trip_id TEXT,
    trip_headsign TEXT,
    direction_id INTEGER,
    block_id TEXT,
    shape_id TEXT
);

CREATE TABLE IF NOT EXISTS Stops(
    stop_id TEXT,
    stop_code TEXT,
    stop_name TEXT,
    stop_desc TEXT,
    stop_lat REAL,
    stop_lon REAL,
    zone_id TEXT,
    stop_url TEXT,
    location_type INTEGER,
    parent_station TEXT
);

CREATE TABLE IF NOT EXISTS StopTimes(
    trip_id TEXT,
    arrival_time TEXT,
    arrival_time_int INTEGER,
    departure_time TEXT,
    departure_time_int INTEGER,
    stop_id TEXT,
    stop_sequence INTEGER,
    pickup_type INTEGER,
    drop_off_type INTEGER,
    shape_dist_traveled REAL,
    closest_shape_pt_sequence INTEGER
);


*/

// CORS 
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    next();
});

const CONFIG = {
    GTFS_ZIPPED: 'https://www.zet.hr/gtfs-scheduled/latest',
    GTFS_RT_TRIP_UPDATES: 'https://zet.hr/gtfs',
}

const createTables = () => {
    const createTables = fs.readFileSync('create_tables.sql', 'utf8');
    sqlite3.exec(createTables);
    // iterate over files in migrations folder and execute them
    const migrations = fs.readdirSync('migrations');
    for (let migration of migrations) {
        try {
            const sql = fs.readFileSync(`migrations/${migration}`, 'utf8');
            sqlite3.exec(sql);
        } catch (e) {
            console.error(e);
        }
    }
}

const loadGtfs = async () => {
    createTables();
    console.log('Loading GTFS data...');
    // Download GTFS
    const gtfsZip = await fetch(CONFIG.GTFS_ZIPPED).then(response => response.buffer());
    fs.writeFileSync('gtfs.zip', gtfsZip);
    console.log('Downloaded GTFS data');
    // Unzip GTFS
    const zip = new AdmZip('gtfs.zip');
    zip.extractAllTo('./gtfs', true);
    console.log('Unzipped GTFS data');
    // Clear tables
    sqlite3.exec('DELETE FROM Calendar;');
    sqlite3.exec('DELETE FROM CalendarDates;');
    sqlite3.exec('DELETE FROM Routes;');
    sqlite3.exec('DELETE FROM StopTimes;');
    sqlite3.exec('DELETE FROM Trips;');
    sqlite3.exec('DELETE FROM Shapes;');
    sqlite3.exec('DELETE FROM Stops;');

    console.log('Cleared tables');


    try {
        // Insert data
        let calendar = Papa.parse(await fs.promises.readFile('./gtfs/calendar.txt', 'utf8'), { header: true }).data;
        console.log('Loaded calendar');
        calendar = calendar.filter(row => Object.values(row).some(cell => cell !== ''));
        let calendarStr = 'INSERT INTO Calendar (service_id, monday, tuesday, wednesday, thursday, friday, saturday, sunday, start_date, end_date) VALUES ';
        let calendarValues = [];

        for (let row of calendar) {
            calendarStr += '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?),';
            calendarValues.push(row.service_id, row.monday, row.tuesday, row.wednesday, row.thursday, row.friday, row.saturday, row.sunday, row.start_date, row.end_date);
        }
        calendarStr = calendarStr.slice(0, -1);
        sqlite3.prepare(calendarStr).run(calendarValues);
        console.log('Inserted calendar');

        calendar = null;
        calendarValues = null;
        calendarStr = null;

        let calendar_dates = Papa.parse(await fs.promises.readFile('./gtfs/calendar_dates.txt', 'utf8'), { header: true }).data;
        console.log('Loaded calendar_dates');
        calendar_dates = calendar_dates.filter(row => Object.values(row).some(cell => cell !== ''));
        let calendarDatesStr = 'INSERT INTO CalendarDates (service_id, date, exception_type) VALUES ';
        let calendarDatesValues = [];

        for (let row of calendar_dates) {
            calendarDatesStr += '(?, ?, ?),';
            calendarDatesValues.push(row.service_id, row.date, row.exception_type);
        }
        calendarDatesStr = calendarDatesStr.slice(0, -1);
        await sqlite3.prepare(calendarDatesStr).run(calendarDatesValues);
        console.log('Inserted calendar_dates');

        calendar_dates = null;
        calendarDatesValues = null;
        calendarDatesStr = null;

        let routes = Papa.parse(await fs.promises.readFile('./gtfs/routes.txt', 'utf8'), { header: true }).data;
        console.log('Loaded routes');
        routes = routes.filter(row => Object.values(row).some(cell => cell !== ''));
        let routesStr = 'INSERT INTO Routes (route_id, route_short_name, route_long_name, route_type, route_color, route_text_color) VALUES ';
        let routesValues = [];

        for (let row of routes) {
            routesStr += '(?, ?, ?, ?, ?, ?),';
            routesValues.push(row.route_id, row.route_short_name, row.route_long_name, row.route_type, row.route_color, row.route_text_color);
        }
        routesStr = routesStr.slice(0, -1);
        await sqlite3.prepare(routesStr).run(routesValues);
        console.log('Inserted routes');

        routes = null;
        routesValues = null;
        routesStr = null;

        let shapes = Papa.parse(await fs.promises.readFile('./gtfs/shapes.txt', 'utf8'), { header: true }).data;
        console.log('Loaded shapes');
        shapes = shapes.filter(row => Object.values(row).some(cell => cell !== ''));
        let shapesStr = 'INSERT INTO Shapes (shape_id, shape_pt_lat, shape_pt_lon, shape_pt_sequence, shape_dist_traveled) VALUES ';
        let counter = 0;
        let shapeDistMap = {};
        let shapeMap = {};

        let localShapeStr = shapesStr;
        let localShapesValues = [];

        for (let row of shapes) {
            if (counter == 2500) {
                localShapeStr = localShapeStr.slice(0, -1);
                await sqlite3.prepare(localShapeStr).run(localShapesValues);
                localShapeStr = shapesStr;
                localShapesValues = [];
                counter = 0;
            }
            if (!Object.keys(shapeDistMap).includes(row.shape_id)) {
                shapeDistMap[row.shape_id] = 0;
                shapeMap[row.shape_id] = [];
            } else {
                shapeDistMap[row.shape_id] += Math.sqrt(Math.pow(row.shape_pt_lat - shapes[shapes.indexOf(row) - 1].shape_pt_lat, 2) + Math.pow(row.shape_pt_lon - shapes[shapes.indexOf(row) - 1].shape_pt_lon, 2));
            }
            localShapeStr += '(?, ?, ?, ?, ?),';
            localShapesValues.push(row.shape_id, row.shape_pt_lat, row.shape_pt_lon, row.shape_pt_sequence, shapeDistMap[row.shape_id] * 1000);
            shapeMap[row.shape_id].push({
                ...row,
                shape_dist_traveled: shapeDistMap[row.shape_id] * 1000
            });
            counter++;
        }
        localShapeStr = localShapeStr.slice(0, -1);
        await sqlite3.prepare(localShapeStr).run(localShapesValues);
        console.log('Inserted shapes');

        shapes = null;
        localShapesValues = null;
        localShapeStr = null;
        shapeDistMap = null;

        let trips = Papa.parse(await fs.promises.readFile('./gtfs/trips.txt', 'utf8'), { header: true }).data;
        console.log('Loaded trips');
        trips = trips.filter(row => Object.values(row).some(cell => cell !== ''));
        let tripsStr = 'INSERT INTO Trips (route_id, service_id, trip_id, trip_headsign, direction_id, block_id, shape_id) VALUES ';
        let tripsValues = [];
        let tripToShapeMap = {};

        let localTripsStr = tripsStr;
        let localTripsValues = [];

        counter = 0;

        for (let row of trips) {
            if (counter == 2500) {
                localTripsStr = localTripsStr.slice(0, -1);
                await sqlite3.prepare(localTripsStr).run(localTripsValues);
                localTripsStr = tripsStr;
                localTripsValues = [];
                counter = 0;
            }
            localTripsStr += '(?, ?, ?, ?, ?, ?, ?),';
            localTripsValues.push(row.route_id, row.service_id, row.trip_id, row.trip_headsign, row.direction_id, row.block_id, row.shape_id);
            tripToShapeMap[row.trip_id] = row.shape_id;
            counter++;
        }
        localTripsStr = localTripsStr.slice(0, -1);
        await sqlite3.prepare(localTripsStr).run(localTripsValues);
        console.log('Inserted trips');

     trips = null;
        localTripsValues = null;
        localTripsStr = null;

        let stops = Papa.parse(await fs.promises.readFile('./gtfs/stops.txt', 'utf8'), { header: true }).data;
        console.log('Loaded stops');
        stops = stops.filter(row => Object.values(row).some(cell => cell !== ''));
        let stopsStr = 'INSERT INTO Stops (stop_id, stop_code, stop_name, stop_desc, stop_lat, stop_lon, zone_id, stop_url, location_type, parent_station) VALUES ';
        let stopsValues = [];

        let localStopsStr = stopsStr;
        let localStopsValues = [];

        counter = 0;

        let stopMap = {};

        for (let row of stops) {
            if (counter == 800) {
                localStopsStr = localStopsStr.slice(0, -1);
                await sqlite3.prepare(localStopsStr).run(localStopsValues);
                localStopsStr = stopsStr;
                localStopsValues = [];
                counter = 0;
            }
            localStopsStr += '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?),';
            localStopsValues.push(row.stop_id, row.stop_code, row.stop_name, row.stop_desc, row.stop_lat, row.stop_lon, row.zone_id, row.stop_url, row.location_type, row.parent_station);
            stopMap[row.stop_id] = row;
            counter++;
        }
        localStopsStr = localStopsStr.slice(0, -1);
        await sqlite3.prepare(localStopsStr).run(localStopsValues);
        console.log('Inserted stops');

        stops = null;
        localStopsValues = null;
        localStopsStr = null;
        
        console.log('Loading stop_times in buffered mode...');

        let stopTimesStr = 'INSERT INTO StopTimes (trip_id, arrival_time, arrival_time_int, departure_time, departure_time_int, stop_id, stop_sequence, pickup_type, drop_off_type, shape_dist_traveled) VALUES ';
        let stopTimesValues = [];
        counter = 0;
        const tripIndex = {};

        const stopTimesParser = await Papa.parse(await fs.createReadStream('./gtfs/stop_times.txt'), {
            header: true,
            chunk: async (results, parser) => {
                const rows = results.data;

                try {
                    for (let row of rows) {
                        if (Object.values(row).some(cell => cell !== '')) {
                            stopTimesStr += '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?),';
                            row.arrival_time_int = row.arrival_time.split(':').reduce((acc, time) => (60 * acc) + +time);
                            row.departure_time_int = row.departure_time.split(':').reduce((acc, time) => (60 * acc) + +time);
                            // calculate shape_dist_traveled by getting nearest shape point
                            row.shape_dist_traveled = shapeMap[tripToShapeMap[row.trip_id]].reduce((acc, shape) => {
                                const distance = Math.sqrt(Math.pow(stopMap[row.stop_id].stop_lat - shape.shape_pt_lat, 2) + Math.pow(stopMap[row.stop_id].stop_lon - shape.shape_pt_lon, 2));
                                if (distance < acc.distance) {
                                    acc.distance = distance;
                                    acc.shape_dist_traveled = shape.shape_dist_traveled;
                                }
                                return acc;
                            }, { distance: Infinity, shape_dist_traveled: 0 }).shape_dist_traveled;
                            stopTimesValues.push(row.trip_id, row.arrival_time, row.arrival_time_int, row.departure_time, row.departure_time_int, row.stop_id, row.stop_sequence, row.pickup_type, row.drop_off_type, row.shape_dist_traveled);

                            counter++;
                            if (counter >= 2000) {
                                stopTimesStr = stopTimesStr.slice(0, -1);
                                await sqlite3.prepare(stopTimesStr).run(stopTimesValues);
                                console.log('Inserted batch of stop_times');
                                // Reset string and values for next batch
                                stopTimesStr = 'INSERT INTO StopTimes (trip_id, arrival_time, arrival_time_int, departure_time, departure_time_int, stop_id, stop_sequence, pickup_type, drop_off_type, shape_dist_traveled) VALUES ';
                                stopTimesValues = [];
                                counter = 0;
                            }
                        }
                    }
                } catch (e) {
                    console.error(e);
                }
            },
            complete: async () => {
                if (stopTimesValues.length > 0) {
                    try {
                        if (stopTimesStr[stopTimesStr.length - 1] == ',')
                            stopTimesStr = stopTimesStr.slice(0, -1);
                        await sqlite3.prepare(stopTimesStr).run(stopTimesValues);
                    } catch (e) {
                        console.log(e);
                    }
                    console.log('Inserted final batch of stop_times');
                }
                console.log('Completed processing stop_times.');
            }
        });

    } catch (e) {
        console.error(e);
    }

    let b = 0;
}

const port = 8910;

app.get('/stops', cache('1 day'), (req, res) => {
    let stops = sqlite3.prepare("SELECT * FROM Stops WHERE parent_station != ''").all();
    let geoJson = {
        type: "FeatureCollection",
        features: []
    };
    for (let stop of stops) {
        geoJson.features.push({
            type: "Feature",
            geometry: {
                type: "Point",
                coordinates: [stop.stop_lon, stop.stop_lat]
            },
            properties: {
                name: stop.stop_name,
                code: stop.stop_code,
                id: stop.stop_id,
                parentId: stop.parent_station
            }
        });
    }
    res.json(geoJson);
});

app.get('/stops/:id/trips', cache('30 seconds'), async (req, res) => {
    try {
        let stopId = req.params.id;
        // check if stop exists
        let stop = await sqlite3.prepare('SELECT * FROM Stops WHERE stop_id = ?').get(stopId);
        if (!stop) {
            res.status(404).json({ message: 'Stop not found' });
            return;
        }
        let calendarIds = await getCalendarIds();
        let stopTimes = await sqlite3.prepare('SELECT * FROM StopTimes JOIN Trips ON StopTimes.trip_id = Trips.trip_id JOIN Routes on Routes.route_id = Trips.route_id WHERE stop_id = ? AND service_id IN (' + calendarIds.map(() => '?').join(',') + ')').all([stopId, ...calendarIds]);
        let formattedStopTimes = [];
        let secondsFromMidnight = luxon.DateTime.now().setZone('Europe/Zagreb').toFormat('HH:mm:ss').split(':').reduce((acc, time) => (60 * acc) + +time);
        if (req.query.time) {
            req.query.time = parseInt(req.query.time);
        }
        for (let stopTime of stopTimes) {
            let rtUpdate = RT_DATA.find(rt => rt.trip.tripId == stopTime.trip_id);
            if (rtUpdate) {
                let stopTimeUpdate = rtUpdate.stopTimeUpdate[0];
                if (stopTimeUpdate) {
                    if (req.query.current) {
                        if (secondsFromMidnight > stopTime.departure_time_int + (stopTimeUpdate.departure && stopTimeUpdate.departure.delay ? stopTimeUpdate.departure.delay : 0)) {
                            continue;
                        }
                    }
                    if (req.query.time) {
                        // time is expressed in seconds, so skip trips that are too far in the future
                        if (secondsFromMidnight + req.query.time < stopTime.departure_time_int + (stopTimeUpdate.departure && stopTimeUpdate.departure.delay ? stopTimeUpdate.departure.delay : 0)) {
                            continue;
                        }
                    }
                    formattedStopTimes.push({
                        tripId: stopTime.trip_id,
                        tripHeadsign: stopTime.trip_headsign,
                        routeId: stopTime.route_id,
                        routeShortName: stopTime.route_short_name,
                        routeLongName: stopTime.route_long_name,
                        arrivalTime: stopTime.departure_time_int + (stopTimeUpdate.arrival && stopTimeUpdate.arrival.delay ? stopTimeUpdate.arrival.delay : 0),
                        departureTime: stopTime.departure_time_int + (stopTimeUpdate.departure && stopTimeUpdate.departure.delay ? stopTimeUpdate.departure.delay : 0),
                        arrivalDelay: stopTimeUpdate.arrival && stopTimeUpdate.arrival.delay ? stopTimeUpdate.arrival.delay : 0,
                        departureDelay: stopTimeUpdate.departure && stopTimeUpdate.departure.delay ? stopTimeUpdate.departure.delay : 0,
                        blockId: stopTime.block_id,
                        realTime: true,
                        vehicleId: VP_MAP[stopTime.trip_id] || 'XXX'
                    });
                }
            } else {
                if (req.query.current) {
                    if (secondsFromMidnight > stopTime.departure_time_int) {
                        continue;
                    }
                }
                if (req.query.time) {
                    // time is expressed in seconds, so skip trips that are too far in the future
                    if (secondsFromMidnight + req.query.time < stopTime.departure_time_int) {
                        continue;
                    }
                }
                formattedStopTimes.push({
                    tripId: stopTime.trip_id,
                    tripHeadsign: stopTime.trip_headsign,
                    routeId: stopTime.route_id,
                    routeShortName: stopTime.route_short_name,
                    routeLongName: stopTime.route_long_name,
                    arrivalTime: stopTime.arrival_time_int,
                    departureTime: stopTime.departure_time_int,
                    arrivalDelay: 0,
                    departureDelay: 0,
                    blockId: stopTime.block_id,
                    realTime: false,
                    vehicleId: VP_MAP[stopTime.trip_id] || 'XXX'
                });
            }
        }
        res.json(formattedStopTimes);
    } catch (e) {
        insertIntoLog(e.message + ' ' + e.stack);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

app.get('/trips/:id', cache('30 seconds'), async (req, res) => {
    try {
        let tripId = req.params.id;
        let trip = await sqlite3.prepare('SELECT * FROM Trips JOIN Routes ON Trips.route_id = Routes.route_id WHERE trip_id = ?').get(tripId);
        if (!trip) {
            res.status(404).json({ message: 'Trip not found' });
            return;
        }
        let stopTimes = await sqlite3.prepare('SELECT * FROM StopTimes JOIN Stops ON StopTimes.stop_id = Stops.stop_id WHERE trip_id = ? ORDER BY stop_sequence').all(tripId);
        let formattedStopTimes = [];
        for (let stopTime of stopTimes) {
            // check if there is a real time update
            let rtUpdate = RT_DATA.find(rt => rt.trip.tripId == tripId);
            if (rtUpdate) {
                let stopTimeUpdate = rtUpdate.stopTimeUpdate[0]
                if (stopTimeUpdate) {
                    // if the update is for a stop prior to the current one, keep it
                    formattedStopTimes.push({
                        stopId: stopTime.stop_id,
                        stopName: stopTime.stop_name,
                        stopSequence: stopTime.stop_sequence,
                        arrivalTime: stopTime.arrival_time_int + (stopTimeUpdate.arrival && stopTimeUpdate.arrival.delay ? stopTimeUpdate.arrival.delay : 0),
                        departureTime: stopTime.departure_time_int + (stopTimeUpdate.departure && stopTimeUpdate.departure.delay ? stopTimeUpdate.departure.delay : 0),
                        arrivalDelay: stopTimeUpdate.arrival && stopTimeUpdate.arrival.delay ? stopTimeUpdate.arrival.delay : 0,
                        departureDelay: stopTimeUpdate.departure && stopTimeUpdate.departure.delay ? stopTimeUpdate.departure.delay : 0,
                        realTime: true
                    });
                }
            } else {
                formattedStopTimes.push({
                    stopId: stopTime.stop_id,
                    stopName: stopTime.stop_name,
                    stopSequence: stopTime.stop_sequence,
                    arrivalTime: stopTime.arrival_time_int,
                    departureTime: stopTime.departure_time_int,
                    arrivalDelay: 0,
                    departureDelay: 0,
                    realTime: false
                });
            }
        }
        res.json({
            tripId: trip.trip_id,
            routeId: trip.route_id,
            routeShortName: trip.route_short_name,
            routeLongName: trip.route_long_name,
            tripHeadsign: trip.trip_headsign,
            directionId: trip.direction_id,
            stopTimes: formattedStopTimes,
            blockId: trip.block_id,
            realTime: RT_DATA.find(rt => rt.trip.tripId == tripId) ? true : false,
            vehicleId: VP_MAP[tripId] || 'XXX'
        });
    } catch (e) {
        insertIntoLog(e.message + ' ' + e.stack);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

app.get('/trips/:id/shape', cache('1 day'), async (req, res) => {
    try {
        let tripId = req.params.id;
        let trip = await sqlite3.prepare('SELECT * FROM Trips WHERE trip_id = ?').get(tripId);
        if (!trip) {
            res.status(404).json({ message: 'Trip not found' });
            return;
        }
        let shape = await sqlite3.prepare('SELECT * FROM Shapes WHERE shape_id = ? ORDER BY shape_pt_sequence').all(trip.shape_id);
        let geoJson = {
            type: "Feature",
            geometry: {
                type: "LineString",
                coordinates: []
            }
        };
        for (let point of shape) {
            geoJson.geometry.coordinates.push([point.shape_pt_lon, point.shape_pt_lat]);
        }
        res.json(geoJson);
    } catch (e) {
        insertIntoLog(e.message + ' ' + e.stack);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});


app.get('/routes', cache('1 day'), async (req, res) => {
    try {
        let routes = await sqlite3.prepare('SELECT * FROM Routes').all();
        let routesFormatted = [];
        for (let route of routes) {
            routesFormatted.push({
                routeId: route.route_id,
                routeShortName: route.route_short_name,
                routeLongName: route.route_long_name,
                routeType: route.route_type,
                routeColor: route.route_color,
                routeTextColor: route.route_text_color
            });
        }
        res.json(routesFormatted);
    } catch (e) {
        insertIntoLog(e.message + ' ' + e.stack);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

app.get('/routes/:id/trips', cache('30 seconds'), async (req, res) => {
    try {
        let routeId = req.params.id;
        let calendarIds = await getCalendarIds();
        // check if route exists
        let route = await sqlite3.prepare('SELECT * FROM Routes WHERE route_id = ?').get(routeId);
        if (!route) {
            res.status(404).json({ message: 'Route not found' });
            return;
        }
        let trips = await sqlite3.prepare('SELECT * FROM Trips WHERE route_id = ? AND service_id IN (' + calendarIds.map(() => '?').join(',') + ')').all([routeId, ...calendarIds]);
        let startTimes = await sqlite3.prepare('SELECT trip_id, MIN(departure_time_int) as start_time FROM StopTimes WHERE trip_id IN (' + trips.map(() => '?').join(',') + ') GROUP BY trip_id').all(trips.map(trip => trip.trip_id));
        let endTimes = await sqlite3.prepare('SELECT trip_id, MAX(departure_time_int) as end_time FROM StopTimes WHERE trip_id IN (' + trips.map(() => '?').join(',') + ') GROUP BY trip_id').all(trips.map(trip => trip.trip_id));
        let tripsFormatted = [];
        let secondsFromMidnight = luxon.DateTime.now().setZone('Europe/Zagreb').toFormat('HH:mm:ss').split(':').reduce((acc, time) => (60 * acc) + +time);
        if (req.query.time) {
            req.query.time = parseInt(req.query.time);
        }
        for (let trip of trips) {
            // check for query parameters
            let rt = RT_DATA.find(rt => rt.trip.tripId == trip.trip_id);
            if (req.query.current) {
                if (secondsFromMidnight > await endTimes.find(st => st.trip_id == trip.trip_id).end_time + (rt ? rt.stopTimeUpdate[0].departure.delay : 0)) {
                    continue;
                }
            }
            if (req.query.time) {
                // time is expressed in seconds, so skip trips that are too far in the future
                if (secondsFromMidnight + req.query.time < await startTimes.find(st => st.trip_id == trip.trip_id).start_time + (rt ? rt.stopTimeUpdate[0].departure.delay : 0)) {
                    continue;
                }
            }
            // check if we have a real time update
            tripsFormatted.push({
                tripId: trip.trip_id,
                routeId: trip.route_id,
                routeShortName: trip.route_short_name,
                routeLongName: trip.route_long_name,
                tripHeadsign: trip.trip_headsign,
                startTime: startTimes.find(st => st.trip_id == trip.trip_id).start_time,
                endTime: endTimes.find(et => et.trip_id == trip.trip_id).end_time,
                realTime: rt ? true : false,
                blockId: trip.block_id
            });
        }
        // sort by start time
        tripsFormatted.sort((a, b) => a.startTime - b.startTime);
        res.json(tripsFormatted);
    } catch (e) {
        insertIntoLog(e.message + ' ' + e.stack);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

app.get('/routes/:id/shapes', cache('1 day'), async (req, res) => {
    try {
        let routeId = req.params.id;
        let calendarIds = await getCalendarIds();
        // check if route exists
        let route = await sqlite3.prepare('SELECT * FROM Routes WHERE route_id = ?').get(routeId);
        if (!route) {
            res.status(404).json({ message: 'Route not found' });
            return;
        }
        // write trip_ids as a subquery
        let shapes = await sqlite3.prepare(`SELECT DISTINCT shape_id, trip_headsign FROM Trips WHERE route_id = ? AND service_id IN (${calendarIds.map(() => '?').join(',')})`).all([routeId, ...calendarIds]);
        let shapeGeoJson = {
            type: "FeatureCollection",
            features: []
        };
        for (let shape of shapes) {
            let shapePoints = await sqlite3.prepare('SELECT * FROM Shapes WHERE shape_id = ? ORDER BY shape_pt_sequence').all(shape.shape_id);
            let shapeFeature = {
                type: "Feature",
                geometry: {
                    type: "LineString",
                    coordinates: []
                },
                properties: {
                    shapeId: shape.shape_id,
                    tripHeadsign: shape.trip_headsign
                }
            };
            for (let point of shapePoints) {
                shapeFeature.geometry.coordinates.push([point.shape_pt_lon, point.shape_pt_lat]);
            }
            shapeGeoJson.features.push(shapeFeature);
        }
        res.json(shapeGeoJson);
    } catch (e) {
        insertIntoLog(e.message + ' ' + e.stack);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

app.get('/historical/:date', cache('30 seconds'), async (req, res) => {
    try {
        let date = req.params.date;
        let parsedDate = luxon.DateTime.fromFormat(date, 'yyyy-MM-dd');
        if (!parsedDate.isValid) {
            res.status(400).json({ message: 'Invalid date format' });
            return;
        }
        // change it to format yyyyMMdd
        parsedDate = parsedDate.toFormat('yyyyMMdd');
        let entries = await sqlite3.prepare('SELECT * FROM VehicleDispatches WHERE date = ?').all(parsedDate);
        let formattedEntries = [];
        for (let entry of entries) {
            formattedEntries.push({
                vehicleId: entry.vehicle_id,
                tripId: entry.trip_id,
                routeShortName: entry.route_short_name,
                tripHeadsign: entry.trip_headsign,
                startTime: entry.start_time,
                blockId: entry.block_id,
            });
        }
        res.json(formattedEntries);
    } catch (e) {
        insertIntoLog(e.message + ' ' + e.stack);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

app.get('/historic/vehicleids', cache('1 minute'), async (req, res) => {
    try {
        let vehicleIds = await sqlite3.prepare('SELECT DISTINCT vehicle_id FROM VehicleDispatches').all();
        let formattedVehicleIds = [];
        for (let vehicleId of vehicleIds) {
            formattedVehicleIds.push(vehicleId.vehicle_id);
        }
        res.json(formattedVehicleIds);
    } catch (e) {
        insertIntoLog(e.message + ' ' + e.stack);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

app.get('/historic/vehicle/:id', cache('1 minute'), async (req, res) => {
    // get last 10 entries for a vehicle based on distinct block_id and date
    try {
        let vehicleId = req.params.id;
        let offset = req.query.offset || 0;
        let entries = await sqlite3.prepare('SELECT DISTINCT block_id, date, route_short_name FROM VehicleDispatches WHERE vehicle_id = ? ORDER BY date DESC LIMIT 10 OFFSET ?').all(vehicleId, offset);
        let formattedEntries = [];
        for (let entry of entries) {
            formattedEntries.push({
                date: entry.date,
                tripId: entry.trip_id,
                routeShortName: entry.route_short_name,
                tripHeadsign: entry.trip_headsign,
                startTime: entry.start_time,
                blockId: entry.block_id,
            });
        }
        res.json(formattedEntries);
    } catch (e) {
        insertIntoLog(e.message + ' ' + e.stack);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});


function getRealTimeUpdate(tripId) {
    let RT_UPDATE = RT_DATA.find(rt => rt.trip.tripId === tripId);
    let delay = RT_UPDATE ? (RT_UPDATE.stopTimeUpdate[0]?.departure?.delay || RT_UPDATE.stopTimeUpdate[0]?.arrival?.delay || 0) : 0;
    return { delay, realTime: !!RT_UPDATE };
}

function calculateCurrentPosition(trip, tripStopTimes, shapesMap, currentTime, RT_UPDATE) {
    const currentStopTimeIndex = findStopTimeIndex(tripStopTimes, currentTime, RT_UPDATE);
    const currentStopTime = tripStopTimes[currentStopTimeIndex - 1] || tripStopTimes[0];
    const nextStopTime = tripStopTimes[currentStopTimeIndex] || tripStopTimes[tripStopTimes.length - 1];

    let distance = interpolateDistance(currentStopTime, nextStopTime, currentTime, RT_UPDATE);
    if (distance < 0) {
        distance = 0;
    }
    if (distance > tripStopTimes[tripStopTimes.length - 1].shape_dist_traveled) {
        distance = tripStopTimes[tripStopTimes.length - 1].shape_dist_traveled;
    }
    const tripShape = shapesMap[trip.shape_id];
    const { lat, lon, previousShapePoint, nextShapePoint } = interpolatePosition(tripShape, distance);
    const bearing = calculateBearing(previousShapePoint, nextShapePoint);

    return [lat, lon, bearing];
}

function findStopTimeIndex(tripStopTimes, currentTime, RT_UPDATE) {
    for (let i = 0; i < tripStopTimes.length; i++) {
        let stopTime = tripStopTimes[i];
        if (stopTime.departure_time_int + (RT_UPDATE.delay || 0) > currentTime) {
            return i;
        }
    }
}

function interpolateDistance(currentStopTime, nextStopTime, currentTime, RT_UPDATE) {
    const timeFraction = (currentTime - currentStopTime.departure_time_int - (RT_UPDATE.delay || 0)) / (nextStopTime.departure_time_int - currentStopTime.departure_time_int - (RT_UPDATE.delay || 0));
    return currentStopTime.shape_dist_traveled + timeFraction * (nextStopTime.shape_dist_traveled - currentStopTime.shape_dist_traveled);
}

function interpolatePosition(shape, distance) {
    let previousShapePoint = shape[0];
    let nextShapePoint = shape[shape.length - 1];

    for (let i = 1; i < shape.length; i++) {
        if (shape[i].shape_dist_traveled > distance) {
            nextShapePoint = shape[i];
            break;
        }
        previousShapePoint = shape[i];
    }

    const distanceFraction = (distance - previousShapePoint.shape_dist_traveled) / (nextShapePoint.shape_dist_traveled - previousShapePoint.shape_dist_traveled);

    return {
        lat: previousShapePoint.shape_pt_lat + distanceFraction * (nextShapePoint.shape_pt_lat - previousShapePoint.shape_pt_lat),
        lon: previousShapePoint.shape_pt_lon + distanceFraction * (nextShapePoint.shape_pt_lon - previousShapePoint.shape_pt_lon),
        previousShapePoint,
        nextShapePoint
    };
}

function calculateBearing(previousShapePoint, nextShapePoint) {
    const dLon = (nextShapePoint.shape_pt_lon - previousShapePoint.shape_pt_lon) * (Math.PI / 180);
    const lat1 = previousShapePoint.shape_pt_lat * (Math.PI / 180);
    const lat2 = nextShapePoint.shape_pt_lat * (Math.PI / 180);
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    let bearing = Math.atan2(y, x) * (180 / Math.PI);
    bearing = (bearing + 360) % 360;
    return bearing;
}

let TRIPS = [];
let SHAPES_MAP = [];
let STOP_TIMES_MAP = [];

async function preloadData() {
    let calendar = await getCalendarIds();
    console.log('Valid calendar ids', calendar);
    TRIPS = await sqlite3.prepare('SELECT * FROM Trips JOIN Routes ON Trips.route_id = Routes.route_id WHERE service_id IN (' + calendar.map(() => '?').join(',') + ')').all(calendar);
    let shapeIds = await TRIPS.map(trip => trip.shape_id);
    let tripIds = await TRIPS.map(trip => trip.trip_id);
    SHAPES_MAP = await sqlite3.prepare('SELECT * FROM Shapes WHERE shape_id IN (' + tripIds.map(() => '?').join(',') + ') ORDER BY shape_pt_sequence').all(shapeIds);
    SHAPES_MAP = SHAPES_MAP.reduce((acc, shape) => {
        if (!acc[shape.shape_id]) acc[shape.shape_id] = [];
        acc[shape.shape_id].push(shape);
        return acc;
    }
        , {});
    STOP_TIMES_MAP = await sqlite3.prepare('SELECT * FROM StopTimes WHERE trip_id IN (' + tripIds.map(() => '?').join(',') + ')').all(tripIds);
    STOP_TIMES_MAP = STOP_TIMES_MAP.reduce((acc, stopTime) => {
        if (!acc[stopTime.trip_id]) acc[stopTime.trip_id] = [];
        acc[stopTime.trip_id].push(stopTime);
        return acc;
    }
        , {});
}

app.get('/vehicles/locations', cache('10 seconds'), async (req, res) => {
    try {
        let calendar = await getCalendarIds();

        let currentTime = luxon.DateTime.now().setZone('Europe/Zagreb').toFormat('HH:mm:ss').split(':').reduce((acc, time) => (60 * acc) + +time);
        console.log('Current time', currentTime, luxon.DateTime.now().setZone('Europe/Zagreb').toFormat('HH:mm:ss'));

        let geoJson = {
            type: "FeatureCollection",
            features: []
        };

        for (let trip of TRIPS) {
            if (!STOP_TIMES_MAP[trip.trip_id]) continue;
            let tripStopTimes = STOP_TIMES_MAP[trip.trip_id];
            let startTime = tripStopTimes[0].departure_time_int;
            let endTime = tripStopTimes[tripStopTimes.length - 1].arrival_time_int;
            let RT_UPDATE = getRealTimeUpdate(trip.trip_id);
            endTime += RT_UPDATE.delay;

            if (currentTime > startTime && currentTime < endTime) {
                let [lat, lon, bearing] = calculateCurrentPosition(trip, tripStopTimes, SHAPES_MAP, currentTime, RT_UPDATE);
                /*if (!VP_MAP2[trip.trip_id] || !VP_MAP2[trip.trip_id].position || !VP_MAP2[trip.trip_id].position.latitude || !VP_MAP2[trip.trip_id].position.longitude) {
                    [lat, lon, bearing] = calculateCurrentPosition(trip, tripStopTimes, SHAPES_MAP, currentTime, RT_UPDATE);
                } else {
                    lat = VP_MAP2[trip.trip_id].position.latitude;
                    lon = VP_MAP2[trip.trip_id].position.longitude;
                    bearing = 0;
                }*/

                geoJson.features.push({
                    type: "Feature",
                    geometry: {
                        type: "Point",
                        coordinates: [lon, lat]
                    },
                    properties: {
                        tripId: trip.trip_id,
                        routeId: trip.route_id,
                        routeShortName: trip.route_short_name,
                        routeLongName: trip.route_long_name,
                        routeType: trip.route_type,
                        departureTime: tripStopTimes[0].departure_time,
                        tripHeadsign: trip.trip_headsign,
                        delay: RT_UPDATE.delay,
                        bearing: bearing,
                        realTime: RT_UPDATE.realTime,
                        vehicleId: VP_MAP[trip.trip_id] || RT_UPDATE.vehicle?.id || 'XXX'
                    }
                });
            }
        }

        res.json(geoJson);
    } catch (e) {
        insertIntoLog(e.message + ' ' + e.stack);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});




let VALID_CALENDAR_IDS = [];
let lastCalendarSync = 0;

async function getCalendarIdsForDate(calendar, calendar_dates, date) {
    let validCalendarIds = [];
    let dayOfWeek = luxon.DateTime.fromFormat(date, 'yyyyMMdd').setZone('Europe/Zagreb').toFormat('E');
    for (let cal of calendar) {
        if (cal[dayOfWeek] == 1 && cal.start_date <= date && cal.end_date >= date) {
            // check if there is an exception
            let exception = await calendar_dates.find(cd => cd.service_id == cal.service_id && cd.date == date);
            if (exception) {
                if (exception.exception_type == 1) {
                    validCalendarIds.push(cal.service_id);
                }
            } else {
                validCalendarIds.push(cal.service_id);
            }
        } else {
            // check if there is an exception
            let exception = await calendar_dates.find(cd => cd.service_id == cal.service_id && cd.date == date);
            if (exception) {
                if (exception.exception_type == 1) {
                    validCalendarIds.push(cal.service_id);
                }
            }
        }
    }
    return validCalendarIds;
}


async function getCalendarIds() {
    let timeNow = luxon.DateTime.now().setZone('Europe/Zagreb').toMillis();
    // recalc once every 3min
    if (VALID_CALENDAR_IDS.length > 0 && timeNow - lastCalendarSync < 180000) {
        return VALID_CALENDAR_IDS;
    }
    let calendar = await sqlite3.prepare('SELECT * FROM Calendar').all();
    let calendar_dates = await sqlite3.prepare('SELECT * FROM CalendarDates').all();
    let validCalendarIds = [];
    let dates = [luxon.DateTime.now().setZone('Europe/Zagreb').toFormat('yyyyMMdd')];
    // if it's before 4am Zagreb time, also check for yesterday
    if (luxon.DateTime.now().setZone('Europe/Zagreb').hour < 4) {
        dates.push(luxon.DateTime.now().setZone('Europe/Zagreb').minus({ days: 1 }).toFormat('yyyyMMdd'));
    }
    for (let date of dates) {
        let calendarIds = await getCalendarIdsForDate(calendar, calendar_dates, date);
        validCalendarIds = validCalendarIds.concat(calendarIds);
    }
    VALID_CALENDAR_IDS = validCalendarIds;
    return validCalendarIds;
}

async function insertIntoLog(message) {
    try {
        await sqlite3.prepare('INSERT INTO Logs (log_message) VALUES (?)').run(message || 'No message');
    } catch (e) {
        console.error(e);
    }
}

let RT_DATA = [];
let VP_DATA = [];
let VP_MAP = {};
let VP_MAP2 = {};

async function logVehicles() {
    // Log vehicles based on RT data
    let sql_stmt = 'INSERT INTO VehicleDispatches (trip_id, route_short_name, trip_headsign, block_id, vehicle_id, start_time, date) VALUES ';
    let sql_values = [];
    let date = luxon.DateTime.now().setZone('Europe/Zagreb').toFormat('yyyyMMdd');
    for (let rt of RT_DATA) {
        let trip = TRIPS.find(trip => trip.trip_id == rt.trip.tripId);
        if (!trip) continue;
        let vehicle = VP_MAP2[rt.trip.tripId];
        let vehicle_id = '?';
        if (vehicle) 
            vehicle_id = vehicle.vehicle.id;
        let tripStopTimes = STOP_TIMES_MAP[rt.trip.tripId];
        if (!tripStopTimes) continue;
        sql_stmt += '(?, ?, ?, ?, ?, ?, ?),';
        sql_values.push(trip.trip_id, trip.route_short_name, trip.trip_headsign, trip.block_id, vehicle_id, tripStopTimes[0].departure_time, date);
    }
    sql_stmt = sql_stmt.slice(0, -1);
    if (sql_values.length > 0) {
        sql_stmt += ' ON CONFLICT(trip_id, date) DO UPDATE SET vehicle_id = EXCLUDED.vehicle_id';
        await sqlite3.prepare(sql_stmt).run(sql_values);
    }
}

async function getRtData() {
    while (true) {
        try {
            let rtData = await fetch(CONFIG.GTFS_RT_TRIP_UPDATES);
            let feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(await rtData.buffer());
            let data = [];
            let vehicleData = [];
            for (let entity of feed.entity) {
                if (entity.tripUpdate && entity.tripUpdate.stopTimeUpdate.length > 0) {
                    data.push(entity.tripUpdate);
                }
                if (entity.vehicle) {
                    vehicleData.push(entity.vehicle);
                }
            }
            let vehicle_map = {}
            let vehicle_map2 = {}
            for (let vehicle of vehicleData) {
                vehicle_map[vehicle.trip.tripId] = vehicle.vehicle.id;
                vehicle_map2[vehicle.trip.tripId] = vehicle;
            }
            // if there are less data entries than vehicleData entries by over 30% get the data again from Transitclock
            if (data.length < vehicleData.length * 0.7) {
                console.log('Data mismatch, getting data from Transitclock');
                let rtData = await fetch('http://ijpp-transitclock:8080/api/v1/key/f78a2e9a/agency/0/command/gtfs-rt/tripUpdates?format=binary');
                let feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(await rtData.buffer());
                let data2 = [];
                for (let entity of feed.entity) {
                    if (entity.tripUpdate && entity.tripUpdate.stopTimeUpdate.length > 0) {
                        // since Transitclock doesn't directly report delays, we need to calculate them based on arrival.time or departure.time
                        let delay = 0;
                        // scheduled time is taken from the stoptime map for the trip
                        let stopTimeMap = STOP_TIMES_MAP[entity.tripUpdate.trip.tripId];
                        let tripDate = luxon.DateTime.fromFormat(entity.tripUpdate.trip.startDate, 'yyyyMMdd', { zone: 'Europe/Zagreb' }).toMillis() / 1000;
                        if (stopTimeMap) {
                            for (let stopTimeUpdate of entity.tripUpdate.stopTimeUpdate) {
                                if ((stopTimeUpdate.arrival && stopTimeUpdate.arrival.delay) || (stopTimeUpdate.departure && stopTimeUpdate.departure.delay))
                                    continue;
                                let stopTime = stopTimeMap.find(stopTime => stopTime.stop_sequence == stopTimeUpdate.stopSequence);
                                if (stopTime) {
                                    let scheduledTime = stopTime.departure_time_int + tripDate;
                                    // fix scheduled time to UTC
                                    scheduledTime = luxon.DateTime.fromSeconds(scheduledTime, { zone: 'Europe/Zagreb' }).toUTC().toSeconds();
                                    let actualTime = (stopTimeUpdate.departure?.time?.low || stopTimeUpdate.arrival?.time?.low) - scheduledTime;
                                    stopTimeUpdate.departure = stopTimeUpdate.departure || {};
                                    stopTimeUpdate.departure.delay = actualTime;
                                    stopTimeUpdate.arrival = stopTimeUpdate.arrival || {};
                                    stopTimeUpdate.arrival.delay = actualTime;
                                }
                            }
                        }
                        data.push(entity.tripUpdate);
                    }
                }
                // if there are more data2 entries than data entries, use data2
                if (data2.length > data.length) {
                    data = data2;
                }
            }
            RT_DATA = data;
            VP_DATA = vehicleData;
            VP_MAP = vehicle_map;
            VP_MAP2 = vehicle_map2;
            console.log('Updated RT data - ' + RT_DATA.length + ' updates, ' + VP_DATA.length + ' vehicles');
            logVehicles();
        } catch (e) {
            insertIntoLog(e.message + ' ' + e.stack);
            console.error(e);
        }
        await new Promise(resolve => setTimeout(resolve, 10000));
    }
}

async function w_preloadData() {
    while (true) {
        try {
            await preloadData();
        } catch (e) {
            console.error(e);
        }
        await sleep(60000);
    }
}

// mount static files in folder static
app.use(express.static('static'));

app.listen(port, async () => {
    await createTables();
    await loadGtfs();
    getRtData();
    w_preloadData();
    console.log(`Server running on port ${port}`);
});