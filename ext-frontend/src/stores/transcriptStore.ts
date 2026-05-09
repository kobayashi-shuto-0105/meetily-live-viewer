// =============================================================================
// 文字起こしストア（Zustand）
// =============================================================================
// リアルタイム文字起こしの状態管理を行う Zustand ストア。
//
// 責務:
//   - WebSocket イベントに応じたセグメントの追加・更新（upsert）
//   - revision / comment / highlight の追加反映
//   - 接続状態とセッション情報の管理
//   - REST API から取得した既存セグメントの読み込み
//
// 設計方針:
//   - セグメントは Map<id, TranscriptSegmentView> で管理し、O(1) のルックアップを実現
//   - 表示順は sequence_id 昇順でソートした配列を computed で返す
//   - WebSocket イベント受信時に直接ストアを更新する（楽観的 UI）
// =============================================================================

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

// =============================================================================
// ストアの型定義
// =============================================================================

/** ストアの状態 */
interface TranscriptState {
  // --- 接続・セッション状態 ---

  /** WebSocket の接続状態 */
  connectionStatus: ConnectionStatus;

  /** 現在の録音セッション情報（録音中のみ） */
  session: SessionInfo | null;

  // --- セグメントデータ ---

  /** セグメントの Map（id → TranscriptSegmentView） */
  segments: Map<string, TranscriptSegmentView>;

  /**
   * sequence_id 昇順でソート済みのセグメント配列。
   * segments と同期して更新される。セレクターから同じ参照を返すことで
   * connectionStatus 等の無関係な状態変化による再レンダリングを防ぐ。
   */
  sortedSegments: TranscriptSegmentView[];

  // --- アクション ---

  /** WebSocket 接続状態を更新する */
  setConnectionStatus: (status: ConnectionStatus) => void;

  /** 録音開始時にセッション情報をセットする */
  startSession: (
    sessionId: string,
    meetingTitle: string | null,
    startedAt: string
  ) => void;

  /** 録音停止時にセッション情報を更新する */
  stopSession: () => void;

  /** meeting_id 確定時にセッション情報を更新する */
  setMeetingId: (sessionId: string, meetingId: string) => void;

  /**
   * セグメントを upsert する（WebSocket TranscriptSegmentUpserted 用）。
   * 既存セグメントがあれば更新、なければ新規追加する。
   */
  upsertSegment: (payload: TranscriptSegmentPayload) => void;

  /** revision を追加し、対象セグメントの displayText を更新する */
  addRevision: (payload: TranscriptRevisionPayload) => void;

  /** comment を追加する */
  addComment: (payload: TranscriptCommentPayload) => void;

  /** highlight を追加する */
  addHighlight: (payload: TranscriptHighlightPayload) => void;

  /**
   * REST API レスポンスからセグメントを一括読み込みする。
   * 既存のセグメントはクリアされる。
   */
  loadSegments: (responses: TranscriptSegmentResponse[]) => void;

  /** 全セグメントをクリアする */
  clearSegments: () => void;
}

// =============================================================================
// ストア生成
// =============================================================================

/** segments Map から sequence_id 昇順のソート済み配列を生成する */
function toSortedArray(
  segments: Map<string, TranscriptSegmentView>
): TranscriptSegmentView[] {
  return Array.from(segments.values()).sort(
    (a, b) => a.sequenceId - b.sequenceId
  );
}

