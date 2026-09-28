const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const filename = path.resolve(
  __dirname,
  "../app/api/admin/transfers/execute-first-test/route.ts",
);

const compiled = ts.transpileModule(
  fs.readFileSync(filename, "utf8"),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
    fileName: filename,
  },
).outputText;

const currentBody = {
  bookingId: "1be93a44-2570-475c-a061-ea574b638258",
  purchaseId: "0ceb3427-c520-4351-9cb4-e2fb9ea08069",
  amountCents: 1900,
  confirmation: "TWEEDE TRANSFER 19 EUR",
};

let forbiddenCalls = 0;
const violations = [];

function forbidden() {
  forbiddenCalls++;
  throw new Error("Geen writes of uitvoering toegestaan in scopetest");
}

const database = {
  auth: {
    async getUser() {
      return {
        data: { user: { id: "LOCAL_ADMIN" } },
        error: null,
      };
    },
  },
  from(table) {
    if (table !== "profiles") {
      violations.push(`Onverwachte tabel: ${table}`);
      throw new Error("Onverwachte tabel");
    }

    return {
      select() {
        return {
          eq() {
            return {
              async maybeSingle() {
                return { data: { role: "admin" }, error: null };
              },
            };
          },
        };
      },
    };
  },
  rpc: forbidden,
};

const loadedModule = { exports: {} };

function mockRequire(name) {
  if (name === "next/server") {
    return {
      NextRequest: Request,
      NextResponse: {
        json: (body, options) => Response.json(body, options),
      },
    };
  }

  if (name === "@supabase/supabase-js") {
    return { createClient: () => database };
  }

  if (name === "@/lib/execute-sandbox-trainer-transfer") {
    return { executeSandboxTrainerTransfer: forbidden };
  }

  throw new Error(`Niet toegestane import: ${name}`);
}

const context = vm.createContext({
  module: loadedModule,
  exports: loadedModule.exports,
  require: mockRequire,
  process: {
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "https://database.example.invalid",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "LOCAL_FAKE_ANON",
      SUPABASE_SERVICE_ROLE_KEY: "LOCAL_FAKE_SERVICE_ROLE",
      SANDBOX_TRAINER_TRANSFER_EXECUTION_ENABLED: "false",
    },
  },
  console: { error() {}, warn() {}, log() {} },
});

new vm.Script(compiled, { filename }).runInContext(context);

async function check(name, body, expectedStatus) {
  const request = new Request("http://localhost/local-scope-test", {
    method: "POST",
    headers: {
      Authorization: "Bearer LOCAL_FAKE_TOKEN",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const response = await loadedModule.exports.POST(request);
  assert.equal(response.status, expectedStatus);

  const result = await response.json();

  if (expectedStatus === 200) {
    assert.equal(result.result, "disabled");
    assert.equal(result.executionConfirmed, false);
    assert.equal(result.registrationAttempted, false);
    assert.equal(result.stripeCreateAttempted, false);
  }

  assert.equal(forbiddenCalls, 0);
  assert.deepEqual(violations, []);

  console.log(`GESLAAGD: ${name}`);
}

async function main() {
  await check("Nieuwe scope stopt als disabled", currentBody, 200);

  await check("Volledige oude scope geweigerd", {
    ...currentBody,
    bookingId: "b7d8c195-2f03-428e-bbdb-8e7bf65f76db",
    confirmation: "TRANSFER 19 EUR",
  }, 400);

  await check("Oude boeking met nieuwe bevestiging geweigerd", {
    ...currentBody,
    bookingId: "b7d8c195-2f03-428e-bbdb-8e7bf65f76db",
  }, 400);

  await check("Nieuwe boeking met oude bevestiging geweigerd", {
    ...currentBody,
    confirmation: "TRANSFER 19 EUR",
  }, 400);

  await check("Ander bedrag geweigerd", {
    ...currentBody,
    amountCents: 1901,
  }, 400);

  await check("Onbekend invoerveld geweigerd", {
    ...currentBody,
    force: true,
  }, 400);

  console.log(
    "\nALLE 6 SCOPETESTS GESLAAGD. " +
    "Geen echte netwerk- of databaseaanroepen uitgevoerd.",
  );
}

main().catch((error) => {
  console.error("SCOPETEST MISLUKT:", error);
  process.exitCode = 1;
});