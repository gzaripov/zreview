import { $ } from "bun";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const home = dirname(import.meta.dir);
const DAY = 24 * 60 * 60 * 1000;
const cacheDir = () => join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "zreview");
const git = (...args: string[]) => $`git -C ${home} ${args}`.quiet().nothrow();

export async function buildId(): Promise<string> {
  const described = await git("describe", "--always", "--dirty", "--abbrev=7");
  if (described.exitCode === 0) return described.stdout.toString().trim();
  const pkg = await Bun.file(join(home, "package.json")).json().catch(() => ({}));
  return pkg.version ?? "unknown";
}

export async function behind(): Promise<{ count: number; upstream: string } | null> {
  if (process.env.ZREVIEW_NO_UPDATE_CHECK) return null;
  const upstream = await git("rev-parse", "--abbrev-ref", "@{upstream}");
  if (upstream.exitCode !== 0) return null;
  const stamp = join(cacheDir(), "fetched-at");
  const last = Number(await Bun.file(stamp).text().catch(() => "0")) || 0;
  if (Date.now() - last > DAY) {
    await mkdir(cacheDir(), { recursive: true });
    await Bun.write(stamp, String(Date.now()));
    await Promise.race([git("fetch", "--quiet"), Bun.sleep(10_000)]);
  }
  const count = Number((await git("rev-list", "--count", "HEAD..@{upstream}")).stdout.toString().trim());
  return count > 0 ? { count, upstream: upstream.stdout.toString().trim() } : null;
}
