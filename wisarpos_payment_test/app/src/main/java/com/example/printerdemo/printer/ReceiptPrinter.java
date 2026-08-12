package com.example.printerdemo.printer;

import android.content.Context;

import com.example.printerdemo.TransactionRecord;
import com.example.printerdemo.WizarPosPrinter;
import com.example.printerdemo.terminal.TransactionResult;

import java.util.List;
import java.util.Locale;

public class ReceiptPrinter {

    private final WizarPosPrinter printer;
    private final Context context;

    public ReceiptPrinter(Context context) {
        this.context = context;
        this.printer = new WizarPosPrinter();
    }

    /** Print a payment receipt. Call on a background thread. */
    public void printReceipt(TransactionResult r) throws Exception {
        printer.init(context);
        printer.open();
        try {
            p("--------------------------------");
            p("              SALE");
            p("--------------------------------");
            p("");
            if (!r.tid.isEmpty())     p("TID: " + r.tid);
            if (!r.mid.isEmpty())     p("MID: " + r.mid);
            if (!r.txnDate.isEmpty() || !r.txnTime.isEmpty())
                                      p("DATE/TIME: " + r.txnDate + r.txnTime);
            if (!r.batchNo.isEmpty()) p("BATCH NO: " + r.batchNo);
            if (!r.traceNo.isEmpty()) p("TRACE NO: " + r.traceNo);
            if (!r.invoice.isEmpty()) p("INVOICE NO: " + r.invoice);
            p("- - - - - - - - - - - - - - - -");
            p("              SALE");
            p("- - - - - - - - - - - - - - - -");
            p("");
            if (!r.cardNumber.isEmpty()) {
                p("CARD NO:");
                p("        " + r.cardNumber);
            }
            String entry = deriveEntryMode(r.cardBrand);
            if (!entry.isEmpty())              p("ENTRY: " + entry);
            if (!r.cardBrand.isEmpty())        p("APP: " + r.cardBrand);
            if (!r.approvalCode.isEmpty())     p("APPR CODE: " + r.approvalCode);
            if (!r.responseCode.isEmpty())     p("RESP CODE: " + r.responseCode);
            if (!r.rrn.isEmpty())              p("REF NO: " + r.rrn);
            if (!r.ac.isEmpty())               p("AC: " + r.ac);
            if (!r.tvr.isEmpty())              p("TVR: " + r.tvr);
            p("- - - - - - - - - - - - - - - -");
            p("AMOUNT:");
            p("                   " + formatAmount(r.amount));
            p("- - - - - - - - - - - - - - - -");
            p("");

            if (r.approved) {
                p("    NO PIN REQUIRED");
                p("    NO SIGNATURE REQUIRED");
                p("I AGREE TO PAY THE ABOVE TOTAL");
                p("AMOUNT ACCORDING TO THE CARD");
                p("ISSUER AGREEMENT");
                p("- - - - - - - - - - - - - - - -");
                p("   ****** CUSTOMER COPY ******");
                p("          (DUPLICATED)");
            } else {
                p("        *** DECLINED ***");
                if (!r.message.isEmpty()) p("   " + r.message);
            }

            p("");
            p("");
            p("");
            p("");
            p("");
            printer.cutPaper();
        } finally {
            printer.close();
        }
    }

    /** Print a transaction record from the Sales database. Call on a background thread. */
    public void printTransaction(TransactionRecord r) throws Exception {
        printer.init(context);
        printer.open();
        try {
            p("--------------------------------");
            p("  " + r.txnType.toUpperCase() + " TRANSACTION");
            p("--------------------------------");
            p("");
            if (!r.txnDate.isEmpty() || !r.txnTime.isEmpty())
                p("DATE/TIME : " + r.txnDate + " " + r.txnTime);
            if (!r.tid.isEmpty())           p("TID       : " + r.tid);
            if (!r.mid.isEmpty())           p("MID       : " + r.mid);
            if (!r.batchNo.isEmpty())       p("BATCH NO  : " + r.batchNo);
            if (!r.traceNo.isEmpty())       p("TRACE NO  : " + r.traceNo);
            if (!r.invoice.isEmpty())       p("INVOICE   : " + r.invoice);
            if (!r.orderId.isEmpty())       p("ORDER ID  : " + r.orderId);
            if (!r.eWalletId.isEmpty())     p("EWALLET   : " + r.eWalletId);
            p("- - - - - - - - - - - - - - - -");
            if (!r.cardNumber.isEmpty())    p("CARD NO   : " + r.cardNumber);
            if (!r.cardBrand.isEmpty())     p("APP       : " + r.cardBrand);
            if (!r.approvalCode.isEmpty())  p("APPR CODE : " + r.approvalCode);
            if (!r.responseCode.isEmpty())  p("RESP CODE : " + r.responseCode);
            if (!r.rrn.isEmpty())           p("REF NO    : " + r.rrn);
            p("- - - - - - - - - - - - - - - -");
            p("AMOUNT    : " + formatAmount(r.amount));
            p("STATUS    : " + r.status);
            if (!r.resultCode.isEmpty())    p("CODE      : " + r.resultCode);
            if (!r.resultText.isEmpty())    p("MESSAGE   : " + r.resultText);
            p("--------------------------------");
            p("");
            p("");
            p("");
            printer.cutPaper();
        } finally {
            printer.close();
        }
    }

    /** Print a daily sales report. Call on a background thread. */
    public void printReport(String date, List<TransactionRecord> records,
                            int walletCount, double walletAmt,
                            int cardCount,  double cardAmt,
                            int failCount) throws Exception {
        printer.init(context);
        printer.open();
        try {
            p("================================");
            p("         SALES REPORT");
            p("================================");
            p("DATE : " + date);
            p("--------------------------------");
            p(String.format(Locale.US, "eWallet Approved : %3d  MYR %.2f", walletCount, walletAmt));
            p(String.format(Locale.US, "Card Approved    : %3d  MYR %.2f", cardCount,  cardAmt));
            p("- - - - - - - - - - - - - - - -");
            p(String.format(Locale.US, "TOTAL APPROVED   : %3d  MYR %.2f", walletCount + cardCount, walletAmt + cardAmt));
            p(String.format(Locale.US, "Failed           : %3d", failCount));
            p("================================");
            p("");

            for (TransactionRecord r : records) {
                String icon = "Approved".equals(r.status) ? "[OK]" : "[--]";

                // Date / time
                String date2 = r.txnDate;
                String time2 = r.txnTime;
                if (date2.isEmpty() && time2.isEmpty() && r.createdAt > 0) {
                    java.text.SimpleDateFormat sdf = new java.text.SimpleDateFormat("yyyy-MM-dd", Locale.getDefault());
                    java.text.SimpleDateFormat stf = new java.text.SimpleDateFormat("HH:mm:ss", Locale.getDefault());
                    date2 = sdf.format(new java.util.Date(r.createdAt));
                    time2 = stf.format(new java.util.Date(r.createdAt));
                }

                p(icon + " [" + r.txnType + "]  " + formatAmount(r.amount));
                if (!date2.isEmpty() || !time2.isEmpty())
                    p("  " + date2 + "  " + time2);
                if (!r.traceNo.isEmpty())  p("  Trace  : " + r.traceNo);
                if (!r.invoice.isEmpty())  p("  Invoice: " + r.invoice);
                if (!r.rrn.isEmpty())      p("  Ref No : " + r.rrn);
                p("- - - - - - - - - - - - - - - -");
            }

            p("");
            p("");
            p("");
            printer.cutPaper();
        } finally {
            printer.close();
        }
    }

    private void p(String line) throws Exception {
        printer.printlnText(line);
    }

    private String formatAmount(String amount) {
        if (amount == null || amount.isEmpty()) return "";
        try { return String.format(Locale.US, "MYR %.2f", Double.parseDouble(amount)); }
        catch (NumberFormatException e) {}
        try { return String.format(Locale.US, "MYR %.2f", Long.parseLong(amount) / 100.0); }
        catch (NumberFormatException e) {}
        return "MYR " + amount;
    }

    private String deriveEntryMode(String cardBrand) {
        if (cardBrand == null) return "";
        String u = cardBrand.toUpperCase();
        if (u.contains("CONTACTLESS") || u.contains("NFC") || u.contains("WAVE")) return "CONTACTLESS";
        if (u.contains("CHIP") || u.contains("ICC")) return "CHIP";
        if (u.contains("SWIPE") || u.contains("MSR")) return "SWIPE";
        return "";
    }
}
