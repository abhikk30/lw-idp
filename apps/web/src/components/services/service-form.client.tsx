"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { type ServiceCreateInput, serviceCreateSchema } from "@lw-idp/contracts";
import type { components } from "@lw-idp/contracts/gateway";
import { Button } from "@lw-idp/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@lw-idp/ui/components/card";
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
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { ulid } from "ulid";
import { createArgoCdAdapter } from "../../lib/adapters/argocd.js";
import { apiClient } from "../../lib/api/client.js";

export interface TeamOption {
  id: string;
  slug: string;
  name: string;
}

export interface ServiceFormProps {
  teams: TeamOption[];
}

const TYPES = ["service", "library", "website", "ml", "job"] as const;
const LIFECYCLES = ["experimental", "production", "deprecated"] as const;

type ServiceFormValues = ServiceCreateInput & { tagsCsv?: string };

export function ServiceForm({ teams }: ServiceFormProps): ReactNode {
  const router = useRouter();
  const [argoOpen, setArgoOpen] = useState(false);
  const form = useForm<ServiceFormValues>({
    resolver: zodResolver(serviceCreateSchema),
    defaultValues: {
      slug: "",
      name: "",
      description: "",
      type: "service",
      lifecycle: "experimental",
      ownerTeamId: teams[0]?.id ?? "",
      repoUrl: "",
      tags: [],
      tagsCsv: "",
      gitRepoUrl: "",
      gitBranch: "",
      chartPath: "",
      targetNamespace: "",
    },
  });

  const mutation = useMutation({
    mutationFn: async (input: components["schemas"]["ServiceCreate"]) => {
      const client = apiClient();
      const { data, error } = await client.POST("/services", {
        body: input,
        headers: { "Idempotency-Key": ulid() },
      });
      if (error || !data) {
        const msg =
          (error && typeof error === "object" && "message" in error
            ? String((error as { message?: unknown }).message)
            : null) ?? "Failed to create service";
        throw new Error(msg);
      }
      return data;
    },
    onSuccess: async (created) => {
      // Step 2: optionally create the Argo CD Application. Errors here do NOT
      // roll back the catalog row — the user can retry the Argo CD piece
      // separately later. We branch on the raw form value, not the API
      // response, since the catalog API doesn't echo the Argo CD fields.
      const gitRepoUrl = (form.getValues("gitRepoUrl") ?? "").trim();
      if (gitRepoUrl.length > 0) {
        const gitBranch = (form.getValues("gitBranch") ?? "").trim();
        const chartPath = (form.getValues("chartPath") ?? "").trim();
        const targetNamespace = (form.getValues("targetNamespace") ?? "").trim();
        try {
          const argo = createArgoCdAdapter();
          await argo.createApplication({
            name: created.slug,
            repoUrl: gitRepoUrl,
            targetRevision: gitBranch.length > 0 ? gitBranch : "master",
            path: chartPath.length > 0 ? chartPath : `charts/${created.slug}`,
            destinationNamespace: targetNamespace.length > 0 ? targetNamespace : "lw-idp",
          });
          toast.success(`Service "${created.name}" registered + Argo CD Application created`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "unknown error";
          toast.error(
            `Service "${created.name}" registered but Argo CD Application failed: ${msg}`,
          );
        }
      } else {
        toast.success(`Service "${created.name}" registered`);
      }
      router.push(`/services/${created.id}`);
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    // tags arrive as a comma-separated string; Zod strips unknown keys, so read
    // the raw input via `form.getValues` rather than the validated `values`.
    const csv = form.getValues("tagsCsv") ?? "";
    const tags = csv
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    const payload: components["schemas"]["ServiceCreate"] = {
      slug: values.slug,
      name: values.name,
      type: values.type,
      lifecycle: values.lifecycle,
      ownerTeamId: values.ownerTeamId,
      ...(values.description ? { description: values.description } : {}),
      ...(values.repoUrl ? { repoUrl: values.repoUrl } : {}),
      ...(tags.length > 0 ? { tags } : {}),
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
                <Input placeholder="checkout" {...field} />
              </FormControl>
              <FormDescription>Lowercase letters, numbers, and dashes.</FormDescription>
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
                <Input placeholder="Checkout" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Input placeholder="Cart and order placement" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="type"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Type</FormLabel>
                <FormControl>
                  <select
                    aria-label="Type"
                    className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                    {...field}
                  >
                    {TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
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
        </div>

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

        <FormField
          control={form.control}
          name="repoUrl"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Repository URL</FormLabel>
              <FormControl>
                <Input placeholder="https://github.com/lw-idp/checkout" {...field} />
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
                <Input placeholder="go, payments, internal" {...field} />
              </FormControl>
              <FormDescription>Comma-separated. Optional.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <Card>
          <CardHeader>
            <button
              type="button"
              aria-expanded={argoOpen}
              aria-controls="argo-section"
              onClick={() => setArgoOpen((v) => !v)}
              className="flex w-full items-center justify-between text-left"
            >
              <div className="flex flex-col gap-1.5">
                <CardTitle>Argo CD (optional)</CardTitle>
                <CardDescription>
                  Provide a Git repo URL to also create an Argo CD Application for this service. The
                  other fields auto-default if blank.
                </CardDescription>
              </div>
              <span aria-hidden="true" className="text-muted-foreground text-xl leading-none">
                {argoOpen ? "−" : "+"}
              </span>
            </button>
          </CardHeader>
          {argoOpen ? (
            <CardContent id="argo-section" className="flex flex-col gap-6">
              <FormField
                control={form.control}
                name="gitRepoUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Git repo URL</FormLabel>
                    <FormControl>
                      <Input placeholder="https://github.com/org/repo.git" {...field} />
                    </FormControl>
                    <FormDescription>
                      Set this to also create an Argo CD Application. Leave blank to register a
                      plain catalog service.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="gitBranch"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Git branch</FormLabel>
                    <FormControl>
                      <Input placeholder="master" {...field} />
                    </FormControl>
                    <FormDescription>Defaults to master if blank.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="chartPath"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Chart path</FormLabel>
                    <FormControl>
                      <Input placeholder="charts/<slug>" {...field} />
                    </FormControl>
                    <FormDescription>
                      Defaults to <code>charts/&#123;slug&#125;</code> if blank.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="targetNamespace"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Target namespace</FormLabel>
                    <FormControl>
                      <Input placeholder="lw-idp" {...field} />
                    </FormControl>
                    <FormDescription>Defaults to lw-idp if blank.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          ) : null}
        </Card>

        <div className="flex items-center justify-end gap-2">
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Creating…" : "Register service"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
