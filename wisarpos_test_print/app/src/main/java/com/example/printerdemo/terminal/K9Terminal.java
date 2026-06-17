package com.example.printerdemo.terminal;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;

/**
 * Wrapper for the K9 / coherent terminal app2app integration.
 * Intent pattern extracted from app2app reference source.
 */
public class K9Terminal {

    public static final int SALE        = 1;
    public static final int EPP         = 6;
    public static final int VOID        = 3;
    public static final int SETTLEMENT  = 10;
    public static final int TXN_LIST    = 11;
    public static final int EWALLET     = 66;  // generic e-wallet (no QR scheme)
    public static final int EWALLET_QR  = 660; // internal marker; sends typeofSale=66 + eWalletId

    public static final String DEFAULT_PKG            = "com.coherent.centerm.cptpaterminal";
    public static final String DEFAULT_RECEIVE_CLASS  = ".BroadcastTransactionActivity";
    public static final int    DEFAULT_INDEX_M        = 1;
    public static final int    DEFAULT_INDEX_T        = 1;

    private static final String CALLBACK_PKG   = "com.example.printerdemo";
    private static final String CALLBACK_CLASS = "com.example.printerdemo.PaymentResultActivity";

    private static int sqn = 0;

    // ── Public launchers ──────────────────────────────────────────────────────

    // ── Config holder ─────────────────────────────────────────────────────────

    public static class Config {
        public final String pkg;
        public final String receiveClass;
        public final int    indexM;
        public final int    indexT;

        public Config(String pkg, String receiveClass, int indexM, int indexT) {
            this.pkg          = (pkg != null && !pkg.isEmpty())          ? pkg          : DEFAULT_PKG;
            this.receiveClass = (receiveClass != null && !receiveClass.isEmpty()) ? receiveClass : DEFAULT_RECEIVE_CLASS;
            this.indexM       = indexM > 0 ? indexM : DEFAULT_INDEX_M;
            this.indexT       = indexT > 0 ? indexT : DEFAULT_INDEX_T;
        }

        /** Convenience: use all defaults. */
        public static Config defaults() {
            return new Config(null, null, DEFAULT_INDEX_M, DEFAULT_INDEX_T);
        }
    }

    // ── Public launchers ──────────────────────────────────────────────────────

    public static void sale(Activity a, Config cfg, String amountCents, String orderId) {
        Intent i = build(a, cfg);
        if (i == null) return;
        i.putExtra("typeofSale", 1);
        i.putExtra("Value_1",    amountCents);
        i.putExtra("sqn",        nextSqn());
        i.putExtra("indexM",     cfg.indexM);
        i.putExtra("indexT",     cfg.indexT);
        putOpt(i, "orderId", orderId);
        callback(i);
        a.startActivity(i);
    }

    public static void epp(Activity a, Config cfg, String amountCents, String months, String orderId) {
        Intent i = build(a, cfg);
        if (i == null) return;
        i.putExtra("typeofSale", 6);
        i.putExtra("Value_1",    amountCents);
        i.putExtra("Value_2",    months);
        i.putExtra("sqn",        nextSqn());
        i.putExtra("indexM",     cfg.indexM);
        i.putExtra("indexT",     cfg.indexT);
        putOpt(i, "orderId", orderId);
        callback(i);
        a.startActivity(i);
    }

    public static void voidTxn(Activity a, Config cfg, String invoiceNo, String schemeId) {
        Intent i = build(a, cfg);
        if (i == null) return;
        i.putExtra("typeofSale", 3);
        i.putExtra("Value_1",    invoiceNo);
        i.putExtra("sqn",        nextSqn());
        putOpt(i, "schemeId", schemeId);
        callback(i);
        a.startActivity(i);
    }

    public static void ewallet(Activity a, Config cfg, String amountCents, String orderId) {
        Intent i = build(a, cfg);
        if (i == null) return;
        i.putExtra("typeofSale", 66);
        i.putExtra("Value_1",    amountCents);
        i.putExtra("sqn",        nextSqn());
        i.putExtra("indexM",     cfg.indexM);
        i.putExtra("indexT",     cfg.indexT);
        putOpt(i, "orderId", orderId);
        callback(i);
        a.startActivity(i);
    }

    public static void ewalletQR(Activity a, Config cfg, String amountCents, String eWalletId, String orderId) {
        Intent i = build(a, cfg);
        if (i == null) return;
        i.putExtra("typeofSale", 66);
        i.putExtra("Value_1",    amountCents);
        i.putExtra("sqn",        nextSqn());
        i.putExtra("indexM",     cfg.indexM);
        i.putExtra("indexT",     cfg.indexT);
        putOpt(i, "eWalletId", eWalletId);
        putOpt(i, "orderId",   orderId);
        callback(i);
        a.startActivity(i);
    }

    public static void settlement(Activity a, Config cfg) {
        Intent i = build(a, cfg);
        if (i == null) return;
        i.putExtra("typeofSale", 10);
        i.putExtra("sqn",        nextSqn());
        i.putExtra("indexM",     cfg.indexM);
        i.putExtra("indexT",     cfg.indexT);
        callback(i);
        a.startActivity(i);
    }

    public static void txnList(Activity a, Config cfg) {
        Intent i = build(a, cfg);
        if (i == null) return;
        i.putExtra("typeofSale", 11);
        i.putExtra("sqn",        nextSqn());
        i.putExtra("indexM",     cfg.indexM);
        i.putExtra("indexT",     cfg.indexT);
        callback(i);
        a.startActivity(i);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /** Builds the base intent using getLaunchIntentForPackage (matches app2app pattern). */
    private static Intent build(Activity a, Config cfg) {
        Intent i = a.getPackageManager().getLaunchIntentForPackage(cfg.pkg);
        if (i == null) {
            // Terminal not installed — open Play Store
            Intent market = new Intent(Intent.ACTION_VIEW,
                    Uri.parse("market://details?id=" + cfg.pkg));
            a.startActivity(market);
            return null;
        }
        i.setAction(Intent.ACTION_SENDTO);
        i.setClassName(cfg.pkg, cfg.pkg + cfg.receiveClass);
        i.setType("text/plain");
        return i;
    }

    private static void callback(Intent i) {
        i.putExtra("ClassName",   CALLBACK_CLASS);
        i.putExtra("PackageName", CALLBACK_PKG);
    }

    private static void putOpt(Intent i, String key, String value) {
        if (value != null && !value.trim().isEmpty()) {
            i.putExtra(key, value.trim());
        }
    }

    /** Rolling 00–99 sequence number. */
    private static String nextSqn() {
        if (sqn > 99) sqn = 0;
        String s = Integer.toString(sqn++);
        return s.length() == 1 ? "0" + s : s;
    }
}
