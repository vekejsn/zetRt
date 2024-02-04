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
