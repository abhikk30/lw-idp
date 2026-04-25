import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge } from "../src/components/badge.js";
import { Card, CardContent, CardHeader, CardTitle } from "../src/components/card.js";
import { Input } from "../src/components/input.js";
import { Label } from "../src/components/label.js";
import { Skeleton } from "../src/components/skeleton.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../src/components/table.js";

describe("UI primitives smoke", () => {
  it("renders Card with header + content", () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Hello</CardTitle>
        </CardHeader>
        <CardContent>World</CardContent>
      </Card>,
    );
    expect(screen.getByText("Hello")).toBeInTheDocument();
    expect(screen.getByText("World")).toBeInTheDocument();
  });

  it("renders Badge with variant", () => {
    render(<Badge variant="secondary">Tag</Badge>);
    expect(screen.getByText("Tag")).toBeInTheDocument();
  });

  it("renders Input + Label binding", () => {
    render(
      <>
        <Label htmlFor="x">Name</Label>
        <Input id="x" />
      </>,
    );
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
  });

  it("renders Skeleton with role-less status hint", () => {
    const { container } = render(<Skeleton className="h-4 w-24" />);
    expect(container.querySelector("div")).toHaveClass("h-4", "w-24");
  });

  it("renders Table structure", () => {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Col</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Val</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    expect(screen.getByRole("columnheader", { name: "Col" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Val" })).toBeInTheDocument();
  });
});
