import { supabase } from "@/lib/supabase";

type EventType = "session_start" | "file_upload" | "report_generate";

interface EventPayload {
  session_id: string;
  event_type: EventType;
  role?: string;
  timeframe?: string;
  report_type?: string;
  data_source?: string;
  data_rows?: number;
  data_cols?: number;
  referrer?: string | null;
}

export async function logEvent(payload: EventPayload): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.from("nixara_events").insert(payload);
  } catch {
    // Fire-and-forget — never block the response
  }
}