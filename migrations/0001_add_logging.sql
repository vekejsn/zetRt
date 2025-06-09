CREATE TABLE IF NOT EXISTS VehicleDispatches (
    trip_id TEXT,
    route_short_name TEXT,
    trip_headsign TEXT,
    block_id TEXT,
    vehicle_id TEXT,
    start_time TEXT,
    date TEXT,

    -- Distinct trip_id, date, vehicle_id
    PRIMARY KEY (trip_id, date)
);

CREATE INDEX IF NOT EXISTS idx_VehicleDispatches_trip_id ON VehicleDispatches(trip_id);
CREATE INDEX IF NOT EXISTS idx_VehicleDispatches_date ON VehicleDispatches(date);
CREATE INDEX IF NOT EXISTS idx_VehicleDispatches_vehicle_id ON VehicleDispatches(vehicle_id);