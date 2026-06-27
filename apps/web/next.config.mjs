/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace package consumed directly from source/dist.
  transpilePackages: ["@business-os/shared"],
};

export default nextConfig;
