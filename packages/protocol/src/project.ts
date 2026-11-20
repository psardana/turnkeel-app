import { z } from 'zod';
import { commonFields } from './common.js';

/** What kind of product a project is. */
export const projectKinds = ['app', 'web', 'extension', 'library', 'other'] as const;

export type ProjectKind = (typeof projectKinds)[number];

/**
 * Where an app ships: the App Store,
 * Google Play, the web. Asked by the first run for an app. Empty when nobody said, as for
 * every project made before; then Get started suggests what it suggested before.
 */
export const projectTargets = ['appstore', 'play', 'web'] as const;

const projectNameSchema = z.string().trim().min(1).max(80);

/**
 * Where the product's code is. An address with a user name or a password in it is
 * refused: a clone address often carries a token that way, and what is stored here is
 * shown to everyone who can see the project and is kept in the event log for good.
 */
const repoUrlSchema = z
  .url({ protocol: /^https?$/ })
  .max(2000)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.username === '' && url.password === '';
    } catch {
      return false;
    }
  }, 'Leave the user name and the password out of the address.');

const localesSchema = z.array(localeSchema).min(1).max(100);

/** A project: a product in the workspace. A project is archived, never deleted. */
export const projectSchema = z.strictObject({
  ...commonFields,
  name: projectNameSchema,
  key: projectKeySchema,
  slug: slugSchema,
  kind: z.enum(projectKinds),
  launchDate: dateSchema.nullable(),
  /** The milestone whose date the launch date follows. */
  launchMilestoneId: idSchema.nullable(),
  locales: localesSchema,
  repoUrl: repoUrlSchema.nullable(),
  /** Where the product ships; empty when nobody said. */
  shipsTo: z.array(z.enum(projectTargets)),
  changelogPublic: z.boolean(),
  archivedAt: timestampSchema.nullable(),
});

export type Project = z.infer<typeof projectSchema>;

/** `POST /workspaces/:ws/projects`, under `project.create`. */
export const createProjectRequestSchema = z.strictObject({
  name: projectNameSchema,
  key: projectKeySchema,
  slug: slugSchema,
  kind: z.enum(projectKinds).default('other'),
  launchDate: dateSchema.nullable().default(null),
  locales: localesSchema.default(['en']),
  repoUrl: repoUrlSchema.nullable().default(null),
  shipsTo: shipsToSchema.default([]),
});

export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

/** `PATCH /workspaces/:ws/projects/:p`, under `project.update`. */
export const updateProjectRequestSchema = z
  .strictObject({
    name: projectNameSchema,
    key: projectKeySchema,
    slug: slugSchema,
    kind: z.enum(projectKinds),
    launchDate: dateSchema.nullable(),
    launchMilestoneId: idSchema.nullable(),
    locales: localesSchema,
    repoUrl: repoUrlSchema.nullable(),
    shipsTo: shipsToSchema,
    changelogPublic: z.boolean(),
  })
  .partial();

export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>;
