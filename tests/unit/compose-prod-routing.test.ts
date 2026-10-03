import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

const compose = parse(
  readFileSync(new URL("../../docker-compose.prod.yml", import.meta.url), "utf8")
);
const app = compose.services["omniroute-prod"];

test("production domain routes dashboard and live WebSocket to the configured listeners", () => {
  const labels = app.labels;
  assert.equal(labels["traefik.http.routers.omniroute.rule"], "Host(`omnirouter.rafaelferro.dev`)");
  assert.equal(labels["traefik.http.services.omniroute.loadbalancer.server.port"], "20128");
  assert.equal(labels["traefik.http.services.omniroute-ws.loadbalancer.server.port"], "20132");
  assert.equal(labels["traefik.docker.network"], "traefik_proxy");
  assert.ok(app.networks.includes("traefik_proxy"));
  assert.ok(app.environment.includes("DASHBOARD_PORT=20128"));
  assert.ok(app.environment.includes("LIVE_WS_PORT=20132"));
  assert.ok(
    app.environment.some(
      (value: string) =>
        value.startsWith("LIVE_WS_ALLOWED_ORIGINS=") &&
        value.includes("https://omnirouter.rafaelferro.dev")
    )
  );
});

test("production uses its image build at domain root and its own Redis service", () => {
  assert.equal(app.build.args.OMNIROUTE_BASE_PATH, "");
  assert.ok(app.environment.includes("OMNIROUTE_BASE_PATH="));
  assert.ok(app.environment.includes("REDIS_URL=redis://redis:6379"));
  assert.deepEqual(app.volumes, ["omniroute-prod-data:/app/data"]);
  assert.ok(app.ports.some((port: string) => port.includes("PROD_DASHBOARD_PORT:-20130}:20128")));
});
