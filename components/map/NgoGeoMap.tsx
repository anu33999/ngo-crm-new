"use client";

import * as React from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Circle, CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, ZoomControl, useMap } from "react-leaflet";
import { Layers, Phone, Plane, Radar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CONTACT_LABEL, telHref, type NgoRecord } from "@/lib/crm/types";
import { applyMapFilter, isReached, type MapFilter } from "@/lib/geo/filter";
import { CITY_CENTRES, jitter, pointFor, TWIN_CITIES_VIEW } from "@/lib/geo/areas";
import { cn } from "@/lib/utils";
import { useNgoData } from "@/components/crm/ngo-data";
import { CategoryPills, ContactBadge } from "@/components/crm/parts";

/** Pin colours follow the contact status: emerald = reached, amber = follow-up scheduled, rose = not reached yet. */
export const PIN: Record<NgoRecord["contactStatus"], string> = { CONTACTED: "#10B981", FOLLOW_UP_SCHEDULED: "#F59E0B", NOT_CONTACTED: "#EF4444" };

/** Where the fly-in starts: the studio. Change these to move the starting point of the arc. */
const STUDIO = { name: "Kreatif Atelier studio, Jaipur", lat: 26.9124, lng: 75.7873 };
const INDIA_VIEW = { lat: 22.4, lng: 79.2, zoom: 5 };

/**
 * All styles use the public OpenStreetMap tiles (no API key needed) and are re-coloured with CSS filters to match the theme.
 * OSM's tile policy allows light use like this with attribution; for heavy traffic use a commercial tile provider.
 */
