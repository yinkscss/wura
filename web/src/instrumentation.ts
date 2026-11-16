/** Loads the server config at boot, so an unsafe setup (see server/network.ts) stops the server at start, not on the first request. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./server/config");
}
