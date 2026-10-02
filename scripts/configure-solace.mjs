import { execFileSync } from "node:child_process";

const region = process.env.AWS_REGION || "ca-central-1";
const stack = process.env.STACK_NAME || "sap-agent-choreography-demo";
const required = ["SOLACE_SEMP_URL", "SOLACE_VPN", "SOLACE_SEMP_USERNAME", "SOLACE_SEMP_PASSWORD", "SOLACE_REST_URL", "SOLACE_USERNAME", "SOLACE_PASSWORD"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing ${missing.join(", ")}. Export them locally; never commit them.`);
  process.exit(1);
}

const output = (key) => execFileSync("aws", ["cloudformation", "describe-stacks", "--stack-name", stack, "--region", region, "--query", `Stacks[0].Outputs[?OutputKey==\`${key}\`].OutputValue`, "--output", "text"], { encoding: "utf8" }).trim();
const api = output("ApiBaseUrl");
const secretArn = output("SolaceSecretArn");
const auth = `Basic ${Buffer.from(`${process.env.SOLACE_SEMP_USERNAME}:${process.env.SOLACE_SEMP_PASSWORD}`).toString("base64")}`;
const base = `${process.env.SOLACE_SEMP_URL.replace(/\/$/, "")}/SEMP/v2/config/msgVpns/${encodeURIComponent(process.env.SOLACE_VPN)}`;
const headers = { authorization: auth, "content-type": "application/json" };

async function put(path, body) {
  const url = `${base}${path}`;
  const current = await fetch(url, { headers });
  const result = await fetch(url, { method: current.ok ? "PATCH" : "POST", headers, body: JSON.stringify(body) });
  if (!result.ok && result.status !== 409) throw new Error(`${result.status} ${url}: ${await result.text()}`);
}

const queue = async (name, subscription) => {
  await put(`/queues/${encodeURIComponent(name)}`, { queueName: name, accessType: "non-exclusive", ingressEnabled: true, egressEnabled: true, permission: "consume", maxMsgSpoolUsage: 100 });
  await put(`/queues/${encodeURIComponent(name)}/subscriptions/${encodeURIComponent(subscription)}`, { subscriptionTopic: subscription });
};

await queue("Q.DEMO.SOURCING", "demo/sap/supply-chain/v1/*/order/risk/assessed/v1");
await queue("Q.DEMO.LOGISTICS", "demo/sap/supply-chain/v1/*/order/risk/assessed/v1");
await queue("Q.DEMO.CUSTOMER_SLA", "demo/sap/supply-chain/v1/*/order/risk/assessed/v1");
await queue("Q.DEMO.AUDIT", "demo/sap/supply-chain/v1/>");

execFileSync("aws", ["secretsmanager", "put-secret-value", "--secret-id", secretArn, "--region", region, "--secret-string", JSON.stringify({ restUrl: process.env.SOLACE_REST_URL, username: process.env.SOLACE_USERNAME, password: process.env.SOLACE_PASSWORD, webhookToken: process.env.SOLACE_WEBHOOK_TOKEN || "configure-rdp-token" })], { stdio: "inherit" });

console.log(`Solace queues configured. Configure three RDP consumers to POST queue messages to ${api}/broker/dispatch/{sourcing|logistics|customer-sla} if broker-driven Lambda invocation is required.`);
