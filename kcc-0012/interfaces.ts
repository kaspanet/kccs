/** A canonical network identifier such as "mainnet" or "testnet-10". */
export type NetworkId = string;

export const KASPA_NETWORKS = {
  MAINNET: "mainnet",
  TESTNET_10: "testnet-10",
  DEVNET: "devnet",
  SIMNET: "simnet",
} as const;

export const NETWORK_ID_PATTERN = /^(mainnet|testnet|devnet|simnet)(-[1-9][0-9]*)?$/;

export function isNetworkId(value: string): boolean {
  if (!NETWORK_ID_PATTERN.test(value)) return false;
  return !(value === "testnet");
}

/** hexadecimal */
export type Hex = string;
/** 64 hexadecimal characters. */
export type TransactionId = Hex;
/** Unsigned 64-bit integer as a decimal string. */
export type Uint64 = string;
/** A Uint64 counting sompi. */
export type Amount = Uint64;
/** Prefixed Kaspa address, e.g. "kaspa:qp...". */
export type Address = string;
/** JSON text in the Kaspa WASM SDK "safe" schema (Transaction.serializeToSafeJSON). */
export type SerializedTransaction = string;
/** "PSKB" followed by the lowercase hex of the UTF-8 JSON bundle text (KCC-12 Section 7.8). */
export type Pskb = string;

export type SighashType = 1 | 2 | 4 | 129 | 130 | 132;

export const SIGHASH = {
  ALL: 1,
  NONE: 2,
  SINGLE: 4,
  ALL_ANYONECANPAY: 129,
  NONE_ANYONECANPAY: 130,
  SINGLE_ANYONECANPAY: 132,
} as const;

export type SignatureType = "schnorr" | "ecdsa";

/** Shape of the JSON that a SerializedTransaction string decodes to. */
export interface SerializedUtxoEntry {
  address?: Address | null;
  amount: string;
  scriptPublicKey: Hex;
  blockDaaScore: string;
  isCoinbase: boolean;
  covenantId?: Hex | null;
}

export interface SerializedInput {
  transactionId: TransactionId;
  index: number;
  sequence: string;
  sigOpCount: number;
  computeBudget?: number;
  signatureScript: Hex;
  utxo: SerializedUtxoEntry;
}

export interface SerializedCovenantBinding {
  authorizingInput: number;
  covenantId: Hex;
}

export interface SerializedOutput {
  value: string;
  scriptPublicKey: Hex;
  covenant?: SerializedCovenantBinding | null;
}

export interface SerializedTransactionObject {
  id: TransactionId;
  version: number;
  inputs: SerializedInput[];
  outputs: SerializedOutput[];
  subnetworkId: Hex;
  lockTime: string;
  gas: string;
  storageMass?: string;
  mass?: string;
  payload: Hex;
}

export interface RequestArguments {
  readonly method: string;
  readonly params?: readonly unknown[] | object;
}

export interface ProviderRpcError extends Error {
  message: string;
  code: number;
  data?: unknown;
}

export interface ProviderConnectInfo {
  readonly chainId: NetworkId;
}

export interface ProviderMessage {
  readonly type: string;
  readonly data: unknown;
}

export interface KaspaProviderEvents {
  connect: (info: ProviderConnectInfo) => void;
  disconnect: (error: ProviderRpcError) => void;
  chainChanged: (chainId: NetworkId) => void;
  accountsChanged: (accounts: Address[]) => void;
  message: (message: ProviderMessage) => void;
}

export interface KaspaProvider {
  request(args: RequestArguments): Promise<unknown>;
  on<E extends keyof KaspaProviderEvents>(event: E, listener: KaspaProviderEvents[E]): this;
  on(event: string, listener: (...args: unknown[]) => void): this;
  removeListener<E extends keyof KaspaProviderEvents>(event: E, listener: KaspaProviderEvents[E]): this;
  removeListener(event: string, listener: (...args: unknown[]) => void): this;
}

export const KASPA_ANNOUNCE_PROVIDER_EVENT = "kaspa:announceProvider" as const;
export const KASPA_REQUEST_PROVIDER_EVENT = "kaspa:requestProvider" as const;

export interface KaspaProviderInfo {
  /** RFC 9562 version 4 UUID, lowercase, fresh per page load. */
  readonly uuid: string;
  /** Human-readable wallet name. */
  readonly name: string;
  /** RFC 2397 data: URI of a square image, at least 96x96. */
  readonly icon: string;
  /** Reverse domain name, stable across page loads, e.g. "com.example.wallet". */
  readonly rdns: string;
}

export interface KaspaProviderDetail {
  readonly info: KaspaProviderInfo;
  readonly provider: KaspaProvider;
}

export interface KaspaAnnounceProviderEvent extends CustomEvent<KaspaProviderDetail> {
  readonly type: typeof KASPA_ANNOUNCE_PROVIDER_EVENT;
}

export interface KaspaRequestProviderEvent extends Event {
  readonly type: typeof KASPA_REQUEST_PROVIDER_EVENT;
}

declare global {
  interface WindowEventMap {
    "kaspa:announceProvider": CustomEvent<KaspaProviderDetail>;
    "kaspa:requestProvider": Event;
  }
}

