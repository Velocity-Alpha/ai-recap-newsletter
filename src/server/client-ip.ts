/**
 * The caller's IP address, from `x-nf-client-connection-ip`. Netlify's edge sets that header to the
 * address of the connecting client, and keeps it on requests to functions. docs.netlify.com has no page
 * for it; see Netlify's announcement and its own example code:
 * - https://answers.netlify.com/t/upcoming-change-stripping-exposed-netlify-headers-from-function-and-proxy-requests/52665
 * - https://github.com/netlify/netlify-drop-examples/blob/main/chat/src/server/demo-limits.ts
 *
 * The client can write any `x-forwarded-for` it likes, so that header is read only when APP_ENV is
 * development (local `next dev` / `next start`, which have no Netlify edge).
 */
export function getClientIp(request: Request): string | null {
  const netlifyIp = request.headers.get("x-nf-client-connection-ip")?.trim();
  if (netlifyIp) return netlifyIp;

  if (process.env.APP_ENV !== "development") return null;
  const forwardedIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwardedIp || null;
}

/**
 * The identifier per-IP rate limits count against. One IPv6 user usually holds a whole /64, so IPv6
 * addresses are grouped by their /64; IPv4 addresses (including IPv4-mapped IPv6) stay whole.
 * A missing address shares one "unknown" bucket.
 */
export function rateLimitIpIdentifier(ip: string | null | undefined): string {
  let address = ip?.trim().toLowerCase() ?? "";
  if (!address) return "unknown";
  if (!address.includes(":")) return address;

  if (address.startsWith("[") && address.endsWith("]")) address = address.slice(1, -1);
  const groups = parseIpv6(address.split("%")[0]);
  if (!groups) return address;

  const isIpv4Mapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  if (isIpv4Mapped) return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join(".");

  return `${groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(":")}::/64`;
}

/** The eight 16-bit groups of an IPv6 address, or null when it does not parse. */
function parseIpv6(address: string): number[] | null {
  // Rewrite a trailing dotted IPv4 part ("::ffff:1.2.3.4") as two hex groups.
  const lastColon = address.lastIndexOf(":");
  const tail = address.slice(lastColon + 1);
  if (tail.includes(".")) {
    const octets = tail.split(".");
    if (octets.length !== 4 || octets.some((octet) => !/^\d{1,3}$/.test(octet) || Number(octet) > 255)) {
      return null;
    }
    const [a, b, c, d] = octets.map(Number);
    address = `${address.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }

  const halves = address.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;

  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...rest];
  if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map((group) => parseInt(group, 16));
}
