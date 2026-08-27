export const PROJECT_A = 101;
export const PROJECT_B = 202;

export const activistA = {
  userId: '00000000-0000-4000-8000-000000000001',
  role: 'activist',
  projectId: PROJECT_A,
  aal: 1,
};
export const activistB = {
  userId: '00000000-0000-4000-8000-000000000002',
  role: 'activist',
  projectId: PROJECT_A,
  aal: 1,
};
export const activistProjectB = {
  userId: '00000000-0000-4000-8000-000000000003',
  role: 'activist',
  projectId: PROJECT_B,
  aal: 1,
};
export const coordA = {
  userId: '00000000-0000-4000-8000-000000000004',
  role: 'coord',
  projectId: PROJECT_A,
  aal: 1,
};
export const headA = {
  userId: '00000000-0000-4000-8000-000000000005',
  role: 'head',
  projectId: PROJECT_A,
  aal: 2,
};
export const headAal1 = { ...headA, aal: 1 };
export const financeA = {
  userId: '00000000-0000-4000-8000-000000000006',
  role: 'finance',
  projectId: PROJECT_A,
  aal: 1,
};
export const ceo = {
  userId: '00000000-0000-4000-8000-000000000007',
  role: 'ceo',
  projectId: null,
  aal: 2,
};

export const contactA = {
  id: '10000000-0000-4000-8000-000000000001',
  projectId: PROJECT_A,
  assignedUserId: activistA.userId,
};
export const contactOwnedByActivistB = {
  id: '10000000-0000-4000-8000-000000000002',
  projectId: PROJECT_A,
  assignedUserId: activistB.userId,
};
export const contactProjectB = {
  id: '10000000-0000-4000-8000-000000000003',
  projectId: PROJECT_B,
  assignedUserId: activistProjectB.userId,
};
export const tourProjectB = {
  id: '20000000-0000-4000-8000-000000000001',
  projectId: PROJECT_B,
  assignedUserIds: [activistProjectB.userId],
};
export const membershipA = {
  projectId: PROJECT_A,
  userId: activistA.userId,
  role: 'activist',
};
export const projectA = { id: PROJECT_A };

export function makeContext(actor) {
  return {
    userId: actor.userId,
    globalRole: actor.role === 'ceo' ? 'ceo' : null,
    memberships: actor.projectId
      ? [{ projectId: actor.projectId, role: actor.role, status: 'active' }]
      : [],
    aal: actor.aal,
  };
}
