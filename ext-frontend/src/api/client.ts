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
//
// 認証:
//   全リクエストにクエリパラメータ `?token=xxx` を付与する。
// =============================================================================

import type {
  TranscriptSegmentResponse,
  CreateRevisionRequest,
  CreateCommentRequest,
  CreateHighlightRequest,
  TranscriptRevisionResponse,
  TranscriptCommentResponse,
  TranscriptHighlightResponse,
} from "../types";

// =============================================================================
// API クライアント設定
// =============================================================================

/** API クライアントの設定オプション */
export interface ApiClientOptions {
  /** API ベース URL（省略時は環境変数から取得） */
  baseUrl?: string;
  /** 認証トークン（省略時は環境変数から取得） */
  token?: string;
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
  private readonly token: string;

  constructor(options?: ApiClientOptions) {
    // Env var → empty string (same origin, works with Vite dev proxy)
    this.baseUrl = options?.baseUrl ?? import.meta.env.VITE_MEETILY_API_BASE ?? "";
    this.token = options?.token ?? import.meta.env.VITE_MEETILY_ACCESS_TOKEN ?? "dev-token";
  }

  // -------------------------------------------------------------------------
  // 内部ヘルパー
  // -------------------------------------------------------------------------

  /**
   * 認証トークン付きの URL を生成する。
   * 全リクエストにクエリパラメータ `?token=xxx` を付与する。
   */
  private buildUrl(path: string): string {
    // When baseUrl is empty, resolve against the current page origin (proxy mode)
    const base = this.baseUrl || window.location.origin;
    const url = new URL(path, base);
    url.searchParams.set("token", this.token);
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
   */
  async getSessionTranscripts(
    sessionId: string
  ): Promise<TranscriptSegmentResponse[]> {
    return this.request<TranscriptSegmentResponse[]>(
      `/api/sessions/${encodeURIComponent(sessionId)}/transcripts`
    );
  }

  /**
   * 保存済み会議の文字起こし + overlay を取得する。
   * meeting_id が確定した後に使用する。
   */
  async getMeetingTranscripts(
    meetingId: string
  ): Promise<TranscriptSegmentResponse[]> {
    return this.request<TranscriptSegmentResponse[]>(
      `/api/meetings/${encodeURIComponent(meetingId)}/transcripts`
    );
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
