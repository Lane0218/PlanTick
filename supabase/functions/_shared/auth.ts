import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type UserContext = {
  userId: string;
  admin: ReturnType<typeof createClient>;
};

export async function requireUser(
  authorization: string | null,
): Promise<UserContext> {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error("Missing Supabase function env vars.");
  }

  if (!authorization) {
    throw new Error("Missing Authorization header.");
  }

  const userClient = createClient(url, anonKey, {
    global: {
      headers: {
        Authorization: authorization,
      },
    },
  });

  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();

  if (userError || !user) {
    throw new Error("Invalid user session.");
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return {
    userId: user.id,
    admin,
  };
}

