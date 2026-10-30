import { handleGenerate } from "@/lib/server/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

export const POST = (req: Request) => handleGenerate(req);
