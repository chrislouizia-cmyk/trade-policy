export type MemberAccessState='INVITED'|'PENDING'|'ACTIVE'|'REVOKED'|'FAILED';

/** Operational access is deliberately separate from permission-profile state. */
export function memberAccessState(input:{
  employeeEnabled:boolean;
  isCanonicalOwner?:boolean;
  invitationStatus?:string|null;
  lastActiveAt?:string|null;
  hasConfirmedAuth?:boolean;
  hasSignedIn?:boolean;
  hasRecentStaffActivity?:boolean;
}):MemberAccessState{
  if(!input.employeeEnabled)return 'REVOKED';
  // The canonical Owner account predates the invitation workflow. Its enabled
  // identity is sufficient evidence; it never needs a department or manager.
  if(input.isCanonicalOwner)return 'ACTIVE';
  const invitation=String(input.invitationStatus??'').toUpperCase();
  if(['DELIVERY_FAILED','PERSISTENCE_FAILED','FAILED'].includes(invitation))return 'FAILED';
  if(['PENDING','SENT','INVITED'].includes(invitation))return 'INVITED';
  if(['ACCEPTED','COMPLETED'].includes(invitation)){
    if(input.hasConfirmedAuth||input.hasSignedIn||Boolean(input.lastActiveAt)||Boolean(input.hasRecentStaffActivity))return 'ACTIVE';
    // An accepted invitation is not itself operational access. It must have actual
    // Auth or staff activity evidence before the person is treated as enabled.
    return 'PENDING';
  }
  // A staff role or active permission bundle never proves an invitation/login completed.
  return 'PENDING';
}
