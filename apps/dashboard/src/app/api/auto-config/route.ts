import { NextResponse } from "next/server";

export async function GET() {
  const token = process.env.PAYMENT_ORCHESTRATION_SERVICE_TOKEN ?? "";

  if (!token) {
    return NextResponse.json({ configured: false }, { status: 200 });
  }

  return NextResponse.json({
    configured: true,
    serviceUrl: "/api/proxy",
    serviceToken: "proxy-internal",
  });
}
