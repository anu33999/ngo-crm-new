import { configStatus } from "@/lib/server/deps";
import { handle, json } from "@/lib/server/http";

/** Which integrations are configured. Never returns secrets. */
export async function GET() {
  return handle(async () => json(configStatus()));
}
