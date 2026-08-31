import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  activistA, activistProjectB, coordA, headA, financeA, ceo, PROJECT_A, PROJECT_B, makeContext,
} from './fixtures.mjs';
import { SecurityError } from '../../lib/security/errors.mjs';
import {
  assertDirectoryAccess,
  changeMembershipCommand,
  changeMembership,
  createGovernanceRpc,
  projectDirectoryDto,
  profileDirectoryDto,
} from '../../lib/security/domains/governance.mjs';
import { membershipChangeSchema } from '../../lib/security/schemas.mjs';

const target = '00000000-0000-4000-8000-000000000099';
const errorCode = (expected) => (error) => error instanceof SecurityError && error.code === expected;

test('user cannot modify own role', async () => {
  await assert.rejects(() => changeMembershipCommand(makeContext(headA), {
    userId: headA.userId, projectId: PROJECT_A, role: 'coord', status: 'active',
  }), errorCode('CAPABILITY_DENIED'));
});

test('project head cannot grant head or CEO', async () => {
  for (const role of ['head', 'ceo']) {
    await assert.rejects(() => changeMembershipCommand(makeContext(headA), {
      userId: target, projectId: PROJECT_A, role, status: 'active',
    }), errorCode('CAPABILITY_DENIED'));
  }
});

test('project head cannot change another project', async () => {
  await assert.rejects(() => changeMembershipCommand(makeContext(headA), {
    userId: activistProjectB.userId, projectId: PROJECT_B, role: 'activist', status: 'active',
  }), errorCode('CAPABILITY_DENIED'));
});

test('coordinator and finance cannot mutate memberships', async () => {
  for (const actor of [coordA, financeA]) {
    await assert.rejects(() => changeMembershipCommand(makeContext(actor), {
      userId: target, projectId: PROJECT_A, role: 'activist', status: 'active',
    }), errorCode('CAPABILITY_DENIED'));
  }
});

test('body cannot forge createdBy or authority aliases', () => {
  for (const field of ['createdBy', 'created_by', 'actorUserId']) {
    assert.equal(membershipChangeSchema.safeParse({
      userId: target, projectId: PROJECT_A, role: 'activist', status: 'active', [field]: ceo.userId,
    }).success, false);
  }
});

test('suspended membership cannot read project directory', () => {
  const context = makeContext(activistA);
  context.memberships[0].status = 'suspended';
  assert.throws(() => assertDirectoryAccess(context, PROJECT_A), errorCode('CAPABILITY_DENIED'));
});

test('CEO AAL1 cannot mutate governance', async () => {
  await assert.rejects(() => changeMembershipCommand({ ...makeContext(ceo), aal: 1 }, {
    userId: target, projectId: PROJECT_A, role: 'head', status: 'active',
  }), errorCode('MFA_REQUIRED'));
});

test('duplicate membership returns conflict and does not invoke RPC', async () => {
  let calls = 0;
  await assert.rejects(() => changeMembership(makeContext(headA), {
    userId: target, projectId: PROJECT_A, role: 'activist', status: 'active',
  }, {
    findMembership: async () => ({ role: 'activist', status: 'active' }),
    rpc: async () => { calls += 1; return true; },
  }), errorCode('MEMBERSHIP_CONFLICT'));
  assert.equal(calls, 0);
});

test('last CEO removal is blocked before mutation', async () => {
  await assert.rejects(() => changeMembership(makeContext(ceo), {
    userId: ceo.userId, projectId: PROJECT_A, role: 'ceo', status: 'revoked',
  }, {
    countActiveCeos: async () => 1,
    findMembership: async () => ({ role: 'ceo', status: 'active' }),
    rpc: async () => true,
  }), errorCode('LAST_CEO_REQUIRED'));
});

test('head AAL2 can manage only activist/coordinator in own project', async () => {
  const command = await changeMembershipCommand(makeContext(headA), {
    userId: target, projectId: PROJECT_A, role: 'coord', status: 'active',
  });
  assert.deepEqual(command, {
    targetUserId: target, projectId: PROJECT_A, role: 'coord', status: 'active',
  });
});

test('CEO AAL2 may manage cross-project roles through validated command', async () => {
  const command = await changeMembershipCommand(makeContext(ceo), {
    userId: target, projectId: PROJECT_B, role: 'head', status: 'active',
  });
  assert.equal(command.projectId, PROJECT_B);
  assert.equal(command.role, 'head');
});

test('directory projection is role-specific and contains no contact PII', () => {
  const profile = {
    id: target, name: 'משתמש בדיקה', activist_code: 9999, email: 'private@example.invalid',
    phone: '0500000000', notes: 'private', global_role: null,
  };
  assert.deepEqual(profileDirectoryDto(makeContext(financeA), profile), {
    userId: target, name: 'משתמש בדיקה', activistCode: 9999,
  });
  assert.deepEqual(profileDirectoryDto(makeContext(activistA), { ...profile, id: activistA.userId }), {
    userId: activistA.userId, name: 'משתמש בדיקה', activistCode: 9999,
  });
  assert.equal(JSON.stringify(profileDirectoryDto(makeContext(headA), profile)).includes('private@'), false);
});

