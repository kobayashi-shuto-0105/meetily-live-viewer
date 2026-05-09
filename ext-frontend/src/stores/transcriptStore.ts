import { create } from "zustand";

import type {
  TranscriptSegmentPayload,
  TranscriptRevisionPayload,
  TranscriptCommentPayload,
  TranscriptHighlightPayload,
  TranscriptSegmentView,
  ConnectionStatus,
  SessionInfo,
  TranscriptSegmentResponse,
} from "../types";

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

  /**
   * Incremented whenever the user presses ⌘+Enter on a selected segment.
   * The bottom comment input watches this value and auto-focuses.
   */
  commentInputTrigger: number;

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
  loadSegments: (responses: TranscriptSegmentResponse[]) => void;
  clearSegments: () => void;

  setSelectedSegmentId: (id: string | null) => void;
  triggerCommentInput: () => void;
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

// ----------------------------------------------------------------
// Store
// ----------------------------------------------------------------

export const useTranscriptStore = create<TranscriptState>((set) => ({
  connectionStatus: "disconnected",
  session: null,
  segments: new Map(),
  sortedSegments: [],
  selectedSegmentId: null,
  commentInputTrigger: 0,

  setConnectionStatus: (status) => set({ connectionStatus: status }),

  startSession: (sessionId, meetingTitle, startedAt) =>
    set({
      session: { sessionId, meetingTitle, startedAt, isStopped: false, meetingId: null },
      segments: new Map(),
      sortedSegments: [],
      selectedSegmentId: null,
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
          revisions: res.revisions.map((r) => ({
            id: r.id,
            external_segment_id: r.external_segment_id,
            edited_text: r.edited_text,
            version: r.version,
          })),
          comments: res.comments.map((c) => ({
            id: c.id,
            external_segment_id: c.external_segment_id,
            comment_text: c.comment_text,
            author_name: c.author_name,
            anchor_start: c.anchor_start,
            anchor_end: c.anchor_end,
            anchor_revision_id: c.anchor_revision_id,
          })),
          highlights: res.highlights.map((h) => ({
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

  clearSegments: () => set({ segments: new Map(), sortedSegments: [], selectedSegmentId: null }),

  setSelectedSegmentId: (id) => set({ selectedSegmentId: id }),

  triggerCommentInput: () =>
    set((state) => ({ commentInputTrigger: state.commentInputTrigger + 1 })),
}));

// ----------------------------------------------------------------
// Selectors
// ----------------------------------------------------------------

export const selectSortedSegments = (
  state: TranscriptState
): TranscriptSegmentView[] => state.sortedSegments;
