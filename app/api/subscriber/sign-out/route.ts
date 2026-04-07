import { clearSubscriberSessionCookie } from "@/features/subscriber/session";
import {
  createRequestLogContext,
  jsonWithRequestId,
  logRequestStart,
  logRequestSuccess,
} from "@/server/observability";

export async function POST(request: Request) {
  const context = createRequestLogContext("api.subscriber.sign-out", request);
  logRequestStart(context);

  const response = jsonWithRequestId(context, { success: true });
  clearSubscriberSessionCookie(response.cookies);
  logRequestSuccess(context);
  return response;
}
