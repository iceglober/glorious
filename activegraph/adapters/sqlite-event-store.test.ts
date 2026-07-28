import { describeEventStoreContract } from "./event-store-contract";
import { createSqliteEventStore } from "./sqlite-event-store";

describeEventStoreContract("sqlite (:memory:)", () => createSqliteEventStore(":memory:"));
