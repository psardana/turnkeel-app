import { z } from 'zod';
import { idSchema, timestampSchema } from './ids.js';
import { principalRefSchema } from './principal.js';

/**
 * The fields every object carries. `createdBy` and `updatedBy` name
 * the principal that wrote the object: a person, an agent or the system.
 */
export const commonFields = {
  id: idSchema,
  workspaceId: idSchema,
  createdAt: timestampSchema,
  createdBy: principalRefSchema,
  updatedAt: timestampSchema,
  updatedBy: principalRefSchema,
} as const;

/** The common fields alone, for a place that reads them from any object. */
export const commonSchema = z.object(commonFields);

export type CommonFields = z.infer<typeof commonSchema>;
