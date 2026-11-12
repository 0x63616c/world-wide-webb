ALTER TABLE administrative_configuration ADD COLUMN minimum_ios_build INTEGER NOT NULL DEFAULT 0 CHECK(typeof(minimum_ios_build)='integer' AND minimum_ios_build BETWEEN 0 AND 2147483647);
