/** @type {import("next").NextConfig} */
const config = {
  output: "standalone",
  transpilePackages: ["@lw-idp/ui", "@lw-idp/contracts"],
  experimental: {
    typedRoutes: true,
  },
  webpack: (webpackConfig) => {
    webpackConfig.resolve = webpackConfig.resolve ?? {};
    webpackConfig.resolve.extensionAlias = {
      ...(webpackConfig.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
      ".mjs": [".mts", ".mjs"],
    };
    return webpackConfig;
  },
};

export default config;
