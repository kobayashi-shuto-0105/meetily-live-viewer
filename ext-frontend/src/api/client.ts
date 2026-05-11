// =============================================================================
// REST API クライアント
// =============================================================================
// Meetily External Web API の REST エンドポイントにアクセスするクライアント。
//
// エンドポイント一覧:
//   GET  /health                                - 疎通確認
//   GET  /api/sessions/current                  - 現在の録音セッション取得
//   GET  /api/sessions/:id/transcripts          - セッション内セグメント取得
//   GET  /api/meetings/:id/transcripts          - 保存済み会議の文字起こし取得
//   POST /api/segments/:id/revisions            - 文字起こし修正作成
//   POST /api/segments/:id/comments             - コメント追加
//   POST /api/segments/:id/highlights           - ハイライト追加
//   DELETE /api/segments/:id/highlights/:hid    - ハイライト削除（トグル取り消し）
//
// 認証（オプション）:
//   VITE_MEETILY_ACCESS_TOKEN が設定されている場合のみ `?token=xxx` を付与する。
// =============================================================================

import type {
  TranscriptSegmentResponse,
  CreateRevisionRequest,
  CreateCommentRequest,
  CreateHighlightRequest,
  TranscriptRevisionResponse,
  TranscriptCommentResponse,
  TranscriptHighlightResponse,
  CreateSectionRequest,
  UpdateSectionRequest,
  SectionResponse,
} from "../types";
import { getRuntimeAccessToken } from "./runtime";

// =============================================================================
// API クライアント設定
// =============================================================================

/** API クライアントの設定オプション */
export interface ApiClientOptions {
  /** API ベース URL（省略時は環境変数から取得） */
  baseUrl?: string;
  /** 認証トークン（省略時は環境変数から取得、未設定なら認証なし） */
  token?: string | null;
}

// =============================================================================
// 現在のセッション情報のレスポンス型
// =============================================================================

/** GET /api/sessions/current のレスポンス */
export interface CurrentSessionResponse {
  session_id: string;
  meeting_title: string | null;
  started_at: string;
}

// =============================================================================
// API クライアントクラス
// =============================================================================

/**
 * Meetily External Web API の REST クライアント。
 *
 * 使い方:
 *   const api = new ApiClient();
 *   const segments = await api.getSessionTranscripts("session-id-123");
 *   await api.createRevision("segment-id-456", { editedText: "修正後テキスト" });
 */
export class ApiClient {
  private readonly baseUrl: string;
  private readonly token: string | null;

  constructor(options?: ApiClientOptions) {
    // Env var → empty string (same origin, works with Vite dev proxy)
    this.baseUrl = options?.baseUrl ?? import.meta.env.VITE_MEETILY_API_BASE ?? "";
    const envToken = import.meta.env.VITE_MEETILY_ACCESS_TOKEN;
    const raw = options?.token !== undefined
      ? options.token
      : (envToken && envToken.length > 0 ? envToken : getRuntimeAccessToken());
    this.token = raw && raw.length > 0 ? raw : null;
  }

  // -------------------------------------------------------------------------
  // 内部ヘルパー
  // -------------------------------------------------------------------------

  /**
   * URL を生成する。トークンが設定されている場合のみ `?token=xxx` を付与する。
   */
  private buildUrl(path: string): string {
    const base = this.baseUrl || window.location.origin;
    const url = new URL(path, base);
    if (this.token) {
      url.searchParams.set("token", this.token);
    }
    return url.toString();
  }

