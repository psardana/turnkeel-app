import { z } from 'zod';
import { commonFields } from './common.js';

const workspaceNameSchema = z.string().trim().min(1).max(80);

/** A workspace: a company. */
export const workspaceSchema = z.strictObject({
  ...commonFields,
  name: workspaceNameSchema,
  slug: slugSchema,
  baseCurrency: currencySchema,
  /** An IANA time zone name: overdue and recurrence rules go by its days. */
  timeZone: timeZoneSchema,
  /** The four planning switches. */
  planning: planningSwitchesSchema,
  /** The tabs an Owner or Admin turned off for everyone, in tab order. */
  tabsOff: z.array(switchableViewIdSchema),
  /** When an Owner or Admin last pressed Keep these tabs, or null. */
  tabsKeptAt: timestampSchema.nullable(),
  demo: z.boolean(),
  deletedAt: timestampSchema.nullable(),
});

export type Workspace = z.infer<typeof workspaceSchema>;

/**
 * `POST /workspaces`. Whoever creates a workspace is its Owner and picks their handle
 * in it then. `demo` cannot be set through a request.
 */
export const createWorkspaceRequestSchema = z
  .strictObject({
    name: workspaceNameSchema,
    slug: slugSchema,
    /** EUR unless given. */
    baseCurrency: currencySchema.default('EUR'),
    handle: handleSchema,
    /**
     * The kind of product the workspace is for. The tabs it does not need start off
     * (`tabsOffByKind`). Without it every tab starts on.
     */
    kind: z.enum(projectKinds).optional(),
    /**
     * The first project, made with the workspace in the same write, of the workspace's
     * `kind`. Without it the workspace starts with no project, as before.
     */
    project: z
      .strictObject({
        name: z.string().trim().min(1).max(80),
        key: projectKeySchema,
        slug: slugSchema,
        shipsTo: shipsToSchema.default([]),
      })
      .optional(),
  })
  .refine((body) => body.project === undefined || body.kind !== undefined, {
    message: 'Say what kind of product the first project is.',
    path: ['kind'],
  });

export type CreateWorkspaceRequest = z.infer<typeof createWorkspaceRequestSchema>;

/** `PATCH /workspaces/:ws`, under `workspace.update`. */
export const updateWorkspaceRequestSchema = z
  .strictObject({
    name: workspaceNameSchema,
    slug: slugSchema,
    baseCurrency: currencySchema,
    /** The time zone, and any of the planning switches. */
    timeZone: timeZoneSchema,
    planning: planningPatchSchema,
    /** The tabs turned off for the whole workspace, as a whole set. */
    tabsOff: viewListSchema,
  })
  .partial();

export type UpdateWorkspaceRequest = z.infer<typeof updateWorkspaceRequestSchema>;

/** `POST /workspaces/:ws/transfer`, under `workspace.transfer`: the member who becomes Owner. */
export const transferWorkspaceRequestSchema = z.strictObject({
  userId: idSchema,
});

export type TransferWorkspaceRequest = z.infer<typeof transferWorkspaceRequestSchema>;
