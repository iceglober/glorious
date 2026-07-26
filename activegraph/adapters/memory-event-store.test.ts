import { describeEventStoreContract } from "./event-store-contract";
import { createMemoryEventStore } from "./memory-event-store";

describeEventStoreContract("memory", () => createMemoryEventStore());
