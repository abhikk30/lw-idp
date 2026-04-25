"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { type ClusterRegisterInput, clusterRegisterSchema } from "@lw-idp/contracts";
import type { components } from "@lw-idp/contracts/gateway";
import { Button } from "@lw-idp/ui/components/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@lw-idp/ui/components/form";
import { Input } from "@lw-idp/ui/components/input";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { ulid } from "ulid";
import { apiClient } from "../../lib/api/client.js";

type ClusterCreateBody = components["schemas"]["ClusterCreate"];

const ENVIRONMENTS = ["dev", "stage", "prod"] as const;
const PROVIDERS = ["docker-desktop", "eks", "gke", "aks", "kind", "other"] as const;

export function ClusterForm(): ReactNode {
  const router = useRouter();
  const form = useForm<ClusterRegisterInput>({
    resolver: zodResolver(clusterRegisterSchema),
    defaultValues: {
      slug: "",
      name: "",
      environment: "dev",
      region: "",
      provider: "kind",
      apiEndpoint: "",
    },
  });

  const mutation = useMutation({
    mutationFn: async (input: ClusterCreateBody) => {
      const client = apiClient();
      const { data, error } = await client.POST("/clusters", {
        body: input,
        headers: { "Idempotency-Key": ulid() },
      });
      if (error || !data) {
        const msg =
          (error && typeof error === "object" && "message" in error
            ? String((error as { message?: unknown }).message)
            : null) ?? "Failed to register cluster";
        throw new Error(msg);
      }
      return data;
    },
    onSuccess: (created) => {
      toast.success(`Cluster "${created.name}" registered`);
      router.push(`/clusters/${created.id}`);
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    const payload: ClusterCreateBody = {
      slug: values.slug,
      name: values.name,
      environment: values.environment,
      region: values.region,
      provider: values.provider,
      apiEndpoint: values.apiEndpoint,
    };
    mutation.mutate(payload);
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="flex max-w-2xl flex-col gap-6" noValidate>
        <FormField
          control={form.control}
          name="slug"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Slug</FormLabel>
              <FormControl>
                <Input placeholder="prod-us-east" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input placeholder="Prod US East" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="environment"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Environment</FormLabel>
                <FormControl>
                  <select
                    aria-label="Environment"
                    className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                    {...field}
                  >
                    {ENVIRONMENTS.map((e) => (
                      <option key={e} value={e}>
                        {e}
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
            name="provider"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Provider</FormLabel>
                <FormControl>
                  <select
                    aria-label="Provider"
                    className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                    {...field}
                  >
                    {PROVIDERS.map((p) => (
                      <option key={p} value={p}>
                        {p}
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
          name="region"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Region</FormLabel>
              <FormControl>
                <Input placeholder="us-east-1" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="apiEndpoint"
          render={({ field }) => (
            <FormItem>
              <FormLabel>API endpoint</FormLabel>
              <FormControl>
                <Input placeholder="https://kube.prod-east.lw-idp.internal:6443" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex justify-end">
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Registering…" : "Register cluster"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
