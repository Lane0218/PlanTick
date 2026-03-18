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
    const workspaceId = String(body.workspaceId ?? "").trim();
    const newPassphrase = String(body.newPassphrase ?? "").trim();

    if (!workspaceId) {
      return new Response(
        JSON.stringify({ error: "Missing workspace id." }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    if (newPassphrase.length < 6) {
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

    const { data, error } = await client.rpc("rotate_workspace_passphrase", {
      p_workspace_id: workspaceId,
      p_new_passphrase: newPassphrase,
    });

    if (error) {
      const message = error.message.toLowerCase();
      const conflict = error.code === "23505";
      const forbidden = message.includes("access denied");
      const notFound = message.includes("workspace not found");

      return new Response(
        JSON.stringify({
          error: conflict
            ? "Workspace passphrase already exists."
            : forbidden
              ? "Workspace access denied."
              : notFound
                ? "Workspace not found."
                : error.message,
        }),
        {
          status: conflict ? 409 : forbidden ? 403 : notFound ? 404 : 500,
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
        updated: true,
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
