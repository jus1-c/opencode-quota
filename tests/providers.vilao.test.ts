import { describe, expect, it } from "vite-plus/test";

import { vilaoProvider } from "../src/providers/vilao.js";
import {
  fakeHttp,
  fetchRows,
  keyLogin,
  requestHeader,
  useProviderWorld,
} from "./helpers/provider-fetch.js";

const world = useProviderWorld();
const BALANCE_URL = "https://vilao.ai/api/v2/account/balance";

/** A Vilao login holding a PAT in its metadata, next to the inference key it must never use. */
function vilaoLogin(pat = "pat-secret") {
  return keyLogin("vilao-1", "vilao", "inference-key-must-not-be-used", {
    active: 1,
    value: { type: "api", key: "inference-key-must-not-be-used", metadata: { vilao_pat: pat } },
  });
}

function balanceReply(balance: number) {
  return { data: { balance } };
}

describe("vilao provider", () => {
  it("shows the balance, its baseline and the share left", async () => {
    world.storeLogins([vilaoLogin()]);
    let balance = 100000;
    const fetchMock = fakeHttp(() => balanceReply(balance));
    await fetchRows(vilaoProvider);
    balance = 40000;

    const fetched = await fetchRows(vilaoProvider);

    expect(fetched.rows.map((row) => row.id)).toEqual(["vilao.balance"]);
    expect(fetched.rows[0]).toMatchObject({ label: "Balance", percentRemaining: 40 });
    expect(fetched.rows[0]?.amount).toEqual({
      decimal: "40000",
      unit: { kind: "custom", symbol: "₫" },
    });
    expect(fetched.rows[0]?.limit).toEqual({
      decimal: "100000",
      unit: { kind: "custom", symbol: "₫" },
    });
    expect(fetched.rows[0]?.type).toBe("balance");
    expect(fetched.rows[0]?.authority).toBe("locally_derived");
    expect(requestHeader(fetchMock.mock.calls.at(-1)?.[1], "authorization")).toBe(
      "Bearer pat-secret",
    );
  });

  it("does not query when no login holds a PAT", async () => {
    world.storeLogins([
      keyLogin("vilao-1", "vilao", "inference-key-must-not-be-used", { active: 1 }),
    ]);
    const fetchMock = fakeHttp(() => balanceReply(100000));

    const fetched = await fetchRows(vilaoProvider);

    expect(fetched.rows).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports an API failure as the account's error", async () => {
    world.storeLogins([vilaoLogin()]);
    fakeHttp(() => new Response("Unauthorized", { status: 401 }));

    const fetched = await fetchRows(vilaoProvider);

    expect(fetched.rows).toEqual([]);
    expect(fetched.error?.detail ?? fetched.error?.code).toBeTruthy();
    expect(JSON.stringify(fetched.error)).not.toContain("pat-secret");
  });

  it("keeps the balance row out of a rejected request", async () => {
    world.storeLogins([vilaoLogin()]);
    fakeHttp(() => new Response("bad pat-secret", { status: 500 }));

    const fetched = await fetchRows(vilaoProvider);

    expect(JSON.stringify(fetched.error)).toContain("[redacted]");
  });

  it("names the debug facts it reports", async () => {
    world.storeLogins([vilaoLogin()]);
    fakeHttp(() => balanceReply(100000));

    const fetched = await fetchRows(vilaoProvider);
    const keys = fetched.debug.map((item) => item.key);

    expect(keys).toContain("pat_metadata");
    expect(keys).toContain("local_state_path");
    expect(BALANCE_URL).toBe("https://vilao.ai/api/v2/account/balance");
  });
});
