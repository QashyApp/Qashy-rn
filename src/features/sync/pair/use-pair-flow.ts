import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

import { useLocalization } from "@/localization/localization";
import { useFinanceState } from "@/providers/finance-provider";
import { useSync } from "@/providers/sync-provider";
import {
  createDeviceIdentity,
  decodePairingCode,
  normalizeTypedPairingCode,
} from "@/sync/crypto";
import { PairingHost, PairingJoiner } from "@/sync/pairing";
import {
  adoptVault,
  disableSync,
  enableSync,
  readSyncStatus,
  recordPairedPeer,
  resumeSync,
  type DeviceProfile,
} from "@/sync/setup";
import { usePreventScreenCaptureWhile } from "@/features/sync/use-screen-capture-guard";
import { errorMessage } from "@/utils/confirm";
import { nowIso } from "@/utils/entity";
import { hapticError, hapticSuccess, hapticWarning } from "@/services/haptics";
import {
  DisplayedPairingCode,
  Role,
  STAGES,
  Session,
  Stage,
  defaultDeviceName,
  unixSeconds,
} from "@/features/sync/pair/pair-model";

export function usePairFlow() {
  const { status, setup, refresh, reconcile } = useSync();
  const { settings } = useFinanceState();
  const { t } = useLocalization();
  // Reached from onboarding's "I already use Qashy". This device has nothing yet, so it can
  // only join: hosting would mint a vault around an empty ledger.
  const firstRun =
    useLocalSearchParams<{ onboarding?: string }>().onboarding === "1";

  const [stage, setStage] = useState<Stage>("role");
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [role, setRole] = useState<Role>(firstRun ? "join" : "host");
  const [deviceName, setDeviceName] = useState(defaultDeviceName);
  const [busy, setBusy] = useState(false);
  // State is stale inside a double tap or a scan that fires twice in one frame; this is what the
  // in-flight check reads. `busy` only drives the rendering.
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  // A pairing code that was rejected on this device before anything was sent. Shown under the
  // code field, where the typo is, instead of in the banner at the top of the screen.
  const [codeError, setCodeError] = useState<string | null>(null);

  const [code, setCode] = useState<DisplayedPairingCode | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [sas, setSas] = useState<readonly string[] | null>(null);
  const [outcome, setOutcome] = useState<{
    headline: string;
    body: string;
  } | null>(null);
  // First run only: the pull that follows joining has finished (or failed) and the vault's
  // settings still have not arrived. Set from that pull's own completion, not from a timer.
  const [receiveSettled, setReceiveSettled] = useState(false);
  const [scannerRearm, setScannerRearm] = useState({
    token: 0,
    keepManual: false,
  });

  const session = useRef<Session | null>(null);
  // Held apart from `sas` because the confirmation closure differs by role while the words
  // do not, and the render only ever needs the words.
  const accept = useRef<(() => Promise<void>) | null>(null);
  // Bumped by every cancellation. An async step that resumes after a bump belongs to an attempt
  // the user has already left (Back, Start over, unmount), so it must not open a session, show
  // words, or navigate.
  const generation = useRef(0);

  /** Ends whatever is in flight. Safe to call repeatedly; that is the point of clearing it. */
  const closeSession = () => {
    generation.current += 1;
    session.current?.abort.abort();
    session.current?.close();
    session.current = null;
    accept.current = null;
  };

  // Hosting turns sync on (or back on) before any peer exists. If the attempt ends without a
  // device ever being added, undo exactly that, so abandoning the screen cannot leave sync
  // enabled — or an activity log claiming a pairing — with nobody on the other end.
  const startedSync = useRef<"created" | "resumed" | null>(null);
  const pairedPeer = useRef(false);
  // The enable/resume step of hosting. Unmount can land while it is still awaited; the rollback
  // then has to wait for it, because `startedSync` is only set once it has finished.
  const setupInFlight = useRef<Promise<unknown> | null>(null);
  const rollbackNow = () => {
    const started = startedSync.current;
    if (!started || pairedPeer.current) return;
    startedSync.current = null;
    void disableSync(setup, { forget: started === "created" })
      .then(() => refresh())
      .catch(() => undefined);
  };
  const rollbackAbandonedSetup = () => {
    const pending = setupInFlight.current;
    if (pending) {
      void pending.catch(() => undefined).then(rollbackNow);
      return;
    }
    rollbackNow();
  };

  // Unmount is a cancellation like any other: a socket left open on a rendezvous the user
  // navigated away from would keep a pairing window alive with nobody watching the words.
  useEffect(
    () => () => {
      closeSession();
      rollbackAbandonedSetup();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads refs only; must run once, on unmount
    [],
  );

  // First run ends when the vault's own settings arrive: they carry `onboardingComplete`, which
  // is what opens the rest of the app. Until then the done step says it is still receiving.
  const received = firstRun && stage === "done" && settings.onboardingComplete;
  useEffect(() => {
    if (received) router.replace("/overview");
  }, [received]);

  // Only while a code is on screen, and only to redraw the countdown. The pairing code is the
  // one thing in the sync stack with a wall-clock deadline the user has to act inside.
  useEffect(() => {
    if (stage !== "code" || !code) return;
    const tick = () =>
      setRemaining(Math.max(0, code.expiresAt - unixSeconds()));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [stage, code]);

  /** Claims the single in-flight slot. False means another press already owns it. */
  const begin = () => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    return true;
  };
  const finish = () => {
    busyRef.current = false;
    setBusy(false);
  };

  const move = (next: Stage) => {
    setDirection(
      STAGES.indexOf(next) >= STAGES.indexOf(stage) ? "forward" : "back",
    );
    setStage(next);
    setError(null);
    setCodeError(null);
  };

  const profile = (): DeviceProfile => ({
    name: deviceName.trim() || defaultDeviceName(),
    platform: Platform.OS,
  });

  // The pairing code and the six words are secrets in text form while they are on screen, so
  // they stay out of screenshots and recordings. If the block cannot be applied, the attempt is
  // abandoned rather than left on screen unprotected.
  const secretOnScreen =
    (stage === "code" && role === "host" && code !== null && !code.unusable) ||
    (stage === "confirm" && sas !== null);
  usePreventScreenCaptureWhile(secretOnScreen, "pairing-secret", () => {
    closeSession();
    rollbackAbandonedSetup();
    setSas(null);
    setCode(null);
    setError(
      t(
        "Pairing was stopped because screenshots could not be blocked on this device. Nothing was sent.",
      ),
    );
    move("role");
  });

  // -------------------------------------------------------------------------
  // Host — this device already has the data
  // -------------------------------------------------------------------------

  const startHosting = async () => {
    if (!begin()) return;
    setError(null);
    const began = generation.current;
    try {
      // Read the keystore at action time. `status` can still be the render from before the first
      // host attempt created its vault, especially after that attempt expires and the user tries
      // again. Calling enableSync from that stale render would refuse a perfectly valid vault.
      const currentBeforeStart = await readSyncStatus(setup);
      const setupStep = (async () => {
        if (currentBeforeStart.keystore === "empty") {
          // A device that has never synced becomes a vault first. This is the only place a
          // `VaultRootKey` is ever minted, and doing it here rather than on the sync screen means
          // a key only exists once somebody has actually started adding a second device.
          await enableSync(setup, profile());
          startedSync.current = "created";
        } else if (!currentBeforeStart.enabled) {
          // Hosting is an explicit sync action. It also repairs the useful case where a reset or
          // an older build left the device key intact but removed the enabled metadata.
          await resumeSync(setup);
          startedSync.current = "resumed";
        }
      })();
      setupInFlight.current = setupStep;
      try {
        await setupStep;
      } finally {
        if (setupInFlight.current === setupStep) setupInFlight.current = null;
      }
      // Left during the setup. `startedSync` is already recorded, so the rollback that the
      // cancellation armed will undo it; nothing else here should run.
      if (generation.current !== began) return;
      const vault = await setup.keystore.read();
      if (!vault) throw new Error("This device’s vault key could not be read.");
      // Read straight from storage rather than trusting `status`: `enableSync` has usually just
      // rewritten `sync_meta`, and the `status` in this closure is from the render that queued
      // this press. Hosting off a stale roster would omit a peer from the set the joiner is
      // handed, leaving that peer unable to verify anything the new device signs.
      const current = await readSyncStatus(setup);
      if (generation.current !== began) return;

      const host = new PairingHost({
        identity: vault.identity,
        vaultKey: vault.vaultKey,
        epoch: vault.epoch,
        baseCurrency: current.baseCurrency,
        ownerDeviceId: current.revocation.ownerDeviceId,
        revocationMode: current.revocation.mode,
        self: profile(),
        roster: current.peers,
        relayUrl: current.endpoints.relayUrl,
        now: unixSeconds,
        nowIso,
      });

      const abort = new AbortController();
      closeSession();
      session.current = { close: () => host.close(), abort };
      setCode({ value: host.code, expiresAt: host.expiresAt });
      move("code");

      // Deliberately not awaited: the code has to be readable *while* this waits for the other
      // device to show up. Failures land in `error` on the code step, where the user is.
      host
        .handshake(abort.signal)
        .then((confirmation) => {
          // Cancelled while the peer was still answering: the attempt is gone, so no words.
          if (abort.signal.aborted) return;
          accept.current = async () => {
            const { peer } = await confirmation.confirm();
            // Set as soon as the confirm has sent the vault key to the peer. From here the peer
            // holds the key on the other side, so a failure recording it locally must not trigger
            // the rollback that would disable sync here.
            pairedPeer.current = true;
            await recordPairedPeer(setup, peer);
            await refresh();
            setOutcome({
              headline: "Device added",
              body: "Both devices now hold the same vault key. Changes flow in both directions from here.",
            });
          };
          session.current = { close: () => confirmation.cancel(), abort };
          setSas(confirmation.sas);
          move("confirm");
        })
        .catch((reason: unknown) => {
          if (abort.signal.aborted) return;
          // PairingHost has closed and zeroized this attempt at this point, so mark the code
          // unusable now. Why: leaving its QR on screen until the timer reaches zero invites the
          // other device to scan a secret that can no longer answer, which looks exactly like an
          // expired-code retry bug.
          session.current = null;
          accept.current = null;
          setSas(null);
          setCode((current) =>
            current ? { ...current, unusable: true } : null,
          );
          hapticError();
          setError(
            errorMessage(reason, "The other device did not complete pairing."),
          );
          rollbackAbandonedSetup();
        });
    } catch (reason) {
      hapticError();
      setError(
        errorMessage(reason, "Sync could not be set up on this device."),
      );
    } finally {
      finish();
    }
  };

  /**
   * A host restart is a new pairing attempt, not a trip through the role picker. Keeping it
   * here also means the old code is cleared before the replacement is minted, so there is no
   * frame where the host appears to be offering the previous one again.
   */
  const restart = () => {
    closeSession();
    setCode(null);
    setSas(null);
    setOutcome(null);
    if (role === "host") {
      void startHosting();
    } else {
      move("role");
    }
  };

  // -------------------------------------------------------------------------
  // Joiner — this device is being added
  // -------------------------------------------------------------------------

  const startJoining = async (scanned: string) => {
    if (!begin()) return;
    setError(null);
    setCodeError(null);
    const began = generation.current;
    // The generation this attempt runs under once it owns a session. Stays null until then, so a
    // failure before the handshake is reported as before.
    let attempt: number | null = null;
    try {
      // Decoded before a socket is opened. A stale or malformed code is a local error with a
      // local fix, and reporting it as "the other device didn't answer" would send someone
      // debugging a network that is fine.
      let decoded: ReturnType<typeof decodePairingCode>;
      try {
        decoded = decodePairingCode(
          normalizeTypedPairingCode(scanned),
          unixSeconds(),
        );
      } catch (reason) {
        // Rejected on this device before anything was sent, so what was typed is only a typo:
        // keep the draft for correction and say what is wrong next to it.
        setScannerRearm((value) => ({
          token: value.token + 1,
          keepManual: true,
        }));
        hapticError();
        setCodeError(
          errorMessage(
            reason,
            "That code could not be used. Show a fresh one and try again.",
          ),
        );
        return;
      }
      const identity = createDeviceIdentity();
      // The joiner never needs a configured relay: `PairingCode` carries the host's address, so
      // a brand-new device with blank endpoints can still be added, and it inherits the host's
      // relay along with the vault.
      const current = await readSyncStatus(setup);
      // Back was pressed while the status was read: do not start a handshake the user left.
      if (generation.current !== began) return;

      const joiner = new PairingJoiner({
        identity,
        code: decoded,
        baseCurrency: current.baseCurrency,
        self: profile(),
        nowIso,
      });

      const abort = new AbortController();
      closeSession();
      attempt = generation.current;
      session.current = { close: () => joiner.close(), abort };

      const confirmation = await joiner.handshake(abort.signal);
      // Back (or unmount) during the handshake. The attempt is over; do not show words for it.
      if (abort.signal.aborted) return;
      accept.current = async () => {
        const joined = await confirmation.confirm();
        // The identity handed to `adoptVault` must be the one that earned the handshake — the
        // host has already written these exact public keys into its roster, and a fresh
        // identity here would be a device neither side can verify.
        await adoptVault(setup, {
          identity,
          vaultKey: joined.vaultKey,
          epoch: joined.epoch,
          baseCurrency: joined.baseCurrency,
          ownerDeviceId: joined.ownerDeviceId,
          revocationMode: joined.revocationMode,
          peers: joined.peers,
          profile: profile(),
        });
        await refresh();
        setOutcome({
          headline: "This device joined the vault",
          body: "Your data from both devices is being combined. Anything you created on both will show up twice until you review it.",
        });
      };
      session.current = { close: () => confirmation.cancel(), abort };
      setSas(confirmation.sas);
      move("confirm");
    } catch (reason) {
      // Cancelled by Back or unmount: the rejection is the cancellation, not a failed code.
      if (attempt !== null && generation.current !== attempt) return;
      // QrScanner claims one code per mount so a camera frame cannot start a dozen handshakes.
      // A failed or expired code is a new attempt, so give the scanner a fresh claim slot.
      setScannerRearm((value) => ({
        token: value.token + 1,
        keepManual: false,
      }));
      hapticError();
      setError(
        errorMessage(
          reason,
          "That code could not be used. Show a fresh one and try again.",
        ),
      );
    } finally {
      finish();
    }
  };

  // -------------------------------------------------------------------------
  // The confirmation itself
  // -------------------------------------------------------------------------

  /** One explicit pull for a device that has just joined; also what "Try again" runs. */
  const pullFirstRun = () => {
    setReceiveSettled(false);
    void reconcile()
      .catch(() => undefined)
      .finally(() => setReceiveSettled(true));
  };

  const confirmMatch = async () => {
    if (!accept.current || !begin()) return;
    setError(null);
    try {
      await accept.current();
      session.current = null;
      accept.current = null;
      move("done");
      hapticSuccess();
      // Pull the vault now rather than on the next scheduled pass, so a first-run device is not
      // left on "receiving" for a timer's length. A failure here is advisory; the provider
      // retries and reports it on its own.
      if (firstRun) pullFirstRun();
    } catch (reason) {
      hapticError();
      setError(errorMessage(reason, "Pairing could not be completed."));
    } finally {
      finish();
    }
  };

  const rejectMatch = () => {
    closeSession();
    rollbackAbandonedSetup();
    setSas(null);
    setCode(null);
    hapticWarning();
    setError(
      t(
        "Pairing was stopped and nothing was sent. Different words on the two screens can mean someone else tried to join — start again, and keep the code on screen only while the other device is scanning it.",
      ),
    );
    move("role");
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return {
    status,
    t,
    firstRun,
    stage,
    direction,
    role,
    setRole,
    deviceName,
    setDeviceName,
    busy,
    error,
    codeError,
    clearCodeError: () => setCodeError(null),
    receiveStalled: firstRun && stage === "done" && receiveSettled && !received,
    retryReceive: pullFirstRun,
    code,
    remaining,
    sas,
    outcome,
    scannerRearm,
    closeSession,
    move,
    startHosting,
    restart,
    startJoining,
    confirmMatch,
    rejectMatch,
  };
}
