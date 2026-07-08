import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WhatsAppService } from "../src/common/whatsapp/whatsapp.service.js";

/**
 * The swappable WhatsApp sender. The `dev` adapter is a no-op that must resolve (so
 * the intake path never breaks); the `meta` (Cloud API) adapter requires its config
 * at boot; any other value must fail LOUDLY (a misconfig can't silently drop a
 * client message). P1 item 8 shipped the stub; backlog item 14 added the `meta`
 * provider branch.
 */
describe("WhatsApp adapter (dev stub + meta provider)", () => {
  it("the dev adapter is a no-op that resolves", async () => {
    delete process.env.WHATSAPP_ADAPTER; // default = dev
    const svc = new WhatsAppService();
    await assert.doesNotReject(svc.send({ to: "+8801700000000", text: "New quote" }));
  });

  it("an unknown adapter fails loudly (no silent drop)", async () => {
    process.env.WHATSAPP_ADAPTER = "twilio";
    try {
      const svc = new WhatsAppService();
      await assert.rejects(svc.send({ to: "+8801700000000", text: "New quote" }), /has no adapter/);
    } finally {
      delete process.env.WHATSAPP_ADAPTER;
    }
  });

  it("the meta adapter requires its config at boot (fail loudly)", () => {
    process.env.WHATSAPP_ADAPTER = "meta";
    const savedToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const savedPhone = process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    try {
      assert.throws(() => new WhatsAppService(), /requires WHATSAPP_ACCESS_TOKEN/);
    } finally {
      delete process.env.WHATSAPP_ADAPTER;
      if (savedToken !== undefined) process.env.WHATSAPP_ACCESS_TOKEN = savedToken;
      if (savedPhone !== undefined) process.env.WHATSAPP_PHONE_NUMBER_ID = savedPhone;
    }
  });

  it("the meta adapter constructs when its config is present", () => {
    process.env.WHATSAPP_ADAPTER = "meta";
    process.env.WHATSAPP_ACCESS_TOKEN = "test-token";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "1234567890";
    try {
      assert.doesNotThrow(() => new WhatsAppService());
    } finally {
      delete process.env.WHATSAPP_ADAPTER;
      delete process.env.WHATSAPP_ACCESS_TOKEN;
      delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    }
  });
});
