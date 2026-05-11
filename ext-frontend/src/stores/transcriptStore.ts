import { create } from "zustand";

import type {
  TranscriptSegmentPayload,
  TranscriptRevisionPayload,
  TranscriptCommentPayload,
  TranscriptHighlightPayload,
  TranscriptHighlightDeletedPayload,
  TranscriptSegmentView,
  ConnectionStatus,
  SessionInfo,
  TranscriptSegmentResponse,
  Section,
  TranscriptSectionPayload,
} from "../types";
import { apiClient } from "../api/client";

// ----------------------------------------------------------------
// State shape
// ----------------------------------------------------------------

interface TranscriptState {
  connectionStatus: ConnectionStatus;
  session: SessionInfo | null;
  segments: Map<string, TranscriptSegmentView>;
  sortedSegments: TranscriptSegmentView[];

  /** ID of the segment currently focused by the user (click-to-select) */
  selectedSegmentId: string | null;

  /** Segment currently showing the side comment composer. */
  commentInputSegmentId: string | null;

  /** Section dividers inserted between segments. */
  sections: Section[];

  /** Section currently being created/edited inline (null = no editor open). */
  sectionEditingId: string | null;

  /** The sequenceId where a new section editor is open (before clicking Save). */
  sectionInsertAt: number | null;

  // --- actions ---
  setConnectionStatus: (status: ConnectionStatus) => void;
  startSession: (sessionId: string, meetingTitle: string | null, startedAt: string) => void;
  stopSession: () => void;
  setMeetingId: (sessionId: string, meetingId: string) => void;

  /** Restore a session without clearing existing segments. */
  restoreSession: (sessionId: string, meetingTitle: string | null, startedAt: string) => void;

  upsertSegment: (payload: TranscriptSegmentPayload) => void;
  addRevision: (payload: TranscriptRevisionPayload) => void;
  addComment: (payload: TranscriptCommentPayload) => void;
  addHighlight: (payload: TranscriptHighlightPayload) => void;
  removeHighlight: (payload: TranscriptHighlightDeletedPayload) => void;
  loadSegments: (responses: TranscriptSegmentResponse[]) => void;
  clearSegments: () => void;

  setSelectedSegmentId: (id: string | null) => void;
  openCommentInput: (id: string) => void;
  closeCommentInput: () => void;

  // --- section actions ---
  addSection: (beforeSequenceId: number, title: string, description: string) => void;
  updateSection: (id: string, title: string, description: string) => void;
  removeSection: (id: string) => void;
  setSectionEditingId: (id: string | null) => void;
  openSectionInsert: (beforeSequenceId: number) => void;
  closeSectionInsert: () => void;
  loadSections: (sections: Section[]) => void;

