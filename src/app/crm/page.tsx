import type { Metadata } from "next";
import { CrmView } from "@/components/crm/crm-view";

export const metadata: Metadata = { title: "Outreach CRM" };
export default function Page() { return <CrmView />; }
