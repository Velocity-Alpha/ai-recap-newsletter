import { isIP } from "node:net";

/**
 * The reader runs inside a Netlify function, so a story link must never reach the function's own network:
 * localhost (the Lambda runtime API listens there), private ranges, link-local and cloud metadata addresses.
 * Two layers: `assertPublicUrl` checks every URL and redirect hop by name, and `createGuardedLookup` checks the
 * addresses a name resolves to when the connection is made, so DNS cannot point a public name at a private host.
 */

export class RefusedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RefusedUrlError";
  }
}

/** [first address, prefix length] */
const PRIVATE_V4: Array<[string, number]> = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, including 169.254.169.254 metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved and broadcast
];

function v4ToNumber(address: string): number {
  return address.split(".").reduce((value, part) => value * 256 + Number(part), 0);
}

function isPrivateV4(address: string): boolean {
  const value = v4ToNumber(address);
  return PRIVATE_V4.some(([base, bits]) => {
    const size = 2 ** (32 - bits);
    const start = v4ToNumber(base);
    return value >= start && value < start + size;
  });
}

/** The eight 16-bit groups of an IPv6 address. */
function v6Groups(address: string): number[] {
  let text = address.toLowerCase().split("%")[0];
  const v4Tail = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Tail) {
    const value = v4ToNumber(v4Tail[1]);
    text = `${text.slice(0, -v4Tail[1].length)}${(value >>> 16).toString(16)}:${(value & 0xffff).toString(16)}`;
  }
  const [head, tail] = text.split("::");
  const parse = (part: string | undefined) => (part ? part.split(":").map((group) => parseInt(group, 16)) : []);
  const left = parse(head);
  const right = parse(tail);
  const fill = tail === undefined ? [] : new Array(8 - left.length - right.length).fill(0);
  return [...left, ...fill, ...right];
}

function embeddedV4(groups: number[]): string {
  return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join(".");
}

function isPrivateV6(address: string): boolean {
  const groups = v6Groups(address);
  const [first] = groups;
  const zeroTo = (end: number) => groups.slice(0, end).every((group) => group === 0);
  if (zeroTo(8)) return true; // ::
  if (zeroTo(7) && groups[7] === 1) return true; // ::1
  if (zeroTo(5) && groups[5] === 0xffff) return isPrivateV4(embeddedV4(groups)); // IPv4-mapped
  if (zeroTo(4) && groups[4] === 0xffff && groups[5] === 0) return true; // IPv4-translated ::ffff:0:0/96
  if (zeroTo(6)) return true; // deprecated IPv4-compatible
  if (first === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((group) => group === 0)) {
    return isPrivateV4(embeddedV4(groups)); // NAT64
  }
  if (first === 0x64 && groups[1] === 0xff9b && groups[2] === 1) return true; // local-use NAT64 64:ff9b:1::/48
  if ((first & 0xfe00) === 0xfc00) return true; // unique local fc00::/7 (AWS metadata is fd00:ec2::254)
  if ((first & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((first & 0xff00) === 0xff00) return true; // multicast
  if (first === 0x2001 && groups[1] === 0x0db8) return true; // documentation
  return false;
}

/** True for any address the reader must not connect to. Anything that is not an IP address counts as private. */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPrivateV4(address);
  if (version === 6) return isPrivateV6(address);
  return true;
}

const LOCAL_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa", ".lan", ".intranet"];

/** Parses a link and refuses anything but a public http(s) URL. The URL parser turns `2130706433` into `127.0.0.1`. */
export function assertPublicUrl(link: string): URL {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new RefusedUrlError(`Refused "${link.slice(0, 200)}": not a valid URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new RefusedUrlError(`Refused ${url.protocol} link: only http and https are read.`);
  }
  if (url.username || url.password) throw new RefusedUrlError("Refused a link with a user name or password in it.");

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new RefusedUrlError(`Refused ${host}: a private address.`);
    return url;
  }
  if (host === "localhost" || !host.includes(".") || LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    throw new RefusedUrlError(`Refused ${host}: a local host name.`);
  }
  return url;
}

export interface ResolvedAddress {
  address: string;
  family: number;
}

/** `dns.lookup(hostname, { all: true }, callback)` */
export type ResolveAll = (hostname: string, callback: (error: Error | null, addresses: ResolvedAddress[]) => void) => void;

type LookupCallback = (error: Error | null, address?: string | ResolvedAddress[], family?: number) => void;

/**
 * A `lookup` for `net.connect` (undici's `connect.lookup`) that refuses a name if any address it resolves to is
 * private. Checking at connect time covers redirects and DNS answers that change between check and use.
 */
export function createGuardedLookup(resolveAll: ResolveAll) {
  return (hostname: string, options: { all?: boolean } | number | undefined, callback: LookupCallback): void => {
    resolveAll(hostname, (error, addresses) => {
      if (error) return callback(error);
      const blocked = addresses.find((entry) => isPrivateAddress(entry.address));
      if (blocked || addresses.length === 0) {
        return callback(new RefusedUrlError(`Refused ${hostname}: ${hostname} resolves to a private address.`));
      }
      if (typeof options === "object" && options?.all) return callback(null, addresses);
      callback(null, addresses[0].address, addresses[0].family);
    });
  };
}
