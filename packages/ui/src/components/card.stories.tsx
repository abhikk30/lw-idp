import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "./button.js";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./card.js";

const meta: Meta<typeof Card> = {
  title: "UI / Card",
  component: Card,
  parameters: { layout: "centered" },
};

export default meta;
type Story = StoryObj<typeof Card>;

export const Default: Story = {
  render: () => (
    <Card style={{ width: 360 }}>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>Recent activity in your platform.</CardDescription>
      </CardHeader>
      <CardContent>
        <p style={{ fontSize: 14, color: "var(--color-muted-foreground)" }}>
          You have 3 unread updates.
        </p>
      </CardContent>
      <CardFooter>
        <Button>View all</Button>
      </CardFooter>
    </Card>
  ),
};
