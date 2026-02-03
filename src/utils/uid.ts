import { createHash } from "crypto";

export type IssueUidInput = {
  issueID: string;
  session: number | string;
  nameOfHouse: string;
};

export function canonicalizeHouse(nameOfHouse: string): string {
  const normalized = (nameOfHouse ?? "").trim();
  if (!normalized) return "unknown";
  if (normalized.includes("両院")) return "joint";
  if (normalized.includes("衆")) return "shugi";
  if (normalized.includes("参")) return "sangi";
  return normalized.toLowerCase().replace(/\s+/g, "");
}

export function buildIssueUid(input: IssueUidInput): string {
  const issueID = (input.issueID ?? "").trim();
  const session = String(input.session ?? "").trim();
  const house = canonicalizeHouse(input.nameOfHouse ?? "");
  const raw = `session=${session}|house=${house}|issueID=${issueID}`;
  return createHash("sha256").update(raw).digest("hex");
}
