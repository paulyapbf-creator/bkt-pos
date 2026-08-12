package com.example.printerdemo;

import org.json.JSONObject;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class TransactionRecord {

    public long   id;
    public String txnType      = "";   // "eWallet" or "Card"
    public String txnDate      = "";
    public String txnTime      = "";
    public String amount       = "";   // e.g. "10.00"
    public String status       = "";   // "Approved" or "Failed"
    public String resultCode   = "";
    public String resultText   = "";
    public String tid          = "";
    public String mid          = "";
    public String batchNo      = "";
    public String traceNo      = "";
    public String invoice      = "";
    public String cardNumber   = "";
    public String cardBrand    = "";
    public String approvalCode = "";
    public String responseCode = "";
    public String rrn          = "";
    public String eWalletId    = "";
    public String orderId      = "";
    public String rawDetails   = "";   // full detail block for display/print
    public long   createdAt    = 0;    // System.currentTimeMillis()

    /** Detailed label for the Report tab list */
    public String reportLabel() {
        String icon = "Approved".equals(status) ? "✔" : "✘";
        String amt  = amount.isEmpty() ? "—" : "MYR " + amount;

        // Resolve date/time — prefer terminal-supplied, fall back to createdAt
        String date = txnDate;
        String time = txnTime;
        if (date.isEmpty() && time.isEmpty() && createdAt > 0) {
            date = new SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(new Date(createdAt));
            time = new SimpleDateFormat("HH:mm:ss",   Locale.getDefault()).format(new Date(createdAt));
        }

        StringBuilder sb = new StringBuilder();
        sb.append(icon).append(" [").append(txnType).append("]  ").append(amt);

        if (!date.isEmpty() || !time.isEmpty())
            sb.append("\n").append(date).append("  ").append(time);

        StringBuilder det = new StringBuilder();
        if (!traceNo.isEmpty()) det.append("Trace: ").append(traceNo);
        if (!invoice.isEmpty()) { if (det.length() > 0) det.append("   "); det.append("Inv: ").append(invoice); }
        if (!rrn.isEmpty())     { if (det.length() > 0) det.append("   "); det.append("Ref: ").append(rrn); }
        if (det.length() > 0)  sb.append("\n").append(det);

        return sb.toString();
    }

    /** Short label for ListView row */
    public String listLabel() {
        String dateStr;
        if (!txnDate.isEmpty() || !txnTime.isEmpty()) {
            dateStr = (txnDate + " " + txnTime).trim();
        } else {
            dateStr = new SimpleDateFormat("MM-dd HH:mm", Locale.getDefault())
                          .format(new Date(createdAt));
        }
        String amt = amount.isEmpty() ? "—" : "MYR " + amount;
        String icon = "Approved".equals(status) ? "✔" : "✘";
        return icon + " [" + txnType + "]  " + amt + "  " + dateStr;
    }

    /** Formatted text block for print / detail view */
    public String formatReceipt() {
        StringBuilder sb = new StringBuilder();
        sb.append("--------------------------------\n");
        sb.append("  ").append(txnType.toUpperCase()).append(" TRANSACTION\n");
        sb.append("--------------------------------\n");
        if (!txnDate.isEmpty() || !txnTime.isEmpty())
            sb.append("DATE/TIME : ").append(txnDate).append(" ").append(txnTime).append("\n");
        if (!tid.isEmpty())           sb.append("TID       : ").append(tid).append("\n");
        if (!mid.isEmpty())           sb.append("MID       : ").append(mid).append("\n");
        if (!batchNo.isEmpty())       sb.append("BATCH NO  : ").append(batchNo).append("\n");
        if (!traceNo.isEmpty())       sb.append("TRACE NO  : ").append(traceNo).append("\n");
        if (!invoice.isEmpty())       sb.append("INVOICE   : ").append(invoice).append("\n");
        if (!orderId.isEmpty())       sb.append("ORDER ID  : ").append(orderId).append("\n");
        if (!eWalletId.isEmpty())     sb.append("EWALLET   : ").append(eWalletId).append("\n");
        sb.append("- - - - - - - - - - - - - - - -\n");
        if (!cardNumber.isEmpty())    sb.append("CARD NO   : ").append(cardNumber).append("\n");
        if (!cardBrand.isEmpty())     sb.append("APP       : ").append(cardBrand).append("\n");
        if (!approvalCode.isEmpty())  sb.append("APPR CODE : ").append(approvalCode).append("\n");
        if (!responseCode.isEmpty())  sb.append("RESP CODE : ").append(responseCode).append("\n");
        if (!rrn.isEmpty())           sb.append("REF NO    : ").append(rrn).append("\n");
        sb.append("- - - - - - - - - - - - - - - -\n");
        sb.append("AMOUNT    : MYR ").append(amount.isEmpty() ? "—" : amount).append("\n");
        sb.append("STATUS    : ").append(status).append("\n");
        if (!resultCode.isEmpty())    sb.append("CODE      : ").append(resultCode).append("\n");
        if (!resultText.isEmpty())    sb.append("MESSAGE   : ").append(resultText).append("\n");
        sb.append("--------------------------------\n");
        return sb.toString();
    }

    /** JSON object for upload */
    public JSONObject toJson() {
        try {
            JSONObject j = new JSONObject();
            j.put("id",            id);
            j.put("txn_type",      txnType);
            j.put("txn_date",      txnDate);
            j.put("txn_time",      txnTime);
            j.put("amount",        amount);
            j.put("status",        status);
            j.put("result_code",   resultCode);
            j.put("result_text",   resultText);
            j.put("tid",           tid);
            j.put("mid",           mid);
            j.put("batch_no",      batchNo);
            j.put("trace_no",      traceNo);
            j.put("invoice",       invoice);
            j.put("card_number",   cardNumber);
            j.put("card_brand",    cardBrand);
            j.put("approval_code", approvalCode);
            j.put("response_code", responseCode);
            j.put("rrn",           rrn);
            j.put("ewallet_id",    eWalletId);
            j.put("order_id",      orderId);
            j.put("created_at",    createdAt);
            return j;
        } catch (Exception e) {
            return new JSONObject();
        }
    }
}
