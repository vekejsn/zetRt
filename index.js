import { createRequire } from 'module';

import fetch from 'node-fetch';
import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import Papa from 'papaparse';

const CANCELED_TRIP = GtfsRealtimeBindings.transit_realtime.TripDescriptor.ScheduleRelationship.CANCELED;

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

// CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    next();
});

const CONFIG = {
    GTFS_ZIPPED: 'https://www.zet.hr/gtfs-scheduled/latest',
    GTFS_RT_TRIP_UPDATES: 'https://zet.hr/gtfs-rt-protobuf',
}

const createTables = async () => {
    const createTables = fs.readFileSync('create_tables.sql', 'utf8');
    sqlite3.exec(createTables);
    // iterate over files in migrations folder and execute them
    const migrations = fs.readdirSync('migrations');
    // Sort migrations by first 4 digits (version number)
    const sorted_migrations = await migrations.sort((a, b) => {
        const versionA = parseInt(a.split('_')[0]);
        const versionB = parseInt(b.split('_')[0]);
        return versionA - versionB;
    });
    for (let migration of sorted_migrations) {
        try {
            const sql = await fs.readFileSync(`migrations/${migration}`, 'utf8');
            await sqlite3.exec(sql);
        } catch (e) {
            console.error(e);
        }
    }
}

const GTFS_FILES = {
    calendar: { file: 'calendar.txt', headers: ['service_id', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'start_date', 'end_date'] },
    calendarDates: { file: 'calendar_dates.txt', headers: ['service_id', 'date', 'exception_type'] },
    routes: { file: 'routes.txt', headers: ['route_id', 'route_short_name', 'route_long_name', 'route_type'] },
    shapes: { file: 'shapes.txt', headers: ['shape_id', 'shape_pt_lat', 'shape_pt_lon', 'shape_pt_sequence'] },
    trips: { file: 'trips.txt', headers: ['route_id', 'service_id', 'trip_id'] },
    stops: { file: 'stops.txt', headers: ['stop_id', 'stop_name', 'stop_lat', 'stop_lon'] },
    stopTimes: { file: 'stop_times.txt', headers: ['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence'] }
};

function parseGtfsCsv(zip, definition) {
    const entry = zip.getEntry(definition.file);
    if (!entry) throw new Error(`GTFS is missing required file ${definition.file}`);
    const parsed = Papa.parse(entry.getData().toString('utf8'), { header: true, skipEmptyLines: 'greedy' });
    if (parsed.errors.length > 0) throw new Error(`${definition.file} could not be parsed: ${parsed.errors[0].message}`);
    const headers = parsed.meta.fields || [];
    const missingHeaders = definition.headers.filter(header => !headers.includes(header));
    if (missingHeaders.length > 0) throw new Error(`${definition.file} is missing headers: ${missingHeaders.join(', ')}`);
    return parsed.data.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value])));
}

function parseServiceTime(value) {
    const match = /^(\d{1,3}):([0-5]\d):([0-5]\d)$/.exec(value || '');
    return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : null;
}

function isFiniteCoordinate(value, min, max) {
    const coordinate = Number(value);
    return Number.isFinite(coordinate) && coordinate >= min && coordinate <= max;
}

