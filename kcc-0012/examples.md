# KCC-12 examples

Non-normative code illustrating [KCC-12](../kcc-0012.md). Where this file
and the specification disagree, the specification is authoritative. Types
refer to [interfaces.ts](interfaces.ts).

## 1. Wallet side: announcing a provider

Run in the page context once the provider object is ready. Register the request listener first, then perform the announcement. This is done so that an app that requests between the two steps is still answered.

```typescript
import type { KaspaProvider, KaspaProviderDetail, KaspaProviderInfo } from "./interfaces";

export function announceProvider(provider: KaspaProvider): void {
  const info: KaspaProviderInfo = Object.freeze({
    uuid: crypto.randomUUID(), // fresh per page load
    name: "Example Wallet",
    icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=",
    rdns: "com.example.wallet", // stable across page loads
  });
  const detail: KaspaProviderDetail = Object.freeze({ info, provider });

  const announce = () =>
    window.dispatchEvent(new CustomEvent("kaspa:announceProvider", { detail }));

  window.addEventListener("kaspa:requestProvider", announce);
  announce();
}
```

## 2. App side: discovering providers

```typescript
import type { KaspaProviderDetail } from "./interfaces";

const providers = new Map<string, KaspaProviderDetail>(); // keyed by uuid

export function discoverProviders(onChange: (list: KaspaProviderDetail[]) => void): void {
  window.addEventListener("kaspa:announceProvider", (event) => {
    const detail = event.detail;
    if (!detail?.info?.uuid || typeof detail.provider?.request !== "function") return;
    if (!detail.info.icon.startsWith("data:")) return; // Section 3.6
    const seen = providers.get(detail.info.uuid);
    if (seen && (seen.provider !== detail.provider || seen.info.rdns !== detail.info.rdns)) {
      console.warn("conflicting announcement for uuid", detail.info.uuid);
      return;  // Section 3.5
    }
    providers.set(detail.info.uuid, detail);
    onChange([...providers.values()]);
  });
  // Dispatch only after the listener is registered
  window.dispatchEvent(new Event("kaspa:requestProvider"));
}
```

## 3. App side: connecting and reacting to changes

```typescript
import type { Address, KaspaProvider, NetworkId, ProviderRpcError } from "./interfaces";

export async function connect(provider: KaspaProvider) {
  // returns [] until the user has authorized this origin.
  let accounts = (await provider.request({ method: "kaspa_accounts" })) as Address[];
  if (accounts.length === 0) {
    try {
      accounts = (await provider.request({ method: "kaspa_requestAccounts" })) as Address[];
    } catch (e) {
      const err = e as ProviderRpcError;
      if (err.code === 4001) return null; // user declined
      throw err;
    }
  }
  const chainId = (await provider.request({ method: "kaspa_chainId" })) as NetworkId;

  provider.on("accountsChanged", (next: Address[]) => {
    if (next.length === 0) console.log("disconnected or locked");
    else console.log("active account is now", next[0]);
  });
  provider.on("chainChanged", (id: NetworkId) => {
    console.log("network is now", id); // discard cached UTXOs, balances, etc.
  });

  return { accounts, chainId };
}

export async function disconnect(provider: KaspaProvider) {
  await provider.request({
    method: "wallet_revokePermissions",
    params: [{ kaspa_accounts: {} }],
  });
}
```

## 4. App side: signing a message

```typescript
const signature = await provider.request({
  method: "kaspa_signMessage",
  params: ["Sign in to example.com\nNonce: 7f3a…\nExpires: 2026-09-10T12:00:00Z", accounts[0]],
});
// signature is 128 hex characters; verify per KIP-5 with the x-only key taken
// from the address payload.
```

## 5. App side: signing a transaction with a covenant input

The app builds the transaction with the Kaspa WASM SDK, including inputs
whose signature scripts are already in place (a covenant input), serializes
it, and asks the wallet to sign only the user's inputs.

```typescript
import type { SerializedTransaction } from "./interfaces";

// tx: kaspa.Transaction built by the app; input 0 is a covenant input whose
// signatureScript is already set; input 1 spends the user's UTXO.
const unsigned: SerializedTransaction = tx.serializeToSafeJSON();

const signed = (await provider.request({
  method: "kaspa_signTransaction",
  params: [{ transaction: unsigned, signInputs: [{ index: 1, sighashType: 1 }] }],
})) as SerializedTransaction;

const txid = await provider.request({
  method: "kaspa_sendRawTransaction",
  params: [signed],
});
```

## 6. App side: feature detection

```typescript
async function supports(provider: KaspaProvider, method: string): Promise<boolean> {
  try {
    await provider.request({ method, params: [] });
    return true;
  } catch (e) {
    return (e as ProviderRpcError).code !== 4200; // any other error means "supported"
  }
}
```

## 7. Wallet side: a page-to-extension transport

KCC-12 does not specify how the provider reaches the extension. The example
below is one common design: an in-page script which exposes the provider and
relays each request through `window.postMessage` to a content script. This is then
forwarded to the extension background over a runtime port. The content
script validates the origin of every message where the background then attributes
every request to that origin.

```typescript
// inpage.ts (runs in the page's JavaScript realm)
type Pending = { resolve: (v: unknown) => void; reject: (e: unknown) => void };
const pending = new Map<string, Pending>();
const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
const CHANNEL = "com.example.wallet";

const provider: KaspaProvider = {
  request(args) {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      pending.set(id, { resolve, reject });
      window.postMessage({ channel: CHANNEL, kind: "request", id, ...args }, window.location.origin);
    });
  },
  on(event, listener) {
    (listeners.get(event) ?? listeners.set(event, new Set()).get(event)!).add(listener);
    return this;
  },
  removeListener(event, listener) {
    listeners.get(event)?.delete(listener);
    return this;
  },
};

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const msg = event.data;
  if (msg?.channel !== CHANNEL) return;
  if (msg.kind === "response") {
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) {
      const err = new Error(msg.error.message) as ProviderRpcError;
      err.code = msg.error.code;
      err.data = msg.error.data;
      p.reject(err);
    } else {
      p.resolve(msg.result);
    }
  } else if (msg.kind === "event") {
    listeners.get(msg.event)?.forEach((l) => l(msg.payload));
  }
});

announceProvider(provider);
```

```typescript
// content.ts
const port = chrome.runtime.connect({ name: "provider" });
window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const msg = event.data;
  if (msg?.channel !== "com.example.wallet" || msg.kind !== "request") return;
  port.postMessage({ id: msg.id, method: msg.method, params: msg.params, origin: event.origin });
});
port.onMessage.addListener((msg) => {
  window.postMessage({ channel: "com.example.wallet", ...msg }, window.location.origin);
});
```
