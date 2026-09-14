// Serve the review page on a random localhost port and block until the
// reviewer decides. The page POSTs /api/decision on Submit and beacons
// /api/dismiss when the tab closes without submitting.

import type { Review } from "./build.ts";

export type FeatureDecision = { decision: "approved" | "changes"; note?: string; at?: number };
export type Outcome = {
  decision: "approved" | "changes" | "incomplete" | "dismissed";
  features: Record<string, FeatureDecision>;
  summary: string;
  url: string;
};
export type ServeOptions = { port: number; open: boolean; timeoutSeconds?: number };

/** All features approved -> approved. Any changes requested -> changes. Otherwise something was left open. */
export function classify(review: Review, features: Record<string, FeatureDecision>): Outcome["decision"] {
  const ids = review.features.map((f) => f.id);
  if (ids.some((id) => features[id]?.decision === "changes")) return "changes";
  if (ids.length && ids.every((id) => features[id]?.decision === "approved")) return "approved";
  return "incomplete";
}

export function serve(html: string, review: Review, opts: ServeOptions): Promise<Outcome> {
  const { promise, resolve } = Promise.withResolvers<Outcome>();
  let settled = false;
  const settle = (outcome: Outcome) => {
    if (settled) return;
    settled = true;
    setTimeout(() => server.stop(true), 300);   // let the page paint "Submitted" first
    resolve(outcome);
  };
  const dismissed = () => ({ decision: "dismissed" as const, features: {}, summary: "", url });

  const server = Bun.serve({
    port: opts.port,
    hostname: "127.0.0.1",
    async fetch(req) {
      const { pathname } = new URL(req.url);
      if (req.method === "GET" && pathname === "/") {
        return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      if (req.method === "POST" && pathname === "/api/decision") {
        const body = (await req.json()) as { features?: Record<string, FeatureDecision>; summary?: string };
        const features = body.features ?? {};
        settle({ decision: classify(review, features), features, summary: body.summary ?? "", url });
        return Response.json({ ok: true });
      }
      if (req.method === "POST" && pathname === "/api/dismiss") {
        settle(dismissed());
        return Response.json({ ok: true });
      }
      return new Response("not found", { status: 404 });
    },
  });
  const url = `http://127.0.0.1:${server.port}/`;
  console.error(`zreview: ${url}`);

  if (opts.open) {
    const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    Bun.spawn([opener, url], { stdout: "ignore", stderr: "ignore" });
  }
  if (opts.timeoutSeconds) setTimeout(() => settle(dismissed()), opts.timeoutSeconds * 1000);

  return promise;
}
