export { GET } from "@/app/api/route/route";

// Segment config must be a literal in the file Next reads — a re-export is not
// statically analysable, so it is restated here (keep in sync with the source).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
