import type { SessionNotesResponse } from "./types";

export const DEV_MOCK_SESSION_ID = "mock-session-sidecar-layout";

export const DEV_MOCK_NOTES_STORAGE_KEY = `meetily-dev-notes:${DEV_MOCK_SESSION_ID}`;

export function parseDevMockNotes(value: string | null): SessionNotesResponse | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as Partial<SessionNotesResponse>;
    if (parsed.session_id !== DEV_MOCK_SESSION_ID || typeof parsed.content !== "string") {
      return null;
    }
    return parsed as SessionNotesResponse;
  } catch {
    return null;
  }
}

export function readDevMockNotes(): SessionNotesResponse | null {
  try {
    return parseDevMockNotes(localStorage.getItem(DEV_MOCK_NOTES_STORAGE_KEY));
  } catch {
    return null;
  }
}
