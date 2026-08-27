import { SecurityError } from './errors.mjs';

function row(data) {
  if (Array.isArray(data)) return data[0] ?? null;
  return data ?? null;
}

function camelSession(value) {
  if (!value) return null;
  return {
    idHash: value.session_hash,
    userId: value.user_id,
    encryptedAccessToken: value.encrypted_access_token,
    encryptedRefreshToken: value.encrypted_refresh_token,
    tokenKeyVersion: value.token_key_version,
    accessTokenExpiresAt: value.access_token_expires_at,
    csrfHash: value.csrf_hash,
    aal: value.aal,
    securityVersion: value.security_version,
    currentSecurityVersion: value.current_security_version,
    disabledAt: value.disabled_at,
    authState: value.auth_state,
    createdAt: value.created_at,
    lastSeenAt: value.last_seen_at,
    idleTimeoutSeconds: value.idle_timeout_seconds,
    idleExpiresAt: value.idle_expires_at,
    absoluteExpiresAt: value.absolute_expires_at,
    revokedAt: value.revoked_at,
    revokeReason: value.revoke_reason,
  };
}

async function rpc(client, name, parameters) {
  try {
    const { data, error } = await client.rpc(name, parameters);
    if (error) throw error;
    return data;
  } catch (cause) {
    throw new SecurityError(503, 'SESSION_STORE_UNAVAILABLE', 'Session validation is unavailable', { cause });
  }
}

export function createSupabaseSessionStore({ client }) {
  if (!client || typeof client.rpc !== 'function') {
    throw new SecurityError(500, 'CONFIG_INVALID', 'Server security configuration is invalid');
  }
  return Object.freeze({
    async create(record) {
      await rpc(client, 'app_session_create', {
        p_session_hash: record.idHash,
        p_user_id: record.userId,
        p_encrypted_access_token: record.encryptedAccessToken,
        p_encrypted_refresh_token: record.encryptedRefreshToken,
        p_token_key_version: record.tokenKeyVersion,
        p_access_token_expires_at: record.accessTokenExpiresAt ?? null,
        p_csrf_hash: record.csrfHash,
        p_aal: record.aal,
        p_security_version: record.securityVersion,
        p_auth_state: record.authState,
        p_created_at: record.createdAt,
        p_idle_timeout_seconds: record.idleTimeoutSeconds,
        p_idle_expires_at: record.idleExpiresAt,
        p_absolute_expires_at: record.absoluteExpiresAt,
      });
    },
    async load(idHash) {
      return camelSession(row(await rpc(client, 'app_session_load', { p_session_hash: idHash })));
    },
    async touch(idHash, lastSeenAt, idleExpiresAt) {
      return Boolean(await rpc(client, 'app_session_touch', {
        p_session_hash: idHash,
        p_last_seen_at: lastSeenAt,
        p_idle_expires_at: idleExpiresAt,
      }));
    },
    async rotate(oldIdHash, next, reason) {
      return Boolean(await rpc(client, 'app_session_rotate', {
        p_old_session_hash: oldIdHash,
        p_new_session_hash: next.idHash,
        p_encrypted_access_token: next.encryptedAccessToken,
        p_encrypted_refresh_token: next.encryptedRefreshToken,
        p_token_key_version: next.tokenKeyVersion,
        p_access_token_expires_at: next.accessTokenExpiresAt ?? null,
        p_csrf_hash: next.csrfHash,
        p_aal: next.aal,
        p_security_version: next.securityVersion,
        p_auth_state: next.authState,
        p_created_at: next.createdAt,
        p_idle_timeout_seconds: next.idleTimeoutSeconds,
        p_idle_expires_at: next.idleExpiresAt,
        p_absolute_expires_at: next.absoluteExpiresAt,
        p_reason: reason,
      }));
    },
    async revoke(idHash, reason) {
      return Boolean(await rpc(client, 'app_session_revoke', { p_session_hash: idHash, p_reason: reason }));
    },
    async refreshTokens(idHash, expectedEncryptedRefreshToken, next) {
      return Boolean(await rpc(client, 'app_session_refresh_tokens', {
        p_session_hash: idHash,
        p_expected_encrypted_refresh_token: expectedEncryptedRefreshToken,
        p_encrypted_access_token: next.encryptedAccessToken,
        p_encrypted_refresh_token: next.encryptedRefreshToken,
        p_token_key_version: next.tokenKeyVersion,
        p_access_token_expires_at: next.accessTokenExpiresAt,
      }));
    },
    async consumeRateLimit(bucketHash, limit, windowSeconds) {
      const result = row(await rpc(client, 'app_rate_limit_consume', {
        p_bucket_hash: bucketHash,
        p_limit: limit,
        p_window_seconds: windowSeconds,
      }));
      return {
        allowed: result?.allowed,
        count: result?.current_count,
        retryAfterSeconds: result?.retry_after_seconds,
      };
    },
  });
}
