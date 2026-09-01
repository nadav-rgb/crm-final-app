import { z } from 'zod';

const MAX_ARRAY_ITEMS = 100;
const MAX_NOTES = 4_000;
const MAX_AI_TEXT = 8_000;
const shortText = z.string().trim().min(1).max(120);
const projectId = z.number().int().positive();
const uuid = z.string().uuid();
const optionalNotes = z.string().max(MAX_NOTES).optional();
const boundedId = z.union([uuid, z.number().int().positive()]);
const boundedTextId = z.union([
  z.number().int().positive(),
  z.string().trim().min(1).max(256).regex(/^[\p{L}\p{N}._:-]+$/u),
]);
const nullableShortText = z.string().trim().max(120).nullable().optional();
const mitzvotSchema = z.record(z.string().min(1).max(120), z.number().int().min(0).max(10))
  .refine((value) => Object.keys(value).length <= MAX_ARRAY_ITEMS);
const mitzvotHistorySchema = z.array(z.object({
  mitzva: z.string().trim().min(1).max(120),
  from: z.number().int().min(0).max(10),
  to: z.number().int().min(0).max(10),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strict()).max(500);

function isRealNonFutureDate(value) {
  const [year, month, day] = String(value).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    && value <= new Date().toISOString().slice(0, 10);
}

export const uuidSchema = uuid;
export const textResourceIdSchema = boundedTextId;
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
export const mfaChallengeSchema = z.object({ factorId: uuid.optional() }).strict();

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
  projectId: projectId.optional(),
  name: shortText,
  phone: z.string().trim().regex(/^\+?[0-9 -]{7,20}$/).nullable().optional(),
  city: nullableShortText,
  area: nullableShortText,
  depth: nullableShortText,
  profession: nullableShortText,
  age: z.number().int().min(0).max(130).nullable().optional(),
  gender: z.enum(['male', 'female']).nullable().optional(),
  highPotential: z.boolean().optional(),
  daysSinceLastContact: z.number().int().min(0).max(100_000).optional(),
  lastInteractionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  nextAction: z.string().trim().max(500).nullable().optional(),
  nextActionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  source: nullableShortText,
  joinedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  notes: z.string().max(MAX_NOTES).nullable().optional(),
  howMet: z.string().trim().max(500).nullable().optional(),
  mitzvot: mitzvotSchema.optional(),
  mitzvotHistory: mitzvotHistorySchema.optional(),
  isGraduate: z.boolean().optional(),
  referredBy: boundedId.nullable().optional(),
  meetingPlaceCity: nullableShortText,
  meetingPlaceNumber: nullableShortText,
  meetingHouseCity: nullableShortText,
  meetingHouseNumber: nullableShortText,
  meetingHouseKey: z.string().trim().max(256).nullable().optional(),
  tourId: boundedTextId.nullable().optional(),
  assignedUserId: uuid.optional(),
}).strict();

export const contactUpdateSchema = contactCreateSchema.omit({ projectId: true }).partial().strict().refine(
  (value) => Object.keys(value).length > 0,
  { message: 'At least one editable field is required' },
);

const participantPayloadSchema = z.object({
  count: z.number().int().min(0).max(10_000).optional(),
  clients: z.array(z.object({ id: boundedId, name: z.string().trim().max(120) }).strict()).max(MAX_ARRAY_ITEMS).optional(),
  external: z.array(z.string().trim().min(1).max(120)).max(MAX_ARRAY_ITEMS).optional(),
  derived_from: boundedId.optional(),
}).strict();

const interactionFields = {
  occurredAt: z.string().datetime({ offset: true }).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  type: shortText,
  quality: z.string().trim().max(120).optional(),
  durationMinutes: z.number().int().min(0).max(1_440).optional(),
  outcome: z.string().trim().max(500).optional(),
  notes: optionalNotes,
  description: z.string().max(MAX_NOTES).optional(),
  aiSummary: z.string().max(MAX_AI_TEXT).optional(),
  nextAction: z.string().trim().max(500).nullable().optional(),
  nextActionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  participantIds: z.array(boundedId).max(MAX_ARRAY_ITEMS).optional(),
  participants: participantPayloadSchema.optional(),
};