  /** Apply a section from a WebSocket event (create or update) */
  applySectionFromServer: (payload: TranscriptSectionPayload) => void;
  /** Remove a section from a WebSocket event */
  removeSectionFromServer: (id: string) => void;
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function toSortedArray(
  segments: Map<string, TranscriptSegmentView>
): TranscriptSegmentView[] {
  return Array.from(segments.values()).sort(
    (a, b) => a.sequenceId - b.sequenceId
  );
}

function createClientId(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if (randomUuid) return randomUuid();

  const randomValues = globalThis.crypto?.getRandomValues?.bind(globalThis.crypto);
  if (randomValues) {
    const bytes = randomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
      .slice(6, 8)
      .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ----------------------------------------------------------------
// Store
// ----------------------------------------------------------------

export const useTranscriptStore = create<TranscriptState>((set, get) => ({
  connectionStatus: "disconnected",
  session: null,
  segments: new Map(),
  sortedSegments: [],
  selectedSegmentId: null,
  commentInputSegmentId: null,
  sections: [],
  sectionEditingId: null,
  sectionInsertAt: null,

  setConnectionStatus: (status) => set({ connectionStatus: status }),

  startSession: (sessionId, meetingTitle, startedAt) =>
    set({
      session: { sessionId, meetingTitle, startedAt, isStopped: false, meetingId: null },
      segments: new Map(),
      sortedSegments: [],
      selectedSegmentId: null,
      commentInputSegmentId: null,
      sections: [],
      sectionEditingId: null,
      sectionInsertAt: null,
    }),

  stopSession: () =>
    set((state) => ({
      session: state.session ? { ...state.session, isStopped: true } : null,
    })),

  setMeetingId: (sessionId, meetingId) =>
    set((state) => {
      if (state.session?.sessionId !== sessionId) return state;
      return { session: { ...state.session, meetingId } };
    }),

  restoreSession: (sessionId, meetingTitle, startedAt) =>
    set((state) => ({
      session: {
        sessionId,
        meetingTitle,
        startedAt,
        isStopped: false,
        meetingId: state.session?.meetingId ?? null,
      },
    })),

  upsertSegment: (payload) =>
    set((state) => {
      const newSegments = new Map(state.segments);
      const existing = newSegments.get(payload.id);

      const view: TranscriptSegmentView = {
        id: payload.id,
        sessionId: payload.session_id,
        meetingId: payload.meeting_id,
        sequenceId: payload.sequence_id,
        rawText: payload.raw_text,
        displayText: payload.display_text,
        timestamp: payload.timestamp,
        source: payload.source,
        isPartial: payload.is_partial,
        confidence: payload.confidence,
        audioStartTime: payload.audio_start_time,
        audioEndTime: payload.audio_end_time,
        duration: payload.duration,
        revisions: existing?.revisions ?? [],
        comments: existing?.comments ?? [],
        highlights: existing?.highlights ?? [],
      };

      newSegments.set(payload.id, view);
      return { segments: newSegments, sortedSegments: toSortedArray(newSegments) };
    }),

  addRevision: (payload) =>
    set((state) => {
      const newSegments = new Map(state.segments);
      const segment = newSegments.get(payload.external_segment_id);
      if (!segment) return state;
      if (segment.revisions.some((r) => r.id === payload.id)) return state;

      const updatedSegment: TranscriptSegmentView = {
        ...segment,
        displayText: payload.edited_text,
        revisions: [...segment.revisions, payload],
      };

      newSegments.set(payload.external_segment_id, updatedSegment);
      return { segments: newSegments, sortedSegments: toSortedArray(newSegments) };
    }),

  addComment: (payload) =>
    set((state) => {
      const newSegments = new Map(state.segments);
      const segment = newSegments.get(payload.external_segment_id);
      if (!segment) return state;
      if (segment.comments.some((c) => c.id === payload.id)) return state;

      const updatedSegment: TranscriptSegmentView = {
        ...segment,
        comments: [...segment.comments, payload],
      };

      newSegments.set(payload.external_segment_id, updatedSegment);
      return { segments: newSegments, sortedSegments: toSortedArray(newSegments) };
    }),

  addHighlight: (payload) =>
    set((state) => {
      const newSegments = new Map(state.segments);
      const segment = newSegments.get(payload.external_segment_id);
      if (!segment) return state;
      if (segment.highlights.some((h) => h.id === payload.id)) return state;

      const updatedSegment: TranscriptSegmentView = {
        ...segment,
        highlights: [...segment.highlights, payload],
      };

      newSegments.set(payload.external_segment_id, updatedSegment);
      return { segments: newSegments, sortedSegments: toSortedArray(newSegments) };
    }),

  removeHighlight: (payload) =>
    set((state) => {
      const newSegments = new Map(state.segments);
      const segment = newSegments.get(payload.external_segment_id);
      if (!segment) return state;
      const filtered = segment.highlights.filter((h) => h.id !== payload.id);
      if (filtered.length === segment.highlights.length) return state;

      newSegments.set(payload.external_segment_id, {
        ...segment,
        highlights: filtered,
      });
      return { segments: newSegments, sortedSegments: toSortedArray(newSegments) };
    }),

  loadSegments: (responses) =>
    set(() => {
      const newSegments = new Map<string, TranscriptSegmentView>();

      for (const res of responses) {
        const view: TranscriptSegmentView = {
          id: res.id,
          sessionId: res.session_id,
          meetingId: res.meeting_id,
          sequenceId: res.sequence_id,
          rawText: res.raw_text,
          displayText: res.display_text,
          timestamp: res.timestamp,
          source: res.source ?? "unknown",
          isPartial: res.is_partial,
          confidence: res.confidence ?? 0,
          audioStartTime: res.audio_start_time ?? 0,
          audioEndTime: res.audio_end_time ?? 0,
          duration: res.duration ?? 0,
          // Guard against missing fields — server may omit revisions
          revisions: (res.revisions ?? []).map((r) => ({
            id: r.id,
            external_segment_id: r.external_segment_id,
            edited_text: r.edited_text,
            version: r.version,
          })),
          comments: (res.comments ?? []).map((c) => ({
            id: c.id,
            external_segment_id: c.external_segment_id,
            comment_text: c.comment_text,
            author_name: c.author_name,
            anchor_start: c.anchor_start,
            anchor_end: c.anchor_end,
            anchor_revision_id: c.anchor_revision_id,
            created_at: c.created_at,
          })),
          highlights: (res.highlights ?? []).map((h) => ({
            id: h.id,
            external_segment_id: h.external_segment_id,
            color: h.color,
            note: h.note,
            anchor_start: h.anchor_start,
            anchor_end: h.anchor_end,
            anchor_revision_id: h.anchor_revision_id,
          })),
        };

        newSegments.set(res.id, view);
      }

      return { segments: newSegments, sortedSegments: toSortedArray(newSegments) };
    }),

  clearSegments: () =>
    set({
      segments: new Map(),
      sortedSegments: [],
      selectedSegmentId: null,
      commentInputSegmentId: null,
    }),

  setSelectedSegmentId: (id) =>
    set({ selectedSegmentId: id, commentInputSegmentId: null }),

  openCommentInput: (id) =>
    set({ selectedSegmentId: id, commentInputSegmentId: id }),

  closeCommentInput: () => set({ commentInputSegmentId: null }),

  // --- section actions ---

  addSection: async (beforeSequenceId, title, description) => {
    if (get().sections.some((s) => s.beforeSequenceId === beforeSequenceId)) return;

    // Optimistic update with a temp ID so the UI responds immediately
    const tempId = `temp-${createClientId()}`;
    const tempSection: Section = {
      id: tempId,
      title,
      description,
      beforeSequenceId,
      createdAt: new Date().toISOString(),
    };
    set((state) => ({
      sections: [...state.sections, tempSection].sort(
        (a, b) => a.beforeSequenceId - b.beforeSequenceId
      ),
      sectionInsertAt: null,
    }));

    const sessionId = get().session?.sessionId;
    if (!sessionId) return;

    try {
      const res = await apiClient.createSection(sessionId, { title, description, beforeSequenceId });
      // Replace the temp section with the server-assigned ID so update/delete work correctly
      set((state) => ({
        sections: state.sections.map((s) =>
          s.id === tempId
            ? { id: res.id, title: res.title, description: res.description, beforeSequenceId: res.before_sequence_id, createdAt: res.created_at }
            : s
        ),
      }));
    } catch (e) {
      console.warn("[sections] Failed to persist section, rolling back:", e);
      set((state) => ({ sections: state.sections.filter((s) => s.id !== tempId) }));
    }
  },

  updateSection: (id, title, description) =>
    set((state) => {
      // Fire-and-forget API call
      apiClient.updateSection(id, { title, description }).catch((e) => {
        console.warn("[sections] Failed to update section:", e);
      });

      return {
        sections: state.sections.map((s) =>
          s.id === id ? { ...s, title, description } : s
        ),
        sectionEditingId: null,
      };
    }),

  removeSection: (id) =>
    set((state) => {
      // Fire-and-forget API call
      apiClient.deleteSection(id).catch((e) => {
        console.warn("[sections] Failed to delete section:", e);
      });

      return {
        sections: state.sections.filter((s) => s.id !== id),
      };
    }),

  setSectionEditingId: (id) => set({ sectionEditingId: id }),

  openSectionInsert: (beforeSequenceId) =>
    set({ sectionInsertAt: beforeSequenceId }),

  closeSectionInsert: () => set({ sectionInsertAt: null }),

  loadSections: (sections) =>
    set({
      sections: [...sections].sort((a, b) => a.beforeSequenceId - b.beforeSequenceId),
    }),

  applySectionFromServer: (payload) =>
    set((state) => {
      const section: Section = {
        id: payload.id,
        title: payload.title,
        description: payload.description,
        beforeSequenceId: payload.before_sequence_id,
        createdAt: payload.created_at,
      };

      // Check if it already exists (update case)
      const existing = state.sections.findIndex((s) => s.id === payload.id);
      let newSections: Section[];
      if (existing >= 0) {
        newSections = state.sections.map((s) =>
          s.id === payload.id ? section : s
        );
      } else {
        // Avoid duplicate at same position
        if (state.sections.some((s) => s.beforeSequenceId === payload.before_sequence_id)) {
          newSections = state.sections.map((s) =>
            s.beforeSequenceId === payload.before_sequence_id ? section : s
          );
        } else {
          newSections = [...state.sections, section];
        }
      }

      return {
        sections: newSections.sort((a, b) => a.beforeSequenceId - b.beforeSequenceId),
      };
    }),

  removeSectionFromServer: (id) =>
    set((state) => ({
      sections: state.sections.filter((s) => s.id !== id),
    })),
}));

// ----------------------------------------------------------------
// Selectors
// ----------------------------------------------------------------

export const selectSortedSegments = (
  state: TranscriptState
): TranscriptSegmentView[] => state.sortedSegments;

export const selectSectionsMap = (
  state: TranscriptState
): Map<number, Section> => {
  const map = new Map<number, Section>();
  for (const section of state.sections) {
    map.set(section.beforeSequenceId, section);
  }
  return map;
};
