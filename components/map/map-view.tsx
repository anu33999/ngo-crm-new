"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { ErrorBox, Skeleton } from "@/components/shared";
import { pointFor } from "@/lib/geo/areas";
import { useNgoData } from "@/components/crm/ngo-data";
import { PageHeader } from "@/components/crm/page-header";
import { PitchModal } from "@/components/crm/pitch-modal";

// Leaflet touches `window`, so the map is client-only.
const NgoGeoMap = dynamic(() => import("./NgoGeoMap"), {
  ssr: false,
  loading: () => <Skeleton className="h-[40rem] w-full rounded-2xl" />,
});

export function MapView() {
  const { records, loaded, error, refresh } = useNgoData();
  const [pitchFor, setPitchFor] = React.useState<string | null>(null);
  const unplaced = records.filter((r) => !pointFor(r)).length;
  const rec = pitchFor ? records.find((r) => r.id === pitchFor) : undefined;
  return (
    <div>
      <PageHeader eyebrow="Geospatial view" title="Your outreach across the twin cities">
        Fly in from across India to every NGO on your list. Pins glow green once you have reached out, amber for a scheduled follow-up and red until you make contact. The green trail links the NGOs in the order you contacted them. Change a status here and the CRM and Discovery update instantly.
      </PageHeader>
      {error && <ErrorBox message={error} onRetry={refresh} />}
      <div className="mt-4">
        {!loaded ? <Skeleton className="h-[40rem] w-full rounded-2xl" /> : <NgoGeoMap records={records} onViewPitch={setPitchFor} className="h-[36rem] sm:h-[44rem]" />}
      </div>
      {loaded && unplaced > 0 && <p className="mt-2 text-xs text-muted-foreground">{unplaced} NGO{unplaced === 1 ? "" : "s"} could not be placed because no city or area is on record. Add a city to show {unplaced === 1 ? "it" : "them"}.</p>}
      {rec && <PitchModal record={rec} onClose={() => setPitchFor(null)} />}
    </div>
  );
}
