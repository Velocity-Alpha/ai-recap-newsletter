import { createApprovalOutlineData } from "@/src/features/newsletter/curation.service";
import {
  createRequestLogContext,
  jsonWithRequestId,
  logRequestError,
  logRequestStart,
  logRequestSuccess,
} from "@/src/server/observability";
import { hasValidApprovalSession } from "@/src/server/approval-auth";

export const runtime = "nodejs";

function getDateFromQuery(searchParams: URLSearchParams): Date {
  const dateParam = searchParams.get("date");
  if (!dateParam) {
    return new Date();
  }

  const date = new Date(dateParam);
  if (isNaN(date.getTime())) {
    return new Date();
  }

  return date;
}

export async function GET(request: Request) {
  const context = createRequestLogContext("api.newsletters.outline", request);
  logRequestStart(context);

  try {
    if (!(await hasValidApprovalSession(request))) {
      return jsonWithRequestId(context, { error: "Unauthorized." }, { status: 401 });
    }

    const url = new URL(request.url);
    const date = getDateFromQuery(url.searchParams);

    const outlineData = await createApprovalOutlineData(date);

    logRequestSuccess(context, {
      sectionsCount: outlineData.candidate_sections.length,
      storiesCount: outlineData.selected_story_ids.length,
    });

    return jsonWithRequestId(context, outlineData);
  } catch (error) {
    logRequestError(context, "Outline creation failed", error);
    return jsonWithRequestId(
      context,
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
