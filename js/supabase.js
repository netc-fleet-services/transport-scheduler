/* ═══════════════════════════════════════════════
   NETC Transport Planner — Supabase Client & Auth

   Initializes the Supabase client (window.sb) and
   provides auth helpers used by the login screen.

   TEAM_EMAIL must match the user you create in:
     Supabase Dashboard → Authentication → Users
   ═══════════════════════════════════════════════ */

// The email for the shared team account.
// The password is set in Supabase Auth — it's what dispatchers type to log in.
var TEAM_EMAIL = 'team@netc.internal';

// Initialize the Supabase client.
// `supabase` (lowercase) is the global exposed by the CDN script.
// eslint-disable-next-line no-undef
var sb = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

// ── Client-side rate limiting ───────────────────
// Supabase Auth has server-side rate limiting built in.
// This adds a client-side lockout layer so the UI gives
// clear feedback and discourages casual brute-forcing.
//
// Lockout schedule:
//   3 failed attempts → 1 minute lockout
//   6 failed attempts → 5 minute lockout
//   9+ failed attempts → 15 minute lockout
//
// Stored in localStorage so lockout survives page reloads.

var AUTH_ATTEMPTS_KEY = 'netc_auth_attempts';
var AUTH_LOCKOUT_KEY  = 'netc_auth_lockout';

function getAuthState() {
  return {
    attempts:  parseInt(localStorage.getItem(AUTH_ATTEMPTS_KEY) || '0'),
    lockUntil: parseInt(localStorage.getItem(AUTH_LOCKOUT_KEY)  || '0'),
  };
}

function recordFailedAttempt() {
  var state     = getAuthState();
  var attempts  = state.attempts + 1;
  localStorage.setItem(AUTH_ATTEMPTS_KEY, attempts);

  var lockMs = attempts >= 9 ? 15 * 60000 :
               attempts >= 6 ?  5 * 60000 :
               attempts >= 3 ?      60000 : 0;
  if (lockMs) localStorage.setItem(AUTH_LOCKOUT_KEY, Date.now() + lockMs);
}

function clearAuthLockout() {
  localStorage.removeItem(AUTH_ATTEMPTS_KEY);
  localStorage.removeItem(AUTH_LOCKOUT_KEY);
}

// ── Auth helpers ────────────────────────────────

async function signIn(password) {
  var result = await sb.auth.signInWithPassword({
    email:    TEAM_EMAIL,
    password: password,
  });
  if (result.error) {
    recordFailedAttempt();
    throw result.error;
  }
  clearAuthLockout();
  return result.data;
}

async function signOut() {
  await sb.auth.signOut();
}
