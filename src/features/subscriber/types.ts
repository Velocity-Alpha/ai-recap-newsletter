export type SubscriberStatus = "active" | "unsubscribed";

export interface SubscriberRecord {
  id: number;
  email: string;
  firstName: string | null;
  status: SubscriberStatus;
  source: string;
  subscribedAt: string;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriberSessionPayload {
  subscriberId: number;
  email: string;
  issuedAt: number;
  expiresAt: number;
}

export interface SubscribeResponse {
  success: true;
  newlySubscribed: boolean;
}

export interface ApiErrorResponse {
  error: string;
  code?: string;
}

export interface RequestCodeResponse {
  success: true;
}

export interface VerifyCodeResponse {
  success: true;
}

export interface UnsubscribeResponse {
  success: true;
}
