import { createDraftApprovalData } from "@/src/features/newsletter/curation.service";
import {
  createRequestLogContext,
  jsonWithRequestId,
  logRequestError,
  logRequestStart,
  logRequestSuccess,
} from "@/src/server/observability";

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
  const context = createRequestLogContext("api.newsletters.draft", request);
  logRequestStart(context);

  try {
    const url = new URL(request.url);
    const date = getDateFromQuery(url.searchParams);

    const draftData = await createDraftApprovalData(date);

    logRequestSuccess(context, {
      sectionsCount: draftData.candidate_sections.length,
      storiesCount: draftData.selected_story_ids.length,
    });

    return jsonWithRequestId(context, draftData);
  } catch (error) {
    logRequestError(context, "Draft creation failed", error);
    return jsonWithRequestId(
      context,
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
