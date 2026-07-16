import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

const InviteSchema = z.object({
  email: z.string().trim().email(),
  displayName: z.string().trim().min(2).max(120),
  role: z.enum(['HEAD_OF_SALES','COMPLIANCE_OFFICER','SUPPORT','TECHNICIAN','SECURITY_ADMIN']),
  title: z.string().trim().max(120).optional().default(''),
});

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });

    const [{ data: role }, { data: allowed }] = await Promise.all([
      supabase.rpc('current_staff_role'),
      supabase.rpc('has_staff_permission', { p_permission: 'staff.manage' }),
    ]);
    if (role !== 'OWNER' || !allowed) {
      return NextResponse.json({ error: 'Only the Owner can invite staff.' }, { status: 403 });
    }

    const parsed = InviteSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid invitation.' }, { status: 400 });
    }

    const { email, displayName, role: staffRole, title } = parsed.data;
    const admin = createAdminClient();
    const origin = new URL(request.url).origin;
    const { data: invite, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${origin}/auth/callback?next=/hq`,
      data: { account_type: 'staff', display_name: displayName },
    });
    if (inviteError || !invite.user) {
      const message = inviteError?.message ?? 'Invitation could not be created.';
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const { data: organizationId, error: orgError } = await supabase.rpc('ensure_internal_organization');
    if (orgError) return NextResponse.json({ error: orgError.message }, { status: 400 });

    const { error: staffError } = await admin.from('staff_roles').upsert({
      user_id: invite.user.id,
      role: staffRole,
      is_active: true,
      organization_id: organizationId,
      display_title: title || staffRole.replaceAll('_', ' '),
      invited_by: user.id,
      mfa_required: true,
    }, { onConflict: 'user_id' });
    if (staffError) return NextResponse.json({ error: staffError.message }, { status: 400 });

    const { error: memberError } = await admin.from('organization_members').upsert({
      organization_id: organizationId,
      user_id: invite.user.id,
      membership_type: 'STAFF',
      status: 'INVITED',
    }, { onConflict: 'organization_id,user_id' });
    if (memberError) return NextResponse.json({ error: memberError.message }, { status: 400 });

    await admin.from('staff_invitations').upsert({
      user_id: invite.user.id,
      email,
      display_name: displayName,
      role: staffRole,
      display_title: title || null,
      organization_id: organizationId,
      invited_by: user.id,
      status: 'INVITED',
      invited_at: new Date().toISOString(),
    }, { onConflict: 'email' });

    return NextResponse.json({ ok: true, message: `Invitation sent to ${email}.` });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unexpected invitation error.' }, { status: 500 });
  }
}
