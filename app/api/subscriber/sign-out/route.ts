import { clearSubscriberSessionCookie } from "@/src/features/subscriber/server";
import {
  createRequestLogContext,
  jsonWithRequestId,
  logRequestStart,
  logRequestSuccess,
} from "@/src/server/observability";

export async function POST(request: Request) {
  const context = createRequestLogContext("api.subscriber.sign-out", request);
  logRequestStart(context);

  const response = jsonWithRequestId(context, { success: true });
  clearSubscriberSessionCookie(response.cookies);
  logRequestSuccess(context);
  return response;
}
