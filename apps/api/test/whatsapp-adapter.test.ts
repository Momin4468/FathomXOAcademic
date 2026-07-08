import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WhatsAppService } from "../src/common/whatsapp/whatsapp.service.js";

/**
 * P1 item 8 — the swappable WhatsApp stub. The push is DEFERRED: the dev adapter
 * is a no-op that must resolve (so the intake path never breaks), and any other
 * adapter value must fail LOUDLY (a misconfig can't silently drop a client message).
 */
describe("WhatsApp stub adapter (P1 item 8; deferred provider)", () => {
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
});
