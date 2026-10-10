---
name: shift-scheduling-swaps
description: Procedures for drafting and publishing shifts, enforcing intra-clinic overlap rules, processing the swap request state machine with row-locked approvals, and executing optimistic UI updates with rollback.
---

# Skill: Shift Scheduling, Clashing, and Swaps

Use this skill when developing shift calendar endpoints, shift creation/editing, overlap detection, swap request flows, manager approvals, or optimistic mobile client interactions.

## 1. Shift Scheduling and Calendar Queries (PRD 6.3, 10)

### Calendar Query (`GET /v1/teams/:teamId/shifts?weekStart=YYYY-MM-DD`)
1. Convert `weekStart` to an ISO week start date in the clinic's time zone (using Luxon).
2. Compute `weekEnd = weekStart + 7 days`.
3. Filter by role:
   - Staff: return shifts where `status === "PUBLISHED"`.
   - Manager / Owner: return all shifts (`DRAFT` and `PUBLISHED`).
4. Shifts that cross midnight must be displayed on both days in the client calendar, flagged with a `continues` indicator on the following day.

### Shift Duration and Overlap Constraints (PRD 6.3, 10)
- Maximum shift duration is strictly 24 hours (`endsAt - startsAt <= 24 hours`).
- Intra-clinic overlap check:
  - When creating or editing a shift, query existing shifts for the same `assigneeId` within that clinic.
  - Two shifts overlap if `newStartsAt < existingEndsAt && newEndsAt > existingStartsAt`.
  - Reject overlapping shifts with 409 `SHIFT_OVERLAP`.
- Composite Foreign Key:
  - `shifts (team_id, assignee_id)` references `memberships (team_id, user_id)` with `onDelete: Restrict`. A shift cannot be assigned to someone who is not a member of that clinic.

### Cross-Clinic Clash Detection (PRD 2, 6.3)
- Never compare shifts across different clinics on the server. Doing so violates tenant privacy and cross-shard isolation.
- Cross-clinic clash detection runs exclusively on the mobile device within the `My shifts` screen (`["me", "shifts", "upcoming"]`), which combines the user's upcoming shifts across all clinics and displays a "Clashes with your shift at <clinic>" warning.

---

## 2. Shift Swap State Machine (PRD 6.4)

### Lifecycle Transitions
```
              ┌───────────┐
              │ REQUESTED │
              └─────┬─────┘
                    │
         ┌──────────┴──────────┐
         ▼                     ▼
   ┌───────────┐         ┌───────────┐
   │ ACCEPTED  │         │ DECLINED  │
   └─────┬─────┘         └───────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌──────────┐ ┌──────────┐
│ APPROVED │ │ REJECTED │
└──────────┘ └──────────┘
```
- Open Swaps: A swap is considered "open" if its state is `REQUESTED` or `ACCEPTED`.
- Invariant: A shift can belong to at most one open swap at any time. Attempting another swap returns 409 `SWAP_OPEN_EXISTS`.
- Cancellation: The requester can cancel an open swap at any time prior to approval (`CANCELLED`).
- Auto-Cancellation: When a member is removed from the team, all open swaps involving them transition to `CANCELLED`.
- Shift Edits: If a Manager edits either shift while a swap is open, the swap transitions to `EXPIRED` with reason `SHIFT_CHANGED`.

---

## 3. Atomic Swap Approval Transaction (PRD 6.4, 10)

Approving a swap (`POST /v1/teams/:teamId/swaps/:swapId/approve`) must swap assignees atomically using row locks:

```typescript
await prisma.$transaction(async (tx) => {
  // 1. Lock swap request row
  const swap = await tx.swapRequest.findUniqueOrThrow({
    where: { id: swapId, teamId },
  });
  if (swap.status !== 'ACCEPTED') {
    throw new ConflictError('SWAP_STATE_CHANGED');
  }

  // 2. Lock both shifts with SELECT FOR UPDATE
  const [shiftA] = await tx.$queryRaw<Shift[]>`
    SELECT * FROM shifts WHERE id = ${swap.requesterShiftId} AND team_id = ${teamId} FOR UPDATE
  `;
  const [shiftB] = await tx.$queryRaw<Shift[]>`
    SELECT * FROM shifts WHERE id = ${swap.targetShiftId} AND team_id = ${teamId} FOR UPDATE
  `;

  // 3. Re-verify overlap for both users with their new shift times
  const overlapA = await checkOverlap(tx, teamId, shiftB.assigneeId, shiftA.startsAt, shiftA.endsAt, [shiftA.id, shiftB.id]);
  const overlapB = await checkOverlap(tx, teamId, shiftA.assigneeId, shiftB.startsAt, shiftB.endsAt, [shiftA.id, shiftB.id]);
  if (overlapA || overlapB) {
    throw new ConflictError('SHIFT_OVERLAP');
  }

  // 4. Swap assignees atomically
  await tx.shift.update({
    where: { id: shiftA.id },
    data: { assigneeId: shiftB.assigneeId },
  });
  await tx.shift.update({
    where: { id: shiftB.id },
    data: { assigneeId: shiftA.assigneeId },
  });

  // 5. Update swap status
  await tx.swapRequest.update({
    where: { id: swapId },
    data: { status: 'APPROVED' },
  });

  // 6. Write activity row
  await tx.activity.create({
    data: {
      teamId,
      type: 'swap.approved',
      actorId: approvingUserId,
      refId: swapId,
    },
  });

  // 7. Commit outbox notification event
  await tx.outboxEvent.create({
    data: {
      teamId,
      kind: 'notify',
      payload: {
        userIds: [shiftA.assigneeId, shiftB.assigneeId],
        type: 'swap.decided',
        refId: swapId,
        teamId,
        urgent: startsWithin12Hours(shiftA.startsAt) || startsWithin12Hours(shiftB.startsAt),
      },
    },
  });
});
```

---

## 4. Mobile Client Optimistic Updates with Rollback (PRD 14)

Implement optimistic mutations in TanStack Query for swap requests and settings updates:

```typescript
const requestSwapMutation = useMutation({
  mutationFn: (data: { requesterShiftId: string; targetShiftId: string }) =>
    apiClient.post(`/v1/teams/${teamId}/swaps`, data, {
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    }),
  onMutate: async (newSwap) => {
    // 1. Cancel outgoing queries
    await queryClient.cancelQueries({ queryKey: ['team', teamId, 'swaps'] });

    // 2. Snapshot current state for rollback
    const previousSwaps = queryClient.getQueryData(['team', teamId, 'swaps']);

    // 3. Optimistically insert placeholder swap
    queryClient.setQueryData(['team', teamId, 'swaps'], (old: any) => [
      ...(old || []),
      { id: 'temp-id', status: 'REQUESTED', ...newSwap },
    ]);

    return { previousSwaps };
  },
  onError: (err, newSwap, context) => {
    // 4. Rollback on failure
    if (context?.previousSwaps) {
      queryClient.setQueryData(['team', teamId, 'swaps'], context.previousSwaps);
    }
    toast.show('Failed to submit swap request', { type: 'error' });
  },
  onSettled: () => {
    // 5. Invalidate server state
    queryClient.invalidateQueries({ queryKey: ['team', teamId, 'swaps'] });
  },
});
```
*Note: Always disable the trigger button from initial tap until settle to prevent repeated duplicate submits.*
