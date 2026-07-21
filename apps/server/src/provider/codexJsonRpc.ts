export interface CodexUserInputAnswer {
  readonly answers: string[];
}

export interface CodexJsonRpcError {
  readonly code?: number;
  readonly message?: string;
}

export interface CodexJsonRpcRequest {
  readonly id: string | number;
  readonly method: string;
  readonly params?: unknown;
}

export interface CodexJsonRpcResponse {
  readonly id: string | number;
  readonly result?: unknown;
  readonly error?: CodexJsonRpcError;
}

export interface CodexJsonRpcNotification {
  readonly method: string;
  readonly params?: unknown;
}
