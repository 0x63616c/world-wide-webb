-- Release automation adds exact signed build identities without redeploying Worker bindings.
-- Existing APP_ATTEST_BUNDLE_VERSIONS remain an independent legacy allowlist.
CREATE TABLE published_ios_builds (
  deployment TEXT NOT NULL CHECK (deployment IN ('staging', 'production')),
  app_id TEXT NOT NULL CHECK (length (app_id) BETWEEN 3 AND 255),
  bundle_version INTEGER NOT NULL CHECK (
    typeof (bundle_version) = 'integer'
    AND bundle_version BETWEEN 1 AND 2147483647
  ),
  source_commit TEXT NOT NULL CHECK (
    length (source_commit) = 40
    AND source_commit NOT GLOB '*[^0-9a-f]*'
  ),
  registered_at_ms INTEGER NOT NULL CHECK (
    typeof (registered_at_ms) = 'integer'
    AND registered_at_ms > 0
  ),
  PRIMARY KEY (deployment, app_id, bundle_version)
);
