import type { Metadata } from "next";
import { HistoryView } from "@/components/crm/history-view";

export const metadata: Metadata = { title: "Search History" };
export default function Page() { return <HistoryView />; }
