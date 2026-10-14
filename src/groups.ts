export const GROUPS = [
  ["domain", "Domain types"],
  ["persistence", "Persistence"],
  ["logic", "Logic"],
  ["interfaces", "Interfaces"],
  ["surface", "Surface"],
  ["tests", "Tests"],
  ["docs", "Docs"],
  ["config", "Config and generated"],
  ["other", "Other"],
] as const;

export type Group = (typeof GROUPS)[number][0];
export const GROUP_KEYS: readonly Group[] = GROUPS.map(([key]) => key);
export const isGroup = (value: unknown): value is Group => GROUP_KEYS.includes(value as Group);

const CI = /(^|\/)\.(github|gitlab|circleci|buildkite)\//i;
const TESTS = /(^|[\/._-])(tests?|specs?|__tests__|__mocks__|fixtures?|snapshots?)([\/._-]|$)|(^|\/)conftest\.py$/i;
const GENERATED = /(^|\/)(gen|generated|__generated__)\/|\.(generated|gen)\.[a-z]+$|_pb2(_grpc)?\.pyi?$|\.pb(\.gw)?\.go$|\.g\.dart$|\.min\.(js|css)$/i;
const LOCKS = /^(package-lock\.json|npm-shrinkwrap\.json|bun\.lockb?|yarn\.lock|pnpm-lock\.yaml|go\.sum|cargo\.lock|gemfile\.lock|poetry\.lock|uv\.lock|composer\.lock|pipfile\.lock|.*\.lock)$/i;
const BUILD_FILES = /^(build|build\.bazel|workspace|workspace\.bazel|module\.bazel|.*\.bzl|.*\.bazel|dockerfile(\..*)?|.*\.dockerfile|containerfile|makefile|gnumakefile|.*\.mk|cmakelists\.txt|.*\.cmake|.*\.gradle(\.kts)?|pom\.xml|go\.mod|go\.work|gemfile|pipfile|procfile|justfile|rakefile|requirements.*\.txt|constraints.*\.txt|setup\.py|\.[a-z0-9_-]*rc(\.[a-z]+)?|\.gitignore|\.gitattributes|\.dockerignore|\.editorconfig|\.tool-versions|\.env(\..*)?|tsconfig.*\.json|.*\.nix)$/i;
const DOCS = /\.(md|mdx|markdown|rst|adoc|asciidoc|txt)$|^(readme|changelog|changes|history|license|licence|notice|authors|contributing|security)(\..*)?$/i;
const CONFIG = /\.(json|jsonc|json5|ya?ml|toml|ini|cfg|conf|env|properties|xml|plist|tf|tfvars|hcl)$/i;
const ASSETS = /\.(png|jpe?g|gif|webp|avif|ico|bmp|tiff?|svg|woff2?|ttf|otf|eot|mp3|mp4|wav|webm)$/i;
const CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|py|pyi|go|rs|java|kt|kts|swift|rb|php|cs|c|cc|cpp|cxx|h|hh|hpp|m|mm|scala|clj|ex|exs|erl|hs|ml|fs|dart|lua|r|jl|pl|sh|bash|zsh|fish|ps1|sql|proto|graphql|gql|css|scss|sass|less|html|vue|svelte)$/i;

const ROLES: [Group, RegExp][] = [
  ["interfaces", /\.(proto|graphql|gql)$/i],
  ["surface", /\.(css|scss|sass|less|html|vue|svelte)$/i],
  ["persistence", /\.sql$/i],
  ["domain", /(^|[\/._-])(entit|model|schema|domain|dto|types?)([\/._-]|$)/i],
  ["persistence", /(^|[\/._-])(repositor|store|dao|database|db|migrations?|quer|sql|prisma|persist)/i],
  ["interfaces", /(^|[\/._-])(route|router|api|endpoint|controller|cli|command|serve|server|middleware)/i],
  ["surface", /(^|[\/._-])(component|view|page|screen|style|ui)/i],
];

export function groupOf(path: string, entityFiles: ReadonlySet<string> = new Set()): Group {
  if (entityFiles.has(path)) return "domain";
  const plain = path.replace(/(.)\.(tmpl|tpl|j2|jinja2?|template|example|sample|dist|in)$/i, "$1");
  const name = plain.slice(plain.lastIndexOf("/") + 1);
  if (CI.test(plain)) return "config";
  if (TESTS.test(plain)) return "tests";
  if (GENERATED.test(plain) || LOCKS.test(name) || BUILD_FILES.test(name)) return "config";
  if (DOCS.test(name)) return "docs";
  if (CONFIG.test(name)) return "config";
  if (ASSETS.test(name)) return "surface";
  if (!CODE.test(name)) return "other";
  return ROLES.find(([, pattern]) => pattern.test(plain))?.[0] ?? "logic";
}
