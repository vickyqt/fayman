/** @type {import('next').NextConfig} */
const nextConfig = {
  // Seed corpus + ingested corpus are read from disk by API routes.
  outputFileTracingIncludes: { "/api/**": ["./content/**/*", "./data/**/*"] },
};
export default nextConfig;
