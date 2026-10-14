export type SubscriberProvider = "beehiiv" | "ghl";

const SUBSCRIBER_PROVIDERS: readonly SubscriberProvider[] = ["beehiiv", "ghl"];

/**
 * Selects which external list owns newsletter subscriptions.
 * Defaults to Beehiiv so an unset env keeps the current production behaviour.
 */
export function getSubscriberProvider(): SubscriberProvider {
  const configured = process.env.SUBSCRIBER_PROVIDER?.trim().toLowerCase();

  if (!configured) {
    return "beehiiv";
  }

  if (!SUBSCRIBER_PROVIDERS.includes(configured as SubscriberProvider)) {
    throw new Error(
      `SUBSCRIBER_PROVIDER "${process.env.SUBSCRIBER_PROVIDER}" is not configured. Use "beehiiv" or "ghl".`,
    );
  }

  return configured as SubscriberProvider;
}
