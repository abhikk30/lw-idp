import type { Meta, StoryObj } from "@storybook/react";
import { Sidebar } from "./sidebar.client.js";

const meta: Meta<typeof Sidebar> = {
  title: "App Shell / Sidebar",
  component: Sidebar,
  parameters: {
    layout: "fullscreen",
    nextjs: {
      appDirectory: true,
      navigation: { pathname: "/" },
    },
  },
};

export default meta;
type Story = StoryObj<typeof Sidebar>;

export const Dashboard: Story = {
  parameters: { nextjs: { navigation: { pathname: "/" } } },
};

export const ServicesActive: Story = {
  parameters: { nextjs: { navigation: { pathname: "/services" } } },
};

export const ClustersActive: Story = {
  parameters: { nextjs: { navigation: { pathname: "/clusters" } } },
};

export const SettingsActive: Story = {
  parameters: { nextjs: { navigation: { pathname: "/settings/profile" } } },
};