export interface Caveat {
  type: string;
  value: unknown;
}

export interface Permission {
  invoker: string;
  parentCapability: string;
  caveats: Caveat[];
  date?: number;
}

export type PermissionRequest = { [method: string]: object };

export const CAVEAT_RESTRICT_RETURNED_ACCOUNTS = "restrictReturnedAccounts" as const;

export interface SignInput {
  index: number;
  sighashType?: SighashType;
  signatureType?: SignatureType;
  redeemScript?: Hex;
}

export interface SendTransactionParams {
  from?: Address;
  outputs: Array<{ address: Address; amount: Amount }>;
  payload?: Hex;
  priorityFee?: Amount;
}

export interface SignTransactionParams {
  transaction: SerializedTransaction;
  signInputs: SignInput[];
}

export interface SwitchChainParams {
  chainId: NetworkId;
}

/** params and result of every method, keyed by method name. */
export interface KaspaRpcSchema {
  kaspa_requestAccounts: { params: []; result: Address[] };
  kaspa_accounts: { params: []; result: Address[] };
  kaspa_chainId: { params: []; result: NetworkId };
  kaspa_signMessage: { params: [message: string, address: Address]; result: Hex };
  kaspa_sendTransaction: { params: [SendTransactionParams]; result: TransactionId };
  kaspa_signTransaction: { params: [SignTransactionParams]; result: SerializedTransaction };
  kaspa_sendRawTransaction: { params: [transaction: SerializedTransaction]; result: TransactionId };
  kaspa_signPskb: { params: [pskb: Pskb]; result: Pskb };
  kaspa_sendRawPskb: { params: [pskb: Pskb]; result: TransactionId[] };
  kaspa_sendPskb: { params: [pskb: Pskb]; result: TransactionId[] };
  wallet_switchKaspaChain: { params: [SwitchChainParams]; result: null };
  wallet_requestPermissions: { params: [PermissionRequest]; result: Permission[] };
  wallet_getPermissions: { params: []; result: Permission[] };
  wallet_revokePermissions: { params: [PermissionRequest]; result: null };
}

export type KaspaRpcMethod = keyof KaspaRpcSchema;

export const KASPA_REQUIRED_METHODS = [
  "kaspa_requestAccounts",
  "kaspa_accounts",
  "kaspa_chainId",
  "wallet_requestPermissions",
  "wallet_getPermissions",
  "wallet_revokePermissions",
] as const satisfies readonly KaspaRpcMethod[];

export const KASPA_UNRESTRICTED_METHODS = [
  "kaspa_requestAccounts",
  "kaspa_accounts",
  "kaspa_chainId",
  "wallet_switchKaspaChain",
  "wallet_requestPermissions",
  "wallet_getPermissions",
  "wallet_revokePermissions",
] as const satisfies readonly KaspaRpcMethod[];

/** Typed convenience wrapper over KaspaProvider.request. */
export interface TypedKaspaProvider extends KaspaProvider {
  request<M extends KaspaRpcMethod>(args: {
    readonly method: M;
    readonly params?: KaspaRpcSchema[M]["params"];
  }): Promise<KaspaRpcSchema[M]["result"]>;
  request(args: RequestArguments): Promise<unknown>;
}

export const PROVIDER_ERRORS = {
  USER_REJECTED_REQUEST: { code: 4001, message: "User Rejected Request" },
  UNAUTHORIZED: { code: 4100, message: "Unauthorized" },
  UNSUPPORTED_METHOD: { code: 4200, message: "Unsupported Method" },
  DISCONNECTED: { code: 4900, message: "Disconnected" },
  CHAIN_DISCONNECTED: { code: 4901, message: "Chain Disconnected" },
  UNRECOGNIZED_CHAIN: { code: 4902, message: "Unrecognized Chain" },
} as const;

export const RPC_ERRORS = {
  PARSE_ERROR: { code: -32700, message: "Parse error" },
  INVALID_REQUEST: { code: -32600, message: "Invalid request" },
  METHOD_NOT_FOUND: { code: -32601, message: "Method not found" },
  INVALID_PARAMS: { code: -32602, message: "Invalid params" },
  INTERNAL_ERROR: { code: -32603, message: "Internal error" },
  INVALID_INPUT: { code: -32000, message: "Invalid input" },
  RESOURCE_NOT_FOUND: { code: -32001, message: "Resource not found" },
  RESOURCE_UNAVAILABLE: { code: -32002, message: "Resource unavailable" },
  TRANSACTION_REJECTED: { code: -32003, message: "Transaction rejected" },
  METHOD_NOT_SUPPORTED: { code: -32004, message: "Method not supported" },
  LIMIT_EXCEEDED: { code: -32005, message: "Limit exceeded" },
} as const;

/** Constructs a ProviderRpcError. */
export function providerError(
  spec: { code: number; message: string },
  data?: unknown,
): ProviderRpcError {
  const error = new Error(spec.message) as ProviderRpcError;
  error.code = spec.code;
  if (data !== undefined) error.data = data;
  return error;
}
