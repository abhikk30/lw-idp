"use client";

import type { components } from "@lw-idp/contracts/gateway";
import { Button } from "@lw-idp/ui/components/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@lw-idp/ui/components/form";
import { Input } from "@lw-idp/ui/components/input";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { ulid } from "ulid";
import { apiClient } from "../../lib/api/client.js";
import type { TeamOption } from "./service-form.client.js";

type Service = components["schemas"]["Service"];
type ServiceUpdate = components["schemas"]["ServiceUpdate"];

const LIFECYCLES = ["experimental", "production", "deprecated"] as const;

export interface ServiceEditFormProps {
  service: Service;
  teams: TeamOption[];
}

interface FormShape {
  description: string;
  lifecycle: "experimental" | "production" | "deprecated";
  ownerTeamId: string;
  repoUrl: string;
  tagsCsv: string;
}

export function ServiceEditForm({ service, teams }: ServiceEditFormProps): ReactNode {
  const router = useRouter();
  const queryClient = useQueryClient();
  const form = useForm<FormShape>({
    defaultValues: {
      description: service.description ?? "",
      lifecycle:
        (service.lifecycle as "experimental" | "production" | "deprecated") ?? "experimental",
      ownerTeamId: service.ownerTeamId ?? teams[0]?.id ?? "",
      repoUrl: service.repoUrl ?? "",
      tagsCsv: (service.tags ?? []).join(", "),
    },
  });

  const mutation = useMutation({
    mutationFn: async (input: ServiceUpdate) => {
      const client = apiClient();
      const { data, error } = await client.PATCH("/services/{id}", {
        params: { path: { id: service.id } },
        body: input,
        headers: { "Idempotency-Key": ulid() },
      });
      if (error || !data) {
        const msg =
          (error && typeof error === "object" && "message" in error
            ? String((error as { message?: unknown }).message)
            : null) ?? "Failed to save changes";
        throw new Error(msg);
      }
      return data;
    },
    onSuccess: () => {
      toast.success("Service updated");
      void queryClient.invalidateQueries({ queryKey: ["services"] });
      router.refresh();
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    const tags = values.tagsCsv
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    const payload: ServiceUpdate = {
      ...(values.description !== "" ? { description: values.description } : {}),
      lifecycle: values.lifecycle,
      ownerTeamId: values.ownerTeamId,
      ...(values.repoUrl !== "" ? { repoUrl: values.repoUrl } : {}),
      tags,
    };
    mutation.mutate(payload);
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="flex max-w-2xl flex-col gap-6" noValidate>
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="lifecycle"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Lifecycle</FormLabel>
                <FormControl>
                  <select
                    aria-label="Lifecycle"
                    className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                    {...field}
                  >
                    {LIFECYCLES.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="ownerTeamId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Owner team</FormLabel>
                <FormControl>
                  <select
                    aria-label="Owner team"
                    className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                    {...field}
                  >
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.slug})
                      </option>
                    ))}
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="repoUrl"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Repository URL</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormDescription>Optional.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="tagsCsv"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Tags</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormDescription>Comma-separated.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex justify-end">
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
