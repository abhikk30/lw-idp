import "@lw-idp/ui/styles/globals.css";
import type { Decorator, Preview } from "@storybook/nextjs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RequestHandler } from "msw";
import { type SetupWorker, setupWorker } from "msw/browser";
import { Toaster } from "sonner";

// MSW v2 dropped the `worker.context` field that msw-storybook-addon@2.0.5 still
// relies on (`worker.context.activationPromise = ...`). We bypass the broken
// `initialize()` shim and own the worker lifecycle here instead. Same surface:
// per-story `parameters.msw.handlers` arrays still attach via the loader below.
let workerSingleton: SetupWorker | null = null;
let activationPromise: Promise<unknown> | null = null;

function getWorker(): SetupWorker {
  if (workerSingleton) {
    return workerSingleton;
  }
  workerSingleton = setupWorker();
  activationPromise = workerSingleton.start({ onUnhandledRequest: "bypass", quiet: true });
  return workerSingleton;
}

if (typeof window !== "undefined") {
  // Boot the worker eagerly so the first story's loader doesn't race the SW
  // activation handshake.
  getWorker();
}

const mswLoader = async (context: {
  parameters: { msw?: { handlers?: RequestHandler[] | Record<string, RequestHandler[]> } };
}): Promise<Record<string, never>> => {
  if (typeof window === "undefined") {
    return {};
  }
  const worker = getWorker();
  if (activationPromise) {
    await activationPromise;
  }
  worker.resetHandlers();
  const handlers = context.parameters?.msw?.handlers;
  if (Array.isArray(handlers)) {
    worker.use(...handlers);
  } else if (handlers && typeof handlers === "object") {
    for (const list of Object.values(handlers)) {
      if (Array.isArray(list)) {
        worker.use(...list);
      }
    }
  }
  return {};
};

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
  // Tag every story with "interactions" by default so the test-runner picks them
  // up. Stories that need to opt OUT (e.g. WebSocket-driven flows that can't run
  // headless) declare `tags: ["!interactions"]` at the meta level.
  tags: ["interactions"],
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
