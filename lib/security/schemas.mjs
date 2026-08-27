import { z } from 'zod';

const MAX_ARRAY_ITEMS = 100;
const MAX_NOTES = 4_000;
const MAX_AI_TEXT = 8_000;
const shortText = z.string().trim().min(1).max(120);
const projectId = z.number().int().positive();
const uuid = z.string().uuid();
const optionalNotes = z.string().max(MAX_NOTES).optional();
const boundedId = z.union([uuid, z.number().int().positive()]);

export const uuidSchema = uuid;
export const idParamSchema = z.object({ id: boundedId }).strict();
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const paginationSchema = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.number().int().min(1).max(100).default(25),
}).strict();

export const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
}).strict();

export const mfaCodeSchema = z.object({
  factorId: uuid,
  code: z.string().regex(/^\d{6}$/),
}).strict();

export const passwordResetRequestSchema = z.object({
  email: z.string().email().max(254),
}).strict();

export const passwordResetVerifySchema = z.object({
  token: z.string().min(32).max(4096),
  password: z.string().min(12).max(128),
}).strict();

export const contactCreateSchema = z.object({
  name: shortText,
  phone: z.string().trim().regex(/^\+?[0-9 -]{7,20}$/).optional(),
  city: z.string().trim().max(120).optional(),
  notes: optionalNotes,
  assignedUserId: uuid.optional(),
}).strict();

export const contactUpdateSchema = contactCreateSchema.partial().strict().refine(
  (value) => Object.keys(value).length > 0,
  { message: 'At least one editable field is required' },
);

export const interactionCreateSchema = z.object({
  contactId: boundedId,
  occurredAt: z.string().datetime({ offset: true }),
  type: shortText,
  quality: z.string().trim().max(120).optional(),
  notes: optionalNotes,
  participantIds: z.array(boundedId).max(MAX_ARRAY_ITEMS).default([]),
}).strict();

export const meetingHouseSchema = z.object({
  id: boundedId.optional(),
  projectId,
  settlement: shortText,
  city: z.string().trim().max(120).optional(),
  hostName: z.string().trim().max(120).optional(),
  assignedUserIds: z.array(uuid).max(MAX_ARRAY_ITEMS).default([]),
  notes: optionalNotes,
}).strict();

export const meetingReportSchema = z.object({
  projectId,
  meetingHouseId: boundedId,
  occurredAt: z.string().datetime({ offset: true }),
  notes: z.string().min(1).max(MAX_NOTES),
  participantIds: z.array(boundedId).max(MAX_ARRAY_ITEMS).default([]),
}).strict();

export const tourCreateSchema = z.object({
  projectId,
  title: shortText,
  date: isoDateSchema.optional(),
  guideUserId: uuid.optional(),
  hostUserId: uuid.optional(),
  assignedUserIds: z.array(uuid).max(MAX_ARRAY_ITEMS).default([]),
  notes: optionalNotes,
}).strict();

export const tourReportSchema = z.object({
  tourId: boundedId,
  notes: z.string().min(1).max(MAX_NOTES),
}).strict();

export const expenseCreateSchema = z.object({
  projectId,
  amount: z.number().finite().positive().max(1_000_000),
  category: shortText,
  occurredOn: isoDateSchema,
  notes: optionalNotes,
}).strict();

export const feedbackCreateSchema = z.object({
  projectId,
  category: z.string().trim().min(1).max(80),
  message: z.string().trim().min(1).max(MAX_NOTES),
}).strict();

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2_048),
  keys: z.object({
    p256dh: z.string().min(1).max(512),
    auth: z.string().min(1).max(512),
  }).strict(),
}).strict();

export const aiSummarySchema = z.object({
  resourceType: z.enum(['contact', 'interaction', 'base_meeting', 'tour']),
  resourceId: boundedId,
  text: z.string().min(1).max(MAX_AI_TEXT).optional(),
}).strict();
