import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const events = await prisma.eventLog.findMany({
    orderBy: { id: "desc" },
    take: 200,
  });
  return NextResponse.json(events);
}
