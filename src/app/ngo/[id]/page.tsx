import { NgoDashboard } from "@/components/ngo-dashboard";

export default async function NgoPage({ params }: PageProps<"/ngo/[id]">) {
  const { id } = await params;
  return <NgoDashboard id={id} />;
}
