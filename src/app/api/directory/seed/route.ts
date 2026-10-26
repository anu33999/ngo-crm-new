import { actorOf, handle, json } from "@/lib/server/http";
import { getDeps } from "@/lib/server/deps";
import { seedDirectory } from "@/lib/server/directory";

/** (Re)load the Hyderabad / Secunderabad starter directory. Safe to repeat: existing entries are untouched. */
export async function POST(req: Request) {
  return handle(async () => json(await seedDirectory(getDeps().store, actorOf(req))));
}
