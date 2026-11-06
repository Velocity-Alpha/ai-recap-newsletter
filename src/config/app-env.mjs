// Plain JavaScript so next.config.mjs can import it without a build step.

/** @typedef {"development" | "preview" | "production"} AppEnv */

/** @type {readonly AppEnv[]} */
export const APP_ENVS = Object.freeze(["development", "preview", "production"]);

/**
 * Validates APP_ENV. Throws, so a missing or wrong value stops `next dev` and `next build`.
 * @param {string | undefined} value
 * @returns {AppEnv}
 */
export function parseAppEnv(value) {
  const trimmed = value?.trim() ?? "";
  const allowed = APP_ENVS.join(", ");

  if (!trimmed) {
    throw new Error(`APP_ENV is required. Set it to one of: ${allowed}.`);
  }

  if (!APP_ENVS.includes(/** @type {AppEnv} */ (trimmed))) {
    throw new Error(`APP_ENV must be one of: ${allowed}. Got "${trimmed}".`);
  }

  return /** @type {AppEnv} */ (trimmed);
}
