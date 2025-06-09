CREATE TABLE IF NOT EXISTS TripArchive (
    trip_id TEXT,
    route_short_name TEXT,
    trip_headsign TEXT,
    block_id TEXT,
    start_time TEXT,
    date TEXT,

    -- Distinct trip_id, date, vehicle_id
    PRIMARY KEY (trip_id, date)
);

CREATE INDEX IF NOT EXISTS idx_TripArchive_trip_id ON TripArchive(trip_id);
CREATE INDEX IF NOT EXISTS idx_TripArchive_date ON TripArchive(date);