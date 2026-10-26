import { JobView } from "@/components/job-view";

export default async function JobPage({ params }: PageProps<"/jobs/[id]">) {
  const { id } = await params;
  return <JobView id={id} />;
}
