export type MemberAccessState='INVITED'|'PENDING'|'ACTIVE'|'REVOKED'|'FAILED';

/** Operational access is deliberately separate from permission-profile state. */
export function memberAccessState(input:{employeeEnabled:boolean;invitationStatus?:string|null;lastActiveAt?:string|null}):MemberAccessState{
  if(!input.employeeEnabled)return 'REVOKED';
  const invitation=String(input.invitationStatus??'').toUpperCase();
  if(['DELIVERY_FAILED','PERSISTENCE_FAILED','FAILED'].includes(invitation))return 'FAILED';
  if(['PENDING','SENT','INVITED'].includes(invitation))return 'INVITED';
  if(['ACCEPTED','COMPLETED'].includes(invitation)&&input.lastActiveAt)return 'ACTIVE';
  // A staff role or active permission bundle never proves an invitation/login completed.
  return 'PENDING';
}
