/**
 * Kepler Coffee — Next configuration.
 *
 * Deliberately almost empty. There are no rewrites, no redirects, no headers, no
 * image domains and no environment variables, because there is no backend to
 * point any of them at: every screen is prerendered and every piece of state
 * lives in `localStorage` (R12.2).
 *
 * `outputFileTracingRoot` points at the monorepo root so the standalone trace
 * resolves dependencies from the shared root `node_modules`.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
};

export default nextConfig;
