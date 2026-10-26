import type { Metadata } from "next";
import { DiscoveryView } from "@/components/crm/discovery-view";

export const metadata: Metadata = { title: "Twin-Cities Discovery" };
export default function Page() { return <DiscoveryView />; }
