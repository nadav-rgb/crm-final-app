import { requireAuth } from '../meeting-houses/_auth';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import reportServer from '../../../lib/interactionReportServer';

const { createInteractionReportHandler } = reportServer;

export default createInteractionReportHandler({ requireAuth, getSupabaseAdmin });
