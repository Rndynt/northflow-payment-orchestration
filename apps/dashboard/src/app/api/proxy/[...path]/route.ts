import { NextRequest, NextResponse } from "next/server";

const SERVICE_PORT = process.env.PAYMENT_ORCHESTRATION_SERVICE_PORT ?? "3001";
const SERVICE_URL = `http://localhost:${SERVICE_PORT}`;

const SERVICE_TOKEN = process.env.PAYMENT_ORCHESTRATION_SERVICE_TOKEN ?? "";
const READY_TOKEN = process.env.PAYMENT_ORCHESTRATION_READY_TOKEN ?? "";

async function handler(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const pathname = "/" + path.join("/");

  const search = req.nextUrl.search ?? "";
  const targetUrl = `${SERVICE_URL}${pathname}${search}`;

  const headers = new Headers();
  headers.set("Authorization", `Bearer ${SERVICE_TOKEN}`);
  headers.set("Content-Type", "application/json");

  const merchantId = req.headers.get("x-merchant-id");
  if (merchantId) headers.set("x-merchant-id", merchantId);

  const sourceApp = req.headers.get("x-source-app");
  if (sourceApp) headers.set("x-source-app", sourceApp);

  if (pathname === "/ready" && READY_TOKEN) {
    headers.set("x-nf-ready-token", READY_TOKEN);
  }

  let body: BodyInit | undefined;
  if (req.method !== "GET" && req.method !== "HEAD") {
    body = await req.text();
  }

  try {
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body,
    });

    const text = await upstream.text();

    return new NextResponse(text, {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Proxy error", message: err?.message },
      { status: 502 }
    );
  }
}

export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };
