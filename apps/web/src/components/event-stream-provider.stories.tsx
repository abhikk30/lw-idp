import { Button } from "@lw-idp/ui/components/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@lw-idp/ui/components/card";
import type { Meta, StoryObj } from "@storybook/react";
import type { ReactElement } from "react";
import { toast } from "sonner";

const meta: Meta = {
  title: "App Shell / EventStreamProvider",
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "EventStreamProvider opens a WebSocket to /ws/stream and translates inbound frames into TanStack Query invalidations + sonner toasts. In Storybook we demonstrate the toast surface via mocked emissions (no real WS).",
      },
    },
  },
  // Don't run play() — there's no real WS, so the test would just be a smoke
  // render. Opt out of the inherited "interactions" tag so test-runner skips it.
  tags: ["!interactions"],
};

export default meta;

type Story = StoryObj;

const ToastTriggers = (): ReactElement => (
  <Card style={{ width: 480 }}>
    <CardHeader>
      <CardTitle>EventStream toast preview</CardTitle>
      <CardDescription>
        Click to fire a synthesized toast — same surface the real WS frames produce.
      </CardDescription>
    </CardHeader>
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
      <Button onClick={() => toast(`Service "checkout" created`)}>service.created</Button>
      <Button onClick={() => toast(`Cluster "prod-east" created`)}>cluster.registered</Button>
      <Button
        variant="destructive"
        onClick={() =>
          toast.error("Session expired", {
            description: "Reload the page to sign in again.",
            action: { label: "Reload", onClick: () => {} },
          })
        }
      >
        session-expired (4401)
      </Button>
    </div>
  </Card>
);

export const ToastSurface: Story = {
  render: () => <ToastTriggers />,
};
