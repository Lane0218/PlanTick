import { corsHeaders } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed." }),
      {
        status: 405,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }

  try {
    const authorization = req.headers.get("Authorization");
    const { client } = await requireUser(authorization);
    const body = await req.json();
    const passphrase = String(body.passphrase ?? "").trim();

    if (passphrase.length < 6) {
      return new Response(
        JSON.stringify({ error: "Passphrase must be at least 6 characters." }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    const { data, error } = await client.rpc("create_workspace_with_member", {
      p_passphrase: passphrase,
    });

    if (error) {
      const conflict = error.code === "23505";
      return new Response(
        JSON.stringify({
          error: conflict
            ? "Workspace passphrase already exists."
            : error.message,
        }),
        {
          status: conflict ? 409 : 500,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    return new Response(
      JSON.stringify({
        workspaceId: data,
        joined: true,
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error.",
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }
});
