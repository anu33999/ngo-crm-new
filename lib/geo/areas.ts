/**
 * Approximate area centroids for Hyderabad and Secunderabad. These are neighbourhood-level reference points
 * (rounded to ~3 decimals), NOT the addresses of any organisation. Directory entries that use them are labelled
 * "area centroid (approximate)" and the map jitters co-located pins deterministically so they stay distinguishable.
 */

export interface AreaPoint { name: string; city: "Hyderabad" | "Secunderabad"; lat: number; lng: number }

export const CITY_CENTRES: Record<string, { lat: number; lng: number; zoom: number }> = {
  Hyderabad: { lat: 17.385, lng: 78.4867, zoom: 12 },
  Secunderabad: { lat: 17.4399, lng: 78.4983, zoom: 13 },
};

/** Map default view (Hyderabad + Secunderabad twin cities). */
export const TWIN_CITIES_VIEW = { lat: 17.4065, lng: 78.4772, zoom: 11 };

export const AREAS: AreaPoint[] = [
  { name: "Banjara Hills", city: "Hyderabad", lat: 17.4126, lng: 78.4482 },
  { name: "Jubilee Hills", city: "Hyderabad", lat: 17.4326, lng: 78.4071 },
  { name: "Madhapur", city: "Hyderabad", lat: 17.4486, lng: 78.3908 },
  { name: "Gachibowli", city: "Hyderabad", lat: 17.4401, lng: 78.3489 },
  { name: "Charminar", city: "Hyderabad", lat: 17.3616, lng: 78.4747 },
  { name: "Secunderabad Cantonment", city: "Secunderabad", lat: 17.4399, lng: 78.5013 },
  { name: "Begumpet", city: "Hyderabad", lat: 17.4440, lng: 78.4670 },
  { name: "East Marredpally", city: "Secunderabad", lat: 17.4538, lng: 78.5204 },
  { name: "West Marredpally", city: "Secunderabad", lat: 17.4452, lng: 78.5010 },
  // Further well-known localities (neighbourhood-level, rounded). Used only to place pins for addresses that name them.
  { name: "Ameerpet", city: "Hyderabad", lat: 17.4375, lng: 78.4483 },
  { name: "Mehdipatnam", city: "Hyderabad", lat: 17.3950, lng: 78.4400 },
  { name: "Nampally", city: "Hyderabad", lat: 17.3920, lng: 78.4690 },
  { name: "Amberpet", city: "Hyderabad", lat: 17.3960, lng: 78.5190 },
  { name: "Musheerabad", city: "Hyderabad", lat: 17.4090, lng: 78.5000 },
  { name: "Falaknama", city: "Hyderabad", lat: 17.3310, lng: 78.4680 },
  { name: "Saidabad", city: "Hyderabad", lat: 17.3640, lng: 78.5110 },
  { name: "Chandrayangutta", city: "Hyderabad", lat: 17.3200, lng: 78.4850 },
  { name: "Champapet", city: "Hyderabad", lat: 17.3350, lng: 78.5200 },
  { name: "Karwan", city: "Hyderabad", lat: 17.3880, lng: 78.4400 },
  { name: "Basheerbagh", city: "Hyderabad", lat: 17.3990, lng: 78.4720 },
  { name: "Darushifa", city: "Hyderabad", lat: 17.3690, lng: 78.4720 },
  { name: "Vijaya Nagar Colony", city: "Hyderabad", lat: 17.3980, lng: 78.4500 },
  { name: "Trimulgherry", city: "Secunderabad", lat: 17.4660, lng: 78.5130 },
  { name: "Lalapet", city: "Secunderabad", lat: 17.4100, lng: 78.5300 },
  { name: "Bolarum", city: "Secunderabad", lat: 17.5090, lng: 78.5160 },
  { name: "Bowenpally", city: "Secunderabad", lat: 17.4740, lng: 78.4750 },
  { name: "Mettuguda", city: "Secunderabad", lat: 17.4290, lng: 78.5210 },
  { name: "Karkhana", city: "Secunderabad", lat: 17.4560, lng: 78.5000 },
];

