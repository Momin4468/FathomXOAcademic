import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { schema, sql, type Db } from "@business-os/db";
import {
  deriveJobPnl,
  WORK_STATES,
  type RecordScope,
  type SessionPrincipal,
  type WorkState,
} from "@business-os/shared";
import { eq } from "drizzle-orm";
import { AuditService } from "../../common/audit/audit.service.js";
import { resolveUserNames } from "../../common/user-names.js";
import { CustomFieldService } from "../custom-fields/custom-field.service.js";
import { LegService } from "./leg.service.js";
import { LineService } from "./line.service.js";
import type { AddLineDto, CreateBundleDto, CreateWorkItemDto, HandoffDto, UpdateWorkItemDto } from "./dto.js";

@Injectable()
export class WorkService {
  constructor(
    private readonly audit: AuditService,
    private readonly lines: LineService,
    private readonly legs: LegService,
    private readonly customFields: CustomFieldService,
  ) {}

  /** A job's matchable custom-field scope: client, assignment-type, course + its
   *  parent university (so a field can be scoped by client/type/uni). */
  private async workScope(
    tx: Db,
    item: { sourcePartyId?: string | null; assignmentTypeRefId?: string | null; courseRefId?: string | null },
  ): Promise<RecordScope> {
    let universityRefId: string | null = null;
    if (item.courseRefId) {
      const [c] = await tx
        .select({ parentId: schema.refEntity.parentId })
        .from(schema.refEntity)
        .where(eq(schema.refEntity.id, item.courseRefId));
      universityRefId = c?.parentId ?? null;
    }
    return {
      clientPartyId: item.sourcePartyId ?? null,
      assignmentTypeRefId: item.assignmentTypeRefId ?? null,
      courseRefId: item.courseRefId ?? null,
      universityRefId,
    };
  }

