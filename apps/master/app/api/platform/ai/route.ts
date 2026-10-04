// The source declares no runtime/dynamic segment config (a POST handler is dynamic anyway);
// if it ever does, restate the literal here — a re-export is not statically analysed.
export { POST } from "@/app/api/platform/ai/route";