/** Spellings seen in directory addresses → the canonical area name above. */
const AREA_ALIASES: Record<string, string> = {
  "west maredpally": "West Marredpally", "maredpally": "West Marredpally", "marredpally": "West Marredpally",
  "dharu shifa": "Darushifa", "darulshifa": "Darushifa", "dar-ul-shifa": "Darushifa",
  "saidabad colony": "Saidabad", "new bowenpally": "Bowenpally", "bowenpalli": "Bowenpally",
  "trimulgiri": "Trimulgherry", "lalapet": "Lalapet",
  "maredpalli": "West Marredpally",
};

/** Finds a known locality named in an address ("…, Karkhana" → "Karkhana"), checking the last segments first. Null when none matches. */
export function areaFromAddress(address: string | null | undefined): string | null {
  const segs = (address ?? "").split(/[,;]/).map((x) => x.trim().toLowerCase().replace(/\s+/g, " ")).filter(Boolean).reverse();
  for (const seg of segs) {
    const cleaned = seg.replace(/\b\d{6}\b/g, "").replace(/\s+/g, " ").trim();
    const hit = AREA_ALIASES[cleaned] ?? AREAS.find((a) => a.name.toLowerCase() === cleaned)?.name;
    if (hit) return hit;
  }
  return null;
}

const BY_NAME = new Map(AREAS.map((a) => [a.name.toLowerCase(), a]));

export function areaPoint(name: string | null | undefined): AreaPoint | null {
  return BY_NAME.get((name ?? "").trim().toLowerCase()) ?? null;
}

export function cityCentre(city: string | null | undefined) {
  return CITY_CENTRES[(city ?? "").trim()] ?? null;
}

export interface GeoPoint { lat: number; lng: number; basis: string }

/** Best available approximate point for a record: its own coordinates, else area centroid, else city centre. */
export function pointFor(r: { latitude: number | null; longitude: number | null; geoBasis: string | null; area: string | null; city: string | null }): GeoPoint | null {
  if (r.latitude !== null && r.longitude !== null && Number.isFinite(r.latitude) && Number.isFinite(r.longitude)) {
    return { lat: r.latitude, lng: r.longitude, basis: r.geoBasis ?? "coordinates on record" };
  }
  const a = areaPoint(r.area);
  if (a) return { lat: a.lat, lng: a.lng, basis: "area centroid (approximate)" };
  const c = cityCentre(r.city);
  if (c) return { lat: c.lat, lng: c.lng, basis: "city centre (approximate)" };
  return null;
}

/** Deterministic small offset (≈ ±250 m) so pins that share a centroid do not stack. Keyed by id so it never changes between renders. */
export function jitter(id: string, p: { lat: number; lng: number }, spread = 0.0022): { lat: number; lng: number } {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  const a = ((h >>> 0) % 1000) / 1000;
  const b = (((h >>> 10) >>> 0) % 1000) / 1000;
  return { lat: p.lat + (a - 0.5) * 2 * spread, lng: p.lng + (b - 0.5) * 2 * spread };
}

/** "hyderabad  " → "Hyderabad". Keeps the city filter free of case-only duplicates. */
export function tidyPlace(v: string | null | undefined): string | null {
  const s = (v ?? "").replace(/\s+/g, " ").trim();
  if (!s) return null;
  return s.split(" ").map((w) => (w.length ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w)).join(" ");
}

export function locationLabel(area: string | null, city: string | null): string | null {
  return [area, city].filter(Boolean).join(", ") || null;
}


/** Fills coordinates from the area centroid, else the city centre, and says so. Never overrides coordinates already present. */
export function withApproxGeo<T extends { latitude?: number; longitude?: number; geoBasis?: string; area?: string; city?: string }>(e: T): T {
  if (e.latitude !== undefined && e.longitude !== undefined) return e;
  const a = areaPoint(e.area);
  if (a) return { ...e, latitude: a.lat, longitude: a.lng, geoBasis: "area centroid (approximate)" };
  const c = cityCentre(e.city);
  if (c) return { ...e, latitude: c.lat, longitude: c.lng, geoBasis: "city centre (approximate)" };
  return e;
}
