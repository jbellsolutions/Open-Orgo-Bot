// Real OOB server and renderer; only the paid Orgo provider is an owned local
// HTTP stand-in. No guest commands execute and no real credentials are read.
import { createServer } from "node:http";
import { once } from "node:events";
import { resolve } from "node:path";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { launchUi } from "./control-omb-ui.ts";

export async function launchTeamComputersPreview() {
  const computers: Array<{ id: string; name: string; status: string; workspace_id: string; connection_url: string; vnc_password: string }> = [];
  const calls: Array<{ method: string; path: string }> = [];
  const createdByName = new Map<string, string>();
  let refuseCreate = false;
  const provider = createServer((request, response) => {
    void (async () => {
      const method = request.method ?? "GET";
      const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      const send = (body: unknown, status = 200) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(body));
      };
      let raw = "";
      for await (const chunk of request) raw += String(chunk);
      const body = raw ? JSON.parse(raw) : {};
      if (path === "/__fixture") {
        if (method === "POST") refuseCreate = body.refuseCreate === true;
        return send({ calls, computers, refuseCreate });
      }
      if (request.headers.authorization !== "Bearer orgo_verification_fixture") return send({ message: "fixture authentication failed" }, 401);
      calls.push({ method, path });
      const workspaceId = "10000000-0000-4000-8000-000000000001";
      if (method === "GET" && path === "/workspaces") {
        return send({ workspaces: [{ id: workspaceId, name: "Fixture workspace", status: "active", desktops: computers }] });
      }
      if (method === "POST" && path === "/computers") {
        if (refuseCreate) return send({ message: "Fixture account is rate-limited. Retry this computer." }, 429);
        if (body.workspace_id !== workspaceId || typeof body.name !== "string") return send({ message: "fixture requires a workspace and name" }, 400);
        const key = body.name;
        const previous = createdByName.get(key);
        if (previous) return send(computers.find((computer) => computer.id === previous));
        const id = `00000000-0000-4000-8000-${String(computers.length + 1).padStart(12, "0")}`;
        const computer = {
          id,
          name: body.name,
          status: "running",
          workspace_id: workspaceId,
          connection_url: `https://www.orgo.ai/desktops/fixture-${computers.length + 1}`,
          vnc_password: `fixture-password-${computers.length + 1}`,
        };
        computers.push(computer); createdByName.set(key, id);
        return send(computer, 201);
      }
      const match = path.match(/^\/computers\/([0-9a-f-]{36})(?:\/(bash|screenshot|stop|start|restart))?$/i);
      const computer = computers.find((candidate) => candidate.id === match?.[1]);
      if (!match || !computer) return send({ message: "fixture resource not found" }, 404);
      if (method === "GET" && !match[2]) return send(computer);
      if (method === "POST" && match[2] === "bash") return send({ success: true, output: "" });
      if (method === "GET" && match[2] === "screenshot") return send({ image: Buffer.from("fixture screenshot").toString("base64") });
      if (method === "POST" && (match[2] === "stop" || match[2] === "start" || match[2] === "restart")) {
        computer.status = match[2] === "stop" ? "stopped" : "running";
        return send(computer);
      }
      // Unexpected deletion is deliberately refused and remains in receipts.
      return send({ message: "fixture does not implement this mutation" }, 405);
    })().catch((error) => {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ message: error instanceof Error ? error.message : String(error) }));
    });
  });
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  const address = provider.address();
  if (!address || typeof address === "string") throw new Error("Orgo fixture has no loopback port");
  const orgoFixtureApi = `http://127.0.0.1:${address.port}`;
  const stdout = new Writable({ write(chunk, _encoding, done) {
    const info = JSON.parse(String(chunk));
    process.stdout.write(`${JSON.stringify({ ...info, orgoFixtureApi }, null, 2)}\n`, done);
  } });
  try {
    await launchUi([], process.env, { stdout, stderr: process.stderr }, { orgoFixtureApi });
  } finally {
    provider.closeAllConnections();
    await new Promise<void>((done, reject) => provider.close((error) => error ? reject(error) : done()));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await launchTeamComputersPreview();
}
