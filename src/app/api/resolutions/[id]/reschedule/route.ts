import { createClient } from '@supabase/supabase-js';
import { getSupabaseConfig } from '@/lib/env';
import { getRepository } from '@/lib/repo/repository';
import { detectConflicts } from '@/lib/core/conflict';
import { ok, fail, handleError } from '@/lib/api';
import type { PlanStep } from '@/lib/types';

// The production demo is protected by the shared-access middleware.
// The browser never receives a database secret.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { stepId } = await request.json().catch(() => ({}));
    if (typeof stepId !== 'string' || stepId.length > 128) {
      return fail('Choose a valid action to reschedule.', 400);
    }

    const repo = await getRepository();
    const current = await repo.getResolution(id);
    if (!current) return fail('Resolution not found.', 404);
    if (current.status !== 'draft') return fail('Only draft plans can be rescheduled.', 409);

    const step = current.plan.find((s) => s.id === stepId);
    if (!step?.blocked || !step.alternative) {
      return fail('This action has no suggested free slot.', 409);
    }
    const slot = step.alternative;
    const conflicts = detectConflicts([{
      id: step.id, label: step.label,
      dayOfWeek: slot.dayOfWeek as 0 | 1 | 2 | 3 | 4 | 5 | 6,
      startMinute: slot.startMinute, endMinute: slot.endMinute,
    }], await repo.listCommitments());
    if (conflicts.length) return fail('That slot now clashes with your commitments. Refresh and try again.', 409);

    const plan: PlanStep[] = current.plan.map((s) => s.id === stepId
      ? { ...s, ...slot, blocked: false, conflictIds: [], alternative: undefined }
      : s);
    const remainingConflicts = current.conflicts.filter((c) => c.actionId !== stepId);

    const config = getSupabaseConfig();
    if (!config) return fail('Persistent storage must be configured.', 503);
    const db = createClient(config.url, config.serviceRoleKey, {
      auth: { persistSession: false },
    });

    // No financial amounts or approval hashes are changed by a scheduling edit.
    const { data, error } = await db.from('resolutions')
      .update({ plan, conflicts: remainingConflicts })
      .eq('id', id).eq('status', 'draft')
      .select('id').maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return fail('The proposal changed while rescheduling. Refresh the page.', 409);

    await repo.appendAudit({
      caseId: current.caseId,
      resolutionId: id,
      actor: 'founder',
      action: 'resolution.action_rescheduled',
      payload: { stepId, previous: { dayOfWeek: step.dayOfWeek, startMinute: step.startMinute, endMinute: step.endMinute }, chosen: slot },
    });
    return ok({ resolution: await repo.getResolution(id) });
  } catch (error) {
    return handleError(error);
  }
}
