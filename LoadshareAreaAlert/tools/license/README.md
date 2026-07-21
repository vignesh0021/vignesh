# License Key Generator (Seller Tool)

This is how you sell the app as a **per-device, time-limited subscription**.
Each customer gets a key that only works on **their** device and stops working
after the months you choose. Verification happens **offline** inside the app — no
server needed.

## How it works

- The app contains only the **public key** (it can *verify* licenses, never create them).
- You hold the **private key** (kept secret). Only you can mint keys.
- A license encodes `deviceId | expiryDate`, signed with your private key.
- The app checks: signature valid? issued for *this* device? not expired? → unlocks.

## One-time setup

You already have a keypair. The app ships with the matching public key
(`LicenseVerifier.PUBLIC_KEY_B64`). Keep your **private key** somewhere safe
(a password manager). Never commit it or send it to anyone.

Compile the tool once (needs a JDK):

```
cd tools/license
javac KeyGen.java
```

## Selling to a customer (every sale)

1. The customer installs the app and opens it. It shows their **Device ID**.
2. They send you that Device ID (and pay you).
3. You mint a key — e.g. 1 month:

   ```
   java KeyGen sign <YOUR_PRIVATE_KEY_BASE64> <customerDeviceId> 1
   ```

   Output ends with the **LICENSE KEY**.
4. Send the license key to the customer. They paste it into the app's
   **Activate** screen and tap Activate.

## Renewals

When it expires, the app locks and shows the Activate screen again. Mint a new
key for the same Device ID with more months and send it over.

## Rotating keys (optional)

To invalidate every key ever issued (e.g. private key leaked):

```
java KeyGen genkeys
```

Paste the new PUBLIC key into `LicenseVerifier.PUBLIC_KEY_B64`, rebuild, and
release. All old licenses stop working; re-issue keys to paying customers.

## Notes

- The Device ID is stable across reinstalls as long as the phone and the app's
  signing key don't change, so a paid license survives a reinstall.
- Moving the phone clock backwards does **not** revive an expired license (the
  app records the furthest date it has seen).
