// WebAuthn Helper Functions

export const registerWebAuthn = async (username: string) => {
  // In a real app, these options should come from the server
  const challenge = new Uint8Array(32);
  window.crypto.getRandomValues(challenge);

  const publicKey: PublicKeyCredentialCreationOptions = {
    challenge,
    rp: {
      name: "FaceCallAI",
      id: window.location.hostname,
    },
    user: {
      id: Uint8Array.from(username, (c) => c.charCodeAt(0)),
      name: username,
      displayName: username,
    },
    pubKeyCredParams: [
      { alg: -7, type: "public-key" }, // ES256
      { alg: -257, type: "public-key" }, // RS256
    ],
    authenticatorSelection: {
      authenticatorAttachment: "platform", // This forces FaceID/TouchID
      userVerification: "required",
    },
    timeout: 60000,
    attestation: "direct",
  };

  try {
    const credential = await navigator.credentials.create({ publicKey });
    return credential;
  } catch (error) {
    console.error("WebAuthn registration failed:", error);
    throw error;
  }
};

export const authenticateWebAuthn = async () => {
  // In a real app, the challenge should come from the server
  const challenge = new Uint8Array(32);
  window.crypto.getRandomValues(challenge);

  const publicKey: PublicKeyCredentialRequestOptions = {
    challenge,
    rpId: window.location.hostname,
    userVerification: "required",
    timeout: 60000,
  };

  try {
    const credential = await navigator.credentials.get({ publicKey });
    return credential;
  } catch (error) {
    console.error("WebAuthn authentication failed:", error);
    throw error;
  }
};

export const isWebAuthnSupported = () => {
  return (
    window.PublicKeyCredential &&
    PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable &&
    PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  );
};
