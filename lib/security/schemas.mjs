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
  username: z.string().trim().min(1).max(160),
  password: z.string().min(8).max(128),
}).strict();

export const mfaCodeSchema = z.object({
  factorId: uuid,
  challengeId: uuid,
  code: z.string().regex(/^\d{6}$/),
}).strict();

export const mfaEnrollSchema = z.object({}).strict();
export const mfaChallengeSchema = z.object({ factorId: uuid }).strict();

export const passwordResetRequestSchema = z.object({
  username: z.string().trim().min(1).max(160),
}).strict();

export const passwordResetVerifySchema = z.object({
  token: z.string().min(32).max(4096),
  password: z.string().min(12).max(128),
}).strict();

export const passwordResetCompleteSchema = z.object({
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

export const interactionUpdateSchema = z.object({
  type: shortText.optional(),
  quality: z.string().trim().max(120).optional(),
  notes: optionalNotes,
}).strict().refine(
  (value) => Object.keys(value).length > 0,
  { message: 'At least one editable field is required' },
);

export const duplicateContactSchema = z.object({
  phone: z.string().trim().regex(/^\+?[0-9 -]{7,20}$/),
  projectId,
}).strict();

export const membershipChangeSchema = z.object({
  userId: uuid,
  projectId,
  role: z.enum(['activist', 'coord', 'finance', 'head', 'ceo']),
  status: z.enum(['active', 'suspended', 'revoked']),
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

export const meetingHouseCommandSchema = z.object({
  id: boundedId.optional(),
  settlement: shortText,
  houseNumber: z.string().trim().max(80).optional(),
  city: z.string().trim().max(120).optional(),
  hostName: z.string().trim().max(120).optional(),
  facilitatorName: z.string().trim().max(120).optional(),
  assignedUserIds: z.array(uuid).max(MAX_ARRAY_ITEMS).default([]),
  meetings: z.array(z.object({
    meetingNumber: z.number().int().min(1).max(100),
    date: isoDateSchema.or(z.literal('')),
    startTime: z.string().regex(/^$|^([01]\d|2[0-3]):[0-5]\d$/),
    completed: z.boolean().default(false),
    notes: z.string().max(MAX_NOTES).default(''),
    summary: z.string().max(MAX_AI_TEXT).default(''),
  }).strict()).max(100).default([]),
  notes: optionalNotes,
}).strict();

export const baseReportCommandSchema = z.object({
  occurredAt: z.string().datetime({ offset: true }),
  notes: z.string().min(1).max(MAX_NOTES),
  participantIds: z.array(boundedId).max(MAX_ARRAY_ITEMS).default([]),
}).strict();

export const reminderScheduleSchema = z.object({ meetingId: boundedId }).strict();
export const reminderCancelSchema = z.object({ meetingId: boundedId }).strict();

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
