// Lightweight mirrors of the API responses the UI consumes. Money fields are
// optional on purpose: the API redacts them, so "absent" is the normal case and
// the UI must treat their absence as "not visible to me".

export interface Principal {
  userId: string;
  orgId: string;
  partyId: string | null;
  isSystemSuperadmin: boolean;
}

export interface WhoAmI {
  principal: Principal;
  party: { id: string; displayName: string } | null;
  roleNames: string[];
  permissions: string[]; // "module:action"
}

export interface WorkListRow {
  id: string;
  title: string;
  workState: string;
  moneyState: string;
  doerPartyId: string | null;
  sourcePartyId: string | null;
  updatedAt: string;
}

export interface WorkItem {
  id: string;
  title: string;
  details: string | null;
  workState: string;
  moneyState: string;
  sourcePartyId: string | null;
  doerPartyId: string | null;
  courseRefId: string | null;
  assignmentTypeRefId: string | null;
  isEstimate: boolean;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  confirmedBy: string | null;
  confirmedAt: string | null;
}

export interface WorkLine {
  id: string;
  lineKind: string;
  side: "consumer" | "producer" | "unassigned";
  writerPartyId: string | null;
  consumerPartyId?: string | null; // present only if money-visible
  wordCount: number | null;
  unitCount: number | null;
  sourceLineId: string | null;
  note: string | null;
  clientRate?: string | null; // money — present only if visible
  writerRate?: string | null;
  fixedAmount?: string | null;
  amount?: number; // computed — present only if visible
}

export interface Leg {
  id: string;
  seq: number;
  fromPartyId: string | null;
  toPartyId: string | null;
  amount: string;
  workLineId: string | null;
}

export interface MarginNode {
  partyId: string;
  inbound: number;
  outbound: number;
  margin: number;
}

export interface WorkDetail {
  item: WorkItem;
  lines: WorkLine[];
  legs: Leg[];
  margins: MarginNode[];
}

export interface RefEntity {
  id: string;
  kind: string;
  canonical: string;
  status: string;
  parentId?: string | null;
}

export interface PartyRow {
  id: string;
  displayName: string;
  partyType: string[];
  externalRef: string | null;
  universityId: string | null;
  programme: string | null;
}

export const can = (perms: string[] | undefined, key: string) => !!perms?.includes(key);
