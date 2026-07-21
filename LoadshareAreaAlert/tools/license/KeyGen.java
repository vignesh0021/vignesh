import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.spec.PKCS8EncodedKeySpec;
import java.time.LocalDate;
import java.util.Base64;

/**
 * Loadshare Area Alert — offline license key generator (SELLER TOOL).
 *
 * Keep the private key SECRET. Anyone with it can mint unlimited licenses.
 *
 * Build once:   javac KeyGen.java
 *
 * Generate a fresh keypair (only needed if you ever want to rotate keys):
 *   java KeyGen genkeys
 *   -> prints PUBLIC key (paste into LicenseVerifier.PUBLIC_KEY_B64 in the app)
 *      and PRIVATE key (save somewhere safe, never ship it)
 *
 * Mint a license for one customer:
 *   java KeyGen sign <privateKeyBase64> <deviceId> <months>
 *   e.g.  java KeyGen sign MIIEvwIB... a1b2c3d4e5f6 1
 *   -> prints the LICENSE KEY. Send it to the customer; they paste it into
 *      the app's Activate screen. It only works on the device whose ID you
 *      signed, and stops working after <months> months.
 *
 * The customer reads their Device ID from the app's Activate screen.
 */
public class KeyGen {

    public static void main(String[] args) throws Exception {
        if (args.length == 0) {
            System.out.println("Usage:");
            System.out.println("  java KeyGen genkeys");
            System.out.println("  java KeyGen sign <privateKeyBase64> <deviceId> <months>");
            return;
        }
        switch (args[0]) {
            case "genkeys": genKeys(); break;
            case "sign":
                if (args.length != 4) {
                    System.out.println("Usage: java KeyGen sign <privateKeyBase64> <deviceId> <months>");
                    return;
                }
                sign(args[1], args[2], Integer.parseInt(args[3]));
                break;
            default:
                System.out.println("Unknown command: " + args[0]);
        }
    }

    private static void genKeys() throws Exception {
        java.security.KeyPairGenerator kpg = java.security.KeyPairGenerator.getInstance("RSA");
        kpg.initialize(2048);
        java.security.KeyPair kp = kpg.generateKeyPair();
        System.out.println("=== PUBLIC KEY (paste into app LicenseVerifier.PUBLIC_KEY_B64) ===");
        System.out.println(Base64.getEncoder().encodeToString(kp.getPublic().getEncoded()));
        System.out.println();
        System.out.println("=== PRIVATE KEY (KEEP SECRET) ===");
        System.out.println(Base64.getEncoder().encodeToString(kp.getPrivate().getEncoded()));
    }

    private static void sign(String privB64, String deviceId, int months) throws Exception {
        long expiryEpochDay = LocalDate.now().plusMonths(months).toEpochDay();
        String payload = deviceId + "|" + expiryEpochDay;

        byte[] pkcs8 = Base64.getDecoder().decode(privB64);
        PrivateKey priv = KeyFactory.getInstance("RSA")
                .generatePrivate(new PKCS8EncodedKeySpec(pkcs8));
        Signature sig = Signature.getInstance("SHA256withRSA");
        sig.initSign(priv);
        sig.update(payload.getBytes(StandardCharsets.UTF_8));
        byte[] signature = sig.sign();

        String licenseKey =
                Base64.getUrlEncoder().withoutPadding().encodeToString(payload.getBytes(StandardCharsets.UTF_8))
                + "." +
                Base64.getUrlEncoder().withoutPadding().encodeToString(signature);

        System.out.println("Device:  " + deviceId);
        System.out.println("Expires: " + LocalDate.ofEpochDay(expiryEpochDay) + " (" + months + " month(s))");
        System.out.println();
        System.out.println("=== LICENSE KEY (send to customer) ===");
        System.out.println(licenseKey);
    }
}
