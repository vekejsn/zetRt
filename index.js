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

const app = express();

let cache = apicache.middleware;

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
    GTFS_UNZIPPED_BASE: 'http://gtfs.mirinda.ts.pirnet.si/gtfs-out/',
    GTFS_RT_TRIP_UPDATES: 'https://zet.hr/gtfs',
}

const createTables = () => {
    const createTables = fs.readFileSync('create_tables.sql', 'utf8');
    sqlite3.exec(createTables);
}

const loadGtfs = async () => {
    createTables();
    console.log('Loading GTFS data...');
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
        let calendar = Papa.parse(await fetch(CONFIG.GTFS_UNZIPPED_BASE + 'calendar.txt').then(response => response.text()), { header: true }).data;
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

        let calendar_dates = Papa.parse(await fetch(CONFIG.GTFS_UNZIPPED_BASE + 'calendar_dates.txt').then(response => response.text()), { header: true }).data;
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

        let routes = Papa.parse(await fetch(CONFIG.GTFS_UNZIPPED_BASE + 'routes.txt').then(response => response.text()), { header: true }).data;
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

        let shapes = Papa.parse(await fetch(CONFIG.GTFS_UNZIPPED_BASE + 'shapes.txt').then(response => response.text()), { header: true }).data;
        console.log('Loaded shapes');
        shapes = shapes.filter(row => Object.values(row).some(cell => cell !== ''));
        let shapesStr = 'INSERT INTO Shapes (shape_id, shape_pt_lat, shape_pt_lon, shape_pt_sequence, shape_dist_traveled) VALUES ';
        let counter = 0;

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
            localShapeStr += '(?, ?, ?, ?, ?),';
            localShapesValues.push(row.shape_id, row.shape_pt_lat, row.shape_pt_lon, row.shape_pt_sequence, row.shape_dist_traveled);
            counter++;
        }
        localShapeStr = localShapeStr.slice(0, -1);
        await sqlite3.prepare(localShapeStr).run(localShapesValues);
        console.log('Inserted shapes');

        shapes = null;
        localShapesValues = null;
        localShapeStr = null;

        let trips = Papa.parse(await fetch(CONFIG.GTFS_UNZIPPED_BASE + 'trips.txt').then(response => response.text()), { header: true }).data;
        console.log('Loaded trips');
        trips = trips.filter(row => Object.values(row).some(cell => cell !== ''));
        let tripsStr = 'INSERT INTO Trips (route_id, service_id, trip_id, trip_headsign, direction_id, block_id, shape_id) VALUES ';
        let tripsValues = [];

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
            counter++;
        }
        localTripsStr = localTripsStr.slice(0, -1);
        await sqlite3.prepare(localTripsStr).run(localTripsValues);
        console.log('Inserted trips');

        trips = null;
        localTripsValues = null;
        localTripsStr = null;

        console.log('Loading stop_times in buffered mode...');
    
        let stopTimesStr = 'INSERT INTO StopTimes (trip_id, arrival_time, arrival_time_int, departure_time, departure_time_int, stop_id, stop_sequence, pickup_type, drop_off_type, shape_dist_traveled) VALUES ';
        let stopTimesValues = [];
        counter = 0;
    
        const stopTimesParser = await Papa.parse(await fetch(CONFIG.GTFS_UNZIPPED_BASE + 'stop_times.txt').then(response => response.body), {
            header: true,
            chunk: async (results, parser) => {
                const rows = results.data;
    
                for (let row of rows) {
                    if (Object.values(row).some(cell => cell !== '')) {
                        stopTimesStr += '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?),';
                        row.arrival_time_int = row.arrival_time.split(':').reduce((acc, time) => (60 * acc) + +time);
                        row.departure_time_int = row.departure_time.split(':').reduce((acc, time) => (60 * acc) + +time);
                        stopTimesValues.push(row.trip_id, row.arrival_time, row.arrival_time_int, row.departure_time, row.departure_time_int, row.stop_id, row.stop_sequence, row.pickup_type, row.drop_off_type, row.shape_dist_traveled);
    
                        counter++;
                        if (counter >= 2500) {
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
            },
            complete: async () => {
                if (stopTimesValues.length > 0) {
                    stopTimesStr = stopTimesStr.slice(0, -1);
                    await sqlite3.prepare(stopTimesStr).run(stopTimesValues);
                    console.log('Inserted final batch of stop_times');
                }
                console.log('Completed processing stop_times.');
            }
        });

        let stops = Papa.parse(await fetch(CONFIG.GTFS_UNZIPPED_BASE + 'stops.txt').then(response => response.text()), { header: true }).data;
        console.log('Loaded stops');
        stops = stops.filter(row => Object.values(row).some(cell => cell !== ''));
        let stopsStr = 'INSERT INTO Stops (stop_id, stop_code, stop_name, stop_desc, stop_lat, stop_lon, zone_id, stop_url, location_type, parent_station) VALUES ';
        let stopsValues = [];

        let localStopsStr = stopsStr;
        let localStopsValues = [];

        counter = 0;

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
            counter++;
        }
        localStopsStr = localStopsStr.slice(0, -1);
        await sqlite3.prepare(localStopsStr).run(localStopsValues);
        console.log('Inserted stops');

        stops = null;
        localStopsValues = null;
        localStopsStr = null;

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
                let stopTimeUpdate = rtUpdate.stopTimeUpdate[0]
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
                        realTime: true
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
                    realTime: false
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
            realTime: RT_DATA.find(rt => rt.trip.tripId == tripId) ? true : false
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
            let tripStopTimes = STOP_TIMES_MAP[trip.trip_id];
            if (!tripStopTimes) continue;
            let startTime = tripStopTimes[0].departure_time_int;
            let endTime = tripStopTimes[tripStopTimes.length - 1].arrival_time_int;
            let RT_UPDATE = getRealTimeUpdate(trip.trip_id);
            endTime += RT_UPDATE.delay;
    
            if (currentTime > startTime && currentTime < endTime) {
                let [lat, lon, bearing] = calculateCurrentPosition(trip, tripStopTimes, SHAPES_MAP, currentTime, RT_UPDATE);
    
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
                        tripHeadsign: trip.trip_headsign,
                        delay: RT_UPDATE.delay,
                        bearing: bearing,
                        realTime: RT_UPDATE.realTime,
                        vehicleId: "XXX"
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

async function getCalendarIds() {
    if (VALID_CALENDAR_IDS.length > 0) return VALID_CALENDAR_IDS;
    let calendar = await sqlite3.prepare('SELECT * FROM Calendar').all();
    let calendar_dates = await sqlite3.prepare('SELECT * FROM CalendarDates').all();
    let validCalendarIds = [];
    let today = luxon.DateTime.now().setZone('Europe/Zagreb').toFormat('yyyyMMdd');
    let dayOfWeek = luxon.DateTime.now().setZone('Europe/Zagreb').toFormat('E');
    console.log('Today is ' + dayOfWeek, today);
    for (let cal of calendar) {
        if (cal[dayOfWeek] == 1 && cal.start_date <= today && cal.end_date >= today) {
            // check if there is an exception
            let exception = await calendar_dates.find(cd => cd.service_id == cal.service_id && cd.date == today);
            if (exception) {
                if (exception.exception_type == 1) {
                    validCalendarIds.push(cal.service_id);
                }
            } else {
                validCalendarIds.push(cal.service_id);
            }
        } else {
            // check if there is an exception
            let exception = await calendar_dates.find(cd => cd.service_id == cal.service_id && cd.date == today);
            if (exception) {
                if (exception.exception_type == 1) {
                    validCalendarIds.push(cal.service_id);
                }
            }
        }
    }
    VALID_CALENDAR_IDS = validCalendarIds;
    return validCalendarIds;
}

async function insertIntoLog(message) {
    try {
        await sqlite3.prepare('INSERT INTO Logs (log_message) VALUES (?)').run(message);
    } catch (e) {
        console.error(e);
    }
}

let RT_DATA = [];

async function getRtData() {
    while (true) {
        try {
            let rtData = await fetch(CONFIG.GTFS_RT_TRIP_UPDATES);
            let feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(await rtData.buffer());
            let data = [];
            for (let entity of feed.entity) {
                if (entity.tripUpdate && entity.tripUpdate.stopTimeUpdate.length > 0) {
                    data.push(entity.tripUpdate);
                }
            }
            RT_DATA = data;
            console.log('Updated RT data - ' + RT_DATA.length + ' updates');
        } catch (e) {
            insertIntoLog(e.message + ' ' + e.stack);
            console.error(e);
        }
        await new Promise(resolve => setTimeout(resolve, 10000));
    }
}

// mount static files in folder static
app.use(express.static('static'));

app.listen(port, async () => {
    await createTables();
    await loadGtfs();
    getRtData();
    preloadData();
    console.log(`Server running on port ${port}`);
});
