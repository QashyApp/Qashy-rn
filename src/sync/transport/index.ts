/**
 * The two ways bytes leave this device, and the rules they leave under.
 *
 * 1. **Relay** (`RelayTransport`) — a drop-box holding padded ciphertext addressed to a
 *    blinded tag. It sees an IP and a byte count, and that is the whole of it.
 * 2. **File** (`FileTransport`) — a `.qashysync` bundle the user carries themselves. Nothing
 *    is contacted, because nothing is involved.
 *
 * Signaling (`signaling.ts`) carries only the pairing handshake.
 *
 * `relay-health.ts` sits alongside them rather than in `engine/`, which is a deliberate
 * departure from the plan's file layout: it depends only on `data/` and `transport/` and
 * never on the engine, so putting it in `engine/` would have inverted the dependency for no
 * benefit. Nothing else about it changes.
 */

export {
  DEFAULT_RELAY_URL,
  EndpointError,
  normalizeEndpointUrl,
  readEndpoints,
  writeEndpoints,
  type EndpointPatch,
  type SyncEndpoints,
} from "@/sync/transport/endpoints";

export {
  MAX_RESPONSE_BYTES,
  RELAY_API_VERSION,
  REQUEST_TIMEOUT_MS,
  RelayError,
  looksOffline,
  type HttpDeps,
  type TransportFailure,
} from "@/sync/transport/http";

export {
  MAX_RELAY_PAGES,
  RELAY_PAGE_SIZE,
  RelayTransport,
  UPLOAD_JITTER_MS,
  type RelayTransportDeps,
} from "@/sync/transport/relay";

export {
  MAX_DETAIL_LENGTH,
  RELAY_DEGRADED_AFTER,
  checkRelayHealth,
  noteRelayFailure,
  noteRelaySuccess,
  readRelayHealth,
  type RelayHealth,
  type RelayHealthDeps,
  type RelayStatus,
} from "@/sync/transport/relay-health";

export {
  MAX_SIGNAL_BYTES,
  SIGNAL_IDLE_TIMEOUT_MS,
  SIGNAL_OPEN_TIMEOUT_MS,
  SignalingClient,
  platformSocket,
  signalingUrl,
  type RawSocket,
  type SignalingDeps,
} from "@/sync/transport/signaling";

export {
  BUNDLE_EXTENSION,
  BUNDLE_MIME,
  BUNDLE_VERSION,
  BundleError,
  FileTransport,
  MAX_BUNDLE_FRAMES,
  bundleFileName,
  decodeBundle,
  encodeBundle,
  type BundleFrame,
  type FileTransportDeps,
  type SyncBundle,
} from "@/sync/transport/file";