function distanceInMeters(a, b) {
    const toRadians = degrees => degrees * Math.PI / 180;
    const dLat = toRadians(Number(b.shape_pt_lat) - Number(a.shape_pt_lat));
    const dLon = toRadians(Number(b.shape_pt_lon) - Number(a.shape_pt_lon));
    const lat1 = toRadians(Number(a.shape_pt_lat));
    const lat2 = toRadians(Number(b.shape_pt_lat));
    const value = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
    return 6371000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function getActiveCalendarIds(calendar, calendarDates) {
    const now = luxon.DateTime.now().setZone('Europe/Zagreb');
    const dates = [now, ...(now.hour < 4 ? [now.minus({ days: 1 })] : [])];
    const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const active = new Set();
    for (const dateTime of dates) {
        const date = dateTime.toFormat('yyyyMMdd');
        const day = weekdays[dateTime.weekday - 1];
        for (const service of calendar) {
            const exception = calendarDates.find(item => item.service_id === service.service_id && item.date === date);
            if (exception?.exception_type === '1' || exception?.exception_type === 1 || (!exception && service[day] === '1' && service.start_date <= date && service.end_date >= date)) {
                active.add(service.service_id);
            }
        }
    }
    return [...active];
}

async function getFallbackGtfsUrl() {
    const response = await fetch('https://zet.hr/gtfs2', { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`GTFS archive listing returned HTTP ${response.status}`);
    const files = [...(await response.text()).matchAll(/<a href="\/gtfs-scheduled\/scheduled-([0-9-]+)\.zip">/g)].map(match => match[1]);
    if (files.length < 2) throw new Error('GTFS archive listing has no fallback feed');
    return `https://zet.hr/gtfs-scheduled/scheduled-${files[1]}.zip`;
}

const loadGtfs = async (url, usedFallback = false) => {
    await createTables();
    console.log('Loading GTFS data...');
    try {
        const response = await fetch(url || CONFIG.GTFS_ZIPPED, { signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw new Error(`GTFS download returned HTTP ${response.status}`);
        const gtfsZip = await response.buffer();
        if (gtfsZip.length < 100) throw new Error('GTFS download is unexpectedly small');
        const zip = new AdmZip(gtfsZip);
        const feed = Object.fromEntries(Object.entries(GTFS_FILES).map(([key, definition]) => [key, parseGtfsCsv(zip, definition)]));
        if (feed.routes.length === 0 || feed.trips.length === 0 || feed.stops.length === 0 || feed.stopTimes.length === 0) {
            throw new Error('GTFS has no routes, trips, stops, or stop times');
        }
        if (getActiveCalendarIds(feed.calendar, feed.calendarDates).length === 0) {
            if (usedFallback) throw new Error('GTFS fallback has no active services');
            console.error('GTFS has no active services; trying fallback archive');
            return loadGtfs(await getFallbackGtfsUrl(), true);
        }
        fs.writeFileSync('gtfs.zip', gtfsZip);
        zip.extractAllTo('./gtfs', true);
        console.log('Downloaded and validated GTFS data');

        const routes = new Set(feed.routes.map(row => row.route_id).filter(Boolean));
        const stops = new Map(feed.stops.filter(row => row.stop_id && isFiniteCoordinate(row.stop_lat, -90, 90) && isFiniteCoordinate(row.stop_lon, -180, 180)).map(row => [row.stop_id, row]));
        const shapes = new Map();
        for (const row of feed.shapes) {
            if (!row.shape_id || !isFiniteCoordinate(row.shape_pt_lat, -90, 90) || !isFiniteCoordinate(row.shape_pt_lon, -180, 180) || !Number.isFinite(Number(row.shape_pt_sequence))) continue;
            if (!shapes.has(row.shape_id)) shapes.set(row.shape_id, []);
            shapes.get(row.shape_id).push(row);
        }
        for (const points of shapes.values()) {
            points.sort((a, b) => Number(a.shape_pt_sequence) - Number(b.shape_pt_sequence));
            let distance = 0;
            points.forEach((point, index) => {
                if (index > 0) distance += distanceInMeters(points[index - 1], point);
                point.shape_dist_traveled = distance;
            });
        }
        const serviceIds = new Set([...feed.calendar, ...feed.calendarDates].map(row => row.service_id).filter(Boolean));
        const trips = new Map(feed.trips.filter(row => row.trip_id && routes.has(row.route_id) && serviceIds.has(row.service_id)).map(row => [row.trip_id, row]));
        const stopTimes = [];
        let skippedStopTimes = 0;
        const stopTimesByTrip = new Map();
        for (const row of feed.stopTimes) {
            const arrival = parseServiceTime(row.arrival_time);
            const departure = parseServiceTime(row.departure_time);
            const trip = trips.get(row.trip_id);
            const stop = stops.get(row.stop_id);
            if (!trip || !stop || arrival === null || departure === null || !Number.isFinite(Number(row.stop_sequence))) {
                skippedStopTimes++;
                continue;
            }
            if (!stopTimesByTrip.has(row.trip_id)) stopTimesByTrip.set(row.trip_id, { trip, rows: [] });
            stopTimesByTrip.get(row.trip_id).rows.push({ row, stop, arrival, departure });
        }
        const shapeDistancesByPattern = new Map();
        for (const { trip, rows } of stopTimesByTrip.values()) {
            rows.sort((a, b) => Number(a.row.stop_sequence) - Number(b.row.stop_sequence));
            const patternKey = `${trip.shape_id}\0${rows.map(({ row }) => row.stop_id).join('\0')}`;
            let shapeDistances = shapeDistancesByPattern.get(patternKey);
            if (!shapeDistances) {
                const points = shapes.get(trip.shape_id) || [];
                let firstShapePoint = 0;
                shapeDistances = rows.map(({ stop }) => {
                    let nearest = { index: firstShapePoint, distance: Infinity, value: 0 };
                    for (let index = firstShapePoint; index < points.length; index++) {
                        const distance = distanceInMeters({ shape_pt_lat: stop.stop_lat, shape_pt_lon: stop.stop_lon }, points[index]);
                        if (distance < nearest.distance) nearest = { index, distance, value: points[index].shape_dist_traveled };
                    }
                    firstShapePoint = nearest.index;
                    return nearest.value;
                });
                shapeDistancesByPattern.set(patternKey, shapeDistances);
            }
            rows.forEach(({ row, arrival, departure }, index) => {
                stopTimes.push({ ...row, arrival_time_int: arrival, departure_time_int: departure, shape_dist_traveled: shapeDistances[index] });
            });
        }
        if (stopTimes.length === 0) throw new Error('GTFS has no valid stop times');

        const insertRows = (table, columns, rows) => {
            if (rows.length === 0) return;
            const placeholders = `(${columns.map(() => '?').join(', ')})`;
            const statement = sqlite3.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ${placeholders}`);
            for (const row of rows) statement.run(columns.map(column => row[column] ?? ''));
        };
        sqlite3.transaction(() => {
            sqlite3.exec('DELETE FROM Calendar; DELETE FROM CalendarDates; DELETE FROM Routes; DELETE FROM StopTimes; DELETE FROM Trips; DELETE FROM Shapes; DELETE FROM Stops;');
            insertRows('Calendar', GTFS_FILES.calendar.headers, feed.calendar);
            insertRows('CalendarDates', GTFS_FILES.calendarDates.headers, feed.calendarDates);
            insertRows('Routes', ['route_id', 'route_short_name', 'route_long_name', 'route_type', 'route_color', 'route_text_color'], feed.routes);
            insertRows('Shapes', ['shape_id', 'shape_pt_lat', 'shape_pt_lon', 'shape_pt_sequence', 'shape_dist_traveled'], [...shapes.values()].flat());
            insertRows('Trips', ['route_id', 'service_id', 'trip_id', 'trip_headsign', 'direction_id', 'block_id', 'shape_id'], [...trips.values()]);
            insertRows('Stops', ['stop_id', 'stop_code', 'stop_name', 'stop_desc', 'stop_lat', 'stop_lon', 'zone_id', 'stop_url', 'location_type', 'parent_station'], [...stops.values()]);
            insertRows('StopTimes', ['trip_id', 'arrival_time', 'arrival_time_int', 'departure_time', 'departure_time_int', 'stop_id', 'stop_sequence', 'pickup_type', 'drop_off_type', 'shape_dist_traveled'], stopTimes);
            sqlite3.exec(`UPDATE Stops SET stop_type = 0;
                UPDATE Stops SET stop_type = 1 WHERE stop_id IN (SELECT DISTINCT st.stop_id FROM StopTimes st JOIN Trips t ON st.trip_id = t.trip_id JOIN Routes r ON t.route_id = r.route_id WHERE r.route_type = 0);
                UPDATE Stops SET stop_type = 2 WHERE stop_id IN (SELECT DISTINCT st.stop_id FROM StopTimes st JOIN Trips t ON st.trip_id = t.trip_id JOIN Routes r ON t.route_id = r.route_id WHERE r.route_type = 3) AND stop_type != 1;`);
        })();
        VALID_CALENDAR_IDS = [];
        lastCalendarSync = 0;
        console.log(`Imported GTFS data (${stopTimes.length} stop times, ${skippedStopTimes} invalid rows skipped)`);
    } catch (error) {
        console.error('GTFS import failed; keeping the previous feed:', error);
        await insertIntoLog(`GTFS import failed: ${error.message}`);
    }
}

/*
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

        // Attempt to validate that there is in fact an active service for today
        let services = await getCalendarIds();
        if (services.length === 0) {
            console.error('No active services for today');
            // Fetch zet.hr/gtfs2 and regex match the URL's that are of the format <a href="/gtfs-scheduled/scheduled-*">
            // Then download the file and extract it
            let re = /<a href="\/gtfs-scheduled\/scheduled-([0-9\-]+)\.zip">/g
            let gtfs2 = await fetch('https://zet.hr/gtfs2').then(response => response.text());
            let matches = [...gtfs2.matchAll(re)];
            // We should take the 2nd match, as the first one is the latest that in fact doesn't work for today
            let files = matches.map(match => match[1]);
            console.log('Available files:', files);
            let gtfs2Url = `https://zet.hr/gtfs-scheduled/scheduled-${files[1]}.zip`;
            return await loadGtfs(gtfs2Url);
        }

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
            if (!shapeMap[row.shape_id]) {
                shapeMap[row.shape_id] = [];
            }
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
                        if (stopTimesStr.endsWith(',')) {
                            stopTimesStr = stopTimesStr.slice(0, -1);
                        }
                        await sqlite3.prepare(stopTimesStr).run(stopTimesValues);
                    } catch (e) {
                        console.error(e);
                    }
                    console.log('Inserted final batch of stop_times');
                }
                console.log('Completed processing stop_times.');

                // Update stop_type in Stops table by cross-referencing route->trip->stop_times
                try {
                    // Ensure stop_type column exists
                    const columns = await sqlite3.prepare("PRAGMA table_info(Stops)").all();
                    const hasStopType = columns.some(col => col.name === 'stop_type');
                    if (!hasStopType) {
                        await sqlite3.prepare("ALTER TABLE Stops ADD COLUMN stop_type INTEGER DEFAULT 0").run();
                        console.log('Added stop_type column to Stops table');
                    }

                    // Reset all stop types to unknown (0)
                    await sqlite3.prepare("UPDATE Stops SET stop_type = 0").run();

                    // Set tram stops (route_type = 0)
                    await sqlite3.prepare(`
            UPDATE Stops SET stop_type = 1
            WHERE stop_id IN (
                SELECT DISTINCT StopTimes.stop_id
                FROM StopTimes
                JOIN Trips ON StopTimes.trip_id = Trips.trip_id
                JOIN Routes ON Trips.route_id = Routes.route_id
                WHERE Routes.route_type = 0
            )
        `).run();

                    // Set bus stops (route_type = 3), but only if not already set as tram
                    await sqlite3.prepare(`
            UPDATE Stops SET stop_type = 2
            WHERE stop_id IN (
                SELECT DISTINCT StopTimes.stop_id
                FROM StopTimes
                JOIN Trips ON StopTimes.trip_id = Trips.trip_id
                JOIN Routes ON Trips.route_id = Routes.route_id
                WHERE Routes.route_type = 3
            )
            AND stop_type != 1
        `).run();

                    console.log('Updated stop_type values in Stops table');
                } catch (e) {
                    console.error('Error updating stop_type values:', e);
                }

                addActiveTripsToDb();
                                try {
                    // Find all trips with missing shapes (shape_id is empty or not present in Shapes)
                    const tripsWithoutShapes = await sqlite3.prepare(`
                        SELECT t.trip_id, t.shape_id
                        FROM Trips t
                        LEFT JOIN Shapes s ON t.shape_id = s.shape_id
                        WHERE s.shape_id IS NULL OR t.shape_id IS NULL OR t.shape_id = ''
                    `).all();

                    if (tripsWithoutShapes.length > 0) {
                        // Group by md5 hash of stop_ids in sequence
                        const shapeGroups = {};
                        for (const trip of tripsWithoutShapes) {
                            // Get stop_ids in order for this trip
                            const stopIds = await sqlite3.prepare(`
                                SELECT stop_id FROM StopTimes WHERE trip_id = ? ORDER BY stop_sequence ASC
                            `).all(trip.trip_id);
                            const stopIdSeq = stopIds.map(row => row.stop_id).join(',');
                            // Use a simple JS hash as a fallback if crypto.createHash is not available
                            let hash = String(
                                stopIdSeq.split('').reduce((a, c) => ((a << 5) - a) + c.charCodeAt(0), 0)
                            );
                            if (!shapeGroups[hash]) shapeGroups[hash] = [];
                            shapeGroups[hash].push(trip.trip_id);
                        }

                        for (const shapeKey of Object.keys(shapeGroups)) {
                            // For each group, get the stop sequence for one trip
                            const tripId = shapeGroups[shapeKey][0];
                            const stopTimes = await sqlite3.prepare(`
                                SELECT st.stop_id, s.stop_lat, s.stop_lon, st.stop_sequence
                                FROM StopTimes st
                                JOIN Stops s ON st.stop_id = s.stop_id
                                WHERE st.trip_id = ?
                                ORDER BY st.stop_sequence ASC
                            `).all(tripId);

                            if (stopTimes.length < 2) continue;

                            // Build coordinates string for OSRM
                            const coords = stopTimes.map(st => `${st.stop_lon},${st.stop_lat}`).join(';');
                            const osrmUrl = `https://osrm.brdo.pirnet.si/hrroute/v1/driving/${coords}?overview=full&geometries=geojson`;

                            try {
                                const osrmRes = await fetch(osrmUrl);
                                if (!osrmRes.ok) {
                                    console.error(`OSRM fetch failed for shape ${shapeKey}: ${osrmRes.statusText}`);
                                    continue;
                                }
                                const osrmJson = await osrmRes.json();
                                if (!osrmJson.routes || !osrmJson.routes[0] || !osrmJson.routes[0].geometry) {
                                    console.error(`No geometry from OSRM for shape ${shapeKey}`);
                                    continue;
                                }
                                const geometry = osrmJson.routes[0].geometry.coordinates;

                                // Insert the shape into Shapes table
                                let shapeInsertStr = 'INSERT INTO Shapes (shape_id, shape_pt_lat, shape_pt_lon, shape_pt_sequence, shape_dist_traveled) VALUES ';
                                let shapeInsertValues = [];
                                let dist = 0;
                                for (let i = 0; i < geometry.length; i++) {
                                    const [lon, lat] = geometry[i];
                                    if (i > 0) {
                                        // Calculate distance from previous point (approximate)
                                        const prev = geometry[i - 1];
                                        const dLat = lat - prev[1];
                                        const dLon = lon - prev[0];
                                        dist += Math.sqrt(dLat * dLat + dLon * dLon) * 100000; // crude meters
                                    }
                                    shapeInsertStr += '(?, ?, ?, ?, ?),';
                                    shapeInsertValues.push(shapeKey, lat, lon, i + 1, dist);
                                }
                                shapeInsertStr = shapeInsertStr.slice(0, -1);
                                await sqlite3.prepare(shapeInsertStr).run(shapeInsertValues);

                                // Update all trips in this group to use this shape_id
                                await sqlite3.prepare(
                                    `UPDATE Trips SET shape_id = ? WHERE trip_id IN (${shapeGroups[shapeKey].map(() => '?').join(',')})`
                                ).run(shapeKey, ...shapeGroups[shapeKey]);

                                console.log(`Fetched and inserted OSRM shape for ${shapeKey} (trips: ${shapeGroups[shapeKey].join(', ')})`);
                            } catch (err) {
                                console.error(`Error fetching/inserting OSRM shape for ${shapeKey}:`, err);
                            }
                        }
                    }
                } catch (err) {
                    console.error('Error checking/fetching missing shapes:', err);
                }
            }

        });

    } catch (e) {
        console.error(e);
    }

}
*/