  async create(tx: Db, principal: SessionPrincipal, dto: CreateWorkItemDto, opts?: { aiCaptureId?: string; importBatchId?: string }) {
    const scope = await this.workScope(tx, dto);
    const customJson = await this.customFields.validateValues(tx, "work_item", scope, dto.customJson);
    const [item] = await tx
      .insert(schema.workItem)
      .values({
        orgId: principal.orgId,
        title: dto.title.trim(),
        customJson,
        details: dto.details ?? null,
        sourcePartyId: dto.sourcePartyId ?? null,
        clientPartyId: dto.clientPartyId ?? null,
        doerPartyId: dto.doerPartyId ?? null,
        // Owning admin (book of business, 0051). Defaults to the creating admin;
        // a party-less System SuperAdmin creates unowned rows (visible to all admins).
        ownerPartyId: dto.ownerPartyId ?? principal.partyId ?? null,
        courseRefId: dto.courseRefId ?? null,
        assignmentTypeRefId: dto.assignmentTypeRefId ?? null,
        universityRefId: dto.universityRefId ?? null,
        moduleName: dto.moduleName ?? null,
        groupKind: dto.groupKind ?? undefined, // column default 'individual'
        groupScope: dto.groupScope ?? null,
        groupNote: dto.groupNote ?? null,
        deliveryDate: dto.deliveryDate ?? null,
        submissionDate: dto.submissionDate ?? null,
        wordCount: dto.wordCount ?? null,
        projectId: dto.projectId ?? null,
        milestoneId: dto.milestoneId ?? null,
        trackable: dto.trackable ?? undefined, // column default true
        billable: dto.billable ?? undefined, // column default false
        isEstimate: dto.isEstimate ?? false,
        notes: dto.notes ?? null,
        aiCaptureId: opts?.aiCaptureId ?? null,
        importBatchId: opts?.importBatchId ?? null,
        createdBy: principal.userId,
        updatedBy: principal.userId,
      })
      .returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "work.item_created",
      entity: "work_item",
      entityId: item!.id,
      detail: { title: item!.title },
    });
    // Capture-first soft warning: surface possible duplicates on the created item
    // (never blocks). Skipped for bulk import / AI-capture to avoid a per-row scan.
    const possibleDuplicates =
      opts?.importBatchId || opts?.aiCaptureId
        ? []
        : await this.possibleDuplicates(tx, {
            id: item!.id,
            sourcePartyId: item!.sourcePartyId,
            courseRefId: item!.courseRefId,
            assignmentTypeRefId: item!.assignmentTypeRefId,
            title: item!.title,
          });
    return { ...item!, possibleDuplicates };
  }

  /**
   * "Add course / thesis / project" (handoff §3) — one PARENT + N priced parts in a
   * single entry, instead of N separate logs. Creates a `project` (the parent, its
   * kind on custom_json) then, per part, a work_item under it + a producer line
   * (writer fee) + a consumer line (client price) + the money chain
   * (client→admin→writer, mirroring a single job) so each part's margin derives
   * correctly. All in ONE transaction. The admin (caller) sits atop the chain; a
   * party-less System SuperAdmin creating a bundle just skips the legs (no party to
   * anchor the chain — it can be priced afterward like any job).
   */
  async createBundle(tx: Db, principal: SessionPrincipal, dto: CreateBundleDto) {
    const [proj] = await tx
      .insert(schema.project)
      .values({
        orgId: principal.orgId,
        title: dto.title,
        clientPartyId: dto.clientPartyId ?? null,
        customJson: { kind: dto.kind },
        createdBy: principal.userId,
      })
      .returning({ id: schema.project.id });
    const source = principal.partyId; // the creating admin anchors the leg chain
    const partIds: string[] = [];
    for (const p of dto.parts) {
      const item = await this.create(tx, principal, {
        title: p.detail,
        projectId: proj!.id,
        courseRefId: dto.courseRefId,
        clientPartyId: dto.clientPartyId,
        doerPartyId: dto.doerPartyId,
        sourcePartyId: dto.clientPartyId, // top of the chain = the client (as in a single job)
        wordCount: p.wordCount,
      } as CreateWorkItemDto);
      if (dto.doerPartyId && p.writerAmount != null) {
        await this.lines.addLine(tx, principal, item.id, {
          lineKind: "part", writerPartyId: dto.doerPartyId, fixedAmount: p.writerAmount, wordCount: p.wordCount,
        } as AddLineDto);
      }
      if (dto.clientPartyId && p.clientAmount != null) {
        await this.lines.addLine(tx, principal, item.id, {
          lineKind: "copy", consumerPartyId: dto.clientPartyId, fixedAmount: p.clientAmount, wordCount: p.wordCount,
        } as AddLineDto);
      }
      if (source && dto.clientPartyId && dto.doerPartyId && p.clientAmount != null && p.writerAmount != null) {
        await this.legs.appendLegs(tx, principal, item.id, {
          legs: [
            { seq: 1, fromPartyId: dto.clientPartyId, toPartyId: source, amount: p.clientAmount },
            { seq: 2, fromPartyId: source, toPartyId: dto.doerPartyId, amount: p.writerAmount },
          ],
        });
      }
      partIds.push(item.id);
    }
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "work.bundle_created",
      entity: "project",
      entityId: proj!.id,
      detail: { kind: dto.kind, parts: partIds.length },
    });
    return { projectId: proj!.id, kind: dto.kind, parts: partIds };
  }

  async getRaw(tx: Db, id: string) {
    const [item] = await tx.select().from(schema.workItem).where(eq(schema.workItem.id, id));
    if (!item) throw new NotFoundException("Work item not found");
    return item;
  }

  /** Next display seq for a leg on this job (append after the current max). */
  private async nextLegSeq(tx: Db, workItemId: string): Promise<number> {
    const res = await tx.execute(
      sql`select coalesce(max(seq), 0) + 1 as next from leg where work_item_id = ${workItemId}`,
    );
    return Number((res.rows[0] as { next: number | string } | undefined)?.next ?? 1);
  }

  /** Idempotently share a work_item / client party with a grantee admin (0051). */
  private async grantRoster(
    tx: Db,
    principal: SessionPrincipal,
    subjectType: "work_item" | "party",
    subjectId: string,
    granteePartyId: string,
    reason: string,
  ) {
    await tx
      .insert(schema.rosterGrant)
      .values({
        orgId: principal.orgId,
        subjectType,
        subjectId,
        partyId: granteePartyId,
        reason,
        grantedBy: principal.userId,
      })
      .onConflictDoNothing();
  }

  /**
   * Hand a job to another admin (0051 — commission model, see HandoffDto). Posts
   * the owner→receiver leg (owner keeps `ownerCutPct` of the client price) and
   * SHARES the job + its client with the receiver via roster grants, so a
   * private-by-default job becomes visible to exactly the admin taking it on. The
   * receiver then assigns their own writer (a receiver→writer leg). Each admin
   * sees only their own hop's margin (leg RLS) — the owner's real client price
   * never leaks to the receiver. Money-affecting + append-only → gated
   * work:approve at the controller.
   */
  async handoff(tx: Db, principal: SessionPrincipal, workItemId: string, dto: HandoffDto) {
    const item = await this.getRaw(tx, workItemId);
    // Require an EXPLICIT owner — never fall back to the caller (that would let any
    // work:approve caller who can load a null-owner job hand it off). Set the owning
    // admin on the job first.
    const owner = item.ownerPartyId;
    if (!owner) throw new BadRequestException("Set an owning admin on this job before handing it off");
    if (!principal.isSystemSuperadmin && principal.partyId !== owner) {
      throw new ForbiddenException("Only the owning admin may hand this job off");
    }
    if (dto.toAdminPartyId === owner) {
      throw new BadRequestException("Cannot hand a job to its own owner");
    }
    if (!item.clientPartyId) {
      throw new BadRequestException("Link the paying client before handing the job off");
    }

    // Client price = explicit, else the amount flowing INTO the owner (client→owner
    // leg — the owner is a party to it, so readable under leg RLS).
    let clientAmount = dto.clientAmount ?? null;
    if (clientAmount == null) {
      const res = await tx.execute(
        sql`select coalesce(sum(amount), 0) as amt from leg
            where work_item_id = ${workItemId} and to_party_id = ${owner}`,
      );
      clientAmount = Number((res.rows[0] as { amt: string } | undefined)?.amt ?? 0);
    }
    if (!clientAmount || clientAmount <= 0) {
      throw new BadRequestException(
        "No client price on this job yet — set it (or pass clientAmount) before handing off",
      );
    }

    const round2 = (n: number) => Math.round(n * 100) / 100;
    const handedAmount = round2(clientAmount * (1 - dto.ownerCutPct / 100));

    // Post the owner→receiver hop (append-only).
    const seq = await this.nextLegSeq(tx, workItemId);
    await this.legs.appendLegs(tx, principal, workItemId, {
      legs: [
        {
          seq,
          fromPartyId: owner,
          toPartyId: dto.toAdminPartyId,
          amount: handedAmount,
          note: dto.note ?? `Handoff — owner keeps ${dto.ownerCutPct}% of the client price`,
        },
      ],
    });

    await this.grantRoster(tx, principal, "work_item", workItemId, dto.toAdminPartyId, "handoff");
    await this.grantRoster(tx, principal, "party", item.clientPartyId, dto.toAdminPartyId, "handoff");

    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "work.handed_off",
      entity: "work_item",
      entityId: workItemId,
      // NB: do NOT record the owner's private clientAmount here — audit_log is
      // org-wide readable; handedAmount (the receiver's own inflow leg) is safe.
      detail: { toAdminPartyId: dto.toAdminPartyId, ownerCutPct: dto.ownerCutPct, handedAmount },
    });
    return { workItemId, toAdminPartyId: dto.toAdminPartyId, handedAmount, ownerKeptPct: dto.ownerCutPct };
  }

  /**
   * Possible duplicate/overlap work items (P1 item 10) — a capture-first, NEVER
   * blocking heuristic reusing pg_trgm `similarity()` (0004). Requires the strong
   * pair (same source party + same course) to even consider a match, then either
   * the same assignment type OR a similar title. RLS scopes to the caller's org.
   * Returns [] when there isn't enough signal (no source/course) — never fabricates.
   */
  async possibleDuplicates(
    tx: Db,
    candidate: { id?: string; sourcePartyId: string | null; courseRefId: string | null; assignmentTypeRefId: string | null; title: string },
  ): Promise<Array<{ id: string; title: string; workState: string; createdAt: string; titleSim: number }>> {
    if (!candidate.sourcePartyId || !candidate.courseRefId) return [];
    const res = await tx.execute(sql`
      select w.id, w.title, w.work_state as "workState", w.created_at as "createdAt",
             round(similarity(w.title, ${candidate.title})::numeric, 3) as "titleSim"
      from work_item w
      where w.org_id = app_current_org()
        and w.archived_at is null
        and (${candidate.id ?? null}::uuid is null or w.id <> ${candidate.id ?? null})
        and w.source_party_id = ${candidate.sourcePartyId}
        and w.course_ref_id = ${candidate.courseRefId}
        and (
          (${candidate.assignmentTypeRefId ?? null}::uuid is not null
             and w.assignment_type_ref_id = ${candidate.assignmentTypeRefId ?? null})
          or similarity(w.title, ${candidate.title}) > 0.3
        )
      order by "titleSim" desc, w.created_at desc
      limit 5
    `);
    return res.rows as Array<{ id: string; title: string; workState: string; createdAt: string; titleSim: number }>;
  }

  async update(tx: Db, principal: SessionPrincipal, id: string, dto: UpdateWorkItemDto) {
    const existing = await this.getRaw(tx, id);
    const patch: Record<string, unknown> = { updatedBy: principal.userId, updatedAt: new Date() };
    if (dto.customJson !== undefined) {
      // Validate against the EFFECTIVE scope (dto overrides, else existing).
      const scope = await this.workScope(tx, {
        sourcePartyId: dto.sourcePartyId ?? existing.sourcePartyId,
        assignmentTypeRefId: dto.assignmentTypeRefId ?? existing.assignmentTypeRefId,
        courseRefId: dto.courseRefId ?? existing.courseRefId,
      });
      // Validate only the INCOMING keys, then MERGE into the stored map so a
      // partial edit never wipes other captured values (and stale values for a
      // since-archived field aren't re-validated).
      const validated = await this.customFields.validateValues(tx, "work_item", scope, dto.customJson);
      patch.customJson = { ...((existing.customJson as Record<string, unknown>) ?? {}), ...validated };
    }
    for (const k of [
      "title",
      "details",
      "sourcePartyId",
      "clientPartyId",
      "doerPartyId",
      "courseRefId",
      "assignmentTypeRefId",
      "universityRefId",
      "moduleName",
      "groupKind",
      "groupScope",
      "groupNote",
      "deliveryDate",
      "submissionDate",
      "wordCount",
      "projectId",
      "milestoneId",
      "trackable",
      "billable",
      "notes",
    ] as const) {
      if (dto[k] !== undefined) patch[k] = dto[k];
    }
    const [item] = await tx
      .update(schema.workItem)
      .set(patch)
      .where(eq(schema.workItem.id, id))
      .returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "work.item_updated",
      entity: "work_item",
      entityId: id,
      detail: { fields: Object.keys(patch).filter((k) => !["updatedBy", "updatedAt"].includes(k)) },
    });
    return item!;
  }

  /**
   * Soft-delete a job (handoff's "delete" row action). NEVER a hard delete — the
   * job is referenced by the money ledger (legs/invoices); archiving just hides it
   * from the board (`archived_at` filters it out). The legs stay intact.
   */
  async archive(tx: Db, principal: SessionPrincipal, id: string) {
    const [item] = await tx
      .update(schema.workItem)
      .set({ archivedAt: new Date(), updatedBy: principal.userId, updatedAt: new Date() })
      .where(eq(schema.workItem.id, id))
      .returning({ id: schema.workItem.id });
    if (!item) throw new NotFoundException("Work item not found");
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "work.item_archived",
      entity: "work_item",
      entityId: id,
    });
    return { ok: true, id: item.id };
  }

  /**
   * Work-state machine: draft→pending→confirmed→delivered (adjacent, forward
   * only). →confirmed is the governance step (claim becomes fact) and needs
   * work:approve; it stamps confirmed_by/at. Independent of money-state.
   */
  async transition(
    tx: Db,
    principal: SessionPrincipal,
    id: string,
    toState: WorkState,
    canApprove: boolean,
  ) {
    const item = await this.getRaw(tx, id);
    const order = WORK_STATES as readonly string[];
    const curIdx = order.indexOf(item.workState);
    const toIdx = order.indexOf(toState);
    if (toIdx !== curIdx + 1) {
      throw new BadRequestException(`Invalid transition ${item.workState} → ${toState}`);
    }
    if (toState === "confirmed" && !canApprove) {
      throw new ForbiddenException("Confirming a work item requires work:approve");
    }
    // Hard gate: required custom fields must be complete to advance the close.
    if (toState === "confirmed" || toState === "delivered") {
      const scope = await this.workScope(tx, item);
      await this.customFields.assertRequiredComplete(
        tx,
        "work_item",
        scope,
        item.customJson as Record<string, unknown> | null,
      );
    }
    const patch: Record<string, unknown> = {
      workState: toState,
      updatedBy: principal.userId,
      updatedAt: new Date(),
    };
    if (toState === "confirmed") {
      patch.confirmedBy = principal.userId;
      patch.confirmedAt = new Date();
    }
    const [updated] = await tx
      .update(schema.workItem)
      .set(patch)
      .where(eq(schema.workItem.id, id))
      .returning();
    await this.audit.record(tx, principal.orgId, {
      actorUserId: principal.userId,
      action: "work.state_changed",
      entity: "work_item",
      entityId: id,
      detail: { from: item.workState, to: toState },
    });
    return updated!;
  }

  /**
   * Capture-first list. Spec fields (title/state/doer name/course code) go to
   * every viewer; the money-gated per-job economics (client amount, writer cost,
   * **margin**) are added ONLY when `canSeeMoney` — so the client-360 and the Work
   * board can answer "what's the margin on this work" inline, while a writer's
   * list never carries a client price. Margin = revenue − writer_cost from the
   * `job_pnl` definer (derived, never stored). The primary consumer line's
   * word_count + client_rate are surfaced for the spreadsheet-style "words @ rate".
   */
  async list(
    tx: Db,
    filters: { doerPartyId?: string; sourcePartyId?: string; clientPartyId?: string; workState?: WorkState; includeArchived?: boolean },
    canSeeMoney = false,
    isSuperadmin = false,
  ) {
    const conds = [sql`true`];
    if (!filters.includeArchived) conds.push(sql`w.archived_at is null`);
    if (filters.doerPartyId) conds.push(sql`w.doer_party_id = ${filters.doerPartyId}`);
    if (filters.sourcePartyId) conds.push(sql`w.source_party_id = ${filters.sourcePartyId}`);
    if (filters.clientPartyId) conds.push(sql`w.client_party_id = ${filters.clientPartyId}`);
    if (filters.workState) conds.push(sql`w.work_state = ${filters.workState}`);
    const where = sql.join(conds, sql` and `);
    // Money is derived from the caller's RLS-VISIBLE legs, so partner opacity holds:
    // you see the real economics on YOUR OWN jobs (you're on both the client and the
    // writer leg), but on a job another partner merely SHARED with you, you see only
    // your own hop — their real client price stays hidden by leg-RLS. A definer would
    // bypass RLS and leak a peer's real margin, so it is deliberately NOT used. System
    // SuperAdmin (party-less, sees every leg) reads the full inflow − outflow.
    // clientRate is a client price → gated with the amounts; word_count stays ungated.
    // `myin`/`myout` = the amounts flowing INTO / OUT OF the caller across their
    // RLS-visible legs only. They can never include a leg the caller isn't on, so
    // they are inherently opacity-safe: on a shared job you see only YOUR hop, never
    // a peer's real client price (§4.4). This is also what makes the OWNER's private
    // margin work — Momin's own client→him leg (real price) and him→pool leg
    // (declared) are both his, so his myin/myout reflect the real economics, while a
    // downstream partner's reflect only the pool figure. `mynet` = myin − myout is
    // exposed to every viewer as `myFee` (a writer's own fee; opacity-safe, ungated).
    const myFeeJoin = sql`left join lateral (
      select coalesce(sum(amount) filter (where to_party_id = app_current_party()), 0) as myin,
             coalesce(sum(amount) filter (where from_party_id = app_current_party()), 0) as myout
      from leg where work_item_id = w.id
    ) mf on true`;
    // A party sees THEIR OWN inbound/outbound/net (correct at any chain depth); a
    // party-less System SuperAdmin sees the whole chain (source→...→doer).
    const clientAmountExpr = isSuperadmin ? sql`lg.inflow` : sql`mf.myin`;
    const writerAmountExpr = isSuperadmin ? sql`lg.outflow` : sql`mf.myout`;
    const marginExpr = isSuperadmin ? sql`lg.inflow - lg.outflow` : sql`mf.myin - mf.myout`;
    const moneyCols = canSeeMoney
      ? sql`, cl.client_rate as "clientRate", pl.writer_rate as "writerRate",
             round(${clientAmountExpr}, 2) as "clientAmount",
             round(${writerAmountExpr}, 2) as "writerAmount",
             round(${marginExpr}, 2) as "margin"`
      : sql``;
    const moneyJoin = canSeeMoney
      ? sql`left join lateral (
          select
            coalesce(sum(amount) filter (where from_party_id = w.source_party_id), 0) as inflow,
            coalesce(sum(amount) filter (where to_party_id = w.doer_party_id), 0) as outflow
          from leg where work_item_id = w.id
        ) lg on true`
      : sql``;
    const res = await tx.execute(sql`
      select w.id, w.title, w.work_state as "workState", w.money_state as "moneyState",
             w.doer_party_id as "doerPartyId", w.source_party_id as "sourcePartyId",
             w.client_party_id as "clientPartyId", w.course_ref_id as "courseRefId",
             w.project_id as "projectId", pr.title as "projectTitle",
             w.updated_at as "updatedAt",
             dp.display_name as "doerName",
             ce.canonical as "courseCode",
             cl.word_count as "wordCount", cl.unit_label as "unitLabel",
             cl.consumer_line_id as "consumerLineId", pl.producer_line_id as "producerLineId",
             round(mf.myin - mf.myout, 2) as "myFee"
             ${moneyCols}
      from work_item w
      left join party dp on dp.id = w.doer_party_id
      left join ref_entity ce on ce.id = w.course_ref_id
      left join project pr on pr.id = w.project_id
      left join lateral (
        select id as consumer_line_id, word_count, unit_label, client_rate from work_line
        where work_item_id = w.id and consumer_party_id is not null limit 1
      ) cl on true
      left join lateral (
        select id as producer_line_id, writer_rate from work_line
        where work_item_id = w.id and writer_party_id is not null limit 1
      ) pl on true
      ${myFeeJoin}
      ${moneyJoin}
      where ${where}
      order by w.updated_at desc
      limit 100
    `);
    return res.rows;
  }

  /**
   * The job-detail hub read model. Lines carry money only if canSeeMoney; legs
   * are RLS-filtered to the viewer (the DB guarantee); margins are derived from
   * exactly those visible legs — never stored, never leaked.
   */
  async getDetail(tx: Db, id: string, canSeeMoney: boolean) {
    const item = await this.getRaw(tx, id);
    const lineRows = await this.lines.getLines(tx, id);
    const legs = await this.legs.getVisibleLegs(tx, id);
    // Job-level P&L / loss (derived, never stored) — money-gated so a non-money
    // caller never sees the figures. Surfaces a fail/resit net loss truthfully.
    let pnl: ReturnType<typeof deriveJobPnl> | null = null;
    if (canSeeMoney) {
      const r = await tx.execute(
        sql`select revenue, writer_cost as "writerCost", clawback from job_pnl(${id})`,
      );
      const row = (r.rows[0] ?? {}) as { revenue?: string; writerCost?: string; clawback?: string };
      const [oc] = await tx
        .select({ reworkCost: schema.workOutcome.reworkCost })
        .from(schema.workOutcome)
        .where(eq(schema.workOutcome.workItemId, id));
      pnl = deriveJobPnl({
        revenue: Number(row.revenue ?? 0),
        writerCost: Number(row.writerCost ?? 0),
        clawback: Number(row.clawback ?? 0),
        reworkCost: Number(oc?.reworkCost ?? 0),
      });
    }
    const scope = await this.workScope(tx, item);
    const customFields = await this.customFields.describeForRecord(
      tx,
      "work_item",
      scope,
      item.customJson as Record<string, unknown> | null,
    );
    const { lines, hasNegativeMarginLine } = this.lines.mapLines(lineRows, canSeeMoney);
    // Job status = a DERIVED rollup of the lines' per-line statuses (never stored).
    const jobStatus = this.lines.jobStatusRollup(lineRows);
    // R5 audit trail — resolve the actor names (org-scoped) for created/updated/confirmed.
    const names = await resolveUserNames(tx, item.orgId, [item.createdBy, item.updatedBy, item.confirmedBy]);
    const withActors = {
      ...item,
      createdByName: item.createdBy ? names.get(item.createdBy) ?? null : null,
      updatedByName: item.updatedBy ? names.get(item.updatedBy) ?? null : null,
      confirmedByName: item.confirmedBy ? names.get(item.confirmedBy) ?? null : null,
    };
    return {
      item: withActors,
      lines,
      jobStatus,
      hasNegativeMarginLine,
      legs,
      margins: this.legs.marginsFor(legs),
      pnl,
      customFields,
    };
  }
}
