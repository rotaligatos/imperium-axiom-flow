// Device signature (WebAuthn / passkey): fingerprint, Face ID, Windows Hello or the device PIN.
import { rest, rpc, userId } from "./api.js";

const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => { s = s.replace(/-/g, "+").replace(/_/g, "/"); s += "=".repeat((4 - (s.length % 4)) % 4); return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); };

export async function canSign() {
  try { return !!(window.PublicKeyCredential && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())); } catch { return false; }
}
const friendly = (e) => {
  if (e && e.name === "NotAllowedError") return new Error("Signing was cancelled, timed out, or this device isn't set up for your signature yet. Tap “Set up this device” on the Home screen, then try again.");
  if (e && e.name === "InvalidStateError") return new Error("This device is already set up for your signature.");
  if (e && (e.name === "NotSupportedError" || e.name === "SecurityError")) return new Error("This browser or device can't do fingerprint / face / PIN signing. Please use your phone or another device.");
  return e;
};
const deviceLabel = () => { const u = navigator.userAgent; return /iPhone|iPad/.test(u) ? "iPhone/iPad" : /Android/.test(u) ? "Android" : /Mac/.test(u) ? "Mac" : /Windows/.test(u) ? "Windows PC" : "Device"; };

export async function myDevices() { return rest("iaf_passkeys?select=credential_id,label,created_at&order=created_at"); }

export async function registerDevice(displayName) {
  if (!(await canSign())) throw new Error("This device can't do fingerprint / face / PIN signing. Please use your phone or another device.");
  const challenge = await rpc("iaf_sign_challenge", { p_purpose: "REGISTER" });
  let cred;
  try {
    cred = await navigator.credentials.create({ publicKey: { challenge: unb64u(challenge), rp: { name: "Imperium Axiom Flow", id: location.hostname },
      user: { id: new TextEncoder().encode(userId()), name: displayName || "employee", displayName: displayName || "employee" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "preferred" }, attestation: "none", timeout: 60000 } });
  } catch (e) { throw friendly(e); }
  const pk = cred.response.getPublicKey ? cred.response.getPublicKey() : null;
  await rpc("iaf_passkey_register", { p_challenge: challenge, p_credential_id: cred.id, p_public_key: pk ? b64u(pk) : b64u(cred.response.attestationObject),
    p_client_data: b64u(cred.response.clientDataJSON), p_label: deviceLabel() });
  return cred.id;
}

// Asks the device to verify the person, stores the evidence, returns the signature id.
// purpose: SUBMIT | APPROVE | REJECT | ACCEPT. If the person has no device registered yet, registers this one first.
export async function sign(purpose, displayName) {
  if (!(await canSign())) throw new Error("Signing needs fingerprint, face or a device PIN, and this device can't do that. Please use your phone or another device.");
  let keys = await myDevices();
  if (!keys.length) { await registerDevice(displayName); keys = await myDevices(); }
  const challenge = await rpc("iaf_sign_challenge", { p_purpose: purpose });
  let a;
  try {
    a = await navigator.credentials.get({ publicKey: { challenge: unb64u(challenge), rpId: location.hostname, userVerification: "required", timeout: 60000,
      allowCredentials: keys.map((k) => ({ type: "public-key", id: unb64u(k.credential_id), transports: ["internal"] })) } });
  } catch (e) { throw friendly(e); }
  return rpc("iaf_sign_record", { p_challenge: challenge, p_credential_id: a.id, p_client_data: b64u(a.response.clientDataJSON),
    p_auth_data: b64u(a.response.authenticatorData), p_signature: b64u(a.response.signature) });
}