const port = 8910;

app.get('/stops', cache('1 hour'), (req, res) => {
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
                parentId: stop.parent_station,
                stopType: stop.stop_type || 2, // Default to 0 if stop_type is not set
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
                const canceled = !!rtUpdate.canceled;
                let stopTimeUpdate = getDelayForStop(rtUpdate, stopTime.stop_sequence);
                if (canceled) {
                    if (req.query.current && secondsFromMidnight > stopTime.departure_time_int) continue;
                    if (req.query.time && secondsFromMidnight + req.query.time < stopTime.departure_time_int) continue;
                    formattedStopTimes.push({
                        tripId: stopTime.trip_id,
                        tripHeadsign: stopTime.trip_headsign,
                        routeId: stopTime.route_id,
                        routeShortName: stopTime.route_short_name,
                        routeLongName: stopTime.route_long_name,
                        routeType: stopTime.route_type,
                        arrivalTime: stopTime.arrival_time_int,
                        departureTime: stopTime.departure_time_int,
                        arrivalDelay: 0,
                        departureDelay: 0,
                        blockId: stopTime.block_id,
                        realTime: true,
                        canceled: true,
                        vehicleId: null
                    });
                    continue;
                }
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
                        routeType: stopTime.route_type,
                        arrivalTime: stopTime.departure_time_int + (stopTimeUpdate.arrival && stopTimeUpdate.arrival.delay ? stopTimeUpdate.arrival.delay : 0),
                        departureTime: stopTime.departure_time_int + (stopTimeUpdate.departure && stopTimeUpdate.departure.delay ? stopTimeUpdate.departure.delay : 0),
                        arrivalDelay: stopTimeUpdate.arrival && stopTimeUpdate.arrival.delay ? stopTimeUpdate.arrival.delay : 0,
                        departureDelay: stopTimeUpdate.departure && stopTimeUpdate.departure.delay ? stopTimeUpdate.departure.delay : 0,
                        blockId: stopTime.block_id,
                        realTime: true,
                        vehicleId: VP_MAP[stopTime.trip_id] || rtUpdate.vehicle?.id || 'XXX',
                        canceled: false
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
                    routeType: stopTime.route_type,
                    arrivalTime: stopTime.arrival_time_int,
                    departureTime: stopTime.departure_time_int,
                    arrivalDelay: 0,
                    departureDelay: 0,
                    blockId: stopTime.block_id,
                    realTime: false,
                    vehicleId: VP_MAP[stopTime.trip_id] || 'XXX',
                    canceled: false
                });
            }
        }
        res.json(formattedStopTimes);
    } catch (e) {
        insertIntoLog(e.message + ' ' + e.stack);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

function getDelayForStop(rtUpdate, currentSequence) {
  if (!rtUpdate || !rtUpdate.stopTimeUpdate) return null;

  let closestUpdate = null;

  for (const update of rtUpdate.stopTimeUpdate) {
    if (update.stopSequence <= currentSequence) {
      if (!closestUpdate || update.stopSequence > closestUpdate.stopSequence) {
        closestUpdate = update;
      }
    }
  }

  return closestUpdate || null;
}

app.get('/trips/:id', cache('30 seconds'), async (req, res) => {
    try {
        let tripId = req.params.id;
        let trip = await sqlite3.prepare('SELECT * FROM Trips JOIN Routes ON Trips.route_id = Routes.route_id WHERE trip_id = ?').get(tripId);
        if (!trip) {
            res.status(404).json({ message: 'Trip not found' });
            return;
        }
        let stopTimes = await sqlite3.prepare('SELECT * FROM StopTimes JOIN Stops ON StopTimes.stop_id = Stops.stop_id WHERE trip_id = ? ORDER BY stop_sequence').all(tripId);
        const rtUpdate = RT_DATA.find(rt => rt.trip.tripId == tripId);
        const canceled = !!rtUpdate?.canceled;
        let formattedStopTimes = [];
        for (let stopTime of stopTimes) {
            // check if there is a real time update
            if (rtUpdate) {
                // find the stopTimeUpdate closest to the current stop, so we can apply the correct delay
                // e.g. if stoptimeupdates are defined for stops 7, 9 - for stops 1-8 we apply the delay of stop 7, for stops 9+ we apply the delay of stop 9
                let stopTimeUpdate = await getDelayForStop(rtUpdate, stopTime.stop_sequence);
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
                        realTime: true,
                        canceled
                    });
                } else {
                    // if there is no update for this stop, use the original stop time
                    formattedStopTimes.push({
                        stopId: stopTime.stop_id,
                        stopName: stopTime.stop_name,
                        stopSequence: stopTime.stop_sequence,
                        arrivalTime: stopTime.arrival_time_int,
                        departureTime: stopTime.departure_time_int,
                        arrivalDelay: 0,
                        departureDelay: 0,
                        realTime: false,
                        canceled
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
                    realTime: false,
                    canceled: false
                });
            }
        }
        res.json({
            tripId: trip.trip_id,
            routeId: trip.route_id,
            routeShortName: trip.route_short_name,
            routeType: trip.route_type,
            routeLongName: trip.route_long_name,
            tripHeadsign: trip.trip_headsign,
            directionId: trip.direction_id,
            stopTimes: formattedStopTimes,
            blockId: trip.block_id,
            realTime: !!rtUpdate,
            canceled,
            vehicleId: canceled ? null : VP_MAP[tripId] || rtUpdate?.vehicle?.id || 'XXX'
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
        if (shape.length > 0) {

            for (let point of shape) {
                geoJson.geometry.coordinates.push([point.shape_pt_lon, point.shape_pt_lat]);
            }
        } else {
            // Fetch the locations of the stops for this trip
            let stopTimes = await sqlite3.prepare('SELECT s.stop_lat, s.stop_lon FROM StopTimes st JOIN Stops s ON st.stop_id = s.stop_id WHERE st.trip_id = ? ORDER BY st.stop_sequence').all(tripId);
            geoJson.geometry.coordinates = stopTimes.map(stop => [stop.stop_lon, stop.stop_lat]);
        }
        res.json(geoJson);
    } catch (e) {
        insertIntoLog(e.message + ' ' + e.stack);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});


app.get('/routes', cache('30 minutes'), async (req, res) => {
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
            const canceled = !!rt?.canceled;
            const delay = rt?.stopTimeUpdate?.[0]?.departure?.delay || rt?.stopTimeUpdate?.[0]?.arrival?.delay || 0;
            if (req.query.current) {
                if (secondsFromMidnight > await endTimes.find(st => st.trip_id == trip.trip_id).end_time + delay) {
                    continue;
                }
            }
            if (req.query.time) {
                // time is expressed in seconds, so skip trips that are too far in the future
                if (secondsFromMidnight + req.query.time < await startTimes.find(st => st.trip_id == trip.trip_id).start_time + delay) {
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
                canceled,
                blockId: trip.block_id,
                vehicleId: canceled ? null : VP_MAP[trip.trip_id] || 'XXX',
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
        let vehicleIds = await sqlite3.prepare('SELECT DISTINCT vehicle_id FROM VehicleDispatches ORDER BY vehicle_id').all();
        let formattedVehicleIds = [];
        for (let vehicleId of vehicleIds) {
            formattedVehicleIds.push(vehicleId.vehicle_id);
        }
        // sort by parseInt value
        formattedVehicleIds = await formattedVehicleIds.sort((a, b) => parseInt(a) - parseInt(b));
        res.json(formattedVehicleIds);
    } catch (e) {
        insertIntoLog(e.message + ' ' + e.stack);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

app.get('/historic/vehicleids/details', cache('1 minute'), async (req, res) => {
    try {
        let vehicleIds = await sqlite3.prepare(`
            select vehicle_id, route_short_name, block_id, max(date) as date, max(start_time) as start_time from VehicleDispatches
            group by vehicle_id
            ORDER BY CAST(vehicle_id AS INTEGER) ASC;
        `).all();
        let formattedVehicleIds = [];
        for (let vehicleId of vehicleIds) {
            formattedVehicleIds.push({
                vehicleId: vehicleId.vehicle_id,
                blockId: vehicleId.block_id,
                date: vehicleId.date,
                routeShortName: vehicleId.route_short_name,
                startTime: vehicleId.start_time
            });
        }
        // sort by integer of vehicle_id
        formattedVehicleIds = await formattedVehicleIds.sort((a, b) => parseInt(a.vehicleId) - parseInt(b.vehicleId));
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
        let entries = await sqlite3.prepare(`SELECT DISTINCT
                block_id,
                date,
                route_short_name,
                (SELECT GROUP_CONCAT(start_time, ', ')
                FROM VehicleDispatches AS vd2
                WHERE vd2.block_id = vd1.block_id AND vd2.date = vd1.date AND vd2.vehicle_id = vd1.vehicle_id AND vd2.route_short_name = vd1.route_short_name
                ORDER BY start_time ASC
                ) AS start_times
            FROM VehicleDispatches AS vd1
            WHERE vehicle_id = ?
            ORDER BY date DESC
            LIMIT 30 OFFSET ?
        `).all(vehicleId, offset);
        let formattedEntries = [];
        for (let entry of entries) {
            formattedEntries.push({
                date: entry.date,
                tripId: entry.trip_id,
                routeShortName: entry.route_short_name,
                tripHeadsign: entry.trip_headsign,
                startTime: entry.start_time,
                blockId: entry.block_id,
                departures: entry.start_times.split(', ')
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
    let delay = RT_UPDATE?.stopTimeUpdate?.[0]?.departure?.delay || RT_UPDATE?.stopTimeUpdate?.[0]?.arrival?.delay || 0;
    return { delay, realTime: !!RT_UPDATE, canceled: !!RT_UPDATE?.canceled };
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
    if (!tripShape) {
        // give the GPS coordinates of the vehicle);
        let vl_update = VP_MAP2[trip.trip_id];
        if (!vl_update) {
            return [0, 0, 0];
        }
        return [vl_update.position.latitude, vl_update.position.longitude, vl_update.position.bearing || calculateBearingFromGPS(vl_update.position, VP_MAP2_OLD[trip.trip_id]?.position)];
    }
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
let TRIP_IDS = []   
let TRIP_IDS_BY_SUFFIX = new Map();
let SHAPES_MAP = [];
let STOP_TIMES_MAP = [];

async function preloadData() {
    let calendar = await getCalendarIds();
    console.log('Valid calendar ids', calendar);
    TRIPS = await sqlite3.prepare('SELECT * FROM Trips JOIN Routes ON Trips.route_id = Routes.route_id WHERE service_id IN (' + calendar.map(() => '?').join(',') + ')').all(calendar);
    let shapeIds = await TRIPS.map(trip => trip.shape_id);
    TRIP_IDS = await TRIPS.map(trip => trip.trip_id);
    const tripIdsBySuffix = new Map();
    for (const tripId of TRIP_IDS) {
        const suffix = tripId.split('_').slice(2).join('_');
        if (!suffix) continue;
        tripIdsBySuffix.set(suffix, tripIdsBySuffix.has(suffix) ? null : tripId);
    }
    TRIP_IDS_BY_SUFFIX = tripIdsBySuffix;
    console.log('Have trips', TRIPS.length, 'shape ids', shapeIds.length, 'trip ids', TRIP_IDS.length);
    SHAPES_MAP = await sqlite3.prepare(
    'SELECT * FROM Shapes WHERE shape_id IN (' + shapeIds.map(() => '?').join(',') + ') ORDER BY shape_pt_sequence'
    ).all(shapeIds);
    SHAPES_MAP = SHAPES_MAP.reduce((acc, shape) => {
        if (!acc[shape.shape_id]) acc[shape.shape_id] = [];
        acc[shape.shape_id].push(shape);
        return acc;
    }
        , {});
    STOP_TIMES_MAP = await sqlite3.prepare('SELECT * FROM StopTimes WHERE trip_id IN (' + TRIP_IDS.map(() => '?').join(',') + ')').all(TRIP_IDS);
    STOP_TIMES_MAP = STOP_TIMES_MAP.reduce((acc, stopTime) => {
        if (!acc[stopTime.trip_id]) acc[stopTime.trip_id] = [];
        acc[stopTime.trip_id].push(stopTime);
        return acc;
    }
        , {});
    console.log('Have shapes map', Object.keys(SHAPES_MAP).length, 'stop times map', Object.keys(STOP_TIMES_MAP).length);
    console.log('Preloaded data');
}

function calculateBearingFromGPS(currentPosition, previousPosition, trip, previousBearing = 0) {
    if (!currentPosition?.latitude || !currentPosition?.longitude) {
        console.warn('Current position is not valid, returning previous bearing:', previousBearing);
        return previousBearing;
    }

    const toRad = deg => deg * Math.PI / 180;
    const toDeg = rad => rad * 180 / Math.PI;

    function haversine(lat1, lon1, lat2, lon2) {
        const R = 6371000; // Earth radius in meters
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) ** 2;
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    function bearingBetween(lat1, lon1, lat2, lon2) {
        const dLon = toRad(lon2 - lon1);
        const lat1Rad = toRad(lat1);
        const lat2Rad = toRad(lat2);
        const y = Math.sin(dLon) * Math.cos(lat2Rad);
        const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
            Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
        return (toDeg(Math.atan2(y, x)) + 360) % 360;
    }

    const shape = SHAPES_MAP[trip.shape_id];
    let shapeBearing = previousBearing;

    if (shape?.length >= 2) {
        // Find nearest shape segment
        let closestIdx = 0, minDist = Infinity;
        for (let i = 0; i < shape.length; i++) {
            const dist = haversine(
                currentPosition.latitude, currentPosition.longitude,
                shape[i].shape_pt_lat, shape[i].shape_pt_lon
            );
            if (dist < minDist) {
                minDist = dist;
                closestIdx = i;
            }
        }

        if (closestIdx < shape.length - 1) {
            const a = shape[closestIdx];
            const b = shape[closestIdx + 1];
            shapeBearing = bearingBetween(a.shape_pt_lat, a.shape_pt_lon, b.shape_pt_lat, b.shape_pt_lon);
        }
    }

    // If previous GPS position is available and has significant movement
    if (previousPosition?.latitude && previousPosition?.longitude) {
        const gpsDistance = haversine(
            previousPosition.latitude, previousPosition.longitude,
            currentPosition.latitude, currentPosition.longitude
        );

        if (gpsDistance > 10) { // Require real movement to accept GPS bearing
            const gpsBearing = bearingBetween(
                previousPosition.latitude, previousPosition.longitude,
                currentPosition.latitude, currentPosition.longitude
            );

            // If GPS bearing deviates significantly from shape, use it, otherwise prefer shape
            const angleDiff = Math.abs(gpsBearing - shapeBearing);
            const minimalAngleDiff = angleDiff > 180 ? 360 - angleDiff : angleDiff;

            if (minimalAngleDiff > 90) {
                // Accept GPS bearing if it's convincingly different
                console.log(`Using GPS bearing for trip ${trip.trip_id}: ${gpsBearing}° (shape bearing: ${shapeBearing}°)`);
                return gpsBearing;
            }
        } else if (gpsDistance < 5) {
            // Use previous bearing if GPS movement is too small
            console.log(`Using previous bearing for trip ${trip.trip_id}: ${previousBearing}° (shape bearing: ${shapeBearing}°)`);
            return previousBearing;
        }
    }

    // Default fallback: shape bearing
    console.log(`Using shape bearing for trip ${trip.trip_id}: ${shapeBearing}°`);
    return shapeBearing;
}


function getCurrentServiceTime() {
    const now = luxon.DateTime.now().setZone('Europe/Zagreb');
    const todaySeconds = now.hour * 3600 + now.minute * 60 + now.second;

    // If time is less than 3 AM, consider it part of the previous service day
    let serviceDate = now;
    if (todaySeconds < 10800) {  // 3 * 3600
        serviceDate = serviceDate.minus({ days: 1 });
    }

    return {
        currentTime: todaySeconds + (todaySeconds < 10800 ? 86400 : 0),  // add 24h if before 3am
        serviceDate: serviceDate.toISODate()
    };
}


app.get('/vehicles/locations', cache('10 seconds'), async (req, res) => {
    try {
        const { currentTime, serviceDate } = getCurrentServiceTime();
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
            if (RT_UPDATE.canceled) continue;
            endTime += RT_UPDATE.delay;

            if (currentTime > startTime && currentTime < endTime) {
                let lat, lon, bearing, timestamp, interpolated;
                if (!VP_MAP2[trip.trip_id] || !VP_MAP2[trip.trip_id].position || !VP_MAP2[trip.trip_id].position.latitude || !VP_MAP2[trip.trip_id].position.longitude) {
                    [lat, lon, bearing] = calculateCurrentPosition(trip, tripStopTimes, SHAPES_MAP, currentTime, RT_UPDATE);
                    interpolated = true;
                    timestamp = luxon.DateTime.now().setZone('Europe/Zagreb').toISO();
                } else {
                    lat = VP_MAP2[trip.trip_id].position.latitude;
                    lon = VP_MAP2[trip.trip_id].position.longitude;
                    // Calculate bearing based on previous and next shape points
                    bearing = VP_MAP2[trip.trip_id].position.bearing || calculateBearingFromGPS(
                        VP_MAP2[trip.trip_id]?.position, VP_MAP2_OLD[trip.trip_id]?.position, trip, VP_MAP2_OLD[trip.trip_id]?.position?.bearing
                    );
                    // Copy over the bearing so that we can use it for the next iteration
                    VP_MAP2[trip.trip_id].position.bearing = bearing;
                    interpolated = false;
                    // Epoch seconds
                    timestamp = luxon.DateTime.fromMillis(VP_MAP2[trip.trip_id].timestamp * 1000).setZone('Europe/Zagreb').toISO();
                }

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
                        canceled: false,
                        vehicleId: VP_MAP[trip.trip_id] || RT_UPDATE.vehicle?.id || 'XXX',
                        interpolated: interpolated,
                        timestamp: timestamp
                    }
                });
            }
        }

        res.json(geoJson);
    } catch (e) {
        insertIntoLog(e.message + ' ' + e.stack);
        console.error(e);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});




let VALID_CALENDAR_IDS = [];
let lastCalendarSync = 0;

async function getCalendarIdsForDate(calendar, calendar_dates, date) {
    let validCalendarIds = [];
    const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const dayOfWeek = weekdays[luxon.DateTime.fromFormat(date, 'yyyyMMdd').setZone('Europe/Zagreb').weekday - 1];
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
    let now = luxon.DateTime.now().setZone('Europe/Zagreb');
    let dates = [now.toFormat('yyyyMMdd')];
    // if it's before 4am Zagreb time, also check for yesterday
    if (now.hour < 4) {
        dates.push(now.minus({ days: 1 }).toFormat('yyyyMMdd'));
    }
    for (let date of dates) {
        let calendarIds = await getCalendarIdsForDate(calendar, calendar_dates, date);
        validCalendarIds = validCalendarIds.concat(calendarIds);
    }
    VALID_CALENDAR_IDS = [...new Set(validCalendarIds)];
    lastCalendarSync = timeNow;
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
let VP_MAP2_OLD = {};
let lastValidRtSnapshot = 0;
const RT_SNAPSHOT_MAX_AGE = 5 * 60 * 1000;

function protobufNumber(value) {
    if (value === undefined || value === null) return null;
    const number = typeof value === 'object' && typeof value.toNumber === 'function' ? value.toNumber() : Number(value);
    return Number.isFinite(number) ? number : null;
}

function hasValidPosition(position) {
    return position && Number.isFinite(position.latitude) && Number.isFinite(position.longitude) && Math.abs(position.latitude) <= 90 && Math.abs(position.longitude) <= 180;
}

function resolveRealtimeTripId(tripId, knownTripIds) {
    if (knownTripIds.has(tripId)) return tripId;
    const suffix = tripId?.split('_').slice(2).join('_');
    const resolvedTripId = suffix ? TRIP_IDS_BY_SUFFIX.get(suffix) : null;
    return resolvedTripId && knownTripIds.has(resolvedTripId) ? resolvedTripId : null;
}

function isCanceledTrip(scheduleRelationship) {
    return scheduleRelationship === CANCELED_TRIP || scheduleRelationship === 'CANCELED' || scheduleRelationship === String(CANCELED_TRIP);
}

function clearStaleRtSnapshot() {
    if (lastValidRtSnapshot && Date.now() - lastValidRtSnapshot > RT_SNAPSHOT_MAX_AGE) {
        RT_DATA = [];
        VP_DATA = [];
        VP_MAP = {};
        VP_MAP2_OLD = VP_MAP2;
        VP_MAP2 = {};
        lastValidRtSnapshot = 0;
        console.warn('Cleared GTFS-RT snapshot after five minutes without a valid update');
    }
}

async function logVehicles() {
    // Log vehicles based on RT data
    let sql_stmt = 'INSERT INTO VehicleDispatches (trip_id, route_short_name, trip_headsign, block_id, vehicle_id, start_time, date) VALUES ';
    let sql_values = [];
    let date = luxon.DateTime.now().setZone('Europe/Zagreb').toFormat('yyyyMMdd');
    for (let rt of RT_DATA) {
        if (rt.canceled) continue;
        let trip = TRIPS.find(trip => trip.trip_id == rt.trip.tripId);
        if (!trip) continue;
        let vehicle = VP_MAP2[rt.trip.tripId] || rt;
        let vehicle_id = '?';
        let local_date = rt.trip.startDate || date;
        if (vehicle) {
            vehicle_id = vehicle?.vehicle?.id || '?';
            local_date = vehicle?.trip?.startDate || local_date;
        }
        let tripStopTimes = STOP_TIMES_MAP[rt.trip.tripId];
        if (!tripStopTimes) continue;
        sql_stmt += '(?, ?, ?, ?, ?, ?, ?),';
        sql_values.push(trip.trip_id, trip.route_short_name, trip.trip_headsign, trip.block_id, vehicle_id, tripStopTimes[0].departure_time, local_date);
    }
    sql_stmt = sql_stmt.slice(0, -1);
    if (sql_values.length > 0) {
        // Update unless vehicle_id in DB is already different from the question mark
        sql_stmt += ' ON CONFLICT(trip_id, date) DO UPDATE SET vehicle_id = excluded.vehicle_id WHERE excluded.vehicle_id != \'?\'';
        await sqlite3.prepare(sql_stmt).run(sql_values);
    }
}

async function addActiveTripsToDb() {
    try {
        const BATCH_SIZE = 1500;
        let active_calendar_ids = await getCalendarIds();
        let date = luxon.DateTime.now().setZone('Europe/Zagreb').toFormat('yyyyMMdd');
        let trips = await sqlite3.prepare(
            'SELECT * FROM Trips JOIN Routes ON Trips.route_id = Routes.route_id WHERE service_id IN (' +
            active_calendar_ids.map(() => '?').join(',') + ')'
        ).all(active_calendar_ids);

        let sql_stmt = 'INSERT INTO TripArchive (trip_id, route_short_name, trip_headsign, block_id, start_time, date) VALUES ';
        let sql_values = [];

        for (let trip of trips) {
            let tripStopTimes = STOP_TIMES_MAP[trip.trip_id];
            if (!tripStopTimes) continue;

            sql_stmt += '(?, ?, ?, ?, ?, ?),';
            sql_values.push(trip.trip_id, trip.route_short_name, trip.trip_headsign, trip.block_id, tripStopTimes[0].departure_time, date);

            // When the sql_values array reaches the batch size, execute the batch insert
            if (sql_values.length >= BATCH_SIZE * 6) {
                sql_stmt = sql_stmt.slice(0, -1); // Remove trailing comma
                sql_stmt += ' ON CONFLICT(trip_id, date) DO NOTHING';
                await sqlite3.prepare(sql_stmt).run(sql_values);
                // Reset sql statement and values for the next batch
                sql_stmt = 'INSERT INTO TripArchive (trip_id, route_short_name, trip_headsign, block_id, start_time, date) VALUES ';
                sql_values = [];
            }
        }

        // Insert any remaining records if they don't fill an entire batch
        if (sql_values.length > 0) {
            sql_stmt = sql_stmt.slice(0, -1); // Remove trailing comma
            sql_stmt += ' ON CONFLICT(trip_id, date) DO NOTHING';
            await sqlite3.prepare(sql_stmt).run(sql_values);
        }

        console.log('Added ' + trips.length + ' active trips to the archive');
    } catch (e) {
        console.error(e);
    }
}

app.get('/historic/trips/data', cache('1 minute'), async (req, res) => {
    try {
        // return the lists of distinct route_short_names and dates for which there are trips
        let route_short_names = await sqlite3.prepare('SELECT DISTINCT route_short_name FROM TripArchive ORDER BY route_short_name').all();
        let dates = await sqlite3.prepare('SELECT DISTINCT date FROM TripArchive ORDER BY date DESC').all();
        res.json({ route_short_names: route_short_names.map(r => r.route_short_name), dates: dates.map(d => d.date) });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

app.get('/historic/trips/:route_short_name/:date', cache('1 minute'), async (req, res) => {
    try {
        let route_short_name = req.params.route_short_name;
        let date = req.params.date;
        let trips = await sqlite3.prepare(`select ta.*, vd.vehicle_id from TripArchive ta
        left join VehicleDispatches vd on vd.trip_id = ta.trip_id and vd.date = ta.date
        where ta.date = ? and ta.route_short_name = ?
        ORDER BY ta.start_time ASC`).all(date, route_short_name);
        res.json(trips);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});


async function getRtData() {
    while (true) {
        try {
            const response = await fetch(CONFIG.GTFS_RT_TRIP_UPDATES, { signal: AbortSignal.timeout(10000) });
            if (!response.ok) throw new Error(`GTFS-RT download returned HTTP ${response.status}`);
            const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(await response.buffer());
            if (!feed.header?.gtfsRealtimeVersion) throw new Error('GTFS-RT feed has no header version');
            const feedTimestamp = protobufNumber(feed.header.timestamp);
            if (feedTimestamp !== null && feedTimestamp > 0 && Math.abs(Date.now() - feedTimestamp * 1000) > RT_SNAPSHOT_MAX_AGE) {
                throw new Error(`GTFS-RT feed is stale (${new Date(feedTimestamp * 1000).toISOString()})`);
            }
            const now = luxon.DateTime.now().setZone('Europe/Zagreb');
            const acceptableDates = new Set([now.toFormat('yyyyMMdd'), ...(now.hour < 4 ? [now.minus({ days: 1 }).toFormat('yyyyMMdd')] : [])]);
            const knownTripIds = new Set(TRIP_IDS);
            const dataByTrip = new Map();
            const vehiclesByTrip = new Map();
            let invalidEntities = 0;
            let unmatchedTripIds = 0;
            for (const entity of feed.entity || []) {
                const update = entity.tripUpdate;
                const updateTrip = update?.trip;
                if (update) {
                    const tripId = resolveRealtimeTripId(updateTrip?.tripId, knownTripIds);
                    const canceled = isCanceledTrip(updateTrip?.scheduleRelationship);
                    if (!tripId || (updateTrip.startDate && !acceptableDates.has(updateTrip.startDate)) || ((!Array.isArray(update.stopTimeUpdate) || update.stopTimeUpdate.length === 0) && !canceled)) {
                        invalidEntities++;
                        if (!tripId) unmatchedTripIds++;
                    } else {
                        update.trip.tripId = tripId;
                        update.canceled = canceled;
                        dataByTrip.set(tripId, update);
                    }
                }
                const vehicle = entity.vehicle;
                const vehicleTrip = vehicle?.trip;
                if (vehicle) {
                    const tripId = resolveRealtimeTripId(vehicleTrip?.tripId, knownTripIds);
                    if (!tripId || (vehicleTrip.startDate && !acceptableDates.has(vehicleTrip.startDate)) || !hasValidPosition(vehicle.position)) {
                        invalidEntities++;
                        if (!tripId) unmatchedTripIds++;
                    } else {
                        vehicle.trip.tripId = tripId;
                        vehiclesByTrip.set(tripId, vehicle);
                    }
                }
            }
            const data = [...dataByTrip.values()];
            const vehicleData = [...vehiclesByTrip.values()].filter(vehicle => !dataByTrip.get(vehicle.trip.tripId)?.canceled);
            if (data.length === 0 && vehicleData.length === 0) throw new Error(`GTFS-RT feed has no valid entities (${invalidEntities} invalid, ${unmatchedTripIds} unmatched trip IDs)`);
            if (invalidEntities > 0) console.warn(`Skipped ${invalidEntities} invalid GTFS-RT entities (${unmatchedTripIds} unmatched trip IDs)`);
            const vehicle_map = {};
            const vehicle_map2 = {};
            for (const vehicle of vehicleData) {
                vehicle_map[vehicle.trip.tripId] = vehicle.vehicle?.id || '?';
                vehicle_map2[vehicle.trip.tripId] = vehicle;
            }
            RT_DATA = data;
            VP_DATA = vehicleData;
            VP_MAP = vehicle_map;
            VP_MAP2_OLD = VP_MAP2;
            VP_MAP2 = vehicle_map2;
            lastValidRtSnapshot = Date.now();
            console.log('Updated RT data - ' + RT_DATA.length + ' updates, ' + VP_DATA.length + ' vehicles');
            await logVehicles();
        } catch (e) {
            insertIntoLog(e.message + ' ' + e.stack);
            console.error(e);
            clearStaleRtSnapshot();
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
