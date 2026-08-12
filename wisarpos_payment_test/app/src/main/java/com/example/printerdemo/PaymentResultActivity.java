package com.example.printerdemo;

import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.widget.Button;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import com.example.printerdemo.printer.ReceiptPrinter;
import com.example.printerdemo.terminal.TransactionResult;
import com.example.printerdemo.TransactionDatabase;
import com.example.printerdemo.TransactionRecord;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Locale;

/**
 * Receives payment result sent directly by the terminal app (app2app pattern).
 * The terminal calls startActivity with ClassName=this class, PackageName=our package,
 * attaching all Value_x extras. Mirrors Main_Second from app2app reference.
 */
public class PaymentResultActivity extends AppCompatActivity {

    private TransactionResult result;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_result);

        Intent data = getIntent();
        result = new TransactionResult(data);

        TextView tvTitle   = findViewById(R.id.tvResultTitle);
        TextView tvStatus  = findViewById(R.id.tvResultStatus);
        TextView tvDetails = findViewById(R.id.tvResultDetails);
        Button   btnPrint  = findViewById(R.id.btnPrintReceipt);
        Button   btnClose  = findViewById(R.id.btnClose);

        // ── Header ──────────────────────────────────────────────────────────
        if (result.approved) {
            tvTitle.setText("APPROVED");
            tvTitle.setBackgroundColor(Color.parseColor("#388E3C"));
            tvStatus.setText("Transaction Successful");
            tvStatus.setTextColor(Color.parseColor("#388E3C"));
        } else {
            tvTitle.setText("DECLINED");
            tvTitle.setBackgroundColor(Color.parseColor("#C62828"));
            String msg = !result.message.isEmpty() ? result.message : "Code: " + result.status;
            tvStatus.setText("Transaction Failed — " + msg);
            tvStatus.setTextColor(Color.parseColor("#C62828"));
        }

        // ── Structured receipt display (image #1 style) ──────────────────────
        StringBuilder sb = new StringBuilder();
        sb.append("              SALE\n");
        sb.append("──────────────────────────────\n");
        if (!result.tid.isEmpty())     sb.append(row("TID",        result.tid));
        if (!result.mid.isEmpty())     sb.append(row("MID",        result.mid));
        if (!result.txnDate.isEmpty() || !result.txnTime.isEmpty())
            sb.append(row("DATE/TIME",  result.txnDate + " " + result.txnTime));
        if (!result.batchNo.isEmpty()) sb.append(row("BATCH NO",   result.batchNo));
        if (!result.traceNo.isEmpty()) sb.append(row("TRACE NO",   result.traceNo));
        if (!result.invoice.isEmpty()) sb.append(row("INVOICE NO", result.invoice));
        sb.append("──────────────────────────────\n");
        sb.append("              SALE\n");
        sb.append("──────────────────────────────\n");
        if (!result.cardNumber.isEmpty()) {
            sb.append("CARD NO :\n");
            sb.append("          ").append(result.cardNumber).append("\n");
        }
        String entry = deriveEntryMode(result.cardBrand);
        if (!entry.isEmpty())              sb.append(row("ENTRY",      entry));
        if (!result.cardBrand.isEmpty())   sb.append(row("APP",        result.cardBrand));
        if (!result.approvalCode.isEmpty()) sb.append(row("APPR CODE", result.approvalCode));
        if (!result.responseCode.isEmpty()) sb.append(row("RESP CODE", result.responseCode));
        if (!result.rrn.isEmpty())         sb.append(row("REF NO",     result.rrn));
        if (!result.ac.isEmpty())          sb.append(row("AC",         result.ac));
        if (!result.tvr.isEmpty())         sb.append(row("TVR",        result.tvr));
        sb.append("──────────────────────────────\n");
        sb.append("AMOUNT :\n");
        sb.append("                   ").append(formatAmountDisplay(result.amount)).append("\n");
        sb.append("──────────────────────────────\n");

        // ── Raw response extras ───────────────────────────────────────────────
        Bundle bundle = data.getExtras();
        sb.append("\n── Raw Response ───────────\n");
        if (bundle != null) {
            ArrayList<String> keys = new ArrayList<>(bundle.keySet());
            Collections.sort(keys, (a, b2) -> {
                boolean aVal = isValueKey(a), bVal = isValueKey(b2);
                boolean aReq = isRequestKey(a), bReq = isRequestKey(b2);
                if (aVal != bVal) return aVal ? -1 : 1;
                if (aReq != bReq) return aReq ? 1 : -1;
                if (aVal) return Integer.compare(valueIndex(a), valueIndex(b2));
                return a.compareToIgnoreCase(b2);
            });

            String val3 = data.getStringExtra("Value_3");
            boolean val3IsReceipts = val3 != null && val3.contains("<>");

            for (String key : keys) {
                if (isRequestKey(key)) continue;
                if (key.equalsIgnoreCase("settlementList")) continue;
                String desc  = keyDesc(key);
                String label = desc != null ? key + " [" + desc + "]" : key;
                String value = key.equalsIgnoreCase("Value_3") && val3IsReceipts
                        ? "(see Receipts below)"
                        : String.valueOf(bundle.get(key));
                sb.append(label).append(" : ").append(value).append("\n");
            }

            if (val3IsReceipts) {
                String[] receipts = val3.split("<>");
                sb.append("\n── Receipts (").append(receipts.length).append(") ──────────\n");
                for (int i = 0; i < receipts.length; i++) {
                    sb.append("[").append(i + 1).append("]\n").append(receipts[i]).append("\n");
                }
            }

            ArrayList<String> settlementList = data.getStringArrayListExtra("settlementList");
            if (settlementList != null && !settlementList.isEmpty()) {
                sb.append("\n── Settlement List (").append(settlementList.size()).append(") ──\n");
                for (int i = 0; i < settlementList.size(); i++) {
                    sb.append("[").append(i + 1).append("]\n").append(settlementList.get(i)).append("\n");
                }
            }
        } else {
            sb.append("No response extras received.\n");
        }

        sb.append("\n── Request ───────────────\n");
        sb.append(MainActivity.terminalLastRequest.isEmpty()
                ? "No request details." : MainActivity.terminalLastRequest);

        tvDetails.setText(sb.toString());


        // Build summary for Terminal tab response list
        String resultCode = data.getStringExtra("Value_1");
        if (resultCode == null) resultCode = "??";
        String resultText = data.getStringExtra("Value_2");
        StringBuilder summary = new StringBuilder();
        summary.append(result.approved ? "Approved" : "Failed")
               .append(" (").append(resultCode).append(")");
        if (resultText != null && !resultText.isEmpty()) {
            summary.append(" - ").append(resultText);
        }
        int typeOfSale = data.getIntExtra("typeofSale", MainActivity.lastTypeOfSale);
        // --- Build and persist TransactionRecord ---
        TransactionRecord rec = new TransactionRecord();
        rec.txnType      = (typeOfSale == 66) ? "eWallet" : "Card";
        rec.txnDate      = result.txnDate;
        rec.txnTime      = result.txnTime;
        rec.amount       = result.amount;
        rec.status       = result.approved ? "Approved" : "Failed";
        rec.resultCode   = resultCode != null ? resultCode : "";
        rec.resultText   = resultText != null ? resultText : "";
        rec.tid          = result.tid;
        rec.mid          = result.mid;
        rec.batchNo      = result.batchNo;
        rec.traceNo      = result.traceNo;
        rec.invoice      = result.invoice;
        rec.cardNumber   = result.cardNumber;
        rec.cardBrand    = result.cardBrand;
        rec.approvalCode = result.approvalCode;
        rec.responseCode = result.responseCode;
        rec.rrn          = result.rrn;
        rec.eWalletId    = data.getStringExtra("eWalletId") != null
                         ? data.getStringExtra("eWalletId") : "";
        rec.orderId      = data.getStringExtra("orderId") != null
                         ? data.getStringExtra("orderId") : "";
        rec.rawDetails   = sb.toString();
        rec.createdAt    = System.currentTimeMillis();
        new TransactionDatabase(this).insert(rec);

        if (typeOfSale == 66) {
            if (result.approved) MainActivity.eWalletPassCount++;
            else MainActivity.eWalletFailCount++;
            String lastRes = result.approved ? "✔ APPROVED" : "✘ FAILED";
            if (resultCode != null && !resultCode.isEmpty())
                lastRes += " (" + resultCode + ")";
            if (resultText != null && !resultText.isEmpty())
                lastRes += " — " + resultText;
            MainActivity.eWalletLastResult = "Last result: " + lastRes;
        } else {
            if (result.approved) MainActivity.terminalPassCount++;
            else MainActivity.terminalFailCount++;
        }

        btnPrint.setOnClickListener(v -> printReceiptAsync());
        btnClose.setOnClickListener(v -> goBackToMain());
    }

    private void printReceiptAsync() {
        Toast.makeText(this, "Printing receipt...", Toast.LENGTH_SHORT).show();
        new Thread(() -> {
            try {
                new ReceiptPrinter(this).printReceipt(result);
                mainHandler.post(() ->
                    Toast.makeText(this, "Receipt printed", Toast.LENGTH_SHORT).show());
            } catch (Exception e) {
                mainHandler.post(() ->
                    Toast.makeText(this, "Print failed: " + e.getMessage(), Toast.LENGTH_LONG).show());
            }
        }).start();
    }

    private void goBackToMain() {
        Intent intent = new Intent(this, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(intent);
        finish();
    }

    // ── Receipt display helpers ───────────────────────────────────────────────

    private String row(String label, String value) {
        return String.format("%-10s: %s\n", label, value);
    }

    private String deriveEntryMode(String cardBrand) {
        if (cardBrand == null) return "";
        String u = cardBrand.toUpperCase();
        if (u.contains("CONTACTLESS") || u.contains("NFC") || u.contains("WAVE")) return "CONTACTLESS";
        if (u.contains("CHIP") || u.contains("ICC")) return "CHIP";
        if (u.contains("SWIPE") || u.contains("MSR")) return "SWIPE";
        return "";
    }

    private String formatAmountDisplay(String amount) {
        if (amount == null || amount.isEmpty()) return "";
        try { return String.format(Locale.US, "MYR %.2f", Double.parseDouble(amount)); }
        catch (NumberFormatException e) {}
        try { return String.format(Locale.US, "MYR %.2f", Long.parseLong(amount) / 100.0); }
        catch (NumberFormatException e) {}
        return "MYR " + amount;
    }

    // ── Helpers (mirrors Main_Second) ────────────────────────────────────────

    private boolean isValueKey(String k) {
        return k != null && k.matches("(?i)^value_\\d+$");
    }

    private int valueIndex(String k) {
        try { return Integer.parseInt(k.split("_")[1]); } catch (Exception e) { return 999; }
    }

    private boolean isRequestKey(String k) {
        if (k == null) return false;
        switch (k.toLowerCase()) {
            case "typeofsale": case "sqn": case "indexm": case "indext":
            case "classname":  case "packagename": case "ewalletid": case "schemeid":
                return true;
            default: return false;
        }
    }

    private String keyDesc(String k) {
        if (k == null) return null;
        switch (k.toLowerCase()) {
            case "value_1":  return "Result Code";
            case "value_2":  return "Result Text";
            case "value_3":  return "Amount";
            case "value_4":  return "Card Number";
            case "value_5":  return "Card Brand";
            case "value_6":  return "Expiry Date";
            case "value_7":  return "Approval Code";
            case "value_8":  return "RRN";
            case "value_9":  return "Batch No";
            case "value_10": return "Trace No";
            case "value_11": return "Date";
            case "value_12": return "Time";
            case "value_13": return "MID";
            case "value_14": return "TID";
            case "value_15": return "Invoice";
            case "value_16": return "Trace Num";
            case "value_17": return "Application Cryptogram";
            case "value_18": return "Terminal Verification Results";
            case "value_19": return "Response Code";
            case "value_20": return "Hashed Card Number";
            case "orderid":  return "Order ID";
            default:         return null;
        }
    }
}
