import type { Metadata } from "next";
import { MapView } from "@/components/map/map-view";

export const metadata: Metadata = { title: "Map" };
export default function Page() { return <MapView />; }
