import { createInMemoryDeviceStateStore } from "../src/device-state/memory";
import { runDeviceStateStoreContract } from "../src/device-state/store-contract";

runDeviceStateStoreContract(() => createInMemoryDeviceStateStore());
