import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor, within } from "@storybook/test";
import { http, HttpResponse } from "msw";
import { ServiceForm, type TeamOption } from "./service-form.client.js";

const teams: TeamOption[] = [
  { id: "11111111-1111-4111-8111-111111111111", slug: "platform-admins", name: "Platform Admins" },
  { id: "22222222-2222-4222-8222-222222222222", slug: "payments", name: "Payments" },
];

const meta: Meta<typeof ServiceForm> = {
  title: "Services / ServiceForm",
  component: ServiceForm,
  parameters: {
    layout: "padded",
    // ServiceForm calls `useRouter()` after a successful create. The Next.js
    // framework addon mounts a stub app-router context when this is set.
    nextjs: { appDirectory: true },
  },
};

export default meta;
type Story = StoryObj<typeof ServiceForm>;

export const Empty: Story = {
  args: { teams },
};

export const ValidationError: Story = {
  args: { teams },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const submit = await canvas.findByRole("button", { name: /register service/i });
    await userEvent.click(submit);
    // serviceCreateSchema requires slug; expect the validation error to appear.
    await waitFor(async () => {
      expect(await canvas.findByText(/slug is required/i)).toBeInTheDocument();
    });
  },
};

export const SubmitsAndShowsToast: Story = {
  args: { teams },
  parameters: {
    msw: {
      handlers: [
        http.post("*/api/v1/services", async ({ request }) => {
          const body = (await request.json()) as { slug: string; name: string };
          return HttpResponse.json(
            {
              id: "svc-newly-created",
              slug: body.slug,
              name: body.name,
              description: "",
              type: "service",
              lifecycle: "experimental",
              ownerTeamId: teams[0].id,
              repoUrl: "",
              tags: [],
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            { status: 201 },
          );
        }),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(await canvas.findByLabelText(/slug/i), "checkout");
    await userEvent.type(await canvas.findByLabelText(/^name$/i), "Checkout");
    await userEvent.click(canvas.getByRole("button", { name: /register service/i }));
    // Toast renders into the document body, so search the body.
    await waitFor(
      async () => {
        const body = within(document.body);
        // Toast wording changed in P2.0.5 T4: catalog-row creation now reads
        // "Service \"checkout\" registered" (and "...registered + Argo CD
        // Application created" when Argo CD fields are filled — not exercised
        // by this base story).
        expect(await body.findByText(/checkout.*registered/i)).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  },
};
