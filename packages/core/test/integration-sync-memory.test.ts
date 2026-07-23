import { runIntegrationSyncStoreContract } from "@www/core/testing/integration-sync";

import { createInMemoryIntegrationSyncStore } from "../src/integration-sync/memory";

runIntegrationSyncStoreContract(() => createInMemoryIntegrationSyncStore());
