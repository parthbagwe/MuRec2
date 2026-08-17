import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL || "";
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";

export const supabaseEnabled = Boolean(url && publishableKey);
export const supabase = supabaseEnabled
  ? createClient(url, publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

function requestError(message) {
  const error = new Error(message);
  error.response = { data: { detail: message } };
  return error;
}

async function ensureProfile(authUser, displayName = "") {
  const fallbackName = authUser.email?.split("@", 1)[0] || "Listener";
  const name = (displayName || authUser.user_metadata?.display_name || fallbackName).trim().slice(0, 60);
  const { data, error } = await supabase
    .from("profiles")
    .upsert({ id: authUser.id, display_name: name || "Listener" }, { onConflict: "id" })
    .select("id,display_name,personalization_enabled,created_at")
    .single();
  if (error) throw requestError(error.message);
  return { ...data, email: authUser.email };
}

export async function currentAccount() {
  if (!supabaseEnabled) throw requestError("Supabase is not configured.");
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw requestError("Sign in to use this feature");
  return ensureProfile(data.user);
}

export async function createAccount(displayName, email, password) {
  if (!supabaseEnabled) throw requestError("Supabase is not configured.");
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: displayName.trim() },
      emailRedirectTo: `${window.location.origin}/`,
    },
  });
  if (error) throw requestError(error.message);
  if (!data.session) return { user: null, confirmation_required: true };
  return { user: await ensureProfile(data.user, displayName), confirmation_required: false };
}

export async function signIn(email, password) {
  if (!supabaseEnabled) throw requestError("Supabase is not configured.");
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw requestError(error.message);
  return ensureProfile(data.user);
}

export async function signOut() {
  if (!supabaseEnabled) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw requestError(error.message);
}
