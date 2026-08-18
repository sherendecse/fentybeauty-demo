const nextConfig = {
  output: "export",
  trailingSlash: true,

  images: {
    unoptimized: true,
  },

  typescript: {
    ignoreBuildErrors: true,
  },

  basePath:
    process.env.NODE_ENV === "production"
      ? "/fentybeauty-demo"
      : "",

  assetPrefix:
    process.env.NODE_ENV === "production"
      ? "/fentybeauty-demo/"
      : "",
};

export default nextConfig;
