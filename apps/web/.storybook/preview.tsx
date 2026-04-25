import "@lw-idp/ui/styles/globals.css";
import type { Decorator, Preview } from "@storybook/nextjs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { initialize, mswLoader } from "msw-storybook-addon";
import { Toaster } from "sonner";

// Initialize MSW with handlers from @lw-idp/testing — same fixtures unit tests use.
// quietMode silences the "intercepted request" console output for cleaner story logs.
initialize({ onUnhandledRequest: "bypass", quiet: true });

const QueryDecorator: Decorator = (Story) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });
  return (
    <QueryClientProvider client={client}>
      <Story />
      <Toaster richColors closeButton position="bottom-right" />
    </QueryClientProvider>
  );
};

const ThemeDecorator: Decorator = (Story, ctx) => {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = ctx.globals.theme === "light" ? "light" : "dark";
  }
  return <Story />;
};

const preview: Preview = {
  decorators: [QueryDecorator, ThemeDecorator],
  loaders: [mswLoader],
  globalTypes: {
    theme: {
      description: "Light/dark theme",
      defaultValue: "dark",
      toolbar: {
        title: "Theme",
        icon: "circlehollow",
        items: [
          { value: "light", title: "Light" },
          { value: "dark", title: "Dark" },
        ],
      },
    },
  },
  parameters: {
    backgrounds: { disable: true }, // we use CSS variables, not Storybook backgrounds
    msw: {
      handlers: [], // story-level handlers attach here
    },
  },
};

export default preview;
