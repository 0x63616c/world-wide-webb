import { runDeviceStateStoreContract } from "@www/core/testing";

import { createInMemoryDeviceStateStore } from "../src/device-state/memory";

runDeviceStateStoreContract(() => createInMemoryDeviceStateStore());