test('projects projection exposes only authorized project IDs', () => {
  const rows = [{ id: PROJECT_A, name: 'א' }, { id: PROJECT_B, name: 'ב' }];
  assert.deepEqual(projectDirectoryDto(makeContext(activistA), rows), [{ id: PROJECT_A, name: 'א' }]);
  assert.deepEqual(projectDirectoryDto(makeContext(ceo), rows), rows);
});

test('successful mutation delegates a derived command and requires atomic success', async () => {
  let received;
  const result = await changeMembership(makeContext(headA), {
    userId: target, projectId: PROJECT_A, role: 'activist', status: 'active',
  }, {
    findMembership: async () => null,
    rpc: async (command) => { received = command; return true; },
  });
  assert.equal(received.targetUserId, target);
  assert.deepEqual(result, { changed: true });
  await assert.rejects(() => changeMembership(makeContext(headA), {
    userId: target, projectId: PROJECT_A, role: 'activist', status: 'active',
  }, { findMembership: async () => null, rpc: async () => false }), errorCode('MUTATION_REJECTED'));
});

test('service-role governance sends the validated session actor and request UUID to the database RPC', async () => {
  const calls = [];
  const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const rpc = createGovernanceRpc({
    env: {
      supabaseUrl: 'https://synthetic.supabase.co',
      supabaseServiceRoleKey: 'synthetic-service-role-key',
    },
    createClientImpl: (url, key, options) => {
      calls.push({ url, key, options });
      return {
        rpc: async (name, params) => {
          calls.push({ name, params });
          return { data: true, error: null };
        },
      };
    },
  });
  const context = {
    ...makeContext(headA),
    requestId,
    session: { idHash: 'peppered-session-hash' },
  };
  const command = {
    targetUserId: target, projectId: PROJECT_A, role: 'coord', status: 'active',
  };

  assert.equal(await rpc(context, command), true);
  assert.deepEqual(calls[1], {
    name: 'app_membership_change',
    params: {
      p_actor_session_hash: 'peppered-session-hash',
      p_actor_user_id: headA.userId,
      p_target_user_id: target,
      p_project_id: PROJECT_A,
      p_role: 'coord',
      p_status: 'active',
      p_correlation_id: requestId,
    },
  });
});

test('governance RPC is service-only, AAL2-bound, atomically audited, revokes sessions and preserves last CEO', async () => {
  const sql = await readFile(new URL('../../migrations/0020_security_rpcs.sql', import.meta.url), 'utf8');
  const rlsSql = await readFile(new URL('../../migrations/0019_security_rls.sql', import.meta.url), 'utf8');
  const rollback = await readFile(new URL('../../migrations/rollback/0018-0024-pre-cutover.sql', import.meta.url), 'utf8');
  const membershipRpc = sql.match(
    /create or replace function public\.app_membership_change\([\s\S]*?end \$\$;/i,
  )?.[0] ?? '';
  const auditTrigger = rlsSql.match(
    /create or replace function app_private\.audit_row_change\(\)[\s\S]*?end \$\$;/i,
  )?.[0] ?? '';

  assert.match(membershipRpc, /p_status text, p_correlation_id uuid/i);
  assert.match(membershipRpc, /s\.aal = 2/);
  assert.match(membershipRpc, /coalesce\(actor\.global_role = 'ceo', false\)/i,
    'nullable global_role must not bypass the service-role authorization check');
  const validatedSession = membershipRpc.search(/if not found or \(not v_actor_is_ceo and not v_actor_is_head\)/i);
  const trustedAttribution = membershipRpc.search(/set_config\('app\.trusted_actor_session_hash'/i);
  assert.ok(validatedSession >= 0 && trustedAttribution > validatedSession,
    'transaction-local attribution must be established only after AAL2 session authorization');
  assert.match(membershipRpc, /set_config\('app\.trusted_actor_session_hash', p_actor_session_hash, true\)/i);
  assert.match(membershipRpc, /set_config\('app\.trusted_correlation_id', p_correlation_id::text, true\)/i);
  assert.match(membershipRpc, /insert into app_private\.audit_events[\s\S]*p_actor_user_id[\s\S]*p_correlation_id/i);
  assert.match(membershipRpc, /pg_advisory_xact_lock[\s\S]*count\(\*\)[\s\S]*global_role = 'ceo'/);
  assert.match(membershipRpc, /security_version = security_version \+ 1/);
  assert.match(membershipRpc, /revoke_reason = '(?:global_role|membership)_changed'/);
  assert.match(sql, /revoke all on function public\.app_membership_change\(text,uuid,uuid,integer,text,text,uuid\) from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.app_membership_change\(text,uuid,uuid,integer,text,text,uuid\) to service_role/i);
  assert.match(rollback, /drop function if exists public\.app_membership_change\(text,uuid,uuid,integer,text,text,uuid\)/i);

  assert.match(auditTrigger, /current_setting\('app\.trusted_actor_session_hash', true\)/i);
  assert.match(auditTrigger, /from app_private\.auth_sessions[\s\S]*session_hash = v_trusted_session_hash/i);
  assert.match(auditTrigger, /actor_user_id[\s\S]*v_actor_user_id/i);
  assert.match(auditTrigger, /correlation_id[\s\S]*v_correlation_id/i);
});
