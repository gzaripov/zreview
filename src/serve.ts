// Serve the review page on a random localhost port and block until the
// reviewer decides. The page POSTs /api/state on every change and
// /api/decision on Submit. Submit is the only thing that ends the review;
// otherwise the run waits until the timeout, because a page can go away for
// reasons that are not the reviewer leaving — a reload, a restored session, a
// browser moved to another tab group. Every change is already on disk, so a
// reviewer who closes the tab loses nothing and can re-run to pick it up.

import type { Review } from "./build.ts";
import { saveState, type ReviewState } from "./state.ts";

export type FeatureDecision = { decision: "approved" | "changes"; note?: string; at?: number };
export type Outcome = {
  decision: "approved" | "changes" | "incomplete" | "dismissed";
  features: Record<string, FeatureDecision>;
  summary: string;
  url: string;
};
export type ServeOptions = { port: number; open: boolean; timeoutSeconds?: number; persist: boolean; initialState?: ReviewState | null };

/** All features approved -> approved. Any changes requested -> changes. Otherwise something was left open. */
export function classify(review: Review, features: Record<string, FeatureDecision>): Outcome["decision"] {
  const ids = review.features.map((f) => f.id);
  if (ids.some((id) => features[id]?.decision === "changes")) return "changes";
  if (ids.length && ids.every((id) => features[id]?.decision === "approved")) return "approved";
  return "incomplete";
}

const hms = (s: number) => s >= 3600 ? `${+(s / 3600).toFixed(1)}h` : s >= 60 ? `${Math.round(s / 60)}m` : `${s}s`;

export function serve(html: string, review: Review, opts: ServeOptions): Promise<Outcome> {
  const { promise, resolve } = Promise.withResolvers<Outcome>();
  let settled = false;
  const settle = (outcome: Outcome) => {
    if (settled) return;
    settled = true;
    setTimeout(() => server.stop(true), 300);   // the process usually exits first; this is for embedders
    resolve(outcome);
  };
  let latest: ReviewState = opts.initialState ?? {};
  const page = () => html.replace("__STATE__", () => JSON.stringify(latest).replaceAll("</", "<\\/"));
  const dismissed = () => ({
    decision: "dismissed" as const,
    features: Object.fromEntries(Object.entries(latest).filter(([, f]) => f.decision)) as Record<string, FeatureDecision>,
    summary: "",
    url,
  });

  const server = Bun.serve({
    port: opts.port,
    hostname: "127.0.0.1",
    async fetch(req) {
      const { pathname } = new URL(req.url);
      if (req.method === "GET" && pathname === "/") {
        return new Response(page(), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
      }
      if (req.method === "POST" && pathname === "/api/state") {
        latest = (await req.json()) as ReviewState;
        if (opts.persist) await saveState(review, latest).catch((e) => console.error(`zreview: could not save state: ${(e as Error).message}`));
        return Response.json({ ok: true });
      }
      if (req.method === "POST" && pathname === "/api/decision") {
        const body = (await req.json()) as { features?: Record<string, FeatureDecision>; summary?: string };
        const features = body.features ?? {};
        const outcome: Outcome = { decision: classify(review, features), features, summary: body.summary ?? "", url };
        // Settle on a later tick: resolving here hands control back to the CLI, which prints and exits
        // before Bun writes this response, leaving the page with a failed fetch and no "Submitted".
        setTimeout(() => settle(outcome), 150);
        return Response.json({ ok: true });
      }
      return new Response("not found", { status: 404 });
    },
  });
  const url = `http://127.0.0.1:${server.port}/`;
  console.error(`zreview: ${url}${opts.timeoutSeconds ? ` (waiting for Submit, up to ${hms(opts.timeoutSeconds)})` : " (waiting for Submit, no timeout)"}`);

  if (opts.open) {
    const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    Bun.spawn([opener, url], { stdout: "ignore", stderr: "ignore" });
  }
  if (opts.timeoutSeconds) {
    setTimeout(() => {
      console.error(`zreview: no Submit within ${hms(opts.timeoutSeconds!)}; returning what was decided`);
      settle(dismissed());
    }, opts.timeoutSeconds * 1000);
  }

  return promise;
}
