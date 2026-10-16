import { describe, expect, it } from "vitest";

import { buildSubscriberWelcomeEmail } from "@/src/features/subscriber/welcomeEmailTemplate";

describe("subscriber welcome email template", () => {
  it("prefills the confirm button as a reply saying I am human", () => {
    const { html } = buildSubscriberWelcomeEmail("https://airecap.news");

    expect(html).toContain(
      'href="mailto:hello@updates.airecap.news?subject=Re%3A%20Welcome%20to%20AI%20Recap&body=I%20am%20human."',
    );
  });

  it("does not leak stray characters into the layout", () => {
    const { html } = buildSubscriberWelcomeEmail("https://airecap.news");

    expect(html).not.toContain("]]");
  });
});
