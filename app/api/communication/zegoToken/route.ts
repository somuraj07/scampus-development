// This route was previously used for Zego tokens and is now deprecated.
// It is kept only to avoid 404s if something still calls it accidentally.

export async function GET() {
  return new Response(
    JSON.stringify({ message: "Zego communication has been removed." }),
    { status: 410, headers: { "Content-Type": "application/json" } }
  );
}
