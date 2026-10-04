// Usage: npx tsx tests/e2e/driver-fixture-cli.ts [username]
// Prints one JSON line: { tripId, vehicleId, stopIds }. Test fixture only.
import { createReadyTrip, testDb } from "./driver-fixture";

const db = testDb();
createReadyTrip(db, process.argv[2] ?? "driver")
  .then(({ trip, stops }) => {
    console.log(JSON.stringify({ tripId: trip.id, vehicleId: trip.vehicleId, stopIds: stops.map((s) => s.id) }));
  })
  .finally(() => db.$disconnect());