function refineInteraction(schema) {
  return schema.strict().refine((value) => Boolean(value.date || value.occurredAt), {
  message: 'An interaction date is required',
}).refine((value) => !(value.participantIds && value.participants), {
  message: 'Use one participant representation',
});
}

export const interactionBodySchema = refineInteraction(z.object(interactionFields));
export const interactionCreateSchema = refineInteraction(z.object({ contactId: boundedId, ...interactionFields }));

export const interactionUpdateSchema = z.object({
  type: shortText.optional(),
  quality: z.string().trim().max(120).optional(),
  notes: optionalNotes,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  durationMinutes: z.number().int().min(0).max(1_440).optional(),
  outcome: z.string().trim().max(500).optional(),
  description: z.string().max(MAX_NOTES).optional(),
  aiSummary: z.string().max(MAX_AI_TEXT).optional(),
  nextAction: z.string().trim().max(500).nullable().optional(),
  nextActionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
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

export const tourCommandSchema = z.object({
  id: boundedTextId.optional(),
  projectId: projectId.optional(),
  title: shortText,
  tourNumber: z.string().trim().max(80).optional(),
  settlement: shortText,
  date: isoDateSchema.optional(),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  guideName: z.string().trim().max(120).optional(),
  notes: optionalNotes,
}).strict();

export const tourUpdateCommandSchema = tourCommandSchema.omit({ id: true, projectId: true }).partial().strict().refine(
  (value) => Object.keys(value).length > 0,
  { message: 'At least one editable field is required' },
);

export const tourAssignmentCommandSchema = z.object({
  tourId: boundedTextId,
  assignedUserIds: z.array(uuid).max(MAX_ARRAY_ITEMS),
  guideUserId: uuid.nullable().optional(),
  hostUserId: uuid.nullable().optional(),
}).strict();

export const tourReportCommandSchema = z.object({
  notes: z.string().trim().min(1).max(MAX_NOTES),
  participantCount: z.number().int().min(0).max(10_000).optional(),
  outcome: z.string().trim().max(500).optional(),
}).strict();

export const tourCancelCommandSchema = z.object({
  tourId: boundedTextId,
  reason: z.string().trim().max(200).optional(),
}).strict();

export const tourIdCommandSchema = z.object({ tourId: boundedTextId }).strict();

export const expenseCreateSchema = z.object({
  amount: z.number().finite().positive().max(1_000_000),
  occurredOn: isoDateSchema.refine(isRealNonFutureDate),
  description: z.string().trim().min(1).max(MAX_NOTES),
}).strict();

export const bonusCancellationCreateSchema = z.object({
  bonusKey: z.string().trim().min(1).max(512),
}).strict();

export const feedbackCreateSchema = z.object({
  category: z.enum(['bug', 'stuck', 'suggestion']),
  message: z.string().trim().min(1).max(MAX_NOTES),
}).strict();

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2_048),
  keys: z.object({
    p256dh: z.string().min(1).max(512),
    auth: z.string().min(1).max(512),
  }).strict(),
}).strict();

export const ownedPushSubscriptionSchema = pushSubscriptionSchema;
export const pushEndpointSchema = z.object({ endpoint: z.string().url().max(2_048) }).strict();
export const ownedFcmTokenSchema = z.object({
  token: z.string().min(32).max(4_096),
  platform: z.enum(['android', 'ios']).default('android'),
}).strict();

export const notificationEventSchema = z.object({
  eventType: z.enum([
    'meeting_house_assigned', 'tour_created', 'tour_updated', 'tour_cancelled',
    'tour_reported', 'interaction_created', 'interaction_summary',
    'interaction_self_payment', 'interaction_payment',
    'base_meeting_reported', 'mitzvot_updated', 'self_test',
  ]),
  resourceId: boundedId,
}).strict();

export const aiSummarySchema = z.object({
  resourceType: z.enum(['interaction', 'base_meeting']),
  resourceId: boundedId,
}).strict();
