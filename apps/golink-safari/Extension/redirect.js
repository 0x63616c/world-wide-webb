export const golinkOrigin = "https://go.tail8c014d.ts.net";

// Match an entire, non-whitespace go/<path> search parameter. Capture the
// original URL, not a partially decoded path: DNR substitutions cannot URL-decode.
// Safari's DNR regex engine does not support alternation. Separate rules cover
// the two slash encodings; higher-priority allow rules exclude encoded ASCII
// whitespace/controls. Literal + (form-encoded space) is excluded directly.
const prefix = "^https://(www\\.)?google\\.com/search\\?([^#]*&)?q=go";
const suffix = "(&[^#]*)?(#.*)?$";
export const searchPatterns = ["/", "%2[fF]"].map(slash => `${prefix}${slash}[^&# +]+${suffix}`);

export function redirectRules(resolverURL) {
  const redirects = searchPatterns.map((regexFilter, index) => ({
    id: index + 1,
    priority: 1,
    action: {type: "redirect", redirect: {regexSubstitution: `${resolverURL}#\\0`}},
    condition: {regexFilter, isUrlFilterCaseSensitive: true, resourceTypes: ["main_frame"]},
  }));
  const allows = ["/", "%2[fF]"].flatMap(slash => ["%20", "%[01][0-9a-fA-F]", "%7[fF]"].map(byte => ({
    priority: 2,
    action: {type: "allow"},
    condition: {regexFilter: `${prefix}${slash}[^&#]*${byte}[^&#]*${suffix}`, isUrlFilterCaseSensitive: true, resourceTypes: ["main_frame"]},
  })));
  return [...redirects, ...allows.map((rule, index) => ({id: index + 3, ...rule}))];
}

function googleSearch(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !["google.com", "www.google.com"].includes(url.hostname)
        || url.port || url.username || url.password || url.pathname !== "/search") return null;
    return url;
  } catch {
    return null;
  }
}

export function resolveSearch(value) {
  const search = googleSearch(value);
  if (!search) return null;
  const entries = [...search.searchParams.keys()].filter(key => key === "q");
  if (entries.length !== 1) return null;
  const rawQuery = search.search.slice(1).split("&").find(part => part.startsWith("q="))?.slice(2);
  if (rawQuery === undefined) return null;
  let query;
  try {
    query = decodeURIComponent(rawQuery.replace(/\+/g, " "));
  } catch {
    return null;
  }
  if (!query.startsWith("go/") || query.length === 3 || /[\s\u0000-\u001f\u007f\\]/u.test(query)
      || /%(?![a-f\d]{2})/i.test(query)) return null;
  const target = new URL(`${golinkOrigin}/${query.slice(3)}`);
  // This fixed-origin check remains at the redirect sink even if parsing changes.
  if (target.origin !== golinkOrigin || target.username || target.password) return null;
  return target.href;
}

// Invalid/ambiguous inputs return to the identical search. Escape the leading g
// in q so the same DNR rule cannot intercept that fallback again. Google decodes
// it to the original query. Never accept a fallback to an arbitrary origin.
export function fallbackSearch(value) {
  const search = googleSearch(value);
  if (!search) return null;
  search.search = search.search.replace(/([?&]q=)go(?=%2f|\/)/gi, "$1%67o");
  return search.href;
}