export const useTranscriptStore = create<TranscriptState>((set) => ({
  // --- 初期状態 ---
  connectionStatus: "disconnected",
  session: null,
  segments: new Map(),
  sortedSegments: [],

  // -------------------------------------------------------------------------
  // 接続状態
  // -------------------------------------------------------------------------

  setConnectionStatus: (status) => set({ connectionStatus: status }),

  // -------------------------------------------------------------------------
  // セッション管理
  // -------------------------------------------------------------------------

  startSession: (sessionId, meetingTitle, startedAt) =>
    set({
      session: {
        sessionId,
        meetingTitle,
        startedAt,
        isStopped: false,
        meetingId: null,
      },
      // 新しいセッション開始時に前のセグメントをクリアする
      segments: new Map(),
      sortedSegments: [],
    }),

  stopSession: () =>
    set((state) => ({
      session: state.session
        ? { ...state.session, isStopped: true }
        : null,
    })),

  setMeetingId: (sessionId, meetingId) =>
    set((state) => {
      // セッション ID が一致する場合のみ meeting_id を更新する
      if (state.session?.sessionId !== sessionId) return state;
      return {
        session: { ...state.session, meetingId },
      };
    }),

  // -------------------------------------------------------------------------
  // セグメント操作
  // -------------------------------------------------------------------------

  upsertSegment: (payload) =>
    set((state) => {
      const newSegments = new Map(state.segments);

      // 既存セグメントを取得し、revisions/comments/highlights を引き継ぐ
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
        // 既存の overlay データを引き継ぐ
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

      // 対象セグメントが存在しない場合は何もしない
      if (!segment) return state;

      // 同じリビジョン ID が既に存在する場合はスキップ（重複防止）
      if (segment.revisions.some((r) => r.id === payload.id)) return state;

      // revision を追加し、displayText を最新の revision テキストに更新する
      const updatedSegment: TranscriptSegmentView = {
        ...segment,
        displayText: payload.edited_text,
        revisions: [...segment.revisions, payload],
      };

      newSegments.set(payload.external_segment_id, updatedSegment);
      // segments と sortedSegments の両方を更新する
      // （sortedSegments を更新しないと UI の selectSortedSegments が変更を検知できない）
      return { segments: newSegments, sortedSegments: toSortedArray(newSegments) };
    }),

  addComment: (payload) =>
    set((state) => {
      const newSegments = new Map(state.segments);
      const segment = newSegments.get(payload.external_segment_id);

      // 対象セグメントが存在しない場合は何もしない
      if (!segment) return state;

      // 同じコメント ID が既に存在する場合はスキップ（重複防止）
      if (segment.comments.some((c) => c.id === payload.id)) return state;

      const updatedSegment: TranscriptSegmentView = {
        ...segment,
        comments: [...segment.comments, payload],
      };

      newSegments.set(payload.external_segment_id, updatedSegment);
      // segments と sortedSegments の両方を更新する
      // （sortedSegments を更新しないと UI の selectSortedSegments が変更を検知できない）
      return { segments: newSegments, sortedSegments: toSortedArray(newSegments) };
    }),

  addHighlight: (payload) =>
    set((state) => {
      const newSegments = new Map(state.segments);
      const segment = newSegments.get(payload.external_segment_id);

      // 対象セグメントが存在しない場合は何もしない
      if (!segment) return state;

      // 同じハイライト ID が既に存在する場合はスキップ（重複防止）
      if (segment.highlights.some((h) => h.id === payload.id)) return state;

      const updatedSegment: TranscriptSegmentView = {
        ...segment,
        highlights: [...segment.highlights, payload],
      };

      newSegments.set(payload.external_segment_id, updatedSegment);
      // segments と sortedSegments の両方を更新する
      // （sortedSegments を更新しないと UI の selectSortedSegments が変更を検知できない）
      return { segments: newSegments, sortedSegments: toSortedArray(newSegments) };
    }),

  // -------------------------------------------------------------------------
  // 一括操作
  // -------------------------------------------------------------------------

  loadSegments: (responses) =>
    set(() => {
      const newSegments = new Map<string, TranscriptSegmentView>();

      for (const res of responses) {
        // REST API レスポンス（snake_case）を UI 用の型（camelCase）に変換する
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
          // REST レスポンスの overlay データを変換する
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

  clearSegments: () => set({ segments: new Map(), sortedSegments: [] }),
}));

// =============================================================================
// セレクター（パフォーマンス最適化用）
// =============================================================================

/**
 * sequence_id 昇順でソート済みのセグメント配列を返すセレクター。
 * ストアが sortedSegments を同期管理するため、毎回の sort コストなしに
 * 安定した参照を返す。connectionStatus 等の無関係な状態変化では
 * 参照が変わらないためコンポーネントの再レンダリングを防ぐ。
 *
 * コンポーネントで使用する:
 *   const segments = useTranscriptStore(selectSortedSegments);
 */
export const selectSortedSegments = (
  state: TranscriptState
): TranscriptSegmentView[] => state.sortedSegments;
