-- Add column stop_type to stops table
ALTER TABLE stops
ADD COLUMN stop_type VARCHAR(50) NOT NULL DEFAULT '';
-- Update existing rows to set default value for stop_type
UPDATE stops
SET stop_type = ''
WHERE stop_type IS NULL;