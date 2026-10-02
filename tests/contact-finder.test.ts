import { afterAll, describe, expect, it } from "vitest";
import { contactLine, contactLinks, decodeCfEmail, emailKind, emailsIn, findContacts, phonesIn, setPageFetch } from "@/lib/contact-finder";

// Cloudflare style: first byte is the key, every byte after is xored with it.
function cfEncode(email: string, key = 0x2a): string {
  let out = key.toString(16).padStart(2, "0");
  for (const ch of email) out += (ch.charCodeAt(0) ^ key).toString(16).padStart(2, "0");
  return out;
}

afterAll(() => setPageFetch(null));

describe("The contact finder (D079)", () => {
  it("reads mailto links, protected addresses, plain text and spelled out ones, and drops junk", () => {
    const html = `
      <a href="mailto:Farah.Haddad@gulfcrescent.example?subject=hi">Email Farah</a>
      <a href="/cdn-cgi/l/email-protection" data-cfemail="${cfEncode("accounts@gulfcrescent.example")}">[email protected]</a>
      <p>Reach us at info@gulfcrescent.example or sales [at] gulfcrescent [dot] example</p>
      <img src="logo@2x.png"> <span>noreply@gulfcrescent.example</span> <script>var x = "tracker@sentry.io";</script>`;
    const found = emailsIn(html, "https://gulfcrescent.example/contact");
    expect(found.map((f) => f.email)).toEqual(["farah.haddad@gulfcrescent.example", "accounts@gulfcrescent.example", "info@gulfcrescent.example", "sales@gulfcrescent.example"]);
    expect(found[0]!.kind).toBe("personal");
    expect(found[1]!.kind).toBe("generic");
    expect(emailKind("hello@x.example")).toBe("generic");
    expect(emailKind("omar.nair@x.example")).toBe("personal");
    expect(decodeCfEmail("zz")).toBeNull();
    expect(decodeCfEmail(cfEncode("a@b.co", 0x7f))).toBe("a@b.co");
    expect(phonesIn('<a href="tel:+971 4 555 1234">call</a> <p>Office: 04-555 9876</p>')).toEqual(["+97145551234", "045559876"]);
  });

  it("finds the contact and about pages on the home page, same host only", () => {
    const base = new URL("https://gulfcrescent.example/");
    const html = `<a href="/contact-us">Contact us</a> <a href="https://www.gulfcrescent.example/about">About</a> <a href="https://facebook.com/gulfcrescent">Facebook</a> <a href="/services">Services</a> <a href="/team#x">Our team</a>`;
    expect(contactLinks(html, base)).toEqual(["https://gulfcrescent.example/contact-us", "https://www.gulfcrescent.example/about", "https://gulfcrescent.example/team"]);
  });

  it("walks the site, stops at a named person and says why when nothing comes back", async () => {
    const pages: Record<string, { ok: boolean; status: number; html: string }> = {
      "https://gulfcrescent.example/": { ok: true, status: 200, html: '<a href="/contact-us">Contact</a> <a href="/about">About</a> <p>Call +971 4 555 1234</p>' },
      "https://gulfcrescent.example/contact-us": { ok: true, status: 200, html: '<p>info@gulfcrescent.example</p> <a href="mailto:farah@gulfcrescent.example">Farah Haddad, Finance Manager</a>' },
      "https://gulfcrescent.example/about": { ok: true, status: 200, html: "<p>About us</p>" },
    };
    const asked: string[] = [];
    setPageFetch(async (url) => {
      asked.push(url);
      return pages[url] ?? { ok: false, status: 404, html: "" };
    });
    const f = await findContacts("gulfcrescent.example");
    expect(f.website).toBe("https://gulfcrescent.example");
    expect(f.emails.map((e) => e.email)).toEqual(["farah@gulfcrescent.example", "info@gulfcrescent.example"]);
    expect(f.phones).toEqual(["+97145551234"]);
    expect(f.pagesRead).toEqual(["https://gulfcrescent.example/", "https://gulfcrescent.example/contact-us"]);
    expect(asked).toHaveLength(2); // stopped at the named person
    expect(contactLine(f)).toContain("named farah@gulfcrescent.example");
    expect(contactLine(f)).toContain("shared info@gulfcrescent.example");

    setPageFetch(async () => ({ ok: false, status: 403, html: "" }));
    const blocked = await findContacts("https://blocked.example");
    expect(blocked.emails).toEqual([]);
    expect(blocked.note).toContain("refused");
    expect(blocked.pagesRead).toEqual([]);

    setPageFetch(async () => ({ ok: true, status: 200, html: "<p>nothing here</p>" }));
    const empty = await findContacts("https://quiet.example");
    expect(empty.emails).toEqual([]);
    expect(empty.note).toMatch(/no address on \d+ pages? read/);
    expect(empty.pagesRead.length).toBeGreaterThanOrEqual(2);
    expect(empty.pagesRead.length).toBeLessThanOrEqual(5);

    expect((await findContacts(null)).note).toBe("no website to read");
    expect(contactLine(await findContacts("")).startsWith("Addresses on their site: none")).toBe(true);
  });
});
