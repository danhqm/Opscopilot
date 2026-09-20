export function GET() {
  return Response.json({ status: "healthy", service: "frontend", version: "0.1.0" });
}

