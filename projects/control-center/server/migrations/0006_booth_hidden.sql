-- Hidden captures leave the gallery; their records and media files are retained.
ALTER TABLE booth_photo ADD COLUMN hidden_at TEXT;
