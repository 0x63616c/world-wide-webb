-- Bot simulation is a permanent feature, so the jobs cron always runs it.
ALTER TABLE administrative_configuration DROP COLUMN bot_simulation_enabled;