const OSM = { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' };
const BASEMAPS = {
  rose: { label: "Rose", cls: "tiles-rose", ...OSM },
  grey: { label: "Grey", cls: "tiles-grey", ...OSM },
  streets: { label: "Streets", cls: "", ...OSM },
} as const;
type Basemap = keyof typeof BASEMAPS;

const iconCache = new Map<string, L.DivIcon>();
function pinIcon(status: NgoRecord["contactStatus"]) {
  let i = iconCache.get(status);
  if (!i) {
    const c = PIN[status];
    const pulse = status !== "NOT_CONTACTED" ? `<i class="pin-pulse" style="--pc:${c}"></i>` : "";
    const size = status === "NOT_CONTACTED" ? 14 : 22;
    i = L.divIcon({ className: `ngo-pin ${status === "NOT_CONTACTED" ? "pin-sm" : ""}`, html: `${pulse}<span class="pin-dot" style="--pc:${c}"></span>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2], popupAnchor: [0, -size / 2] });
    iconCache.set(status, i);
  }
  return i;
}

/** Leaflet only reads a marker's `title` when the icon is first built, so keep the element's label in step with the status. */
function syncTitle(m: L.Marker | null, title: string) {
  if (!m) return;
  m.options.title = title;
  m.getElement()?.setAttribute("title", title);
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Points along a gentle curve between two places (quadratic Bézier bowed to the side), for the studio → city arc. */
function arcPoints(a: { lat: number; lng: number }, b: { lat: number; lng: number }, n = 64): [number, number][] {
  const mx = (a.lat + b.lat) / 2, my = (a.lng + b.lng) / 2;
  const dx = b.lat - a.lat, dy = b.lng - a.lng;
  const cx = mx - dy * 0.25, cy = my + dx * 0.25;
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n, u = 1 - t;
    return [u * u * a.lat + 2 * u * t * cx + t * t * b.lat, u * u * a.lng + 2 * u * t * cy + t * t * b.lng];
  });
}

function Fly({ target }: { target: { lat: number; lng: number; zoom: number; n: number; duration?: number } | null }) {
  const map = useMap();
  React.useEffect(() => {
    if (!target) return;
    if (reducedMotion()) map.setView([target.lat, target.lng], target.zoom);
    else map.flyTo([target.lat, target.lng], target.zoom, { duration: target.duration ?? 0.9 });
  }, [target, map]);
  return null;
}

function Resize() {
  const map = useMap();
  React.useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map]);
  return null;
}

function ZoomWatcher({ onZoom }: { onZoom: (z: number) => void }) {
  const map = useMap();
  React.useEffect(() => {
    const h = () => onZoom(map.getZoom());
    map.on("zoomend", h); h();
    return () => { map.off("zoomend", h); };
  }, [map, onZoom]);
  return null;
}

/** A small glowing dot that travels along the arc, looping. */
function Traveller({ path }: { path: [number, number][] }) {
  const [i, setI] = React.useState(0);
  React.useEffect(() => {
    if (reducedMotion()) return;
    let raf = 0; const start = performance.now(); const period = 4200;
    const tick = (t: number) => { setI(Math.floor((((t - start) % period) / period) * (path.length - 1))); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [path]);
  const p = path[i] ?? path[0];
  return <CircleMarker center={p} radius={5} pathOptions={{ weight: 2, fillOpacity: 1, className: "arc-traveller" }} interactive={false} />;
}

function Ring({ pct }: { pct: number }) {
  const r = 22, c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 56 56" className="size-14 shrink-0" aria-hidden>
      <circle cx="28" cy="28" r={r} fill="none" stroke="var(--muted)" strokeWidth="6" />
      <circle cx="28" cy="28" r={r} fill="none" stroke="var(--primary)" strokeWidth="6" strokeLinecap="round" strokeDasharray={`${(pct / 100) * c} ${c}`} transform="rotate(-90 28 28)" style={{ transition: "stroke-dasharray .6s ease" }} />
      <text x="28" y="32" textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--foreground)">{Math.round(pct)}%</text>
    </svg>
  );
}

export default function NgoGeoMap({ records, onViewPitch, className }: { records: NgoRecord[]; onViewPitch: (id: string) => void; className?: string }) {
  const { patch } = useNgoData();
  const [filter, setFilter] = React.useState<MapFilter>("all");
  const [basemap, setBasemap] = React.useState<Basemap>("rose");
  const [zoom, setZoom] = React.useState(INDIA_VIEW.zoom);
  const [target, setTarget] = React.useState<{ lat: number; lng: number; zoom: number; n: number; duration?: number } | null>(null);
  const fly = React.useCallback((c: { lat: number; lng: number; zoom: number }, duration?: number) => setTarget({ ...c, n: Date.now(), duration }), []);

  // Cinematic open: all of India, then fly into the twin cities.
  React.useEffect(() => {
    const t = setTimeout(() => fly(TWIN_CITIES_VIEW, 3.4), reducedMotion() ? 0 : 900);
    return () => clearTimeout(t);
  }, [fly]);

  // NGOs known only by city are laid out in an even spiral around the city centre (clearly approximate) instead of piling up.
  const placed = React.useMemo(() => {
    const cityIdx = new Map<string, number>();
    const sorted = [...records].sort((a, b) => a.id.localeCompare(b.id));
    return sorted.flatMap((r) => {
      const p = pointFor(r);
      if (!p) return [];
      if (p.basis.startsWith("city")) {
        const key = `${p.lat},${p.lng}`;
        const i = cityIdx.get(key) ?? 0; cityIdx.set(key, i + 1);
        const rad = 0.0017 * Math.sqrt(i + 1), th = (i + 1) * 2.39996;
        return [{ r, at: { lat: p.lat + rad * Math.cos(th), lng: p.lng + rad * Math.sin(th) * 1.05 }, basis: p.basis }];
      }
      const at = p.basis.includes("approximate") ? jitter(r.id, p, 0.0022) : { lat: p.lat, lng: p.lng };
      return [{ r, at, basis: p.basis }];
    });
  }, [records]);
  const shown = React.useMemo(() => applyMapFilter(placed.map((x) => x.r), filter), [placed, filter]);
  const shownIds = React.useMemo(() => new Set(shown.map((r) => r.id)), [shown]);
  const count = (s: NgoRecord["contactStatus"]) => placed.filter((x) => x.r.contactStatus === s).length;
  const reached = placed.filter((x) => isReached(x.r)).length;
  const pct = placed.length ? (reached / placed.length) * 100 : 0;

  // Outreach trail: every reached NGO, joined in the order you contacted them.
  const trail = React.useMemo(() => placed.filter((x) => isReached(x.r))
    .sort((a, b) => (a.r.contactedAt ?? a.r.updatedAt).localeCompare(b.r.contactedAt ?? b.r.updatedAt))
    .map((x) => [x.at.lat, x.at.lng] as [number, number]), [placed]);
  const arc = React.useMemo(() => arcPoints(STUDIO, TWIN_CITIES_VIEW), []);
  const showArc = zoom <= 9;

  const seg = (f: MapFilter, label: string) => (
    <button type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}
      className={cn("rounded-md px-2.5 py-1 text-xs font-medium transition-colors", filter === f ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted")}>{label}</button>
  );

  return (
    <div className={cn("map-frame relative overflow-hidden rounded-2xl", className)}>
      <MapContainer center={[INDIA_VIEW.lat, INDIA_VIEW.lng]} zoom={INDIA_VIEW.zoom} minZoom={4} scrollWheelZoom zoomControl={false} worldCopyJump
        className="z-0 h-full min-h-[30rem] w-full bg-[#f2eef0]" aria-label="Map of NGOs in Hyderabad and Secunderabad">
        <TileLayer key={basemap} attribution={BASEMAPS[basemap].attribution} url={BASEMAPS[basemap].url} maxZoom={19} className={BASEMAPS[basemap].cls} />
        <ZoomControl position="bottomright" /><Resize /><Fly target={target} /><ZoomWatcher onZoom={setZoom} />

        {showArc && (
          <>
            <Polyline positions={arc} pathOptions={{ weight: 3, opacity: 0.95, className: "flight-arc" }} interactive={false} />
            <Traveller path={arc} />
            <CircleMarker center={[STUDIO.lat, STUDIO.lng]} radius={6} pathOptions={{ weight: 2.5, fillOpacity: 1, className: "map-anchor" }}>
              <Tooltip direction="top" offset={[0, -6]} permanent className="map-label">{STUDIO.name}</Tooltip>
            </CircleMarker>
            <CircleMarker center={[TWIN_CITIES_VIEW.lat, TWIN_CITIES_VIEW.lng]} radius={9} pathOptions={{ weight: 2, fillOpacity: 0.3, className: "radar-ping" }}>
              <Tooltip direction="right" offset={[10, 0]} permanent className="map-label">Hyderabad · Secunderabad · {placed.length} NGOs</Tooltip>
            </CircleMarker>
          </>
        )}

        {!showArc && (
          <>
            {[4000, 8000, 12000].map((m) => (
              <Circle key={m} center={[TWIN_CITIES_VIEW.lat, TWIN_CITIES_VIEW.lng]} radius={m} interactive={false}
                pathOptions={{ weight: 1, opacity: 0.35, fill: false, dashArray: "4 8", className: "radar-ring" }} />
            ))}
            {trail.length > 1 && <Polyline positions={trail} pathOptions={{ weight: 3, opacity: 0.9, className: "outreach-trail" }} interactive={false} />}
          </>
        )}

        {!showArc && placed.filter((x) => shownIds.has(x.r.id)).map(({ r, at, basis }) => (
          <Marker key={r.id} ref={(m) => syncTitle(m, `${r.name} — ${CONTACT_LABEL[r.contactStatus]}`)} position={[at.lat, at.lng]} icon={pinIcon(r.contactStatus)} title={`${r.name} — ${CONTACT_LABEL[r.contactStatus]}`} keyboard>
            <Popup minWidth={260} maxWidth={320} className="ngo-popup">
              <div className="space-y-2 text-[13px] text-neutral-900">
                <p className="font-serif text-base font-semibold leading-snug">{r.name}</p>
                <CategoryPills record={r} />
                <div><ContactBadge status={r.contactStatus} /></div>
                {r.notes && <p className="line-clamp-3 whitespace-pre-line rounded bg-neutral-100 p-1.5 text-[12px] text-neutral-700"><span className="font-medium">Notes:</span> {r.notes}</p>}
                <p className="flex items-center gap-1.5">
                  <Phone className="size-3.5" aria-hidden />
                  {telHref(r.phone) ? <a href={telHref(r.phone) as string} className="underline">{r.phone}</a> : <span className="text-neutral-500">No phone on record</span>}
                </p>
                <p>{r.website ? <a href={r.website} target="_blank" rel="noopener noreferrer" className="break-all underline">{r.website.replace(/^https?:\/\//, "")}</a> : <span className="text-neutral-500">Website: not on record</span>}</p>
                <p className="text-[11px] text-neutral-500">Position is approximate ({basis}).</p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button size="sm" onClick={() => void patch(r.id, { contactStatus: isReached(r) ? "NOT_CONTACTED" : "CONTACTED" })}>{isReached(r) ? "Toggle: mark not contacted" : "Toggle: mark contacted"}</Button>
                  <Button size="sm" variant="outline" onClick={() => onViewPitch(r.id)}>View pitch summary</Button>
                </div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>

      {/* HUD: reach progress + filters */}
      <div className="pointer-events-none absolute left-3 top-3 z-[1000] max-w-[calc(100%-1.5rem)]">
        <div className="map-glass pointer-events-auto w-[21rem] max-w-full p-3.5">
          <div className="flex items-center gap-3">
            <Ring pct={pct} />
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">Twin-cities outreach</p>
              <p className="font-serif text-xl leading-tight text-foreground">{reached} <span className="text-sm text-muted-foreground">of {placed.length} reached</span></p>
            </div>
          </div>
          <ul className="mt-3 grid grid-cols-3 gap-1.5 text-center text-[11px] text-muted-foreground">
            {(["CONTACTED", "FOLLOW_UP_SCHEDULED", "NOT_CONTACTED"] as const).map((s) => (
              <li key={s} className="rounded-md bg-muted px-1 py-1.5"><span className="mx-auto mb-0.5 block size-2.5 rounded-full" style={{ background: PIN[s], boxShadow: `0 0 8px ${PIN[s]}` }} aria-hidden /><span className="block font-semibold text-foreground">{count(s)}</span>{s === "FOLLOW_UP_SCHEDULED" ? "Follow-up" : CONTACT_LABEL[s]}</li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-1 rounded-lg bg-muted p-1" role="group" aria-label="Filter pins">
            {seg("all", "Show all")}{seg("reached", "Reached only")}{seg("not-reached", "Not reached only")}
          </div>
          {!showArc && trail.length > 1 && <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className="inline-block h-0.5 w-5 rounded bg-[var(--ok)]" aria-hidden /> Outreach trail — NGOs joined in the order you contacted them</p>}
          <p className="mt-1.5 text-[10px] text-muted-foreground">Pins are neighbourhood/city approximations, not street addresses. Showing {shown.length}.</p>
        </div>
      </div>

      {/* Controls: style + camera */}
      <div className="pointer-events-none absolute right-3 top-3 z-[1000] flex flex-col items-end gap-2">
        <div className="map-glass pointer-events-auto flex items-center gap-1 p-1" role="group" aria-label="Map style">
          <Layers className="mx-1 size-3.5 text-primary" aria-hidden />
          {(Object.keys(BASEMAPS) as Basemap[]).map((b) => (
            <button key={b} type="button" aria-pressed={basemap === b} onClick={() => setBasemap(b)}
              className={cn("rounded-md px-2 py-1 text-xs font-medium", basemap === b ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted")}>{BASEMAPS[b].label}</button>
          ))}
        </div>
        <div className="map-glass pointer-events-auto flex flex-wrap justify-end gap-1 p-1" role="group" aria-label="Zoom to city">
          <button type="button" onClick={() => { fly(INDIA_VIEW, 1.6); setTimeout(() => fly(TWIN_CITIES_VIEW, 3.4), 2200); }} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-foreground hover:bg-muted"><Plane className="size-3.5" aria-hidden /> Fly in from India</button>
          <button type="button" onClick={() => fly(CITY_CENTRES.Hyderabad)} className="rounded-md px-2 py-1 text-xs font-medium text-foreground hover:bg-muted">Zoom to Hyderabad</button>
          <button type="button" onClick={() => fly(CITY_CENTRES.Secunderabad)} className="rounded-md px-2 py-1 text-xs font-medium text-foreground hover:bg-muted">Zoom to Secunderabad</button>
          <button type="button" onClick={() => fly(TWIN_CITIES_VIEW)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-foreground hover:bg-muted"><Radar className="size-3.5" aria-hidden /> Reset</button>
        </div>
      </div>
    </div>
  );
}
