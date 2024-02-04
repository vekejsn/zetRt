import { createRequire } from 'module';

import fetch from 'node-fetch';
import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import Papa from 'papaparse';

const require = createRequire(import.meta.url);

const fs = require('fs');
const sqlite3 = require('better-sqlite3')('zet.sqlite3');

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

const CONFIG = {
    GTFS_UNZIPPED_BASE: 'http://gtfs.zet.mirinda.ts.pirnet.si/mod/',
    GTFS_RT_TRIP_UPDATES: 'https://zet.hr/gtfs',
}

const createTables = () => {
    const createTables = fs.readFileSync('create_tables.sql', 'utf8');
    sqlite3.exec(createTables);
}

const loadGtfs = async () => {
    createTables();
    console.log('Loading GTFS data...');
    let calendar = Papa.parse(await fetch(CONFIG.GTFS_UNZIPPED_BASE + 'calendar.txt').then(response => response.text()), { header: true }).data;
    console.log('Loaded calendar');
    let calendar_dates = Papa.parse(await fetch(CONFIG.GTFS_UNZIPPED_BASE + 'calendar_dates.txt').then(response => response.text()), { header: true }).data;
    console.log('Loaded calendar_dates');
    let routes = Papa.parse(await fetch(CONFIG.GTFS_UNZIPPED_BASE + 'routes.txt').then(response => response.text()), { header: true }).data;
    console.log('Loaded routes');
    let shapes = Papa.parse(await fetch(CONFIG.GTFS_UNZIPPED_BASE + 'shapes.txt').then(response => response.text()), { header: true }).data;
    console.log('Loaded shapes');
    let stop_times = Papa.parse(await fetch(CONFIG.GTFS_UNZIPPED_BASE + 'stop_times.txt').then(response => response.text()), { header: true }).data;
    console.log('Loaded stop_times');
    let stops = Papa.parse(await fetch(CONFIG.GTFS_UNZIPPED_BASE + 'stops.txt').then(response => response.text()), { header: true }).data;
    console.log('Loaded stops');
    let trips = Papa.parse(await fetch(CONFIG.GTFS_UNZIPPED_BASE + 'trips.txt').then(response => response.text()), { header: true }).data;
    console.log('Loaded trips');

    // remove empty rows
    calendar = calendar.filter(row => Object.values(row).some(cell => cell !== ''));
    calendar_dates = calendar_dates.filter(row => Object.values(row).some(cell => cell !== ''));
    routes = routes.filter(row => Object.values(row).some(cell => cell !== ''));
    shapes = shapes.filter(row => Object.values(row).some(cell => cell !== ''));
    stop_times = stop_times.filter(row => Object.values(row).some(cell => cell !== ''));
    stops = stops.filter(row => Object.values(row).some(cell => cell !== ''));
    trips = trips.filter(row => Object.values(row).some(cell => cell !== ''));


    // Clear tables
    sqlite3.exec('DELETE FROM Calendar;');
    sqlite3.exec('DELETE FROM CalendarDates;');
    sqlite3.exec('DELETE FROM Routes;');
    sqlite3.exec('DELETE FROM StopTimes;');
    sqlite3.exec('DELETE FROM Trips;');
    sqlite3.exec('DELETE FROM Shapes;');
    sqlite3.exec('DELETE FROM Stops;');

    try {
        // Insert data
        let calendarStr = 'INSERT INTO Calendar (service_id, monday, tuesday, wednesday, thursday, friday, saturday, sunday, start_date, end_date) VALUES ';
        let calendarValues = [];

        for (let row of calendar) {
            calendarStr += '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?),';
            calendarValues.push(row.service_id, row.monday, row.tuesday, row.wednesday, row.thursday, row.friday, row.saturday, row.sunday, row.start_date, row.end_date);
        }
        calendarStr = calendarStr.slice(0, -1);
        sqlite3.prepare(calendarStr).run(calendarValues);
        console.log('Inserted calendar');

        let calendarDatesStr = 'INSERT INTO CalendarDates (service_id, date, exception_type) VALUES ';
        let calendarDatesValues = [];

        for (let row of calendar_dates) {
            calendarDatesStr += '(?, ?, ?),';
            calendarDatesValues.push(row.service_id, row.date, row.exception_type);
        }
        calendarDatesStr = calendarDatesStr.slice(0, -1);
        await sqlite3.prepare(calendarDatesStr).run(calendarDatesValues);
        console.log('Inserted calendar_dates');

        let routesStr = 'INSERT INTO Routes (route_id, route_short_name, route_long_name, route_type, route_color, route_text_color) VALUES ';
        let routesValues = [];

        for (let row of routes) {
            routesStr += '(?, ?, ?, ?, ?, ?),';
            routesValues.push(row.route_id, row.route_short_name, row.route_long_name, row.route_type, row.route_color, row.route_text_color);
        }
        routesStr = routesStr.slice(0, -1);
        await sqlite3.prepare(routesStr).run(routesValues);
        console.log('Inserted routes');

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

        let stopTimesStr = 'INSERT INTO StopTimes (trip_id, arrival_time, arrival_time_int, departure_time, departure_time_int, stop_id, stop_sequence, pickup_type, drop_off_type, shape_dist_traveled) VALUES ';
        let stopTimesValues = [];

        let localStopTimesStr = stopTimesStr;
        let localStopTimesValues = [];

        counter = 0;

        for (let row of stop_times) {
            if (counter == 2500) {
                localStopTimesStr = localStopTimesStr.slice(0, -1);
                await sqlite3.prepare(localStopTimesStr).run(localStopTimesValues);
                localStopTimesStr = stopTimesStr;
                localStopTimesValues = [];
                counter = 0;
            }
            localStopTimesStr += '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?),';
            row.arrival_time_int = await row.arrival_time.split(':').reduce((acc, time) => (60 * acc) + +time);
            row.departure_time_int = await row.departure_time.split(':').reduce((acc, time) => (60 * acc) + +time);
            localStopTimesValues.push(row.trip_id, row.arrival_time, row.arrival_time_int, row.departure_time, row.departure_time_int, row.stop_id, row.stop_sequence, row.pickup_type, row.drop_off_type, row.shape_dist_traveled);
            counter++;
        }
        localStopTimesStr = localStopTimesStr.slice(0, -1);
        await sqlite3.prepare(localStopTimesStr).run(localStopTimesValues);
        console.log('Inserted stop_times');

        let stopsStr = 'INSERT INTO Stops (stop_id, stop_code, stop_name, stop_desc, stop_lat, stop_lon, zone_id, stop_url, location_type, parent_station) VALUES ';
        let stopsValues = [];

        let localStopsStr = stopsStr;
        let localStopsValues = [];

        counter = 0;

        for (let row of stops) {
            if (counter == 1000) {
                localStopsStr = localStopsStr.slice(0, -1);
                await sqlite3.prepare(localStopsStr).run(localStopsValues);
                localStopsStr = stopsStr;
                localStopsValues = [];
                counter = 0;
            }
            stopsStr += '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?),';
            stopsValues.push(row.stop_id, row.stop_code, row.stop_name, row.stop_desc, row.stop_lat, row.stop_lon, row.zone_id, row.stop_url, row.location_type, row.parent_station);
        }
        stopsStr = stopsStr.slice(0, -1);
        await sqlite3.prepare(stopsStr).run(stopsValues);
        console.log('Inserted stops');

    } catch (e) {
        console.error(e);
    }

    let b = 0;
}

loadGtfs();