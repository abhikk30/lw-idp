import type { StorybookConfig } from "@storybook/nextjs";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)", "../../../packages/ui/src/**/*.stories.@(ts|tsx)"],
  // We don't load msw-storybook-addon — its 2.0.5 release relies on
  // `worker.context` which MSW v2.13 removed. preview.tsx wires MSW directly.
  addons: ["@storybook/addon-essentials", "@storybook/addon-interactions"],
  framework: {
    name: "@storybook/nextjs",
    options: {},
  },
  staticDirs: ["../public"],
  docs: {
    autodocs: false,
  },
  typescript: {
    check: false,
    reactDocgen: false,
  },
  // Mirror next.config.mjs extensionAlias so workspace TS sources that import
  // sibling files with explicit `.js` (NodeNext convention) resolve in the
  // Storybook webpack pipeline. @storybook/nextjs 8.4 doesn't always invoke
  // the host next.config webpack() callback during build.
  webpackFinal: async (webpackConfig) => {
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