  /**
   * HTTP リクエストを実行し、レスポンスを JSON としてパースする。
   * エラーレスポンスの場合は例外をスローする。
   */
  private async request<T>(
    path: string,
    options?: RequestInit
  ): Promise<T> {
    const url = this.buildUrl(path);

    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });

    // エラーレスポンスの場合はエラーをスローする
    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new ApiError(response.status, errorText, path);
    }

    // レスポンスボディを JSON としてパースする
    return (await response.json()) as T;
  }

  // -------------------------------------------------------------------------
  // ヘルスチェック
  // -------------------------------------------------------------------------

  /** サーバーの疎通確認を行う（認証不要） */
  async checkHealth(): Promise<boolean> {
    try {
      const base = this.baseUrl || window.location.origin;
      const url = new URL("/health", base).toString();
      const response = await fetch(url);
      return response.ok;
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // セッション情報取得
  // -------------------------------------------------------------------------

  /**
   * 現在アクティブな録音セッション情報を取得する。
   * 録音中でない場合は null を返す。
   */
  async getCurrentSession(): Promise<CurrentSessionResponse | null> {
    return this.request<CurrentSessionResponse | null>(
      "/api/sessions/current"
    );
  }

  // -------------------------------------------------------------------------
  // セグメント取得
  // -------------------------------------------------------------------------

  /**
   * 指定セッション ID の全セグメントを取得する。
   * リアルタイム録音中でも録音後でも使用可能。
   *
   * Server returns { session_id, segments: [...] } — unwrap the array here.
   */
  async getSessionTranscripts(
    sessionId: string
  ): Promise<TranscriptSegmentResponse[]> {
    const res = await this.request<{ session_id: string; segments: TranscriptSegmentResponse[] }>(
      `/api/sessions/${encodeURIComponent(sessionId)}/transcripts`
    );
    return res.segments ?? [];
  }

  /**
   * 保存済み会議の文字起こし + overlay を取得する。
   * meeting_id が確定した後に使用する。
   *
   * Server returns { meeting_id, segments: [...] } — unwrap the array here.
   */
  async getMeetingTranscripts(
    meetingId: string
  ): Promise<TranscriptSegmentResponse[]> {
    const res = await this.request<{ meeting_id: string; segments: TranscriptSegmentResponse[] }>(
      `/api/meetings/${encodeURIComponent(meetingId)}/transcripts`
    );
    return res.segments ?? [];
  }

  // -------------------------------------------------------------------------
  // 文字起こし修正
  // -------------------------------------------------------------------------

  /**
   * 指定セグメントに対して文字起こし修正（revision）を作成する。
   * 新しい revision が作成されると、旧 active revision は自動的に非アクティブになる。
   */
  async createRevision(
    segmentId: string,
    body: CreateRevisionRequest
  ): Promise<TranscriptRevisionResponse> {
    return this.request<TranscriptRevisionResponse>(
      `/api/segments/${encodeURIComponent(segmentId)}/revisions`,
      {
        method: "POST",
        body: JSON.stringify(body),
      }
    );
  }

  // -------------------------------------------------------------------------
  // コメント追加
  // -------------------------------------------------------------------------

  /**
   * 指定セグメントにコメントを追加する。
   * anchor_start / anchor_end を指定すると、テキスト内の特定範囲に紐付く。
   */
  async createComment(
    segmentId: string,
    body: CreateCommentRequest
  ): Promise<TranscriptCommentResponse> {
    return this.request<TranscriptCommentResponse>(
      `/api/segments/${encodeURIComponent(segmentId)}/comments`,
      {
        method: "POST",
        body: JSON.stringify(body),
      }
    );
  }

  // -------------------------------------------------------------------------
  // ハイライト追加
  // -------------------------------------------------------------------------

  /**
   * 指定セグメントにハイライトを追加する。
   * anchor_start / anchor_end を指定すると、テキスト内の特定範囲に紐付く。
   */
  async createHighlight(
    segmentId: string,
    body: CreateHighlightRequest
  ): Promise<TranscriptHighlightResponse> {
    return this.request<TranscriptHighlightResponse>(
      `/api/segments/${encodeURIComponent(segmentId)}/highlights`,
      {
        method: "POST",
        body: JSON.stringify(body),
      }
    );
  }

  /**
   * 指定セグメントのハイライトを削除する。
   * 同種ハイライトの再付与によるトグル取り消し操作で使われる。
   * 成功時は 204 No Content が返るため、JSON パースを避ける専用パスを通す。
   */
  async deleteHighlight(
    segmentId: string,
    highlightId: string
  ): Promise<void> {
    const url = this.buildUrl(
      `/api/segments/${encodeURIComponent(segmentId)}/highlights/${encodeURIComponent(highlightId)}`
    );
    const response = await fetch(url, { method: "DELETE" });
    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new ApiError(
        response.status,
        errorText,
        `/api/segments/${segmentId}/highlights/${highlightId}`
      );
    }
  }

  // -------------------------------------------------------------------------
  // セクション操作
  // -------------------------------------------------------------------------

  /**
   * 指定セッション内の全セクションを取得する。
   */
  async getSessionSections(sessionId: string): Promise<SectionResponse[]> {
    const res = await this.request<{ session_id: string; sections: SectionResponse[] }>(
      `/api/sessions/${encodeURIComponent(sessionId)}/sections`
    );
    return res.sections ?? [];
  }

  /**
   * セクションを新規作成する。
   */
  async createSection(
    sessionId: string,
    body: CreateSectionRequest
  ): Promise<SectionResponse> {
    return this.request<SectionResponse>(
      `/api/sessions/${encodeURIComponent(sessionId)}/sections`,
      {
        method: "POST",
        body: JSON.stringify(body),
      }
    );
  }

  /**
   * セクションのタイトル・説明を更新する。
   */
  async updateSection(
    sectionId: string,
    body: UpdateSectionRequest
  ): Promise<SectionResponse> {
    return this.request<SectionResponse>(
      `/api/sections/${encodeURIComponent(sectionId)}`,
      {
        method: "PUT",
        body: JSON.stringify(body),
      }
    );
  }

  /**
   * セクションを削除する。
   */
  async deleteSection(sectionId: string): Promise<void> {
    const url = this.buildUrl(
      `/api/sections/${encodeURIComponent(sectionId)}`
    );
    const response = await fetch(url, { method: "DELETE" });
    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new ApiError(
        response.status,
        errorText,
        `/api/sections/${sectionId}`
      );
    }
  }
}

// =============================================================================
// API エラークラス
// =============================================================================

/**
 * REST API のエラーを表すカスタムエラークラス。
 * HTTP ステータスコードとエラーメッセージを保持する。
 */
export class ApiError extends Error {
  /** HTTP ステータスコード */
  readonly statusCode: number;
  /** サーバーからのエラーメッセージ */
  readonly serverMessage: string;
  /** リクエストしたパス */
  readonly path: string;

  constructor(statusCode: number, serverMessage: string, path: string) {
    super(`API Error ${statusCode} at ${path}: ${serverMessage}`);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.serverMessage = serverMessage;
    this.path = path;
  }
}

// =============================================================================
// デフォルトインスタンス
// =============================================================================

/**
 * デフォルト設定の API クライアントインスタンス。
 * 環境変数から baseUrl と token を自動取得する。
 */
export const apiClient = new ApiClient();
